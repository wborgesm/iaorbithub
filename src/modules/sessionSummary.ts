import { PrismaClient } from '@prisma/client'
import { callLLMAuto } from '../services/llm'
import { saveMemoryVector } from './agenticMemory'
import type { LLMMessage } from '../types'

const prisma = new PrismaClient()
const MIN_MESSAGES = 6

export async function maybeSummarizeSession(sessionId: string): Promise<void> {
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } }, site: true },
    })
    if (!session || session.messages.length < MIN_MESSAGES) return

    const transcript = session.messages
      .map(m => `${m.role === 'USER' ? 'Cliente' : 'Agente'}: ${m.content}`)
      .join('\n')

    const msgs: LLMMessage[] = [
      {
        role: 'system',
        content: 'Faz um resumo conciso desta conversa de suporte em 3-5 frases. Inclui: o problema do cliente, como foi resolvido, e informação útil para futuras interacções.',
      },
      { role: 'user', content: transcript.slice(0, 6000) },
    ]

    const result = await callLLMAuto(msgs)
    if (!result.content) return

    await saveMemoryVector({
      siteId: session.siteId,
      sessionId,
      type: 'session_summary',
      content: result.content,
      metadata: {
        userId: session.userId,
        messageCount: session.messages.length,
        domain: session.site.domain,
      },
    })
  } catch (err) {
    console.warn('[sessionSummary] Falhou:', (err as Error).message)
  }
}

export async function getPreviousSummary(userId: string, siteId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ content: string }>>`
      SELECT mv.content
      FROM "MemoryVector" mv
      JOIN "ChatSession" cs ON cs.id = mv."sessionId"
      WHERE mv."siteId" = ${siteId}
        AND cs."userId" = ${userId}
        AND mv.type = 'session_summary'
      ORDER BY mv."createdAt" DESC
      LIMIT 1
    `
    return rows[0]?.content ?? null
  } catch {
    return null
  }
}
