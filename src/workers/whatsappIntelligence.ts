import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'
import { callLLMAuto } from '../services/llm'

const INTERVAL_MS = 60 * 60 * 1000 // 1 hora

interface ChatMessage { from: string; body: string; timestamp: number; isMe: boolean }

async function readChatsFromAccount(
  getRecentFn: (limit: number) => Promise<{ ok: boolean; messages?: ChatMessage[]; error?: string }>,
  label: string,
  chatsLimit = 50,
): Promise<string> {
  const result = await getRecentFn(chatsLimit)
  if (!result.ok || !result.messages?.length) return `[${label}] sem mensagens ou não ligado`

  const lines = result.messages.map(m => {
    const time = new Date(m.timestamp * 1000).toLocaleString('pt-PT', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    const dir = m.isMe ? '→' : '←'
    return `${dir} ${m.from} [${time}]: ${m.body.slice(0, 200)}`
  })
  return `[${label}]\n${lines.join('\n')}`
}

async function buildWeeklyContext(): Promise<void> {
  const { getRecentWhatsAppMessages: getPersonal } = await import('../services/whatsappWeb')
  const personalRaw = await readChatsFromAccount(getPersonal, 'PESSOAL', 50)

  let businessRaw = '[NEGÓCIO] não activado'
  if (process.env.WHATSAPP_BUSINESS_ENABLED === 'true') {
    const { getRecentWhatsAppMessages: getBusiness } = await import('../services/whatsappBusiness')
    businessRaw = await readChatsFromAccount(getBusiness, 'NEGÓCIO', 50)
  }

  const allMessages = `${personalRaw}\n\n${businessRaw}`

  const prompt = `Analisa estas mensagens de WhatsApp do Wanderson (pessoal e negócio) dos últimos dias e extrai um resumo conciso para o assistente ORBIT ficar contextualizado.

MENSAGENS:
${allMessages.slice(0, 6000)}

Devolve um resumo estruturado assim (máximo 400 palavras):
CONVERSAS ACTIVAS: [quem está a falar com ele, sobre o quê]
PENDENTE/SEM RESPOSTA: [mensagens que parecem precisar de resposta]
TÓPICOS RELEVANTES: [assuntos importantes mencionados esta semana]
CONTACTOS FREQUENTES: [quem contacta mais esta semana]`

  try {
    const result = await callLLMAuto(
      [{ role: 'user', content: prompt }],
      'GROQ',
    )
    const summary = result.content?.trim()
    if (summary && summary.length > 50) {
      await setOrbitConfig('whatsapp_weekly_context', summary)
      await setOrbitConfig('whatsapp_weekly_context_updated', new Date().toISOString())
      console.log('[whatsappIntelligence] Contexto semanal actualizado')
    }
  } catch (err) {
    console.warn('[whatsappIntelligence] Erro ao gerar contexto:', (err as Error).message)
  }
}

export function startWhatsAppIntelligence(): void {
  setTimeout(() => { void buildWeeklyContext() }, 2 * 60 * 1000)
  setInterval(() => { void buildWeeklyContext() }, INTERVAL_MS)
  console.log('[whatsappIntelligence] Activo — resumo horário pessoal + negócio')
}

export { buildWeeklyContext }
