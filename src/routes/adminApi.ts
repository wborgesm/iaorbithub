import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { crawlAllSites } from '../scripts/crawlSites'

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
    const id = req.params.id as string
    // Save prompt history if systemPrompt is changing
    if (req.body.systemPrompt) {
      const current = await prisma.aISite.findUnique({ where: { id }, select: { systemPrompt: true } })
      if (current && current.systemPrompt !== req.body.systemPrompt) {
        await prisma.promptHistory.create({ data: { siteId: id, prompt: current.systemPrompt, label: 'A' } }).catch(() => {})
      }
    }
    if (req.body.systemPromptB) {
      const current = await prisma.aISite.findUnique({ where: { id }, select: { systemPromptB: true } })
      if (current && current.systemPromptB && current.systemPromptB !== req.body.systemPromptB) {
        await prisma.promptHistory.create({ data: { siteId: id, prompt: current.systemPromptB, label: 'B' } }).catch(() => {})
      }
    }
    const allowed = ['domain','brand','type','isActive','agentType','activeProvider','fallbackProvider','systemPrompt','systemPromptB','abSplitPct','geminiModel','availableTools','factsDocument','restrictedTopics']
    const data: Record<string, unknown> = {}
    for (const k of allowed) if (k in req.body) data[k] = req.body[k]
    const site = await prisma.aISite.update({ where: { id }, data })
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


// POST /crawl — crawl all sites (or one) and update factsDocument
router.post('/crawl', async (req: Request, res: Response) => {
  const domain = req.body?.domain as string | undefined
  try {
    const results = await crawlAllSites(domain)
    return res.json({ ok: true, results })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro no crawler' })
  }
})

// GET /crawl/status — list snapshot files and last update time
router.get('/crawl/status', async (_req: Request, res: Response) => {
  const fs = await import('fs')
  const path = await import('path')
  const dir = path.join(__dirname, '../../data/snapshots')
  try {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : []
    const statuses = files.map(f => {
      const fp = path.join(dir, f)
      const stat = fs.statSync(fp)
      return { file: f, updatedAt: stat.mtime.toISOString(), size: stat.size }
    })
    return res.json(statuses)
  } catch {
    return res.json([])
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
      include: { scenario: { select: { title: true, brand: true } }, site: { select: { domain: true, brand: true } } },
    }),
    prisma.userSimulation.count(),
  ])
  return res.json({ items, total, page, pages: Math.ceil(total / limit) })
})

router.get('/simulations/:id', async (req: Request, res: Response) => {
  const sim = await prisma.userSimulation.findUnique({
    where: { id: req.params.id as string },
    include: { scenario: true, site: { select: { domain: true, brand: true } }, messages: { orderBy: { createdAt: 'asc' } } },
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
  const { getProvidersStatus } = await import('../services/providerConfig')
  return res.json(await getProvidersStatus())
})

// Real-time status (cooldown info without DB hit)
router.get('/providers/status', async (_req: Request, res: Response) => {
  const { getProvidersStatus } = await import('../services/providerConfig')
  return res.json(await getProvidersStatus())
})

// Clear cooldown manually
router.post('/providers/:provider/clear-cooldown', async (req: Request, res: Response) => {
  const { clearProviderCooldown } = await import('../services/providerConfig')
  clearProviderCooldown(req.params.provider as string)
  return res.json({ ok: true })
})

router.put('/providers/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params
    const { apiKey, apiKey2, apiKey3, isEnabled, model, priority } = req.body as { apiKey?: string; apiKey2?: string; apiKey3?: string; isEnabled?: boolean; model?: string; priority?: number }
    const data: Record<string, unknown> = {}
    if (typeof isEnabled === 'boolean') data.isEnabled = isEnabled
    if (typeof model === 'string' && model) data.model = model
    if (typeof priority === 'number') data.priority = priority
    const applyKey = (val: string | undefined, field: string) => {
      if (typeof val === 'string') {
        if (val === '') data[field] = ''
        else if (!val.startsWith('\u2022\u2022')) data[field] = val
      }
    }
    applyKey(apiKey, 'apiKey')
    applyKey(apiKey2, 'apiKey2')
    applyKey(apiKey3, 'apiKey3')
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
    const { invalidateProviderCache } = await import('../services/providerConfig')
    invalidateProviderCache(provider as string)
    const mk = (k: string) => k ? '\u2022\u2022\u2022\u2022' + k.slice(-4) : ''
    return res.json({
      ...row,
      apiKey:  row.apiKey  ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + row.apiKey.slice(-6)  : '',
      apiKey2: mk((row as any).apiKey2 || ''),
      apiKey3: mk((row as any).apiKey3 || ''),
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
    const { callLLMAuto } = await import('../services/llm')
    const start = Date.now()
    const result = await callLLMAuto([{ role: 'user', content: 'Responde apenas com: ok' }], provider as any)
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

// ─── HEALTH STATS ─────────────────────────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [totalCalls, errorCalls, avgLatency, topProviders] = await Promise.all([
      prisma.lLMCallLog.count({ where: { createdAt: { gte: since24h } } }),
      prisma.lLMCallLog.count({ where: { createdAt: { gte: since24h }, error: { not: null } } }),
      prisma.lLMCallLog.aggregate({ _avg: { latencyMs: true }, where: { createdAt: { gte: since24h }, error: null } }),
      prisma.lLMCallLog.groupBy({
        by: ['provider'],
        _count: { id: true },
        _avg: { latencyMs: true },
        where: { createdAt: { gte: since24h } },
        orderBy: { _count: { id: 'desc' } },
      }),
    ])
    const days: { date: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const end = new Date(start.getTime() + 86400000)
      const count = await prisma.chatSession.count({ where: { createdAt: { gte: start, lt: end } } })
      days.push({ date: d.toLocaleDateString('pt', { weekday: 'short', day: 'numeric' }), count })
    }
    return res.json({
      calls24h: totalCalls,
      errors24h: errorCalls,
      errorRate: totalCalls > 0 ? Math.round(errorCalls / totalCalls * 100) : 0,
      avgLatencyMs: Math.round(avgLatency._avg.latencyMs ?? 0),
      providers: topProviders.map(p => ({
        provider: p.provider,
        calls: p._count.id,
        avgLatency: Math.round(p._avg.latencyMs ?? 0),
      })),
      dailySessions: days,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Erro' })
  }
})

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
router.get('/export/sessions.csv', async (_req: Request, res: Response) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { site: { select: { domain: true, brand: true } }, _count: { select: { messages: true } } },
    })
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = ['ID,Data,Site,Marca,Mensagens,IP,Página']
    for (const s of sessions) {
      lines.push([s.id, s.createdAt.toISOString(), s.site?.domain || '', s.site?.brand || '', s._count.messages, s.visitorIp || '', (s as any).pageUrl || ''].map(v => esc(String(v))).join(','))
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="conversas.csv"')
    return res.send('﻿' + lines.join('\n'))
  } catch (err) {
    return res.status(500).json({ error: 'Erro' })
  }
})

// ─── SEARCH ───────────────────────────────────────────────────────────────────
router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim()
    if (q.length < 2) return res.json({ sessions: [], knowledge: [] })
    const [msgs, knowledge] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { content: { contains: q, mode: 'insensitive' }, role: 'USER' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { session: { include: { site: { select: { domain: true } } } } },
      }),
      prisma.knowledgeEntry.findMany({
        where: { OR: [{ trigger: { contains: q, mode: 'insensitive' } }, { response: { contains: q, mode: 'insensitive' } }] },
        take: 8,
        include: { site: { select: { domain: true } } },
      }),
    ])
    return res.json({
      sessions: msgs.map(m => ({
        sessionId: m.sessionId,
        domain: m.session?.site?.domain || '',
        snippet: m.content.substring(0, 120),
        date: m.createdAt,
      })),
      knowledge: knowledge.map(k => ({ id: k.id, trigger: k.trigger, domain: k.site?.domain || '' })),
    })
  } catch (err) {
    return res.status(500).json({ error: 'Erro' })
  }
})

// ─── PROMPT HISTORY ───────────────────────────────────────────────────────────
router.get('/sites/:id/prompt-history', async (req: Request, res: Response) => {
  try {
    const history = await prisma.promptHistory.findMany({
      where: { siteId: req.params.id as string },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return res.json(history)
  } catch (err) {
    return res.status(500).json({ error: 'Erro' })
  }
})

// ─── USERS ────────────────────────────────────────────────────────────────────
router.get('/users', async (_req: Request, res: Response) => {
  const users = await prisma.adminUser.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, isActive: true, lastLogin: true, createdAt: true },
  })
  return res.json(users)
})

router.post('/users', async (req: Request, res: Response) => {
  try {
    const bcrypt = await import('bcrypt')
    const { email, name, role, password } = req.body
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name e password obrigatórios' })
    const hash = await bcrypt.default.hash(password, 10)
    const user = await prisma.adminUser.create({ data: { email, name, role: role || 'OPERATOR', password: hash } })
    return res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role })
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email já existe' })
    return res.status(400).json({ error: err.message || 'Erro' })
  }
})

router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const { name, role, isActive, password } = req.body
    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (role !== undefined) data.role = role
    if (isActive !== undefined) data.isActive = isActive
    if (password) {
      const bcrypt = await import('bcrypt')
      data.password = await bcrypt.default.hash(password, 10)
    }
    const user = await prisma.adminUser.update({
      where: { id: req.params.id as string },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true },
    })
    return res.json(user)
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Erro' })
  }
})

router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    await prisma.adminUser.delete({ where: { id: req.params.id as string } })
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Erro' })
  }
})

// ─── SYSTEM CONFIG ────────────────────────────────────────────────────────────
router.get('/config', async (_req: Request, res: Response) => {
  const configs = await prisma.systemConfig.findMany()
  const obj: Record<string, string> = {}
  for (const c of configs) if (!c.key.includes('pass')) obj[c.key] = c.value
  return res.json(obj)
})

router.post('/config', async (req: Request, res: Response) => {
  try {
    const entries = req.body as Record<string, string>
    for (const [key, value] of Object.entries(entries)) {
      if (value) await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
    }
    return res.json({ ok: true })
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Erro' })
  }
})

export default router
