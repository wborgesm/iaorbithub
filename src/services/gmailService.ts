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

function extractBody(payload: unknown): string {
  const p = payload as {
    body?: { data?: string }
    parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>
  } | null
  if (!p) return ''
  if (p.body?.data) return decodeBase64(p.body.data)
  if (p.parts) {
    const plain = p.parts.find(x => x.mimeType === 'text/plain')
    if (plain?.body?.data) return decodeBase64(plain.body.data)
    const html = p.parts.find(x => x.mimeType === 'text/html')
    if (html?.body?.data) {
      return decodeBase64(html.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    }
    for (const part of p.parts) {
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
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: m.id!,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    })
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
  from: string
  to: string
  subject: string
  date: string
  body: string
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
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  ).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

export async function listGmailLabels(): Promise<string[]> {
  const auth = await getOAuth2Client()
  const gmail = google.gmail({ version: 'v1', auth })
  const res = await gmail.users.labels.list({ userId: 'me' })
  return (res.data.labels || []).map(l => l.name || '').filter(Boolean)
}
