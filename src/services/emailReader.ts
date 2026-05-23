import { ImapFlow } from 'imapflow'
import { getOrbitConfig } from './orbitConfig'

export interface EmailSummary {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
  isRead: boolean
}

const AUTH_ERROR = 'Gmail não configurado ou App Password incorrecta'

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractTextFromSource(source: string, maxLen?: number): string {
  if (!source) return ''
  const parts = source.split(/\r\n\r\n/)
  let body = parts.length > 1 ? parts.slice(1).join('\n\n') : source

  const plainMatch = body.match(/Content-Type:\s*text\/plain[^\r\n]*[\r\n]+(?:Content-Transfer-Encoding:[^\r\n]*[\r\n]+)?[\r\n]+([\s\S]*?)(?:\r\n--|$)/i)
  if (plainMatch) {
    body = plainMatch[1]
  } else {
    const htmlMatch = body.match(/Content-Type:\s*text\/html[^\r\n]*[\r\n]+(?:Content-Transfer-Encoding:[^\r\n]*[\r\n]+)?[\r\n]+([\s\S]*?)(?:\r\n--|$)/i)
    if (htmlMatch) body = htmlMatch[1]
    else if (parts.length > 1) body = parts[parts.length - 1]
  }

  body = stripHtml(body)
  if (maxLen && body.length > maxLen) return body.slice(0, maxLen)
  return body
}

function formatDate(d?: Date | string): string {
  if (!d) return ''
  if (d instanceof Date) return d.toISOString()
  return new Date(d).toISOString()
}

function formatAddress(addrs?: Array<{ name?: string; address?: string }>): string {
  if (!addrs?.length) return ''
  const a = addrs[0]
  if (a.name && a.address) return `${a.name} <${a.address}>`
  return a.address || a.name || ''
}

async function createClient(): Promise<ImapFlow> {
  const user = await getOrbitConfig('gmail_user')
  const passRaw = await getOrbitConfig('gmail_app_password')
  const pass = passRaw.replace(/\s/g, '')
  if (!user || !pass) throw new Error(AUTH_ERROR)
  if (pass.length !== 16) {
    throw new Error('App Password inválida — deve ter exactamente 16 caracteres (Google → Segurança → App Passwords)')
  }
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  })
}

async function withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = await createClient()
  try {
    await client.connect()
    return await fn(client)
  } catch (err) {
    const msg = (err as Error).message?.toLowerCase() || ''
    if (
      msg.includes('auth') ||
      msg.includes('credential') ||
      msg.includes('login') ||
      msg.includes('invalid') ||
      msg.includes('authentication')
    ) {
      throw new Error(AUTH_ERROR)
    }
    throw err
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }
}

export async function listEmailFolders(): Promise<string[]> {
  return withImap(async client => {
    const mailboxes = await client.list()
    return mailboxes.map(m => m.path).sort()
  })
}

export async function readEmails(options: {
  folder?: string
  limit?: number
  onlyUnread?: boolean
  search?: string
}): Promise<EmailSummary[]> {
  const folder = options.folder || 'INBOX'
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 20)
  const onlyUnread = options.onlyUnread ?? false
  const search = options.search?.trim().toLowerCase()

  return withImap(async client => {
    const lock = await client.getMailboxLock(folder)
    try {
      const query = onlyUnread ? { seen: false } : { all: true }
      let uids = await client.search(query, { uid: true })
      if (!uids || uids.length === 0) return []

      uids = uids.slice(-limit).reverse()
      const results: EmailSummary[] = []

      for await (const msg of client.fetch(uids, {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
        source: true,
      }, { uid: true })) {
        const from = formatAddress(msg.envelope?.from)
        const subject = msg.envelope?.subject || '(sem assunto)'
        if (search && !from.toLowerCase().includes(search) && !subject.toLowerCase().includes(search)) {
          continue
        }
        const raw = msg.source ? msg.source.toString('utf8') : ''
        results.push({
          id: String(msg.uid),
          from,
          subject,
          date: formatDate(msg.internalDate),
          snippet: extractTextFromSource(raw, 300),
          isRead: msg.flags?.has('\\Seen') ?? false,
        })
      }

      return results
    } finally {
      lock.release()
    }
  })
}

export async function readEmailById(id: string): Promise<{
  from: string
  to: string
  subject: string
  date: string
  body: string
} | null> {
  const uid = parseInt(id, 10)
  if (!Number.isFinite(uid)) return null

  return withImap(async client => {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const msg = await client.fetchOne(String(uid), {
        uid: true,
        envelope: true,
        internalDate: true,
        source: true,
      }, { uid: true })

      if (!msg) return null

      const raw = msg.source ? msg.source.toString('utf8') : ''
      return {
        from: formatAddress(msg.envelope?.from),
        to: formatAddress(msg.envelope?.to),
        subject: msg.envelope?.subject || '(sem assunto)',
        date: formatDate(msg.internalDate),
        body: extractTextFromSource(raw),
      }
    } finally {
      lock.release()
    }
  })
}
