const sessions = new Map<string, { persona: string; expiresAt: number }>()
const TTL_MS = 4 * 60 * 60 * 1000

const DEBATE_PERSONAS: Record<string, string> = {
  investidor: 'investidor cético do OrbitHub OS — focado em métricas, ROI, risco e equity',
  socio: 'sócio co-fundador pragmático — questiona prioridades, prazos e divisão de esforço',
  cliente: 'cliente enterprise exigente — pressiona SLA, suporte e preço',
}

export function detectDebateStart(message: string): boolean {
  const m = message.trim().toLowerCase()
  return m.startsWith('/debate') || m.startsWith('modo debate')
}

export function detectDebateExit(message: string): boolean {
  const m = message.trim().toLowerCase()
  return m === '/debate off' || m === '/debate sair' || m === 'sair do debate'
}

export function parseDebatePersona(message: string): string {
  const m = message.trim().toLowerCase()
  if (m.includes('investidor')) return 'investidor'
  if (m.includes('sócio') || m.includes('socio')) return 'socio'
  if (m.includes('cliente')) return 'cliente'
  return 'investidor'
}

export function setDebateSession(sessionId: string, persona: string): void {
  sessions.set(sessionId, { persona, expiresAt: Date.now() + TTL_MS })
}

export function clearDebateSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function getDebateMode(sessionId: string): boolean {
  return isDebateSession(sessionId)
}

export function isDebateSession(sessionId: string): boolean {
  const s = sessions.get(sessionId)
  if (!s) return false
  if (s.expiresAt < Date.now()) {
    sessions.delete(sessionId)
    return false
  }
  return true
}

export function getDebatePrompt(sessionId: string): string {
  const persona = sessions.get(sessionId)?.persona || 'investidor'
  const role = DEBATE_PERSONAS[persona] || DEBATE_PERSONAS.investidor
  return `
## Modo DEBATE activo (obrigatório)
Tu assumes a persona: **${role}**.
- Objetivo: ajudar o Wanderson a **afiar argumentos** antes de reuniões reais — advogado do diabo.
- Questiona métricas, riscos, premissas e timing. Pede números quando faltarem.
- **Sem ferramentas de escrita** — só debate, análise e contra-argumentos.
- Tom: directo, PT-PT, respostas curtas (2–4 frases por turno salvo se pedirem profundidade).
- Não concordes por default; desafia quando a lógica for fraca.
- Para sair: "/debate off" ou "sair do debate".
`.trim()
}
