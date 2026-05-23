import { Router, Request, Response } from 'express'
import { buildAuthUrl, exchangeCode, isGoogleConnected } from '../services/googleAuth'
import { requireAdminAuth } from '../middleware/adminAuth'
import { deleteOrbitConfig } from '../services/orbitConfig'

const router = Router()

router.get('/connect', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const url = await buildAuthUrl()
    res.redirect(url)
  } catch (e) {
    res.redirect('/orbit?google=error&msg=' + encodeURIComponent((e as Error).message))
  }
})

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

router.get('/status', requireAdminAuth, async (_req: Request, res: Response) => {
  const connected = await isGoogleConnected()
  res.json({ connected })
})

router.post('/disconnect', requireAdminAuth, async (_req: Request, res: Response) => {
  await deleteOrbitConfig('google_access_token')
  await deleteOrbitConfig('google_refresh_token')
  await deleteOrbitConfig('google_token_expiry')
  res.json({ ok: true })
})

export default router
