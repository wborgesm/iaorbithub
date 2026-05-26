// GET /api/ops/devices — feed para painel táctico (módulo 45)
import { Router } from 'express'
import { Pool } from 'pg'

const router = Router()

router.get('/devices', async (req, res) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!process.env.AUTOTRACK_DATABASE_URL) {
    return res.status(503).json({ error: 'AUTOTRACK_DATABASE_URL não configurado' })
  }

  const tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
  try {
    const r = await tracker.query(`
      SELECT d.id, d.name, d.lastupdate,
             p.latitude  AS lat,
             p.longitude AS lng,
             p.speed,
             (p.attributes::jsonb)->>'alarm' AS alarm
      FROM tc_devices d
      LEFT JOIN tc_positions p ON p.id = d.positionid
      WHERE d.disabled = false
      ORDER BY d.lastupdate DESC
      LIMIT 200
    `)

    const now = Date.now()
    const devices = r.rows.map(d => ({
      id:         d.id,
      name:       d.name,
      lat:        d.lat,
      lng:        d.lng,
      speed:      Math.round((parseFloat(d.speed) || 0) * 1.852),
      offline:    new Date(d.lastupdate).getTime() < now - 2 * 3600000,
      suspicious: !!d.alarm,
      lastUpdate: new Date(d.lastupdate).toLocaleTimeString('pt-PT'),
    }))

    return res.json({
      devices,
      active:     devices.filter(d => !d.offline).length,
      alerts:     devices.filter(d => d.suspicious).length,
      suspicious: devices.filter(d => d.suspicious).length,
    })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  } finally {
    await tracker.end().catch(() => {})
  }
})

export { router as opsRouter }
