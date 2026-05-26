// Confidence Gate — ORBIT pede confirmação quando não tem certeza (módulo 54)
// Calcula um score de confiança a partir de sinais binários (cada sinal vale
// "confidente" ou "não confidente"). Score < 70% → pede confirmação humana.

export interface ConfidenceCheck {
  score:         number    // 0-100
  requiresHuman: boolean
  reason:        string
  suggestion:    string
}

export function checkConfidence(
  action:   string,
  signals:  { label: string; confident: boolean }[],
  context?: string,
): ConfidenceCheck {
  const total     = Math.max(signals.length, 1)
  const positives = signals.filter(s => s.confident).length
  const score     = Math.round((positives / total) * 100)

  const requiresHuman = score < 70

  const missing = signals.filter(s => !s.confident).map(s => s.label).join(', ')
  const present = signals.filter(s =>  s.confident).map(s => s.label).join(', ')

  const reason = requiresHuman
    ? `Score de confiança: ${score}%. Sinais inconclusivos: ${missing || '—'}${context ? ` | contexto: ${context}` : ''}`
    : `Confiança suficiente (${score}%): ${present || '—'}`

  const suggestion = requiresHuman
    ? `Confirma: queres mesmo executar "${action}"? Responde com "sim, confirmo" para prosseguir.`
    : `A executar "${action}" com confiança ${score}%.`

  return { score, requiresHuman, reason, suggestion }
}
