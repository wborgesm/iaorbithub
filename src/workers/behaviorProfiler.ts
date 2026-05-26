// Behavior Profiler — perfil comportamental por dispositivo (módulo 47)
// Corre diariamente às 04:00. Constrói perfil (horas activas, dias, velocidade
// média, centroid, % movimentos nocturnos) e baseline de métricas (M58.1).
import { Pool } from 'pg'
import { setOrbitConfig } from '../services/orbitConfig'

interface BehaviorProfile {
  deviceId:      number
  deviceName:    string
  activeHours:   number[]
  avgSpeed_kmh:  number
  typicalLat:    number
  typicalLng:    number
  activeDays:    number[]
  nightMoves:    number
  sampledAt:     string
}

async function buildProfile(deviceId: number, deviceName: string, tracker: Pool): Promise<BehaviorProfile | null> {
  const r = await tracker.query(`
    SELECT
      EXTRACT(HOUR FROM fixtime) AS hour,
      EXTRACT(DOW  FROM fixtime) AS dow,
      speed,
      latitude, longitude
    FROM tc_positions
    WHERE deviceid = $1
      AND fixtime  > NOW() - INTERVAL '30 days'
      AND speed    > 2
    ORDER BY fixtime DESC
    LIMIT 2000
  `, [deviceId])

  if (r.rows.length < 20) return null

  const hours: Record<number, number> = {}
  const days:  Record<number, number> = {}
  let sumLat = 0, sumLng = 0, sumSpeed = 0
  let nightCount = 0

  for (const row of r.rows) {
    const h = parseInt(row.hour)
    const d = parseInt(row.dow)
    hours[h] = (hours[h] || 0) + 1
    days[d]  = (days[d]  || 0) + 1
    sumLat   += parseFloat(row.latitude)
    sumLng   += parseFloat(row.longitude)
    sumSpeed += parseFloat(row.speed) * 1.852
    if (h >= 0 && h < 5) nightCount++
  }

  const total = r.rows.length
  const activeHours = Object.entries(hours)
    .filter(([, cnt]) => cnt > total * 0.05)
    .map(([h]) => parseInt(h))
    .sort((a, b) => a - b)

  const activeDays = Object.entries(days)
    .filter(([, cnt]) => cnt > total * 0.1)
    .map(([d]) => parseInt(d))

  return {
    deviceId,
    deviceName,
    activeHours,
    avgSpeed_kmh: Math.round(sumSpeed / total),
    typicalLat:   sumLat / total,
    typicalLng:   sumLng / total,
    activeDays,
    nightMoves:   Math.round((nightCount / total) * 100),
    sampledAt:    new Date().toISOString(),
  }
}

// Módulo 58.1 — Baseline individual de métricas (tensão, RSSI, satélites)
async function buildDeviceBaseline(deviceId: number, tracker: Pool): Promise<void> {
  try {
    const r = await tracker.query(`
      SELECT
        AVG((attributes->>'power')::float)    AS avg_power,
        STDDEV((attributes->>'power')::float) AS std_power,
        AVG((attributes->>'rssi')::float)     AS avg_rssi,
        STDDEV((attributes->>'rssi')::float)  AS std_rssi,
        AVG((attributes->>'sat')::float)      AS avg_sat,
        COUNT(*)                              AS sample_count
      FROM tc_positions
      WHERE deviceid = $1
        AND fixtime > NOW() - INTERVAL '30 days'
        AND (attributes->>'power') IS NOT NULL
    `, [deviceId])

    if (!r.rows.length || parseInt(r.rows[0].sample_count) < 50) return

    await setOrbitConfig(`device_baseline_${deviceId}`, JSON.stringify({
      avgPower:  parseFloat(r.rows[0].avg_power) || null,
      stdPower:  parseFloat(r.rows[0].std_power) || null,
      avgRssi:   parseFloat(r.rows[0].avg_rssi)  || null,
      stdRssi:   parseFloat(r.rows[0].std_rssi)  || null,
      avgSat:    parseFloat(r.rows[0].avg_sat)   || null,
      samples:   parseInt(r.rows[0].sample_count),
      updatedAt: new Date().toISOString(),
    }))
  } catch { /* ignorar */ }
}

export async function runBehaviorProfiler(): Promise<void> {
  if (!process.env.AUTOTRACK_DATABASE_URL) {
    console.warn('[behaviorProfiler] AUTOTRACK_DATABASE_URL ausente — skipping')
    return
  }
  const tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
  try {
    const devR = await tracker.query(
      `SELECT id, name FROM tc_devices WHERE disabled = false ORDER BY lastupdate DESC LIMIT 100`,
    )
    let updated = 0
    for (const dev of devR.rows) {
      try {
        const profile = await buildProfile(dev.id, dev.name, tracker)
        if (profile) {
          await setOrbitConfig(`behavior_profile_${dev.id}`, JSON.stringify(profile))
          updated++
        }
        await buildDeviceBaseline(dev.id, tracker)
      } catch { /* skip device */ }
    }
    console.log(`[behaviorProfiler] ${updated} perfis actualizados (${devR.rows.length} verificados)`)
  } catch (err) {
    console.warn('[behaviorProfiler] erro:', (err as Error).message)
  } finally {
    await tracker.end().catch(() => {})
  }
}

let lastProfilerDate = ''

export function startBehaviorProfiler(): void {
  setInterval(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const hour  = new Date().getHours()
    if (hour === 4 && lastProfilerDate !== today) {
      lastProfilerDate = today
      void runBehaviorProfiler()
    }
  }, 60 * 1000)
  console.log('[behaviorProfiler] Activo — perfis actualizados às 04:00 diariamente')
}
