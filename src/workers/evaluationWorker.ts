import { Worker } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { callLLM } from '../services/llm'
import type { LLMMessage } from '../types'

const prisma = new PrismaClient()

const EvalResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  feedback: z.string(),
})

function extractJSON(text: string): unknown {
  // Try direct parse first
  try { return JSON.parse(text) } catch { /* try extraction */ }
  // Extract JSON block from markdown or surrounding text
  const match = text.match(/\{[\s\S]*"score"[\s\S]*"feedback"[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { /* fall through */ }
  }
  return null
}

async function runEvaluation(simulationId: string) {
  const simulation = await prisma.userSimulation.findUnique({
    where: { id: simulationId },
    include: { scenario: true, messages: { orderBy: { createdAt: 'asc' } } },
  })

  if (!simulation) throw new Error(`Simulation ${simulationId} not found`)

  // Build transcript
  const transcript = simulation.messages
    .map(m => `[${m.role === 'HUMAN_AGENT' ? 'Agente' : 'Cliente'}]: ${m.content}`)
    .join('\n')

  const evalPrompt: LLMMessage[] = [
    {
      role: 'system',
      content: `Você é um supervisor de qualidade para equipes de suporte ao cliente. Avalie a conversa de treinamento abaixo.
Cenário: "${simulation.scenario.title}"
Persona do cliente: "${simulation.scenario.personaPrompt}"

Avalie o agente de 0 a 100 considerando:
- Empatia (relação com o cliente)
- Precisão Técnica (soluções corretas)
- Eficiência (resolução rápida)

Retorne APENAS um JSON válido no formato: {"score": <número 0-100>, "feedback": "<feedback construtivo em português>"}`,
    },
    {
      role: 'user',
      content: `Transcrição da conversa:\n${transcript}\n\nAvalie e retorne JSON.`,
    },
  ]

  let rawOutput = ''
  let parsedResult: z.infer<typeof EvalResultSchema> | null = null

  // Try providers in order
  for (const provider of ['CLAUDE', 'GEMINI', 'OPENAI'] as const) {
    try {
      const resp = await callLLM(provider, evalPrompt)
      rawOutput = resp.content || ''
      const extracted = extractJSON(rawOutput)
      const validated = EvalResultSchema.safeParse(extracted)
      if (validated.success) {
        parsedResult = validated.data
        break
      }
    } catch (err) {
      console.warn(`[evaluationWorker] Provider ${provider} failed:`, err)
    }
  }

  if (parsedResult) {
    await prisma.userSimulation.update({
      where: { id: simulationId },
      data: {
        score: parsedResult.score,
        feedback: parsedResult.feedback,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })
  } else {
    await prisma.userSimulation.update({
      where: { id: simulationId },
      data: {
        status: 'EVALUATION_FAILED',
        feedback: `Falha ao avaliar. Resposta bruta do modelo: ${rawOutput.substring(0, 1000)}`,
      },
    })
  }
}

export function startEvaluationWorker() {
  const worker = new Worker(
    'evaluation',
    async (job) => {
      const { simulationId } = job.data
      console.log(`[evaluationWorker] Processing simulation ${simulationId}`)
      await runEvaluation(simulationId)
      console.log(`[evaluationWorker] Done: ${simulationId}`)
    },
    {
      connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
      concurrency: 3,
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[evaluationWorker] Job ${job?.id} failed:`, err)
  })

  console.log('[evaluationWorker] Started')
  return worker
}
