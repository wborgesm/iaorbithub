// Reflection Worker — auto-avaliação semanal (módulo 42)
// Segunda-feira às 09:00 analisa os logs de auditoria da última semana e
// pede ao LLM 3 melhorias concretas. Resultado vai para Telegram (se
// configurado) ou cai em console.log.
//
// Adicional: trigger horário (08-22) se acumular >= 5 logs novos avaliados
// desde a última reflexão. Permite ciclo de melhoria mais apertado quando
// há sinal suficiente.
import { PrismaClient } from '@prisma/client'
import { callLLMAuto } from '../services/llm'
import { sendTelegramNotification } from '../services/telegramNotify'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'

const prisma = new PrismaClient()
const LAST_REFLECTION_KEY = 'orbit.last_reflection_at'
const HOURLY_THRESHOLD = 5

async function sendReflectionAlert(text: string): Promise<void> {
  try {
    const sent = await sendTelegramNotification(text)
    if (!sent) console.log('[reflectionWorker] (Telegram não configurado)\n' + text)
  } catch (err) {
    console.log('[reflectionWorker] fallback console.log:', (err as Error).message)
    console.log(text)
  }
}

async function runWeeklyReflection(): Promise<void> {
  const since = new Date(Date.now() - 7 * 86400000)

  const logs = await prisma.orbitAuditLog.findMany({
    where:   { createdAt: { gte: since }, outcome: { not: null } },
    orderBy: { createdAt: 'desc' },
    take:    100,
  })

  if (!logs.length) {
    console.log('[reflectionWorker] sem logs avaliados na última semana')
    return
  }

  const falsePositives = logs.filter(l => l.outcome === 'false_positive').length
  const missed         = logs.filter(l => l.outcome === 'missed').length
  const correct        = logs.filter(l => l.outcome === 'correct').length
  const total          = logs.length
  const accuracy       = Math.round((correct / total) * 100)

  const examples = logs
    .filter(l => l.outcome !== 'correct')
    .slice(0, 5)
    .map(l => `[${l.action}] ${l.outcome}: ${l.feedback || l.detail || 'sem detalhe'}`)
    .join('\n')

  const prompt = `ORBIT — Reflexão semanal de performance:
- Total de acções avaliadas: ${total}
- Correctas: ${correct} (${accuracy}%)
- Falsos positivos: ${falsePositives}
- Perdidas/Ignoradas: ${missed}

Exemplos de erros:
${examples || '(sem erros catalogados)'}

Identifica os padrões de erro e sugere 3 melhorias concretas para o ORBIT. Responde em português.`

  let llmText = ''
  try {
    const llmR = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
    llmText = llmR.content || ''
  } catch (err) {
    llmText = `(LLM falhou: ${(err as Error).message})`
  }

  await sendReflectionAlert(
    `🪞 *Reflexão Semanal ORBIT*\n` +
    `Precisão: ${accuracy}% (${correct}/${total})\n` +
    `Falsos positivos: ${falsePositives} | Perdidos: ${missed}\n\n` +
    (llmText || 'Sem sugestões geradas.'),
  )
}

// Trigger horário condicional — corre se houver >= 5 logs com outcome
// desde a última reflexão.
async function maybeRunHourlyReflection(): Promise<void> {
  try {
    const lastIso = await getOrbitConfig(LAST_REFLECTION_KEY)
    const since = lastIso ? new Date(lastIso) : new Date(Date.now() - 24 * 3600000)

    const newCount = await prisma.orbitAuditLog.count({
      where: {
        outcome:    { not: null },
        reviewedAt: { gt: since },
      },
    })

    if (newCount < HOURLY_THRESHOLD) return

    console.log(`[reflectionWorker] Trigger horário — ${newCount} logs novos avaliados`)
    await runWeeklyReflection()
    await setOrbitConfig(LAST_REFLECTION_KEY, new Date().toISOString())
  } catch (err) {
    console.warn('[reflectionWorker] hourly:', (err as Error).message)
  }
}

let reflectionScheduled = false
let lastRunKey          = ''
let lastHourlyKey       = ''

export function startReflectionWorker(): void {
  if (reflectionScheduled) return
  reflectionScheduled = true
  setInterval(() => {
    const now    = new Date()
    const dowDate = `${now.toISOString().slice(0, 10)}-${now.getDay()}`
    if (now.getDay() === 1 && now.getHours() === 9 && now.getMinutes() < 2 && lastRunKey !== dowDate) {
      lastRunKey = dowDate
      void runWeeklyReflection()
      void setOrbitConfig(LAST_REFLECTION_KEY, new Date().toISOString())
    }

    // Trigger horário — 08-22h, máx 1 vez por hora
    const hour = now.getHours()
    const hourlyStamp = `${now.toISOString().slice(0, 13)}` // YYYY-MM-DDTHH
    if (hour >= 8 && hour <= 22 && now.getMinutes() < 2 && lastHourlyKey !== hourlyStamp) {
      lastHourlyKey = hourlyStamp
      void maybeRunHourlyReflection()
    }
  }, 60 * 1000)
  console.log('[reflectionWorker] Activo — reflexão semanal (Seg 09:00) + horário condicional (08-22, ≥5 logs novos)')
}

export async function runWeeklyReflectionNow(): Promise<void> { await runWeeklyReflection() }
