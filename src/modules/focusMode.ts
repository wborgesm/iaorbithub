import { getOrbitConfig } from '../services/orbitConfig'

let focusActive = false
const queuedNonVip: Array<{ from: string; preview: string; at: string }> = []

export function isFocusModeActive(): boolean {
  return focusActive
}

export function setFocusMode(active: boolean): void {
  focusActive = active
  if (!active) queuedNonVip.length = 0
  console.log(`[focusMode] ${active ? 'ACTIVO' : 'desactivado'}`)
}

export function shouldAllowOrbitNotification(isVip: boolean): boolean {
  if (!focusActive) return true
  return isVip
}

export function queueNonVipMessage(from: string, preview: string): void {
  if (!focusActive) return
  queuedNonVip.push({ from, preview, at: new Date().toISOString() })
  if (queuedNonVip.length > 100) queuedNonVip.shift()
}

export function getQueuedNonVipMessages(): typeof queuedNonVip {
  return [...queuedNonVip]
}

export async function getVipContacts(): Promise<Set<string>> {
  const raw = await getOrbitConfig('vip_contacts')
  const nums = raw.split(/[,;\s]+/).map(s => s.replace(/\D/g, '')).filter(Boolean)
  return new Set(nums)
}

export async function isVipPhone(phone: string): Promise<boolean> {
  const digits = phone.replace(/\D/g, '')
  const vips = await getVipContacts()
  for (const v of vips) {
    if (digits.endsWith(v) || v.endsWith(digits)) return true
  }
  return false
}
