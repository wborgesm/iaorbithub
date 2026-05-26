// POST /api/feedback — anexa outcome/feedback a um OrbitAuditLog (módulo 42)
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const router = Router()

// Aceita pedidos com Bearer ORBIT_API_KEY OU pedidos thumbs do próprio HUD
// (referer contém /orbit/ e source === 'thumbs').
function isAuthorized(req: { headers: Record<string, unknown>; body?: unknown }): boolean {
  const auth = String(req.headers.authorization || '')
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (process.env.ORBIT_API_KEY && apiKey === process.env.ORBIT_API_KEY) return true

  const referer = String(req.headers.referer || req.headers.referrer || '')
  const body = (req.body || {}) as { source?: string }
  return body.source === 'thumbs' && referer.includes('/orbit/')
}

router.post('/', async (req, res) => {
  if (!isAuthorized(req as unknown as { headers: Record<string, unknown>; body?: unknown })) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = (req.body || {}) as {
    auditLogId?:    string
    interactionId?: string
    messageId?:     string
    sessionId?:     string
    outcome?:       string
    feedback?:      string
    source?:        string
  }

  const outcome = body.outcome ? String(body.outcome) : ''
  if (!outcome) {
    return res.status(400).json({ error: 'Missing outcome' })
  }

  const directId = body.auditLogId || body.interactionId
  const messageId = body.messageId ? String(body.messageId) : ''
  const sessionId = body.sessionId ? String(body.sessionId) : ''
  const feedback = body.feedback ? String(body.feedback) : (body.source ? `via ${body.source}` : undefined)

  try {
    // 1) Match directo por auditLogId/interactionId (comportamento existente)
    if (directId) {
      await prisma.orbitAuditLog.update({
        where: { id: String(directId) },
        data:  {
          outcome,
          feedback,
          reviewedAt: new Date(),
        },
      })
      return res.json({ ok: true, matched: 'direct' })
    }

    // 2) Match por messageId guardado no metadata (caso o toolExecution o registe)
    if (messageId) {
      const candidate = await prisma.orbitAuditLog.findFirst({
        where: { metadata: { path: ['messageId'], equals: messageId } } as never,
        orderBy: { createdAt: 'desc' },
      }).catch(() => null)
      if (candidate) {
        await prisma.orbitAuditLog.update({
          where: { id: candidate.id },
          data:  { outcome, feedback, reviewedAt: new Date() },
        })
        return res.json({ ok: true, matched: 'messageId' })
      }
    }

    // 3) Fallback: último log da sessionId ainda sem outcome
    if (sessionId) {
      const latest = await prisma.orbitAuditLog.findFirst({
        where: { sessionId, outcome: null },
        orderBy: { createdAt: 'desc' },
      })
      if (latest) {
        await prisma.orbitAuditLog.update({
          where: { id: latest.id },
          data:  { outcome, feedback, reviewedAt: new Date() },
        })
        return res.json({ ok: true, matched: 'sessionId' })
      }
    }

    return res.status(404).json({ error: 'No matching audit log to annotate' })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

export { router as feedbackRouter }
