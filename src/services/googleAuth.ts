import { google } from 'googleapis'
import { getOrbitConfig, setOrbitConfig } from './orbitConfig'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.sleep.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
]

export const REDIRECT_URI = 'https://ia.orbithubos.pt/api/orbit/google/callback'

export async function getOAuth2Client() {
  const clientId = await getOrbitConfig('google_client_id')
  const clientSecret = await getOrbitConfig('google_client_secret')
  if (!clientId || !clientSecret) throw new Error('Google OAuth2 não configurado')

  const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

  const accessToken = await getOrbitConfig('google_access_token')
  const refreshToken = await getOrbitConfig('google_refresh_token')
  const expiry = await getOrbitConfig('google_token_expiry')

  if (accessToken && refreshToken) {
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: expiry ? parseInt(expiry, 10) : undefined,
    })
    client.on('tokens', async tokens => {
      if (tokens.access_token) await setOrbitConfig('google_access_token', tokens.access_token)
      if (tokens.expiry_date) await setOrbitConfig('google_token_expiry', String(tokens.expiry_date))
    })
  }

  return client
}

export async function buildAuthUrl(): Promise<string> {
  const clientId = await getOrbitConfig('google_client_id')
  const clientSecret = await getOrbitConfig('google_client_secret')
  if (!clientId || !clientSecret) throw new Error('Configura primeiro o Client ID e Client Secret do Google')

  const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  })
}

export async function exchangeCode(code: string): Promise<void> {
  const clientId = await getOrbitConfig('google_client_id')
  const clientSecret = await getOrbitConfig('google_client_secret')
  if (!clientId || !clientSecret) throw new Error('Google OAuth2 não configurado')

  const client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)
  const { tokens } = await client.getToken(code)

  if (tokens.access_token) await setOrbitConfig('google_access_token', tokens.access_token)
  if (tokens.refresh_token) await setOrbitConfig('google_refresh_token', tokens.refresh_token)
  if (tokens.expiry_date) await setOrbitConfig('google_token_expiry', String(tokens.expiry_date))
}

export async function isGoogleConnected(): Promise<boolean> {
  const token = await getOrbitConfig('google_refresh_token')
  return !!token
}

/** Devolve um access_token válido (refresca se necessário). Null se não ligado. */
export async function getValidAccessToken(): Promise<string | null> {
  try {
    const refresh = await getOrbitConfig('google_refresh_token')
    if (!refresh) return null
    const client = await getOAuth2Client()
    const { token } = await client.getAccessToken()
    return token || null
  } catch {
    return null
  }
}
