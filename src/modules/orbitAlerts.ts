import crypto from 'crypto'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { notifyHomeAssistant } from '../services/homeAssistant'
import { sendTelegramNotification } from '../services/telegramNotify'
import { isFocusModeActive, queueNonVipMessage } from './focusMode'

export interface OrbitAlert {
  id: string
  type: 'email' | 'calendar' | 'system' | 'home'
  title: string
  body: string
  createdAt: string
  read: boolean
}

const ALERTS_KEY = 'alerts'
const MAX_ALERTS = 50

async function loadAlerts(): Promise<OrbitAlert[]> {
  try {
    const raw = await getOrbitConfig(ALERTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as OrbitAlert[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveAlerts(alerts: OrbitAlert[]): Promise<void> {
  await setOrbitConfig(ALERTS_KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS)))
}

export async function pushAlert(input: {
  type: OrbitAlert['type']
  title: string
  body: string
  notifyHA?: boolean
  notifyTelegram?: boolean
  vip?: boolean
}): Promise<OrbitAlert> {
  if (isFocusModeActive() && !input.vip && input.type !== 'system') {
    queueNonVipMessage('orbit-panel', `${input.title}: ${input.body}`)
    return {
      id: crypto.randomUUID(),
      type: input.type,
      title: input.title,
      body: input.body,
      createdAt: new Date().toISOString(),
      read: true,
    }
  }
  const alerts = await loadAlerts()
  const dup = alerts.find(a => !a.read && a.title === input.title && a.body === input.body)
  if (dup) return dup

  const alert: OrbitAlert = {
    id: crypto.randomUUID(),
    type: input.type,
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
    read: false,
  }
  alerts.unshift(alert)
  await saveAlerts(alerts)

  if (input.notifyHA !== false) {
    void notifyHomeAssistant(`ORBIT: ${input.title}`, input.body)
  }

  if (input.notifyTelegram) {
    void sendTelegramNotification(`ORBIT: ${input.title}\n${input.body}`)
  }

  console.log(`[orbitAlerts] ${input.type}: ${input.title}`)
  return alert
}

export async function listAlerts(unreadOnly = false): Promise<OrbitAlert[]> {
  const alerts = await loadAlerts()
  return unreadOnly ? alerts.filter(a => !a.read) : alerts
}

export async function markAlertRead(id: string): Promise<boolean> {
  const alerts = await loadAlerts()
  const a = alerts.find(x => x.id === id)
  if (!a) return false
  a.read = true
  await saveAlerts(alerts)
  return true
}

export async function markAllAlertsRead(): Promise<void> {
  const alerts = await loadAlerts()
  for (const a of alerts) a.read = true
  await saveAlerts(alerts)
}

export async function getUnreadCount(): Promise<number> {
  return (await listAlerts(true)).length
}
