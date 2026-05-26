// /api/drone — receptor de telemetria DJI/Parrot (módulo 31)
import { Router } from 'express'
import { setOrbitConfig, getOrbitConfig } from '../services/orbitConfig'
import { sendTelegramNotification } from '../services/telegramNotify'

const router = Router()

router.post('/telemetry', async (req, res) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const {
    lat, lng, altitude, speed, battery,
    heading, signal, flightMode, timestamp,
  } = (req.body || {}) as Record<string, unknown>

  try {
    await setOrbitConfig('drone_telemetry', JSON.stringify({
      lat, lng, altitude, speed, battery,
      heading, signal, flightMode,
      ts: typeof timestamp === 'number' ? timestamp : Date.now(),
    }))

    if (typeof battery === 'number' && battery < 20) {
      try {
        const sent = await sendTelegramNotification(`🚁 Drone: bateria em ${battery}% — pousar imediatamente!`)
        if (!sent) console.log(`[drone] (Telegram off) Bateria baixa: ${battery}%`)
      } catch (err) {
        console.log('[drone] alerta bateria fallback:', (err as Error).message)
      }
    }
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.get('/status', async (req, res) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const raw = await getOrbitConfig('drone_telemetry')
    return res.json(raw ? JSON.parse(raw) : { status: 'offline' })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

export { router as droneRouter }
