import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'

const HABIT_KEY = 'habit_trust'
const THRESHOLD = 3

type HabitMap = Record<string, number>

async function loadHabits(): Promise<HabitMap> {
  const raw = await getOrbitConfig(HABIT_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as HabitMap
  } catch {
    return {}
  }
}

async function saveHabits(map: HabitMap): Promise<void> {
  await setOrbitConfig(HABIT_KEY, JSON.stringify(map))
}

/** Chave estável por tipo de acção (ex.: ligar luz sala) */
export function habitSignature(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'controlSmartHome') {
    return `${toolName}:${String(args.device || '').toLowerCase()}:${String(args.action || 'on')}`
  }
  if (toolName === 'createCalendarEvent') {
    return `${toolName}:${String(args.title || '').toLowerCase().slice(0, 60)}`
  }
  if (toolName === 'sendWhatsApp') {
    return `${toolName}:${String(args.to || '').toLowerCase()}`
  }
  return `${toolName}:${JSON.stringify(args).slice(0, 100)}`
}

export async function isHabitTrusted(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  const map = await loadHabits()
  const key = habitSignature(toolName, args)
  return (map[key] || 0) >= THRESHOLD
}

/** Após o utilizador aprovar a mesma acção várias vezes, deixa de pedir confirmação */
export async function recordHabitApproval(toolName: string, args: Record<string, unknown>): Promise<number> {
  const map = await loadHabits()
  const key = habitSignature(toolName, args)
  const next = (map[key] || 0) + 1
  map[key] = next
  await saveHabits(map)
  if (next === THRESHOLD) {
    console.log(`[orbitHabits] Confiança automática: ${key}`)
  }
  return next
}

export async function listTrustedHabits(): Promise<Array<{ key: string; count: number }>> {
  const map = await loadHabits()
  return Object.entries(map)
    .filter(([, c]) => c >= THRESHOLD)
    .map(([key, count]) => ({ key, count }))
}
