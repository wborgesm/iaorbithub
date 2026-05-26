import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

// ─── Tarefas: contador para o HUD ────────────────────────────────────────────
router.get('/tasks/count', async (_req: Request, res: Response) => {
  try {
    const urgent = await prisma.orbitTask.count({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, priority: { in: ['URGENTE', 'IMPORTANTE'] } },
    })
    const total = await prisma.orbitTask.count({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
    })
    return res.json({ urgent, total })
  } catch {
    return res.json({ urgent: 0, total: 0 })
  }
})

// ─── Apple Watch / iOS Shortcuts → ORBIT (Health auto-import) ────────────────
router.post('/health/import', async (req: Request, res: Response) => {
  const apiKey = (req.headers['x-api-key'] as string | undefined) || req.body?.apiKey
  const expected = process.env.ORBIT_API_KEY
  if (!expected || apiKey !== expected) {
    return res.status(401).json({ error: 'Não autorizado' })
  }
  try {
    const { sleepHours, sleepQuality, energy, mood, steps, heartRate, exercise, notes, date } = req.body || {}
    const log = await prisma.orbitHealthLog.create({
      data: {
        date:         date ? new Date(date) : new Date(),
        sleepHours:   sleepHours   !== undefined && sleepHours   !== null ? Number(sleepHours)   : undefined,
        sleepQuality: sleepQuality !== undefined && sleepQuality !== null ? Number(sleepQuality) : undefined,
        energy:       energy       !== undefined && energy       !== null ? Number(energy)       : undefined,
        mood:         mood         !== undefined && mood         !== null ? Number(mood)         : undefined,
        exercise:     exercise     ? String(exercise) : undefined,
        notes: [
          steps     ? `Passos: ${steps}` : null,
          heartRate ? `BPM médio: ${heartRate}` : null,
          notes     ? String(notes) : null,
        ].filter(Boolean).join(' | ') || undefined,
      },
    })
    return res.json({ success: true, id: log.id })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

// ─── Snapshot proxy de câmara Home Assistant (evita CORS) ────────────────────
router.get('/camera-snapshot', async (req: Request, res: Response) => {
  try {
    const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : ''
    if (!entityId.startsWith('camera.')) {
      return res.status(400).json({ error: 'entityId inválido' })
    }
    const { getHomeAssistantAccessToken } = await import('../services/homeAssistantAuth')
    const cfg = await getHomeAssistantAccessToken()
    if (!cfg) return res.status(503).json({ error: 'Home Assistant não configurado' })
    const response = await fetch(`${cfg.baseUrl}/api/camera_proxy/${entityId}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    })
    if (!response.ok) return res.status(response.status).json({ error: 'Câmara indisponível' })
    const buffer = await response.arrayBuffer()
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'no-cache')
    return res.send(Buffer.from(buffer))
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

export default router
