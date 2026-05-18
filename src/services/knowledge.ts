import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Categories that are safe to share globally (no company-specific data)
const GLOBAL_SAFE_CATEGORIES = ['greeting', 'error_recovery', 'apology', 'transition', 'objection_handling', 'closing']

export type KnowledgeEntryInput = {
  siteId: string
  trigger: string
  response: string
  originalResponse?: string
  sourceMessageId?: string
  category?: string
}

// Auto-detect category from text
export function detectCategory(text: string): string {
  const lower = text.toLowerCase()
  if (/\b(olá|bom dia|boa tarde|boa noite|hello|hi\b|saudação|obrigad)/.test(lower)) return 'greeting'
  if (/\b(desculpe|lamentamos|erro|falha|problema|não funciona|indisponível)/.test(lower)) return 'error_recovery'
  if (/\b(preço|plano|€|custo|mensalidade|subscrição|pagamento)/.test(lower)) return 'pricing'
  if (/\b(como|passo|instrução|configurar|tutorial|procedimento)/.test(lower)) return 'procedure'
  if (/\b(objeção|mas|porquê|caro|não preciso|já tenho)/.test(lower)) return 'objection_handling'
  if (/\b(até logo|adeus|tchau|encerrar|fechar|despedida)/.test(lower)) return 'closing'
  return 'general'
}

// Retrieve relevant knowledge for a site + query
export async function getRelevantKnowledge(siteId: string, query: string): Promise<string> {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (words.length === 0) return ''

  // Fetch approved private (this site) + approved global
  const [privateEntries, globalEntries] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where: {
        siteId,
        status: 'APPROVED',
        scope: 'PRIVATE',
      },
      orderBy: { useCount: 'desc' },
      take: 40,
    }),
    prisma.knowledgeEntry.findMany({
      where: {
        status: 'APPROVED',
        scope: 'GLOBAL',
      },
      orderBy: { useCount: 'desc' },
      take: 40,
    }),
  ])

  // Simple relevance: count keyword overlaps
  function score(entry: { trigger: string; response: string }): number {
    const hay = (entry.trigger + ' ' + entry.response).toLowerCase()
    return words.filter(w => hay.includes(w)).length
  }

  const scored = [
    ...privateEntries.map(e => ({ entry: e, score: score(e), isGlobal: false })),
    ...globalEntries.map(e => ({ entry: e, score: score(e), isGlobal: true })),
  ]
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  if (scored.length === 0) return ''

  // Increment use count for matched entries
  const ids = scored.map(x => x.entry.id)
  await prisma.knowledgeEntry.updateMany({
    where: { id: { in: ids } },
    data: { useCount: { increment: 1 } },
  }).catch(() => {})

  const lines = scored.map(x =>
    `[Quando: "${x.entry.trigger.slice(0, 120)}"]\nResposta aprovada: "${x.entry.response.slice(0, 400)}"`
  )

  return `\n\n## Exemplos de respostas aprovadas (use como referência de qualidade):\n${lines.join('\n\n')}`
}

// Save an AI response as a PENDING knowledge candidate
export async function savePendingKnowledge(input: KnowledgeEntryInput): Promise<void> {
  const category = input.category || detectCategory(input.response)
  await prisma.knowledgeEntry.create({
    data: {
      siteId: input.siteId,
      scope: 'PRIVATE',
      status: 'PENDING',
      category,
      trigger: input.trigger.slice(0, 500),
      response: input.response.slice(0, 2000),
      originalResponse: input.originalResponse?.slice(0, 2000),
      sourceMessageId: input.sourceMessageId,
    },
  }).catch(() => {})
}

// Called from admin when promoting a PENDING entry that should be global
export async function promoteToGlobal(entryId: string): Promise<boolean> {
  const entry = await prisma.knowledgeEntry.findUnique({ where: { id: entryId } })
  if (!entry) return false
  if (!GLOBAL_SAFE_CATEGORIES.includes(entry.category)) return false
  await prisma.knowledgeEntry.update({
    where: { id: entryId },
    data: { scope: 'GLOBAL', siteId: null },
  })
  return true
}
