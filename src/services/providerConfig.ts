import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Config cache (30s TTL) ───────────────────────────────────────────────────
const cache = new Map<string, { apiKey: string; apiKey2: string; apiKey3: string; isEnabled: boolean; model: string; priority: number; ts: number }>()
const TTL = 30_000

// ─── Circuit breaker — por chave individual ───────────────────────────────────
// Chave de cooldown: 'GROQ:0', 'GROQ:1', 'GROQ:2' (índice da chave)
// Provider inteiro em cooldown só quando todas as chaves estão esgotadas
const keyCooldowns = new Map<string, number>()   // 'PROVIDER:keyIdx' → expiry
const keyErrors   = new Map<string, { code: number; message: string; ts: number }>()
const COOLDOWN_MS = 60 * 1000                     // 60 segundos por chave

export function markProviderCooldown(provider: string, ms = COOLDOWN_MS, errorCode?: number, errorMsg?: string) {
  for (let i = 0; i < 3; i++) {
    const slot = `${provider}:${i}`
    keyCooldowns.set(slot, Date.now() + ms)
    if (errorCode !== undefined) keyErrors.set(slot, { code: errorCode, message: errorMsg || '', ts: Date.now() })
  }
  console.warn(`[provider-cb] ${provider} todas as chaves em cooldown por ${Math.round(ms / 60000)}min${errorCode ? ' (HTTP ' + errorCode + ')' : ''}`)
}

export function markKeyCooldown(provider: string, keyIdx: number, ms = COOLDOWN_MS, errorCode?: number, errorMsg?: string) {
  const slot = `${provider}:${keyIdx}`
  keyCooldowns.set(slot, Date.now() + ms)
  if (errorCode !== undefined) keyErrors.set(slot, { code: errorCode, message: errorMsg || '', ts: Date.now() })
  console.warn(`[provider-cb] ${provider} chave ${keyIdx + 1} em cooldown por ${Math.round(ms / 60000)}min${errorCode ? ' (HTTP ' + errorCode + ')' : ''}`)
}

export function clearProviderCooldown(provider: string) {
  for (let i = 0; i < 3; i++) {
    keyCooldowns.delete(`${provider}:${i}`)
    keyErrors.delete(`${provider}:${i}`)
  }
}

export function getKeyError(provider: string, keyIdx: number): { code: number; message: string; ts: number } | null {
  return keyErrors.get(`${provider}:${keyIdx}`) ?? null
}

export function getKeyCooldownRemaining(provider: string, keyIdx: number): number {
  const slot = `${provider}:${keyIdx}`
  const exp = keyCooldowns.get(slot)
  if (!exp) return 0
  const rem = exp - Date.now()
  if (rem <= 0) { keyCooldowns.delete(slot); return 0 }
  return rem
}

export function getCooldownRemaining(provider: string): number {
  // Retorna o menor cooldown entre as chaves (0 = pelo menos uma chave disponível)
  const keys = [0, 1, 2].map(i => getKeyCooldownRemaining(provider, i))
  return Math.min(...keys)
}

export function isOnCooldown(provider: string): boolean {
  // Provider em cooldown só quando TODAS as chaves estão em cooldown
  return [0, 1, 2].every(i => getKeyCooldownRemaining(provider, i) > 0)
}

// ─── Obter próxima chave disponível para um provider ─────────────────────────
export async function getNextAvailableKey(provider: string): Promise<{ key: string; keyIdx: number; model: string } | null> {
  const cfg = await getProviderConfig(provider)
  if (!cfg.isEnabled) return null
  const keys = [cfg.apiKey, cfg.apiKey2, cfg.apiKey3].filter(k => k && k.trim().length > 0)
  for (let i = 0; i < keys.length; i++) {
    if (getKeyCooldownRemaining(provider, i) === 0) {
      return { key: keys[i], keyIdx: i, model: cfg.model }
    }
  }
  return null // todas as chaves em cooldown
}

// ─── Provider config ──────────────────────────────────────────────────────────
export async function getProviderConfig(provider: string) {
  const now = Date.now()
  const hit = cache.get(provider)
  if (hit && now - hit.ts < TTL) return hit

  const row = await prisma.providerConfig.findUnique({ where: { provider: provider as any } })
  if (!row) {
    const envKey = {
      GEMINI:   process.env.GEMINI_API_KEY,
      CLAUDE:   process.env.ANTHROPIC_API_KEY,
      OPENAI:   process.env.OPENAI_API_KEY,
      DEEPSEEK: process.env.DEEPSEEK_API_KEY,
      GROQ:     process.env.GROQ_API_KEY,
    }[provider] ?? ''
    return { apiKey: envKey, apiKey2: '', apiKey3: '', isEnabled: !!envKey, model: '', priority: 99 }
  }

  const entry = {
    apiKey:    row.apiKey,
    apiKey2:   (row as any).apiKey2 ?? '',
    apiKey3:   (row as any).apiKey3 ?? '',
    isEnabled: row.isEnabled,
    model:     row.model,
    priority:  row.priority,
    ts:        now
  }
  cache.set(provider, entry)
  return entry
}

// Returns all enabled providers ordered by priority, excluding those where all keys are on cooldown
export async function getEnabledProviders(skipCooldown = true): Promise<Array<{ provider: string; apiKey: string; model: string; priority: number }>> {
  const rows = await prisma.providerConfig.findMany({
    where: { isEnabled: true },
    orderBy: { priority: 'asc' },
  })
  return rows
    .filter(r => r.apiKey && (!skipCooldown || !isOnCooldown(r.provider)))
    .map(r => ({ provider: r.provider, apiKey: r.apiKey, model: r.model, priority: r.priority }))
}

// Status snapshot for admin API
export async function getProvidersStatus() {
  const rows = await prisma.providerConfig.findMany({ orderBy: { priority: 'asc' } })
  return rows.map(r => {
    const keys = [r.apiKey, (r as any).apiKey2 ?? '', (r as any).apiKey3 ?? '']
    const keyStatuses = keys.map((k, i) => {
      const err = getKeyError(r.provider, i)
      return {
        hasKey:     k.length > 0,
        masked:     k ? '••••' + k.slice(-4) : '',
        cooldownMs: getKeyCooldownRemaining(r.provider, i),
        errorCode:  err?.code ?? null,
        errorMsg:   err?.message?.slice(0, 80) ?? null,
      }
    })
    const totalCooldown = getCooldownRemaining(r.provider)
    return {
      provider:      r.provider,
      isEnabled:     r.isEnabled,
      model:         r.model,
      priority:      r.priority,
      hasKey:        r.apiKey.length > 0,
      apiKey:        r.apiKey ? '••••••••' + r.apiKey.slice(-6) : '',
      keyStatuses,
      cooldownMs:    totalCooldown,
      cooldownUntil: totalCooldown > 0
                       ? new Date(Date.now() + totalCooldown).toISOString()
                       : null,
    }
  })
}

export function invalidateProviderCache(provider?: string) {
  if (provider) cache.delete(provider)
  else cache.clear()
}
