// Instagram Graph API — análise de comentários e performance (módulo 73)
// Token: META_ACCESS_TOKEN; conta: INSTAGRAM_BUSINESS_ACCOUNT_ID

const BASE = 'https://graph.facebook.com/v18.0'

function getToken(): string { return process.env.META_ACCESS_TOKEN || '' }
function getIgId(): string { return process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '' }

interface IgResponse<T> { data?: T[] }

async function igGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('META_ACCESS_TOKEN não configurado')
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Instagram API ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

async function igPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
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
    throw new Error(`Instagram POST ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export interface IgMedia {
  id:             string
  caption?:       string
  media_type?:    string
  media_url?:     string
  permalink?:     string
  timestamp?:     string
  like_count?:    number
  comments_count?: number
  insights?:      { data?: Array<Record<string, unknown>> }
}

export interface IgComment {
  id:        string
  text:      string
  username?: string
  timestamp?: string
  like_count?: number
  replies?:  { data?: IgComment[] }
}

export async function getRecentMedia(limit = 10): Promise<IgMedia[]> {
  const ig = getIgId()
  if (!ig) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID não configurado')
  const r = await igGet<IgResponse<IgMedia>>(`/${ig}/media`, {
    fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
    limit:  String(limit),
  })
  return r.data || []
}

export async function getMediaInsights(mediaId: string): Promise<Record<string, unknown>> {
  const r = await igGet<IgResponse<Record<string, unknown>>>(`/${mediaId}/insights`, {
    metric: 'impressions,reach,engagement,saved,video_views',
  })
  const out: Record<string, unknown> = {}
  for (const item of r.data || []) {
    const name = item.name as string | undefined
    const values = item.values as Array<Record<string, unknown>> | undefined
    if (name && values && values[0]) out[name] = values[0].value
  }
  return out
}

export async function getMediaComments(mediaId: string, limit = 50): Promise<IgComment[]> {
  const r = await igGet<IgResponse<IgComment>>(`/${mediaId}/comments`, {
    fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}',
    limit:  String(limit),
  })
  return r.data || []
}

export async function replyToComment(commentId: string, message: string): Promise<unknown> {
  return igPost(`/${commentId}/replies`, { message: message.slice(0, 500) })
}
