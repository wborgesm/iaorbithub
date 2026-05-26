// Engine de Suspeita — Risk Scoring em tempo real (módulo 35)
import type { Pool } from 'pg'

interface SuspicionFactor {
  factor: string
  weight: number
  detail: string
}

export interface SuspicionResult {
  deviceId: number
  deviceName: string
  score: number
  level: 'CRÍTICO' | 'ALTO' | 'MÉDIO' | 'BAIXO'
  factors: SuspicionFactor[]
  recommendation: string
}

export async function calculateSuspicionScore(
  deviceId: number,
  deviceName: string,
  tracker: Pool,
): Promise<SuspicionResult> {
  const factors: SuspicionFactor[] = []
  let score = 0
  const now = new Date()
  const hour = now.getHours()

  if (hour >= 0 && hour < 5) {
    score += 20
    factors.push({ factor: 'madrugada', weight: 20, detail: `${hour}:${String(now.getMinutes()).padStart(2, '0')} — horário de alto risco` })
  }

  try {
    const posR = await tracker.query(`
      SELECT p.speed, p.latitude, p.longitude,
             p.attributes->>'ignition' AS ignition,
             p.attributes->>'alarm' AS alarm,
             p.attributes->>'power' AS power,
             p.fixtime
      FROM tc_positions p
      JOIN tc_devices d ON d.positionid = p.id
      WHERE d.id = $1
    `, [deviceId])

    if (posR.rows.length) {
      const pos = posR.rows[0]
      const speed = parseFloat(pos.speed) * 1.852
      if (speed > 120) { score += 25; factors.push({ factor: 'velocidade_extrema', weight: 25, detail: `${Math.round(speed)} km/h` }) }
      else if (speed > 80) { score += 10; factors.push({ factor: 'velocidade_alta', weight: 10, detail: `${Math.round(speed)} km/h` }) }
      if (pos.alarm) { score += 35; factors.push({ factor: 'alarme_activo', weight: 35, detail: `Alarme: ${pos.alarm}` }) }
      const power = parseFloat(pos.power)
      if (!isNaN(power) && power < 10.0) { score += 30; factors.push({ factor: 'power_critico', weight: 30, detail: `Tensão: ${power.toFixed(1)}V` }) }

      const movR = await tracker.query(`
        SELECT COUNT(*) AS cnt FROM tc_positions
        WHERE deviceid = $1 AND fixtime > NOW() - INTERVAL '30 days'
          AND EXTRACT(HOUR FROM fixtime) BETWEEN 0 AND 5
      `, [deviceId])
      const nightMoves = parseInt(movR.rows[0].cnt)
      if (nightMoves < 3 && hour >= 0 && hour < 5 && pos.ignition === 'true') {
        score += 20
        factors.push({ factor: 'movimento_nocturno_incomum', weight: 20, detail: `Apenas ${nightMoves} movimentos nocturnos em 30 dias` })
      }
    }

    const gpsR = await tracker.query(`
      SELECT COUNT(*) AS cnt FROM tc_positions
      WHERE deviceid = $1 AND fixtime > NOW() - INTERVAL '2 hours' AND speed > 1
        AND (latitude, longitude) = (SELECT latitude, longitude FROM tc_positions WHERE deviceid = $1 ORDER BY fixtime DESC LIMIT 1)
    `, [deviceId])
    if (parseInt(gpsR.rows[0].cnt) > 5) {
      score += 15
      factors.push({ factor: 'gps_instavel', weight: 15, detail: 'Velocidade reportada mas posição imóvel — possível GPS manipulado' })
    }
  } catch { /* ignore */ }

  const level: SuspicionResult['level'] =
    score >= 80 ? 'CRÍTICO' :
    score >= 60 ? 'ALTO' :
    score >= 35 ? 'MÉDIO' : 'BAIXO'

  const recommendation =
    level === 'CRÍTICO' ? 'Notificar cliente IMEDIATAMENTE. Considerar alerta policial.' :
    level === 'ALTO' ? 'Monitorizar activamente. Contactar cliente para confirmar.' :
    level === 'MÉDIO' ? 'Registar e observar. Verificar em 30 minutos.' :
    'Actividade normal. Sem acção necessária.'

  return { deviceId, deviceName, score: Math.min(score, 100), level, factors, recommendation }
}
