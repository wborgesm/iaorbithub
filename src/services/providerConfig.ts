import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const cache = new Map<string, { apiKey: string; isEnabled: boolean; model: string; ts: number }>()
const TTL = 30_000 // 30s cache

export async function getProviderConfig(provider: string) {
  const now = Date.now()
  const hit = cache.get(provider)
  if (hit && now - hit.ts < TTL) return hit

  const row = await prisma.providerConfig.findUnique({ where: { provider: provider as any } })
  if (!row) {
    // fallback to env var
    const envKey = {
      GEMINI: process.env.GEMINI_API_KEY,
      CLAUDE: process.env.ANTHROPIC_API_KEY,
      OPENAI: process.env.OPENAI_API_KEY,
      DEEPSEEK: process.env.DEEPSEEK_API_KEY,
      GROQ: process.env.GROQ_API_KEY,
    }[provider] ?? ''
    return { apiKey: envKey, isEnabled: !!envKey, model: '' }
  }

  const entry = { apiKey: row.apiKey, isEnabled: row.isEnabled, model: row.model, ts: now }
  cache.set(provider, entry)
  return entry
}

export function invalidateProviderCache(provider?: string) {
  if (provider) cache.delete(provider)
  else cache.clear()
}
