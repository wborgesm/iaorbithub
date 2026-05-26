// Competitor Monitor — Inteligência sobre anúncios de concorrentes (módulo 68)
// Consulta Meta Ad Library API para detectar campanhas de concorrentes em PT.
import { setOrbitConfig } from './orbitConfig'

const META_ACCESS_TOKEN = process.env.META_ADS_TOKEN || ''

const COMPETITOR_KEYWORDS = [
  'rastreamento moto',
  'gps moto portugal',
  'tracker moto',
  'seguro moto gps',
]

interface AdResult {
  id:                       string
  page_name:                string
  ad_creative_body?:        string
  ad_delivery_start_time?:  string
  ad_snapshot_url?:         string
}

export async function scanCompetitorAds(): Promise<AdResult[]> {
  if (!META_ACCESS_TOKEN) {
    console.log('[competitorMonitor] META_ADS_TOKEN não configurado — skipping')
    return []
  }

  const allAds: AdResult[] = []

  for (const keyword of COMPETITOR_KEYWORDS) {
    try {
      const url = new URL('https://graph.facebook.com/v18.0/ads_archive')
      url.searchParams.set('ad_type', 'ALL')
      url.searchParams.set('ad_reached_countries', '["PT"]')
      url.searchParams.set('search_terms', keyword)
      url.searchParams.set('fields', 'id,page_name,ad_creative_body,ad_delivery_start_time,ad_snapshot_url')
      url.searchParams.set('limit', '10')
      url.searchParams.set('access_token', META_ACCESS_TOKEN)

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue

      const data = await res.json() as { data?: AdResult[] }
      if (data.data) allAds.push(...data.data)
    } catch { /* ignorar timeout ou erro */ }
  }

  return allAds
}

export async function runCompetitorScan(): Promise<void> {
  const ads = await scanCompetitorAds()
  if (!ads.length) return

  const digest = ads.slice(0, 10).map(a =>
    `• [${a.page_name}] ${(a.ad_creative_body || 'sem texto').slice(0, 100)}`,
  ).join('\n')

  await setOrbitConfig('competitor_ads_digest', digest)
  await setOrbitConfig('competitor_ads_date',  new Date().toISOString())
  await setOrbitConfig('competitor_ads_count', String(ads.length))

  console.log(`[competitorMonitor] ${ads.length} anúncios de concorrentes encontrados`)
}
