import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { crawlAllSites } from '../scripts/crawlSites'
import { getPendingApprovals, resolveApproval } from '../modules/humanApproval'
import { getMemoryStats } from '../modules/agenticMemory'

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
    const agenticSites = await prisma.aISite.count({ where: { OR: [{ enableReact: true }, { enableHumanApproval: true }] } })
    return res.json({
      sites, sessions, sessionsToday, messages, messagesToday: messagesDoday,
      simulations: { total: simulations.reduce((a, s) => a + s._count, 0), ...simByStatus },
      totalTokens: (logs._sum.promptTokens || 0) + (logs._sum.completionTokens || 0),
      agenticSites,
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
    const allowed = ['domain','brand','type','isActive','agentType','activeProvider','fallbackProvider','systemPrompt','systemPromptB','abSplitPct','geminiModel','availableTools','factsDocument','restrictedTopics','enableHumanApproval','enableReact']
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



// Agentic AI: Human Approval queue
router.get('/approvals', (_req: Request, res: Response) => {
  return res.json(getPendingApprovals())
})
router.post('/approvals/:id/approve', (req: Request, res: Response) => {
  const ok = resolveApproval(req.params.id as string, true)
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Aprovacao nao encontrada ou expirada' })
})
router.post('/approvals/:id/reject', (req: Request, res: Response) => {
  const ok = resolveApproval(req.params.id as string, false)
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Aprovacao nao encontrada ou expirada' })
})
router.get('/memory/stats', (_req: Request, res: Response) => {
  return res.json(getMemoryStats())
})

router.get('/memory/reasoning', async (_req: Request, res: Response) => {
  try {
    const fs = await import('fs')
    const path = await import('path')
    const file = path.join(__dirname, '../../data/memory/reasoning.jsonl')
    if (!fs.existsSync(file)) return res.json([])
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const entries = lines
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter((e): e is Record<string, unknown> => e !== null)
      .reverse()
      .slice(0, 50)
    return res.json(entries)
  } catch {
    return res.json([])
  }
})

router.get('/memory/corrections', async (_req: Request, res: Response) => {
  try {
    const fs = await import('fs')
    const path = await import('path')
    const file = path.join(__dirname, '../../data/memory/corrections.jsonl')
    if (!fs.existsSync(file)) return res.json([])
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const entries = lines
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter((e): e is Record<string, unknown> => e !== null)
      .reverse()
      .slice(0, 50)
    return res.json(entries)
  } catch {
    return res.json([])
  }
})

router.get('/memory/metrics', async (_req: Request, res: Response) => {
  try {
    const [byType, embeddingStats, recentInsights] = await Promise.all([
      prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
        SELECT type, COUNT(*) as count FROM "MemoryVector" GROUP BY type ORDER BY count DESC
      `,
      prisma.$queryRaw<Array<{ has_embedding: boolean; count: bigint }>>`
        SELECT (embedding IS NOT NULL) as has_embedding, COUNT(*) as count
        FROM "MemoryVector" GROUP BY has_embedding
      `,
      prisma.$queryRaw<Array<{ content: string; createdAt: Date; metadata: unknown }>>`
        SELECT content, "createdAt", metadata FROM "MemoryVector"
        WHERE type = 'insight'
          AND "createdAt" > NOW() - INTERVAL '24 hours'
        ORDER BY "createdAt" DESC LIMIT 20
      `,
    ])
    return res.json({
      byType:         byType.map(r => ({ type: r.type, count: Number(r.count) })),
      embeddingStats: embeddingStats.map(r => ({ hasEmbedding: r.has_embedding, count: Number(r.count) })),
      recentInsights,
    })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.post('/memory/:id/mark-insight', async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE "MemoryVector" SET type = 'insight' WHERE id = ${req.params.id as string}`
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

export default router

// ── Capacidades / Ferramentas ─────────────────────────────────────────────────
router.get('/capabilities', (_req: Request, res: Response) => {
  const caps = [
    { category: 'GPS & Segurança', name: 'detectGpsAnomaly', label: 'Detectar anomalia GPS', description: 'Detecta instalações falsas, sinal perdido, jammer provável', example: 'detecta anomalias GPS hoje' },
    { category: 'GPS & Segurança', name: 'analyzeGsmCoverage', label: 'Analisar cobertura GSM', description: 'Distingue zona sem sinal vs jammer numa posição', example: 'analisa cobertura GSM do dispositivo 3' },
    { category: 'GPS & Segurança', name: 'getSuspicionScore', label: 'Score de suspeita', description: 'Score 0-100 por dispositivo: horário, velocidade, alarmes', example: 'qual o score de suspeita do dispositivo 1?' },
    { category: 'GPS & Segurança', name: 'ghostReplay', label: 'Replay de evento', description: 'Reconstrói rota, velocidade, ignição de evento passado', example: 'reconstrói o percurso do dispositivo 2 ontem' },
    { category: 'GPS & Segurança', name: 'analyzeRelationships', label: 'Grafo de relações', description: 'Detecta padrões de falha em lote por dispositivo/cliente', example: 'mostra relações do dispositivo 5' },
    { category: 'GPS & Segurança', name: 'inferIntent', label: 'Inferir intenção', description: 'Ocultação, vigilância, entrega ou fuga?', example: 'qual a intenção do movimento do dispositivo 3?' },
    { category: 'GPS & Segurança', name: 'detectTemporalAnomaly', label: 'Anomalia temporal', description: 'Movimento sem ignição, sequências impossíveis', example: 'detecta anomalias temporais nas últimas 6h' },
    { category: 'GPS & Segurança', name: 'checkDeviceBaseline', label: 'Baseline do dispositivo', description: 'Compara métricas actuais com histórico individual', example: 'verifica baseline do dispositivo 1' },
    { category: 'GPS & Segurança', name: 'getSixthSense', label: 'Sexto sentido', description: 'Micro-sinais: GSM drops, oscilações de tensão, GPS jumps', example: 'activa o sexto sentido para o dispositivo 2' },
    { category: 'GPS & Segurança', name: 'getSilenceEvents', label: 'Eventos de silêncio', description: 'Coisas que deviam ter acontecido mas não aconteceram', example: 'mostra eventos de silêncio de hoje' },
    { category: 'GPS & Segurança', name: 'detectTemporalEchoes', label: 'Padrões recorrentes', description: 'Falhas/alarmes que se repetem sempre na mesma hora', example: 'detecta padrões recorrentes das últimas 4 semanas' },
    { category: 'GPS & Segurança', name: 'getTheftRiskForecast', label: 'Previsão de roubo', description: 'Risco de roubo nas próximas 24-48h por dispositivo', example: 'qual o risco de roubo amanhã?' },
    { category: 'GPS & Segurança', name: 'getActiveIncidents', label: 'Incidentes activos', description: 'Lista incidentes activos agrupados anti-caos', example: 'mostra incidentes activos agora' },
    { category: 'GPS & Segurança', name: 'runPostIncidentAnalysis', label: 'Análise pós-incidente', description: 'RCA: reconstrói cadeia causal de uma falha', example: 'analisa o incidente de ontem às 14h' },
    { category: 'GPS & Segurança', name: 'analyzeDeviceHealth', label: 'Saúde do dispositivo', description: 'Tensão, RSSI, satélites, temperatura', example: 'diagnóstico de hardware do dispositivo 4' },
    { category: 'GPS & Segurança', name: 'generateEvidenceReport', label: 'Relatório de evidências', description: 'PDF para polícia/cliente: timeline, rota, alarmes', example: 'gera relatório de evidências para o dispositivo 1 às 13h de ontem' },
    { category: 'GPS & Segurança', name: 'generateNarrative', label: 'Narrativa de eventos', description: 'Transforma dados técnicos em narrativa para cliente/polícia', example: 'gera narrativa do dispositivo 2 para a polícia' },
    { category: 'GPS & Segurança', name: 'getBehaviorProfile', label: 'Perfil comportamental', description: 'Perfil aprendido de um veículo ao longo do tempo', example: 'mostra o perfil do dispositivo 1' },
    { category: 'GPS & Segurança', name: 'getWeatherCorrelation', label: 'Correlação clima/falhas', description: 'Liga condições meteorológicas a falhas de GPS', example: 'correlaciona clima com falhas esta semana' },
    { category: 'GPS & Segurança', name: 'synthesizeIntelligence', label: 'Síntese multi-domínio', description: 'GPS + financeiro + reputação numa só análise', example: 'síntese completa do cliente X' },
    { category: 'Negócio & Receita', name: 'getClientReputation', label: 'Reputação de cliente', description: 'Faturas, inactividade, suporte — perfil de risco', example: 'perfil de risco do cliente joao@exemplo.pt' },
    { category: 'Negócio & Receita', name: 'getPredictions', label: 'Previsões churn/falha', description: 'Churn de clientes e risco de falha de dispositivos', example: 'quais clientes estão em risco de churn?' },
    { category: 'Negócio & Receita', name: 'getLeadIntelligence', label: 'Inteligência de leads', description: 'Leads classificados: URGENTE/QUENTE/MORNO/FRIO', example: 'mostra leads urgentes de hoje' },
    { category: 'Negócio & Receita', name: 'revenueAutopilot', label: 'Revenue autopilot', description: 'Cruza anúncios, leads e receita — detecta campanhas lucrativas', example: 'liga o revenue autopilot' },
    { category: 'Negócio & Receita', name: 'revenueForecast', label: 'Previsão de receita', description: 'Receita prevista para 30-90 dias com base no histórico', example: 'prevê a receita dos próximos 60 dias' },
    { category: 'Negócio & Receita', name: 'funnelAnalysis', label: 'Análise de funil', description: 'Onde exactamente perdes dinheiro no funil', example: 'analisa o funil de vendas' },
    { category: 'Negócio & Receita', name: 'growthSimulate', label: 'Simulação de crescimento', description: 'ROI esperado se investir X/dia numa campanha', example: 'se investir 20€/dia na campanha A qual o ROI?' },
    { category: 'Negócio & Receita', name: 'opportunityAlert', label: 'Alertas de oportunidade', description: 'Dinheiro caído no chão: leads sem resposta, faturas em atraso', example: 'mostra oportunidades de hoje' },
    { category: 'Negócio & Receita', name: 'ceoDecision', label: 'Decisão CEO', description: '3 directivas estratégicas síntese de tudo', example: 'o que devo focar hoje como CEO?' },
    { category: 'Negócio & Receita', name: 'dailyOS', label: 'OS Diário', description: 'Plano de execução do dia em 6 acções', example: 'dá-me o plano do dia' },
    { category: 'Negócio & Receita', name: 'quickSummary', label: 'Resumo 60 segundos', description: 'Crítico vs ok vs decisão necessária', example: 'resumo rápido do negócio' },
    { category: 'Negócio & Receita', name: 'dailyDecision', label: 'Decisor de prioridade', description: 'Vale a pena fazer isto agora?', example: 'vale a pena fazer X agora?' },
    { category: 'Negócio & Receita', name: 'focusBlocks', label: 'Blocos de foco', description: 'Divide o dia em blocos de 90 min de trabalho focado', example: 'organiza o resto do meu dia' },
    { category: 'Negócio & Receita', name: 'getOperationalCosts', label: 'Custos operacionais', description: 'Tokens LLM e faturas em atraso', example: 'qual o custo operacional desta semana?' },
    { category: 'Negócio & Receita', name: 'simulateDecision', label: 'Simular decisão', description: 'Impacto de bloquear veículo / alertar cliente antes de executar', example: 'simula bloquear o veículo 3' },
    { category: 'Negócio & Receita', name: 'getOptimalTiming', label: 'Momento óptimo', description: 'Quando é o melhor momento para agir', example: 'quando devo contactar o cliente X?' },
    { category: 'Marketing & Publicidade', name: 'generateCopy', label: 'Gerar copy', description: 'Anúncios, WhatsApp, hooks TikTok, email — para Rinosat', example: 'gera 3 hooks TikTok sobre GPS' },
    { category: 'Marketing & Publicidade', name: 'generateAdaptiveCopy', label: 'Copy adaptado', description: 'Adaptado ao perfil: emocional, racional, empresa, jovem', example: 'gera copy WhatsApp para cliente emocional' },
    { category: 'Marketing & Publicidade', name: 'generateVideoScript', label: 'Roteiro de vídeo', description: 'Script completo com hook, problema, prova, CTA', example: 'cria roteiro de 30s para TikTok' },
    { category: 'Marketing & Publicidade', name: 'getMarketingDashboard', label: 'Dashboard marketing', description: 'Meta + Google + TikTok + Instagram + leads numa vista', example: 'mostra o dashboard de marketing desta semana' },
    { category: 'Marketing & Publicidade', name: 'getMetaCampaigns', label: 'Campanhas Meta', description: 'Performance: gasto, CTR, CPC, leads, CPL', example: 'mostra campanhas Meta dos últimos 7 dias' },
    { category: 'Marketing & Publicidade', name: 'controlMetaCampaign', label: 'Controlar Meta', description: 'Pausa, activa ou ajusta orçamento de campanha', example: 'pausa a campanha X do Meta' },
    { category: 'Marketing & Publicidade', name: 'getGoogleAdsPerformance', label: 'Google Ads', description: 'CTR, CPC, conversões, keywords desperdiçadoras', example: 'performance Google Ads este mês' },
    { category: 'Marketing & Publicidade', name: 'getTikTokPerformance', label: 'TikTok Ads', description: 'Retenção 2s/6s, CTR, hooks fracos ou fortes', example: 'mostra performance TikTok desta semana' },
    { category: 'Marketing & Publicidade', name: 'analyzeInstagramComments', label: 'Comentários Instagram', description: 'Classifica comentários: lead, suporte, spam — sugere respostas', example: 'analisa comentários Instagram dos últimos posts' },
    { category: 'Marketing & Publicidade', name: 'getInstagramPerformance', label: 'Performance Instagram', description: 'Alcance, engagement, likes, comentários, saves', example: 'performance dos últimos 10 posts Instagram' },
    { category: 'Marketing & Publicidade', name: 'getCompetitorIntelligence', label: 'Inteligência concorrentes', description: 'Anúncios de concorrentes GPS em Portugal via Meta Ad Library', example: 'o que estão a fazer os concorrentes de GPS?' },
    { category: 'Marketing & Publicidade', name: 'saveHook', label: 'Guardar hook', description: 'Guarda hook/headline/CTA na biblioteca de criativos', example: 'guarda este hook: GPS que avisa antes do roubo' },
    { category: 'Marketing & Publicidade', name: 'getHooks', label: 'Buscar criativos', description: 'Biblioteca de hooks, headlines, CTAs guardados', example: 'mostra os melhores hooks TikTok' },
    { category: 'Marketing & Publicidade', name: 'smartFollowup', label: 'Follow-up inteligente', description: 'Detecta leads sem contacto e gera mensagem personalizada', example: 'quais leads precisam de follow-up?' },
    { category: 'Marketing & Publicidade', name: 'marketReaction', label: 'Reacção de mercado', description: 'Mudanças de velocidade de leads e conversão — reacções táticas', example: 'o mercado está a mudar? como reagir?' },
    { category: 'Marketing & Publicidade', name: 'generateContentFromEvent', label: 'Conteúdo de evento GPS', description: 'Transforma evento real em post social / anúncio', example: 'transforma o percurso de ontem num post Instagram' },
    { category: 'Marketing & Publicidade', name: 'sendLeadReactivation', label: 'Reactivar lead frio', description: 'Envia próxima mensagem da sequência de reactivação', example: 'reactiva o lead frio do João' },
    { category: 'Marketing & Publicidade', name: 'dailyFollowups', label: 'Follow-ups do dia', description: 'Leads quentes + faturas em atraso com mensagem concreta', example: 'follow-ups que geram dinheiro hoje' },
    { category: 'Memória & Contexto', name: 'rememberEpisode', label: 'Guardar episódio', description: 'Guarda evento importante com embeddings na memória longa', example: 'lembra este incidente: [descrição]' },
    { category: 'Memória & Contexto', name: 'recallEpisode', label: 'Recordar episódios', description: 'Busca eventos similares à situação actual', example: 'já aconteceu algo parecido com isto antes?' },
    { category: 'Memória & Contexto', name: 'universalSearch', label: 'Pesquisa universal', description: 'Clientes, dispositivos, tarefas, contactos, memória — tudo', example: 'procura tudo sobre João Silva' },
    { category: 'Memória & Contexto', name: 'getMyLatencyProfile', label: 'Perfil de actividade', description: 'Padrão de actividade e resposta do Wanderson. Detecta sobrecarga.', example: 'como está o meu nível de stress hoje?' },
    { category: 'Pessoal & Motos', name: 'logMaintenance', label: 'Registar manutenção', description: 'Moto: troca de óleo, correia, filtro, etc.', example: 'regista troca de óleo da moto 1 nos 15000km' },
    { category: 'Pessoal & Motos', name: 'getMaintenanceStatus', label: 'Estado das motos', description: 'Revisões próximas, custos, histórico', example: 'quando é a próxima revisão das motos?' },
    { category: 'Sistema & Auto-melhoria', name: 'selfEdit', label: 'Auto-editar código', description: 'ORBIT edita o próprio código-fonte, compila e reinicia', example: 'corrige o bug no ficheiro X' },
    { category: 'Sistema & Auto-melhoria', name: 'selfDebug', label: 'Auto-diagnóstico', description: 'Analisa o que falhou na última resposta e corrige', example: 'houve um erro na resposta anterior, corrige' },
    { category: 'Sistema & Auto-melhoria', name: 'readSourceFile', label: 'Ler código-fonte', description: 'Lê ficheiro de código do ORBIT para analisar', example: 'lê o ficheiro src/routes/chat.ts' },
    { category: 'Sistema & Auto-melhoria', name: 'analyzeSystemLogs', label: 'Analisar logs do sistema', description: 'Logs com IA: causa raiz, padrões, sugestões', example: 'analisa os logs do ai-command-center da última hora' },
    { category: 'Sistema & Auto-melhoria', name: 'createMission', label: 'Criar missão', description: 'Quebra objectivo em 4-8 tarefas concretas e regista', example: 'cria missão: aumentar conversões 20%' },
    { category: 'Sistema & Auto-melhoria', name: 'setPersonality', label: 'Mudar personalidade', description: 'padrao / tecnico / executivo / suporte / operador / copiloto', example: 'muda para modo executivo' },
    { category: 'Sistema & Auto-melhoria', name: 'setCrisisMode', label: 'Modo crise', description: 'Respostas mais curtas e directas em situação crítica', example: 'activa modo crise' },
    { category: 'Sistema & Auto-melhoria', name: 'getAuditLog', label: 'Black Box', description: 'Histórico de todas as acções e eventos do ORBIT', example: 'mostra o log das últimas 2 horas' },
    { category: 'Integrações', name: 'getWhatsAppIntelligence', label: 'Inteligência WhatsApp', description: 'Resumo semanal pessoal+negócio: conversas activas, pendentes', example: 'o que está pendente no WhatsApp?' },
    { category: 'Integrações', name: 'getDroneTelemetry', label: 'Telemetria drone', description: 'GPS, altitude, bateria em tempo real', example: 'como está o drone agora?' },
    { category: 'Integrações', name: 'analyzeScreen', label: 'Analisar ecrã', description: 'Analisa o ecrã actual do MacBook ou iPhone', example: 'analisa o que está no meu ecrã agora' },
  ]
  const grouped: Record<string, typeof caps> = {}
  for (const c of caps) {
    if (!grouped[c.category]) grouped[c.category] = []
    grouped[c.category].push(c)
  }
  return res.json({ total: caps.length, groups: grouped })
})

// ── Auto-melhoria / Reflexão ─────────────────────────────────────────────────
router.get('/reflection', async (_req: Request, res: Response) => {
  try {
    const [stats, lastReflection, lastAt] = await Promise.all([
      prisma.orbitAuditLog.groupBy({
        by: ['outcome'],
        where: { outcome: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
        _count: { outcome: true },
      }),
      prisma.systemConfig.findUnique({ where: { key: 'orbit.last_reflection_output' } }),
      prisma.systemConfig.findUnique({ where: { key: 'orbit.last_reflection_at' } }),
    ])
    const statMap: Record<string, number> = {}
    for (const s of stats) if (s.outcome) statMap[s.outcome] = s._count.outcome
    const recentLogs = await prisma.orbitAuditLog.findMany({
      where: { outcome: { not: null }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, createdAt: true, action: true, outcome: true, feedback: true, source: true },
    })
    return res.json({
      stats: {
        correct: statMap['correct'] || 0,
        missed: statMap['missed'] || 0,
        false_positive: statMap['false_positive'] || 0,
        ignored: statMap['ignored'] || 0,
        total: Object.values(statMap).reduce((a, b) => a + b, 0),
      },
      lastReflectionAt: lastAt?.value || null,
      lastReflectionOutput: lastReflection?.value || null,
      recentLogs,
    })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.post('/reflection/trigger', async (_req: Request, res: Response) => {
  try {
    const mod = await import('../workers/reflectionWorker') as { runWeeklyReflectionNow?: () => Promise<void> }
    if (typeof mod.runWeeklyReflectionNow === 'function') {
      void mod.runWeeklyReflectionNow()
      return res.json({ ok: true, message: 'Reflexão iniciada em background' })
    }
    return res.status(501).json({ error: 'runWeeklyReflectionNow não exportada — exporta a função no worker' })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

