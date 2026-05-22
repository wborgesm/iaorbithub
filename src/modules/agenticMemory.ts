import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

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
