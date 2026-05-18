import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { streamLLM, callLLM } from '../services/llm'
import { checkRateLimit } from '../services/rateLimiter'
import type { LLMMessage } from '../types'

const router = Router()
const prisma = new PrismaClient()

const TOKEN_LIMIT = 8000

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const AdvanceSchema = z.object({
  simulationId: z.string(),
  message: z.string().min(1).max(4000),
  traineeUserId: z.string(),
})

// SSE streaming endpoint
router.post('/advance', async (req: Request, res: Response) => {
  try {
    const parsed = AdvanceSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues })
    }

    const { simulationId, message, traineeUserId } = parsed.data

    // Rate limit: 10 req/min per user
    const allowed = await checkRateLimit(`sim:rl:${traineeUserId}`, 10, 60)
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded. Max 10 messages per minute.' })
    }

    // Load simulation
    const simulation = await prisma.userSimulation.findUnique({
      where: { id: simulationId },
      include: { scenario: true, messages: { orderBy: { createdAt: 'asc' } } },
    })

    if (!simulation) return res.status(404).json({ error: 'Simulation not found' })
    if (simulation.traineeUserId !== traineeUserId) return res.status(403).json({ error: 'Forbidden' })
    if (simulation.status !== 'ACTIVE') return res.status(400).json({ error: 'Simulation is not active' })

    // Token overflow guard
    if (simulation.totalTokens >= TOKEN_LIMIT) {
      return res.status(400).json({ error: 'Context limit reached. Please finalize this simulation.' })
    }

    const newTokens = estimateTokens(message)

    // Optimistic locking transaction
    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.userSimulation.findUnique({ where: { id: simulationId } })
        if (!fresh || fresh.version !== simulation.version) {
          throw new Error('VERSION_CONFLICT')
        }
        await tx.simulationMessage.create({
          data: {
            simulationId,
            role: 'HUMAN_AGENT',
            content: message,
            tokenCount: newTokens,
          },
        })
        await tx.userSimulation.update({
          where: { id: simulationId },
          data: {
            totalTokens: { increment: newTokens },
            version: { increment: 1 },
          },
        })
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'VERSION_CONFLICT') {
        return res.status(409).json({ error: 'Conflict: simulation was updated concurrently. Please retry.' })
      }
      throw err
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    sendEvent({ status: 'thinking' })

    // Build LLM messages (LLM plays the CLIENT)
    const llmMessages: LLMMessage[] = [
      { role: 'system', content: simulation.scenario.personaPrompt },
      ...simulation.messages.map(m => ({
        role: (m.role === 'HUMAN_AGENT' ? 'user' : 'assistant') as LLMMessage['role'],
        content: m.content,
      })),
      { role: 'user', content: message },
    ]

    // Try primary provider, fallback on error
    let streamResult: { content: string; promptTokens: number; completionTokens: number; model: string } | null = null
    const providers: Array<'GEMINI' | 'CLAUDE' | 'OPENAI'> = ['GEMINI', 'CLAUDE', 'OPENAI']
    let lastError: unknown

    for (let attempt = 0; attempt < 3; attempt++) {
      const provider = providers[attempt % providers.length]
      try {
        streamResult = await streamLLM(provider, llmMessages, (token) => {
          sendEvent({ token })
        })
        break
      } catch (err) {
        lastError = err
        console.warn(`[simulation/advance] Provider ${provider} failed (attempt ${attempt + 1}):`, err)
      }
    }

    if (!streamResult) {
      sendEvent({ status: 'error', message: 'All providers failed' })
      console.error('[simulation/advance] All providers failed:', lastError)
      res.end()
      return
    }

    // Save CLIENT_AI response
    const clientMsg = await prisma.simulationMessage.create({
      data: {
        simulationId,
        role: 'CLIENT_AI',
        content: streamResult.content,
        tokenCount: streamResult.completionTokens,
      },
    })

    await prisma.userSimulation.update({
      where: { id: simulationId },
      data: { totalTokens: { increment: streamResult.completionTokens } },
    })

    await prisma.lLMCallLog.create({
      data: {
        messageId: clientMsg.id,
        model: streamResult.model,
        provider: 'GEMINI',
        promptTokens: streamResult.promptTokens,
        completionTokens: streamResult.completionTokens,
        latencyMs: 0,
        responseTruncated: streamResult.content.substring(0, 500),
      },
    })

    sendEvent({ status: 'done' })
    res.end()
  } catch (err) {
    console.error('[simulation/advance]', err)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' })
    }
    res.end()
  }
})

// Create simulation
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { scenarioId, traineeUserId } = req.body
    if (!scenarioId || !traineeUserId) {
      return res.status(400).json({ error: 'scenarioId and traineeUserId are required' })
    }

    const scenario = await prisma.trainingScenario.findUnique({ where: { id: scenarioId } })
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' })

    const simulation = await prisma.userSimulation.create({
      data: { traineeUserId, scenarioId },
    })

    return res.json({ simulationId: simulation.id, status: simulation.status })
  } catch (err) {
    console.error('[simulation/create]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
