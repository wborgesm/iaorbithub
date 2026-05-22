import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { callLLMAuto } from '../services/llm'
import type { LLMMessage } from '../types'

const router = Router()
const prisma = new PrismaClient()

const PROMOTION_THRESHOLD = 95 // score >= 95 (= 9.5/10) → apply to production

// In-memory stop signals: sessionId → true means "stop requested"
const stopSignals = new Map<string, boolean>()

// ── Persona builders ─────────────────────────────────────────────────────────

function buildClientPersona(simType: string, brand: string, systemPrompt: string): string {
  const ctx = systemPrompt.slice(0, 500)

  const profiles = [
    {
      label: 'idoso',
      desc: 'Tens mais de 65 anos e pouca familiaridade com tecnologia. Escreves de forma simples, por vezes cometes erros de ortografia. Nao sabes termos tecnicos. Dizes coisas como o aparelho nao funciona ou aquele programa nao abre.',
      style: 'Frases muito curtas e simples. Sem termos tecnicos. Alguma hesitacao e inseguranca. Podes cometer pequenos erros de escrita.'
    },
    {
      label: 'pouca-escolaridade',
      desc: 'Tens pouca escolaridade e nao pereces de tecnologia. Usas linguagem coloquial do dia-a-dia. Nao sabes o que sao termos como contrato, protocolo ou plano. Perguntas coisas muito basicas.',
      style: 'Muito coloquial e simples. Sem palavras tecnicas ou formais. Direto e concreto.'
    },
    {
      label: 'adulto-comum',
      desc: 'Tens 40-50 anos, usas tecnologia no dia-a-dia mas nao es especialista. Percebes o basico mas ficas confuso com detalhes tecnicos. Fazes perguntas praticas.',
      style: 'Linguagem normal, perguntas praticas. Agradeces quando algo e bem explicado.'
    },
    {
      label: 'conhecedor',
      desc: 'Tens bom conhecimento de tecnologia. Conheces os termos tecnicos, ja pesquisaste o assunto. Queres respostas directas sem explicacoes basicas.',
      style: 'Directo e tecnico. Impaciencia com respostas obvias. Vai ao ponto.'
    }
  ]

  const profile = profiles[Math.floor(Math.random() * profiles.length)]

  if (simType === 'VENDAS') return `Es um potencial cliente interessado nos servicos de ${brand}. Perfil: ${profile.label}.
${profile.desc}
REGRAS: Comecas com duvida sobre preco ou o que o servico faz; objecoes realistas ao teu nivel; so fechas com proposta de valor clara; nunca aceitas imediatamente. Usa Portugues europeu natural. NUNCA reveles que es IA.
ESTILO: ${profile.style}
Contexto do servico: ${ctx}
Quando receberes [INICIO], inicia contacto como alguem do teu perfil que descobriu ${brand} e tem duvidas.`

  if (simType === 'CANCELAMENTO') return `Es um cliente de ${brand} que quer cancelar. Perfil: ${profile.label}.
${profile.desc}
REGRAS: Tens razoes concretas para cancelar adequadas ao teu perfil; so ficas com oferta real e explicada de forma que entendas; apos 3 trocas sem solucao, confirmas cancelamento. Usa Portugues europeu natural. NUNCA reveles que es IA.
ESTILO: ${profile.style}
Contexto: ${ctx}
Quando receberes [INICIO], comunica que queres cancelar o servico de ${brand}.`

  return `Es um cliente de ${brand} com um problema que nao consegues resolver. Perfil: ${profile.label}.
${profile.desc}
REGRAS: Descreves o problema com as palavras que sabes (sem termos tecnicos); mostras frustracao se nao fores compreendido; das mais detalhes quando perguntado com gentileza; ficas satisfeito quando o problema e explicado de forma que entendes. Usa Portugues europeu natural. NUNCA reveles que es IA.
ESTILO: ${profile.style}
Contexto: ${ctx}
Quando receberes [INICIO], descreve o teu problema como alguem do teu perfil o descreveria.`
}

function buildAgentSystemPrompt(simType: string, brand: string, systemPrompt: string): string {
  const base = systemPrompt || `Es um assistente virtual de ${brand}.`

  let guide = ''
  if (simType === 'VENDAS') guide = `

MODO TREINO VENDAS: Objetivo e converter o cliente. Aplica escuta ativa, proposta de valor concreta, gestao de objecoes direta, fechamento progressivo. Evita respostas genericas e pressao excessiva.`
  else if (simType === 'CANCELAMENTO') guide = `

MODO TREINO RETENCAO: Objetivo e reter o cliente. Aplica empatia genuina, diagnostico da causa real, oferta concreta como desconto, pausa ou upgrade. Evita respostas defensivas e promessas vazias.`
  else guide = `

MODO TREINO SUPORTE: Objetivo e resolver o problema. Aplica empatia imediata, diagnostico estruturado, confirmacao de resolucao. Evita pedir informacao ja fornecida.`

  const adaptacao = `

DETECAO DE NIVEL E ADAPTACAO DE LINGUAGEM (OBRIGATORIO):
Nas primeiras mensagens identifica o nivel de conhecimento do cliente:
- BAIXO: frases simples, erros de escrita, sem termos tecnicos, descricoes vagas como o aparelho nao funciona.
- MEDIO: linguagem normal, perguntas praticas, alguma confusao com detalhes tecnicos.
- ALTO: termos tecnicos corretos, perguntas especificas, ja tentou resolver sozinho.

COMO ADAPTAR:
- Nivel BAIXO: linguagem simples do dia-a-dia, zero jargao tecnico, explica passo a passo, usa analogias simples, confirma se o cliente percebeu antes de avancar. Se nao entenderes o que o cliente quer dizer, pergunta com gentileza (ex: "Pode explicar-me melhor o que esta a acontecer?"). Nunca uses linguagem condescendente.
- Nivel MEDIO: linguagem acessivel sem ser simplista, confirma pontos chave, explica sem condescendencia.
- Nivel ALTO: resposta directa e objectiva, usa termos tecnicos quando adequado, sem explicacoes desnecessarias.

Se tiveres duvida sobre o nivel, comeca com linguagem acessivel e ajusta conforme a conversa. Se precisares de mais informacao para ajudar, pergunta de forma educada e natural.`

  return base + guide + adaptacao + `

Responde sempre em Portugues europeu natural. Se profissional, empatico e adapta sempre o nivel de linguagem ao cliente.`
}

function buildAnalysisPrompt(simType: string, brand: string, transcript: Array<{role: string, content: string, round: number}>): string {
  const typeLabel = simType === 'VENDAS' ? 'Vendas' : simType === 'CANCELAMENTO' ? 'Retenção' : 'Suporte Técnico'
  const conv = transcript.map(m => `[Troca ${m.round}] ${m.role === 'CLIENT' ? 'CLIENTE' : 'AGENTE'}:\n${m.content}`).join('\n\n')
  return `Analisa a performance do AGENTE nesta conversa de treino de ${typeLabel} para ${brand}.

CONVERSA:
${conv}

Responde APENAS com JSON válido (sem markdown):
{
  "score": <0-100>,
  "level": "<Iniciante|Em Desenvolvimento|Competente|Avançado|Profissional Elite>",
  "result": "<SUCESSO|PARCIAL|FALHA>",
  "summary": "<2-3 frases de avaliação>",
  "strengths": ["<ponto forte concreto>"],
  "weaknesses": ["<ponto fraco concreto>"],
  "coaching": [
    {
      "round": <número da troca>,
      "agentSaid": "<frase exata ou paráfrase do que o agente disse>",
      "couldSay": "<versão melhorada da resposta>",
      "tip": "<explicação de 1 frase do porquê>"
    }
  ],
  "nextSteps": ["<acção de treino recomendada>"]
}`
}

// ── Promote session insights to production system prompt ──────────────────────

async function promoteToProduction(
  siteId: string,
  brand: string,
  currentPrompt: string,
  simType: string,
  evaluation: any
): Promise<{ newPrompt: string; summary: string }> {
  const strengths = (evaluation.strengths ?? []).join('\n- ')
  const coaching = (evaluation.coaching ?? [])
    .map((c: any) => `• Quando: "${c.agentSaid}" → Melhor: "${c.couldSay}" (${c.tip})`)
    .join('\n')
  const nextSteps = (evaluation.nextSteps ?? []).join('\n- ')

  const upgradePrompt = `Tens o system prompt atual de um agente de IA para ${brand} (tipo: ${simType}).

SYSTEM PROMPT ATUAL:
${currentPrompt}

O agente atingiu pontuação ${evaluation.score}/100 (nível: ${evaluation.level}) numa sessão de treino com os seguintes insights:

PONTOS FORTES A PRESERVAR:
- ${strengths}

MELHORIAS DE COACHING IDENTIFICADAS:
${coaching}

PRÓXIMOS PASSOS RECOMENDADOS:
- ${nextSteps}

Gera um system prompt MELHORADO que incorpore os insights acima, mantendo a identidade e contexto do agente mas tornando-o mais eficaz e profissional.
Responde APENAS com o system prompt melhorado (sem explicações, sem JSON, só o texto do prompt).`

  const result = await callLLMAuto([{ role: 'user', content: upgradePrompt }])
  const newPrompt = result.content?.trim() ?? currentPrompt
  const summary = `Score ${evaluation.score}/100 (${evaluation.level}) — ${evaluation.strengths?.[0] ?? ''}. Aplicado automaticamente.`

  // Save old prompt to history
  await prisma.promptHistory.create({
    data: { siteId, prompt: currentPrompt, label: `Auto-backup antes de promoção (score ${evaluation.score})` },
  })

  // Update site system prompt
  await prisma.aISite.update({
    where: { id: siteId },
    data: { systemPrompt: newPrompt },
  })

  return { newPrompt, summary }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/simulation/auto-train/sessions — list sessions (with filters)
router.get('/auto-train/sessions', async (req: Request, res: Response) => {
  try {
    const { siteId, simType, minScore } = req.query
    const where: any = {}
    if (siteId) where.siteId = siteId as string
    if (simType) where.simType = simType as string
    if (minScore) where.score = { gte: parseInt(minScore as string) }

    const sessions = await prisma.autoTrainSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { site: { select: { brand: true, domain: true } } },
    })
    return res.json(sessions)
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// GET /api/simulation/auto-train/sessions/:id — full session with transcript + analysis
router.get('/auto-train/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await prisma.autoTrainSession.findUnique({
      where: { id: req.params.id as string },
      include: { site: { select: { brand: true, domain: true, systemPrompt: true } } },
    })
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })
    return res.json(session)
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// POST /api/simulation/auto-train/sessions/:id/apply — manually apply session to production
router.post('/auto-train/sessions/:id/apply', async (req: Request, res: Response) => {
  try {
    const session = await prisma.autoTrainSession.findUnique({
      where: { id: req.params.id as string },
      include: { site: true },
    })
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' })
    if (!session.analysis) return res.status(400).json({ error: 'Sessão sem análise' })

    let evaluation: any = {}
    try {
      const m = session.analysis.match(/\{[\s\S]*\}/)
      if (m) evaluation = JSON.parse(m[0])
    } catch { evaluation = { score: session.score, strengths: [], coaching: [], nextSteps: [] } }

    const { newPrompt, summary } = await promoteToProduction(
      session.siteId, (session as any).site.brand, (session as any).site.systemPrompt,
      session.simType, evaluation
    )

    return res.json({ applied: true, summary, newPromptPreview: newPrompt.slice(0, 300) })
  } catch (err) {
    console.error('[auto-train/apply]', err)
    return res.status(500).json({ error: 'Erro interno' })
  }
})

// POST /api/simulation/auto-train/:id/stop — request stop
router.post('/auto-train/:id/stop', async (req: Request, res: Response) => {
  stopSignals.set(req.params.id as string, true)
  await prisma.autoTrainSession.updateMany({
    where: { id: req.params.id as string, status: 'RUNNING' },
    data: { status: 'STOPPED' },
  }).catch(() => {})
  return res.json({ stopped: true })
})

// POST /api/simulation/auto-train — single session SSE stream
router.post('/auto-train', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const { siteId, simulationType, rounds: rawRounds } = req.body
    const rounds = Math.min(Math.max(parseInt(rawRounds) || 5, 3), 10)

    if (!siteId || !simulationType) { send({ status: 'error', message: 'Parâmetros em falta' }); res.end(); return }

    const site = await prisma.aISite.findUnique({ where: { id: siteId } })
    if (!site) { send({ status: 'error', message: 'Site não encontrado' }); res.end(); return }

    const session = await prisma.autoTrainSession.create({
      data: { siteId, simType: simulationType as any, rounds, status: 'RUNNING' },
    })

    // Clean up stop signal on client disconnect
    req.on('close', () => {
      stopSignals.set(session.id, true)
      prisma.autoTrainSession.updateMany({
        where: { id: session.id, status: 'RUNNING' },
        data: { status: 'STOPPED' },
      }).catch(() => {})
    })

    send({ status: 'starting', rounds, brand: site.brand, simulationType, sessionId: session.id })

    const clientHistory: LLMMessage[] = [{ role: 'system', content: buildClientPersona(simulationType, site.brand, site.systemPrompt) }]
    const agentHistory: LLMMessage[] = [{ role: 'system', content: buildAgentSystemPrompt(simulationType, site.brand, site.systemPrompt) }]
    const transcript: Array<{ role: string; content: string; round: number }> = []

    // Round 1: CLIENT starts
    send({ status: 'round', round: 1, total: rounds })
    clientHistory.push({ role: 'user', content: '[INICIO]' })
    const firstMsg = (await callLLMAuto(clientHistory)).content?.trim() ?? ''
    clientHistory.push({ role: 'assistant', content: firstMsg })
    agentHistory.push({ role: 'user', content: firstMsg })
    transcript.push({ role: 'CLIENT', content: firstMsg, round: 1 })
    send({ role: 'CLIENT', content: firstMsg, round: 1 })

    for (let r = 1; r <= rounds; r++) {
      if (stopSignals.get(session.id)) {
        stopSignals.delete(session.id)
        send({ status: 'stopped', round: r })
        await prisma.autoTrainSession.update({ where: { id: session.id }, data: { status: 'STOPPED', transcript: transcript as any } }).catch(() => {})
        res.end(); return
      }
      const agentMsg = (await callLLMAuto(agentHistory)).content?.trim() ?? ''
      agentHistory.push({ role: 'assistant', content: agentMsg })
      clientHistory.push({ role: 'user', content: agentMsg })
      transcript.push({ role: 'AGENT', content: agentMsg, round: r })
      send({ role: 'AGENT', content: agentMsg, round: r })

      if (r < rounds) {
        send({ status: 'round', round: r + 1, total: rounds })
        const clientMsg = (await callLLMAuto(clientHistory)).content?.trim() ?? ''
        clientHistory.push({ role: 'assistant', content: clientMsg })
        agentHistory.push({ role: 'user', content: clientMsg })
        transcript.push({ role: 'CLIENT', content: clientMsg, round: r + 1 })
        send({ role: 'CLIENT', content: clientMsg, round: r + 1 })
      }
    }

    send({ status: 'evaluating' })
    const rawAnalysis = (await callLLMAuto([{ role: 'user', content: buildAnalysisPrompt(simulationType, site.brand, transcript) }])).content?.trim() ?? ''

    let evaluation: any = { score: 0, level: 'Iniciante', result: 'FALHA', summary: '', strengths: [], weaknesses: [], coaching: [], nextSteps: [] }
    try { const m = rawAnalysis.match(/\{[\s\S]*\}/); if (m) evaluation = JSON.parse(m[0]) } catch {}

    await prisma.autoTrainSession.update({
      where: { id: session.id },
      data: { status: 'DONE', transcript: transcript as any, analysis: rawAnalysis, score: evaluation.score },
    })

    stopSignals.delete(session.id)
    send({ status: 'done', evaluation })

    // Auto-promote if score >= 9.5/10 (95/100)
    if ((evaluation.score ?? 0) >= PROMOTION_THRESHOLD) {
      send({ status: 'promoting', score: evaluation.score })
      try {
        const { newPrompt, summary } = await promoteToProduction(
          siteId, site.brand, site.systemPrompt, simulationType, evaluation
        )
        send({ status: 'promoted', score: evaluation.score, summary, newPromptPreview: newPrompt.slice(0, 200) })
      } catch (promErr) {
        console.error('[auto-train/promote]', promErr)
        send({ status: 'promote_error', message: 'Falha ao aplicar melhorias ao sistema' })
      }
    }

    res.end()
  } catch (err) {
    console.error('[auto-train]', err)
    send({ status: 'error', message: err instanceof Error ? err.message : 'Erro interno' })
    res.end()
  }
})

// POST /api/simulation/batch-train — batch SSE stream
router.post('/batch-train', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const { siteId, simulationType, totalRuns: rawTotal, roundsPerRun: rawRounds } = req.body
    const totalRuns = Math.min(Math.max(parseInt(rawTotal) || 20, 3), 100)
    const roundsPerRun = Math.min(Math.max(parseInt(rawRounds) || 4, 2), 6)

    if (!siteId || !simulationType) { send({ status: 'error', message: 'Parâmetros inválidos' }); res.end(); return }

    const site = await prisma.aISite.findUnique({ where: { id: siteId } })
    if (!site) { send({ status: 'error', message: 'Site não encontrado' }); res.end(); return }

    send({ status: 'batch_start', totalRuns, roundsPerRun, brand: site.brand, simulationType })

    const scores: number[] = []
    const allIssues: string[] = []
    const allViolations: string[][] = []
    const allSuggestions: string[] = []
    let bestEvaluation: any = null
    let bestScore = 0

    const clientPersona = buildClientPersona(simulationType, site.brand, site.systemPrompt)
    const agentSysPrompt = buildAgentSystemPrompt(simulationType, site.brand, site.systemPrompt)

    for (let run = 1; run <= totalRuns; run++) {
      send({ status: 'run_start', run, total: totalRuns })
      try {
        const clientHistory: LLMMessage[] = [{ role: 'system', content: clientPersona }]
        const agentHistory: LLMMessage[] = [{ role: 'system', content: agentSysPrompt }]
        const transcript: Array<{ role: string; content: string; round: number }> = []

        clientHistory.push({ role: 'user', content: '[INICIO]' })
        const firstMsg = (await callLLMAuto(clientHistory)).content?.trim() ?? ''
        clientHistory.push({ role: 'assistant', content: firstMsg })
        agentHistory.push({ role: 'user', content: firstMsg })
        transcript.push({ role: 'CLIENT', content: firstMsg, round: 1 })

        for (let r = 1; r <= roundsPerRun; r++) {
          const agentMsg = (await callLLMAuto(agentHistory)).content?.trim() ?? ''
          agentHistory.push({ role: 'assistant', content: agentMsg })
          clientHistory.push({ role: 'user', content: agentMsg })
          transcript.push({ role: 'AGENT', content: agentMsg, round: r })
          if (r < roundsPerRun) {
            const clientMsg = (await callLLMAuto(clientHistory)).content?.trim() ?? ''
            clientHistory.push({ role: 'assistant', content: clientMsg })
            agentHistory.push({ role: 'user', content: clientMsg })
            transcript.push({ role: 'CLIENT', content: clientMsg, round: r + 1 })
          }
        }

        const rawEv = (await callLLMAuto([{ role: 'user', content: buildAnalysisPrompt(simulationType, site.brand, transcript) }])).content ?? ''
        let ev: any = { score: 0, result: 'FALHA', weaknesses: [], nextSteps: [] }
        try { const m = rawEv.match(/\{[\s\S]*\}/); if (m) ev = JSON.parse(m[0]) } catch {}

        scores.push(ev.score ?? 0)
        if ((ev.score ?? 0) > bestScore) { bestScore = ev.score; bestEvaluation = ev }
        const topIssue = ev.weaknesses?.[0] ?? ''
        const violations = (ev.weaknesses ?? []).filter((w: string) => /segurança|confidencial|dados pessoais|inventou/i.test(w))
        if (violations.length) allViolations.push(violations)
        if (topIssue) allIssues.push(topIssue)
        if (ev.nextSteps?.[0]) allSuggestions.push(ev.nextSteps[0])

        await prisma.autoTrainSession.create({
          data: { siteId, simType: simulationType as any, rounds: roundsPerRun, status: 'DONE', transcript: transcript as any, analysis: rawEv, score: ev.score ?? 0 },
        })

        send({ status: 'run_done', run, total: totalRuns, score: ev.score ?? 0, result: ev.result ?? 'FALHA', topIssue, violations })
      } catch (runErr) {
        send({ status: 'run_error', run, message: runErr instanceof Error ? runErr.message : 'Erro' })
      }
    }

    send({ status: 'analysing' })

    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
    const excellent = scores.filter(s => s >= 80).length
    const good = scores.filter(s => s >= 60 && s < 80).length
    const poor = scores.filter(s => s < 60).length

    const violFreq: Record<string, number> = {}
    allViolations.flat().forEach(v => { violFreq[v] = (violFreq[v] || 0) + 1 })
    const sugFreq: Record<string, number> = {}
    allSuggestions.forEach(s => { sugFreq[s] = (sugFreq[s] || 0) + 1 })
    const topViolations = Object.entries(violFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([text, count]) => ({ text, count }))
    const topSuggestions = Object.entries(sugFreq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([text, count]) => ({ text, count }))

    const diagPrompt = `Foste o coach de IA em ${totalRuns} sessões de treino de ${simulationType} para ${site.brand}.
Resultados: média ${avgScore}/100, ${excellent} excelentes (≥80), ${good} bons (60-79), ${poor} a melhorar (<60).
Problemas frequentes: ${allIssues.slice(0, 8).join('; ')}.
Sugestões frequentes: ${allSuggestions.slice(0, 5).join('; ')}.

Responde APENAS com JSON válido:
{
  "diagnosis": "<2-3 frases síntese>",
  "useThese": ["<frase recomendada>"],
  "avoidThese": ["<frase a evitar>"],
  "promptImprovements": ["<sugestão para melhorar o system prompt>"],
  "sessionsToMastery": <número estimado>
}`

    let diag: any = {}
    try { const r = await callLLMAuto([{ role: 'user', content: diagPrompt }]); const m = r.content?.match(/\{[\s\S]*\}/); if (m) diag = JSON.parse(m[0]) } catch {}

    send({
      status: 'batch_done', totalRuns, avgScore,
      scoreDistribution: { excellent, good, poor },
      topViolations, topSuggestions,
      finalAnalysis: {
        diagnosis: diag.diagnosis ?? '',
        useThese: diag.useThese ?? [],
        avoidThese: diag.avoidThese ?? [],
        promptImprovements: diag.promptImprovements ?? [],
        sessionsToMastery: diag.sessionsToMastery ?? null,
      },
    })

    // Auto-promote if batch average >= 9.5/10 (95/100)
    if (avgScore >= PROMOTION_THRESHOLD && bestEvaluation) {
      send({ status: 'promoting', score: avgScore })
      try {
        const { newPrompt, summary } = await promoteToProduction(
          siteId, site.brand, site.systemPrompt, simulationType, bestEvaluation
        )
        send({ status: 'promoted', score: avgScore, summary, newPromptPreview: newPrompt.slice(0, 200) })
      } catch (promErr) {
        send({ status: 'promote_error', message: 'Falha ao aplicar melhorias' })
      }
    }

    res.end()
  } catch (err) {
    console.error('[batch-train]', err)
    send({ status: 'error', message: err instanceof Error ? err.message : 'Erro interno' })
    res.end()
  }
})

export default router
