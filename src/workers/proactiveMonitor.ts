import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { isGoogleConnected } from '../services/googleAuth'
import { readEmails } from '../services/gmailService'
import { listCalendarEvents } from '../services/calendarService'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { pushAlert } from '../modules/orbitAlerts'
import { sendTelegramNotification } from '../services/telegramNotify'
import { calculateSuspicionScore } from '../services/suspicionEngine'
import { getCurrentWeather } from '../services/weatherService'
import { callLLMAuto } from '../services/llm'
import { getRecentWhatsAppMessages as getRecentPersonal } from '../services/whatsappWeb'

const prisma = new PrismaClient()
const POLL_MS = 15 * 60 * 1000

async function getHash(key: string): Promise<string> {
  return (await getOrbitConfig(key)) || ''
}

async function setHash(key: string, value: string): Promise<void> {
  await setOrbitConfig(key, value)
}

async function checkEmailAlerts(): Promise<void> {
  if (!(await isGoogleConnected())) return
  try {
    const emails = await readEmails({ onlyUnread: true, limit: 10 })
    const fingerprint = emails.map(e => `${e.id}:${e.subject}`).join('|')
    const prev = await getHash('monitor_email_hash')
    if (fingerprint === prev) return
    await setHash('monitor_email_hash', fingerprint)

    if (emails.length === 0) return
    const top = emails.slice(0, 3).map(e => `• ${e.from}: ${e.subject}`).join('\n')
    await pushAlert({
      type: 'email',
      title: `${emails.length} email(s) não lido(s)`,
      body: top,
    })
  } catch (err) {
    console.warn('[proactiveMonitor] email:', (err as Error).message)
  }
}

async function checkCalendarAlerts(): Promise<void> {
  if (!(await isGoogleConnected())) return
  try {
    const events = await listCalendarEvents(1)
    const now = Date.now()
    const soon = events.filter(ev => {
      const start = new Date(ev.start).getTime()
      const diff = start - now
      return diff > 0 && diff <= 35 * 60 * 1000
    })
    if (soon.length === 0) return

    const fingerprint = soon.map(e => e.id).join(',')
    const prev = await getHash('monitor_cal_hash')
    if (fingerprint === prev) return
    await setHash('monitor_cal_hash', fingerprint)

    for (const ev of soon) {
      const t = new Date(ev.start).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
      await pushAlert({
        type: 'calendar',
        title: `Evento em breve: ${ev.title}`,
        body: `${t}${ev.location ? ` — ${ev.location}` : ''}`,
      })
    }
  } catch (err) {
    console.warn('[proactiveMonitor] calendar:', (err as Error).message)
  }
}

async function checkTaskDeadlines(): Promise<void> {
  try {
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const tasks = await prisma.orbitTask.findMany({
      where: {
        status:   { in: ['PENDING', 'IN_PROGRESS'] },
        deadline: { lte: in3Days, gte: new Date() },
      },
      orderBy: { deadline: 'asc' },
      take: 5,
    })
    if (!tasks.length) return

    const fingerprint = tasks.map(t => t.id + t.status).join('|')
    const prev = await getHash('monitor_task_hash')
    if (fingerprint === prev) return
    await setHash('monitor_task_hash', fingerprint)

    const lines = tasks.map(t => {
      const days = Math.ceil((t.deadline!.getTime() - Date.now()) / 86400000)
      return `• [${t.priority}] ${t.title} — ${days === 0 ? 'HOJE' : `em ${days} dia(s)`}`
    }).join('\n')

    await pushAlert({
      type: 'calendar',
      title: `${tasks.length} tarefa(s) com prazo próximo`,
      body: lines,
    })
  } catch (err) {
    console.warn('[proactiveMonitor] tasks:', (err as Error).message)
  }
}

async function checkContactFollowUps(): Promise<void> {
  try {
    const contacts = await prisma.orbitContact.findMany({
      where: { followUpAt: { lte: new Date() } },
      orderBy: { followUpAt: 'asc' },
      take: 3,
    })
    if (!contacts.length) return

    const fingerprint = contacts.map(c => c.id).join('|')
    const prev = await getHash('monitor_contacts_hash')
    if (fingerprint === prev) return
    await setHash('monitor_contacts_hash', fingerprint)

    const lines = contacts.map(c => `• ${c.name}${c.company ? ` (${c.company})` : ''}: ${c.context || 'sem contexto'}`).join('\n')
    await pushAlert({
      type: 'email',
      title: `${contacts.length} follow-up(s) em atraso`,
      body: lines,
    })
  } catch (err) {
    console.warn('[proactiveMonitor] contacts:', (err as Error).message)
  }
}

async function checkXiaomiCameras(): Promise<void> {
  try {
    const { getXiaomiCameras, snapshotViaRtsp } = await import('../services/xiaomiCameraService')
    const cameras = getXiaomiCameras()
    if (!cameras.length) return

    const offline: string[] = []
    for (const cam of cameras.filter(c => c.rtsp)) {
      const snap = await snapshotViaRtsp(cam.rtsp, 8)
      if (!snap) offline.push(cam.name)
    }

    if (!offline.length) return
    const fingerprint = offline.join('|')
    const prev = await getHash('monitor_cameras_hash')
    if (fingerprint === prev) return
    await setHash('monitor_cameras_hash', fingerprint)

    await pushAlert({
      type: 'system',
      title: `${offline.length} câmara(s) Xiaomi inacessível(is)`,
      body: offline.map(n => `• ${n}`).join('\n'),
      notifyHA: false,
      notifyTelegram: true,
    })
  } catch (err) {
    console.warn('[proactiveMonitor] xiaomi cameras:', (err as Error).message)
  }
}

let lastEndOfDayKey = ''

async function checkEndOfDay(): Promise<void> {
  const now = new Date()
  const lisbon = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', hour: 'numeric', minute: 'numeric', year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  }).formatToParts(now)
  const parts = Object.fromEntries(lisbon.map(p => [p.type, p.value]))
  const hour = parseInt(parts.hour, 10)
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`

  if (hour !== 22 || lastEndOfDayKey === dateKey) return
  lastEndOfDayKey = dateKey

  try {
    const pendingTasks = await prisma.orbitTask.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } })
    const urgentTasks = await prisma.orbitTask.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, priority: 'URGENTE' } })
    const doneTodayTasks = await prisma.orbitTask.count({
      where: { status: 'DONE', completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    })

    const lines = [
      `✅ Concluídas hoje: ${doneTodayTasks}`,
      `📋 Pendentes: ${pendingTasks}`,
      urgentTasks > 0 ? `🔴 Urgentes: ${urgentTasks}` : '🟢 Sem tarefas urgentes',
    ].join('\n')

    await pushAlert({
      type: 'system',
      title: 'Resumo ORBIT — fim do dia',
      body: lines,
      notifyHA: false,
      notifyTelegram: true,
    })
  } catch (err) {
    console.warn('[proactiveMonitor] endOfDay:', (err as Error).message)
  }
}

// ─── M36.1 Latência humana ──────────────────────────────────────────────────
// Cada ciclo de 15 min que detecta actividade conta como mais 15 min activo.
// Permite mais tarde inferir sobrecarga / disponibilidade de Wanderson.
async function trackHumanLatency(): Promise<void> {
  try {
    const now      = Date.now()
    const todayKey = `human_active_minutes_${new Date().toISOString().slice(0, 10)}`
    const existing = parseInt((await getOrbitConfig(todayKey)) || '0', 10)
    await setOrbitConfig(todayKey, String(existing + 15))
    await setOrbitConfig('human_last_active_ts', String(now))
  } catch { /* ignorar */ }
}

// ─── M32.4 Dispositivos offline em zona COM cobertura GSM ───────────────────
// Apenas funciona se a tabela gsm_towers + extensão earthdistance existir —
// envolvido em try/catch para falhar silenciosamente.
async function checkOfflineDevicesGSM(): Promise<void> {
  if (!process.env.AUTOTRACK_DATABASE_URL) return
  const tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
  try {
    const exists = await tracker.query(`SELECT to_regclass('gsm_towers') AS t`)
    if (!exists.rows[0]?.t) return

    const r = await tracker.query(`
      SELECT d.id, d.name, d.uniqueid, p.latitude, p.longitude, d.lastupdate
      FROM tc_devices d
      JOIN tc_positions p ON p.id = d.positionid
      WHERE d.disabled = false
        AND d.lastupdate < NOW() - INTERVAL '2 hours'
      LIMIT 10
    `)

    for (const dev of r.rows) {
      try {
        const towersR = await tracker.query(
          `SELECT signal_dbm
             FROM gsm_towers
             WHERE earth_box(ll_to_earth($1, $2), 2000) @> ll_to_earth(lat, lng)
             ORDER BY earth_distance(ll_to_earth($1, $2), ll_to_earth(lat, lng)) ASC
             LIMIT 5`,
          [dev.latitude, dev.longitude],
        )
        if (!towersR.rows.length) continue
        const bestSignal = Math.max(...towersR.rows.map((t: { signal_dbm: number | null }) => t.signal_dbm ?? -120))
        if (bestSignal > -85) {
          const fpKey = `gsm_offline_${dev.id}`
          const prev  = await getOrbitConfig(fpKey)
          const today = new Date().toISOString().slice(0, 10)
          if (prev === today) continue
          await setOrbitConfig(fpKey, today)

          const msg =
            `⚠️ *${dev.name}* offline há >2h em zona COM cobertura GSM.\n` +
            `Última posição: ${parseFloat(dev.latitude).toFixed(5)}, ${parseFloat(dev.longitude).toFixed(5)}\n` +
            `Possível: jammer, roubo, sabotagem ou falha de hardware.`
          await sendTelegramNotification(msg).catch(() => { /* ignorar */ })
        }
      } catch { /* skip device */ }
    }
  } catch {
    /* gsm_towers ou earthdistance inexistente */
  } finally {
    await tracker.end().catch(() => {})
  }
}

// ─── M35.3 Suspeita crítica em tempo real ───────────────────────────────────
async function checkHighSuspicion(): Promise<void> {
  if (!process.env.AUTOTRACK_DATABASE_URL) return
  const tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
  try {
    const active = await tracker.query(`
      SELECT id, name FROM tc_devices
      WHERE disabled = false
        AND lastupdate > NOW() - INTERVAL '15 minutes'
      LIMIT 30
    `)
    for (const dev of active.rows) {
      try {
        const r = await calculateSuspicionScore(dev.id, dev.name, tracker)
        if (r.score >= 80) {
          const fpKey = `suspicion_alerted_${dev.id}`
          const prev  = await getOrbitConfig(fpKey)
          const hourKey = new Date().toISOString().slice(0, 13) // por hora
          if (prev === hourKey) continue
          await setOrbitConfig(fpKey, hourKey)

          const msg =
            `🔴 *SUSPEITA CRÍTICA — ${dev.name}*\n` +
            `Score: ${r.score}/100\n` +
            r.factors.map(f => `• ${f.detail} (+${f.weight})`).join('\n') + '\n\n' +
            r.recommendation
          await sendTelegramNotification(msg).catch(() => { /* ignorar */ })
        }
      } catch { /* skip device */ }
    }
  } catch { /* ignorar */ } finally {
    await tracker.end().catch(() => {})
  }
}

// ─── M49.2 Clima vs falhas de dispositivos ──────────────────────────────────
async function correlateWeatherWithFailures(): Promise<void> {
  try {
    const weather = await getCurrentWeather()
    if (!weather) return

    await setOrbitConfig('current_weather', JSON.stringify(weather))

    if (weather.rain_mm > 5) {
      await setOrbitConfig('weather_high_risk', '1')
      await setOrbitConfig('weather_risk_reason', `Chuva ${weather.rain_mm}mm/h — GSM instável esperado`)
    } else if (weather.temp_c > 38) {
      await setOrbitConfig('weather_high_risk', '1')
      await setOrbitConfig('weather_risk_reason', `Calor extremo ${weather.temp_c}°C — risco de sobreaquecimento de baterias`)
    } else {
      await setOrbitConfig('weather_high_risk', '0')
    }
  } catch { /* ignorar */ }
}

// ─── M66 Lead Classifier — classifica conversas WhatsApp inbound ────────────
function sanitizeLeadKey(contact: string): string {
  return `lead_${contact.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80)}`
}

interface RecentMsg { from: string; body: string; timestamp: number; isMe: boolean }

async function readWhatsAppFor(label: 'PESSOAL' | 'NEGÓCIO'): Promise<RecentMsg[]> {
  try {
    if (label === 'PESSOAL') {
      const r = await getRecentPersonal(40)
      return r.ok && r.messages ? r.messages : []
    }
    if (process.env.WHATSAPP_BUSINESS_ENABLED !== 'true') return []
    const { getRecentWhatsAppMessages: getBusiness } = await import('../services/whatsappBusiness')
    const r = await getBusiness(40)
    return r.ok && r.messages ? r.messages : []
  } catch { return [] }
}

async function classifyContact(contact: string, msgs: RecentMsg[]): Promise<void> {
  if (!msgs.length) return
  const inbound = msgs.filter(m => !m.isMe).slice(-5)
  if (!inbound.length) return

  const lastInboundTs = inbound[inbound.length - 1].timestamp
  const key = sanitizeLeadKey(contact)
  const existingRaw = await getOrbitConfig(key)
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as { lastInboundTs?: number }
      if (existing.lastInboundTs && existing.lastInboundTs >= lastInboundTs) return
    } catch { /* re-classify */ }
  }

  const context = inbound.map(m => `- ${m.body.slice(0, 200)}`).join('\n')
  const prompt = `Analisa as seguintes mensagens recebidas no WhatsApp da empresa Rinosat (GPS para motos em Portugal):

"${context}"

Classifica este contacto numa destas categorias:
- URGENTE: moto roubada/em risco agora, precisa de solução IMEDIATA
- QUENTE: claramente quer comprar, perguntou preço ou instalação recentemente
- MORNO: interessado mas ainda a pensar, pediu informações
- FRIO: só curiosidade, sem intenção clara
- SUPORTE: já é cliente, tem problema técnico
- IGNORE: conversa pessoal sem relação com o negócio

Responde APENAS com JSON válido (sem markdown, sem comentários):
{"classification":"URGENTE|QUENTE|MORNO|FRIO|SUPORTE|IGNORE","reason":"1 frase curta","suggestedResponse":"resposta sugerida em 2 frases"}`

  try {
    const llmR = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
    const raw = (llmR.content || '').trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1) return
    const json = JSON.parse(raw.slice(start, end + 1)) as {
      classification?: string
      reason?: string
      suggestedResponse?: string
    }
    const classification = (json.classification || 'FRIO').toUpperCase()
    if (classification === 'IGNORE') return

    await setOrbitConfig(key, JSON.stringify({
      contact,
      classification,
      reason: json.reason || '',
      suggestedResponse: json.suggestedResponse || '',
      classifiedAt: new Date().toISOString(),
      lastInboundTs,
    }))

    if (classification === 'URGENTE' || classification === 'QUENTE') {
      const fpKey = `lead_alert_${sanitizeLeadKey(contact)}`
      const fpVal = `${classification}:${lastInboundTs}`
      const prev = await getOrbitConfig(fpKey)
      if (prev !== fpVal) {
        await setOrbitConfig(fpKey, fpVal)
        await pushAlert({
          type: 'system',
          title: `Lead ${classification}: ${contact}`,
          body: `${json.reason || ''}\nSugestão: "${json.suggestedResponse || ''}"`,
          notifyTelegram: true,
          vip: classification === 'URGENTE',
        })
      }
    }
  } catch (err) {
    console.warn('[leadClassifier]', (err as Error).message)
  }
}

async function classifyWhatsAppLeads(): Promise<void> {
  try {
    const personal = await readWhatsAppFor('PESSOAL')
    const business = await readWhatsAppFor('NEGÓCIO')
    const all = [...personal, ...business]
    if (!all.length) return

    const byContact = new Map<string, RecentMsg[]>()
    for (const m of all) {
      const list = byContact.get(m.from) || []
      list.push(m)
      byContact.set(m.from, list)
    }

    let classified = 0
    for (const [contact, list] of byContact) {
      if (classified >= 8) break
      await classifyContact(contact, list)
      classified++
    }
  } catch (err) {
    console.warn('[leadClassifier] cycle:', (err as Error).message)
  }
}

// ─── M70 Lead Reactivation — segunda 09:30 gera sequência de 3 mensagens ────
async function runLeadReactivation(): Promise<void> {
  try {
    const allLeadKeys = await prisma.systemConfig.findMany({
      where: { key: { startsWith: 'lead_' } },
    })

    const sevenDaysAgo = Date.now() - 7 * 86400000
    const coldLeads = allLeadKeys
      .map(k => {
        try {
          const parsed = JSON.parse(k.value) as {
            contact?: string
            classification?: string
            classifiedAt?: string
            reason?: string
          }
          return parsed && parsed.classification && parsed.classifiedAt
            ? { key: k.key, ...parsed }
            : null
        } catch { return null }
      })
      .filter((l): l is NonNullable<typeof l> => !!l)
      .filter(l =>
        (l.classification === 'MORNO' || l.classification === 'FRIO') &&
        new Date(l.classifiedAt!).getTime() < sevenDaysAgo,
      )

    if (!coldLeads.length) return

    const today = new Date().toISOString().slice(0, 10)
    let sent = 0
    for (const lead of coldLeads.slice(0, 5)) {
      const reactivationKey = `reactivation_${sanitizeLeadKey(lead.contact || '')}_${today}`
      const already = await getOrbitConfig(reactivationKey)
      if (already) continue

      const prompt = `Cria 3 mensagens WhatsApp curtas para reactivar um lead frio da Rinosat (GPS motos Portugal).
Lead: ${lead.contact}
Motivo do interesse original: ${lead.reason || 'não especificado'}

Mensagem 1 (hoje): Urgência/medo — "E se roubarem hoje?"
Mensagem 2 (em 3 dias): Prova social — caso real de recuperação
Mensagem 3 (em 7 dias): Oferta — "Instalação agendada esta semana"

Cada mensagem: máx 120 chars, tom conversacional WhatsApp, sem parecer spam.
Responde APENAS com um JSON array de 3 strings (sem markdown). Ex: ["msg1","msg2","msg3"]`

      try {
        const llmR = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        const raw = (llmR.content || '[]').trim()
        const startIdx = raw.indexOf('[')
        const endIdx = raw.lastIndexOf(']')
        if (startIdx === -1 || endIdx === -1) continue
        const messages = JSON.parse(raw.slice(startIdx, endIdx + 1)) as string[]
        if (!Array.isArray(messages) || messages.length === 0) continue

        await setOrbitConfig(reactivationKey, JSON.stringify({
          messages,
          contact: lead.contact,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
        }))

        await pushAlert({
          type: 'system',
          title: `Reactivação de lead: ${lead.contact}`,
          body: `Lead ${lead.classification} há > 7 dias. Sequência gerada:\n\n` +
            messages.map((m, i) => `${i + 1}. ${m}`).join('\n') +
            `\n\nUsa a tool sendLeadReactivation com contact="${lead.contact}" para disparar.`,
          notifyTelegram: true,
        })
        sent++
      } catch { /* skip lead */ }
    }
    if (sent > 0) console.log(`[leadReactivation] Sequências geradas: ${sent}`)
  } catch (err) {
    console.warn('[leadReactivation]', (err as Error).message)
  }
}

async function maybeRunLeadReactivation(): Promise<void> {
  const now = new Date()
  if (now.getDay() !== 1) return // segunda-feira
  const hour = now.getHours()
  const min = now.getMinutes()
  if (hour !== 9 || min < 30 || min >= 45) return

  const stamp = `${now.toISOString().slice(0, 10)}_${hour}`
  const last = await getOrbitConfig('lead_reactivation_last_run')
  if (last === stamp) return
  await setOrbitConfig('lead_reactivation_last_run', stamp)
  await runLeadReactivation()
}

async function runMonitorCycle(): Promise<void> {
  await checkEmailAlerts()
  await checkCalendarAlerts()
  await checkTaskDeadlines()
  await checkContactFollowUps()
  await checkXiaomiCameras()
  await checkEndOfDay()
  await trackHumanLatency()
  await checkOfflineDevicesGSM()
  await checkHighSuspicion()
  await correlateWeatherWithFailures()
  await classifyWhatsAppLeads()
  await maybeRunLeadReactivation()
}

export function startProactiveMonitor(): void {
  void runMonitorCycle()
  setInterval(() => { void runMonitorCycle() }, POLL_MS)
  console.log('[proactiveMonitor] Activo — ciclo a cada 15 min (email + calendário + alertas HA)')
}
