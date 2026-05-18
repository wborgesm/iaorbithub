import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

// Stats overview
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [sites, sessions, messages, simulations, logs] = await Promise.all([
      prisma.aISite.count(),
      prisma.chatSession.count(),
      prisma.chatMessage.count(),
      prisma.userSimulation.groupBy({ by: ['status'], _count: true }),
      prisma.lLMCallLog.aggregate({ _sum: { promptTokens: true, completionTokens: true } }),
    ])
    const today = new Date(); today.setHours(0,0,0,0)
    const [sessionsToday, messagesDoday] = await Promise.all([
      prisma.chatSession.count({ where: { createdAt: { gte: today } } }),
      prisma.chatMessage.count({ where: { createdAt: { gte: today } } }),
    ])
    const simByStatus = Object.fromEntries(simulations.map(s => [s.status, s._count]))
    return res.json({
      sites, sessions, sessionsToday, messages, messagesToday: messagesDoday,
      simulations: { total: simulations.reduce((a, s) => a + s._count, 0), ...simByStatus },
      totalTokens: (logs._sum.promptTokens || 0) + (logs._sum.completionTokens || 0),
    })
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar estatísticas' })
  }
})

// Sites CRUD
router.get('/sites', async (_req: Request, res: Response) => {
  const sites = await prisma.aISite.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(sites)
})

router.post('/sites', async (req: Request, res: Response) => {
  try {
    const site = await prisma.aISite.create({ data: req.body })
    return res.status(201).json(site)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.put('/sites/:id', async (req: Request, res: Response) => {
  try {
    const site = await prisma.aISite.update({ where: { id: req.params.id as string }, data: req.body })
    return res.json(site)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.delete('/sites/:id', async (req: Request, res: Response) => {
  try {
    await prisma.aISite.delete({ where: { id: req.params.id as string } })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})


// PATCH /config/:id — toggle isActive, agentType, geminiModel, systemPrompt, availableTools
router.patch('/config/:id', async (req: Request, res: Response) => {
  try {
    const allowed = ['isActive', 'agentType', 'geminiModel', 'activeProvider', 'systemPrompt', 'availableTools']
    const data: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in req.body) data[key] = req.body[key]
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nenhum campo válido' })
    const site = await prisma.aISite.update({ where: { id: req.params.id as string }, data })
    return res.json(site)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

// Scenarios CRUD
router.get('/scenarios', async (_req: Request, res: Response) => {
  const scenarios = await prisma.trainingScenario.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(scenarios)
})

router.post('/scenarios', async (req: Request, res: Response) => {
  try {
    const s = await prisma.trainingScenario.create({ data: req.body })
    return res.status(201).json(s)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.put('/scenarios/:id', async (req: Request, res: Response) => {
  try {
    const s = await prisma.trainingScenario.update({ where: { id: req.params.id as string }, data: req.body })
    return res.json(s)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.delete('/scenarios/:id', async (req: Request, res: Response) => {
  try {
    await prisma.trainingScenario.delete({ where: { id: req.params.id as string } })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

// Simulations list
router.get('/simulations', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string || '1')
  const limit = 20
  const [items, total] = await Promise.all([
    prisma.userSimulation.findMany({
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { scenario: { select: { title: true, brand: true } } },
    }),
    prisma.userSimulation.count(),
  ])
  return res.json({ items, total, page, pages: Math.ceil(total / limit) })
})

router.get('/simulations/:id', async (req: Request, res: Response) => {
  const sim = await prisma.userSimulation.findUnique({
    where: { id: req.params.id as string },
    include: { scenario: true, messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!sim) return res.status(404).json({ error: 'Não encontrado' })
  return res.json(sim)
})

// LLM Logs
router.get('/logs', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string || '1')
  const limit = 30
  const [items, total] = await Promise.all([
    prisma.lLMCallLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.lLMCallLog.count(),
  ])
  return res.json({ items, total, page, pages: Math.ceil(total / limit) })
})


// ─── PROVIDER CONFIGS ─────────────────────────────────────────────────────────
router.get('/providers', async (_req: Request, res: Response) => {
  const rows = await prisma.providerConfig.findMany({ orderBy: { provider: 'asc' } })
  // Mask keys — return only last 6 chars
  const masked = rows.map(r => ({
    ...r,
    apiKey: r.apiKey ? '••••••••' + r.apiKey.slice(-6) : '',
    hasKey: r.apiKey.length > 0,
  }))
  return res.json(masked)
})

router.put('/providers/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params
    const { apiKey, isEnabled, model } = req.body as { apiKey?: string; isEnabled?: boolean; model?: string }
    const data: Record<string, unknown> = {}
    if (typeof isEnabled === 'boolean') data.isEnabled = isEnabled
    if (typeof model === 'string' && model) data.model = model
    if (typeof apiKey === 'string') {
      // if starts with bullets, don't overwrite (user didn't change it)
      if (!apiKey.startsWith('••')) data.apiKey = apiKey
    }
    const row = await prisma.providerConfig.upsert({
      where: { provider: provider as any },
      update: data,
      create: {
        provider: provider as any,
        apiKey: (data.apiKey as string) ?? '',
        isEnabled: (data.isEnabled as boolean) ?? false,
        model: (data.model as string) ?? '',
      },
    })
    // Invalidate service cache
    const { invalidateProviderCache } = await import('../services/providerConfig')
    invalidateProviderCache(provider as string)
    return res.json({
      ...row,
      apiKey: row.apiKey ? '••••••••' + row.apiKey.slice(-6) : '',
      hasKey: row.apiKey.length > 0,
    })
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})


// ─── KNOWLEDGE BASE ───────────────────────────────────────────────────────────

// List knowledge entries — pending review or approved, filterable by site
router.get('/knowledge', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'PENDING'
    const siteId = req.query.siteId as string | undefined
    const scope = req.query.scope as string | undefined
    const page = parseInt(req.query.page as string || '1')
    const limit = 30

    const where: Record<string, unknown> = { status }
    if (siteId) where.siteId = siteId
    if (scope) where.scope = scope
    // For PENDING: show site entries only (not global pending)
    if (status === 'PENDING' && !siteId) where.siteId = { not: null }

    const [items, total] = await Promise.all([
      prisma.knowledgeEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { site: { select: { domain: true, brand: true } } },
      }),
      prisma.knowledgeEntry.count({ where }),
    ])
    return res.json({ items, total, page, pages: Math.ceil(total / limit) })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

// Get stats for knowledge dashboard
router.get('/knowledge/stats', async (_req: Request, res: Response) => {
  try {
    const [pending, approved, global_, sites] = await Promise.all([
      prisma.knowledgeEntry.count({ where: { status: 'PENDING' } }),
      prisma.knowledgeEntry.count({ where: { status: 'APPROVED' } }),
      prisma.knowledgeEntry.count({ where: { status: 'APPROVED', scope: 'GLOBAL' } }),
      prisma.aISite.findMany({ select: { id: true, domain: true, brand: true } }),
    ])
    const perSite = await Promise.all(sites.map(async s => ({
      siteId: s.id,
      domain: s.domain,
      brand: s.brand,
      approved: await prisma.knowledgeEntry.count({ where: { siteId: s.id, status: 'APPROVED' } }),
      pending: await prisma.knowledgeEntry.count({ where: { siteId: s.id, status: 'PENDING' } }),
    })))
    return res.json({ pending, approved, global: global_, perSite })
  } catch (err) {
    return res.status(500).json({ error: 'Erro' })
  }
})

// Create knowledge entry manually (from admin)
router.post('/knowledge', async (req: Request, res: Response) => {
  try {
    const { siteId, trigger, response, category, scope } = req.body
    if (!trigger || !response) return res.status(400).json({ error: 'trigger e response obrigatórios' })
    const entry = await prisma.knowledgeEntry.create({
      data: {
        siteId: siteId || null,
        scope: scope || 'PRIVATE',
        status: 'APPROVED',
        category: category || 'general',
        trigger,
        response,
        editedBy: 'admin',
      },
    })
    return res.status(201).json(entry)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

// Edit + approve / reject
router.put('/knowledge/:id', async (req: Request, res: Response) => {
  try {
    const { trigger, response, category, scope, status, editedBy } = req.body
    const data: Record<string, unknown> = {}
    if (trigger) data.trigger = trigger
    if (response) data.response = response
    if (category) data.category = category
    if (scope) data.scope = scope
    if (status) data.status = status
    if (editedBy) data.editedBy = editedBy

    // When approving with GLOBAL scope, restrict to safe categories
    const GLOBAL_SAFE = ['greeting','error_recovery','apology','transition','objection_handling','closing']
    if (data.scope === 'GLOBAL' && !GLOBAL_SAFE.includes((data.category as string) || '')) {
      return res.status(400).json({ error: 'Categoria não pode ser global. Globais: ' + GLOBAL_SAFE.join(', ') })
    }
    // GLOBAL entries must not belong to a specific site
    if (data.scope === 'GLOBAL') data.siteId = null

    const entry = await prisma.knowledgeEntry.update({
      where: { id: req.params.id as string },
      data,
      include: { site: { select: { domain: true, brand: true } } },
    })
    return res.json(entry)
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.delete('/knowledge/:id', async (req: Request, res: Response) => {
  try {
    await prisma.knowledgeEntry.delete({ where: { id: req.params.id as string } })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

// Bulk approve all PENDING for a site
router.post('/knowledge/bulk-approve', async (req: Request, res: Response) => {
  try {
    const { siteId, ids } = req.body
    const where: Record<string, unknown> = { status: 'PENDING' }
    if (ids?.length) where.id = { in: ids }
    else if (siteId) where.siteId = siteId
    const result = await prisma.knowledgeEntry.updateMany({ where, data: { status: 'APPROVED', editedBy: 'admin' } })
    return res.json({ updated: result.count })
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})



// ─── SESSIONS ─────────────────────────────────────────────────────────────────

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1')
    const limit = 25
    const siteId = req.query.siteId as string | undefined
    const date = req.query.date as string | undefined

    const where: Record<string, unknown> = {}
    if (siteId) where.siteId = siteId
    if (date) {
      const start = new Date(date + 'T00:00:00Z')
      const end = new Date(date + 'T23:59:59Z')
      where.createdAt = { gte: start, lte: end }
    }

    const [items, total] = await Promise.all([
      prisma.chatSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          site: { select: { domain: true, brand: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.chatSession.count({ where }),
    ])

    return res.json({ items, total, page, pages: Math.ceil(total / limit) })
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar sessões' })
  }
})

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: req.params.id as string },
      include: {
        site: { select: { domain: true, brand: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })
    return res.json(session)
  } catch (err) {
    return res.status(500).json({ error: 'Erro' })
  }
})

// ─── ANALYTICS ────────────────────────────────────────────────────────────────

router.get('/analytics/top-questions', async (req: Request, res: Response) => {
  try {
    const siteId = req.query.siteId as string | undefined
    const limit = Math.min(parseInt(req.query.limit as string || '20'), 50)
    const since = new Date()
    since.setDate(since.getDate() - 30)

    const where: Record<string, unknown> = { role: 'USER', createdAt: { gte: since } }

    if (siteId) {
      const sessions = await prisma.chatSession.findMany({ where: { siteId }, select: { id: true } })
      where.sessionId = { in: sessions.map(s => s.id) }
    }

    const grouped = await prisma.chatMessage.groupBy({
      by: ['content'],
      where,
      _count: { content: true },
      orderBy: { _count: { content: 'desc' } },
      take: limit,
    })

    return res.json(grouped.map(g => ({ question: g.content.substring(0, 300), count: g._count.content })))
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar perguntas' })
  }
})

router.get('/analytics/messages-by-day', async (req: Request, res: Response) => {
  try {
    const siteId = req.query.siteId as string | undefined
    const since = new Date()
    since.setDate(since.getDate() - 29)
    since.setHours(0, 0, 0, 0)

    const where: Record<string, unknown> = { createdAt: { gte: since } }

    if (siteId) {
      const sessions = await prisma.chatSession.findMany({ where: { siteId }, select: { id: true } })
      where.sessionId = { in: sessions.map(s => s.id) }
    }

    const messages = await prisma.chatMessage.findMany({ where, select: { createdAt: true } })

    const dayMap = new Map<string, number>()
    for (let i = 0; i < 30; i++) {
      const d = new Date(since)
      d.setDate(d.getDate() + i)
      dayMap.set(d.toISOString().slice(0, 10), 0)
    }
    for (const msg of messages) {
      const day = new Date(msg.createdAt).toISOString().slice(0, 10)
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1)
    }

    return res.json(Array.from(dayMap.entries()).map(([day, count]) => ({ day, count })))
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar dados' })
  }
})

// ─── PROVIDER TEST ────────────────────────────────────────────────────────────

router.post('/providers/:provider/test', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params
    const { callLLM } = await import('../services/llm')
    const start = Date.now()
    const result = await callLLM(provider as any, [{ role: 'user', content: 'Responde apenas com: ok' }])
    return res.json({
      ok: true,
      provider,
      model: result.model,
      latencyMs: Date.now() - start,
      response: (result.content ?? '').substring(0, 200),
    })
  } catch (err) {
    return res.status(400).json({
      ok: false,
      provider: req.params.provider,
      error: err instanceof Error ? err.message : 'Erro desconhecido',
    })
  }
})

export default router
