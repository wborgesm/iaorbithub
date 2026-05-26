import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
import { generateEmbedding } from '../services/embeddings'

const prisma = new PrismaClient()

const MEMORY_DIR  = path.join(process.cwd(), 'data', 'memory')
const CORRECTIONS_FILE = path.join(MEMORY_DIR, 'corrections.jsonl')
const REASONING_FILE   = path.join(MEMORY_DIR, 'reasoning.jsonl')

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
}

export interface MemoryEntry {
  id: string
  timestamp: string
  type: 'correction' | 'error' | 'reasoning' | 'insight' | 'preference'
  sessionId?: string
  siteId?: string
  input: string
  output: string
  corrected?: string
  metadata?: Record<string, unknown>
}

export async function appendMemoryEntry(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<void> {
  try {
    ensureDir()
    const full: MemoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
    const file = entry.type === 'reasoning' ? REASONING_FILE : CORRECTIONS_FILE
    fs.appendFileSync(file, JSON.stringify(full) + '\n', 'utf8')
    void saveMemoryVector({ siteId: entry.siteId, sessionId: entry.sessionId, type: entry.type, content: entry.input + '\n' + entry.output, metadata: entry.metadata })
  } catch (err) {
    console.warn('[agenticMemory] Falhou ao guardar:', (err as Error).message)
  }
}

export async function queryMemory(
  query: string,
  siteId?: string,
  limit = 5,
): Promise<MemoryEntry[]> {
  try {
    ensureDir()
    if (!fs.existsSync(CORRECTIONS_FILE)) return []
    const lines = fs.readFileSync(CORRECTIONS_FILE, 'utf8').split('\n').filter(Boolean)
    const entries: MemoryEntry[] = lines
      .map(l => { try { return JSON.parse(l) as MemoryEntry } catch { return null } })
      .filter((e): e is MemoryEntry => e !== null)
      .filter(e => !siteId || e.siteId === siteId)

    const q = query.toLowerCase()
    return entries
      .map(e => ({
        entry: e,
        score:
          (e.input.toLowerCase().includes(q) ? 2 : 0) +
          (e.output.toLowerCase().includes(q) ? 1 : 0) +
          (e.corrected?.toLowerCase().includes(q) ? 1 : 0),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.entry)
  } catch {
    return []
  }
}

export function getMemoryStats(): { corrections: number; reasoningLogs: number } {
  try {
    ensureDir()
    const countLines = (file: string) =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0
    return {
      corrections:   countLines(CORRECTIONS_FILE),
      reasoningLogs: countLines(REASONING_FILE),
    }
  } catch {
    return { corrections: 0, reasoningLogs: 0 }
  }
}

// ── Preparação para futura base vectorial ────────────────────────────────────
// Para activar: define VECTOR_DB_URL no .env e muda provider abaixo
export const vectorConfig = {
  provider:        null as null | 'qdrant' | 'pgvector' | 'chromadb',
  endpoint:        process.env.VECTOR_DB_URL ?? null,
  collection:      'agentic_memory',
  embeddingModel:  'text-embedding-3-small',
}

// Guarda entrada na BD (sem embedding por agora — embedding = null)
export async function saveMemoryVector(entry: {
  siteId?: string
  sessionId?: string
  type: string
  content: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const safeContent = (entry.content ?? '').trim()
  if (!safeContent) return
  try {
    const embedding = await generateEmbedding(safeContent)
    if (embedding) {
      const vec = `[${embedding.join(',')}]`
      await prisma.$executeRaw`
        INSERT INTO "MemoryVector"
          ("id","createdAt","siteId","sessionId","type","content","embedding","metadata")
        VALUES (
          gen_random_uuid()::text, NOW(),
          ${entry.siteId ?? null}, ${entry.sessionId ?? null},
          ${entry.type}, ${safeContent},
          ${vec}::vector,
          ${JSON.stringify(entry.metadata ?? {})}::jsonb
        )
      `
    } else {
      await prisma.$executeRaw`
        INSERT INTO "MemoryVector"
          ("id","createdAt","siteId","sessionId","type","content","metadata")
        VALUES (
          gen_random_uuid()::text, NOW(),
          ${entry.siteId ?? null}, ${entry.sessionId ?? null},
          ${entry.type}, ${safeContent},
          ${JSON.stringify(entry.metadata ?? {})}::jsonb
        )
      `
    }
  } catch (err) {
    console.warn('[agenticMemory] saveMemoryVector falhou:', (err as Error).message)
  }
}

// Busca textual simples (fallback sem embeddings)
export async function searchMemory(
  query: string,
  siteId?: string,
  limit = 5,
): Promise<Array<{ id: string; type: string; content: string; createdAt: Date }>> {
  try {
    const embedding = await generateEmbedding(query)
    if (embedding) {
      const vec = `[${embedding.join(',')}]`
      const results = await prisma.$queryRaw<Array<{ id: string; type: string; content: string; createdAt: Date }>>`
        SELECT id, type, content, "createdAt"
        FROM "MemoryVector"
        WHERE (${siteId ?? null}::text IS NULL OR "siteId" = ${siteId ?? null})
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${limit}
      `
      if (results.length > 0) return results
    }
    return await prisma.$queryRaw<Array<{ id: string; type: string; content: string; createdAt: Date }>>`
      SELECT id, type, content, "createdAt"
      FROM "MemoryVector"
      WHERE (${siteId ?? null}::text IS NULL OR "siteId" = ${siteId ?? null})
        AND content ILIKE ${'%' + query + '%'}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `
  } catch {
    return []
  }
}

export async function listFacts(
  siteId: string,
  limit = 20,
): Promise<Array<{
  id: string
  content: string
  category?: string
  dueDate?: string
  priority?: string
  factType?: string
  createdAt: Date
}>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; content: string; metadata: unknown; createdAt: Date }>>`
      SELECT id, content, metadata, "createdAt"
      FROM "MemoryVector"
      WHERE "siteId" = ${siteId} AND type = 'preference'
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `
    return rows.map(r => {
      const meta = (r.metadata && typeof r.metadata === 'object') ? r.metadata as Record<string, unknown> : {}
      return {
        id: r.id,
        content: r.content,
        category: typeof meta.category === 'string' ? meta.category : undefined,
        dueDate: typeof meta.dueDate === 'string' ? meta.dueDate : undefined,
        priority: typeof meta.priority === 'string' ? meta.priority : undefined,
        factType: typeof meta.factType === 'string' ? meta.factType : undefined,
        createdAt: r.createdAt,
      }
    })
  } catch {
    return []
  }
}

export async function saveFact(input: {
  siteId: string
  sessionId?: string
  fact: string
  category: string
  dueDate?: string
  priority?: string
  factType?: string
  asset?: string
  last_metric?: number
  threshold?: number
  metric_unit?: string
  phone?: string
}): Promise<void> {
  const metadata: Record<string, unknown> = {
    category: input.category,
    fact: input.fact,
    dueDate: input.dueDate || null,
    priority: input.priority || 'medium',
    factType: input.factType || 'preference',
    asset: input.asset || null,
    last_metric: typeof input.last_metric === 'number' ? input.last_metric : null,
    threshold: typeof input.threshold === 'number' ? input.threshold : null,
    metric_unit: input.metric_unit || 'km',
    phone: input.phone || null,
  }
  await saveMemoryVector({
    siteId: input.siteId,
    sessionId: input.sessionId,
    type: 'preference',
    content: input.fact,
    metadata,
  })
}

/** Factos com dueDate nos próximos N dias */
export async function listUpcomingFacts(
  siteId: string,
  withinDays = 14,
): Promise<Array<{ id: string; content: string; dueDate: string; priority?: string; factType?: string }>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; content: string; metadata: unknown }>>`
      SELECT id, content, metadata
      FROM "MemoryVector"
      WHERE "siteId" = ${siteId} AND type = 'preference'
        AND metadata->>'dueDate' IS NOT NULL
        AND metadata->>'dueDate' != ''
      ORDER BY metadata->>'dueDate' ASC
    `
    const now = new Date()
    const end = new Date(now.getTime() + withinDays * 86400000)
    const out: Array<{ id: string; content: string; dueDate: string; priority?: string; factType?: string }> = []
    for (const r of rows) {
      const meta = (r.metadata && typeof r.metadata === 'object') ? r.metadata as Record<string, unknown> : {}
      const dueDate = typeof meta.dueDate === 'string' ? meta.dueDate : ''
      if (!dueDate) continue
      const d = new Date(dueDate + 'T12:00:00')
      if (isNaN(d.getTime()) || d < now || d > end) continue
      out.push({
        id: r.id,
        content: r.content,
        dueDate,
        priority: typeof meta.priority === 'string' ? meta.priority : undefined,
        factType: typeof meta.factType === 'string' ? meta.factType : undefined,
      })
    }
    return out
  } catch {
    return []
  }
}

/** Procura número de telefone de um contacto guardado por nome */
export async function resolveContactPhone(siteId: string, name: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ content: string; metadata: unknown }>>`
      SELECT content, metadata FROM "MemoryVector"
      WHERE "siteId" = ${siteId} AND type = 'preference'
        AND (metadata->>'factType' = 'contact' OR metadata->>'category' = 'pessoal')
        AND LOWER(content) LIKE ${`%${name.toLowerCase()}%`}
      ORDER BY "createdAt" DESC LIMIT 5
    `
    for (const r of rows) {
      const meta = (r.metadata && typeof r.metadata === 'object') ? r.metadata as Record<string, unknown> : {}
      const phone = typeof meta.phone === 'string' ? meta.phone.trim() : ''
      if (phone && phone.replace(/\D/g, '').length >= 7) return phone
    }
    return null
  } catch { return null }
}

export async function listMaintenanceAssets(siteId: string): Promise<Array<{
  id: string
  content: string
  asset: string
  lastMetric: number
  threshold: number
  unit: string
}>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; content: string; metadata: unknown }>>`
      SELECT id, content, metadata FROM "MemoryVector"
      WHERE "siteId" = ${siteId} AND type = 'preference'
        AND metadata->>'asset' IS NOT NULL
        AND metadata->>'threshold' IS NOT NULL
    `
    const out: Array<{ id: string; content: string; asset: string; lastMetric: number; threshold: number; unit: string }> = []
    for (const r of rows) {
      const meta = (r.metadata && typeof r.metadata === 'object') ? r.metadata as Record<string, unknown> : {}
      const asset = typeof meta.asset === 'string' ? meta.asset : ''
      const threshold = typeof meta.threshold === 'number' ? meta.threshold : parseFloat(String(meta.threshold || '0'))
      const lastMetric = typeof meta.last_metric === 'number' ? meta.last_metric : parseFloat(String(meta.last_metric || '0'))
      if (!asset || !threshold) continue
      out.push({
        id: r.id,
        content: r.content,
        asset,
        lastMetric: lastMetric || 0,
        threshold,
        unit: typeof meta.metric_unit === 'string' ? meta.metric_unit : 'km',
      })
    }
    return out
  } catch {
    return []
  }
}
