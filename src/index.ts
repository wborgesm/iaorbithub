import 'dotenv/config'
import express, { Request, Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { transcribeAudio, runLivePipeline } from './services/liveMode'
import chatRouter from './routes/chat'
import simulationRouter from './routes/simulation'
import autoTrainRouter from './routes/autoTrain'
import evaluationRouter from './routes/evaluation'
import adminApiRouter from './routes/adminApi'
import orbitRouter from './routes/orbit'
import orbitVoiceRouter from './routes/orbitVoice'
import orbitBankingRouter from './routes/orbitBanking'
import orbitGoogleRouter from './routes/orbitGoogle'
import orbitHomeAssistantRouter from './routes/orbitHomeAssistant'
import orbitWhatsAppRouter from './routes/orbitWhatsApp'
import orbitVpsRouter from './routes/orbitVps'
import orbitIntegrationsRouter from './routes/orbitIntegrations'
import orbitJarvisRouter from './routes/orbitJarvis'
import { settingsRouter } from './routes/settings'
import { resumeWhatsAppWebIfPossible } from './services/whatsappWeb'
import { startWhatsAppWeb as startWhatsAppBusiness } from './services/whatsappBusiness'
import { startWhatsAppIntelligence } from './workers/whatsappIntelligence'
import { startEvaluationWorker } from './workers/evaluationWorker'
import { startMorningBriefingScheduler } from './workers/morningBriefing'
import { startProactiveMonitor } from './workers/proactiveMonitor'
import { startGarbageCollector } from './workers/garbageCollector'
import { startWhatsAppHealthMonitor } from './workers/whatsappHealthMonitor'
import { startInitiativeEngine } from './workers/initiativeEngine'
import { startSystemHealthMonitor } from './workers/systemHealthMonitor'
import { startMaintenanceMonitor } from './workers/maintenanceMonitor'
import { startCriticalAlertMonitor } from './workers/criticalAlertMonitor'
import { startHaIdleMonitor } from './workers/haIdleMonitor'
import { startMorningAlarmExtreme } from './workers/morningAlarmExtreme'
import { startChurnAnalysisWorker } from './workers/churnWorker'
import { startMediaWorker } from './workers/mediaWorker'
import { startExternalEventRadar } from './workers/externalEventRadar'
import { startReflectionWorker } from './workers/reflectionWorker'
import { startBehaviorProfiler } from './workers/behaviorProfiler'
import { startShadowObserver } from './workers/shadowObserver'
import { startSilenceDetector } from './workers/silenceDetector'
import { startNightBriefingScheduler, startWeeklyAutoTrainScheduler } from './workers/morningBriefing'
import { screenRouter } from './routes/screen'
import { droneRouter } from './routes/drone'
import { feedbackRouter } from './routes/feedback'
import { opsRouter } from './routes/ops'
import { adminIpWhitelist } from './modules/adminAccessAudit'
import { attachPrismaSlowQueryMonitor } from './services/prismaSlowQueryMonitor'
import { isProtocoloZeroActive, deactivateProtocoloZero } from './modules/protocoloZero'
import { generateToken, verifyToken, requireAdminAuth } from './middleware/adminAuth'

const app = express()
app.set("trust proxy", 1)
const prisma = attachPrismaSlowQueryMonitor(new PrismaClient())
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

app.get('/orbit/actions-setup', (_req: Request, res: Response) => {
  res.type('text/markdown; charset=utf-8')
  res.sendFile(path.join(__dirname, '../public/orbit/actions-setup.md'))
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


// ─── Protocolo Zero — bloqueia serviços públicos ─────────────────────────────
function protocoloZeroGate(req: Request, res: Response, next: () => void): void {
  if (!isProtocoloZeroActive()) return next()
  res.status(503).json({ error: 'Protocolo Zero activo. Serviço público suspenso.' })
}

app.post('/api/admin/protocolo-zero/off', requireAdminAuth, (_req: Request, res: Response) => {
  deactivateProtocoloZero()
  res.json({ ok: true, active: false })
})

// Widget script — publicly accessible with permissive CORS for embedding
app.get('/widget.js', protocoloZeroGate, (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.sendFile(path.join(__dirname, '../public/widget.js'))
})

// ─── Chat API (public — protected by session context) ────────────────────────
app.use('/api/chat', protocoloZeroGate, chatRouter)
app.use('/api/orbit', protocoloZeroGate, orbitVoiceRouter)
app.use('/api/simulation', protocoloZeroGate, simulationRouter)
app.use('/api/simulation', protocoloZeroGate, autoTrainRouter)
app.use('/api/simulation', protocoloZeroGate, evaluationRouter)
app.use('/api/orbit/truelayer', orbitBankingRouter)
app.use('/api/orbit/google', orbitGoogleRouter)
app.use('/api/orbit/homeassistant', orbitHomeAssistantRouter)
app.use('/api/orbit/whatsapp', orbitWhatsAppRouter)
app.use('/api/orbit/vps', orbitVpsRouter)
app.use('/api/orbit/integrations', protocoloZeroGate, orbitIntegrationsRouter)
app.use('/api/settings', requireAdminAuth, settingsRouter)
app.use('/api/orbit', protocoloZeroGate, orbitJarvisRouter)
app.use('/api/screen', screenRouter)
app.use('/api/drone', droneRouter)
app.use('/api/feedback', feedbackRouter)
app.use('/api/ops', opsRouter)
app.get('/orbit/ops', (_req: Request, res: Response) => {
  res.sendFile('ops.html', { root: '/opt/ai-command-center/public/orbit' })
})
app.get('/orbit/settings', requireAdminAuth, (_req: Request, res: Response) => {
  res.sendFile('settings.html', { root: '/opt/ai-command-center/public/orbit' })
})
app.use('/tmp', express.static('/opt/ai-command-center/public/tmp'))

// ─── Admin panel (requires auth) ─────────────────────────────────────────────
app.use('/api/admin', adminIpWhitelist, requireAdminAuth, adminApiRouter)
app.use('/orbit', adminIpWhitelist, requireAdminAuth, orbitRouter)

// Serve admin static files
app.use('/admin', requireAdminAuth, express.static(path.join(__dirname, '../public/admin')))

// Root → redirect to admin
app.get('/', (_req: Request, res: Response) => {
  res.redirect('/admin')
})

// ─── Start ───────────────────────────────────────────────────────────────────
startEvaluationWorker()
startMorningBriefingScheduler()
startProactiveMonitor()
startGarbageCollector()
startWhatsAppHealthMonitor()
startSystemHealthMonitor()
startInitiativeEngine()
startMaintenanceMonitor()
startCriticalAlertMonitor()
startHaIdleMonitor()
startMorningAlarmExtreme()
startChurnAnalysisWorker()
startMediaWorker()
void resumeWhatsAppWebIfPossible()
if (process.env.WHATSAPP_BUSINESS_ENABLED === 'true') {
  void startWhatsAppBusiness()
}
startWhatsAppIntelligence()
startExternalEventRadar()
startReflectionWorker()
startBehaviorProfiler()
startShadowObserver()
startSilenceDetector()
startNightBriefingScheduler()
startWeeklyAutoTrainScheduler()

const shutdown = async (signal: string) => {
  console.log(`[index] ${signal} recebido — a encerrar…`)
  try {
    const { shutdownWhatsAppWeb } = await import('./services/whatsappWeb')
    await Promise.race([shutdownWhatsAppWeb(), new Promise(r => setTimeout(r, 10000))])
  } catch { /* ignore */ }
  process.exit(0)
}
process.once('SIGTERM', () => { void shutdown('SIGTERM') })
process.once('SIGINT', () => { void shutdown('SIGINT') })

const httpServer = createServer(app)

// ── WebSocket — Modo Live ────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws/live' })

interface LiveClient extends WebSocket {
  sessionHistory?: Array<{ role: string; content: string }>
  currentSession?: { abort: () => void }
}

wss.on('connection', (ws: LiveClient, req) => {
  const cookies = req.headers.cookie || ''
  const hasSession = cookies.includes('orbit_session=') || cookies.includes('adminToken=')
  if (!hasSession) { ws.close(4001, 'Unauthorized'); return }

  ws.sessionHistory = []
  console.log('[liveMode] Cliente WebSocket ligado')

  ws.on('message', async (data: Buffer, isBinary: boolean) => {
    try {
      if (isBinary) {
        const text = await transcribeAudio(data)
        if (!text) return
        ws.send(JSON.stringify({ type: 'transcript', text }))

        if (ws.currentSession) ws.currentSession.abort()

        ws.currentSession = await runLivePipeline(
          text,
          ws.sessionHistory ?? [],
          (textChunk) => ws.send(JSON.stringify({ type: 'text_chunk', text: textChunk })),
          (wavBuffer) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(wavBuffer)
          },
          (fullReply) => {
            ws.sessionHistory?.push({ role: 'user', content: text })
            ws.sessionHistory?.push({ role: 'assistant', content: fullReply })
            if ((ws.sessionHistory?.length ?? 0) > 20) ws.sessionHistory = ws.sessionHistory?.slice(-20)
            ws.send(JSON.stringify({ type: 'done', text: fullReply }))
          },
          (err) => ws.send(JSON.stringify({ type: 'error', text: err })),
        )
      } else {
        const msg = JSON.parse(data.toString()) as { type: string }
        if (msg.type === 'abort') ws.currentSession?.abort()
        if (msg.type === 'clear') ws.sessionHistory = []
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', text: (e as Error).message }))
    }
  })

  ws.on('close', () => {
    ws.currentSession?.abort()
    console.log('[liveMode] Cliente WebSocket desligado')
  })
})
// ── fim WebSocket ─────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[ai-command-center] Running on port ${PORT}`)
})

export default app
