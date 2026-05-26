// Silence Detector — detecta silêncios suspeitos (módulo 60)
// Corre a cada hora entre 08h e 22h. Verifica dispositivos sem heartbeat,
// clientes com padrão de uso diário que estão mudos, e tarefas urgentes
// sem updates.
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { setOrbitConfig } from '../services/orbitConfig'
import { sendTelegramNotification } from '../services/telegramNotify'

const prisma = new PrismaClient()

interface SilenceEvent {
  type:      string
  subject:   string
  expected:  string
  lastSeen:  string
  silentFor: string
  priority:  'HIGH' | 'MEDIUM' | 'LOW'
}

async function silenceAlert(text: string): Promise<void> {
  try {
    const sent = await sendTelegramNotification(text)
    if (!sent) console.log('[silenceDetector] (Telegram não configurado)\n' + text)
  } catch (err) {
    console.log('[silenceDetector] fallback console.log:', (err as Error).message)
    console.log(text)
  }
}

async function detectDeviceSilences(tracker: Pool): Promise<SilenceEvent[]> {
  const silences: SilenceEvent[] = []

  try {
    const r = await tracker.query(`
      SELECT d.name, d.uniqueid, d.lastupdate,
             (SELECT COUNT(*) FROM tc_positions p2
              WHERE p2.deviceid = d.id
                AND p2.fixtime > NOW() - INTERVAL '3 days'
                AND p2.speed > 2) AS recent_moves
      FROM tc_devices d
      WHERE d.disabled = false
        AND d.lastupdate < NOW() - INTERVAL '4 hours'
        AND d.lastupdate > NOW() - INTERVAL '7 days'
    `)
    for (const dev of r.rows) {
      if (parseInt(dev.recent_moves) > 10) {
        const hoursAgo = Math.round((Date.now() - new Date(dev.lastupdate).getTime()) / 3600000)
        silences.push({
          type:      'device_unexpected_silence',
          subject:   dev.name,
          expected:  'Heartbeat GPS periódico',
          lastSeen:  new Date(dev.lastupdate).toLocaleString('pt-PT'),
          silentFor: `${hoursAgo}h`,
          priority:  hoursAgo > 12 ? 'HIGH' : 'MEDIUM',
        })
      }
    }
  } catch { /* ignorar */ }

  return silences
}

async function detectClientSilences(tracker: Pool): Promise<SilenceEvent[]> {
  const silences: SilenceEvent[] = []

  try {
    const r = await tracker.query(`
      SELECT d.contact, d.name,
             COUNT(DISTINCT DATE(p.fixtime)) AS active_days_30
      FROM tc_devices d
      JOIN tc_positions p ON p.deviceid = d.id
      WHERE p.fixtime > NOW() - INTERVAL '30 days'
        AND p.speed > 2
        AND EXTRACT(DOW FROM p.fixtime) BETWEEN 1 AND 5
      GROUP BY d.contact, d.name, d.id
      HAVING COUNT(DISTINCT DATE(p.fixtime)) >= 20
        AND (SELECT COUNT(*) FROM tc_positions p2
             WHERE p2.deviceid = d.id
               AND DATE(p2.fixtime) = CURRENT_DATE
               AND p2.speed > 2) = 0
      LIMIT 10
    `)
    for (const dev of r.rows) {
      const hour = new Date().getHours()
      if (hour >= 10) {
        silences.push({
          type:      'expected_usage_missing',
          subject:   `${dev.name} (${dev.contact || 'sem contacto'})`,
          expected:  `Uso diário (activo ${dev.active_days_30} dos últimos 30 dias úteis)`,
          lastSeen:  'Ontem ou antes',
          silentFor: 'Hoje (dia útil)',
          priority:  'LOW',
        })
      }
    }
  } catch { /* ignorar */ }

  return silences
}

async function detectTaskSilences(): Promise<SilenceEvent[]> {
  const silences: SilenceEvent[] = []

  try {
    const staleTasks = await prisma.orbitTask.findMany({
      where: {
        status:    { not: 'DONE' },
        priority:  'URGENTE',
        updatedAt: { lt: new Date(Date.now() - 8 * 3600000) },
      },
      take: 5,
    })
    for (const task of staleTasks) {
      const hoursAgo = Math.round((Date.now() - task.updatedAt.getTime()) / 3600000)
      silences.push({
        type:      'urgent_task_stale',
        subject:   task.title,
        expected:  'Progresso em tarefa urgente',
        lastSeen:  task.updatedAt.toLocaleString('pt-PT'),
        silentFor: `${hoursAgo}h sem actualização`,
        priority:  'HIGH',
      })
    }
  } catch { /* ignorar */ }

  return silences
}

export async function runSilenceDetector(): Promise<void> {
  try {
    let tracker: Pool | null = null
    let deviceSilences:  SilenceEvent[] = []
    let clientSilences:  SilenceEvent[] = []
    if (process.env.AUTOTRACK_DATABASE_URL) {
      tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
      ;[deviceSilences, clientSilences] = await Promise.all([
        detectDeviceSilences(tracker),
        detectClientSilences(tracker),
      ])
      await tracker.end().catch(() => {})
    }
    const taskSilences = await detectTaskSilences()

    const all  = [...deviceSilences, ...clientSilences, ...taskSilences]
    const high = all.filter(s => s.priority === 'HIGH')

    if (all.length > 0) {
      try { await setOrbitConfig('silence_events', JSON.stringify(all)) } catch { /* ignorar */ }
    }

    for (const s of high) {
      await silenceAlert(
        `🔇 *Silêncio suspeito: ${s.subject}*\n` +
        `Esperado: ${s.expected}\n` +
        `Última actividade: ${s.lastSeen}\n` +
        `Silencioso há: ${s.silentFor}`,
      )
    }
  } catch (err) {
    console.error('[silenceDetector] Erro:', (err as Error).message)
  }
}

let silenceScheduled = false
let lastSilenceKey   = ''

export function startSilenceDetector(): void {
  if (silenceScheduled) return
  silenceScheduled = true
  setInterval(() => {
    const now  = new Date()
    const hour = now.getHours()
    const key  = `${now.toISOString().slice(0, 13)}` // por hora
    if (hour >= 8 && hour <= 22 && lastSilenceKey !== key) {
      lastSilenceKey = key
      void runSilenceDetector()
    }
  }, 5 * 60 * 1000)
  console.log('[silenceDetector] Activo — verificação horária (08h-22h)')
}
