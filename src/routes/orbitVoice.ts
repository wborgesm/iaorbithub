import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { callLLMAuto } from '../services/llm'
import { TOOL_DEFINITIONS, ToolExecutionService } from '../services/toolExecution'
import { getOrbitConfig, listOrbitConfigs, normalizeOrbitKey } from '../services/orbitConfig'
import { requireAdminAuth } from '../middleware/adminAuth'
import type { LLMMessage, SessionContext, SupportedProvider } from '../types'

const router = Router()
const prisma = new PrismaClient()
const toolService = new ToolExecutionService()

const ORBIT_DOMAIN = 'orbit.internal'
const ORBIT_TOOL_NAMES = ['controlSmartHome', 'sendWhatsApp', 'createCalendarEvent', 'listOrbitCapabilities', 'getBankBalance', 'getRecentTransactions']
const WELCOME_SPEECH = 'ORBIT online. O que precisas, Wanderson?'
const GOODBYE_SPEECH = 'ORBIT a encerrar. Até logo, Wanderson.'
const EXIT_PHRASES = ['pode ir', 'encerra', 'até logo', 'ate logo', 'obrigado orbit', 'obrigado, orbit']

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function validateOrbitKey(req: Request, res: Response): Promise<boolean> {
  const key = req.headers['x-orbit-key'] as string | undefined
  const expected = await getOrbitConfig('api_key')
  if (!expected || key !== expected) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

async function getOrbitSite() {
  return prisma.aISite.findFirst({ where: { domain: ORBIT_DOMAIN } })
}

async function resolveOrbitSession(sessionId?: string): Promise<string | null> {
  if (sessionId) {
    const existing = await prisma.chatSession.findUnique({ where: { id: sessionId } })
    if (existing) return sessionId
  }
  const site = await getOrbitSite()
  if (!site) return null
  const session = await prisma.chatSession.create({ data: { siteId: site.id } })
  return session.id
}

export async function processOrbitVoiceMessage(
  message: string,
  sessionId?: string,
): Promise<{ reply: string; sessionId: string } | null> {
  const site = await getOrbitSite()
  if (!site || !site.isActive) return null

  const sid = await resolveOrbitSession(sessionId)
  if (!sid) return null

  const session = await prisma.chatSession.findUnique({
    where: { id: sid },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
  })
  if (!session) return null

  const userMsg = await prisma.chatMessage.create({
    data: {
      sessionId: sid,
      role: 'USER',
      content: message,
      tokenCount: estimateTokens(message),
    },
  })

  const systemPrompt = site.systemPrompt?.trim() || 'Tu és o ORBIT, assistente pessoal de Wanderson.'
  const historyMessages: LLMMessage[] = session.messages.map(m => ({
    role: m.role === 'ASSISTANT' ? 'assistant' as const : 'user' as const,
    content: m.content,
  }))

  const siteTools = Array.isArray(site.availableTools) ? (site.availableTools as string[]) : []
  const toolNames = [...new Set([...ORBIT_TOOL_NAMES, ...siteTools])]
  const tools = TOOL_DEFINITIONS.filter(t => toolNames.includes(t.function.name))

  const primaryProvider = site.activeProvider as SupportedProvider
  const ctx: SessionContext = { sessionId: sid }

  let finalContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let usedProvider = primaryProvider
  let usedModel = ''

  async function callWithFallback(msgs: LLMMessage[], toolDefs?: object[]) {
    const result = await callLLMAuto(msgs, primaryProvider, toolDefs)
    usedProvider = result.usedProvider
    usedModel = result.model
    promptTokens += result.promptTokens
    completionTokens += result.completionTokens
    return result
  }

  if (tools.length === 0) {
    const msgs: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message },
    ]
    const result = await callWithFallback(msgs)
    finalContent = result.content ?? ''
  } else {
    const toolListDesc = tools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n')
    const toolSystemPrompt = `${systemPrompt}

Ferramentas disponíveis (use quando necessário, respondendo com JSON no formato {"tool":"nome","args":{...}} numa linha isolada):
${toolListDesc}

Quando usar uma ferramenta, responda APENAS com o JSON da ferramenta. Após receber o resultado, responde ao utilizador em linguagem natural, de forma breve para voz.`

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
      const content = result.content ?? ''

      const toolMatch = content.trim().match(/^\{.*"tool"\s*:.*\}$/s)
      if (toolMatch) {
        try {
          const parsed = JSON.parse(toolMatch[0]) as { tool: string; args: Record<string, unknown> }
          const toolResult = await toolService.execute(parsed.tool, parsed.args, ctx, userMsg.id)
          loopHistory = [...loopHistory, { role: 'user', content: loopInput }, { role: 'assistant', content }]
          loopInput = `Resultado da ferramenta ${parsed.tool}: ${JSON.stringify(toolResult)}`
          continue
        } catch { /* treat as final response */ }
      }

      finalContent = content
      break
    }

    if (!finalContent) finalContent = 'Não foi possível processar o pedido.'
  }

  const assistantMsg = await prisma.chatMessage.create({
    data: {
      sessionId: sid,
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
      latencyMs: 0,
      requestTruncated: message.substring(0, 500),
      responseTruncated: finalContent.substring(0, 500),
    },
  }).catch(() => {})

  return { reply: finalContent, sessionId: sid }
}

function extractGoogleText(body: Record<string, unknown>): string {
  const intent = body.intent as Record<string, unknown> | undefined
  const params = intent?.params as Record<string, unknown> | undefined
  const query = params?.query as Record<string, unknown> | undefined
  if (typeof query?.resolved === 'string') return query.resolved.trim()
  if (typeof query?.original === 'string') return query.original.trim()
  const scene = body.scene as Record<string, unknown> | undefined
  const slots = scene?.slots as Record<string, unknown> | undefined
  const slotQuery = slots?.query as Record<string, unknown> | undefined
  if (typeof slotQuery?.value === 'string') return slotQuery.value.trim()
  return ''
}

function isExitPhrase(text: string): boolean {
  const lower = text.toLowerCase()
  return EXIT_PHRASES.some(p => lower.includes(p))
}

function buildGoogleResponse(
  googleSessionId: string,
  speech: string,
  orbitSessionId: string,
  endConversation: boolean,
) {
  const response: Record<string, unknown> = {
    session: { id: googleSessionId, params: { orbitSessionId } },
    prompt: {
      override: false,
      firstSimple: { speech, text: speech },
    },
  }
  if (!endConversation) {
    response.scene = {
      name: 'ORBIT_conversation',
      slots: {},
      next: { name: 'ORBIT_conversation' },
    }
  }
  return response
}

router.post('/voice', async (req: Request, res: Response) => {
  if (!(await validateOrbitKey(req, res))) return

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  if (!message) return res.status(400).json({ error: 'message obrigatório' })

  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined
  const result = await processOrbitVoiceMessage(message, sessionId)
  if (!result) return res.status(503).json({ error: 'ORBIT indisponível' })

  return res.json(result)
})

router.post('/google-action', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const handler = body.handler as { name?: string } | undefined
  const googleSession = body.session as { id?: string; params?: Record<string, unknown> } | undefined
  const googleSessionId = googleSession?.id || 'google_unknown'
  const orbitSessionId = typeof googleSession?.params?.orbitSessionId === 'string'
    ? googleSession.params.orbitSessionId
    : undefined

  const text = extractGoogleText(body)
  const isMain = handler?.name === 'actions.handler.MAIN' || !text

  if (isMain) {
    const sid = await resolveOrbitSession(orbitSessionId)
    return res.json(buildGoogleResponse(googleSessionId, WELCOME_SPEECH, sid || '', false))
  }

  if (isExitPhrase(text)) {
    return res.json(buildGoogleResponse(googleSessionId, GOODBYE_SPEECH, orbitSessionId || '', true))
  }

  const result = await processOrbitVoiceMessage(text, orbitSessionId)
  if (!result) {
    return res.json(buildGoogleResponse(
      googleSessionId,
      'ORBIT com dificuldades técnicas. Tenta de novo daqui a pouco.',
      orbitSessionId || '',
      false,
    ))
  }

  return res.json(buildGoogleResponse(googleSessionId, result.reply, result.sessionId, false))
})

router.get('/config', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const items = await listOrbitConfigs()
    return res.json({ items })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.post('/config', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body as { key?: string; value?: string }
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key obrigatório' })
    if (typeof value !== 'string' || !value.trim()) return res.status(400).json({ error: 'value obrigatório' })
    const fullKey = normalizeOrbitKey(key)
    if (!fullKey.startsWith('orbit.')) return res.status(400).json({ error: 'Chave inválida' })
    await prisma.systemConfig.upsert({
      where: { key: fullKey },
      update: { value: value.trim() },
      create: { key: fullKey, value: value.trim() },
    })
    return res.json({ ok: true, key: fullKey })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.delete('/config/:key', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const fullKey = normalizeOrbitKey(req.params.key as string)
    if (!fullKey.startsWith('orbit.')) return res.status(400).json({ error: 'Chave inválida' })
    await prisma.systemConfig.delete({ where: { key: fullKey } }).catch(() => {})
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

export default router
