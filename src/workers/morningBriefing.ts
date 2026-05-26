import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { readEmails } from '../services/gmailService'
import { listCalendarEvents } from '../services/calendarService'
import { isGoogleConnected } from '../services/googleAuth'
import { getOrbitConfig, normalizeOrbitKey } from '../services/orbitConfig'
import { callLLMAuto } from '../services/llm'
import { sendViaWhatsAppWeb } from '../services/whatsappWeb'
import { sendTelegramNotification } from '../services/telegramNotify'

const prisma = new PrismaClient()

const ORBIT_DOMAIN = 'orbit.internal'
const SCHEDULE_HOUR = 8
const SCHEDULE_MINUTE = 30

let lastRunDateKey = ''

function lisbonNow(): { hour: number; minute: number; dateKey: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon',
      hour: 'numeric',
      minute: 'numeric',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    }).formatToParts(new Date()).map(p => [p.type, p.value]),
  )
  return {
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

async function setOrbitConfig(key: string, value: string): Promise<void> {
  const fullKey = normalizeOrbitKey(key)
  await prisma.systemConfig.upsert({
    where: { key: fullKey },
    update: { value },
    create: { key: fullKey, value },
  })
}

export async function generateMorningBriefing(): Promise<string | null> {
  const site = await prisma.aISite.findFirst({ where: { domain: ORBIT_DOMAIN } })
  if (!site) return null

  const lines: string[] = []
  const { dateKey } = lisbonNow()
  lines.push(`Briefing ORBIT — ${dateKey}`)
  lines.push('')

  if (await isGoogleConnected()) {
    try {
      const emails = await readEmails({ onlyUnread: true, limit: 5 })
      if (emails.length === 0) {
        lines.push('📧 Email: sem mensagens não lidas importantes.')
      } else {
        lines.push(`📧 Email: ${emails.length} não lido(s):`)
        for (const e of emails) {
          lines.push(`  • ${e.from} — ${e.subject}`)
        }
      }
    } catch (err) {
      lines.push(`📧 Email: não foi possível ler (${(err as Error).message})`)
    }

    try {
      const events = await listCalendarEvents(1)
      const today = new Date()
      const todayEvents = events.filter(ev => {
        const start = new Date(ev.start)
        return start.getFullYear() === today.getFullYear()
          && start.getMonth() === today.getMonth()
          && start.getDate() === today.getDate()
      })
      if (todayEvents.length === 0) {
        lines.push('📅 Calendário: sem eventos hoje.')
      } else {
        lines.push(`📅 Calendário: ${todayEvents.length} evento(s) hoje:`)
        for (const ev of todayEvents) {
          const t = new Date(ev.start).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
          lines.push(`  • ${t} — ${ev.title}`)
        }
      }
    } catch (err) {
      lines.push(`📅 Calendário: não foi possível ler (${(err as Error).message})`)
    }
  } else {
    lines.push('Google não ligado — briefing limitado.')
  }

  // Tarefas prioritárias
  try {
    const tasks = await prisma.orbitTask.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, priority: { in: ['URGENTE', 'IMPORTANTE'] } },
      orderBy: [{ priority: 'asc' }, { deadline: 'asc' }],
      take: 5,
    })
    if (tasks.length === 0) {
      lines.push('✅ Tarefas: nenhuma urgente ou importante pendente.')
    } else {
      lines.push(`📋 Top ${tasks.length} tarefa(s) prioritária(s):`)
      for (const t of tasks) {
        const dl = t.deadline ? ` — prazo ${t.deadline.toLocaleDateString('pt-PT')}` : ''
        lines.push(`  • [${t.priority}] ${t.title}${dl}`)
      }
    }
  } catch {
    lines.push('📋 Tarefas: erro ao obter.')
  }

  // Follow-ups pendentes
  try {
    const contacts = await prisma.orbitContact.findMany({
      where: { followUpAt: { lte: new Date() } },
      orderBy: { followUpAt: 'asc' },
      take: 3,
    })
    if (contacts.length > 0) {
      lines.push(`👤 Follow-up(s) em atraso (${contacts.length}):`)
      for (const c of contacts) {
        lines.push(`  • ${c.name}${c.company ? ` (${c.company})` : ''}: ${c.context || 'pendente'}`)
      }
    }
  } catch { /* ignorar */ }

  // Google Fit — dados de ontem
  if (await isGoogleConnected()) {
    try {
      const { getFitSleep, getFitSteps } = await import('../services/fitService')
      const [sleepData, stepsData] = await Promise.all([getFitSleep(1), getFitSteps(1)])
      const sleep = sleepData[sleepData.length - 1]
      const steps = stepsData[stepsData.length - 1]
      const parts: string[] = []
      if (sleep?.durationHours) parts.push(`sono: ${sleep.durationHours}h`)
      if (steps?.steps) parts.push(`passos: ${steps.steps.toLocaleString('pt-PT')}`)
      if (parts.length > 0) lines.push(`⌚ Apple Watch (ontem): ${parts.join(' | ')}`)
    } catch { /* ignorar */ }
  }

  // Eventos externos (M26) e concorrentes (M68)
  try {
    const externalDigest = await getOrbitConfig('external_events_digest')
    if (externalDigest) lines.push(`\n📰 Radar externo:\n${externalDigest}`)
  } catch { /* ignorar */ }

  try {
    const competitorDigest = await getOrbitConfig('competitor_ads_digest')
    if (competitorDigest) lines.push(`\n📣 Anúncios concorrentes:\n${competitorDigest}`)
  } catch { /* ignorar */ }

  // M64.1 Missões de marketing
  const marketingSection = await generateMarketingMissions()
  if (marketingSection) lines.push(marketingSection)

  // M71.1 Executive summary
  const executiveSummary = await generateExecutiveSummary()
  if (executiveSummary) lines.push(executiveSummary)

  const text = lines.join('\n')
  await setOrbitConfig('morning_briefing', text)
  await setOrbitConfig('morning_briefing_date', dateKey)
  console.log('[morningBriefing] Briefing gerado:', dateKey)
  return text
}

// ─── M64.1 Missões de marketing ─────────────────────────────────────────────
async function generateMarketingMissions(): Promise<string> {
  try {
    if (!process.env.AUTOTRACK_DATABASE_URL) return ''
    const tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
    let recovRows: Array<{ name: string }> = []
    try {
      const recovR = await tracker.query(`
        SELECT d.name, e.servertime,
               p.latitude, p.longitude
        FROM tc_events e
        JOIN tc_devices d ON d.id = e.deviceid
        LEFT JOIN tc_positions p ON p.id = d.positionid
        WHERE e.servertime > NOW() - INTERVAL '24 hours'
          AND e.type = 'alarm'
          AND e.attributes->>'alarm' IN ('sos','movement')
        LIMIT 5
      `)
      recovRows = recovR.rows
    } catch { /* tabela inacessível */ }
    await tracker.end().catch(() => {})

    const waMsgs = await getOrbitConfig('whatsapp_context_week')

    const context = `
Recuperações/alarmes últimas 24h: ${recovRows.length} eventos
${recovRows.length > 0 ? 'Dispositivos: ' + recovRows.map(r => r.name).join(', ') : ''}
Actividade WhatsApp recente: ${waMsgs ? 'disponível' : 'sem dados'}`

    const prompt = `Negócio: Rinosat — rastreamento GPS para motos em Portugal.
Dados de hoje: ${context}

Cria 3 MISSÕES DE MARKETING concretas e accionáveis para hoje.
Cada missão deve ser específica e usar dados reais quando disponíveis.
Formato: número, título curto, acção em 1 frase, exemplo de conteúdo real.
Responde em português.`

    const llmR = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
    return `\n📣 *Missões de Marketing — Hoje:*\n${llmR.content || 'Sem missões geradas.'}`
  } catch {
    return ''
  }
}

// ─── M71.1 Executive summary ────────────────────────────────────────────────
async function generateExecutiveSummary(): Promise<string> {
  try {
    if (!process.env.AUTOTRACK_DATABASE_URL) return ''

    const tracker   = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })

    let activeDevices = 0, totalDevices = 0, alarmCnt = 0, offlineCnt = 0
    let overdueCnt = 0, debt = 0
    try {
      const devR = await tracker.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE lastupdate > NOW() - INTERVAL '24 hours') AS active
         FROM tc_devices WHERE disabled = false`,
      )
      totalDevices  = parseInt(devR.rows[0].total)  || 0
      activeDevices = parseInt(devR.rows[0].active) || 0

      const alarmR = await tracker.query(
        `SELECT COUNT(*) AS cnt FROM tc_events
         WHERE servertime > NOW() - INTERVAL '24 hours' AND type = 'alarm'`,
      )
      alarmCnt = parseInt(alarmR.rows[0].cnt) || 0

      const offlineR = await tracker.query(
        `SELECT COUNT(*) AS cnt FROM tc_devices
         WHERE disabled = false AND lastupdate < NOW() - INTERVAL '4 hours'`,
      )
      offlineCnt = parseInt(offlineR.rows[0].cnt) || 0

      try {
        const invR = await tracker.query(
          `SELECT COUNT(*) AS overdue,
                  COALESCE(SUM(amount_due - amount_paid), 0) AS debt
           FROM billing_invoice
           WHERE status = 'open' AND due_date < NOW()`,
        )
        overdueCnt = parseInt(invR.rows[0].overdue) || 0
        debt       = parseFloat(invR.rows[0].debt)   || 0
      } catch { /* sem tabela billing */ }
    } catch { /* sem tracker */ } finally {
      await tracker.end().catch(() => {})
    }

    const urgentTasks = await prisma.orbitTask.count({
      where: { status: { not: 'DONE' }, priority: 'URGENTE' },
    }).catch(() => 0)

    const hotLeads = await prisma.systemConfig.count({
      where: {
        key:   { startsWith: 'lead_' },
        value: { contains: 'QUENTE' },
      },
    }).catch(() => 0)

    const metrics = `
Dispositivos activos: ${activeDevices}/${totalDevices}
Alarmes 24h: ${alarmCnt}
Dispositivos offline >4h: ${offlineCnt}
Facturas em atraso: ${overdueCnt} (€${debt.toFixed(0)})
Tarefas urgentes: ${urgentTasks}
Leads quentes: ${hotLeads}`

    const prompt = `És o ORBIT — director de operações e crescimento da Rinosat (GPS motos Portugal).

Estado actual do negócio:
${metrics}

Com base nestes dados, entrega 5 directivas executivas para hoje:
1. OPERAÇÃO: acção imediata mais importante
2. CLIENTES: cliente/lead prioritário a contactar
3. MARKETING: acção de conteúdo ou campanha para hoje
4. FINANCEIRO: acção sobre receita ou custos
5. CRESCIMENTO: uma alavanca estratégica a activar esta semana

Tom: director executivo, directo, accionável. Sem introduções. Sem "considere". Directivas concretas.
Responde em português.`

    const llmR = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
    return `\n\n🎯 *ORBIT Executive — Directivas de Hoje:*\n${llmR.content || ''}`
  } catch {
    return ''
  }
}

async function tick(): Promise<void> {
  const { hour, minute, dateKey } = lisbonNow()
  if (hour !== SCHEDULE_HOUR || minute !== SCHEDULE_MINUTE) return
  if (lastRunDateKey === dateKey) return

  const stored = await getOrbitConfig('morning_briefing_date')
  if (stored === dateKey) {
    lastRunDateKey = dateKey
    return
  }

  lastRunDateKey = dateKey
  try {
    await generateMorningBriefing()
  } catch (err) {
    console.error('[morningBriefing] Erro:', err)
    lastRunDateKey = ''
  }
}

export function startMorningBriefingScheduler(): void {
  void tick()
  setInterval(() => { void tick() }, 60 * 1000)
  console.log('[morningBriefing] Scheduler activo (08:30 Europe/Lisbon)')
}

// ─── M52 Night Briefing (22:00) ─────────────────────────────────────────────
async function sendOrbitMessage(text: string): Promise<void> {
  try {
    const owner = (await getOrbitConfig('owner_whatsapp')).trim()
    if (owner) {
      const r = await sendViaWhatsAppWeb(owner, text)
      if (r.ok) return
    }
  } catch { /* tenta fallback */ }
  try {
    const sent = await sendTelegramNotification(text)
    if (sent) return
  } catch { /* tenta fallback */ }
  console.log('[nightBriefing] (sem destino configurado)\n' + text)
}

async function sendNightBriefing(): Promise<void> {
  try {
    const lines: string[] = ['🌙 *Resumo do dia — ORBIT*', '']

    const tasksDone = await prisma.orbitTask.count({
      where: {
        status:    'DONE',
        updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }).catch(() => 0)
    lines.push(`✅ Tarefas concluídas hoje: ${tasksDone}`)

    const urgent = await prisma.orbitTask.count({
      where: { status: { not: 'DONE' }, priority: 'URGENTE' },
    }).catch(() => 0)
    if (urgent > 0) lines.push(`🔴 Tarefas urgentes em aberto: ${urgent}`)

    if (process.env.AUTOTRACK_DATABASE_URL) {
      const tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
      try {
        const evR = await tracker.query(`
          SELECT type, COUNT(*) AS cnt FROM tc_events
          WHERE servertime > NOW() - INTERVAL '24 hours'
            AND type IN ('alarm','deviceOffline','geofenceExit')
          GROUP BY type
        `)
        for (const ev of evR.rows) {
          lines.push(`📡 ${ev.type}: ${ev.cnt} eventos hoje`)
        }
      } catch { /* sem tracker */ } finally {
        await tracker.end().catch(() => {})
      }
    }

    const crisisMode = await getOrbitConfig('orbit_crisis_mode')
    if (crisisMode === '1') {
      const reason = await getOrbitConfig('orbit_crisis_reason')
      lines.push(`🔴 Modo crise activo: ${reason}`)
    } else {
      lines.push('🟢 Sem crises activas')
    }

    try {
      const weatherRaw = await getOrbitConfig('current_weather')
      if (weatherRaw) {
        const w = JSON.parse(weatherRaw)
        lines.push(`\n🌤️ Clima actual: ${w.description}, ${w.temp_c}°C`)
      }
    } catch { /* ignorar */ }

    lines.push('\nBoa noite. 🌙')

    await sendOrbitMessage(lines.join('\n'))
  } catch (err) {
    console.error('[nightBriefing] Erro:', (err as Error).message)
  }
}

let nightBriefingDone = ''

export function startNightBriefingScheduler(): void {
  setInterval(async () => {
    const { hour, minute, dateKey } = lisbonNow()
    if (hour === 22 && minute < 2 && nightBriefingDone !== dateKey) {
      nightBriefingDone = dateKey
      try { await sendNightBriefing() } catch (err) {
        console.error('[nightBriefing] erro:', (err as Error).message)
      }
    }
  }, 60 * 1000)
  console.log('[nightBriefing] Scheduler activo (22:00 Europe/Lisbon)')
}

// ─── M42 — AutoTrain semanal (Domingo 23:00 Europe/Lisbon) ───────────────────
async function runWeeklyAutoTrain(): Promise<void> {
  try {
    const site = await prisma.aISite.findFirst({ where: { domain: ORBIT_DOMAIN } })
    if (!site) {
      console.warn('[weeklyAutoTrain] orbit.internal não encontrado — skip')
      return
    }

    const port = process.env.PORT || '3002'
    const url = `http://127.0.0.1:${port}/api/simulation/batch-train`
    const body = {
      siteId:       site.id,
      simulationType: 'SUPORTE',
      totalRuns:    5,
      roundsPerRun: 4,
      promoteThreshold: 95,
    }

    console.log(`[weeklyAutoTrain] A disparar batch-train (siteId=${site.id})`)
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok || !res.body) {
      console.warn(`[weeklyAutoTrain] batch-train HTTP ${res.status}`)
      return
    }

    // Consumir o stream SSE silenciosamente até terminar
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let promoted = false
    let bestScore = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = dec.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const ev = JSON.parse(line.slice(6)) as { status?: string; score?: number; avgScore?: number }
          if (ev.status === 'promoted') promoted = true
          if (typeof ev.score === 'number' && ev.score > bestScore) bestScore = ev.score
          if (typeof ev.avgScore === 'number' && ev.avgScore > bestScore) bestScore = ev.avgScore
        } catch { /* ignore */ }
      }
    }
    console.log(`[weeklyAutoTrain] Concluído — bestScore=${bestScore}, promoted=${promoted}`)
  } catch (err) {
    console.error('[weeklyAutoTrain] erro:', (err as Error).message)
  }
}

let weeklyAutoTrainDone = ''

export function startWeeklyAutoTrainScheduler(): void {
  setInterval(() => {
    const now = new Date()
    const lisbonParts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Lisbon',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour12: false,
      }).formatToParts(now).map(p => [p.type, p.value]),
    )
    const weekday = String(lisbonParts.weekday || '').toLowerCase() // sun, mon, ...
    const hour = parseInt(String(lisbonParts.hour || '0'), 10)
    const minute = parseInt(String(lisbonParts.minute || '0'), 10)
    const dateKey = `${lisbonParts.year}-${lisbonParts.month}-${lisbonParts.day}`

    if (weekday === 'sun' && hour === 23 && minute < 2 && weeklyAutoTrainDone !== dateKey) {
      weeklyAutoTrainDone = dateKey
      void runWeeklyAutoTrain()
    }
  }, 60 * 1000)
  console.log('[weeklyAutoTrain] Scheduler activo (Dom 23:00 Europe/Lisbon — batch 5 sessões)')
}
