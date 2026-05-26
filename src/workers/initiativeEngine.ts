import { PrismaClient } from '@prisma/client'
import { listCalendarEvents } from '../services/calendarService'
import { isGoogleConnected } from '../services/googleAuth'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { listUpcomingFacts } from '../modules/agenticMemory'
import { pushAlert } from '../modules/orbitAlerts'
import { fetchTripWeather, MADRID_COORDS } from '../services/weatherService'

const prisma = new PrismaClient()
const ORBIT_DOMAIN = 'orbit.internal'
const POLL_MS = 6 * 60 * 60 * 1000
const REMIND_DAYS = [14, 7, 1]

function tripDays(startDate: string, endDate: string): number {
  const a = new Date(startDate + 'T12:00:00').getTime()
  const b = new Date(endDate + 'T12:00:00').getTime()
  return Math.max(1, Math.ceil((b - a) / 86400000) + 1)
}

function buildPackingChecklist(days: number): string[] {
  const base = ['Documento ID/passaporte', 'Carregadores', 'Medicamentos habituais']
  if (days <= 2) return [...base, '1 roupa extra', 'Higiene pessoal (kit viagem)']
  if (days <= 5) return [...base, `${days} mudas de roupa`, 'Casaco leve', 'Sapatos confortáveis', 'Powerbank']
  return [...base, `${days} mudas`, 'Casaco + chuva', '2 pares sapatos', 'Powerbank', 'Mochila daypack']
}

async function buildTripPayload(
  title: string,
  startDate: string,
  endDate: string,
  location?: string,
): Promise<{ json: Record<string, unknown>; text: string }> {
  const coords = tripCoords(title, location)
  const days = tripDays(startDate, endDate)
  const checklist = buildPackingChecklist(days)
  let weather: unknown[] = []

  if (coords) {
    const wx = await fetchTripWeather(coords.lat, coords.lon, startDate, endDate, coords.label)
    if (wx.ok) weather = wx.days
  }

  const json = {
    trip: title,
    startDate,
    endDate,
    days,
    location: location || coords?.label || null,
    weather,
    checklist,
  }

  const lines = [
    `Viagem: ${title}`,
    `Datas: ${startDate}${endDate !== startDate ? ` → ${endDate}` : ''} (${days}d)`,
  ]
  if (weather.length) {
    lines.push('Tempo:')
    for (const d of weather as Array<{ date: string; summary: string; tempMin: number; tempMax: number }>) {
      lines.push(`• ${d.date}: ${d.summary}, ${d.tempMin}–${d.tempMax}°C`)
    }
  }
  lines.push('Mala:', ...checklist.map(c => `• ${c}`))
  lines.push('', 'Responde no ORBIT: "confirmar briefing viagem" para receber no WhatsApp.')

  return { json, text: lines.join('\n') }
}

async function queueTripWhatsApp(payload: Record<string, unknown>, text: string): Promise<void> {
  await setOrbitConfig('trip_wa_pending', JSON.stringify({ payload, message: text }))
}

async function getOrbitSiteId(): Promise<string | null> {
  const site = await prisma.aISite.findFirst({ where: { domain: ORBIT_DOMAIN } })
  return site?.id ?? null
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T12:00:00')
  const now = new Date()
  const diff = target.getTime() - now.getTime()
  return Math.ceil(diff / 86400000)
}

function lisbonDateKey(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map(p => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

async function alreadySent(key: string): Promise<boolean> {
  return (await getOrbitConfig(key)) === lisbonDateKey()
}

async function markSent(key: string): Promise<void> {
  await setOrbitConfig(key, lisbonDateKey())
}

function tripCoords(title: string, location?: string): { lat: number; lon: number; label: string } | null {
  const t = `${title} ${location || ''}`.toLowerCase()
  if (t.includes('madrid') || t.includes('warner')) return MADRID_COORDS
  return null
}

async function buildTripBrief(title: string, startDate: string, endDate: string, location?: string): Promise<string> {
  const { text } = await buildTripPayload(title, startDate, endDate, location)
  return text
}

async function checkFactTrips(siteId: string): Promise<void> {
  const facts = await listUpcomingFacts(siteId, 14)
  for (const f of facts) {
    const days = daysUntil(f.dueDate)
    if (!REMIND_DAYS.includes(days)) continue
    const key = `initiative_fact_${f.id}_${days}d`
    if (await alreadySent(key)) continue

    const { json, text } = await buildTripPayload(f.content, f.dueDate, f.dueDate)
    await queueTripWhatsApp(json, text)
    await pushAlert({
      type: 'system',
      title: `Viagem em ${days} dia(s): ${f.content.slice(0, 50)}`,
      body: text,
      notifyHA: false,
      notifyTelegram: true,
    })
    await markSent(key)
  }
}

async function checkCalendarTrips(siteId: string): Promise<void> {
  if (!(await isGoogleConnected())) return
  const events = await listCalendarEvents(30)
  const now = Date.now()

  for (const ev of events) {
    const start = new Date(ev.start)
    const startKey = start.toISOString().slice(0, 10)
    const days = daysUntil(startKey)
    if (days < 0 || days > 14) continue

    const label = `${ev.title} ${ev.location || ''}`.toLowerCase()
    const isTrip = label.includes('madrid') || label.includes('viagem') || label.includes('warner') || label.includes('hotel')
    if (!isTrip) continue
    if (!REMIND_DAYS.includes(days)) continue

    const key = `initiative_cal_${ev.id}_${days}d`
    if (await alreadySent(key)) continue

    const endKey = new Date(ev.end).toISOString().slice(0, 10)
    const { json, text } = await buildTripPayload(ev.title, startKey, endKey, ev.location)
    await queueTripWhatsApp(json, text)
    await pushAlert({
      type: 'calendar',
      title: `Viagem/evento em ${days} dia(s): ${ev.title}`,
      body: text,
      notifyHA: false,
      notifyTelegram: true,
    })
    await markSent(key)
  }
}

async function runInitiativeCycle(): Promise<void> {
  const siteId = await getOrbitSiteId()
  if (!siteId) return
  await checkFactTrips(siteId)
  await checkCalendarTrips(siteId)
}

export function startInitiativeEngine(): void {
  void runInitiativeCycle()
  setInterval(() => { void runInitiativeCycle() }, POLL_MS)
  console.log('[initiativeEngine] Activo — viagens 14/7/1 dias + clima + checklist (WA com confirmação)')
}
