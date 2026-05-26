// src/services/dailyOS.ts
// Módulos 191-210 — Orbit Daily Operating System, CEO Morning, Anti-Procrastination,
// Focus Blocks, Interrupt Handler, Opportunity Follow-up, Daily Decision, etc.
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

const prisma = new PrismaClient()

async function getAutotrack(): Promise<Pool> {
  return new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
}

// ─── M191/192 Daily Operating System + Morning Briefing CEO ───────────────────
// Entrega um bloco único de execução diária: o que fazer hoje, em ordem, sem ruído
export async function dailyOS(): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const pool = await getAutotrack()

  const [overdueR, traccarR, invoiceR] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_due-amount_paid),0) AS debt FROM billing_invoice WHERE status='open' AND due_date < NOW()`),
    pool.query(`SELECT COUNT(*) AS offline FROM tc_devices WHERE disabled=false AND lastupdate < NOW() - INTERVAL '4h'`),
    pool.query(`SELECT COUNT(*) AS new_today FROM billing_invoice WHERE created_at > NOW() - INTERVAL '24h'`),
  ])
  await pool.end()

  const leadKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
  const leads = leadKeys.map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]

  const now = Date.now()
  const hot = leads.filter((l: any) => l.classification === 'QUENTE')
  const staleHot = hot.filter((l: any) => l.classifiedAt && (now - new Date(l.classifiedAt).getTime()) > 86400000)
  const urgentTasks = await prisma.orbitTask.findMany({ where: { status: { not: 'DONE' }, priority: 'URGENTE' }, take: 5 })

  const context = `
SITUAÇÃO AGORA:
- Dispositivos offline >4h: ${traccarR.rows[0].offline}
- Facturas em atraso: ${overdueR.rows[0].cnt} (€${parseFloat(overdueR.rows[0].debt).toFixed(0)})
- Novas facturas hoje: ${invoiceR.rows[0].new_today}
- Leads quentes: ${hot.length} (${staleHot.length} sem follow-up >24h)
- Tarefas urgentes: ${urgentTasks.length} (${urgentTasks.map((t: any) => t.title).join(', ') || 'nenhuma'})
`

  const llm = await callLLMAuto([{
    role: 'user',
    content: `És o Orbit Daily OS da Rinosat. Com base nestes dados, cria o plano de execução de hoje:
${context}

FORMATO OBRIGATÓRIO — sem introdução, directo ao assunto:

🎯 *HOJE FAZES ISTO:*

💰 DINHEIRO (2 acções):
1. [acção concreta]
2. [acção concreta]

⚙️ OPERAÇÃO (2 acções):
1. [acção concreta]
2. [acção concreta]

🚀 CRESCIMENTO (1 acção):
1. [acção concreta]

🛡️ PREVENÇÃO (1 acção):
1. [acção concreta]

❌ NÃO FAÇAS HOJE:
- [o que não vale a pena agora]

Tom: director de operações, sem floreados. Português de Portugal.`
  }], 'GROQ')

  return llm.content || 'Erro ao gerar Daily OS'
}

// ─── M193/198 Anti-Caos + Resumo 60 segundos ─────────────────────────────────
// Filtra ruído: urgente vs importante vs ignorar. Resumo executivo em 60 segundos.
export async function quickSummary(): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const pool = await getAutotrack()

  const [alarmR, offlineR, overdueR] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS cnt FROM tc_events WHERE servertime > NOW() - INTERVAL '4h' AND type='alarm'`),
    pool.query(`SELECT COUNT(*) AS cnt FROM tc_devices WHERE disabled=false AND lastupdate < NOW() - INTERVAL '2h'`),
    pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_due-amount_paid),0) AS debt FROM billing_invoice WHERE status='open' AND due_date < NOW()`),
  ])
  await pool.end()

  const leads = (await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } }))
    .map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]
  const hot = leads.filter((l: any) => l.classification === 'QUENTE').length
  const urgentTasks = await prisma.orbitTask.count({ where: { status: { not: 'DONE' }, priority: 'URGENTE' } })

  const alarmsN = parseInt(alarmR.rows[0].cnt)
  const offlineN = parseInt(offlineR.rows[0].cnt)
  const overdueN = parseInt(overdueR.rows[0].cnt)
  const debtN = parseFloat(overdueR.rows[0].debt)

  const critical: string[] = []
  const ok: string[] = []
  const decisions: string[] = []

  if (alarmsN > 5) critical.push(`🚨 ${alarmsN} alarmes GPS nas últimas 4h`)
  else ok.push(`✅ Alarmes GPS: ${alarmsN} (normal)`)

  if (offlineN > 3) critical.push(`📡 ${offlineN} dispositivos offline >2h`)
  else ok.push(`✅ Dispositivos: ${offlineN} offline (aceitável)`)

  if (overdueN > 0) critical.push(`💸 ${overdueN} facturas em atraso (€${debtN.toFixed(0)})`)
  else ok.push('✅ Facturas: tudo em dia')

  if (hot > 0) decisions.push(`→ ${hot} lead(s) quente(s) a aguardar contacto`)
  if (urgentTasks > 0) decisions.push(`→ ${urgentTasks} tarefa(s) urgente(s) pendente(s)`)

  const lines = [`⏱️ *Resumo de 60 segundos:*`, '']
  if (critical.length) { lines.push('🔴 CRÍTICO:'); critical.forEach(c => lines.push(`  ${c}`)); lines.push('') }
  if (ok.length) { lines.push('🟢 OK:'); ok.forEach(o => lines.push(`  ${o}`)); lines.push('') }
  if (decisions.length) { lines.push('🔷 DECISÃO NECESSÁRIA:'); decisions.forEach(d => lines.push(`  ${d}`)) }
  else lines.push('🔷 Sem decisões urgentes agora.')

  return lines.join('\n')
}

// ─── M195 Focus Blocks ────────────────────────────────────────────────────────
// Divide o dia em blocos de foco de 90 min baseados no estado actual
export async function focusBlocks(): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const pool = await getAutotrack()
  const overdueR = await pool.query(`SELECT COUNT(*) AS cnt FROM billing_invoice WHERE status='open' AND due_date < NOW()`)
  await pool.end()

  const leads = (await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } }))
    .map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]
  const hot = leads.filter((l: any) => l.classification === 'QUENTE').length
  const tasks = await prisma.orbitTask.count({ where: { status: { not: 'DONE' } } })
  const overdueN = parseInt(overdueR.rows[0].cnt)

  const hour = new Date().getHours()
  const timeContext = hour < 10 ? 'manhã cedo' : hour < 12 ? 'manhã' : hour < 15 ? 'tarde início' : hour < 18 ? 'tarde' : 'fim do dia'

  const llm = await callLLMAuto([{
    role: 'user',
    content: `Cria blocos de foco de 90 min para o resto do dia. Hora actual: ${hour}h (${timeContext}).

Estado:
- ${hot} leads quentes a contactar
- ${overdueN} facturas em atraso
- ${tasks} tarefas pendentes no sistema

Formato:
🕐 [HORA]–[HORA] → [FOCO] — [o que fazer]

Máx 4 blocos. Prioridade: dinheiro > operação > crescimento. Sem intro.`
  }], 'GROQ')

  return `📅 *Blocos de Foco de Hoje:*\n\n${llm.content || ''}`
}

// ─── M199/207 Priority Decider + Daily Single Decision ───────────────────────
// Responde: "isso que queres fazer vale a pena hoje?"
// Também gera UMA decisão principal do dia
export async function dailyDecision(proposedAction?: string): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const pool = await getAutotrack()
  const [overdueR, offlineR] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS cnt FROM billing_invoice WHERE status='open' AND due_date < NOW()`),
    pool.query(`SELECT COUNT(*) AS cnt FROM tc_devices WHERE disabled=false AND lastupdate < NOW() - INTERVAL '4h'`),
  ])
  await pool.end()

  const leads = (await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } }))
    .map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]
  const hot = leads.filter((l: any) => l.classification === 'QUENTE').length
  const overdueN = parseInt(overdueR.rows[0].cnt)
  const offlineN = parseInt(offlineR.rows[0].cnt)

  if (proposedAction) {
    const llm = await callLLMAuto([{
      role: 'user',
      content: `Estado actual da Rinosat:
- Leads quentes sem contacto: ${hot}
- Facturas em atraso: ${overdueN}
- Dispositivos offline: ${offlineN}

O utilizador quer: "${proposedAction}"

Avalia se esta acção vale a pena AGORA vs o que está em aberto. Responde em 2-3 frases directas. Se não vale, diz claramente e sugere o que fazer em vez disso. Português de Portugal.`
    }], 'GROQ')

    return `🧠 *Orbit Priority Check:*\n${llm.content || ''}`
  }

  // Sem pergunta → gera UMA decisão principal do dia
  const llm = await callLLMAuto([{
    role: 'user',
    content: `Rinosat — estado hoje:
Leads quentes: ${hot} | Facturas em atraso: ${overdueN} | Offline: ${offlineN}

Dá UMA única decisão principal para hoje. Máx 15 palavras. Formato:
"🎯 DECISÃO DO DIA: [acção clara e directa]"

Sem mais nada.`
  }], 'GROQ')

  return llm.content || '🎯 DECISÃO DO DIA: Contactar leads quentes e cobrar facturas em atraso'
}

// ─── M205 Daily Follow-up Trigger ────────────────────────────────────────────
// Só os follow-ups que geram dinheiro ou evitam perda — sem ruído
export async function dailyFollowups(): Promise<string> {
  const { callLLMAuto } = await import('./llm')
  const pool = await getAutotrack()
  const overdueR = await pool.query(`
    SELECT ci.email, ci.name, bi.amount_due - bi.amount_paid AS debt, bi.due_date
    FROM billing_invoice bi
    JOIN clients_info ci ON bi.client_id = ci.id
    WHERE bi.status='open' AND bi.due_date < NOW()
    ORDER BY (bi.amount_due - bi.amount_paid) DESC LIMIT 5`)
  await pool.end()

  const leads = (await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } }))
    .map(k => { try { return JSON.parse(k.value) } catch { return null } }).filter(Boolean) as any[]

  const now = Date.now()
  const followupLeads = leads.filter((l: any) => {
    const age = now - (l.classifiedAt ? new Date(l.classifiedAt).getTime() : 0)
    return (l.classification === 'QUENTE' && age > 86400000) ||
           (l.classification === 'MORNO' && age > 3 * 86400000)
  }).slice(0, 5)

  const overdueList = overdueR.rows.map((r: any) =>
    `${r.name || r.email}: €${parseFloat(r.debt).toFixed(0)} em atraso`
  ).join('\n')

  const leadList = followupLeads.map((l: any) => {
    const age = Math.floor((now - new Date(l.classifiedAt || Date.now()).getTime()) / 86400000)
    return `${l.contact || '(sem nome)'} [${l.classification}] — ${age}d sem contacto`
  }).join('\n')

  if (!overdueList && !leadList) return '✅ Sem follow-ups urgentes hoje.'

  const llm = await callLLMAuto([{
    role: 'user',
    content: `Follow-ups que geram dinheiro hoje para a Rinosat:

FACTURAS EM ATRASO:
${overdueList || 'Nenhuma'}

LEADS A CONTACTAR:
${leadList || 'Nenhum'}

Para cada item, sugere UMA mensagem curta (WhatsApp/email, max 80 chars). Português de Portugal. Só os que têm impacto financeiro real.`
  }], 'GROQ')

  return `📤 *Follow-ups de Hoje:*\n\n${llm.content || ''}`
}
