import path from 'path'
import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import QRCode from 'qrcode'
import { Client, LocalAuth } from 'whatsapp-web.js'
import { getProviderConfig } from './providerConfig'

export type WhatsAppWebState = 'idle' | 'qr' | 'connecting' | 'ready' | 'error'

const SESSION_DIR = path.join(process.cwd(), 'data', 'orbit-personal-whatsapp')
const CLIENT_ID = 'orbit-jarvis-wanderson'
const SYNC_TIMEOUT_MS = 120_000
const execAsync = promisify(exec)

export async function killOrphanChrome(): Promise<void> {
  const marker = `user-data-dir=${SESSION_DIR}`
  try {
    await execAsync(`pkill -f "${marker}" || true`)
    await new Promise(r => setTimeout(r, 3000))  // wait for Chrome to flush session to disk
    await execAsync(`pkill -9 -f "${marker}" || true`)
    await new Promise(r => setTimeout(r, 500))
  } catch { /* ignore */ }
}

let client: Client | null = null
let state: WhatsAppWebState = 'idle'
let qrDataUrl: string | null = null
let phone: string | null = null
let lastError: string | null = null
let starting: Promise<void> | null = null
let syncTimeout: ReturnType<typeof setTimeout> | null = null
let syncAutoRetried = false

function clearSyncTimeout(): void {
  if (syncTimeout) {
    clearTimeout(syncTimeout)
    syncTimeout = null
  }
}

async function onSyncTimeout(): Promise<void> {
  if (state !== 'connecting') return
  if (syncAutoRetried) {
    state = 'error'
    lastError = 'Timeout na sincronização'
    return
  }
  syncAutoRetried = true
  console.warn('[whatsappWeb] Timeout na sincronização — reinício automático')
  lastError = 'Timeout na sincronização; a tentar de novo…'
  clearSyncTimeout()
  await destroyClient(false)
  await killOrphanChrome()
  starting = null
  try {
    await startWhatsAppWeb()
  } catch { /* ignore */ }
}

function sessionExists(): boolean {
  try {
    if (!fs.existsSync(SESSION_DIR)) return false
    return fs.readdirSync(SESSION_DIR).length > 0
  } catch {
    return false
  }
}

export function getWhatsAppWebStatus() {
  return {
    connected: state === 'ready',
    state,
    qrDataUrl: state === 'qr' ? qrDataUrl : null,
    phone,
    error: lastError,
  }
}

function buildClient(): Client {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  return new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR, clientId: CLIENT_ID }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  })
}

async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    let apiKey = process.env.GROQ_API_KEY || ''
    if (!apiKey) {
      const cfg = await getProviderConfig('GROQ')
      apiKey = cfg?.apiKey || ''
    }
    if (!apiKey) return null

    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'opus'
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType })

    const form = new FormData()
    form.append('file', blob, `audio.${ext}`)
    form.append('model', 'whisper-large-v3-turbo')
    form.append('language', 'pt')
    form.append('response_format', 'text')

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })

    if (!response.ok) return null
    const text = await response.text()
    return text.trim() || null
  } catch (err) {
    console.warn('[whatsappWeb] transcribeAudio erro:', (err as Error).message)
    return null
  }
}

function attachListeners(c: Client): void {
  c.on('qr', async (qr: string) => {
    state = 'qr'
    lastError = null
    try {
      qrDataUrl = await QRCode.toDataURL(qr)
    } catch {
      qrDataUrl = null
    }
    console.log('[whatsappWeb:orbit-personal] QR — escaneia com o WhatsApp PESSOAL do Wanderson (não OrbitHub/Autotrack)')
  })

  c.on('authenticated', () => {
    state = 'connecting'
    qrDataUrl = null
    console.log('[whatsappWeb] Autenticado, a sincronizar…')
    clearSyncTimeout()
    syncTimeout = setTimeout(() => { void onSyncTimeout() }, SYNC_TIMEOUT_MS)
  })

  c.on('ready', () => {
    clearSyncTimeout()
    syncAutoRetried = false
    state = 'ready'
    qrDataUrl = null
    lastError = null
    phone = c.info?.wid?.user ?? null
    console.log(`[whatsappWeb:orbit-personal] Ligado${phone ? ` (+${phone})` : ''}`)
  })

  c.on('auth_failure', (msg: string) => {
    clearSyncTimeout()
    state = 'error'
    lastError = msg || 'Falha de autenticação'
    console.error('[whatsappWeb] auth_failure:', lastError)
  })

  c.on('disconnected', (reason: string) => {
    clearSyncTimeout()
    console.warn('[whatsappWeb] Desligado:', reason)
    state = 'idle'
    qrDataUrl = null
    phone = null
    client = null
    starting = null
  })

  c.on('message', async (msg) => {
    if (msg.fromMe) return
    try {
      const { isVipPhone, shouldAllowOrbitNotification, queueNonVipMessage } = await import('../modules/focusMode')
      const { extractPersonalPreferencesFromText } = await import('../modules/episodicMemory')
      const from = (msg.from || '').replace(/@c.us$/, '')
      let body = (msg.body || '').slice(0, 500)

      // Transcrição automática de mensagens de voz com Groq Whisper
      const isVoice = msg.type === 'ptt' || msg.type === 'audio' || (msg.hasMedia && (msg.duration !== undefined))
      if (isVoice && !body) {
        try {
          const media = await msg.downloadMedia()
          if (media?.data) {
            const audioBuffer = Buffer.from(media.data, 'base64')
            const mimeType = media.mimetype || 'audio/ogg'
            const transcription = await transcribeAudio(audioBuffer, mimeType)
            if (transcription) {
              body = `[Mensagem de voz transcrita]: ${transcription}`
              console.log(`[whatsappWeb] Voz transcrita de ${from}: ${transcription.slice(0, 100)}`)
            }
          }
        } catch (voiceErr) {
          console.warn('[whatsappWeb] Erro ao transcrever voz:', (voiceErr as Error).message)
        }
      }

      const vip = await isVipPhone(from)
      if (!shouldAllowOrbitNotification(vip)) {
        queueNonVipMessage(from, body)
        return
      }
      if (body) void extractPersonalPreferencesFromText(body, from)
    } catch { /* ignore */ }
  })
}

export async function startWhatsAppWeb(): Promise<void> {
  if (state === 'ready' && client) return
  if (starting) return starting

  starting = (async () => {
    if (client) return
    await killOrphanChrome()
    state = 'connecting'
    lastError = null
    client = buildClient()
    attachListeners(client)
    try {
      await client.initialize()
    } catch (err) {
      clearSyncTimeout()
      state = 'error'
      lastError = err instanceof Error ? err.message : 'Erro ao iniciar WhatsApp Web'
      client = null
      starting = null
      await killOrphanChrome()
      throw err
    }
  })()

  return starting
}

export async function resumeWhatsAppWebIfPossible(): Promise<void> {
  if (!sessionExists() || client) return
  try {
    await startWhatsAppWeb()
  } catch (e) {
    console.warn('[whatsappWeb] Retoma automática falhou:', (e as Error).message)
  }
}

async function destroyClient(logout = false): Promise<void> {
  clearSyncTimeout()
  if (!client) {
    state = 'idle'
    qrDataUrl = null
    phone = null
    starting = null
    return
  }
  if (logout) {
    try {
      await client.logout()
    } catch { /* ignore */ }
  }
  try {
    await client.destroy()
  } catch { /* ignore */ }
  client = null
  state = 'idle'
  qrDataUrl = null
  phone = null
  starting = null
}

/** Desliga e apaga sessão — volta a pedir QR */
export async function disconnectWhatsAppWeb(): Promise<void> {
  await destroyClient(true)
  await killOrphanChrome()
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true })
  } catch { /* ignore */ }
}

/** Fecha o Chrome limpo mas MANTÉM a sessão em disco — no próximo arranque não pede QR */
export async function shutdownWhatsAppWeb(): Promise<void> {
  await destroyClient(false)  // logout=false → sessão preservada
  // Não chamamos killOrphanChrome() aqui: client.destroy() encerra o Chrome graciosamente
  // e permite que o perfil (sessão LocalAuth) seja gravado em disco antes de sair.
}

/** Reinicia o Chromium/WhatsApp Web — mantém sessão se existir */
export async function restartWhatsAppWeb(): Promise<void> {
  console.log('[whatsappWeb:orbit-personal] Reinício pedido')
  await destroyClient(false)
  await killOrphanChrome()
  await startWhatsAppWeb()
}

function normalizePhone(to: string): string {
  const digits = to.replace(/\D/g, '')
  if (digits.startsWith('351') || digits.length > 11) return digits
  return `351${digits}`
}

export async function sendViaWhatsAppWeb(
  to: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  if (state !== 'ready' || !client) {
    return {
      ok: false,
      error: 'WhatsApp Web não ligado. Abre /orbit → Configuração → Ligar WhatsApp (QR).',
    }
  }

  const digits = normalizePhone(to)
  try {
    const numberId = await client.getNumberId(digits)
    const jid = numberId?._serialized ?? `${digits}@c.us`
    await client.sendMessage(jid, message)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erro ao enviar' }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms: ${label}`)), ms)),
  ])
}

export async function getRecentWhatsAppMessages(
  limit = 5,
): Promise<{ ok: boolean; messages?: Array<{ from: string; body: string; timestamp: number; isMe: boolean }>; error?: string }> {
  if (state !== 'ready' || !client) {
    return { ok: false, error: 'WhatsApp não ligado.' }
  }
  try {
    const chats = await withTimeout(client.getChats(), 8000, 'getChats')
    const messages: Array<{ from: string; body: string; timestamp: number; isMe: boolean }> = []
    for (const chat of chats.slice(0, 8)) {
      try {
        const msgs = await withTimeout(chat.fetchMessages({ limit: 2 }), 4000, 'fetchMessages')
        for (const m of msgs) {
          if (!m.body) continue
          messages.push({ from: chat.name || m.from, body: m.body.slice(0, 300), timestamp: m.timestamp, isMe: m.fromMe })
        }
      } catch { /* skip chat that times out */ }
      if (messages.length >= limit) break
    }
    messages.sort((a, b) => b.timestamp - a.timestamp)
    return { ok: true, messages: messages.slice(0, limit) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erro ao ler mensagens' }
  }
}

// Envia mensagem directamente pelo objecto chat (evita o bug "No LID for user" do WA)
export async function sendViaWhatsAppByName(
  name: string,
  message: string,
): Promise<{ ok: boolean; phone?: string; error?: string }> {
  if (state !== 'ready' || !client) return { ok: false, error: 'WhatsApp não ligado.' }
  try {
    const chats = await withTimeout(client.getChats(), 8000, 'getChats-byName')
    const nameLower = name.toLowerCase().trim()
    for (const chat of chats) {
      if (chat.isGroup) continue
      const chatName = (chat.name || '').toLowerCase()
      if (chatName.includes(nameLower) || nameLower.includes(chatName.split(' ')[0])) {
        await withTimeout(chat.sendMessage(message), 10000, 'chat.sendMessage')
        const raw = (chat.id as any)?._serialized || ''
        const digits = raw.replace('@c.us', '').replace('@g.us', '').replace(/\D/g, '')
        return { ok: true, phone: digits ? '+' + digits : chat.name }
      }
    }
    return { ok: false, error: `Conversa com "${name}" não encontrada no WhatsApp.` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erro ao enviar' }
  }
}

// Procura o número de telefone de um contacto pelo nome (mantido para resolveContactPhone)
export async function findContactPhoneInWhatsApp(name: string): Promise<string | null> {
  if (state !== 'ready' || !client) return null
  try {
    const chats = await withTimeout(client.getChats(), 8000, 'getChats-find')
    const nameLower = name.toLowerCase().trim()
    for (const chat of chats) {
      if (chat.isGroup) continue
      const chatName = (chat.name || '').toLowerCase()
      if (chatName.includes(nameLower) || nameLower.includes(chatName.split(' ')[0])) {
        const raw = (chat.id as any)?._serialized || ''
        const digits = raw.replace('@c.us', '').replace('@g.us', '').replace(/\D/g, '')
        if (digits.length >= 7) return '+' + digits
      }
    }
    return null
  } catch { return null }
}

export function isWhatsAppWebConnected(): boolean {
  return state === 'ready' && !!client
}
