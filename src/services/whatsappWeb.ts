import path from 'path'
import fs from 'fs'
import QRCode from 'qrcode'
import { Client, LocalAuth } from 'whatsapp-web.js'

export type WhatsAppWebState = 'idle' | 'qr' | 'connecting' | 'ready' | 'error'

const SESSION_DIR = path.join(process.cwd(), 'data', 'orbit-personal-whatsapp')
const CLIENT_ID = 'orbit-jarvis-wanderson'

let client: Client | null = null
let state: WhatsAppWebState = 'idle'
let qrDataUrl: string | null = null
let phone: string | null = null
let lastError: string | null = null
let starting: Promise<void> | null = null

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
  })

  c.on('ready', () => {
    state = 'ready'
    qrDataUrl = null
    lastError = null
    phone = c.info?.wid?.user ?? null
    console.log(`[whatsappWeb:orbit-personal] Ligado${phone ? ` (+${phone})` : ''}`)
  })

  c.on('auth_failure', (msg: string) => {
    state = 'error'
    lastError = msg || 'Falha de autenticação'
    console.error('[whatsappWeb] auth_failure:', lastError)
  })

  c.on('disconnected', (reason: string) => {
    console.warn('[whatsappWeb] Desligado:', reason)
    state = 'idle'
    qrDataUrl = null
    phone = null
    client = null
    starting = null
  })
}

export async function startWhatsAppWeb(): Promise<void> {
  if (state === 'ready' && client) return
  if (starting) return starting

  starting = (async () => {
    if (client) return
    state = 'connecting'
    lastError = null
    client = buildClient()
    attachListeners(client)
    try {
      await client.initialize()
    } catch (err) {
      state = 'error'
      lastError = err instanceof Error ? err.message : 'Erro ao iniciar WhatsApp Web'
      client = null
      starting = null
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

export async function disconnectWhatsAppWeb(): Promise<void> {
  if (!client) {
    state = 'idle'
    qrDataUrl = null
    phone = null
    starting = null
    return
  }
  try {
    await client.logout()
  } catch { /* ignore */ }
  try {
    await client.destroy()
  } catch { /* ignore */ }
  client = null
  state = 'idle'
  qrDataUrl = null
  phone = null
  starting = null
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true })
  } catch { /* ignore */ }
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

export function isWhatsAppWebConnected(): boolean {
  return state === 'ready' && !!client
}
