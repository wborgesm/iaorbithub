// src/services/scriptGenerator.ts
// Módulos 178, 179, 181, 182 — Script Generator, Market Reaction, Adaptive Copy, Smart Follow-up
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── M178 Auto Script Generator ───────────────────────────────────────────────
interface ScriptReq {
  audience?: string
  platform?: string
  duration?: number
  angle?: string
  context?: string
}

export async function generateVideoScript(req: ScriptReq): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const {
    audience = 'proprietário de moto em Portugal',
    platform = 'instagram_reels',
    duration = 30,
    angle = 'medo',
    context = '',
  } = req

  const platformLabel: Record<string, string> = {
    tiktok: 'TikTok (ritmo rápido, texto curto, informal)',
    instagram_reels: 'Instagram Reels (visual limpo, CTA claro)',
    facebook_ads: 'Facebook Ads (copy mais longo, foco em benefício)',
    youtube_shorts: 'YouTube Shorts (gancho nos primeiros 3s)',
  }
  const angleLabel: Record<string, string> = {
    medo: 'medo de roubo — urgência emocional',
    prova_social: 'prova social real — recuperação/depoimento',
    custo_beneficio: 'custo vs benefício — ROI racional',
    urgencia: 'urgência e escassez — oferta limitada',
  }

  const llm = await callLLMAuto([{
    role: 'user',
    content: `Cria roteiro de vídeo para anúncio pago da Rinosat (GPS para motos, Portugal).

Público: ${audience}
Plataforma: ${platformLabel[platform] || platform}
Duração: ${duration}s
Ângulo: ${angleLabel[angle] || angle}
${context ? `Contexto extra: ${context}` : ''}

ESTRUTURA OBRIGATÓRIA:
🎬 HOOK (0-3s): [frase que para o scroll]
😟 PROBLEMA (3-10s): [dor do público]
✅ PROVA (10-20s): [facto real ou caso de recuperação]
💡 SOLUÇÃO (20-${duration - 5}s): [produto/serviço]
📲 CTA (últimos 3s): [chamada à acção]

TEXT OVERLAY (5 frases curtas para o ecrã):
[lista]

COPY DA LEGENDA (max 125 chars):
[texto]

Português de Portugal. Tom ${angle === 'medo' ? 'urgente/emocional' : angle === 'prova_social' ? 'autêntico' : 'directo'}.`
  }], 'GROQ')

  return llm.content || 'Erro ao gerar roteiro'
}

// ─── M181 Adaptive Copy by Profile ────────────────────────────────────────────
interface CopyReq {
  profile: string
  format: string
  topic: string
}

export async function generateAdaptiveCopy(req: CopyReq): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const profiles: Record<string, string> = {
    emocional: 'medo de roubo, protecção da moto, paz de espírito. Tom: empático e urgente.',
    racional: 'custo/benefício, ROI, dados de recuperação. Tom: técnico e directo.',
    empresa: 'gestão de frota, conformidade, protecção de activos. Tom: profissional.',
    jovem: 'independência, tecnologia, lifestyle. Tom: casual e moderno.',
    experiente: 'confiabilidade, suporte, simplicidade. Tom: seguro e humano.',
  }

  const llm = await callLLMAuto([{
    role: 'user',
    content: `Gera copy de marketing para a Rinosat (GPS motos Portugal).

Perfil do cliente: ${profiles[req.profile] || req.profile}
Formato: ${req.format}
Tema: ${req.topic}

Cria 3 variações. Curto e directo. Português de Portugal.`
  }], 'GROQ')

  return llm.content || 'Erro ao gerar copy'
}

// ─── M182 Smart Follow-up ─────────────────────────────────────────────────────
export async function smartFollowup(): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const leadKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
  const leads = leadKeys.map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]

  const now = Date.now()
  const DAY = 86400000

  const needFollowup = leads.filter((l: any) => {
    const classifiedAt = l.classifiedAt ? new Date(l.classifiedAt).getTime() : 0
    const age = now - classifiedAt
    if (l.classification === 'QUENTE' && age > DAY) return true
    if (l.classification === 'MORNO' && age > 3 * DAY) return true
    if (l.classification === 'FRIO' && age > 7 * DAY) return true
    return false
  })

  if (!needFollowup.length) return '✅ Todos os leads têm follow-up em dia.'

  const list = needFollowup.slice(0, 8).map((l: any) => {
    const age = Math.floor((now - new Date(l.classifiedAt || Date.now()).getTime()) / DAY)
    return `- ${l.contact || '(sem nome)'} [${l.classification}] — ${age}d sem contacto | ${l.reason || 'sem motivo'}`
  }).join('\n')

  const llm = await callLLMAuto([{
    role: 'user',
    content: `Leads da Rinosat que precisam de follow-up:\n${list}\n\nPara cada lead, sugere UMA mensagem WhatsApp curta e personalizada (max 100 chars). Português de Portugal, tom conversacional.`
  }], 'GROQ')

  return `📤 *Smart Follow-up — ${needFollowup.length} leads a contactar:*\n\n${llm.content || ''}`
}

// ─── M179 Market Reaction ─────────────────────────────────────────────────────
export async function marketReaction(): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const leadKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
  const leads = leadKeys.map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]

  const now = Date.now()
  const WEEK = 7 * 86400000
  const recentLeads = leads.filter((l: any) => l.createdAt && (now - new Date(l.createdAt).getTime()) < WEEK)
  const recentHot = recentLeads.filter((l: any) => l.classification === 'QUENTE').length
  const totalRecent = recentLeads.length

  const weeklyVelocity = totalRecent
  const convRate = totalRecent > 0 ? (recentHot / totalRecent * 100).toFixed(1) : '0'

  const llm = await callLLMAuto([{
    role: 'user',
    content: `Analisa o estado do mercado da Rinosat (GPS motos Portugal) com base em:
- Novos leads esta semana: ${weeklyVelocity}
- Taxa de leads quentes: ${convRate}%
- Tendência: ${weeklyVelocity > 10 ? 'mercado aquecido' : weeklyVelocity > 5 ? 'mercado normal' : 'mercado frio'}

Detecta possíveis mudanças de mercado e sugere 2-3 reacções táticas imediatas.
Formato: lista directa. Português de Portugal.`
  }], 'GROQ')

  return `📡 *Market Reaction:*\nLeads semana: ${weeklyVelocity} | Taxa quentes: ${convRate}%\n\n${llm.content || ''}`
}
