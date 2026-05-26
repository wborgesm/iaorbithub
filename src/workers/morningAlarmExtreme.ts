import { exec } from 'child_process'
import { promisify } from 'util'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { haPlayTts } from '../services/homeAssistantWebhooks'
import { generateMorningBriefingTts } from '../modules/briefingMatinalTts'

const execAsync = promisify(exec)
const SCHEDULE_HOUR = 7
const SCHEDULE_MINUTE = 0
let lastRun = ''

function lisbonKey(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).map(x => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}`
}

function lisbonHM(): { h: number; m: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: 'numeric', minute: 'numeric', hour12: false })
      .formatToParts(new Date()).map(x => [x.type, x.value]),
  )
  return { h: parseInt(p.hour, 10), m: parseInt(p.minute, 10) }
}

async function nightErrorSummary(): Promise<string> {
  try {
    const { stdout } = await execAsync(
      "journalctl -u ai-command-center --since '12 hours ago' --no-pager 2>/dev/null | grep -iE 'error|fatal|exception' | tail -8 || true",
    )
    const lines = stdout.split('\n').filter(Boolean)
    if (lines.length === 0) return 'Sem erros críticos na noite.'
    return `Erros da noite: ${lines.slice(-3).join('. ')}`
  } catch {
    return 'Não foi possível ler logs da noite.'
  }
}

async function runMorningAlarm(): Promise<void> {
  const key = lisbonKey()
  if (lastRun === key) return
  const { h, m } = lisbonHM()
  if (h !== SCHEDULE_HOUR || m !== SCHEDULE_MINUTE) return
  if ((await getOrbitConfig('morning_alarm_done')) === key) return

  lastRun = key
  const errors = await nightErrorSummary()
  const finalText = ((await generateMorningBriefingTts()) + ' ' + errors).slice(0, 1900)

  try {
    await haPlayTts(finalText)
    console.log('[morningAlarmExtreme] TTS matinal enviado ao HA')
  } catch (err) {
    console.warn('[morningAlarmExtreme] TTS falhou (HA não configurado?):', err instanceof Error ? err.message : String(err))
  }
  await setOrbitConfig('morning_alarm_done', key)
  await setOrbitConfig('morning_briefing_tts', finalText)
}

export function startMorningAlarmExtreme(): void {
  void runMorningAlarm()
  setInterval(() => { void runMorningAlarm() }, 60 * 1000)
  console.log('[morningAlarmExtreme] Activo — 07:00 TTS erros + briefing → HA')
}
