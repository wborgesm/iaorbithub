import crypto from 'crypto'
import { getOrbitConfig } from '../services/orbitConfig'
import { isHabitTrusted } from './orbitHabits'
import type { ToolCallResult } from '../types'

export const TOOLS_REQUIRING_CONFIRMATION = new Set([
  'sendEmail',
  'controlSmartHome',
  'createCalendarEvent',
  'sendWhatsApp',
])

/** trusted: casa/calendário/WhatsApp directo; email confirma */
const TRUSTED_STILL_CONFIRM = new Set(['sendEmail'])

/** jarvis: só email confirma — resto executa directo */
const JARVIS_CONFIRM = new Set(['sendEmail'])

function parseTrustedTools(raw: string): Set<string> {
  return new Set(
    raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean),
  )
}

export async function toolRequiresConfirmation(
  toolName: string,
  domain?: string,
  args?: Record<string, unknown>,
): Promise<boolean> {
  if (domain !== 'orbit.internal') return false
  if (!TOOLS_REQUIRING_CONFIRMATION.has(toolName)) return false

  const trust = ((await getOrbitConfig('trust_level')) || 'learning').toLowerCase()
  if (trust === 'jarvis') return JARVIS_CONFIRM.has(toolName)
  if (trust === 'trusted') return TRUSTED_STILL_CONFIRM.has(toolName)

  const trustedTools = parseTrustedTools(await getOrbitConfig('trusted_tools'))
  if (trustedTools.has(toolName)) return false

  if (args && (await isHabitTrusted(toolName, args))) return false

  return true
}

export function describePendingAction(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'sendEmail':
      return `Enviar email para ${args.to} — assunto: "${args.subject}"`
    case 'controlSmartHome':
      return `${args.action === 'on' ? 'Ligar' : args.action === 'off' ? 'Desligar' : 'Alternar'} ${args.device}${args.value ? ` (${args.value})` : ''}`
    case 'createCalendarEvent':
      return `Criar evento "${args.title}" em ${args.date || args.start || 'data indicada'}`
    case 'sendWhatsApp':
      return `Enviar WhatsApp para ${args.to}: "${String(args.message || '').slice(0, 80)}"`
    default:
      return `Executar ${tool}`
  }
}

interface PendingConfirmation {
  id: string
  sessionId: string
  siteId: string
  toolName: string
  args: Record<string, unknown>
  userMessageId: string
  description: string
  createdAt: Date
  expiresAt: Date
}

const queue = new Map<string, PendingConfirmation>()

const TTL_MS = 10 * 60 * 1000

export function createPendingConfirmation(input: {
  sessionId: string
  siteId: string
  toolName: string
  args: Record<string, unknown>
  userMessageId: string
}): PendingConfirmation {
  const id = crypto.randomUUID()
  const entry: PendingConfirmation = {
    id,
    sessionId: input.sessionId,
    siteId: input.siteId,
    toolName: input.toolName,
    args: input.args,
    userMessageId: input.userMessageId,
    description: describePendingAction(input.toolName, input.args),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + TTL_MS),
  }
  queue.set(id, entry)
  console.log(`[orbitConfirmation] Pendente: ${input.toolName} [${id}]`)
  return entry
}

export function getPendingConfirmation(id: string): PendingConfirmation | null {
  const entry = queue.get(id)
  if (!entry) return null
  if (entry.expiresAt.getTime() < Date.now()) {
    queue.delete(id)
    return null
  }
  return entry
}

export function consumePendingConfirmation(id: string): PendingConfirmation | null {
  const entry = getPendingConfirmation(id)
  if (!entry) return null
  queue.delete(id)
  return entry
}

export function formatToolResult(toolName: string, result: ToolCallResult): string {
  if (!result.success) {
    return `Não foi possível concluir ${toolName}: ${result.error || 'erro desconhecido'}`
  }
  const data = result.data as Record<string, unknown> | undefined
  if (toolName === 'sendEmail' && data?.message) return String(data.message)
  if (toolName === 'createCalendarEvent' && data?.message) return String(data.message)
  if (toolName === 'controlSmartHome' && data?.device) {
    return `${data.device}: acção ${data.action} executada.`
  }
  if (data?.message) return String(data.message)
  return `Operação ${toolName} concluída com sucesso.`
}
