import 'dotenv/config'
import express, { Request, Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import chatRouter from './routes/chat'
import simulationRouter from './routes/simulation'
import autoTrainRouter from './routes/autoTrain'
import evaluationRouter from './routes/evaluation'
import adminApiRouter from './routes/adminApi'
import orbitRouter from './routes/orbit'
import { startEvaluationWorker } from './workers/evaluationWorker'
import { generateToken, verifyToken, requireAdminAuth } from './middleware/adminAuth'

const app = express()
app.set("trust proxy", 1)
const prisma = new PrismaClient()
const PORT = parseInt(process.env.PORT || '3002', 10)

const ALLOWED_ORIGINS = [
  'https://autotrack.pt',
  'https://www.autotrack.pt',
  'https://gps.autotrack.pt',
  'https://app.rinosat.com',
  'https://rinosat.com',
  'https://orbithubos.pt',
  'https://www.orbithubos.pt',
  'https://app.orbithubos.pt',
  'https://www.rinosat.com',
  'https://ia.orbithubos.pt',
  'http://localhost:3000',
  'http://localhost:3001',
]

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error('CORS: origin not allowed'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// BigInt → string serialization
app.set('json replacer', (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value,
)

// ─── Public routes ───────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'ai-command-center', timestamp: new Date().toISOString() })
})

app.get('/robots.txt', (_req: Request, res: Response) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /')
})

// Login page
app.get('/login', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/login.html'))
})

// Auth endpoints
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { password } = req.body
  const secret = process.env.INTERNAL_API_SECRET || ''
  if (!password || password !== secret) {
    return res.status(401).json({ error: 'Senha inválida' })
  }
  const token = generateToken(secret)
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, // 8h
  })
  return res.json({ ok: true })
})

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('admin_token')
  return res.json({ ok: true })
})

app.get('/api/auth/check', (req: Request, res: Response) => {
  const token = (req as Request & { cookies: Record<string, string> }).cookies?.admin_token
  const secret = process.env.INTERNAL_API_SECRET || ''
  return res.json({ authenticated: !!(token && verifyToken(token, secret)) })
})


// Widget script — publicly accessible with permissive CORS for embedding
app.get('/widget.js', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.sendFile(path.join(__dirname, '../public/widget.js'))
})

// ─── Chat API (public — protected by session context) ────────────────────────
app.use('/api/chat', chatRouter)
app.use('/api/simulation', simulationRouter)
app.use('/api/simulation', autoTrainRouter)
app.use('/api/simulation', evaluationRouter)

// ─── Admin panel (requires auth) ─────────────────────────────────────────────
app.use('/api/admin', requireAdminAuth, adminApiRouter)
app.use('/orbit', requireAdminAuth, orbitRouter)

// Serve admin static files
app.use('/admin', requireAdminAuth, express.static(path.join(__dirname, '../public/admin')))

// Root → redirect to admin
app.get('/', (_req: Request, res: Response) => {
  res.redirect('/admin')
})

// ─── Start ───────────────────────────────────────────────────────────────────
startEvaluationWorker()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ai-command-center] Running on port ${PORT}`)
})

export default app
