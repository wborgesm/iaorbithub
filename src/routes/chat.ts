import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { ToolExecutionService, TOOL_DEFINITIONS } from '../services/toolExecution'
import { checkRateLimit } from '../services/rateLimiter'
import { requestApproval } from '../modules/humanApproval'
import { generateReasoning } from '../modules/reactLoop'
import { getRelevantKnowledge, savePendingKnowledge, detectCategory } from '../services/knowledge'
import { callLLMAuto } from '../services/llm'
import { maybeSummarizeSession, getPreviousSummary } from '../modules/sessionSummary'
import { checkFrustration } from '../modules/frustrationDetector'
import { searchMemory } from '../modules/agenticMemory'
import type { LLMMessage, SessionContext, SupportedProvider } from '../types'

const router = Router()
const prisma = new PrismaClient()
const toolService = new ToolExecutionService()

const SUPORTE_PROMPT_TEMPLATE = `Você é um assistente de suporte técnico especializado. Seu objetivo é ajudar clientes a resolver problemas técnicos de forma eficiente e empática.
- Resolva dúvidas sobre rastreamento de veículos, comandos, alertas e faturação
- Use as ferramentas disponíveis para executar acções quando o cliente autorizar
- Seja objetivo, claro e sempre confirme antes de executar acções irreversíveis
- Nunca mencione tecnologias internas (Traccar, etc.)
- Responda sempre no idioma do utilizador
- Se não souber a resposta, diga que vai encaminhar o caso para a equipa de suporte`

const VENDAS_PROMPT_TEMPLATE = `Você é um consultor de vendas especializado. Seu objetivo é ajudar potenciais clientes a encontrar a melhor solução e conduzi-los para uma decisão de compra.
- Apresente benefícios de forma clara e directa
- Supere objeções com argumentos de valor
- Colete informações de contacto (nome, telefone, email) para follow-up
- Nunca execute acções técnicas — foque 100% na conversão
- Responda sempre no idioma do utilizador
- Se pedirem suporte técnico, redirecione gentilmente para a equipa de suporte
- CONCISÃO: adapta sempre o tamanho da resposta ao que o utilizador escreveu — para saudações simples responde com 1-2 frases apenas; só apresentas planos ou detalhes quando explicitamente pedido`

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function getSystemPrompt(agentType: string, customPrompt: string): string {
  if (customPrompt && customPrompt.trim().length > 20) return customPrompt
  return agentType === 'VENDAS' ? VENDAS_PROMPT_TEMPLATE : SUPORTE_PROMPT_TEMPLATE
}

const SendMessageSchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1).max(4000),
})

router.post('/send', async (req: Request, res: Response) => {
  try {
    const parsed = SendMessageSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Pedido inválido', details: parsed.error.issues })
    }

    const { sessionId, message } = parsed.data
    const userId = req.headers['x-user-id'] as string | undefined
    // Memória episódica: resumo de sessões anteriores do mesmo utilizador
    let prevSummary: string | null = null
    const ctx: SessionContext = { sessionId, userId }

    const allowed = await checkRateLimit(`chat:rl:${sessionId}`, 25, 3600)
    if (!allowed) {
      return res.status(429).json({ error: 'Limite de mensagens atingido. Máximo 25 por hora.' })
    }

    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        site: true,
        messages: { orderBy: { createdAt: 'asc' }, take: 50 },
      },
    })
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })

    if (userId) prevSummary = await getPreviousSummary(userId, session.siteId)

    if (!session.site.isActive) {
      console.log(`[chat/send] Site ${session.site.domain} está INACTIVO — pedido interceptado`)
      return res.json({
        content: null,
        offline: true,
        message: 'O assistente de IA está temporariamente indisponível. Por favor contacte-nos directamente.',
        sessionId,
      })
    }

    const userMsg = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'USER',
        content: message,
        tokenCount: estimateTokens(message),
      },
    })

    const agentType = session.site.agentType
    const abSplit = (session.site as any).abSplitPct ?? 0
    const useVariantB = abSplit > 0 && Math.random() * 100 < abSplit && (session.site as any).systemPromptB
    const activePrompt = useVariantB ? (session.site as any).systemPromptB : session.site.systemPrompt
    const baseSystemPrompt = getSystemPrompt(agentType, activePrompt)
    if (useVariantB) {
      void prisma.chatSession.update({ where: { id: sessionId }, data: { abVariant: 'B' } }).catch(() => {})
    }
    const knowledgeContext = await getRelevantKnowledge(session.siteId, message, (session.site as any).factsDocument, (session.site as any).restrictedTopics)
    let systemPrompt = baseSystemPrompt + knowledgeContext

    if (prevSummary) {
      systemPrompt += `\n\n## Contexto de visitas anteriores deste utilizador:\n${prevSummary}`
    }

    const primaryProvider = session.site.activeProvider as SupportedProvider

    const historyMessages: LLMMessage[] = session.messages.map(m => ({
      role: m.role === 'ASSISTANT' ? 'assistant' as const : 'user' as const,
      content: m.content,
    }))

    // ReAct: gera raciocínio interno antes de responder (só se activo no site)
    if ((session.site as any).enableReact) {
      const recentCtx = historyMessages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n')
      const reasoning = await generateReasoning(sessionId, session.siteId, message, recentCtx, primaryProvider)
      if (reasoning) systemPrompt += `\n\n## Raciocínio interno (guia a tua resposta, nunca revelar):\n${reasoning}`
    }

    // Memória: injeta contexto de interacções passadas relevantes
    if ((session.site as any).enableReact) {
      const memories = await searchMemory(message, session.siteId, 3)
      if (memories.length > 0) {
        const memCtx = memories.map(m => `[${m.type}] ${m.content.slice(0, 200)}`).join('\n---\n')
        systemPrompt += `\n\n## Memória de interacções passadas relevantes:\n${memCtx}`
      }
    }

    const availableTools = agentType === 'SUPORTE' && Array.isArray(session.site.availableTools)
      ? session.site.availableTools as string[]
      : []
    const orbitExtraTools = session.site.domain === 'orbit.internal'
      ? ['controlSmartHome', 'sendWhatsApp', 'createCalendarEvent', 'listCalendarEvents', 'listOrbitCapabilities', 'getBankBalance', 'getRecentTransactions', 'readEmails', 'readEmailContent', 'listEmailFolders', 'sendEmail']
      : []
    const mergedToolNames = [...new Set([...availableTools, ...orbitExtraTools])]
    const tools = TOOL_DEFINITIONS.filter(t => mergedToolNames.includes(t.function.name))

    const startTime = Date.now()
    let finalContent = ''
    let promptTokens = 0
    let completionTokens = 0
    let usedProvider = primaryProvider
    let usedModel = ''

    async function callWithFallback(msgs: LLMMessage[], toolDefs?: object[]) {
      const result = await callLLMAuto(msgs, primaryProvider, toolDefs)
      usedProvider = result.usedProvider
      usedModel = result.model
      return result
    }

    if (agentType === 'VENDAS' || tools.length === 0) {
      const msgs: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: message },
      ]
      const result = await callWithFallback(msgs)
      finalContent = result.content ?? ''
      promptTokens = result.promptTokens
      completionTokens = result.completionTokens
    } else {
      const toolListDesc = tools.map(t =>
        `- ${t.function.name}: ${t.function.description}`
      ).join('\n')

      const toolSystemPrompt = `${systemPrompt}

Ferramentas disponíveis (use quando necessário, respondendo com JSON no formato {"tool":"nome","args":{...}} numa linha isolada):
${toolListDesc}

Quando usar uma ferramenta, responda APENAS com o JSON da ferramenta. Após receber o resultado, responda ao utilizador em linguagem natural.`

      let loopHistory: LLMMessage[] = [...historyMessages]
      let loopInput = message
      let iterations = 0

      while (iterations < 5) {
        iterations++
        const msgs: LLMMessage[] = [
          { role: 'system', content: toolSystemPrompt },
          ...loopHistory,
          { role: 'user', content: loopInput },
        ]
        const result = await callWithFallback(msgs, tools)
        promptTokens += result.promptTokens
        completionTokens += result.completionTokens
        const content = result.content ?? ''

        const toolMatch = content.trim().match(/^\{.*"tool"\s*:.*\}$/s)
        if (toolMatch) {
          try {
            const parsed = JSON.parse(toolMatch[0]) as { tool: string; args: Record<string, unknown> }
            // Human-in-the-loop: aguarda aprovação do admin se activo no site
            if ((session.site as any).enableHumanApproval) {
              const approved = await requestApproval(sessionId, session.siteId, parsed.tool, parsed.args)
              if (!approved) {
                finalContent = 'A operação foi cancelada pelo sistema de segurança. Por favor contacte o suporte se precisar de ajuda.'
                break
              }
            }
            const toolResult = await toolService.execute(parsed.tool, parsed.args, ctx, userMsg.id)
            loopHistory = [...loopHistory, { role: 'user', content: loopInput }, { role: 'assistant', content }]
            loopInput = `Resultado da ferramenta ${parsed.tool}: ${JSON.stringify(toolResult)}`
            continue
          } catch { /* not valid JSON, treat as final response */ }
        }

        finalContent = content
        break
      }

      if (!finalContent) finalContent = 'Não foi possível processar o pedido.'
    }

    const latencyMs = Date.now() - startTime

    const assistantMsg = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'ASSISTANT',
        content: finalContent,
        tokenCount: completionTokens,
      },
    })

    await prisma.lLMCallLog.create({
      data: {
        messageId: assistantMsg.id,
        model: usedModel,
        provider: usedProvider,
        promptTokens,
        completionTokens,
        latencyMs,
        requestTruncated: message.substring(0, 500),
        responseTruncated: finalContent.substring(0, 500),
      },
    })

    await prisma.aISite.update({
      where: { id: session.siteId },
      data: { totalTokens: { increment: promptTokens + completionTokens } },
    })

    if (finalContent.length > 60) {
      void savePendingKnowledge({
        siteId: session.siteId,
        trigger: message,
        response: finalContent,
        sourceMessageId: assistantMsg.id,
        category: detectCategory(message + ' ' + finalContent),
      })
    }

    void maybeSummarizeSession(sessionId)
    void checkFrustration(sessionId, session.siteId, [
      ...historyMessages,
      { role: 'user', content: message },
    ])

    return res.json({ content: finalContent, sessionId, agentType, offline: false })
  } catch (err) {
    console.error('[chat/send]', err)
    const e = err as any
    if (e?.status === 429 || e?.message?.includes('não está activo') || e?.message?.includes('sem chave API')) {
      return res.json({
        content: 'Estou com muitos pedidos neste momento. Por favor tente novamente em alguns segundos.',
        sessionId: req.body?.sessionId,
        agentType: null,
        offline: false,
      })
    }
    return res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

router.post('/session', async (req: Request, res: Response) => {
  try {
    const { siteId, userId, pageUrl } = req.body as { siteId: string; userId?: string; pageUrl?: string }
    if (!siteId) return res.status(400).json({ error: 'siteId obrigatório' })

    const site = await prisma.aISite.findUnique({ where: { id: siteId } })
    if (!site) return res.status(404).json({ error: 'Site não encontrado' })

    const session = await prisma.chatSession.create({
      data: { siteId, userId, visitorIp: req.ip, pageUrl },
    })

    return res.json({
      sessionId: session.id,
      isActive: site.isActive,
      agentType: site.agentType,
    })
  } catch (err) {
    console.error('[chat/session]', err)
    return res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

export default router

router.post('/session/domain', async (req: Request, res: Response) => {
  try {
    const { domain, userId, pageUrl } = req.body as { domain: string; userId?: string; pageUrl?: string }
    if (!domain) return res.status(400).json({ error: 'domain obrigatório' })

    const clean = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()
    const site = await prisma.aISite.findFirst({ where: { domain: clean } })
    if (!site) return res.status(404).json({ error: 'Site não configurado' })

    const session = await prisma.chatSession.create({
      data: { siteId: site.id, userId, visitorIp: req.ip, pageUrl },
    })

    return res.json({
      sessionId: session.id,
      siteId: site.id,
      isActive: site.isActive,
      agentType: site.agentType,
    })
  } catch (err) {
    console.error('[chat/session/domain]', err)
    return res.status(500).json({ error: 'Erro interno do servidor' })
  }
})
