// Alert Aggregator — Anti-Caos (módulo 56)
// Agrupa alertas que entrem em rajada para evitar spam: detecta incidentes
// regionais (várias offline simultâneas) e calcula centroid geográfico.
import { setOrbitConfig } from './orbitConfig'

interface RawAlert {
  deviceId:   number
  deviceName: string
  type:       string
  lat?:       number
  lng?:       number
  message:    string
  timestamp:  Date
}

export interface AggregatedIncident {
  id:              string
  type:            string
  affectedDevices: number
  region:          string
  summary:         string
  firstSeen:       Date
  lastSeen:        Date
  alerts:          RawAlert[]
}

const pendingAlerts: RawAlert[] = []
let lastFlushAt = Date.now()

export function queueAlert(alert: RawAlert): void {
  pendingAlerts.push(alert)
}

export async function flushAndAggregate(): Promise<AggregatedIncident[]> {
  const now = Date.now()
  if (now - lastFlushAt < 60000) return [] // esperar 60s para acumular
  lastFlushAt = now

  if (!pendingAlerts.length) return []
  const batch = pendingAlerts.splice(0)

  const incidents: AggregatedIncident[] = []

  const byType: Record<string, RawAlert[]> = {}
  for (const a of batch) {
    if (!byType[a.type]) byType[a.type] = []
    byType[a.type].push(a)
  }

  for (const [type, alerts] of Object.entries(byType)) {
    if (alerts.length === 1) {
      incidents.push({
        id:              `single_${Date.now()}_${alerts[0].deviceId}`,
        type,
        affectedDevices: 1,
        region:          'Localização única',
        summary:         alerts[0].message,
        firstSeen:       alerts[0].timestamp,
        lastSeen:        alerts[0].timestamp,
        alerts,
      })
      continue
    }

    const withCoords = alerts.filter(a => typeof a.lat === 'number' && typeof a.lng === 'number')
    let region = 'Múltiplas localizações'
    if (withCoords.length > 0) {
      const avgLat = withCoords.reduce((s, a) => s + (a.lat || 0), 0) / withCoords.length
      const avgLng = withCoords.reduce((s, a) => s + (a.lng || 0), 0) / withCoords.length
      region = `Centro: ${avgLat.toFixed(3)}, ${avgLng.toFixed(3)}`
    }

    const deviceNames = alerts.slice(0, 3).map(a => a.deviceName).join(', ')
    const summary =
      type === 'deviceOffline'
        ? `🔴 INCIDENTE REGIONAL: ${alerts.length} dispositivos offline simultaneamente. Possível falha de operadora ou problema de rede. Afectados: ${deviceNames}${alerts.length > 3 ? ` (+${alerts.length - 3})` : ''}`
        : `⚠️ INCIDENTE MÚLTIPLO [${type}]: ${alerts.length} dispositivos. ${deviceNames}${alerts.length > 3 ? ` (+${alerts.length - 3})` : ''}`

    incidents.push({
      id:              `incident_${type}_${Date.now()}`,
      type,
      affectedDevices: alerts.length,
      region,
      summary,
      firstSeen:       new Date(Math.min(...alerts.map(a => a.timestamp.getTime()))),
      lastSeen:        new Date(Math.max(...alerts.map(a => a.timestamp.getTime()))),
      alerts,
    })
  }

  try {
    await setOrbitConfig('active_incidents', JSON.stringify(incidents.slice(-10)))
  } catch { /* ignorar */ }
  return incidents
}
