import { Router, Request, Response } from 'express'
import { requireAdminAuth } from '../middleware/adminAuth'
import {
  disconnectWhatsAppWeb,
  getWhatsAppWebStatus,
  restartWhatsAppWeb,
  startWhatsAppWeb,
} from '../services/whatsappWeb'

const router = Router()

router.get('/status', requireAdminAuth, (_req: Request, res: Response) => {
  res.json(getWhatsAppWebStatus())
})

router.post('/connect', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    await startWhatsAppWeb()
    res.json(getWhatsAppWebStatus())
  } catch (e) {
    res.status(500).json({
      ...getWhatsAppWebStatus(),
      error: e instanceof Error ? e.message : 'Erro ao iniciar',
    })
  }
})

router.post('/disconnect', requireAdminAuth, async (_req: Request, res: Response) => {
  await disconnectWhatsAppWeb()
  res.json({ ok: true, ...getWhatsAppWebStatus() })
})

router.post('/restart', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    await restartWhatsAppWeb()
    res.json({ ok: true, ...getWhatsAppWebStatus() })
  } catch (e) {
    res.status(500).json({
      ok: false,
      ...getWhatsAppWebStatus(),
      error: e instanceof Error ? e.message : 'Erro ao reiniciar',
    })
  }
})

export default router
