import { PrismaClient } from '@prisma/client'
import { readEmails } from '../services/gmailService'
import { listCalendarEvents } from '../services/calendarService'
import { isGoogleConnected } from '../services/googleAuth'
import { getOrbitConfig, normalizeOrbitKey } from '../services/orbitConfig'

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

  const text = lines.join('\n')
  await setOrbitConfig('morning_briefing', text)
  await setOrbitConfig('morning_briefing_date', dateKey)
  console.log('[morningBriefing] Briefing gerado:', dateKey)
  return text
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
