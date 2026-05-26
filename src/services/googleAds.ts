// Google Ads — Performance e controlo (módulo 74)
// Wrapper minimalista sobre google-ads-api
// ENV: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//       GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID

type CustomerLike = { query: (q: string) => Promise<Array<Record<string, unknown>>> }
type ClientLike   = { Customer: (o: Record<string, string>) => CustomerLike }

let clientCache: ClientLike | null = null

async function getClient(): Promise<ClientLike> {
  if (clientCache) return clientCache
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''
  const cid = process.env.GOOGLE_ADS_CLIENT_ID       || ''
  const sec = process.env.GOOGLE_ADS_CLIENT_SECRET   || ''
  if (!dev || !cid || !sec) throw new Error('Google Ads: credenciais em falta (developer_token / client_id / client_secret)')

  const mod = (await import('google-ads-api')) as unknown as {
    GoogleAdsApi: new (o: { client_id: string; client_secret: string; developer_token: string }) => unknown
  }
  const client = new mod.GoogleAdsApi({
    client_id:       cid,
    client_secret:   sec,
    developer_token: dev,
  }) as unknown as ClientLike
  clientCache = client
  return client
}

function getCustomer(): Promise<CustomerLike> {
  return getClient().then(client => {
    const customerId  = (process.env.GOOGLE_ADS_CUSTOMER_ID  || '').replace(/-/g, '')
    const refreshTok  = process.env.GOOGLE_ADS_REFRESH_TOKEN || ''
    if (!customerId || !refreshTok) throw new Error('Google Ads: GOOGLE_ADS_CUSTOMER_ID ou GOOGLE_ADS_REFRESH_TOKEN em falta')
    return client.Customer({ customer_id: customerId, refresh_token: refreshTok })
  })
}

const VALID_RANGES = new Set(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'])

function safeRange(r: string): string {
  return VALID_RANGES.has(r) ? r : 'LAST_7_DAYS'
}

export interface GoogleCampaign {
  id:           string
  name:         string
  status:       string
  impressions:  number
  clicks:       number
  cost_eur:     string
  ctr:          string
  avg_cpc_eur:  string
  conversions:  number
}

export async function getGoogleCampaigns(dateRange = 'LAST_7_DAYS'): Promise<GoogleCampaign[]> {
  const customer = await getCustomer()
  const range = safeRange(dateRange)
  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions
    FROM campaign
    WHERE segments.date DURING ${range}
    ORDER BY metrics.cost_micros DESC
    LIMIT 20
  `)

  return rows.map((r) => {
    const m = (r.metrics  || {}) as Record<string, number>
    const c = (r.campaign || {}) as Record<string, unknown>
    return {
      id:          String(c.id || ''),
      name:        String(c.name || ''),
      status:      String(c.status || ''),
      impressions: Number(m.impressions || 0),
      clicks:      Number(m.clicks      || 0),
      cost_eur:    ((Number(m.cost_micros) || 0) / 1_000_000).toFixed(2),
      ctr:         ((Number(m.ctr)         || 0) * 100).toFixed(2) + '%',
      avg_cpc_eur: ((Number(m.average_cpc) || 0) / 1_000_000).toFixed(2),
      conversions: Number(m.conversions   || 0),
    }
  })
}

export interface GoogleKeyword {
  keyword:     string
  matchType:   string
  adGroup:     string
  clicks:      number
  impressions: number
  cost_eur:    string
  ctr:         string
  cpc_eur:     string
  conversions: number
  flag:        string
}

export async function getKeywordPerformance(campaignId?: string, dateRange = 'LAST_7_DAYS'): Promise<GoogleKeyword[]> {
  const customer = await getCustomer()
  const range = safeRange(dateRange)
  const safeCampaign = campaignId && /^\d+$/.test(campaignId) ? campaignId : ''
  const filter = safeCampaign ? `AND campaign.id = ${safeCampaign}` : ''
  const rows = await customer.query(`
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions
    FROM keyword_view
    WHERE segments.date DURING ${range}
      AND ad_group_criterion.status != 'REMOVED'
      ${filter}
    ORDER BY metrics.cost_micros DESC
    LIMIT 30
  `)

  return rows.map((r) => {
    const m = (r.metrics || {}) as Record<string, number>
    const k = (r.ad_group_criterion || {}) as Record<string, Record<string, string>>
    const ctrPct = (Number(m.ctr) || 0) * 100
    const cost   = (Number(m.cost_micros) || 0) / 1_000_000
    const clicks = Number(m.clicks)      || 0
    const conv   = Number(m.conversions) || 0
    let flag = ''
    if (clicks > 10 && ctrPct < 0.5) flag = '⚠️ CTR baixo'
    else if (cost > 10 && conv === 0) flag = '🔴 Gasto sem conversão'
    return {
      keyword:     String(k.keyword?.text       || ''),
      matchType:   String(k.keyword?.match_type || ''),
      adGroup:     String((r.ad_group as Record<string, string>)?.name || ''),
      clicks,
      impressions: Number(m.impressions || 0),
      cost_eur:    cost.toFixed(2),
      ctr:         ctrPct.toFixed(2) + '%',
      cpc_eur:     ((Number(m.average_cpc) || 0) / 1_000_000).toFixed(2),
      conversions: conv,
      flag,
    }
  })
}
