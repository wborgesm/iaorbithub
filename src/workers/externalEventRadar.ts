// External Event Radar — RSS de notícias diário às 07:00 (módulo 26)
// Inclui também o scan semanal de concorrentes (M68.2) à Segunda 08:00.
import { setOrbitConfig } from '../services/orbitConfig'
import { runCompetitorScan } from '../services/competitorMonitor'

interface NewsItem {
  title:   string
  link:    string
  pubDate: string
  source:  string
}

const RSS_FEEDS = [
  { url: 'https://feeds.feedburner.com/jornalnegociosonline',         source: 'Jornal Negócios' },
  { url: 'https://observador.pt/feed/',                                source: 'Observador' },
  { url: 'https://www.computerworld.com/feed/',                        source: 'ComputerWorld' },
  { url: 'https://www.theregister.com/security/headlines.atom',        source: 'The Register Security' },
]

const KEYWORDS = [
  'gps', 'rastreamento', 'rastreio', 'veículo', 'veicular',
  'furto', 'roubo', 'servidor', 'cyber', 'hack',
  'startup', 'portugal', 'lisboa', 'autotrack', 'rinosat',
]

async function fetchRSS(url: string, source: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const xml = await res.text()

    const items: NewsItem[] = []
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
    for (const match of itemMatches) {
      const content = match[1]
      const title   = content.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() || ''
      const link    = content.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || ''
      const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || ''
      if (title) items.push({ title, link, source, pubDate })
      if (items.length >= 5) break
    }
    return items
  } catch {
    return []
  }
}

export async function runRadar(): Promise<void> {
  const allNews: NewsItem[] = []
  for (const feed of RSS_FEEDS) {
    const items = await fetchRSS(feed.url, feed.source)
    allNews.push(...items)
  }

  if (!allNews.length) return

  const relevant = allNews.filter(n =>
    KEYWORDS.some(k => n.title.toLowerCase().includes(k)),
  )
  const digest = (relevant.length > 0 ? relevant : allNews.slice(0, 5))
    .map(n => `• [${n.source}] ${n.title}`)
    .join('\n')

  try {
    await setOrbitConfig('external_events_digest', digest)
    await setOrbitConfig('external_events_date', new Date().toISOString())
    console.log('[externalEventRadar] Digest actualizado com', allNews.length, 'notícias')
  } catch (err) {
    console.warn('[externalEventRadar] erro a guardar digest:', (err as Error).message)
  }
}

let lastRadarDate     = ''
let lastCompetitorKey = ''

export function startExternalEventRadar(): void {
  setInterval(async () => {
    const now    = new Date()
    const today  = now.toISOString().slice(0, 10)
    const hour   = now.getHours()
    const day    = now.getDay()

    // RSS diário às 07:00
    if (hour === 7 && lastRadarDate !== today) {
      lastRadarDate = today
      void runRadar()
    }

    // Competitor scan: segunda-feira às 08:00 (chave única por semana)
    const weekKey = `${today}_competitor`
    if (hour === 8 && day === 1 && lastCompetitorKey !== weekKey) {
      lastCompetitorKey = weekKey
      void runCompetitorScan()
    }
  }, 60 * 1000)
  console.log('[externalEventRadar] Activo — RSS 07:00 diário, concorrentes Segunda 08:00')
}
