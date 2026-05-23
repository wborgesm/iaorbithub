# ORBIT — Google Ecosystem Integration

## Objectivo
Integrar o ecosistema Google completo no ORBIT com um único fluxo OAuth2.
Um token = acesso a Gmail, Calendar, Drive, Contacts.

## Pré-requisitos (já feitos pelo utilizador)
- Google Cloud Console project criado com Gmail API activa
- OAuth2 credentials criadas (Client ID + Client Secret)
- Redirect URI configurada: `https://ia.orbithubos.pt/api/orbit/google/callback`

## Passo 1 — Instalar dependência

```bash
cd /opt/ai-command-center && npm install googleapis
```

---

## Passo 2 — `src/services/googleAuth.ts` (NOVO FICHEIRO)

```typescript
import { google } from 'googleapis'
import { getOrbitConfig, setOrbitConfig } from './orbitConfig'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
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
      expiry_date: expiry ? parseInt(expiry) : undefined,
    })
    // Auto-refresh quando o token expira
    client.on('tokens', async (tokens) => {
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
```

---

## Passo 3 — `src/services/gmailService.ts` (NOVO FICHEIRO)

```typescript
import { google } from 'googleapis'
import { getOAuth2Client } from './googleAuth'

export interface EmailSummary {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
  isRead: boolean
}

function decodeBase64(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function extractBody(payload: any): string {
  if (!payload) return ''
  if (payload.body?.data) return decodeBase64(payload.body.data)
  if (payload.parts) {
    const plain = payload.parts.find((p: any) => p.mimeType === 'text/plain')
    if (plain?.body?.data) return decodeBase64(plain.body.data)
    const html = payload.parts.find((p: any) => p.mimeType === 'text/html')
    if (html?.body?.data) return decodeBase64(html.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    for (const part of payload.parts) {
      const body = extractBody(part)
      if (body) return body
    }
  }
  return ''
}

export async function readEmails(options: {
  limit?: number
  onlyUnread?: boolean
  search?: string
  folder?: string
}): Promise<EmailSummary[]> {
  const auth = await getOAuth2Client()
  const gmail = google.gmail({ version: 'v1', auth })
  const limit = Math.min(options.limit ?? 10, 20)

  let q = options.search || ''
  if (options.onlyUnread) q = `is:unread ${q}`.trim()
  const labelIds = options.folder === 'SENT' ? ['SENT'] : ['INBOX']

  const list = await gmail.users.messages.list({
    userId: 'me',
    maxResults: limit,
    q: q || undefined,
    labelIds,
  })

  if (!list.data.messages?.length) return []

  const results: EmailSummary[] = []
  for (const m of list.data.messages) {
    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'] })
    const headers = msg.data.payload?.headers || []
    const get = (name: string) => headers.find(h => h.name === name)?.value || ''
    results.push({
      id: m.id!,
      from: get('From'),
      subject: get('Subject') || '(sem assunto)',
      date: get('Date'),
      snippet: msg.data.snippet || '',
      isRead: !msg.data.labelIds?.includes('UNREAD'),
    })
  }
  return results
}

export async function readEmailById(id: string): Promise<{
  from: string; to: string; subject: string; date: string; body: string
} | null> {
  const auth = await getOAuth2Client()
  const gmail = google.gmail({ version: 'v1', auth })
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  if (!msg.data) return null
  const headers = msg.data.payload?.headers || []
  const get = (name: string) => headers.find(h => h.name === name)?.value || ''
  return {
    from: get('From'),
    to: get('To'),
    subject: get('Subject') || '(sem assunto)',
    date: get('Date'),
    body: extractBody(msg.data.payload).slice(0, 3000),
  }
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const auth = await getOAuth2Client()
  const gmail = google.gmail({ version: 'v1', auth })
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}
```

---

## Passo 4 — `src/services/calendarService.ts` (NOVO FICHEIRO)

```typescript
import { google } from 'googleapis'
import { getOAuth2Client } from './googleAuth'

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  location?: string
  description?: string
}

export async function listCalendarEvents(days = 7): Promise<CalendarEvent[]> {
  const auth = await getOAuth2Client()
  const calendar = google.calendar({ version: 'v3', auth })
  const now = new Date()
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  })

  return (res.data.items || []).map(e => ({
    id: e.id || '',
    title: e.summary || '(sem título)',
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    location: e.location || undefined,
    description: e.description || undefined,
  }))
}

export async function createCalendarEvent(params: {
  title: string
  start: string
  end: string
  description?: string
  location?: string
}): Promise<string> {
  const auth = await getOAuth2Client()
  const calendar = google.calendar({ version: 'v3', auth })

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: params.title,
      description: params.description,
      location: params.location,
      start: { dateTime: new Date(params.start).toISOString(), timeZone: 'Europe/Lisbon' },
      end: { dateTime: new Date(params.end).toISOString(), timeZone: 'Europe/Lisbon' },
    },
  })

  return res.data.id || ''
}
```

---

## Passo 5 — `src/routes/orbitGoogle.ts` (NOVO FICHEIRO)

```typescript
import { Router, Request, Response } from 'express'
import { buildAuthUrl, exchangeCode, isGoogleConnected } from '../services/googleAuth'
import { requireAdminAuth } from '../middleware/adminAuth'
import { deleteOrbitConfig } from '../services/orbitConfig'

const router = Router()

// GET /api/orbit/google/connect — redireciona para consent screen
router.get('/connect', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const url = await buildAuthUrl()
    res.redirect(url)
  } catch (e) {
    res.redirect('/orbit?google=error&msg=' + encodeURIComponent((e as Error).message))
  }
})

// GET /api/orbit/google/callback — recebe o code do Google
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query
  if (error || !code) {
    return res.redirect('/orbit?google=error')
  }
  try {
    await exchangeCode(code as string)
    res.redirect('/orbit?google=success')
  } catch (e) {
    res.redirect('/orbit?google=error&msg=' + encodeURIComponent((e as Error).message))
  }
})

// GET /api/orbit/google/status
router.get('/status', requireAdminAuth, async (_req: Request, res: Response) => {
  const connected = await isGoogleConnected()
  res.json({ connected })
})

// POST /api/orbit/google/disconnect
router.post('/disconnect', requireAdminAuth, async (_req: Request, res: Response) => {
  await deleteOrbitConfig('google_access_token')
  await deleteOrbitConfig('google_refresh_token')
  await deleteOrbitConfig('google_token_expiry')
  res.json({ ok: true })
})

export default router
```

---

## Passo 6 — Registar router em `src/index.ts`

Adicionar DEPOIS dos outros imports de routers:
```typescript
import orbitGoogleRouter from './routes/orbitGoogle'
```

Adicionar DEPOIS do mount do orbitVoiceRouter:
```typescript
app.use('/api/orbit/google', orbitGoogleRouter)
```

---

## Passo 7 — Actualizar `src/services/toolExecution.ts`

### 7a. Substituir imports no topo
Remover (se existir):
```typescript
import { readEmails, readEmailById, listEmailFolders } from './emailReader'
```
Adicionar:
```typescript
import { readEmails as gmailReadEmails, readEmailById as gmailReadById, sendEmail } from './gmailService'
import { listCalendarEvents, createCalendarEvent as createGCalEvent } from './calendarService'
```

### 7b. Adicionar novas tool definitions (dentro do array TOOL_DEFINITIONS, a seguir ao último item existente):

```typescript
{
  type: 'function',
  function: {
    name: 'sendEmail',
    description: 'Envia um email pelo Gmail do utilizador',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Endereço de email destinatário' },
        subject: { type: 'string', description: 'Assunto do email' },
        body: { type: 'string', description: 'Corpo do email em texto simples' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
},
{
  type: 'function',
  function: {
    name: 'listCalendarEvents',
    description: 'Lista os próximos eventos do Google Calendar do utilizador',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Número de dias a frente (default 7)' },
      },
    },
  },
},
```

### 7c. Actualizar os handlers de execução (dentro do switch/else-if):

Substituir o handler `readEmails` existente:
```typescript
} else if (toolName === 'readEmails') {
  const { limit, onlyUnread, search, folder } = args as { limit?: number; onlyUnread?: boolean; search?: string; folder?: string }
  try {
    const items = await gmailReadEmails({ limit, onlyUnread, search, folder })
    return JSON.stringify(items)
  } catch (e) {
    return `Erro ao ler emails: ${(e as Error).message}`
  }
} else if (toolName === 'readEmailContent') {
  const { id } = args as { id: string }
  try {
    const email = await gmailReadById(id)
    return email ? JSON.stringify(email) : 'Email não encontrado'
  } catch (e) {
    return `Erro ao ler email: ${(e as Error).message}`
  }
```

Adicionar os novos handlers a seguir ao `listEmailFolders`:
```typescript
} else if (toolName === 'sendEmail') {
  const { to, subject, body } = args as { to: string; subject: string; body: string }
  try {
    await sendEmail(to, subject, body)
    return `Email enviado para ${to}`
  } catch (e) {
    return `Erro ao enviar email: ${(e as Error).message}`
  }
} else if (toolName === 'listCalendarEvents') {
  const { days } = args as { days?: number }
  try {
    const events = await listCalendarEvents(days)
    return JSON.stringify(events)
  } catch (e) {
    return `Erro ao ler calendário: ${(e as Error).message}`
  }
} else if (toolName === 'createCalendarEvent') {
  const p = args as { title: string; start: string; end: string; description?: string; location?: string }
  try {
    const id = await createGCalEvent(p)
    return `Evento criado com ID: ${id}`
  } catch (e) {
    return `Erro ao criar evento: ${(e as Error).message}`
  }
```

---

## Passo 8 — Actualizar `src/routes/chat.ts`

Na linha que define `orbitExtraTools`, adicionar `sendEmail` e `listCalendarEvents`:
```typescript
const orbitExtraTools = session.site.domain === 'orbit.internal'
  ? ['controlSmartHome', 'sendWhatsApp', 'createCalendarEvent', 'listCalendarEvents', 'listOrbitCapabilities', 'getBankBalance', 'getRecentTransactions', 'readEmails', 'readEmailContent', 'listEmailFolders', 'sendEmail']
  : []
```

---

## Passo 9 — Actualizar `public/orbit/index.html`

### 9a. Remover secção Gmail antiga (com campos gmail_user e gmail_app_password)

### 9b. Adicionar nova secção Google no painel ⚙ (dentro de `<div class="config-groups">`):

```html
<div class="config-group">
  <h3>Google (Gmail + Calendar + Drive)</h3>
  <div id="google-status" class="bank-status"></div>
  <div class="config-row">
    <label>Client ID</label>
    <input type="text" data-key="google_client_id" placeholder="xxx.apps.googleusercontent.com">
  </div>
  <div class="config-row">
    <label>Client Secret</label>
    <input type="password" data-key="google_client_secret" placeholder="GOCSPX-...">
  </div>
  <div class="config-actions">
    <button onclick="saveGoogleCredentials()" class="btn-secondary">Guardar Credenciais</button>
    <button onclick="connectGoogle()" id="btn-google-connect" class="btn-primary">Ligar Google</button>
    <button onclick="disconnectGoogle()" id="btn-google-disconnect" class="btn-danger" style="display:none">Desligar</button>
  </div>
</div>
```

### 9c. Adicionar script no final do `<script>` existente:

```javascript
async function loadGoogleStatus() {
  try {
    const r = await fetch('/api/orbit/google/status', { headers: { 'x-orbit-key': ORBIT_KEY } })
    const d = await r.json()
    const el = document.getElementById('google-status')
    if (d.connected) {
      el.textContent = '✅ Google ligado — Gmail, Calendar e Drive activos'
      el.className = 'bank-status connected'
      document.getElementById('btn-google-connect').style.display = 'none'
      document.getElementById('btn-google-disconnect').style.display = 'inline-block'
    } else {
      el.textContent = '❌ Google não ligado'
      el.className = 'bank-status disconnected'
      document.getElementById('btn-google-connect').style.display = 'inline-block'
      document.getElementById('btn-google-disconnect').style.display = 'none'
    }
  } catch {}
}

async function saveGoogleCredentials() {
  const clientId = document.querySelector('[data-key="google_client_id"]').value.trim()
  const clientSecret = document.querySelector('[data-key="google_client_secret"]').value.trim()
  if (!clientId || !clientSecret) return alert('Preenche os dois campos')
  await saveConfigKey('google_client_id', clientId)
  await saveConfigKey('google_client_secret', clientSecret)
  alert('Credenciais guardadas. Agora clica em Ligar Google.')
}

async function connectGoogle() {
  window.location.href = '/api/orbit/google/connect'
}

async function disconnectGoogle() {
  if (!confirm('Desligar Google? ORBIT perde acesso a Gmail e Calendar.')) return
  await fetch('/api/orbit/google/disconnect', { method: 'POST', headers: { 'x-orbit-key': ORBIT_KEY } })
  await loadGoogleStatus()
}

// Verificar parâmetros de callback na URL
const urlParams = new URLSearchParams(window.location.search)
if (urlParams.get('google') === 'success') {
  alert('✅ Google ligado com sucesso! ORBIT agora tem acesso a Gmail e Calendar.')
  history.replaceState({}, '', '/orbit')
} else if (urlParams.get('google') === 'error') {
  alert('❌ Erro ao ligar Google: ' + (urlParams.get('msg') || 'Tenta novamente'))
  history.replaceState({}, '', '/orbit')
}

// Chamar ao abrir o painel
const origLoadConfig = loadConfig
loadConfig = async function() {
  await origLoadConfig()
  await loadGoogleStatus()
}
```

---

## Passo 10 — Compilar e reiniciar

```bash
cd /opt/ai-command-center
npx tsc
systemctl restart ai-command-center
sleep 3
systemctl status ai-command-center --no-pager | grep Active
```

Se houver erros TypeScript, corrige antes de reiniciar.

---

## Resultado esperado

Após implementação:
- Painel ⚙ tem secção "Google" com Client ID, Client Secret e botão "Ligar Google"
- Utilizador cola credenciais → clica "Ligar Google" → Google consent → ORBIT autorizado
- ORBIT pode: ler emails, enviar emails, ver agenda, criar eventos
- Refresh token automático — nunca pede autorização de novo

## Notas importantes
- O `requireAdminAuth` no `/connect` garante que só o Wanderson pode autorizar
- O `/callback` é público (o Google redireciona para lá sem cookie de sessão)
- Os tokens ficam em SystemConfig com prefix `orbit.`
- Não apagar o ficheiro `src/services/emailReader.ts` — pode coexistir
