import { appendMemoryEntry } from './agenticMemory'
import { sendAlert } from '../services/emailService'
import { PrismaClient } from '@prisma/client'

const SIGNALS = [
  'não funciona','nao funciona','não consigo','nao consigo',
  'problema','erro','bug','ajuda','help','urgente','urgent',
  'já disse','ja disse','quantas vezes','ridiculo','ridículo',
  'péssimo','pessimo','horrivel','horrível','inaceitável','inaceitavel',
  "doesn't work",'not working',
]

// Auto-anotação OrbitAuditLog (módulo 42 — desbloqueio do reflectionWorker)
const GRATITUDE_SIGNALS = [
  'obrigado','obrigada','obg','perfeito','perfeita','boa','excelente',
  'óptimo','optimo','fixe','thanks','thank you','great','top',
  'maravilha','espectacular','espetacular','muito bom','bom trabalho',
]

const _annotPrisma = new PrismaClient()

async function autoAnnotateLatestAuditLog(
  sessionId: string,
  outcome: 'missed' | 'correct',
  reason: string,
): Promise<void> {
  try {
    const log = await _annotPrisma.orbitAuditLog.findFirst({
      where: { sessionId, outcome: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!log) return
    await _annotPrisma.orbitAuditLog.update({
      where: { id: log.id },
      data: {
        outcome,
        feedback: reason,
        reviewedAt: new Date(),
      },
    })
  } catch (err) {
    console.warn('[frustration] auto-annotate falhou:', (err as Error).message)
  }
}

function detectGratitude(text: string): boolean {
  const lower = text.toLowerCase()
  return GRATITUDE_SIGNALS.some(g => {
    if (g.includes(' ')) return lower.includes(g)
    const re = new RegExp(`(^|[^a-záéíóúâêôãõç])${g}([^a-záéíóúâêôãõç]|$)`, 'i')
    return re.test(lower)
  })
}

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

    // Auto-anotação de gratidão — sempre que a última mensagem do user agradeça,
    // marca a acção anterior do ORBIT como 'correct'. Corre independentemente do score.
    const lastUserMsg = [...messages].reverse().find(m => (m.role || '').toLowerCase() === 'user')
    if (lastUserMsg && detectGratitude(lastUserMsg.content || '')) {
      void autoAnnotateLatestAuditLog(sessionId, 'correct', 'auto: gratitude detected')
    }

    if (score < 3) return

    void appendMemoryEntry({
      type: 'insight',
      sessionId,
      siteId,
      input: `Frustração detectada (score: ${score})`,
      output: messages.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n'),
      metadata: { score, alertedAt: new Date().toISOString() },
    })

    // Auto-anota a acção mais recente do ORBIT nesta sessão como 'missed'.
    void autoAnnotateLatestAuditLog(sessionId, 'missed', `auto: frustration score ${score}`)

    console.warn(`[frustration] score=${score} sessão=${sessionId}`)

    const lastMsgs = messages.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')
    void sendAlert(
      `Frustração detectada — score ${score} (sessão ${sessionId})`,
      `Site: ${siteId}\nScore: ${score}\n\nÚltimas mensagens:\n${lastMsgs}`,
    )
  } catch (err) {
    console.warn('[frustration] Falhou:', (err as Error).message)
  }
}
