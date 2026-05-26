// Shadow Observer — observador silencioso (módulo 53)
// Domingo 20:00 colecta padrões da semana e entrega relatório com insights.
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { callLLMAuto } from '../services/llm'
import { setOrbitConfig, getOrbitConfig } from '../services/orbitConfig'
import { sendViaWhatsAppWeb } from '../services/whatsappWeb'
import { sendTelegramNotification } from '../services/telegramNotify'

const prisma = new PrismaClient()

interface Observation {
  category: string
  finding:  string
  data:     Record<string, unknown>
}

async function sendShadowReport(text: string): Promise<void> {
  // 1ª escolha: WhatsApp pessoal (orbit.owner_whatsapp)
  try {
    const owner = (await getOrbitConfig('owner_whatsapp')).trim()
    if (owner) {
      const r = await sendViaWhatsAppWeb(owner, text)
      if (r.ok) return
    }
  } catch { /* tenta fallback */ }

  // 2ª escolha: Telegram
  try {
    const sent = await sendTelegramNotification(text)
    if (sent) return
  } catch { /* tenta fallback */ }

  console.log('[shadowObserver] (sem destino configurado) ' + text)
}

async function collectObservations(): Promise<Observation[]> {
  const obs: Observation[] = []
  const since = new Date(Date.now() - 7 * 86400000)

  let tracker: Pool | null = null
  if (process.env.AUTOTRACK_DATABASE_URL) {
    tracker = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
  }

  // Observação 1: clientes que mais geram alertas falsos
  if (tracker) {
    try {
      const devAlarms = await tracker.query(`
        SELECT d.contact, COUNT(*) AS cnt
        FROM tc_events e
        JOIN tc_devices d ON d.id = e.deviceid
        WHERE e.servertime > $1 AND e.type = 'alarm'
        GROUP BY d.contact
        ORDER BY cnt DESC
        LIMIT 5
      `, [since])
      if (devAlarms.rows.length) {
        obs.push({
          category: 'alertas',
          finding:  'Top clientes por volume de alarmes esta semana',
          data:     { clients: devAlarms.rows },
        })
      }
    } catch { /* ignorar */ }
  }

  // Observação 2: ferramenta ORBIT mais usada
  try {
    const toolUsage = await prisma.orbitAuditLog.groupBy({
      by:      ['action'],
      where:   { createdAt: { gte: since }, source: 'tool' },
      _count:  { id: true },
      orderBy: { _count: { id: 'desc' } },
      take:    5,
    })
    if (toolUsage.length) {
      obs.push({
        category: 'uso',
        finding:  'Ferramentas ORBIT mais usadas na semana',
        data:     { tools: toolUsage.map(t => ({ tool: t.action, uses: t._count.id })) },
      })
    }
  } catch { /* ignorar */ }

  // Observação 3: dispositivos com falhas recorrentes
  if (tracker) {
    try {
      const failDevs = await tracker.query(`
        SELECT d.name, COUNT(*) AS fail_count
        FROM tc_events e
        JOIN tc_devices d ON d.id = e.deviceid
        WHERE e.servertime > $1
          AND e.type IN ('deviceOffline','deviceUnknown')
        GROUP BY d.name
        HAVING COUNT(*) >= 5
        ORDER BY fail_count DESC
        LIMIT 5
      `, [since])
      if (failDevs.rows.length) {
        obs.push({
          category: 'hardware',
          finding:  'Dispositivos com falhas recorrentes esta semana',
          data:     { devices: failDevs.rows },
        })
      }
    } catch { /* ignorar */ }
  }

  // Observação 4: padrão de actividade (hora de pico ORBIT)
  try {
    const hourlyUsage = await prisma.orbitAuditLog.findMany({
      where:   { createdAt: { gte: since } },
      select:  { createdAt: true },
      orderBy: { createdAt: 'asc' },
      take:    500,
    })
    const hourBuckets: Record<number, number> = {}
    for (const log of hourlyUsage) {
      const h = log.createdAt.getHours()
      hourBuckets[h] = (hourBuckets[h] || 0) + 1
    }
    const peakHour = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0]
    if (peakHour) {
      obs.push({
        category: 'padrão',
        finding:  `Hora de pico de uso do ORBIT: ${peakHour[0]}h (${peakHour[1]} acções)`,
        data:     hourBuckets,
      })
    }
  } catch { /* ignorar */ }

  if (tracker) await tracker.end().catch(() => {})
  return obs
}

async function runShadowReport(): Promise<void> {
  const observations = await collectObservations()
  if (!observations.length) {
    console.log('[shadowObserver] nada para reportar esta semana')
    return
  }

  const obsText = observations
    .map(o => `[${o.category.toUpperCase()}] ${o.finding}\nDados: ${JSON.stringify(o.data)}`)
    .join('\n\n')

  const prompt = `Como observador silencioso do sistema ORBIT, analisa estas observações da semana passada:

${obsText}

Identifica 3-5 insights accionáveis — padrões que o utilizador provavelmente não percebeu. Foca em:
- Ineficiências ou desperdícios de tempo
- Riscos ocultos
- Oportunidades de melhoria

Responde em português, tom directo, máx 250 palavras.`

  let llmText = ''
  try {
    const llmR = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
    llmText = llmR.content || ''
  } catch (err) {
    llmText = `(LLM falhou: ${(err as Error).message})`
  }

  await sendShadowReport(
    `👁️ *Relatório Shadow — Semana ${new Date().toLocaleDateString('pt-PT')}*\n\n` +
    (llmText || 'Sem insights gerados.'),
  )

  try {
    await setOrbitConfig('shadow_last_report', new Date().toISOString())
  } catch { /* ignorar */ }
}

let shadowScheduled = false
let lastShadowKey   = ''

export function startShadowObserver(): void {
  if (shadowScheduled) return
  shadowScheduled = true
  setInterval(() => {
    const now = new Date()
    const key = `${now.toISOString().slice(0, 10)}-shadow`
    if (now.getDay() === 0 && now.getHours() === 20 && now.getMinutes() < 2 && lastShadowKey !== key) {
      lastShadowKey = key
      void runShadowReport()
    }
  }, 60 * 1000)
  console.log('[shadowObserver] Activo — relatório domingo 20:00')
}
