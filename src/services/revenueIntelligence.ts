// src/services/revenueIntelligence.ts
// Módulos 171, 174, 175, 180, 185, 186 — Revenue Autopilot, Funnel Surgeon,
// Revenue Forecast, Growth Simulator, CEO Decision Layer, Opportunity Alert
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

const prisma = new PrismaClient()

async function getAutotrack(): Promise<Pool> {
  return new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
}

// ─── M171 Revenue Autopilot ───────────────────────────────────────────────────
export async function runRevenueAutopilot(): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const pool = await getAutotrack()

  const [invoiceR, overdueR] = await Promise.all([
    pool.query(`
      SELECT DATE_TRUNC('week', created_at) AS week,
             COUNT(*) AS cnt, COALESCE(SUM(amount_due),0) AS revenue
      FROM billing_invoice
      WHERE created_at > NOW() - INTERVAL '60 days' AND status != 'cancelled'
      GROUP BY week ORDER BY week DESC LIMIT 8`),
    pool.query(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_due - amount_paid),0) AS debt
      FROM billing_invoice WHERE status = 'open' AND due_date < NOW()`),
  ])
  await pool.end()

  const leadKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
  const leads = leadKeys.map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]
  const hot = leads.filter((l: any) => l.classification === 'QUENTE').length
  const warm = leads.filter((l: any) => l.classification === 'MORNO').length
  const cold = leads.filter((l: any) => l.classification === 'FRIO').length
  const total = leads.length

  const weekRows = invoiceR.rows
  const recentRevenue = weekRows.slice(0, 4).reduce((s: number, r: any) => s + parseFloat(r.revenue), 0)
  const prevRevenue = weekRows.slice(4, 8).reduce((s: number, r: any) => s + parseFloat(r.revenue), 0)
  const trend = prevRevenue > 0 ? ((recentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : '0'

  let metaStats = 'Meta Ads: chave não configurada'
  try {
    const tok = await prisma.systemConfig.findUnique({ where: { key: 'apikey_META_ACCESS_TOKEN' } })
    const acc = await prisma.systemConfig.findUnique({ where: { key: 'apikey_META_ADS_ACCOUNT_ID' } })
    if (tok?.value && acc?.value) {
      const r = await fetch(
        `https://graph.facebook.com/v18.0/${acc.value}/insights?fields=spend,clicks,cpc,reach&date_preset=last_30d&access_token=${tok.value}`,
        { signal: AbortSignal.timeout(8000) }
      )
      const d = await r.json() as any
      if (d?.data?.[0]) {
        const s = d.data[0]
        metaStats = `Meta: €${parseFloat(s.spend||'0').toFixed(0)} gasto, ${s.clicks||0} cliques, CPC €${parseFloat(s.cpc||'0').toFixed(2)}, alcance ${s.reach||0}`
      }
    }
  } catch { /* sem config */ }

  const context = `
Receita últimas 4 semanas: €${recentRevenue.toFixed(0)} (tendência: ${parseFloat(trend)>0?'+':''}${trend}% vs 4 semanas anteriores)
Facturas em atraso: ${overdueR.rows[0].cnt} (€${parseFloat(overdueR.rows[0].debt).toFixed(0)})
Leads — Quentes: ${hot} | Mornos: ${warm} | Frios: ${cold} (total: ${total})
Funil: ${total>0?((hot/total)*100).toFixed(1):'0'}% taxa quentes
${metaStats}
`
  const llm = await callLLMAuto([{
    role: 'user',
    content: `Revenue Autopilot da Rinosat (GPS motos Portugal). Dados:\n${context}\n\nDá 4 directivas accionáveis (cortes, escalas, prioridades). Começa com "🎯 Revenue Autopilot:". Directo, sem introduções.`
  }], 'GROQ')

  return llm.content || 'Sem resposta'
}

// ─── M174 Revenue Forecast ────────────────────────────────────────────────────
export async function revenueForecast(days = 30): Promise<string> {
  const pool = await getAutotrack()
  const data = await pool.query(`
    SELECT DATE_TRUNC('week', created_at) AS week,
           COALESCE(SUM(amount_due),0) AS revenue
    FROM billing_invoice
    WHERE created_at > NOW() - INTERVAL '90 days' AND status != 'cancelled'
    GROUP BY week ORDER BY week`)
  await pool.end()

  const rows = data.rows
  if (rows.length < 3) return '⚠️ Dados insuficientes para previsão (mínimo 3 semanas de histórico)'

  const pts = rows.map((r: any, i: number) => ({ x: i, y: parseFloat(r.revenue) }))
  const n = pts.length
  const sx = pts.reduce((s, p) => s + p.x, 0)
  const sy = pts.reduce((s, p) => s + p.y, 0)
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0)
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0)
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const intercept = (sy - slope * sx) / n
  const avg = sy / n
  const weeksAhead = Math.ceil(days / 7)
  const projWeekly = intercept + slope * (n + weeksAhead - 1)
  const projTotal = Math.max(0, projWeekly * weeksAhead)
  const pct = avg > 0 ? ((projWeekly - avg) / avg * 100).toFixed(1) : '0'
  const confidence = rows.length >= 8 ? 'Alta' : rows.length >= 5 ? 'Média' : 'Baixa'
  const trendIcon = slope > 0 ? '📈' : '📉'

  return `📊 *Previsão de Receita — ${days} dias:*
${trendIcon} Tendência: ${slope > 0 ? '+' : ''}€${slope.toFixed(0)}/semana
Média histórica semanal: €${avg.toFixed(0)}
Última semana registada: €${pts[pts.length-1].y.toFixed(0)}
*Projecção ${days} dias: €${projTotal.toFixed(0)}*
Variação vs média: ${parseFloat(pct)>0?'+':''}${pct}%
Confiança: ${confidence} (${rows.length} semanas de dados)`
}

// ─── M175 Funnel Surgeon ──────────────────────────────────────────────────────
export async function funnelAnalysis(): Promise<string> {
  const pool = await getAutotrack()
  const invoiceR = await pool.query(`
    SELECT AVG(amount_due) AS avg_ticket FROM billing_invoice
    WHERE created_at > NOW() - INTERVAL '30 days' AND status != 'cancelled'`)
  await pool.end()

  const leadKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
  const leads = leadKeys.map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]

  const now = Date.now()
  const DAY = 86400000
  const total = leads.length
  const hot = leads.filter((l: any) => l.classification === 'QUENTE')
  const warm = leads.filter((l: any) => l.classification === 'MORNO')
  const cold = leads.filter((l: any) => l.classification === 'FRIO')

  const stalehot = hot.filter((l: any) => {
    const t = l.classifiedAt ? new Date(l.classifiedAt).getTime() : 0
    return (now - t) > DAY
  })
  const recentCold = cold.filter((l: any) => {
    const t = l.classifiedAt ? new Date(l.classifiedAt).getTime() : 0
    return (now - t) < 7 * DAY
  })
  const stale30 = leads.filter((l: any) => {
    const t = l.createdAt ? new Date(l.createdAt).getTime() : 0
    return (now - t) > 30 * DAY && l.classification !== 'CONVERTIDO'
  })

  const avgTicket = parseFloat(invoiceR.rows[0]?.avg_ticket || '0')
  const moneyAtRisk = stalehot.length * avgTicket

  const lines = [
    `🔬 *Orbit Funnel Surgeon:*`,
    `Total leads: ${total} | Quentes: ${hot.length} | Mornos: ${warm.length} | Frios: ${cold.length}`,
    `Taxa quentes: ${total>0?((hot.length/total)*100).toFixed(1):'0'}%`,
    '',
  ]

  if (stalehot.length > 0) {
    lines.push(`🚨 ${stalehot.length} lead(s) QUENTE(S) sem follow-up há >24h`)
    lines.push(`   💸 Risco: ~€${moneyAtRisk.toFixed(0)} (ticket médio €${avgTicket.toFixed(0)})`)
    lines.push(`   → ${stalehot.slice(0, 3).map((l: any) => l.contact || '(sem nome)').join(', ')}`)
  }
  if (recentCold.length > 0) {
    lines.push(`📉 ${recentCold.length} lead(s) esfriaram esta semana → activar reactivação`)
  }
  if (stale30.length > 0) {
    lines.push(`🗑️ ${stale30.length} lead(s) parados há >30 dias → limpar ou reactivar com oferta`)
  }
  if (stalehot.length === 0 && recentCold.length === 0) {
    lines.push('✅ Funil saudável. Sem gargalos detectados.')
  }

  return lines.join('\n')
}

// ─── M180 Growth Simulator ────────────────────────────────────────────────────
export async function growthSimulate(extraBudgetDay: number, campaign: string): Promise<string> {
  const pool = await getAutotrack()
  const data = await pool.query(`
    SELECT COUNT(*) AS total, AVG(amount_due) AS avg_ticket
    FROM billing_invoice
    WHERE created_at > NOW() - INTERVAL '30 days' AND status != 'cancelled'`)
  await pool.end()

  const leadKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
  const leads = leadKeys.map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]
  const total = leads.length || 1
  const hot = leads.filter((l: any) => l.classification === 'QUENTE').length
  const convRate = hot / total
  const avgTicket = parseFloat(data.rows[0]?.avg_ticket || '150')

  const cpl = 5
  const newLeadsMonth = (extraBudgetDay / cpl) * 30
  const newClients = newLeadsMonth * convRate
  const addRevenue = newClients * avgTicket
  const investment = extraBudgetDay * 30
  const roi = investment > 0 ? ((addRevenue - investment) / investment * 100) : 0

  return `🚀 *Orbit Growth Simulator:*
Cenário: +€${extraBudgetDay}/dia em "${campaign}"

Premissas actuais:
  CPL estimado: €${cpl} | Conversão: ${(convRate*100).toFixed(1)}% | Ticket: €${avgTicket.toFixed(0)}

Projecção 30 dias:
  Novos leads: ~${newLeadsMonth.toFixed(0)}
  Novos clientes: ~${newClients.toFixed(1)}
  Receita adicional: ~€${addRevenue.toFixed(0)}
  Investimento: €${investment.toFixed(0)}
  *ROI estimado: ${roi>0?'+':''}${roi.toFixed(0)}%*

${roi > 50 ? '✅ Cenário favorável — escalar' : roi > 0 ? '⚠️ ROI positivo moderado — testar com budget menor primeiro' : '🚨 ROI negativo — melhorar conversão antes de escalar'}`
}

// ─── M185 CEO Decision Layer ──────────────────────────────────────────────────
export async function ceoDecision(question?: string): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const [funnel, forecast, opps] = await Promise.all([
    funnelAnalysis(),
    revenueForecast(30),
    opportunityAlert(),
  ])
  const context = `${funnel}\n\n${forecast}\n\n${opps}`
  const prompt = question
    ? `Contexto Rinosat:\n${context}\n\nPergunta do CEO: ${question}\n\nResponde como director de operações. Directo, accionável, em português.`
    : `Contexto Rinosat:\n${context}\n\nDá 3 directivas estratégicas para hoje:
1. [PRIORIDADE] Acção imediata mais importante
2. [CRESCIMENTO] Alavanca a activar hoje
3. [RISCO] O que monitorar de perto

Sem introduções. Tom executivo.`

  const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
  return `🎯 *Orbit Decision Layer:*\n\n${llm.content || 'Sem resposta'}`
}

// ─── M186 Opportunity Alert ───────────────────────────────────────────────────
export async function opportunityAlert(): Promise<string> {
  const alerts: string[] = []

  const leadKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
  const leads = leadKeys.map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]
  const hot = leads.filter((l: any) => l.classification === 'QUENTE')
  if (hot.length > 0) alerts.push(`🔥 ${hot.length} lead(s) QUENTE(S) a aguardar acção`)

  const pool = await getAutotrack()
  const overdueR = await pool.query(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_due-amount_paid),0) AS total
    FROM billing_invoice WHERE status='open' AND due_date < NOW()`)
  await pool.end()

  const overdue = overdueR.rows[0]
  if (parseInt(overdue.cnt) > 0) {
    alerts.push(`💰 ${overdue.cnt} factura(s) em atraso — €${parseFloat(overdue.total).toFixed(0)} por cobrar`)
  }

  const urgentTasks = await prisma.orbitTask.count({ where: { status: { not: 'DONE' }, priority: 'URGENTE' } })
  if (urgentTasks > 0) alerts.push(`⚡ ${urgentTasks} tarefa(s) URGENTE(S) pendentes`)

  const now = Date.now()
  const staleHot = leads.filter((l: any) => l.classification === 'QUENTE' && l.classifiedAt && (now - new Date(l.classifiedAt).getTime()) > 86400000)
  if (staleHot.length > 0) alerts.push(`⏰ ${staleHot.length} lead(s) quente(s) sem contacto há >24h — contactar hoje`)

  if (!alerts.length) return '✅ Nenhuma oportunidade imediata detectada. Tudo em ordem.'
  return `💡 *Orbit — Oportunidades Detectadas:*\n\n${alerts.map(a => `  ${a}`).join('\n')}`
}
