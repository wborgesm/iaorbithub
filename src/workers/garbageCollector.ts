import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { Pool } from 'pg'
import { getWhatsAppWebStatus } from '../services/whatsappWeb'

const execAsync = promisify(exec)
const gpsDb = process.env.AUTOTRACK_DATABASE_URL
  ? new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
  : null
const SCHEDULE_HOUR = 3
const SCHEDULE_MINUTE = 0

let lastRunDateKey = ''

function lisbonNow(): { hour: number; minute: number; dateKey: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon',
      hour: 'numeric',
      minute: 'numeric',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    }).formatToParts(new Date()).map(p => [p.type, p.value]),
  )
  return {
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

async function dirSizeMb(dir: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`du -sm "${dir}" 2>/dev/null`)
    return parseInt(stdout.split('\t')[0], 10) || 0
  } catch {
    return 0
  }
}

async function rmDirSafe(dir: string): Promise<number> {
  if (!fs.existsSync(dir)) return 0
  const mb = await dirSizeMb(dir)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return mb
  } catch {
    return 0
  }
}

async function cleanDirOlderThan(dir: string, maxAgeMs: number): Promise<number> {
  if (!fs.existsSync(dir)) return 0
  let freed = 0
  const now = Date.now()
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    try {
      const st = fs.statSync(full)
      if (now - st.mtimeMs > maxAgeMs) {
        if (st.isDirectory()) freed += await rmDirSafe(full)
        else {
          freed += Math.ceil(st.size / 1024 / 1024)
          fs.unlinkSync(full)
        }
      }
    } catch { /* ignore */ }
  }
  return freed
}

/** Retenção automática: logs GPS 15d; posições/telemetria 365d (Traccar) */
export async function runGpsDailyRetentionCleanup(): Promise<{ logs: number; positions: number; telemetry: number }> {
  const empty = { logs: 0, positions: 0, telemetry: 0 }
  if (!gpsDb) return empty
  try {
    const logsRes = await gpsDb.query(
      `DELETE FROM tc_events WHERE eventtime < NOW() - INTERVAL '15 days'`,
    )
    const posRes = await gpsDb.query(
      `DELETE FROM tc_positions WHERE fixtime < NOW() - INTERVAL '365 days'`,
    )
    const telRes = await gpsDb.query(
      `DELETE FROM tc_statistics WHERE capturetime < NOW() - INTERVAL '365 days'`,
    )
    const out = {
      logs: logsRes.rowCount ?? 0,
      positions: posRes.rowCount ?? 0,
      telemetry: telRes.rowCount ?? 0,
    }
    if (out.logs + out.positions + out.telemetry > 0) {
      console.log(`[garbageCollector] GPS retenção — logs:${out.logs} posições:${out.positions} telemetria:${out.telemetry}`)
    }
    return out
  } catch (err) {
    console.warn('[garbageCollector] GPS retenção falhou:', (err as Error).message)
    return empty
  }
}

/** Limpeza manual sob demanda — apaga dados recentes no período indicado */
export async function cleanGpsHistoryManual(input: {
  target?: 'logs' | 'positions' | 'telemetry' | 'all'
  days?: number
  sinceDate?: string
}): Promise<{ deleted: Record<string, number>; error?: string }> {
  if (!gpsDb) return { deleted: {}, error: 'AUTOTRACK_DATABASE_URL não configurado' }

  const target = input.target || 'logs'
  const days = typeof input.days === 'number' && input.days > 0 ? Math.min(input.days, 366) : null
  const sinceDate = typeof input.sinceDate === 'string' && input.sinceDate.trim() ? input.sinceDate.trim() : null

  if (!days && !sinceDate) {
    return { deleted: {}, error: 'Indica days (ex: 3) ou sinceDate (YYYY-MM-DD)' }
  }

  const deleted: Record<string, number> = {}
  const whereRecent = sinceDate
    ? `$1::timestamptz`
    : `NOW() - ($1 || ' days')::INTERVAL`
  const param = sinceDate ? `${sinceDate}T00:00:00Z` : String(days)

  try {
    if (target === 'logs' || target === 'all') {
      const r = await gpsDb.query(
        `DELETE FROM tc_events WHERE eventtime >= ${whereRecent}`,
        [param],
      )
      deleted.logs = r.rowCount ?? 0
    }
    if (target === 'positions' || target === 'all') {
      const r = await gpsDb.query(
        `DELETE FROM tc_positions WHERE fixtime >= ${whereRecent}`,
        [param],
      )
      deleted.positions = r.rowCount ?? 0
    }
    if (target === 'telemetry' || target === 'all') {
      const r = await gpsDb.query(
        `DELETE FROM tc_statistics WHERE capturetime >= ${whereRecent}`,
        [param],
      )
      deleted.telemetry = r.rowCount ?? 0
    }
    console.log('[garbageCollector] GPS limpeza manual:', deleted)
    return { deleted }
  } catch (err) {
    return { deleted: {}, error: err instanceof Error ? err.message : 'Erro na limpeza GPS' }
  }
}

async function cleanPuppeteerChromeVersions(): Promise<number> {
  const base = path.join(process.env.HOME || '/root', '.cache', 'puppeteer', 'chrome')
  if (!fs.existsSync(base)) return 0
  const dirs = fs.readdirSync(base)
    .map(name => {
      const full = path.join(base, name)
      try {
        return { full, mtime: fs.statSync(full).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((x): x is { full: string; mtime: number } => !!x)
    .sort((a, b) => b.mtime - a.mtime)

  let freed = 0
  for (const d of dirs.slice(1)) {
    freed += await rmDirSafe(d.full)
  }
  return freed
}

async function vacuumJournal(): Promise<void> {
  try {
    await execAsync('journalctl --vacuum-time=14d 2>/dev/null || true')
    await execAsync('journalctl --vacuum-size=400M 2>/dev/null || true')
  } catch { /* ignore */ }
}

async function cleanTmpChromium(): Promise<number> {
  let freed = 0
  try {
    const { stdout } = await execAsync('find /tmp -maxdepth 2 -type d \\( -name ".org.chromium.Chromium*" -o -name "puppeteer*" \\) -mtime +2 2>/dev/null || true')
    for (const line of stdout.split('\n').filter(Boolean)) {
      freed += await rmDirSafe(line.trim())
    }
  } catch { /* ignore */ }
  return freed
}

export async function runGarbageCollection(): Promise<{ freedMb: number }> {
  let freedMb = 0
  const wa = getWhatsAppWebStatus()

  freedMb += await cleanDirOlderThan(path.join(process.cwd(), 'data', 'snapshots'), 30 * 86400000)
  freedMb += await cleanDirOlderThan(path.join(process.cwd(), 'data', 'memory'), 60 * 86400000)
  freedMb += await cleanPuppeteerChromeVersions()
  freedMb += await cleanTmpChromium()

  if (wa.state !== 'ready') {
    const sessionCache = path.join(process.cwd(), 'data', 'orbit-personal-whatsapp')
    for (const name of fs.existsSync(sessionCache) ? fs.readdirSync(sessionCache) : []) {
      const cacheDir = path.join(sessionCache, name, 'Default', 'Cache')
      if (fs.existsSync(cacheDir)) freedMb += await rmDirSafe(cacheDir)
    }
  }

  await vacuumJournal()
  await runGpsDailyRetentionCleanup()
  console.log(`[garbageCollector] Faxina concluída — ~${freedMb} MB libertados`)
  return { freedMb }
}

async function tick(): Promise<void> {
  const { hour, minute, dateKey } = lisbonNow()
  if (hour !== SCHEDULE_HOUR || minute !== SCHEDULE_MINUTE) return
  if (lastRunDateKey === dateKey) return
  lastRunDateKey = dateKey
  try {
    await runGarbageCollection()
  } catch (err) {
    console.error('[garbageCollector] Erro:', err)
    lastRunDateKey = ''
  }
}

export function startGarbageCollector(): void {
  void tick()
  setInterval(() => { void tick() }, 60 * 1000)
  console.log('[garbageCollector] Scheduler activo (03:00 Europe/Lisbon)')
}
