import { isGoogleConnected } from '../services/googleAuth'
import { readEmails } from '../services/gmailService'
import { listCalendarEvents } from '../services/calendarService'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { pushAlert } from '../modules/orbitAlerts'

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

async function runMonitorCycle(): Promise<void> {
  await checkEmailAlerts()
  await checkCalendarAlerts()
}

export function startProactiveMonitor(): void {
  void runMonitorCycle()
  setInterval(() => { void runMonitorCycle() }, POLL_MS)
  console.log('[proactiveMonitor] Activo — ciclo a cada 15 min (email + calendário + alertas HA)')
}
