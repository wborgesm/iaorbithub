import { exec } from 'child_process'
import { promisify } from 'util'
import { sendCriticalWatchAlert } from '../services/pushoverNotify'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'

const execAsync = promisify(exec)
const POLL_MS = 5 * 60 * 1000

async function fetchFatalLogs(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      "journalctl -u ai-command-center --since '10 min ago' --no-pager 2>/dev/null | grep -iE 'fatal|FATAL|panic|segfault' | grep -v 'criticalAlertMonitor' | tail -20 || true",
    )
    return stdout.split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function checkCriticalErrors(): Promise<void> {
  const lines = await fetchFatalLogs()
  if (lines.length === 0) return

  const fingerprint = lines.join('|').slice(0, 500)
  const prev = await getOrbitConfig('critical_error_hash')
  if (prev === fingerprint) return
  await setOrbitConfig('critical_error_hash', fingerprint)

  const body = lines.slice(-5).join('\n')
  await sendCriticalWatchAlert('Erro fatal no ORBIT', body)
  console.warn('[criticalAlertMonitor] Alerta fatal enviado')
}

export function startCriticalAlertMonitor(): void {
  void checkCriticalErrors()
  setInterval(() => { void checkCriticalErrors() }, POLL_MS)
  console.log('[criticalAlertMonitor] Activo — fatal → Telegram/Pushover')
}
