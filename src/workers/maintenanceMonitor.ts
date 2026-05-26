import { PrismaClient } from '@prisma/client'
import { pushAlert } from '../modules/orbitAlerts'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { listMaintenanceAssets } from '../modules/agenticMemory'

const prisma = new PrismaClient()
const ORBIT_DOMAIN = 'orbit.internal'
const POLL_MS = 12 * 60 * 60 * 1000

async function getOrbitSiteId(): Promise<string | null> {
  const site = await prisma.aISite.findFirst({ where: { domain: ORBIT_DOMAIN } })
  return site?.id ?? null
}

function lisbonDateKey(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map(p => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

async function checkMaintenance(): Promise<void> {
  const siteId = await getOrbitSiteId()
  if (!siteId) return

  const assets = await listMaintenanceAssets(siteId)
  const today = lisbonDateKey()

  for (const a of assets) {
    const remaining = a.threshold - a.lastMetric
    const warnKm = Math.min(500, Math.max(100, Math.round(a.threshold * 0.1)))
    const due = a.lastMetric >= a.threshold || remaining <= warnKm
    if (!due) continue

    const key = `maint_alert_${a.id}_${today}`
    if ((await getOrbitConfig(key)) === '1') continue

    const body = `${a.asset}: ${a.lastMetric}/${a.threshold} ${a.unit}. ${a.lastMetric >= a.threshold ? 'Manutenção devida.' : `Faltam ~${remaining}${a.unit}.`} ${a.content}`
    await pushAlert({
      type: 'system',
      title: `Manutenção: ${a.asset}`,
      body,
      notifyHA: false,
      notifyTelegram: true,
    })
    await setOrbitConfig('maintenance_wa_pending', JSON.stringify({
      message: `ORBIT — ${a.asset}: ${remaining}${a.unit} até manutenção (${a.content}).`,
      asset: a.asset,
    }))
    await setOrbitConfig(key, '1')
    console.log(`[maintenanceMonitor] Alerta ${a.asset}`)
  }
}

export function startMaintenanceMonitor(): void {
  void checkMaintenance()
  setInterval(() => { void checkMaintenance() }, POLL_MS)
  console.log('[maintenanceMonitor] Activo — assets com threshold a cada 12h')
}
