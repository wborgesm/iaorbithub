import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { killOrphanChrome } from '../services/whatsappWeb'

const execAsync = promisify(exec)
const POLL_MS = 60 * 1000
const RAM_THRESHOLD_PCT = 85
const DISK_WARN_PCT = 92
let infraAlertSent = false
let diskWarnSent = false

async function getRamUsedPct(): Promise<number> {
  try {
    const mem = fs.readFileSync('/proc/meminfo', 'utf8')
    const total = parseInt(mem.match(/MemTotal:\s+(\d+)/)?.[1] || '0', 10)
    const avail = parseInt(mem.match(/MemAvailable:\s+(\d+)/)?.[1] || '0', 10)
    if (!total) return 0
    return Math.round(((total - avail) / total) * 100)
  } catch {
    return 0
  }
}

async function getDiskUsedPct(): Promise<number> {
  try {
    const { stdout } = await execAsync("df / --output=pcent | tail -1 | tr -dc '0-9'")
    return parseInt(stdout, 10) || 0
  } catch {
    return 0
  }
}

async function checkInfraPressure(): Promise<void> {
  const ram = await getRamUsedPct()
  const disk = await getDiskUsedPct()

  // Disco alto: só alerta (matar Chrome nao liberta disco)
  if (disk >= DISK_WARN_PCT && !diskWarnSent) {
    diskWarnSent = true
    console.warn(`[systemHealthMonitor] Disco critico: ${disk}% — limpar manualmente`)
  } else if (disk < DISK_WARN_PCT) {
    diskWarnSent = false
  }

  // RAM alta: matar Chrome orfao (~400-500 MB)
  if (ram < RAM_THRESHOLD_PCT) {
    infraAlertSent = false
    return
  }

  console.warn(`[systemHealthMonitor] RAM=${ram}% disco=${disk}% — kill Chromium orfao ORBIT`)
  await killOrphanChrome()

  if (!infraAlertSent) {
    infraAlertSent = true
    console.warn('[systemHealthMonitor] Faxina Chromium ORBIT executada (Autotrack/whatsapp empresarial nao afectado)')
  }
}

export function startSystemHealthMonitor(): void {
  void checkInfraPressure()
  setInterval(() => { void checkInfraPressure() }, POLL_MS)
  console.log('[systemHealthMonitor] Activo — RAM>=85% dispara kill Chromium ORBIT')
}
