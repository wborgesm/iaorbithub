// Event Fusion — Sexto Sentido (módulo 55)
// Combina sinais fracos (GSM micro-drops, oscilação tensão, GPS jumps, ignição
// sem movimento) para detectar padrões de adulteração que individualmente
// passariam despercebidos.
import type { Pool } from 'pg'

export interface FusionSignal {
  type:       string
  weight:     number
  detail:     string
  detectedAt: Date
}

export interface FusionResult {
  deviceId:   number
  deviceName: string
  score:      number
  signals:    FusionSignal[]
  level:      'CRITICO' | 'ALTO' | 'SUSPEITO' | 'NORMAL'
  hypothesis: string
}

export async function fuseSignals(
  deviceId: number,
  deviceName: string,
  tracker: Pool,
): Promise<FusionResult> {
  const signals: FusionSignal[] = []
  const windowMs = 10 * 60 * 1000
  const since    = new Date(Date.now() - windowMs)

  // Sinal 1: Quedas GSM breves (online → offline → online em < 30s)
  try {
    const gsmR = await tracker.query(`
      SELECT e1.servertime
      FROM tc_events e1
      JOIN tc_events e2 ON e2.deviceid = e1.deviceid
        AND e2.type = 'deviceOnline'
        AND e2.servertime > e1.servertime
        AND e2.servertime < e1.servertime + INTERVAL '30 seconds'
      WHERE e1.deviceid = $1
        AND e1.type = 'deviceOffline'
        AND e1.servertime >= $2
      LIMIT 3
    `, [deviceId, since])
    for (const row of gsmR.rows) {
      signals.push({
        type:       'gsm_micro_drop',
        weight:     15,
        detail:     'Queda GSM breve (< 30s) — possível interferência momentânea',
        detectedAt: row.servertime,
      })
    }
  } catch { /* ignorar */ }

  // Sinal 2: Oscilação de tensão (variação > 0.5V em posições próximas)
  try {
    const voltR = await tracker.query(`
      SELECT p1.fixtime,
             ABS((p1.attributes->>'power')::float - (p2.attributes->>'power')::float) AS delta
      FROM tc_positions p1
      JOIN tc_positions p2 ON p2.deviceid = p1.deviceid
        AND p2.fixtime > p1.fixtime
        AND p2.fixtime < p1.fixtime + INTERVAL '5 minutes'
      WHERE p1.deviceid = $1
        AND p1.fixtime >= $2
        AND (p1.attributes->>'power') IS NOT NULL
        AND (p2.attributes->>'power') IS NOT NULL
        AND ABS((p1.attributes->>'power')::float - (p2.attributes->>'power')::float) > 0.5
      LIMIT 3
    `, [deviceId, since])
    for (const row of voltR.rows) {
      signals.push({
        type:       'voltage_oscillation',
        weight:     20,
        detail:     `Oscilação de tensão: Δ${parseFloat(row.delta).toFixed(2)}V — possível contacto intermitente`,
        detectedAt: row.fixtime,
      })
    }
  } catch { /* ignorar */ }

  // Sinal 3: GPS jump (desvio brusco sem velocidade proporcional)
  // earth_distance/ll_to_earth podem não existir — protegido com try/catch.
  try {
    const gpsR = await tracker.query(`
      SELECT p1.fixtime,
             p1.latitude, p1.longitude, p1.speed,
             earth_distance(ll_to_earth(p1.latitude, p1.longitude),
                            ll_to_earth(p2.latitude, p2.longitude)) AS dist_m
      FROM tc_positions p1
      JOIN tc_positions p2 ON p2.deviceid = p1.deviceid
        AND p2.fixtime > p1.fixtime
        AND p2.fixtime < p1.fixtime + INTERVAL '2 minutes'
      WHERE p1.deviceid = $1
        AND p1.fixtime >= $2
        AND p1.speed < 5
        AND earth_distance(ll_to_earth(p1.latitude, p1.longitude),
                           ll_to_earth(p2.latitude, p2.longitude)) > 200
      LIMIT 3
    `, [deviceId, since])
    for (const row of gpsR.rows) {
      signals.push({
        type:       'gps_jump',
        weight:     25,
        detail:     `GPS saltou ${Math.round(row.dist_m)}m sem velocidade correspondente — possível spoofing ou reset GPS`,
        detectedAt: row.fixtime,
      })
    }
  } catch { /* earth_distance/ll_to_earth podem não estar instalados */ }

  // Sinal 4: Ignição mudou sem movimento correspondente
  try {
    const ignR = await tracker.query(`
      SELECT p.fixtime, p.attributes->>'ignition' AS ignition, p.speed
      FROM tc_positions p
      WHERE p.deviceid = $1
        AND p.fixtime >= $2
        AND (p.attributes->>'ignition') IS NOT NULL
      ORDER BY p.fixtime ASC
    `, [deviceId, since])
    let lastIgn: string | null = null
    for (const row of ignR.rows) {
      const ign = row.ignition
      const speed = parseFloat(row.speed) * 1.852
      if (lastIgn === 'false' && ign === 'true' && speed < 2) {
        signals.push({
          type:       'ignition_without_movement',
          weight:     30,
          detail:     'Ignição ligada mas sem movimento — possível teste de sistema ou arranque manual',
          detectedAt: row.fixtime,
        })
      }
      lastIgn = ign
    }
  } catch { /* ignorar */ }

  const score = Math.min(100, signals.reduce((s, sig) => s + sig.weight, 0))
  const level: FusionResult['level'] =
    score >= 70 ? 'CRITICO'  :
    score >= 45 ? 'ALTO'     :
    score >= 20 ? 'SUSPEITO' : 'NORMAL'

  const hypothesis =
    score >= 70 ? 'Alta probabilidade de adulteração eléctrica ou tentativa de desactivar GPS. Recomendo verificação imediata.' :
    score >= 45 ? 'Padrão de micro-anomalias acumuladas. Pode indicar interferência externa ou problema de instalação.'        :
    score >= 20 ? 'Sinais fracos detectados. Manter em observação.'                                                              :
    'Nenhuma anomalia significativa nos últimos 10 minutos.'

  return { deviceId, deviceName, score, signals, level, hypothesis }
}
