// POST /api/screen/upload — receive screenshots from MacBook/iPhone (módulo 29)
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { setOrbitConfig } from '../services/orbitConfig'

const prisma = new PrismaClient()
void prisma // garante import (caso prisma seja necessário em futuros endpoints)

const router = Router()

router.post('/upload', async (req, res) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { screenshot, source, ts } = (req.body || {}) as {
    screenshot?: string
    source?:     string
    ts?:         number
  }

  if (!screenshot || typeof screenshot !== 'string') {
    return res.status(400).json({ error: 'Missing screenshot' })
  }

  const src = (source || 'mac').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'mac'

  try {
    await setOrbitConfig(`screen_last_${src}`,    screenshot.slice(0, 1_000_000))
    await setOrbitConfig(`screen_last_${src}_ts`, String(ts || Date.now()))
    return res.json({ ok: true, source: src })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

export { router as screenRouter }
