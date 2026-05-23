import { getOrbitConfig, setOrbitConfig, deleteOrbitConfig } from './orbitConfig'

export const TL_AUTH_BASE = 'https://auth.truelayer-sandbox.com'
export const TL_API_BASE = 'https://api.truelayer-sandbox.com'
export const TL_CLIENT_ID = 'sandbox-orbit26-8b8b78'
export const REDIRECT_URI = 'https://ia.orbithubos.pt/api/orbit/truelayer/callback'

const TOKEN_KEYS = [
  'truelayer_access_token',
  'truelayer_refresh_token',
  'truelayer_token_expiry',
  'truelayer_account_id',
]

export async function isBankConnected(): Promise<boolean> {
  const accountId = await getOrbitConfig('truelayer_account_id')
  const token = await getOrbitConfig('truelayer_access_token')
  return !!(accountId && token)
}

export async function disconnectBank(): Promise<void> {
  for (const key of TOKEN_KEYS) {
    await deleteOrbitConfig(key)
  }
}

export async function ensureFreshToken(): Promise<string> {
  const expiry = parseInt(await getOrbitConfig('truelayer_token_expiry') || '0', 10)
  const current = await getOrbitConfig('truelayer_access_token')
  if (current && Date.now() < expiry - 60_000) return current

  const refreshToken = await getOrbitConfig('truelayer_refresh_token')
  const secret = await getOrbitConfig('truelayer_secret')
  if (!refreshToken || !secret) throw new Error('Revolut não ligado ou secret em falta')

  const resp = await fetch(`${TL_AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: TL_CLIENT_ID,
      client_secret: secret,
      refresh_token: refreshToken,
    }),
  })
  if (!resp.ok) throw new Error('Falha ao refrescar token TrueLayer')
  const data = await resp.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  await setOrbitConfig('truelayer_access_token', data.access_token)
  if (data.refresh_token) await setOrbitConfig('truelayer_refresh_token', data.refresh_token)
  await setOrbitConfig('truelayer_token_expiry', (Date.now() + data.expires_in * 1000).toString())
  return data.access_token
}

export async function exchangeAuthorizationCode(code: string): Promise<void> {
  const secret = await getOrbitConfig('truelayer_secret')
  if (!secret) throw new Error('TrueLayer Client Secret não configurado')

  const resp = await fetch(`${TL_AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: TL_CLIENT_ID,
      client_secret: secret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!resp.ok) throw new Error('Falha ao trocar código OAuth TrueLayer')
  const data = await resp.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  await setOrbitConfig('truelayer_access_token', data.access_token)
  await setOrbitConfig('truelayer_refresh_token', data.refresh_token)
  await setOrbitConfig('truelayer_token_expiry', (Date.now() + data.expires_in * 1000).toString())

  const accountsResp = await fetch(`${TL_API_BASE}/data/v1/accounts`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  if (!accountsResp.ok) throw new Error('Falha ao obter contas TrueLayer')
  const accounts = await accountsResp.json() as { results?: Array<{ account_id: string }> }
  const accountId = accounts.results?.[0]?.account_id
  if (!accountId) throw new Error('Nenhuma conta encontrada')
  await setOrbitConfig('truelayer_account_id', accountId)
}

export function buildConnectUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TL_CLIENT_ID,
    scope: 'accounts balance transactions offline_access',
    redirect_uri: REDIRECT_URI,
    providers: 'ob-revolut',
  })
  return `${TL_AUTH_BASE}/?${params.toString()}`
}

export async function fetchBankBalance(): Promise<{ currency: string; available: number; current: number }> {
  const token = await ensureFreshToken()
  const accountId = await getOrbitConfig('truelayer_account_id')
  if (!accountId) throw new Error('Conta Revolut não ligada')

  const resp = await fetch(`${TL_API_BASE}/data/v1/accounts/${accountId}/balance`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error('Falha ao consultar saldo')
  const data = await resp.json() as {
    results?: Array<{ currency: string; available: number; current: number }>
  }
  const bal = data.results?.[0]
  if (!bal) throw new Error('Saldo indisponível')
  return { currency: bal.currency, available: bal.available, current: bal.current }
}

export async function fetchRecentTransactions(
  days = 30,
  limit = 20,
): Promise<Array<{ date: string; description: string; amount: number; currency: string; type: string }>> {
  const token = await ensureFreshToken()
  const accountId = await getOrbitConfig('truelayer_account_id')
  if (!accountId) throw new Error('Conta Revolut não ligada')

  const resp = await fetch(`${TL_API_BASE}/data/v1/accounts/${accountId}/transactions`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error('Falha ao consultar transacções')
  const data = await resp.json() as {
    results?: Array<{
      timestamp: string
      description: string
      amount: number
      currency: string
      transaction_type: string
    }>
  }

  const since = Date.now() - days * 24 * 60 * 60 * 1000
  return (data.results || [])
    .filter(t => new Date(t.timestamp).getTime() >= since)
    .slice(0, limit)
    .map(t => ({
      date: t.timestamp,
      description: t.description,
      amount: t.amount,
      currency: t.currency,
      type: t.transaction_type,
    }))
}
