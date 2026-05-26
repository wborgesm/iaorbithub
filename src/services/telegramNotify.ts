import { getOrbitConfig } from './orbitConfig'

/** Notificação opcional via Telegram Bot API */
export async function sendTelegramNotification(text: string): Promise<boolean> {
  const token = (await getOrbitConfig('telegram_bot_token')).trim()
  const chatId = (await getOrbitConfig('telegram_chat_id')).trim()
  if (!token || !chatId) return false

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[telegramNotify]', (err as Error).message)
    return false
  }
}

export async function isTelegramConfigured(): Promise<boolean> {
  const token = await getOrbitConfig('telegram_bot_token')
  const chatId = await getOrbitConfig('telegram_chat_id')
  return !!(token && chatId)
}
