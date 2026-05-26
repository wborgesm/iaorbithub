import { getOrbitConfig } from './orbitConfig'

export async function sendPushoverNotification(title: string, body: string, priority = 1): Promise<boolean> {
  const token = (await getOrbitConfig('pushover_token')).trim()
  const user = (await getOrbitConfig('pushover_user')).trim()
  if (!token || !user) return false

  try {
    const params = new URLSearchParams({
      token,
      user,
      title: title.slice(0, 250),
      message: body.slice(0, 1024),
      priority: String(priority),
      sound: 'siren',
    })
    const res = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      body: params,
    })
    return res.ok
  } catch {
    return false
  }
}

export async function sendCriticalWatchAlert(title: string, body: string): Promise<void> {
  const { sendTelegramNotification } = await import('./telegramNotify')
  const watchText = `🚨 ORBIT CRÍTICO\n${title}\n\n${body}`
  await sendTelegramNotification(watchText)
  await sendPushoverNotification(title, body, 2)
}
