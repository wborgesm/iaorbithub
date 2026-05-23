import { Router, Request, Response, NextFunction } from 'express'
import { requireAdminAuth } from '../middleware/adminAuth'
import { getOrbitConfig } from '../services/orbitConfig'
import {
  buildConnectUrl,
  disconnectBank,
  exchangeAuthorizationCode,
  fetchBankBalance,
  fetchRecentTransactions,
  isBankConnected,
} from '../services/truelayerBanking'

const router = Router()

function requireBankingAccess(req: Request, res: Response, next: NextFunction) {
  const internal = req.headers['x-internal-token'] as string | undefined
  const secret = process.env.INTERNAL_API_SECRET || ''
  if (internal && secret && internal === secret) return next()
  return requireAdminAuth(req, res, next)
}

router.get('/connect', requireAdminAuth, async (_req: Request, res: Response) => {
  const secret = await getOrbitConfig('truelayer_secret')
  if (!secret) {
    return res.status(400).json({ error: 'Configura o TrueLayer Client Secret em /orbit → ⚙ primeiro' })
  }
  return res.redirect(buildConnectUrl())
})

router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined
  const err = req.query.error as string | undefined
  if (err || !code) {
    return res.redirect('/orbit?bank=error')
  }
  try {
    await exchangeAuthorizationCode(code)
    return res.redirect('/orbit?bank=connected')
  } catch (e) {
    console.warn('[truelayer/callback]', e)
    return res.redirect('/orbit?bank=error')
  }
})

router.get('/status', requireBankingAccess, async (_req: Request, res: Response) => {
  try {
    const connected = await isBankConnected()
    const hasSecret = !!(await getOrbitConfig('truelayer_secret'))
    return res.json({ connected, hasSecret })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.get('/balance', requireBankingAccess, async (_req: Request, res: Response) => {
  try {
    const balance = await fetchBankBalance()
    return res.json(balance)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.get('/transactions', requireBankingAccess, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string || '30', 10)
    const limit = parseInt(req.query.limit as string || '20', 10)
    const items = await fetchRecentTransactions(days, limit)
    return res.json({ items })
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.post('/disconnect', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    await disconnectBank()
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

export default router
