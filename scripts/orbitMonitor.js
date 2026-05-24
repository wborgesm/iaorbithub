#!/usr/bin/env node
// orbitMonitor.js — Monitor autónomo do ecossistema ORBIT
// Ciclo análise logs: 40 min | Ciclo sumário Cursor: 30 min
// NÃO importa nada do sistema principal. Só fs, child_process, path.
'use strict'

const { execSync } = require('child_process')
const fs            = require('fs')
const path          = require('path')

// ─── Caminhos ────────────────────────────────────────────────────────────────
const ROOT        = '/opt/ai-command-center'
const PLAN_FILE   = path.join(ROOT, 'orbit-plan.md')
const CURSOR_FILE = path.join(ROOT, 'orbit-cursor-next.md')
const STATE_FILE  = path.join(ROOT, '.orbit-monitor-state.json')

const DB_URL = 'postgresql://ai_command_user:aicommand_secure_2026@localhost:5432/ai_command_center'

// ─── Intervalos ──────────────────────────────────────────────────────────────
const ANALYSIS_MS = 40 * 60 * 1000   // 40 minutos
const SUMMARY_MS  = 30 * 60 * 1000   // 30 minutos

// ─── Padrões de erro conhecidos ──────────────────────────────────────────────
const ERROR_PATTERNS = [
  {
    id: 'wa_undefined',
    re: /sendWhatsApp.*undefined|to.*undefined|Enviar WhatsApp para undefined/i,
    label: 'sendWhatsApp chamado com to=undefined (nome sem número)',
    ref: 'P1/P3',
    priority: 1,
  },
  {
    id: 'critical_loop',
    re: /\[criticalAlertMonitor\] Alerta fatal enviado/,
    label: 'criticalAlertMonitor falso positivo (grep apanha o próprio log)',
    ref: 'P4',
    priority: 1,
  },
  {
    id: 'sigkill',
    re: /stop-sigterm.*timed out|SIGKILL|Killing process.*KILL/i,
    label: 'SIGTERM timeout → SIGKILL (Puppeteer bloqueia saída)',
    ref: 'P5',
    priority: 2,
  },
  {
    id: 'all_providers_down',
    re: /sem chave disponível.*todas em cooldown|GROQ falhou.*GEMINI falhou/i,
    label: 'Todos os providers em cooldown simultâneo → ORBIT indisponível',
    ref: 'quota',
    priority: 1,
  },
  {
    id: 'puppeteer_crash',
    re: /puppeteer|chromium.*crash|TargetCloseError|browser.*disconnect/i,
    label: 'Puppeteer/Chrome crash ou desconexão inesperada',
    ref: 'P5',
    priority: 2,
  },
  {
    id: 'wa_not_connected',
    re: /WhatsApp pessoal não ligado|WhatsApp Web não ligado/i,
    label: 'WhatsApp pessoal desconectado durante chamada de ferramenta',
    ref: 'P3',
    priority: 2,
  },
  {
    id: 'tts_error',
    re: /ElevenLabs.*error|tts.*500|\/api\/orbit\/tts.*fail/i,
    label: 'Falha no endpoint TTS ElevenLabs',
    ref: 'TTS',
    priority: 3,
  },
  {
    id: 'prisma_slow',
    re: /slow.*query|took \d{4,}ms/i,
    label: 'Query Prisma lenta detectada (>2s)',
    ref: 'BD',
    priority: 3,
  },
  {
    id: 'memory_oom',
    re: /JavaScript heap out of memory|ENOMEM|Killed.*node/i,
    label: 'Out-of-memory — processo Node morto pelo OOM killer',
    ref: 'OOM',
    priority: 1,
  },
  {
    id: 'orbit_session_fail',
    re: /\[chat\/send\].*Error(?!.*429)|Sessão não encontrada/i,
    label: 'Erro não-429 no endpoint chat/send',
    ref: 'chat',
    priority: 2,
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon', hour12: false })
}

function tsKey() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

function log(msg) {
  process.stdout.write(`[orbitMonitor] ${ts()} — ${msg}\n`)
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { lastAnalysis: 0, lastSummary: 0, seenErrorIds: [] }
  }
}

function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)) } catch {}
}

// ─── Leitura de logs ─────────────────────────────────────────────────────────
function readServiceLogs(minutes = 45) {
  try {
    return execSync(
      `journalctl -u ai-command-center --no-pager --since "${minutes} minutes ago" 2>/dev/null || true`,
      { encoding: 'utf8', timeout: 12000, stdio: ['pipe','pipe','pipe'] }
    )
  } catch { return '' }
}

// ─── Queries DB ──────────────────────────────────────────────────────────────
function dbQuery(sql) {
  try {
    // Usar echo | psql para evitar conflito de aspas no -c quando SQL tem "QuotedTable"
    return execSync(
      `echo ${JSON.stringify(sql)} | psql '${DB_URL}' -t -A 2>/dev/null`,
      { encoding: 'utf8', timeout: 10000, stdio: ['pipe','pipe','pipe'], shell: true }
    ).trim()
  } catch { return '' }
}

function getDbDiagnostics() {
  const issues = []

  // Falhas em tool executions na última hora
  const toolFails = parseInt(dbQuery(
    `SELECT COUNT(*) FROM "ToolExecutionLog" WHERE "errorMessage" IS NOT NULL AND "createdAt" > NOW() - INTERVAL '1 hour'`
  )) || 0
  if (toolFails >= 3) {
    issues.push({ label: `${toolFails} tool executions falhadas na última hora`, priority: 2 })
  }

  // Mensagens de erro ORBIT na última hora
  const errMsgs = parseInt(dbQuery(
    `SELECT COUNT(*) FROM "ChatMessage" WHERE role='ASSISTANT' AND content ILIKE '%não foi possível%' AND "createdAt" > NOW() - INTERVAL '1 hour'`
  )) || 0
  if (errMsgs >= 3) {
    issues.push({ label: `${errMsgs} respostas de erro ao utilizador na última hora`, priority: 2 })
  }

  // WhatsApp health
  const waHealth = dbQuery(`SELECT value FROM "SystemConfig" WHERE key='orbit.whatsapp_health_ok'`)
  if (waHealth !== '1') {
    issues.push({ label: `WhatsApp health check falhou (orbit.whatsapp_health_ok = '${waHealth || 'vazio'}')`, priority: 1 })
  }

  // Providers todos desabilitados ou em erro
  const enabledProviders = parseInt(dbQuery(
    `SELECT COUNT(*) FROM "ProviderConfig" WHERE "isEnabled" = true`
  )) || 0
  if (enabledProviders === 0) {
    issues.push({ label: 'CRÍTICO: Nenhum provider LLM activo na DB', priority: 1 })
  }

  // to=undefined nos logs de tool execution (últimas 24h)
  const undefinedTo = parseInt(dbQuery(
    `SELECT COUNT(*) FROM "ToolExecutionLog" WHERE "toolName"='sendWhatsApp' AND arguments->>'to' IN ('undefined','') AND "createdAt" > NOW() - INTERVAL '24 hours'`
  )) || 0
  if (undefinedTo > 0) {
    issues.push({ label: `sendWhatsApp chamado ${undefinedTo}× com to=undefined nas últimas 24h (hábito envenenado activo)`, priority: 1 })
  }

  return issues
}

// ─── Análise de padrões nos logs ─────────────────────────────────────────────
function detectNewErrors(logs, seenIds) {
  return ERROR_PATTERNS.filter(p => p.re.test(logs) && !seenIds.includes(p.id))
}

// ─── Actualizar orbit-plan.md ─────────────────────────────────────────────────
function appendToPlan(newErrors, dbIssues) {
  if (!fs.existsSync(PLAN_FILE)) return
  const plan = fs.readFileSync(PLAN_FILE, 'utf8')

  // Não duplicar a mesma secção se já foi adicionada há menos de 35 min
  const recentMarker = `## Diagnósticos auto`
  const lastIdx = plan.lastIndexOf(recentMarker)
  if (lastIdx !== -1) {
    const since = Date.now() - new Date(
      plan.slice(lastIdx).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)?.[0] || 0
    ).getTime()
    if (since < ANALYSIS_MS - 2 * 60 * 1000) return // já foi actualizado neste ciclo
  }

  const allItems = [
    ...newErrors.map(e => `- **[${e.ref}]** ${e.label}`),
    ...dbIssues.map(i => `- **[BD]** ${i.label}`),
  ]
  if (allItems.length === 0) return

  const section = [
    '',
    '---',
    '',
    `## Diagnósticos auto — ${tsKey()}`,
    '',
    ...allItems,
    '',
    '> _Gerado por scripts/orbitMonitor.js — não editar manualmente esta secção_',
    '',
  ].join('\n')

  fs.writeFileSync(PLAN_FILE, plan + section)
  log(`orbit-plan.md actualizado — ${newErrors.length} erros log + ${dbIssues.length} issues BD`)
}

// ─── Gerar orbit-cursor-next.md ───────────────────────────────────────────────
function writeCursorSummary(newErrors, dbIssues) {
  // Extrair "Ordem de execução" do plan
  let execOrder = '(ver orbit-plan.md — secção "Ordem de execução recomendada ao Cursor")'
  if (fs.existsSync(PLAN_FILE)) {
    const plan = fs.readFileSync(PLAN_FILE, 'utf8')
    const m = plan.match(/### PASSO [\s\S]*?(?=\n---|\n## [^#]|$)/)
    // Extrair todos os títulos de passo
    const steps = [...plan.matchAll(/### (PASSO \d+ — [^\n]+)/g)].map(m => m[1])
    if (steps.length) execOrder = steps.map((s, i) => `${i + 1}. ${s.replace('PASSO ', '').replace(/ — /, ' — ')}`).join('\n')
  }

  const urgent = [...newErrors, ...dbIssues.map(i => ({ ...i, ref: 'BD' }))]
    .filter(e => e.priority === 1)
    .sort((a, b) => a.priority - b.priority)

  const medium = [...newErrors, ...dbIssues.map(i => ({ ...i, ref: 'BD' }))]
    .filter(e => e.priority === 2)

  const lines = [
    `# orbit-cursor-next.md`,
    `**Gerado:** ${tsKey()} | **Por:** scripts/orbitMonitor.js`,
    `**Plano completo:** /opt/ai-command-center/orbit-plan.md`,
    '',
  ]

  if (urgent.length) {
    lines.push(`## URGENTE (${urgent.length} itens — resolver primeiro)`)
    urgent.forEach(e => lines.push(`- [${e.ref || 'LOG'}] ${e.label}`))
    lines.push('')
  } else {
    lines.push('## Estado: sem alertas urgentes neste ciclo')
    lines.push('')
  }

  if (medium.length) {
    lines.push(`## Atenção (${medium.length} itens)`)
    medium.forEach(e => lines.push(`- [${e.ref || 'LOG'}] ${e.label}`))
    lines.push('')
  }

  lines.push('## Próximos passos do plano (ordem recomendada):')
  lines.push('```')
  lines.push(execOrder)
  lines.push('```')
  lines.push('')
  lines.push('## Regras (não alterar):')
  lines.push('- Nunca mudar layout, refactorizar variáveis ou alterar schema Prisma')
  lines.push('- Adicionar blocos `else if` inline nos ficheiros indicados')
  lines.push('- Compilar: `npx tsc` | Reiniciar: `systemctl restart ai-command-center`')
  lines.push('- Após deploy: `psql ... UPDATE "SystemConfig" SET value=\'{}\' WHERE key=\'orbit.habit_trust\'`')

  fs.writeFileSync(CURSOR_FILE, lines.join('\n'))
  log(`orbit-cursor-next.md actualizado (${urgent.length} urgentes, ${medium.length} atenção)`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
;(function main() {
  const state  = loadState()
  const now    = Date.now()
  const isFirstRun = state.lastAnalysis === 0 && state.lastSummary === 0

  let newErrors = []
  let dbIssues  = []

  const doAnalysis = isFirstRun || (now - state.lastAnalysis >= ANALYSIS_MS)
  const doSummary  = isFirstRun || (now - state.lastSummary  >= SUMMARY_MS)

  if (doAnalysis) {
    log('A analisar logs + BD…')
    const logs = readServiceLogs(45)
    newErrors  = detectNewErrors(logs, state.seenErrorIds)
    dbIssues   = getDbDiagnostics()

    if (newErrors.length || dbIssues.length) {
      appendToPlan(newErrors, dbIssues)
      state.seenErrorIds = [...new Set([...state.seenErrorIds, ...newErrors.map(e => e.id)])]
    } else {
      log('Sem novos erros detectados')
    }
    state.lastAnalysis = now
  }

  if (doSummary) {
    writeCursorSummary(newErrors, dbIssues)
    state.lastSummary = now
  }

  saveState(state)
  log(`Concluído — próxima análise em ~40min, próximo sumário em ~30min`)
})()
