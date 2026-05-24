import { Router, Request, Response } from 'express'
import {
  buildHomeAssistantAuthUrl,
  exchangeHomeAssistantCode,
  getHomeAssistantBaseUrl,
  isHomeAssistantConnected,
  disconnectHomeAssistantOAuth,
} from '../services/homeAssistantAuth'
import { requireAdminAuth } from '../middleware/adminAuth'

const router = Router()

router.get('/connect', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const baseUrl = await getHomeAssistantBaseUrl()
    if (!baseUrl) {
      return res.redirect('/orbit?ha=error&msg=' + encodeURIComponent('Guarda a URL do Home Assistant primeiro (Nabu Casa ou remota)'))
    }
    res.redirect(buildHomeAssistantAuthUrl(baseUrl))
  } catch (e) {
    res.redirect('/orbit?ha=error&msg=' + encodeURIComponent((e as Error).message))
  }
})

router.get('/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query
  if (error || !code) {
    return res.redirect('/orbit?ha=error')
  }
  try {
    await exchangeHomeAssistantCode(code as string)
    res.redirect('/orbit?ha=success')
  } catch (e) {
    res.redirect('/orbit?ha=error&msg=' + encodeURIComponent((e as Error).message))
  }
})

router.get('/status', requireAdminAuth, async (_req: Request, res: Response) => {
  const connected = await isHomeAssistantConnected()
  const url = await getHomeAssistantBaseUrl()
  res.json({ connected, url: url || null })
})

router.post('/disconnect', requireAdminAuth, async (_req: Request, res: Response) => {
  await disconnectHomeAssistantOAuth()
  res.json({ ok: true })
})

export default router
