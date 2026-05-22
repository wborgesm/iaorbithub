import crypto from 'crypto'

interface PendingApproval {
  id: string
  sessionId: string
  siteId: string
  toolName: string
  args: Record<string, unknown>
  resolve: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
  createdAt: Date
}

const queue = new Map<string, PendingApproval>()
const DEFAULT_TIMEOUT_MS = 30_000

export function getPendingApprovals() {
  return [...queue.values()].map(({ id, sessionId, siteId, toolName, args, createdAt }) => ({
    id, sessionId, siteId, toolName, args, createdAt: createdAt.toISOString(),
  }))
}

export function requestApproval(
  sessionId: string,
  siteId: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise(resolve => {
    const id = crypto.randomUUID()

    const timer = setTimeout(() => {
      queue.delete(id)
      console.warn(`[humanApproval] Timeout — rejeitado automaticamente: ${toolName} [${id}]`)
      resolve(false)
    }, timeoutMs)

    queue.set(id, { id, sessionId, siteId, toolName, args, resolve, timer, createdAt: new Date() })
    console.log(`[humanApproval] A aguardar aprovação: ${toolName} args=${JSON.stringify(args)} [${id}]`)
  })
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const entry = queue.get(id)
  if (!entry) return false
  clearTimeout(entry.timer)
  queue.delete(id)
  console.log(`[humanApproval] ${approved ? 'APROVADO' : 'REJEITADO'}: ${entry.toolName} [${id}]`)
  entry.resolve(approved)
  return true
}
