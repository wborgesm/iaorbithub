// Meta Ads — Campaign Commander (módulo 72)
// REST directo: graph.facebook.com/v18.0
// Token: META_ACCESS_TOKEN; conta: META_ADS_ACCOUNT_ID (act_XXXXXX)

const BASE = 'https://graph.facebook.com/v18.0'

function getToken(): string { return process.env.META_ACCESS_TOKEN || '' }
function getAct(): string { return process.env.META_ADS_ACCOUNT_ID || '' }

interface MetaResponse<T> { data?: T[] }

async function metaGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('META_ACCESS_TOKEN não configurado')
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Meta API ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

async function metaPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('META_ACCESS_TOKEN não configurado')
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('access_token', token)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Meta API POST ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export interface MetaCampaign {
  id:                string
  name:              string
  status:            string
  objective?:        string
  daily_budget?:     string
  lifetime_budget?:  string
  insights?:         { data?: Array<Record<string, unknown>> }
}

const INSIGHT_FIELDS = 'spend,impressions,clicks,ctr,cpc,reach,actions'

export async function getCampaigns(datePreset = 'last_7d'): Promise<MetaCampaign[]> {
  const act = getAct()
  if (!act) throw new Error('META_ADS_ACCOUNT_ID não configurado')
  const r = await metaGet<MetaResponse<MetaCampaign>>(`/${act}/campaigns`, {
    fields: `id,name,status,objective,daily_budget,lifetime_budget,insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
    limit:  '20',
  })
  return r.data || []
}

export async function pauseCampaign(campaignId: string): Promise<unknown> {
  return metaPost(`/${campaignId}`, { status: 'PAUSED' })
}

export async function resumeCampaign(campaignId: string): Promise<unknown> {
  return metaPost(`/${campaignId}`, { status: 'ACTIVE' })
}

export async function setCampaignBudget(campaignId: string, dailyBudgetCents: number): Promise<unknown> {
  return metaPost(`/${campaignId}`, { daily_budget: String(dailyBudgetCents) })
}

export interface MetaAdSet extends MetaCampaign {
  campaign_id?: string
  targeting?:   unknown
}

export async function getAdSets(campaignId?: string, datePreset = 'last_7d'): Promise<MetaAdSet[]> {
  const act = getAct()
  if (!act) throw new Error('META_ADS_ACCOUNT_ID não configurado')
  const path = campaignId ? `/${campaignId}/adsets` : `/${act}/adsets`
  const r = await metaGet<MetaResponse<MetaAdSet>>(path, {
    fields: `id,name,status,campaign_id,daily_budget,targeting,insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
    limit:  '30',
  })
  return r.data || []
}

export interface MetaAd extends MetaCampaign {
  adset_id?: string
  creative?: { title?: string; body?: string; image_url?: string }
}

export async function getAds(adSetId?: string, datePreset = 'last_7d'): Promise<MetaAd[]> {
  const act = getAct()
  if (!act) throw new Error('META_ADS_ACCOUNT_ID não configurado')
  const path = adSetId ? `/${adSetId}/ads` : `/${act}/ads`
  const r = await metaGet<MetaResponse<MetaAd>>(path, {
    fields: `id,name,status,adset_id,creative{title,body,image_url},insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
    limit:  '30',
  })
  return r.data || []
}

export async function pauseAd(adId: string): Promise<unknown> {
  return metaPost(`/${adId}`, { status: 'PAUSED' })
}

export async function resumeAd(adId: string): Promise<unknown> {
  return metaPost(`/${adId}`, { status: 'ACTIVE' })
}

// Helper: extrai métricas + leads de um insight Meta
export interface CampaignMetrics {
  spend_eur: string
  impressions: number
  clicks:    number
  ctr:       string
  cpc:       string
  reach:     number
  leads:     number
  cpl:       string
}

export function extractMetrics(insights: { data?: Array<Record<string, unknown>> } | undefined): CampaignMetrics {
  const ins = insights?.data?.[0] || {}
  const spend       = parseFloat(String(ins.spend       || '0'))
  const impressions = parseInt (String(ins.impressions || '0'))
  const clicks      = parseInt (String(ins.clicks      || '0'))
  const reach       = parseInt (String(ins.reach       || '0'))
  const ctr         = String(ins.ctr || '0')
  const cpc         = String(ins.cpc || '0')

  const actions = Array.isArray(ins.actions) ? ins.actions as Array<Record<string, string>> : []
  const leads = actions
    .filter(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead')
    .reduce((s, a) => s + parseInt(a.value || '0'), 0)

  return {
    spend_eur:   spend.toFixed(2),
    impressions,
    clicks,
    ctr:         parseFloat(ctr).toFixed(2) + '%',
    cpc:         '€' + parseFloat(cpc).toFixed(2),
    reach,
    leads,
    cpl:         leads > 0 ? '€' + (spend / leads).toFixed(2) : 'N/A',
  }
}
