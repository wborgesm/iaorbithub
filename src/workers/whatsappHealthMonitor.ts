import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { getWhatsAppWebStatus } from '../services/whatsappWeb'
import { pushAlert } from '../modules/orbitAlerts'
import fs from 'fs'
import path from 'path'

const POLL_MS = 60 * 1000
const UNHEALTHY_MS = 5 * 60 * 1000

let unhealthySince: number | null = null
let alertSentForEpisode = false

function hasSessionOnDisk(): boolean {
  const dir = path.join(process.cwd(), 'data', 'orbit-personal-whatsapp')
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

async function checkWhatsAppHealth(): Promise<void> {
  const status = getWhatsAppWebStatus()
  const shouldWatch =
    hasSessionOnDisk() || status.state === 'connecting' || status.state === 'qr' || status.state === 'error'

  if (status.connected && status.state === 'ready') {
    unhealthySince = null
    alertSentForEpisode = false
    await setOrbitConfig('whatsapp_health_ok', '1')
    return
  }

  if (!shouldWatch) {
    unhealthySince = null
    alertSentForEpisode = false
    return
  }

  const now = Date.now()
  if (unhealthySince === null) unhealthySince = now

  if (now - unhealthySince < UNHEALTHY_MS || alertSentForEpisode) return

  alertSentForEpisode = true
  const stateLabel =
    status.state === 'connecting'
      ? 'preso em sincronização'
      : status.state === 'qr'
        ? 'à espera de QR'
        : status.state === 'error'
          ? `erro (${status.error || 'desconhecido'})`
          : 'desligado'

  const body = `Estado: ${status.state} (${stateLabel}). Abre /orbit → Configuração → WhatsApp → Reiniciar ligação.`

  await pushAlert({
    type: 'system',
    title: 'WhatsApp pessoal ORBIT fora do ar',
    body,
    notifyHA: false,
    notifyTelegram: true,
  })

  await setOrbitConfig('whatsapp_health_ok', '0')
  console.warn('[whatsappHealthMonitor] Alerta enviado —', stateLabel)
}

export function startWhatsAppHealthMonitor(): void {
  void checkWhatsAppHealth()
  setInterval(() => { void checkWhatsAppHealth() }, POLL_MS)
  console.log('[whatsappHealthMonitor] Activo — verificação cada 1 min')
}
