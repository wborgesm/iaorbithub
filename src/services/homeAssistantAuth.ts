import { getOrbitConfig, setOrbitConfig, deleteOrbitConfig } from './orbitConfig'

export const HA_REDIRECT_URI = 'https://ia.orbithubos.pt/api/orbit/homeassistant/callback'
export const HA_CLIENT_ID = HA_REDIRECT_URI

export async function getHomeAssistantBaseUrl(): Promise<string> {
  return (await getOrbitConfig('home_assistant_url')).replace(/\/$/, '')
}

export function buildHomeAssistantAuthUrl(baseUrl: string): string {
  const params = new URLSearchParams({
    client_id: HA_CLIENT_ID,
    redirect_uri: HA_REDIRECT_URI,
    response_type: 'code',
  })
  return `${baseUrl.replace(/\/$/, '')}/auth/authorize?${params.toString()}`
}

async function tokenRequest(baseUrl: string, body: Record<string, string>): Promise<{
  access_token: string
  refresh_token?: string
  expires_in?: number
}> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Home Assistant OAuth falhou (${res.status}): ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>
}

export async function exchangeHomeAssistantCode(code: string): Promise<void> {
  const baseUrl = await getHomeAssistantBaseUrl()
  if (!baseUrl) throw new Error('Guarda primeiro a URL do Home Assistant (Nabu Casa ou remota)')

  const data = await tokenRequest(baseUrl, {
    grant_type: 'authorization_code',
    code,
    client_id: HA_CLIENT_ID,
    redirect_uri: HA_REDIRECT_URI,
  })

  await setOrbitConfig('home_assistant_access_token', data.access_token)
  if (data.refresh_token) await setOrbitConfig('home_assistant_refresh_token', data.refresh_token)
  if (data.expires_in) {
    await setOrbitConfig('home_assistant_token_expiry', String(Date.now() + data.expires_in * 1000))
  }
}

async function refreshAccessToken(baseUrl: string, refreshToken: string): Promise<string> {
  const data = await tokenRequest(baseUrl, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: HA_CLIENT_ID,
  })
  await setOrbitConfig('home_assistant_access_token', data.access_token)
  if (data.refresh_token) await setOrbitConfig('home_assistant_refresh_token', data.refresh_token)
  const expiresIn = data.expires_in ?? 1800
  await setOrbitConfig('home_assistant_token_expiry', String(Date.now() + expiresIn * 1000))
  return data.access_token
}

/** Token OAuth (conta ligada) ou long-lived manual */
export async function getHomeAssistantAccessToken(): Promise<{ baseUrl: string; token: string } | null> {
  const baseUrl = await getHomeAssistantBaseUrl()
  if (!baseUrl) return null

  const refreshToken = await getOrbitConfig('home_assistant_refresh_token')
  if (refreshToken) {
    const expiry = parseInt(await getOrbitConfig('home_assistant_token_expiry') || '0', 10)
    let access = await getOrbitConfig('home_assistant_access_token')
    if (!access || Date.now() > expiry - 60_000) {
      access = await refreshAccessToken(baseUrl, refreshToken)
    }
    return { baseUrl, token: access }
  }

  const legacy = await getOrbitConfig('home_assistant_token')
  if (legacy) return { baseUrl, token: legacy }

  return null
}

export async function isHomeAssistantConnected(): Promise<boolean> {
  return !!(await getHomeAssistantAccessToken())
}

export async function disconnectHomeAssistantOAuth(): Promise<void> {
  await deleteOrbitConfig('home_assistant_access_token')
  await deleteOrbitConfig('home_assistant_refresh_token')
  await deleteOrbitConfig('home_assistant_token_expiry')
}
