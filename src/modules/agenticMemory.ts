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
  type: 'correction' | 'error' | 'reasoning' | 'insight'
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
  try {
    const embedding = await generateEmbedding(entry.content)
    if (embedding) {
      const vec = `[${embedding.join(',')}]`
      await prisma.$executeRaw`
        INSERT INTO "MemoryVector"
          ("id","createdAt","siteId","sessionId","type","content","embedding","metadata")
        VALUES (
          gen_random_uuid()::text, NOW(),
          ${entry.siteId ?? null}, ${entry.sessionId ?? null},
          ${entry.type}, ${entry.content},
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
          ${entry.type}, ${entry.content},
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
