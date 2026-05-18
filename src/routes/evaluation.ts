import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { z } from 'zod'

const router = Router()
const prisma = new PrismaClient()

export const evaluationQueue = new Queue('evaluation', {
  connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
})

const EvaluateSchema = z.object({
  simulationId: z.string(),
  traineeUserId: z.string(),
})

router.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const parsed = EvaluateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues })
    }

    const { simulationId, traineeUserId } = parsed.data

    const simulation = await prisma.userSimulation.findUnique({
      where: { id: simulationId },
    })

    if (!simulation) return res.status(404).json({ error: 'Simulation not found' })
    if (simulation.traineeUserId !== traineeUserId) return res.status(403).json({ error: 'Forbidden' })
    if (simulation.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Simulation is already ${simulation.status}` })
    }

    // Mark as evaluating
    await prisma.userSimulation.update({
      where: { id: simulationId },
      data: { status: 'EVALUATING' },
    })

    // Enqueue the evaluation job
    await evaluationQueue.add('evaluate-simulation', { simulationId, traineeUserId })

    return res.status(202).json({
      message: 'Evaluation started',
      simulationId,
    })
  } catch (err) {
    console.error('[evaluation/evaluate]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/status/:simulationId', async (req: Request, res: Response) => {
  try {
    const simulation = await prisma.userSimulation.findUnique({
      where: { id: req.params.simulationId as string },
      select: { status: true, score: true, feedback: true, completedAt: true },
    })

    if (!simulation) return res.status(404).json({ error: 'Simulation not found' })

    return res.json(simulation)
  } catch (err) {
    console.error('[evaluation/status]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
