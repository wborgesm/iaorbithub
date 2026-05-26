// TikTok — Métricas de vídeo (módulo 75)
// API: business-api.tiktok.com/open_api/v1.3
// ENV: TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID

const BASE = 'https://business-api.tiktok.com/open_api/v1.3'

function getToken(): string { return process.env.TIKTOK_ACCESS_TOKEN || '' }
function getAdv(): string   { return process.env.TIKTOK_ADVERTISER_ID || '' }

interface TikTokEnvelope<T> {
  code:    number
  message: string
  data:    T
}

async function tiktokGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('TIKTOK_ACCESS_TOKEN não configurado')
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: {
      'Access-Token': token,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200)
    throw new Error(`TikTok API ${res.status}: ${body}`)
  }
  const data = await res.json() as TikTokEnvelope<T>
  if (data.code !== 0) throw new Error(`TikTok API error: ${data.message}`)
  return data.data
}

interface TikTokListResponse { list?: Array<Record<string, unknown>> }

export async function getTikTokCampaigns(dateStart: string, dateEnd: string): Promise<Array<Record<string, unknown>>> {
  const adv = getAdv()
  if (!adv) throw new Error('TIKTOK_ADVERTISER_ID não configurado')
  const r = await tiktokGet<TikTokListResponse>('/report/integrated/get/', {
    advertiser_id: adv,
    report_type:   'BASIC',
    data_level:    'AUCTION_CAMPAIGN',
    dimensions:    JSON.stringify(['campaign_id']),
    metrics:       JSON.stringify(['campaign_name', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversion', 'video_play_actions', 'video_watched_2s', 'video_watched_6s']),
    start_date:    dateStart,
    end_date:      dateEnd,
    page_size:     '20',
  })
  return r.list || []
}

export async function getTikTokVideoMetrics(dateStart: string, dateEnd: string): Promise<Array<Record<string, unknown>>> {
  const adv = getAdv()
  if (!adv) throw new Error('TIKTOK_ADVERTISER_ID não configurado')
  const r = await tiktokGet<TikTokListResponse>('/report/integrated/get/', {
    advertiser_id: adv,
    report_type:   'BASIC',
    data_level:    'AUCTION_AD',
    dimensions:    JSON.stringify(['ad_id']),
    metrics:       JSON.stringify(['ad_name', 'spend', 'impressions', 'video_play_actions', 'video_watched_2s', 'video_watched_6s', 'video_views_p50', 'video_views_p75', 'video_views_p100', 'profile_visits', 'clicks', 'ctr']),
    start_date:    dateStart,
    end_date:      dateEnd,
    page_size:     '30',
  })
  return r.list || []
}
