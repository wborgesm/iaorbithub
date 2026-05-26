import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { getEntityState, isHomeAssistantConfigured } from '../services/homeAssistant'
import { haEnergySaveMode } from '../services/homeAssistantWebhooks'
import { pushAlert } from '../modules/orbitAlerts'

const POLL_MS = 10 * 60 * 1000
const IDLE_MS = 2 * 60 * 60 * 1000

let idleSince: number | null = null
let idleActionDone = false

async function checkHaIdle(): Promise<void> {
  if (!(await isHomeAssistantConfigured())) return

  const entityId = (await getOrbitConfig('ha_motion_entity')) || 'binary_sensor.sala_movimento'
  const state = await getEntityState(entityId)
  const isIdle = !state || state.state === 'off' || state.state === 'unavailable'

  if (!isIdle) {
    idleSince = null
    idleActionDone = false
    return
  }

  if (idleSince === null) idleSince = Date.now()
  if (Date.now() - idleSince < IDLE_MS || idleActionDone) return

  idleActionDone = true
  await haEnergySaveMode()
  await pushAlert({
    type: 'home',
    title: 'Casa idle 2h+ — economia energia',
    body: `Sensor ${entityId} sem movimento. Comandos de economia enviados ao HA.`,
    notifyHA: false,
  })
  await setOrbitConfig('ha_idle_last_action', new Date().toISOString())
  console.log('[haIdleMonitor] Economia energia activada')
}

export function startHaIdleMonitor(): void {
  void checkHaIdle()
  setInterval(() => { void checkHaIdle() }, POLL_MS)
  console.log('[haIdleMonitor] Activo — idle 2h → economia HA')
}
