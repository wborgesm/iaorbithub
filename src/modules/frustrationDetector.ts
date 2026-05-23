import { appendMemoryEntry } from './agenticMemory'

const SIGNALS = [
  'não funciona','nao funciona','não consigo','nao consigo',
  'problema','erro','bug','ajuda','help','urgente','urgent',
  'já disse','ja disse','quantas vezes','ridiculo','ridículo',
  'péssimo','pessimo','horrivel','horrível','inaceitável','inaceitavel',
  "doesn't work",'not working',
]

export function scoreFrustration(messages: Array<{ role: string; content: string }>): number {
  const userMsgs = messages.filter(m => m.role === 'USER' || m.role === 'user')
  if (userMsgs.length < 2) return 0

  const recent = userMsgs.slice(-5)
  let score = 0

  for (const msg of recent) {
    const lower = msg.content.toLowerCase()
    for (const signal of SIGNALS) {
      if (lower.includes(signal)) score += 1
    }
  }

  // Penaliza repetição da mesma pergunta
  const texts = recent.map(m => m.content.toLowerCase().slice(0, 60))
  const unique = new Set(texts)
  if (unique.size < texts.length * 0.6) score += 2

  return score
}

export async function checkFrustration(
  sessionId: string,
  siteId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  try {
    const score = scoreFrustration(messages)
    if (score < 3) return

    void appendMemoryEntry({
      type: 'insight',
      sessionId,
      siteId,
      input: `Frustração detectada (score: ${score})`,
      output: messages.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n'),
      metadata: { score, alertedAt: new Date().toISOString() },
    })

    console.warn(`[frustration] score=${score} sessão=${sessionId}`)
  } catch (err) {
    console.warn('[frustration] Falhou:', (err as Error).message)
  }
}
