import { Router, Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'

const router  = Router()
const prisma  = new PrismaClient()
const API_KEY = process.env.ORBIT_API_KEY || ''

// ─── Definição de todas as chaves configuráveis ────────────────────────────

interface KeyDef {
  key:         string   // nome da env var
  label:       string   // label na UI
  group:       string   // agrupamento
  type:        'secret' | 'text' | 'url'
  required:    boolean
  hint?:       string   // URL de onde obter a chave
}

const KEY_DEFINITIONS: KeyDef[] = [
  // ── IA / LLM ──────────────────────────────────────────────────────────────
  { key: 'GROQ_API_KEY',        label: 'Groq API Key',           group: 'IA / LLM',     type: 'secret', required: true,  hint: 'console.groq.com' },
  { key: 'GEMINI_API_KEY',      label: 'Gemini API Key',         group: 'IA / LLM',     type: 'secret', required: true,  hint: 'aistudio.google.com/app/apikey' },
  { key: 'COHERE_API_KEY',      label: 'Cohere API Key',         group: 'IA / LLM',     type: 'secret', required: false, hint: 'dashboard.cohere.com' },
  { key: 'OPENAI_API_KEY',      label: 'OpenAI API Key',         group: 'IA / LLM',     type: 'secret', required: false, hint: 'platform.openai.com/api-keys' },
  { key: 'ANTHROPIC_API_KEY',   label: 'Anthropic (Claude) Key', group: 'IA / LLM',     type: 'secret', required: false, hint: 'console.anthropic.com' },

  // ── Notificações ──────────────────────────────────────────────────────────
  { key: 'TELEGRAM_BOT_TOKEN',  label: 'Telegram Bot Token',     group: 'Notificações', type: 'secret', required: true,  hint: 'Criar bot via @BotFather no Telegram' },
  { key: 'TELEGRAM_CHAT_ID',    label: 'Telegram Chat ID',       group: 'Notificações', type: 'text',   required: true,  hint: 'Enviar msg ao bot e ver updates via API' },
  { key: 'PUSHOVER_API_KEY',    label: 'Pushover App Token',     group: 'Notificações', type: 'secret', required: false, hint: 'pushover.net' },
  { key: 'PUSHOVER_USER_KEY',   label: 'Pushover User Key',      group: 'Notificações', type: 'secret', required: false, hint: 'pushover.net' },

  // ── Meta / Instagram ──────────────────────────────────────────────────────
  { key: 'META_ACCESS_TOKEN',           label: 'Meta Access Token (Long-lived)',   group: 'Meta / Instagram', type: 'secret', required: false, hint: 'developers.facebook.com → Token Longo' },
  { key: 'META_ADS_ACCOUNT_ID',         label: 'Meta Ads Account ID (act_XXX)',   group: 'Meta / Instagram', type: 'text',   required: false, hint: 'business.facebook.com → Contas de Anúncios' },
  { key: 'INSTAGRAM_BUSINESS_ACCOUNT_ID', label: 'Instagram Business Account ID', group: 'Meta / Instagram', type: 'text',   required: false, hint: 'Meta Business Suite → Definições → Instagram' },

  // ── Google Ads ────────────────────────────────────────────────────────────
  { key: 'GOOGLE_ADS_DEVELOPER_TOKEN',  label: 'Google Ads Developer Token',  group: 'Google Ads', type: 'secret', required: false, hint: 'Google Ads → Ferramentas → API Center' },
  { key: 'GOOGLE_ADS_CLIENT_ID',        label: 'Google OAuth Client ID',       group: 'Google Ads', type: 'text',   required: false, hint: 'console.cloud.google.com → OAuth 2.0' },
  { key: 'GOOGLE_ADS_CLIENT_SECRET',    label: 'Google OAuth Client Secret',   group: 'Google Ads', type: 'secret', required: false, hint: 'console.cloud.google.com → OAuth 2.0' },
  { key: 'GOOGLE_ADS_REFRESH_TOKEN',    label: 'Google Refresh Token',         group: 'Google Ads', type: 'secret', required: false, hint: 'Autenticar 1x com OAuth → copiar refresh_token' },
  { key: 'GOOGLE_ADS_CUSTOMER_ID',      label: 'Google Ads Customer ID',       group: 'Google Ads', type: 'text',   required: false, hint: 'ID da conta Google Ads (sem hífens)' },

  // ── TikTok ────────────────────────────────────────────────────────────────
  { key: 'TIKTOK_ACCESS_TOKEN',  label: 'TikTok Access Token',   group: 'TikTok', type: 'secret', required: false, hint: 'business.tiktok.com → Developer Portal' },
  { key: 'TIKTOK_ADVERTISER_ID', label: 'TikTok Advertiser ID',  group: 'TikTok', type: 'text',   required: false, hint: 'TikTok Ads Manager → Conta' },

  // ── Monitorização ─────────────────────────────────────────────────────────
  { key: 'OPENWEATHER_API_KEY',  label: 'OpenWeather API Key',    group: 'Monitorização', type: 'secret', required: false, hint: 'openweathermap.org → API Keys (plano grátis)' },
  { key: 'HA_URL',               label: 'Home Assistant URL',     group: 'Monitorização', type: 'url',    required: false, hint: 'Ex: http://homeassistant.local:8123' },
  { key: 'HA_TOKEN',             label: 'Home Assistant Token',   group: 'Monitorização', type: 'secret', required: false, hint: 'HA → Perfil → Tokens de Acesso de Longa Duração' },
]

// ─── Helper: ler chave (DB primeiro, depois process.env) ───────────────────

async function readKey(envKey: string): Promise<string | null> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: `apikey_${envKey}` } })
    if (row?.value) return row.value
  } catch { /* ignorar */ }
  return process.env[envKey] || null
}

async function writeKey(envKey: string, value: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where:  { key: `apikey_${envKey}` },
    update: { value },
    create: { key: `apikey_${envKey}`, value },
  })
}

function maskValue(v: string): string {
  if (v.length <= 8) return '••••••••'
  return '••••' + v.slice(-4)
}

// ─── Auth middleware ───────────────────────────────────────────────────────

function auth(req: Request, res: Response, next: NextFunction): void {
  const token = (req.headers.authorization?.replace('Bearer ', '') || req.query['token']) as string
  if (token !== API_KEY) { res.status(401).json({ error: 'Unauthorized' }); return }
  next()
}

// ─── GET /api/settings/keys ────────────────────────────────────────────────

router.get('/keys', async (_req, res) => {
  const result: Record<string, { configured: boolean; masked: string; group: string; label: string; type: string; required: boolean; hint?: string }> = {}

  for (const def of KEY_DEFINITIONS) {
    const val = await readKey(def.key)
    result[def.key] = {
      configured: !!val,
      masked:     val ? maskValue(val) : '',
      group:      def.group,
      label:      def.label,
      type:       def.type,
      required:   def.required,
      hint:       def.hint,
    }
  }

  res.json({ keys: result, groups: [...new Set(KEY_DEFINITIONS.map(d => d.group))] })
})

// ─── POST /api/settings/keys ───────────────────────────────────────────────

router.post('/keys', async (req, res) => {
  const updates = req.body as Record<string, string>
  const saved: string[] = []
  const errors: string[] = []

  for (const [k, v] of Object.entries(updates)) {
    if (!v || typeof v !== 'string') continue
    const def = KEY_DEFINITIONS.find(d => d.key === k)
    if (!def) { errors.push(`Chave desconhecida: ${k}`); continue }
    try {
      await writeKey(k, v.trim())
      // Também actualizar process.env para uso imediato (sem restart)
      process.env[k] = v.trim()
      saved.push(k)
    } catch (err) {
      errors.push(`${k}: ${err instanceof Error ? err.message : 'erro'}`)
    }
  }

  res.json({ saved, errors, message: saved.length > 0 ? `${saved.length} chave(s) guardada(s)` : 'Nenhuma chave actualizada' })
})

// ─── POST /api/settings/test/:service ──────────────────────────────────────

router.post('/test/:service', async (req, res) => {
  const service = req.params.service

  try {
    if (service === 'groq') {
      const key = await readKey('GROQ_API_KEY')
      if (!key) return res.json({ ok: false, message: 'Chave não configurada' })
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
      return res.json({ ok: r.ok, message: r.ok ? '✅ Groq conectado' : `❌ Erro ${r.status}` })
    }

    if (service === 'gemini') {
      const key = await readKey('GEMINI_API_KEY')
      if (!key) return res.json({ ok: false, message: 'Chave não configurada' })
      const r = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`, { signal: AbortSignal.timeout(8000) })
      return res.json({ ok: r.ok, message: r.ok ? '✅ Gemini conectado' : `❌ Erro ${r.status}` })
    }

    if (service === 'telegram') {
      const token = await readKey('TELEGRAM_BOT_TOKEN')
      if (!token) return res.json({ ok: false, message: 'Token não configurado' })
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) })
      const data = await r.json() as { ok: boolean; result?: { username: string } }
      return res.json({ ok: data.ok, message: data.ok ? `✅ Bot: @${data.result?.username}` : '❌ Token inválido' })
    }

    if (service === 'openweather') {
      const key = await readKey('OPENWEATHER_API_KEY')
      if (!key) return res.json({ ok: false, message: 'Chave não configurada' })
      const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=Lisboa&appid=${key}`, { signal: AbortSignal.timeout(8000) })
      return res.json({ ok: r.ok, message: r.ok ? '✅ OpenWeather conectado' : `❌ Chave inválida (${r.status})` })
    }

    if (service === 'homeassistant') {
      const url   = await readKey('HA_URL')
      const token = await readKey('HA_TOKEN')
      if (!url || !token) return res.json({ ok: false, message: 'URL ou token não configurado' })
      const r = await fetch(`${url}/api/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
      return res.json({ ok: r.ok, message: r.ok ? '✅ Home Assistant conectado' : `❌ Erro ${r.status}` })
    }

    if (service === 'meta') {
      const token = await readKey('META_ACCESS_TOKEN')
      if (!token) return res.json({ ok: false, message: 'Token não configurado' })
      const r = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${token}`, { signal: AbortSignal.timeout(8000) })
      const data = await r.json() as { name?: string; error?: { message: string } }
      return res.json({ ok: r.ok, message: r.ok ? `✅ Meta: ${data.name}` : `❌ ${data.error?.message || 'Token inválido'}` })
    }

    if (service === 'cohere') {
      const key = await readKey('COHERE_API_KEY')
      if (!key) return res.json({ ok: false, message: 'Chave não configurada' })
      const r = await fetch('https://api.cohere.ai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
      return res.json({ ok: r.ok, message: r.ok ? '✅ Cohere conectado' : `❌ Erro ${r.status}` })
    }

    return res.json({ ok: false, message: `Serviço "${service}" sem teste implementado` })
  } catch (err) {
    return res.json({ ok: false, message: `❌ Timeout ou erro de rede: ${err instanceof Error ? err.message : String(err)}` })
  }
})

export { router as settingsRouter }
