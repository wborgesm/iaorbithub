import { Router, Request, Response } from 'express'
import { getOrbitConfig } from '../services/orbitConfig'
import {
  isFocusModeActive,
  setFocusMode,
  getQueuedNonVipMessages,
} from '../modules/focusMode'
import { triggerFocusModeWebhook } from '../services/homeAssistantWebhooks'
import { calcularDivisaoLucros } from '../modules/financeDivisaoLucros'
import { gerarCobrancaSuave } from '../modules/cobrancaSuave'
import { gerarSlogansBranding, enviarIdeiaParaTrello, onNewImageUpload } from '../workers/mediaWorker'
import { gerarRespostaMimetizada, listMimetismoDrafts } from '../modules/socialMimetismo'
import { generateMorningBriefingTts } from '../modules/briefingMatinalTts'
import { verificarAuditoriaAcessos } from '../modules/adminAccessAudit'
import { analisarChurn } from '../workers/churnWorker'
import { requireAdminAuth } from '../middleware/adminAuth'

const router = Router()

async function validateOrbitKey(req: Request, res: Response): Promise<boolean> {
  const key = req.headers['x-orbit-key'] as string | undefined
  const expected = await getOrbitConfig('api_key')
  if (!expected || key !== expected) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

router.post('/focus', async (req: Request, res: Response) => {
  if (!(await validateOrbitKey(req, res))) return
  const active = req.body?.active !== false
  setFocusMode(active)
  const ha = await triggerFocusModeWebhook(active)
  return res.json({
    ok: true,
    focusMode: isFocusModeActive(),
    homeAssistant: ha,
    queuedNonVip: getQueuedNonVipMessages(),
  })
})

router.get('/focus', requireAdminAuth, async (_req: Request, res: Response) => {
  return res.json({
    active: isFocusModeActive(),
    queuedNonVip: getQueuedNonVipMessages(),
  })
})

router.post('/finance/divisao-lucros', requireAdminAuth, async (req: Request, res: Response) => {
  const total = Number(req.body?.faturamentoTotal)
  if (!Number.isFinite(total) || total < 0) {
    return res.status(400).json({ error: 'faturamentoTotal obrigatório' })
  }
  const result = await calcularDivisaoLucros(total)
  return res.json(result)
})

router.post('/finance/cobranca-suave', requireAdminAuth, async (req: Request, res: Response) => {
  const faturas = req.body?.faturas
  if (!Array.isArray(faturas) || faturas.length === 0) {
    return res.status(400).json({ error: 'faturas[] obrigatório' })
  }
  const msg = await gerarCobrancaSuave(faturas)
  return res.json({ message: msg })
})

router.post('/branding/slogans', requireAdminAuth, async (req: Request, res: Response) => {
  const dominio = typeof req.body?.dominio === 'string' ? req.body.dominio.trim() : ''
  if (!dominio) return res.status(400).json({ error: 'dominio obrigatório' })
  const slogans = await gerarSlogansBranding(dominio)
  return res.json({ dominio, slogans })
})

router.post('/media/strip-metadata', requireAdminAuth, async (req: Request, res: Response) => {
  const filePath = typeof req.body?.path === 'string' ? req.body.path.trim() : ''
  if (!filePath) return res.status(400).json({ error: 'path obrigatório' })
  const result = await onNewImageUpload(filePath)
  return res.json(result)
})

router.post('/ideas/trello', requireAdminAuth, async (req: Request, res: Response) => {
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : ''
  if (!texto) return res.status(400).json({ error: 'texto obrigatório' })
  const result = await enviarIdeiaParaTrello(texto)
  return res.json(result)
})

router.post('/social/mimetismo', requireAdminAuth, async (req: Request, res: Response) => {
  const mensagem = typeof req.body?.mensagem === 'string' ? req.body.mensagem.trim() : ''
  if (!mensagem) return res.status(400).json({ error: 'mensagem obrigatória' })
  const draft = await gerarRespostaMimetizada(mensagem)
  return res.json(draft)
})

router.get('/social/mimetismo/drafts', requireAdminAuth, async (_req: Request, res: Response) => {
  return res.json({ drafts: await listMimetismoDrafts() })
})

router.get('/briefing/tts-text', requireAdminAuth, async (_req: Request, res: Response) => {
  const text = await generateMorningBriefingTts()
  return res.json({ text })
})

router.get('/audit/access', requireAdminAuth, async (req: Request, res: Response) => {
  const days = parseInt(String(req.query.days || '7'), 10)
  return res.json({ ips: await verificarAuditoriaAcessos(days) })
})

router.get('/churn/risco', requireAdminAuth, async (_req: Request, res: Response) => {
  return res.json({ risco: await analisarChurn() })
})

router.post('/gps/cleanup', requireAdminAuth, async (req: Request, res: Response) => {
  const { cleanGpsHistoryManual } = await import('../workers/garbageCollector')
  const target = typeof req.body?.target === 'string' ? req.body.target : 'logs'
  const days = typeof req.body?.days === 'number' ? req.body.days : undefined
  const sinceDate = typeof req.body?.sinceDate === 'string' ? req.body.sinceDate : undefined
  const out = await cleanGpsHistoryManual({
    target: target as 'logs' | 'positions' | 'telemetry' | 'all',
    days,
    sinceDate,
  })
  if (out.error) return res.status(400).json(out)
  return res.json(out)
})

export default router
