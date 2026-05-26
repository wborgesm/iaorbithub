// JARVIS Extra Tools — módulos 18 a 71 do plano ORBIT_JARVIS_UPGRADE.md
// Mantido fora de toolExecution.ts para evitar inflar esse ficheiro.
import { PrismaClient } from '@prisma/client'
import type { SessionContext, ToolCallResult } from '../types'

const prisma = new PrismaClient()

type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      required?: string[]
      properties: Record<string, unknown>
    }
  }
}

export const JARVIS_TOOL_DEFINITIONS: ToolDef[] = [
  { type: 'function', function: { name: 'getWhatsAppIntelligence', description: 'Resumo semanal WhatsApp (pessoal+negócio): conversas activas, pendentes, tópicos relevantes.', parameters: { type: 'object', properties: { refresh: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'detectGpsAnomaly', description: 'Detecta anomalias operacionais em GPS Rinosat: instalações falsas, sinal perdido, jammer provável.', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['fake_installation','no_movement','battery_flat','signal_loss','all'] }, days: { type: 'number' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'getPredictions', description: 'Previsões: churn de clientes e risco de falha de dispositivos.', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['churn','device_failure','all'] }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'setCrisisMode', description: 'Activa/desactiva modo crise. Respostas mais curtas e directas.', parameters: { type: 'object', required: ['active'], properties: { active: { type: 'boolean' }, reason: { type: 'string' } } } } },
  { type: 'function', function: { name: 'createMission', description: 'Quebra um objectivo em 4-8 tarefas concretas e regista-as.', parameters: { type: 'object', required: ['goal'], properties: { goal: { type: 'string' }, project: { type: 'string' }, deadline: { type: 'string' } } } } },
  { type: 'function', function: { name: 'getOperationalCosts', description: 'Custos operacionais: tokens LLM e faturas em atraso.', parameters: { type: 'object', properties: { days: { type: 'number' }, include: { type: 'string', enum: ['llm','invoices','all'] } } } } },
  { type: 'function', function: { name: 'setPersonality', description: 'Muda personalidade: padrao, tecnico, executivo, suporte, operador, copiloto.', parameters: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['padrao','tecnico','executivo','suporte','operador','copiloto'] } } } } },
  { type: 'function', function: { name: 'getClientReputation', description: 'Perfil de risco de cliente Rinosat: faturas, inactividade, suporte.', parameters: { type: 'object', properties: { email: { type: 'string' }, search: { type: 'string' } } } } },
  { type: 'function', function: { name: 'getAuditLog', description: 'Black Box: histórico de acções e eventos ORBIT.', parameters: { type: 'object', properties: { source: { type: 'string', enum: ['tool','alert','crisis','briefing','monitor','all'] }, action: { type: 'string' }, hours: { type: 'number' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'analyzeScreen', description: 'Analisa o ecrã actual do MacBook ou iPhone do Wanderson.', parameters: { type: 'object', properties: { source: { type: 'string', enum: ['macbook','iphone'] }, question: { type: 'string' } } } } },
  { type: 'function', function: { name: 'getDroneTelemetry', description: 'Telemetria em tempo real do drone: GPS, altitude, bateria.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'analyzeGsmCoverage', description: 'Analisa cobertura GSM de uma posição. Distingue zona sem sinal vs jammer.', parameters: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, deviceId: { type: 'string' }, radius_m: { type: 'number' } } } } },
  { type: 'function', function: { name: 'analyzeRelationships', description: 'Grafo de relações de um dispositivo/cliente/técnico. Detecta padrões de falha em lote.', parameters: { type: 'object', properties: { entity: { type: 'string' }, type: { type: 'string', enum: ['device','client','technician','auto'] }, depth: { type: 'number' } } } } },
  { type: 'function', function: { name: 'ghostReplay', description: 'Reconstrói evento passado: rota, velocidade, ignição, alarmes.', parameters: { type: 'object', required: ['deviceId','startTime'], properties: { deviceId: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' }, detail: { type: 'string', enum: ['summary','full'] } } } } },
  { type: 'function', function: { name: 'getSuspicionScore', description: 'Score 0-100 de suspeita por dispositivo: horário, velocidade, alarmes, padrão, tensão.', parameters: { type: 'object', properties: { deviceId: { type: 'string' }, topRisks: { type: 'number' } } } } },
  { type: 'function', function: { name: 'getMyLatencyProfile', description: 'Padrão de actividade/resposta do Wanderson. Detecta sobrecarga.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'synthesizeIntelligence', description: 'Síntese multi-domínio sobre uma entidade: GPS, financeiro, reputação.', parameters: { type: 'object', required: ['subject'], properties: { subject: { type: 'string' }, domains: { type: 'array', items: { type: 'string', enum: ['gps','financial','reputation','anomaly','prediction'] } } } } } },
  { type: 'function', function: { name: 'simulateDecision', description: 'Simula impacto de acção antes de executar (bloquear veículo, alertar cliente).', parameters: { type: 'object', required: ['action','target'], properties: { action: { type: 'string', enum: ['block_vehicle','alert_client','disable_device','send_police','lock_account'] }, target: { type: 'string' }, context: { type: 'string' } } } } },
  { type: 'function', function: { name: 'analyzeSystemLogs', description: 'Lê e analisa logs do sistema com IA. Causa raiz, padrões, sugestões.', parameters: { type: 'object', properties: { service: { type: 'string', enum: ['ai-command-center','traccar','nginx','system','all'] }, minutes: { type: 'number' }, query: { type: 'string' } } } } },
  { type: 'function', function: { name: 'analyzeDeviceHealth', description: 'Diagnóstico de hardware GPS: tensão, RSSI, satélites, temperatura.', parameters: { type: 'object', properties: { deviceId: { type: 'string' }, allDevices: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'getTheftRiskForecast', description: 'Previsão de risco de roubo nas próximas 24-48h por dispositivo.', parameters: { type: 'object', properties: { deviceId: { type: 'string' }, hours: { type: 'number' } } } } },
  { type: 'function', function: { name: 'rememberEpisode', description: 'Guarda episódio completo na memória de longo prazo com embeddings.', parameters: { type: 'object', required: ['title','description'], properties: { title: { type: 'string' }, description: { type: 'string' }, category: { type: 'string', enum: ['theft','technical','client','operation','personal','financial'] }, outcome: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } },
  { type: 'function', function: { name: 'recallEpisode', description: 'Recorda episódios passados similares à situação actual.', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, category: { type: 'string', enum: ['theft','technical','client','operation','personal','financial','all'] }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'getOptimalTiming', description: 'Calcula momento óptimo para uma acção: bloqueio, contacto, relatório.', parameters: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['block_vehicle','contact_client','send_report','run_maintenance'] }, deviceId: { type: 'string' }, urgency: { type: 'string', enum: ['critical','high','normal','low'] } } } } },
  { type: 'function', function: { name: 'getBehaviorProfile', description: 'Perfil comportamental aprendido de um veículo.', parameters: { type: 'object', properties: { deviceId: { type: 'string' } } } } },
  { type: 'function', function: { name: 'generateEvidenceReport', description: 'Gera PDF de relatório de evidências para roubo/incidente (timeline, rota, alarmes).', parameters: { type: 'object', required: ['deviceId','incidentTime'], properties: { deviceId: { type: 'string' }, incidentTime: { type: 'string' }, windowHours: { type: 'number' }, ownerName: { type: 'string' }, plateNumber: { type: 'string' } } } } },
  { type: 'function', function: { name: 'getWeatherCorrelation', description: 'Correlaciona clima com falhas GPS.', parameters: { type: 'object', properties: { hours: { type: 'number' } } } } },
  { type: 'function', function: { name: 'logMaintenance', description: 'Regista manutenção de moto: troca de óleo, correia, etc.', parameters: { type: 'object', required: ['moto','type','kmsAtChange'], properties: { moto: { type: 'string' }, type: { type: 'string' }, kmsAtChange: { type: 'number' }, nextKms: { type: 'number' }, nextDate: { type: 'string' }, notes: { type: 'string' }, cost: { type: 'number' } } } } },
  { type: 'function', function: { name: 'getMaintenanceStatus', description: 'Estado de manutenção das motos: revisões próximas, custos.', parameters: { type: 'object', properties: { moto: { type: 'string' }, currentKms: { type: 'number' } } } } },
  { type: 'function', function: { name: 'universalSearch', description: 'Pesquisa unificada em todos os sistemas: clientes, dispositivos, tarefas, contactos, memória.', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'getSixthSense', description: 'Análise de micro-sinais agregados: GSM drops, oscilações de tensão, GPS jumps.', parameters: { type: 'object', properties: { deviceId: { type: 'string' } } } } },
  { type: 'function', function: { name: 'getActiveIncidents', description: 'Lista incidentes activos agrupados (anti-caos).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'detectTemporalAnomaly', description: 'Detecta sequências de eventos impossíveis (movimento sem ignição, etc).', parameters: { type: 'object', properties: { deviceId: { type: 'string' }, hours: { type: 'number' } } } } },
  { type: 'function', function: { name: 'checkDeviceBaseline', description: 'Compara métricas actuais com baseline individual histórico do dispositivo.', parameters: { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' } } } } },
  { type: 'function', function: { name: 'runPostIncidentAnalysis', description: 'RCA pós-incidente: reconstrói cadeia causal de uma falha usando logs e eventos.', parameters: { type: 'object', required: ['incidentTime'], properties: { incidentTime: { type: 'string' }, description: { type: 'string' }, windowMinutes: { type: 'number' } } } } },
  { type: 'function', function: { name: 'getSilenceEvents', description: 'Eventos de silêncio: coisas que deviam ter acontecido mas não aconteceram.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'generateNarrative', description: 'Transforma eventos técnicos GPS em narrativa para cliente/polícia/suporte.', parameters: { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' }, audience: { type: 'string', enum: ['client','police','technical','summary'] }, language: { type: 'string', enum: ['pt','en'] } } } } },
  { type: 'function', function: { name: 'detectTemporalEchoes', description: 'Detecta padrões temporais recorrentes em falhas/alarmes.', parameters: { type: 'object', properties: { weeks: { type: 'number' }, type: { type: 'string', enum: ['failures','alarms','offline','all'] } } } } },
  { type: 'function', function: { name: 'inferIntent', description: 'Infere intenção do movimento: ocultação, vigilância, entrega, fuga.', parameters: { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' }, windowMins: { type: 'number' } } } } },
  { type: 'function', function: { name: 'generateContentFromEvent', description: 'Transforma evento GPS real em conteúdo para redes sociais.', parameters: { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' }, eventTime: { type: 'string' }, format: { type: 'string', enum: ['instagram_caption','tiktok_script','whatsapp_story','email','ad_copy'] }, tone: { type: 'string', enum: ['dramatic','professional','educational','urgency'] } } } } },
  { type: 'function', function: { name: 'getLeadIntelligence', description: 'Leads classificados: URGENTE/QUENTE/MORNO/FRIO/SUPORTE.', parameters: { type: 'object', properties: { classification: { type: 'string' }, hours: { type: 'number' } } } } },
  { type: 'function', function: { name: 'generateCopy', description: 'Gera copy de marketing Rinosat: anúncios, WhatsApp, hooks TikTok, email.', parameters: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['ad_headline','ad_description','whatsapp_script','email_subject','tiktok_hook','landing_hero','objection_handler'] }, context: { type: 'string' }, quantity: { type: 'number' }, useRecentEvents: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'getCompetitorIntelligence', description: 'Anúncios de concorrentes de GPS em Portugal via Meta Ad Library.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'saveHook', description: 'Guarda hook/headline/CTA na biblioteca de criativos.', parameters: { type: 'object', required: ['type','content'], properties: { type: { type: 'string', enum: ['hook','headline','cta','email_subject','objection'] }, content: { type: 'string' }, context: { type: 'string' }, channel: { type: 'string' }, performance: { type: 'string', enum: ['high','medium','low','untested'] }, notes: { type: 'string' }, tags: { type: 'string' } } } } },
  { type: 'function', function: { name: 'getHooks', description: 'Busca criativos guardados: hooks, headlines, CTAs.', parameters: { type: 'object', properties: { type: { type: 'string' }, channel: { type: 'string' }, performance: { type: 'string' }, search: { type: 'string' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'sendLeadReactivation', description: 'Envia próxima mensagem da sequência de reactivação de lead frio.', parameters: { type: 'object', required: ['contact'], properties: { contact: { type: 'string' }, messageIndex: { type: 'number' } } } } },

  // ── M171-190 Revenue Intelligence & Content Engine ──
  { type: 'function', function: { name: 'revenueAutopilot', description: 'Cruza anúncios, leads e receita. Detecta campanhas lucrativas e onde cortar. Directivas de ROI.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'revenueForecast', description: 'Prevê receita para os próximos 30-90 dias com base no histórico de facturas.', parameters: { type: 'object', properties: { days: { type: 'number', description: 'Horizonte em dias (default 30)' } } } } },
  { type: 'function', function: { name: 'funnelAnalysis', description: 'Funil Surgeon: encontra exactamente onde perdes dinheiro — leads quentes sem follow-up, leads frios, gargalos.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'growthSimulate', description: 'Simula crescimento antes de gastar: se investir X/dia numa campanha, qual o ROI esperado.', parameters: { type: 'object', required: ['extraBudgetDay', 'campaign'], properties: { extraBudgetDay: { type: 'number', description: 'Budget extra por dia em €' }, campaign: { type: 'string', description: 'Nome da campanha' } } } } },
  { type: 'function', function: { name: 'opportunityAlert', description: 'Detecta dinheiro "caído no chão": leads quentes sem resposta, facturas em atraso, tarefas urgentes pendentes.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'ceoDecision', description: 'Director de operações CEO: sintetiza tudo (funil + receita + oportunidades) em 3 directivas estratégicas. Aceita pergunta opcional.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'Pergunta específica (opcional)' } } } } },
  { type: 'function', function: { name: 'generateVideoScript', description: 'Gera roteiro completo de vídeo para anúncio: hook, problema, prova, solução, CTA + text overlay + legenda.', parameters: { type: 'object', properties: { audience: { type: 'string' }, platform: { type: 'string', enum: ['tiktok','instagram_reels','facebook_ads','youtube_shorts'] }, duration: { type: 'number' }, angle: { type: 'string', enum: ['medo','prova_social','custo_beneficio','urgencia'] }, context: { type: 'string' } } } } },
  { type: 'function', function: { name: 'generateAdaptiveCopy', description: 'Gera copy adaptado ao perfil do cliente: emocional, racional, empresa, jovem, experiente.', parameters: { type: 'object', required: ['profile','format','topic'], properties: { profile: { type: 'string', enum: ['emocional','racional','empresa','jovem','experiente'] }, format: { type: 'string', enum: ['whatsapp','instagram_caption','email','sms','ad_headline'] }, topic: { type: 'string' } } } } },
  { type: 'function', function: { name: 'smartFollowup', description: 'Follow-up inteligente: detecta leads sem contacto e gera mensagem personalizada para cada um.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'marketReaction', description: 'Detecta mudanças de mercado (velocidade de leads, conversão) e sugere reacções táticas imediatas.', parameters: { type: 'object', properties: {} } } },
  // ── M191-210 Daily Operating System ──
  { type: 'function', function: { name: 'dailyOS', description: 'Orbit Daily OS: entrega o plano de execução do dia — 2 acções de dinheiro, 2 de operação, 1 de crescimento, 1 de prevenção. O que fazer e o que NÃO fazer hoje.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'quickSummary', description: 'Resumo de 60 segundos: crítico vs ok vs decisão necessária. Filtra ruído operacional.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'focusBlocks', description: 'Divide o resto do dia em blocos de foco de 90 min baseados no estado actual do negócio.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'dailyDecision', description: 'Decisor de prioridade: avalia se a acção proposta vale a pena agora, ou gera UMA decisão principal do dia. Impede trabalhar no que não move resultado.', parameters: { type: 'object', properties: { proposedAction: { type: 'string', description: 'Acção que o utilizador quer fazer (opcional). Sem argumento gera a decisão do dia.' } } } } },
  { type: 'function', function: { name: 'selfEdit', description: 'Edita o próprio código-fonte do ORBIT: substitui código antigo por novo num ficheiro, compila e reinicia. Nunca toca em ficheiros protegidos. Nunca faz git push.', parameters: { type: 'object', required: ['file', 'oldCode', 'newCode', 'reason'], properties: { file: { type: 'string', description: 'Caminho relativo do ficheiro (ex: src/routes/chat.ts)' }, oldCode: { type: 'string', description: 'Código exacto a substituir' }, newCode: { type: 'string', description: 'Novo código' }, reason: { type: 'string', description: 'Motivo da edição' } } } } },
  { type: 'function', function: { name: 'selfDebug', description: 'Auto-diagnóstico: analisa o que falhou na última resposta, encontra o código relevante e corrige. Activado quando o utilizador diz que houve um erro.', parameters: { type: 'object', properties: { errorDescription: { type: 'string', description: 'O que falhou' }, file: { type: 'string', description: 'Ficheiro suspeito (opcional)' } } } } },
  { type: 'function', function: { name: 'readSourceFile', description: 'Lê um ficheiro de código-fonte do ORBIT para analisar antes de editar.', parameters: { type: 'object', required: ['file'], properties: { file: { type: 'string', description: 'Caminho relativo (ex: src/services/llm.ts)' } } } } },
  { type: 'function', function: { name: 'dailyFollowups', description: 'Follow-ups que geram dinheiro hoje: leads quentes sem contacto + facturas em atraso. Gera mensagem concreta para cada um.', parameters: { type: 'object', properties: {} } } },

  // ── M72 Meta Ads ──
  { type: 'function', function: { name: 'getMetaCampaigns', description: 'Lista campanhas Meta Ads com performance: gasto, impressões, CTR, CPC, leads, CPL.', parameters: { type: 'object', properties: { datePreset: { type: 'string', enum: ['today','yesterday','last_7d','last_14d','last_30d','this_month'] }, level: { type: 'string', enum: ['campaigns','adsets','ads'] }, parentId: { type: 'string', description: 'ID da campanha (para adsets) ou do adset (para ads)' } } } } },
  { type: 'function', function: { name: 'controlMetaCampaign', description: 'Pausa, activa ou ajusta orçamento de campanha ou anúncio Meta.', parameters: { type: 'object', required: ['action','id'], properties: { action: { type: 'string', enum: ['pause','resume','set_budget'] }, id: { type: 'string', description: 'ID da campanha/anúncio' }, target: { type: 'string', enum: ['campaign','ad'], description: 'O que controlar (default: campaign)' }, dailyBudgetEur: { type: 'number', description: 'Para set_budget: orçamento diário em euros' } } } } },

  // ── M73 Instagram ──
  { type: 'function', function: { name: 'analyzeInstagramComments', description: 'Lê comentários recentes do Instagram e classifica em pergunta, lead, suporte, spam. Sugere respostas.', parameters: { type: 'object', properties: { mediaLimit: { type: 'number', description: 'Quantos posts recentes analisar (default: 5)' }, commentsPerPost: { type: 'number', description: 'Máx comentários por post (default: 30)' } } } } },
  { type: 'function', function: { name: 'getInstagramPerformance', description: 'Performance de posts recentes do Instagram: alcance, engagement, likes, comentários, saves.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Posts a analisar (default: 10)' } } } } },

  // ── M74 Google Ads ──
  { type: 'function', function: { name: 'getGoogleAdsPerformance', description: 'Performance Google Ads: campanhas ou keywords, CTR, CPC, conversões e flags de keywords desperdiçadoras.', parameters: { type: 'object', properties: { view: { type: 'string', enum: ['campaigns','keywords'] }, dateRange: { type: 'string', enum: ['TODAY','YESTERDAY','LAST_7_DAYS','LAST_14_DAYS','LAST_30_DAYS','THIS_MONTH','LAST_MONTH'] }, campaignId: { type: 'string', description: 'Filtrar keywords por campanha (numérico)' } } } } },

  // ── M75 TikTok ──
  { type: 'function', function: { name: 'getTikTokPerformance', description: 'Métricas TikTok Ads: views, retenção 2s/6s/50%/100%, CTR, gasto. Identifica vídeos com hook fraco ou retenção excelente.', parameters: { type: 'object', properties: { view: { type: 'string', enum: ['campaigns','videos'] }, days: { type: 'number', description: 'Janela em dias (default: 7)' } } } } },

  // ── M76 Marketing Dashboard unificado ──
  { type: 'function', function: { name: 'getMarketingDashboard', description: 'Vista executiva agregada: Meta + Google + TikTok + Instagram + leads WhatsApp + concorrentes. Numa só chamada.', parameters: { type: 'object', properties: { datePreset: { type: 'string', enum: ['last_7d','last_14d','last_30d','this_month'], description: 'Período (default: last_7d)' } } } } },
]

// ── helpers ──
const dbPools: { traccar: import('pg').Pool | null } = { traccar: null }
async function getTraccarPool(): Promise<import('pg').Pool> {
  if (!dbPools.traccar) {
    const { Pool } = await import('pg')
    dbPools.traccar = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
  }
  return dbPools.traccar
}

/**
 * Devolve `null` se a tool não é deste registo, caso contrário ToolCallResult.
 */
export async function executeJarvisTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: SessionContext,
): Promise<ToolCallResult | null> {
  try {
    // ── M18 ──
    if (toolName === 'getWhatsAppIntelligence') {
      const { getOrbitConfig } = await import('./orbitConfig')
      if (args.refresh === true) {
        try {
          const { buildWeeklyContext } = await import('../workers/whatsappIntelligence')
          await buildWeeklyContext()
        } catch { /* ignore */ }
      }
      const context = await getOrbitConfig('whatsapp_weekly_context')
      const updated = await getOrbitConfig('whatsapp_weekly_context_updated')
      if (!context) return { success: false, error: 'Nenhum contexto disponível ainda. O worker corre a cada hora.' }
      return { success: true, data: { summary: context, updatedAt: updated || 'desconhecido' } }
    }

    // ── M20 detectGpsAnomaly ──
    if (toolName === 'detectGpsAnomaly') {
      const pool = await getTraccarPool()
      const type = args.type ? String(args.type) : 'all'
      const days = typeof args.days === 'number' ? args.days : 7
      const limit = typeof args.limit === 'number' ? args.limit : 20
      const since = new Date(Date.now() - days * 86400000)
      const anomalies: Array<Record<string, unknown>> = []
      if (type === 'fake_installation' || type === 'all') {
        try {
          const r = await pool.query(`
            SELECT d.id, d.name, d.uniqueid, p.latitude, p.longitude, p.fixtime, p.speed
            FROM tc_devices d
            JOIN tc_positions p ON p.id = d.positionid
            WHERE d.disabled = false AND d.lastupdate >= $1
              AND (SELECT COUNT(*) FROM tc_positions p2
                   WHERE p2.deviceid = d.id AND p2.fixtime >= $1 AND p2.speed > 2) = 0
            LIMIT $2
          `, [since, limit])
          for (const row of r.rows) {
            anomalies.push({ anomaly: 'fake_installation_suspected', device: row.name, uniqueid: row.uniqueid, lastPos: `${row.latitude},${row.longitude}`, lastFix: row.fixtime, movesLast: `${days}d: 0 (imóvel)` })
          }
        } catch { /* ignore */ }
      }
      if (type === 'no_movement' || type === 'all' || type === 'signal_loss') {
        try {
          const r = await pool.query(`
            SELECT d.id, d.name, d.uniqueid, d.lastupdate
            FROM tc_devices d WHERE d.disabled = false AND d.lastupdate < $1
            ORDER BY d.lastupdate ASC LIMIT $2
          `, [since, limit])
          for (const row of r.rows) {
            const hoursAgo = Math.round((Date.now() - new Date(row.lastupdate).getTime()) / 3600000)
            anomalies.push({ anomaly: 'signal_lost', device: row.name, uniqueid: row.uniqueid, lastUpdate: row.lastupdate, silentFor: `${hoursAgo}h` })
          }
        } catch { /* ignore */ }
      }
      return { success: true, data: { anomalies, total: anomalies.length, period: `${days} dias` } }
    }

    // ── M21 getPredictions ──
    if (toolName === 'getPredictions') {
      const pool = await getTraccarPool()
      const type = args.type ? String(args.type) : 'all'
      const limit = typeof args.limit === 'number' ? args.limit : 10
      const predictions: Array<Record<string, unknown>> = []
      if (type === 'churn' || type === 'all') {
        try {
          const r = await pool.query(`
            SELECT u.email, u.last_login,
                   COUNT(i.id) FILTER (WHERE i.status='open' AND i.due_date < NOW()) AS overdue_invoices,
                   SUM(i.amount_due - i.amount_paid) FILTER (WHERE i.status='open') AS debt
            FROM users u LEFT JOIN billing_invoice i ON i.user_id = u.id
            WHERE u.last_login < NOW() - INTERVAL '15 days'
            GROUP BY u.email, u.last_login
            HAVING COUNT(i.id) FILTER (WHERE i.status='open' AND i.due_date < NOW()) > 0 OR u.last_login < NOW() - INTERVAL '30 days'
            ORDER BY overdue_invoices DESC, u.last_login ASC LIMIT $1
          `, [limit])
          for (const row of r.rows) {
            const daysInactive = Math.floor((Date.now() - new Date(row.last_login).getTime()) / 86400000)
            const riskScore = Math.min(100, (Number(row.overdue_invoices) || 0) * 25 + Math.floor(daysInactive / 3))
            predictions.push({ type: 'churn_risk', client: row.email, riskScore, overdueInvoices: Number(row.overdue_invoices) || 0, debt: row.debt ? `€${parseFloat(row.debt).toFixed(2)}` : '€0', daysInactive })
          }
        } catch { /* ignore */ }
      }
      if (type === 'device_failure' || type === 'all') {
        try {
          const r = await pool.query(`
            SELECT d.name, d.uniqueid, d.lastupdate,
                   (SELECT COUNT(*) FROM tc_events e WHERE e.deviceid = d.id AND e.type IN ('deviceUnknown','deviceOffline') AND e.servertime > NOW() - INTERVAL '7 days') AS fail_events
            FROM tc_devices d WHERE d.disabled = false
            ORDER BY fail_events DESC NULLS LAST LIMIT $1
          `, [limit])
          for (const row of r.rows) {
            if (Number(row.fail_events) >= 3) {
              predictions.push({ type: 'device_failure_risk', device: row.name, uniqueid: row.uniqueid, failEvents7d: Number(row.fail_events), lastUpdate: row.lastupdate, action: 'Verificar antena, alimentação e cobertura GSM' })
            }
          }
        } catch { /* ignore */ }
      }
      return { success: true, data: { predictions, total: predictions.length } }
    }

    // ── M22 setCrisisMode ──
    if (toolName === 'setCrisisMode') {
      const { setOrbitConfig } = await import('./orbitConfig')
      const active = args.active === true
      await setOrbitConfig('orbit_crisis_mode', active ? '1' : '0')
      if (active && args.reason) await setOrbitConfig('orbit_crisis_reason', String(args.reason))
      if (active) await setOrbitConfig('orbit_crisis_activated_at', new Date().toISOString())
      return { success: true, data: { crisisMode: active, reason: args.reason || '' } }
    }

    // ── M23 createMission ──
    if (toolName === 'createMission') {
      const { callLLMAuto } = await import('./llm')
      const goal = String(args.goal)
      const project = args.project ? String(args.project) : 'Missão'
      const deadline = args.deadline ? String(args.deadline) : undefined
      const prompt = `Dado o objectivo: "${goal}"\nCria uma lista de 4-8 tarefas concretas e accionáveis para atingir esse objectivo.\nResponde APENAS com JSON válido no formato:\n[{"title":"...","priority":"IMPORTANTE|NORMAL|URGENTE","description":"..."}]\nSem texto antes ou depois do JSON.`
      const llmResult = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
      let tasks: Array<{ title: string; priority: string; description?: string }> = []
      try {
        const raw = llmResult.content?.trim() || '[]'
        const s = raw.indexOf('['); const e = raw.lastIndexOf(']')
        tasks = JSON.parse(s >= 0 && e > s ? raw.slice(s, e + 1) : '[]')
      } catch {
        return { success: false, error: 'Não foi possível gerar tarefas.' }
      }
      const created: Array<{ id: string; title: string; priority: string }> = []
      for (const t of tasks) {
        const task = await prisma.orbitTask.create({
          data: { title: t.title, description: t.description || undefined, priority: t.priority || 'NORMAL', project, deadline: deadline ? new Date(deadline) : undefined },
        })
        created.push({ id: task.id, title: task.title, priority: task.priority })
      }
      return { success: true, data: { goal, project, tasksCreated: created.length, tasks: created } }
    }

    // ── M24 getOperationalCosts ──
    if (toolName === 'getOperationalCosts') {
      const days = typeof args.days === 'number' ? args.days : 30
      const include = args.include ? String(args.include) : 'all'
      const since = new Date(Date.now() - days * 86400000)
      const data: Record<string, unknown> = { days }
      if (include === 'llm' || include === 'all') {
        const PRICE: Record<string, number> = { GROQ: 0, GEMINI: 0, COHERE: 0.5, OPENAI: 0.15, CLAUDE: 0.8, LOCAL_OLLAMA: 0, LOCAL_OLLAMA_FAST: 0 }
        try {
          const logs = await prisma.lLMCallLog.groupBy({
            by: ['provider'], where: { createdAt: { gte: since } },
            _sum: { promptTokens: true, completionTokens: true }, _count: { id: true },
          })
          data.llm = logs.map(l => {
            const tokens = (l._sum.promptTokens || 0) + (l._sum.completionTokens || 0)
            const cost = (tokens / 1_000_000) * (PRICE[l.provider] || 0)
            return { provider: l.provider, calls: l._count.id, totalTokens: tokens, estimatedCost: cost > 0 ? `€${cost.toFixed(4)}` : 'Grátis' }
          })
        } catch { data.llm = [] }
      }
      if (include === 'invoices' || include === 'all') {
        try {
          const pool = await getTraccarPool()
          const r = await pool.query(`SELECT COUNT(*) AS overdue_count, SUM(amount_due - amount_paid) AS total_debt FROM billing_invoice WHERE status = 'open' AND due_date < NOW()`)
          data.invoices = { overdueCount: parseInt(r.rows[0]?.overdue_count) || 0, totalDebt: r.rows[0]?.total_debt ? `€${parseFloat(r.rows[0].total_debt).toFixed(2)}` : '€0' }
        } catch { data.invoices = { overdueCount: 0, totalDebt: '€0' } }
      }
      return { success: true, data }
    }

    // ── M25 setPersonality ──
    if (toolName === 'setPersonality') {
      const { setOrbitConfig } = await import('./orbitConfig')
      const mode = String(args.mode)
      await setOrbitConfig('orbit_personality', mode)
      const labels: Record<string, string> = { padrao: 'Padrão', tecnico: 'Técnico', executivo: 'Executivo', suporte: 'Suporte', operador: 'Operador', copiloto: 'Copiloto' }
      return { success: true, data: { mode, label: labels[mode] || mode, message: `Personalidade alterada para ${labels[mode] || mode}` } }
    }

    // ── M27 getClientReputation ──
    if (toolName === 'getClientReputation') {
      try {
        const pool = await getTraccarPool()
        const term = (args.email || args.search || '') as string
        const r = await pool.query(`
          SELECT u.id, u.email, u.last_login,
                 COUNT(i.id) FILTER (WHERE i.status='open' AND i.due_date < NOW()) AS overdue_count,
                 SUM(i.amount_due - i.amount_paid) FILTER (WHERE i.status='open') AS total_debt,
                 COUNT(i.id) FILTER (WHERE i.status='paid') AS paid_count,
                 (SELECT COUNT(*) FROM tc_devices d WHERE d.contact ILIKE '%' || u.email || '%') AS device_count
          FROM users u LEFT JOIN billing_invoice i ON i.user_id = u.id
          WHERE u.email ILIKE '%' || $1 || '%'
          GROUP BY u.id, u.email, u.last_login LIMIT 5
        `, [term])
        if (!r.rows.length) return { success: false, error: `Cliente "${term}" não encontrado` }
        const clients = r.rows.map(row => {
          const daysInactive = row.last_login ? Math.floor((Date.now() - new Date(row.last_login).getTime()) / 86400000) : 999
          const overdueCount = parseInt(row.overdue_count) || 0
          const debt = parseFloat(row.total_debt) || 0
          const risk = Math.min(100, overdueCount * 20 + Math.min(40, Math.floor(daysInactive / 3)) + Math.min(20, debt * 2))
          return { email: row.email, riskScore: risk, riskLabel: risk >= 70 ? 'ALTO' : risk >= 40 ? 'MÉDIO' : 'BAIXO', overdueInvoices: overdueCount, totalDebt: debt > 0 ? `€${debt.toFixed(2)}` : '€0', paidInvoices: parseInt(row.paid_count) || 0, daysInactive, deviceCount: parseInt(row.device_count) || 0 }
        })
        return { success: true, data: clients }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M28 getAuditLog ──
    if (toolName === 'getAuditLog') {
      const hours = typeof args.hours === 'number' ? args.hours : 24
      const limit = typeof args.limit === 'number' ? args.limit : 20
      const source = args.source && args.source !== 'all' ? String(args.source) : undefined
      const action = args.action ? String(args.action) : undefined
      const since = new Date(Date.now() - hours * 3600000)
      const logs = await prisma.orbitAuditLog.findMany({
        where: { createdAt: { gte: since }, ...(source ? { source } : {}), ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}) },
        orderBy: { createdAt: 'desc' }, take: limit,
      })
      return { success: true, data: { hours, total: logs.length, logs } }
    }

    // ── M29/M30 analyzeScreen ──
    if (toolName === 'analyzeScreen') {
      const { getOrbitConfig } = await import('./orbitConfig')
      const source = args.source ? String(args.source) : 'macbook'
      const question = args.question ? String(args.question) : 'Descreve o que está visível no ecrã.'
      const screenshot = await getOrbitConfig(`screen_last_${source}`)
      const tsStr = await getOrbitConfig(`screen_last_${source}_ts`)
      if (!screenshot) return { success: false, error: `Sem screenshot recente do ${source}.` }
      const tsAgo = tsStr ? `${Math.round((Date.now() - parseInt(tsStr)) / 60000)} minutos atrás` : 'tempo desconhecido'
      return { success: true, data: { source, capturedAgo: tsAgo, screenshotBase64: screenshot.slice(0, 4000) + '…(truncado)', instruction: question, note: 'Screenshot disponível. Para visão multimodal envia o base64 completo para gemini-vision/claude-vision.' } }
    }

    // ── M31 getDroneTelemetry ──
    if (toolName === 'getDroneTelemetry') {
      const { getOrbitConfig } = await import('./orbitConfig')
      const raw = await getOrbitConfig('drone_telemetry')
      if (!raw) return { success: false, error: 'Drone offline ou não emparelhado.' }
      try {
        const t = JSON.parse(raw)
        const minAgo = Math.round((Date.now() - (t.ts || 0)) / 60000)
        return { success: true, data: { ...t, dataAge: `${minAgo} min`, status: minAgo < 2 ? 'online' : 'stale' } }
      } catch { return { success: false, error: 'Telemetria corrompida' } }
    }

    // ── M32 analyzeGsmCoverage ──
    if (toolName === 'analyzeGsmCoverage') {
      try {
        const pool = await getTraccarPool()
        const radius = typeof args.radius_m === 'number' ? args.radius_m : 2000
        let lat = typeof args.lat === 'number' ? args.lat : undefined
        let lng = typeof args.lng === 'number' ? args.lng : undefined
        if (!lat && args.deviceId) {
          const devR = await pool.query(`SELECT p.latitude, p.longitude FROM tc_devices d JOIN tc_positions p ON p.id = d.positionid WHERE d.name ILIKE '%' || $1 || '%' OR d.uniqueid = $1 LIMIT 1`, [String(args.deviceId)])
          if (devR.rows.length) { lat = devR.rows[0].latitude; lng = devR.rows[0].longitude }
        }
        if (!lat || !lng) return { success: false, error: 'Coordenadas ou dispositivo não encontrado.' }
        try {
          const towers = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(
            `SELECT mcc, mnc, cellid, range_m, signal_dbm, earth_distance(ll_to_earth($1, $2), ll_to_earth(lat, lng)) AS dist_m FROM gsm_towers WHERE earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(lat, lng) ORDER BY dist_m ASC LIMIT 5`,
            lat, lng, radius
          )
          if (!towers.length) return { success: true, data: { lat, lng, towersNearby: 0, coverageStatus: 'SEM_COBERTURA', analysis: `Nenhuma torre GSM num raio de ${radius}m. Perda de sinal é normal.` } }
          const bestSignal = Math.max(...towers.map(t => t.signal_dbm || -120))
          const status = bestSignal > -85 ? 'BOA_COBERTURA' : bestSignal > -100 ? 'COBERTURA_FRACA' : 'COBERTURA_MARGINAL'
          return { success: true, data: { lat, lng, radius_m: radius, towersNearby: towers.length, bestSignal_dbm: bestSignal, coverageStatus: status, towers: towers.map(t => ({ cellid: t.cellid, dist_m: Math.round(t.dist_m), signal: t.signal_dbm, range_m: t.range_m })), analysis: status === 'BOA_COBERTURA' ? 'Boa cobertura. Perda de sinal seria SUSPEITA.' : 'Cobertura fraca — perda pode ser natural.' } }
        } catch {
          return { success: false, error: 'Tabela gsm_towers ou extensão earthdistance não disponível neste deploy.' }
        }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M33 analyzeRelationships ──
    if (toolName === 'analyzeRelationships') {
      try {
        const pool = await getTraccarPool()
        const entity = String(args.entity || '')
        const depth = typeof args.depth === 'number' ? Math.min(args.depth, 3) : 2
        const devR = await pool.query(`SELECT d.id, d.name, d.uniqueid, d.contact, d.groupid, p.latitude, p.longitude FROM tc_devices d LEFT JOIN tc_positions p ON p.id = d.positionid WHERE d.name ILIKE '%' || $1 || '%' OR d.uniqueid ILIKE '%' || $1 || '%' OR d.contact ILIKE '%' || $1 || '%' LIMIT 5`, [entity])
        const nodes: Array<Record<string, unknown>> = []
        const edges: Array<Record<string, unknown>> = []
        const patterns: string[] = []
        for (const dev of devR.rows) {
          nodes.push({ type: 'device', id: dev.uniqueid, name: dev.name, lat: dev.latitude, lng: dev.longitude })
          if (dev.contact && depth >= 2) {
            const sc = await pool.query(`SELECT d2.name, d2.uniqueid FROM tc_devices d2 WHERE d2.contact ILIKE '%' || $1 || '%' AND d2.id != $2 LIMIT 10`, [dev.contact.split('@')[0], dev.id])
            for (const d2 of sc.rows) { nodes.push({ type: 'sibling_device', name: d2.name, uniqueid: d2.uniqueid }); edges.push({ from: dev.uniqueid, to: d2.uniqueid, relation: 'mesmo_cliente' }) }
          }
          if (dev.groupid && depth >= 2) {
            const sg = await pool.query(`SELECT d2.name, d2.uniqueid, d2.lastupdate FROM tc_devices d2 WHERE d2.groupid = $1 AND d2.id != $2 LIMIT 10`, [dev.groupid, dev.id])
            for (const d2 of sg.rows) { nodes.push({ type: 'same_group_device', name: d2.name, uniqueid: d2.uniqueid }); edges.push({ from: dev.uniqueid, to: d2.uniqueid, relation: 'mesmo_grupo_lote' }) }
            const offCount = sg.rows.filter(d2 => new Date(d2.lastupdate).getTime() < Date.now() - 7200000).length
            if (offCount >= 3) patterns.push(`${offCount} dispositivos do mesmo grupo/lote offline — possível defeito de lote ou problema regional`)
          }
        }
        return { success: true, data: { entity, nodes, edges, patterns } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M34 ghostReplay ──
    if (toolName === 'ghostReplay') {
      try {
        const pool = await getTraccarPool()
        const devName = String(args.deviceId)
        const startTime = new Date(String(args.startTime))
        const endTime = args.endTime ? new Date(String(args.endTime)) : new Date(startTime.getTime() + 7200000)
        const detail = args.detail === 'full' ? 'full' : 'summary'
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const deviceId = devR.rows[0].id
        const posLimit = detail === 'full' ? 500 : 100
        const posR = await pool.query(`SELECT fixtime, latitude, longitude, speed, course, attributes->>'ignition' AS ignition, attributes->>'alarm' AS alarm, attributes->>'power' AS power FROM tc_positions WHERE deviceid = $1 AND fixtime BETWEEN $2 AND $3 ORDER BY fixtime ASC LIMIT $4`, [deviceId, startTime, endTime, posLimit])
        const evR = await pool.query(`SELECT servertime, type, attributes FROM tc_events WHERE deviceid = $1 AND servertime BETWEEN $2 AND $3 ORDER BY servertime ASC`, [deviceId, startTime, endTime])
        const timeline: Array<Record<string, unknown>> = []
        for (const ev of evR.rows) timeline.push({ time: ev.servertime, type: 'event', event: ev.type, data: ev.attributes })
        let maxSpeed = 0, totalDistance = 0, lastPos: { lat: number; lng: number } | null = null
        for (const pos of posR.rows) {
          const spd = parseFloat(pos.speed) || 0
          if (spd > maxSpeed) maxSpeed = spd
          if (lastPos) {
            const dlat = (pos.latitude - lastPos.lat) * 111
            const dlng = (pos.longitude - lastPos.lng) * 111 * Math.cos(pos.latitude * Math.PI / 180)
            totalDistance += Math.sqrt(dlat * dlat + dlng * dlng)
          }
          lastPos = { lat: pos.latitude, lng: pos.longitude }
          if (detail === 'full' || pos.alarm) {
            timeline.push({ time: pos.fixtime, type: 'position', lat: pos.latitude, lng: pos.longitude, speed_kmh: Math.round(spd * 1.852), ignition: pos.ignition, alarm: pos.alarm || undefined, power: pos.power })
          }
        }
        timeline.sort((a, b) => new Date(a.time as string).getTime() - new Date(b.time as string).getTime())
        const firstPos = posR.rows[0]
        const lastPosRow = posR.rows[posR.rows.length - 1]
        return { success: true, data: { device: devR.rows[0].name, period: { from: startTime, to: endTime }, summary: { positionsRecorded: posR.rows.length, eventsRecorded: evR.rows.length, maxSpeed_kmh: Math.round(maxSpeed * 1.852), totalDistance_km: Math.round(totalDistance * 10) / 10, startCoords: firstPos ? `${firstPos.latitude.toFixed(5)}, ${firstPos.longitude.toFixed(5)}` : 'sem dados', endCoords: lastPosRow ? `${lastPosRow.latitude.toFixed(5)}, ${lastPosRow.longitude.toFixed(5)}` : 'sem dados', alarmsTriggered: evR.rows.filter(e => e.type === 'alarm').length }, timeline: detail === 'full' ? timeline : timeline.filter(t => t.type === 'event' || t.alarm) } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro no Ghost Replay' } }
    }

    // ── M35 getSuspicionScore ──
    if (toolName === 'getSuspicionScore') {
      try {
        const pool = await getTraccarPool()
        const { calculateSuspicionScore } = await import('./suspicionEngine')
        if (args.topRisks) {
          const limit = typeof args.topRisks === 'number' ? args.topRisks : 10
          const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE disabled = false ORDER BY lastupdate DESC LIMIT $1`, [limit * 3])
          const scores = await Promise.all(devR.rows.map(d => calculateSuspicionScore(d.id, d.name, pool)))
          scores.sort((a, b) => b.score - a.score)
          return { success: true, data: scores.slice(0, limit) }
        }
        const devName = String(args.deviceId || '')
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        return { success: true, data: await calculateSuspicionScore(devR.rows[0].id, devR.rows[0].name, pool) }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M36 getMyLatencyProfile ──
    if (toolName === 'getMyLatencyProfile') {
      const { getOrbitConfig } = await import('./orbitConfig')
      const today = new Date().toISOString().slice(0, 10)
      const lastActive = parseInt(await getOrbitConfig('human_last_active_ts') || '0')
      const todayMinutes = parseInt(await getOrbitConfig(`human_active_minutes_${today}`) || '0')
      const last7: number[] = []
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
        last7.push(parseInt(await getOrbitConfig(`human_active_minutes_${d}`) || '0'))
      }
      const avg = last7.reduce((a, b) => a + b, 0) / 7
      const minAgo = lastActive ? Math.round((Date.now() - lastActive) / 60000) : 999
      const loadLevel = todayMinutes > avg * 1.5 ? 'SOBRECARREGADO' : todayMinutes < avg * 0.5 ? 'DISPONÍVEL' : 'NORMAL'
      return { success: true, data: { todayActiveMinutes: todayMinutes, todayActiveHours: (todayMinutes / 60).toFixed(1), avg7dMinutes: Math.round(avg), lastSeenMinutesAgo: minAgo, loadLevel } }
    }

    // ── M37 synthesizeIntelligence ──
    if (toolName === 'synthesizeIntelligence') {
      try {
        const pool = await getTraccarPool()
        const { callLLMAuto } = await import('./llm')
        const subject = String(args.subject || '')
        const signals: Array<{ domain: string; data: Record<string, unknown> }> = []
        const devR = await pool.query(`SELECT d.name, d.uniqueid, d.lastupdate, p.speed, p.latitude, p.longitude FROM tc_devices d LEFT JOIN tc_positions p ON p.id = d.positionid WHERE d.contact ILIKE '%' || $1 || '%' OR d.name ILIKE '%' || $1 || '%' LIMIT 3`, [subject])
        if (devR.rows.length) signals.push({ domain: 'GPS', data: { devices: devR.rows.length, sample: devR.rows[0] } })
        try {
          const inv = await pool.query(`SELECT COUNT(*) FILTER (WHERE status='open' AND due_date < NOW()) AS overdue, SUM(amount_due - amount_paid) FILTER (WHERE status='open') AS debt FROM billing_invoice i JOIN users u ON u.id = i.user_id WHERE u.email ILIKE '%' || $1 || '%'`, [subject])
          if (inv.rows[0]) signals.push({ domain: 'Financeiro', data: { overdue: inv.rows[0].overdue, debt: inv.rows[0].debt } })
        } catch { /* ignore */ }
        if (!signals.length) return { success: false, error: `Sem dados para "${subject}"` }
        const prompt = `Analisa os sinais sobre "${subject}" e produz uma conclusão integrada em 2-3 frases:\n${signals.map(s => `[${s.domain}]: ${JSON.stringify(s.data)}`).join('\n')}\nConclui com: prioridade (BAIXA/MÉDIA/ALTA/CRÍTICA), acção recomendada e porquê. Português.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { subject, signals, synthesis: llm.content } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M38 simulateDecision ──
    if (toolName === 'simulateDecision') {
      try {
        const pool = await getTraccarPool()
        const action = String(args.action)
        const target = String(args.target)
        const context = args.context ? String(args.context) : ''
        const riskFactors: string[] = []
        let safetyScore = 100
        let recommendedWait = 0
        const alternatives: string[] = []
        let posSpeed = 0
        if (action === 'block_vehicle') {
          const posR = await pool.query(`SELECT p.speed FROM tc_devices d JOIN tc_positions p ON p.id = d.positionid WHERE d.name ILIKE '%' || $1 || '%' OR d.uniqueid = $1 LIMIT 1`, [target])
          if (posR.rows.length) {
            posSpeed = Math.round(parseFloat(posR.rows[0].speed) * 1.852)
            if (posSpeed > 80) { safetyScore -= 60; riskFactors.push(`Veículo a ${posSpeed} km/h — bloquear agora é PERIGOSO`); recommendedWait = 90; alternatives.push('Aguardar veículo parar ou reduzir para <30 km/h') }
            else if (posSpeed > 30) { safetyScore -= 30; riskFactors.push(`Veículo a ${posSpeed} km/h — risco moderado`); recommendedWait = 30; alternatives.push('Aguardar redução de velocidade') }
            else { riskFactors.push(`Veículo a ${posSpeed} km/h — seguro bloquear`) }
          }
          alternatives.push('Enviar alerta sonoro primeiro sem bloquear')
          alternatives.push('Contactar cliente para confirmar antes de bloquear')
        }
        const decision = safetyScore >= 80 ? 'SEGURO — pode executar agora' : safetyScore >= 50 ? `AGUARDAR ${recommendedWait}s — risco moderado` : `NÃO EXECUTAR agora — RISCO ELEVADO`
        const confidence = { score: Math.min(100, safetyScore + riskFactors.length * 10), requiresHuman: safetyScore < 70 }
        return { success: true, data: { action, target, safetyScore, decision, riskFactors, recommendedWaitSeconds: recommendedWait, alternatives, context, confidence } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M39 analyzeSystemLogs ──
    if (toolName === 'analyzeSystemLogs') {
      try {
        const { execSync } = await import('child_process')
        const { callLLMAuto } = await import('./llm')
        const service = args.service ? String(args.service) : 'ai-command-center'
        const minutes = typeof args.minutes === 'number' ? args.minutes : 60
        const query = args.query ? String(args.query) : ''
        const since = `${minutes} minutes ago`
        let raw = ''
        try {
          const grepFlag = query ? `| grep -i "${query.replace(/"/g, '')}"` : ''
          const cmd = service === 'all'
            ? `journalctl --since "${since}" -n 200 --no-pager ${grepFlag} 2>/dev/null`
            : `journalctl -u ${service} --since "${since}" -n 200 --no-pager ${grepFlag} 2>/dev/null`
          raw = execSync(cmd, { timeout: 10000 }).toString().slice(0, 8000)
        } catch { raw = 'Sem acesso a journalctl.' }
        if (!raw.trim() || raw.includes('-- No entries --')) return { success: true, data: { service, minutes, summary: 'Sem logs no período.', raw: '' } }
        const prompt = `Analisa estes logs de "${service}" dos últimos ${minutes} min:\n\n\`\`\`\n${raw.slice(0, 4000)}\n\`\`\`\n\nIdentifica: 1) Erros/falhas (com timestamp); 2) Padrões repetidos; 3) Causa raiz provável; 4) Acção recomendada.\nMáx 300 palavras em português.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { service, minutes, query, linesAnalyzed: raw.split('\n').length, analysis: llm.content, rawPreview: raw.split('\n').slice(-20).join('\n') } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M40 analyzeDeviceHealth ──
    if (toolName === 'analyzeDeviceHealth') {
      try {
        const pool = await getTraccarPool()
        async function diagnose(devId: number, devName: string) {
          const r = await pool.query(`SELECT fixtime, (attributes->>'power')::float AS power, (attributes->>'rssi')::float AS rssi, (attributes->>'sat')::int AS sat, (attributes->>'temp1')::float AS temp, attributes->>'alarm' AS alarm, speed FROM tc_positions WHERE deviceid = $1 ORDER BY fixtime DESC LIMIT 20`, [devId])
          if (!r.rows.length) return null
          const issues: string[] = []
          const latest = r.rows[0]
          if (latest.power !== null) {
            if (latest.power < 9.0) issues.push(`Tensão crítica: ${latest.power.toFixed(1)}V`)
            else if (latest.power < 11.0) issues.push(`Tensão baixa: ${latest.power.toFixed(1)}V`)
            const powers = r.rows.filter(p => p.power !== null).map(p => p.power)
            if (powers.length >= 5) {
              const max = Math.max(...powers), min = Math.min(...powers)
              if (max - min > 3.0) issues.push(`Flutuação tensão: ${min.toFixed(1)}-${max.toFixed(1)}V — fio mal crimpado ou relé`)
            }
          }
          if (latest.rssi !== null) {
            if (latest.rssi < 10) issues.push(`RSSI GSM muito baixo: ${latest.rssi}`)
            else if (latest.rssi < 15) issues.push(`RSSI GSM baixo: ${latest.rssi}`)
          }
          if (latest.sat !== null && latest.sat < 4) issues.push(`Poucos satélites: ${latest.sat}`)
          if (latest.temp !== null) {
            if (latest.temp > 75) issues.push(`Temperatura crítica: ${latest.temp}°C`)
            else if (latest.temp > 60) issues.push(`Temperatura elevada: ${latest.temp}°C`)
          }
          return { device: devName, issues, healthy: issues.length === 0, lastCheck: latest.fixtime, metrics: { power_v: latest.power, rssi: latest.rssi, sat: latest.sat, temp_c: latest.temp } }
        }
        if (args.allDevices) {
          const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE disabled = false AND lastupdate > NOW() - INTERVAL '24 hours' LIMIT 50`)
          const results: unknown[] = []
          for (const dev of devR.rows) {
            const d = await diagnose(dev.id, dev.name)
            if (d && !d.healthy) results.push(d)
          }
          return { success: true, data: { devicesWithIssues: results.length, devices: results } }
        }
        const devName = String(args.deviceId || '')
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        return { success: true, data: await diagnose(devR.rows[0].id, devR.rows[0].name) }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M41 getTheftRiskForecast ──
    if (toolName === 'getTheftRiskForecast') {
      try {
        const pool = await getTraccarPool()
        const forecastHours = typeof args.hours === 'number' ? args.hours : 48
        async function calc(devId: number, devName: string) {
          let risk = 0; const factors: string[] = []
          const a = await pool.query(`SELECT COUNT(*) AS cnt FROM tc_events WHERE deviceid = $1 AND type = 'alarm' AND attributes->>'alarm' IN ('sos','vibration','movement','lowspeed') AND servertime > NOW() - INTERVAL '90 days'`, [devId])
          if (parseInt(a.rows[0].cnt) > 5) { risk += 25; factors.push(`${a.rows[0].cnt} alarmes em 90d`) }
          const n = await pool.query(`SELECT COUNT(*) AS cnt FROM tc_positions WHERE deviceid = $1 AND EXTRACT(HOUR FROM fixtime) BETWEEN 0 AND 5 AND speed > 5 AND fixtime > NOW() - INTERVAL '30 days'`, [devId])
          if (parseInt(n.rows[0].cnt) > 10) { risk += 20; factors.push(`${n.rows[0].cnt} movimentos nocturnos em 30d`) }
          const z = await pool.query(`SELECT STDDEV(latitude) AS std FROM tc_positions WHERE deviceid = $1 AND fixtime > NOW() - INTERVAL '7 days'`, [devId])
          if (parseFloat(z.rows[0]?.std) > 0.5) { risk += 15; factors.push('Alta variação geográfica recente') }
          const d = await pool.query(`SELECT lastupdate FROM tc_devices WHERE id = $1`, [devId])
          const hOff = d.rows[0] ? (Date.now() - new Date(d.rows[0].lastupdate).getTime()) / 3600000 : 0
          if (hOff > 4 && hOff < 48) { risk += 20; factors.push(`Offline há ${Math.round(hOff)}h`) }
          const level = risk >= 60 ? 'ALTO' : risk >= 35 ? 'MÉDIO' : 'BAIXO'
          return { device: devName, riskScore: Math.min(risk, 100), level, factors, forecastHours }
        }
        if (args.deviceId) {
          const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [String(args.deviceId)])
          if (!devR.rows.length) return { success: false, error: 'Dispositivo não encontrado' }
          return { success: true, data: await calc(devR.rows[0].id, devR.rows[0].name) }
        }
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE disabled = false ORDER BY lastupdate DESC LIMIT 30`)
        const all = await Promise.all(devR.rows.map(d => calc(d.id, d.name)))
        all.sort((a, b) => b.riskScore - a.riskScore)
        return { success: true, data: { forecast: all.filter(d => d.riskScore > 20).slice(0, 10) } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M44 rememberEpisode / recallEpisode ──
    if (toolName === 'rememberEpisode') {
      try {
        const title = String(args.title)
        const description = String(args.description)
        const category = args.category ? String(args.category) : 'operation'
        const outcome = args.outcome ? String(args.outcome) : undefined
        const tags = Array.isArray(args.tags) ? (args.tags as string[]).join(', ') : ''
        const fullText = `[${category.toUpperCase()}] ${title}\n${description}\nResultado: ${outcome || 'não especificado'}\nTags: ${tags}`
        try {
          const { generateEmbedding } = await import('./embeddings')
          const embedding = await generateEmbedding(fullText)
          await (prisma as any).memoryVector.create({
            data: { content: fullText, type: 'episode', embedding, metadata: JSON.stringify({ title, category, outcome, tags, createdAt: new Date().toISOString() }) },
          })
          return { success: true, data: { title, category, message: 'Episódio guardado na memória.' } }
        } catch (e) {
          // Fallback: guardar em SystemConfig se MemoryVector não estiver disponível
          const { setOrbitConfig } = await import('./orbitConfig')
          const key = `episode_${Date.now()}`
          await setOrbitConfig(key, JSON.stringify({ title, category, outcome, description, tags }))
          return { success: true, data: { title, category, fallback: true, message: 'Episódio guardado em fallback (sem embeddings).' } }
        }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }
    if (toolName === 'recallEpisode') {
      try {
        const query = String(args.query)
        const limit = typeof args.limit === 'number' ? args.limit : 3
        try {
          const { generateEmbedding } = await import('./embeddings')
          const embedding = await generateEmbedding(query)
          const episodes = await prisma.$queryRawUnsafe(
            `SELECT content, metadata, 1 - (embedding <=> $1::vector) AS similarity FROM "MemoryVector" WHERE type = 'episode' ORDER BY embedding <=> $1::vector LIMIT $2`,
            embedding, limit
          )
          return { success: true, data: { query, episodes } }
        } catch {
          return { success: false, error: 'pgvector não disponível para recall semântico.' }
        }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M46 getOptimalTiming ──
    if (toolName === 'getOptimalTiming') {
      try {
        const action = String(args.action)
        const urgency = args.urgency ? String(args.urgency) : 'normal'
        const now = new Date(); const hour = now.getHours()
        let timing: Record<string, unknown> = {}
        if (action === 'block_vehicle' && args.deviceId) {
          const pool = await getTraccarPool()
          const r = await pool.query(`SELECT p.speed FROM tc_devices d JOIN tc_positions p ON p.id = d.positionid WHERE d.name ILIKE '%' || $1 || '%' OR d.uniqueid = $1 LIMIT 1`, [String(args.deviceId)])
          const speed = r.rows.length ? Math.round(parseFloat(r.rows[0].speed) * 1.852) : 0
          if (urgency === 'critical') timing = { action: 'EXECUTAR AGORA', reason: 'Urgência crítica', waitSeconds: 0 }
          else if (speed > 80) timing = { action: 'AGUARDAR', reason: `${speed} km/h — perigoso bloquear`, waitSeconds: 90, checkEvery: 10 }
          else if (speed > 30) timing = { action: 'AGUARDAR', reason: `${speed} km/h — aguardar redução`, waitSeconds: 30, checkEvery: 5 }
          else timing = { action: 'EXECUTAR AGORA', reason: `${speed} km/h — seguro`, waitSeconds: 0 }
        } else if (action === 'contact_client') {
          if (urgency === 'critical') timing = { action: 'CONTACTAR AGORA', waitSeconds: 0 }
          else if (hour >= 9 && hour < 20) timing = { action: 'CONTACTAR AGORA', reason: `Horário laboral (${hour}h)` }
          else timing = { action: 'AGUARDAR', reason: 'Fora de horário laboral', waitMinutes: ((9 - hour + 24) % 24) * 60 - now.getMinutes(), suggestedTime: '09:00' }
        } else if (action === 'send_report') {
          timing = { action: hour >= 8 && hour < 9 ? 'ENVIAR AGORA' : 'AGUARDAR', suggestedTime: '08:30' }
        } else if (action === 'run_maintenance') {
          timing = { action: hour >= 2 && hour < 4 ? 'EXECUTAR AGORA' : 'AGUARDAR', suggestedTime: '03:00' }
        }
        return { success: true, data: { action, urgency, currentHour: hour, timing } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M47 getBehaviorProfile ──
    if (toolName === 'getBehaviorProfile') {
      try {
        const pool = await getTraccarPool()
        const { getOrbitConfig } = await import('./orbitConfig')
        const devName = String(args.deviceId || '')
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const raw = await getOrbitConfig(`behavior_profile_${devR.rows[0].id}`)
        if (!raw) return { success: false, error: 'Perfil ainda não calculado. Aguarda o ciclo das 04:00.' }
        return { success: true, data: JSON.parse(raw) }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M48 generateEvidenceReport ──
    if (toolName === 'generateEvidenceReport') {
      try {
        const pool = await getTraccarPool()
        const fs = await import('fs')
        const path = await import('path')
        let PDFDocument: any
        try { PDFDocument = (await import('pdfkit' as any)).default } catch { return { success: false, error: 'pdfkit não instalado. Executar: npm install pdfkit @types/pdfkit' } }
        const devName = String(args.deviceId)
        const incidentTs = new Date(String(args.incidentTime))
        const windowHours = typeof args.windowHours === 'number' ? args.windowHours : 6
        const ownerName = args.ownerName ? String(args.ownerName) : 'N/D'
        const plate = args.plateNumber ? String(args.plateNumber) : 'N/D'
        const devR = await pool.query(`SELECT id, name, uniqueid FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const device = devR.rows[0]
        const startTime = new Date(incidentTs.getTime() - windowHours / 2 * 3600000)
        const endTime = new Date(incidentTs.getTime() + windowHours / 2 * 3600000)
        const posR = await pool.query(`SELECT fixtime, latitude, longitude, speed * 1.852 AS speed_kmh, attributes->>'ignition' AS ignition, attributes->>'alarm' AS alarm FROM tc_positions WHERE deviceid = $1 AND fixtime BETWEEN $2 AND $3 ORDER BY fixtime ASC LIMIT 500`, [device.id, startTime, endTime])
        const evR = await pool.query(`SELECT servertime, type, attributes FROM tc_events WHERE deviceid = $1 AND servertime BETWEEN $2 AND $3 ORDER BY servertime ASC`, [device.id, startTime, endTime])
        const reportDir = path.join(process.cwd(), 'public', 'reports')
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true })
        const fileName = `evidence_${device.uniqueid}_${Date.now()}.pdf`
        const filePath = path.join(reportDir, fileName)
        const doc = new PDFDocument({ margin: 50 })
        doc.pipe(fs.createWriteStream(filePath))
        doc.fontSize(18).text('RELATÓRIO DE EVIDÊNCIAS GPS', { align: 'center' })
        doc.fontSize(10).text(`Gerado por ORBIT — ${new Date().toLocaleString('pt-PT')}`, { align: 'center' })
        doc.moveDown(2)
        doc.fontSize(13).text('1. IDENTIFICAÇÃO', { underline: true })
        doc.fontSize(10).text(`Proprietário: ${ownerName}`).text(`Matrícula: ${plate}`).text(`Dispositivo GPS: ${device.name} (ID: ${device.uniqueid})`).text(`Incidente estimado: ${incidentTs.toLocaleString('pt-PT')}`).text(`Janela analisada: ${startTime.toLocaleString('pt-PT')} – ${endTime.toLocaleString('pt-PT')}`)
        doc.moveDown()
        doc.fontSize(13).text('2. LINHA DO TEMPO DE EVENTOS', { underline: true })
        doc.fontSize(9)
        for (const ev of evR.rows) doc.text(`[${new Date(ev.servertime).toLocaleTimeString('pt-PT')}] ${ev.type.toUpperCase()} — ${JSON.stringify(ev.attributes)}`)
        if (!evR.rows.length) doc.text('(sem eventos registados)')
        doc.moveDown()
        doc.fontSize(13).text('3. ROTA GPS', { underline: true })
        doc.fontSize(9)
        const keyPositions = posR.rows.filter((_, i) => i % 10 === 0 || posR.rows[i]?.alarm)
        for (const pos of keyPositions) {
          const sp = Math.round(parseFloat(pos.speed_kmh) || 0)
          const al = pos.alarm ? ` ALARME: ${pos.alarm}` : ''
          doc.text(`${new Date(pos.fixtime).toLocaleTimeString('pt-PT')} — ${parseFloat(pos.latitude).toFixed(5)}, ${parseFloat(pos.longitude).toFixed(5)} — ${sp} km/h${al}`)
        }
        if (!posR.rows.length) doc.text('(sem posições)')
        doc.moveDown()
        const firstPos = posR.rows[0]
        if (firstPos) doc.fontSize(13).text('4. MAPA', { underline: true }).fontSize(9).text(`https://www.google.com/maps/search/?api=1&query=${firstPos.latitude},${firstPos.longitude}`)
        doc.moveDown()
        doc.fontSize(8).fillColor('#888').text('Relatório gerado automaticamente pelo ORBIT. Dados directamente dos registos GPS Traccar.', { align: 'center' })
        doc.end()
        return { success: true, data: { device: device.name, reportFile: fileName, reportUrl: `/reports/${fileName}`, positionsFound: posR.rows.length, eventsFound: evR.rows.length } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M49 getWeatherCorrelation ──
    if (toolName === 'getWeatherCorrelation') {
      try {
        const pool = await getTraccarPool()
        const { getCurrentWeather } = await import('./weatherService')
        const hours = typeof args.hours === 'number' ? args.hours : 6
        const since = new Date(Date.now() - hours * 3600000)
        const [weather, offlineR, alarmR] = await Promise.all([
          getCurrentWeather(),
          pool.query(`SELECT COUNT(*) AS cnt FROM tc_events WHERE type IN ('deviceOffline','deviceUnknown') AND servertime > $1`, [since]),
          pool.query(`SELECT COUNT(*) AS cnt FROM tc_events WHERE type = 'alarm' AND servertime > $1`, [since]),
        ])
        const offlineCount = parseInt(offlineR.rows[0].cnt) || 0
        const alarmCount = parseInt(alarmR.rows[0].cnt) || 0
        let weatherImpact = 'Nenhum'
        if (weather) {
          if (weather.rain_mm > 5) weatherImpact = `Chuva intensa (${weather.rain_mm}mm/h) — GSM degrada 20-35%`
          else if (weather.rain_mm > 1) weatherImpact = 'Chuva leve — impacto mínimo'
          else if (weather.temp_c > 38) weatherImpact = `Calor extremo (${weather.temp_c}°C) — risco baterias`
        }
        const conclusion = offlineCount > 10 && (weather?.rain_mm ?? 0) > 3 ? 'Falhas correlacionadas com clima — não é incidente de segurança.' : offlineCount > 10 ? 'Volume elevado de falhas sem correlação climática óbvia — investigar.' : 'Falhas dentro do normal.'
        return { success: true, data: { period: `${hours}h`, weather, offlineEvents: offlineCount, alarmEvents: alarmCount, weatherImpact, conclusion } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M50 logMaintenance / getMaintenanceStatus ──
    if (toolName === 'logMaintenance') {
      try {
        const kmsAtChange = typeof args.kmsAtChange === 'number' ? args.kmsAtChange : parseInt(String(args.kmsAtChange))
        const nextKmsAbs = typeof args.nextKms === 'number' ? kmsAtChange + args.nextKms : undefined
        const entry = await prisma.motoMaintenanceLog.create({
          data: { moto: String(args.moto), type: String(args.type), kmsAtChange, nextKms: nextKmsAbs, nextDate: args.nextDate ? new Date(String(args.nextDate)) : undefined, notes: args.notes ? String(args.notes) : undefined, cost: typeof args.cost === 'number' ? args.cost : undefined },
        })
        return { success: true, data: { id: entry.id, moto: entry.moto, type: entry.type, nextKms: entry.nextKms } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }
    if (toolName === 'getMaintenanceStatus') {
      try {
        const moto = args.moto ? String(args.moto) : undefined
        const currentKms = typeof args.currentKms === 'number' ? args.currentKms : undefined
        const logs = await prisma.motoMaintenanceLog.findMany({
          where: moto ? { moto: { contains: moto, mode: 'insensitive' } } : {},
          orderBy: { createdAt: 'desc' }, take: 50,
        })
        const lastByType: Record<string, typeof logs[0]> = {}
        for (const log of logs) {
          const key = `${log.moto}_${log.type}`
          if (!lastByType[key]) lastByType[key] = log
        }
        const status = Object.values(lastByType).map(log => {
          const kmsLeft = (log.nextKms && currentKms) ? log.nextKms - currentKms : null
          const due = log.nextDate ? new Date(log.nextDate) : null
          const overdue = (kmsLeft !== null && kmsLeft < 0) || (due && due < new Date())
          return { moto: log.moto, type: log.type, lastAt: `${log.kmsAtChange} km — ${log.createdAt.toLocaleDateString('pt-PT')}`, nextAt: log.nextKms ? `${log.nextKms} km` : log.nextDate?.toLocaleDateString('pt-PT') || 'N/D', kmsLeft: kmsLeft !== null ? `${kmsLeft} km` : null, overdue, alert: overdue ? 'REVISÃO EM ATRASO' : kmsLeft !== null && kmsLeft < 500 ? 'Quase na hora' : null }
        })
        const totalCost = logs.reduce((s, l) => s + (l.cost || 0), 0)
        return { success: true, data: { status, totalCostEur: totalCost.toFixed(2), logs: logs.slice(0, 10) } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M51 universalSearch ──
    if (toolName === 'universalSearch') {
      try {
        const query = String(args.query)
        const sources = Array.isArray(args.sources) && (args.sources as string[]).length ? args.sources as string[] : ['all']
        const limit = typeof args.limit === 'number' ? args.limit : 5
        const doAll = sources.includes('all')
        const results: Record<string, unknown[]> = {}
        const pool = await getTraccarPool()
        if (doAll || sources.includes('traccar')) {
          try {
            const r = await pool.query(`SELECT name, uniqueid, contact, lastupdate FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR contact ILIKE '%' || $1 || '%' OR uniqueid ILIKE '%' || $1 || '%' LIMIT $2`, [query, limit])
            if (r.rows.length) results.traccar = r.rows
          } catch { /* ignore */ }
        }
        if (doAll || sources.includes('autotrack')) {
          try {
            const r = await pool.query(`SELECT email, last_login FROM users WHERE email ILIKE '%' || $1 || '%' LIMIT $2`, [query, limit])
            if (r.rows.length) results.autotrack = r.rows
          } catch { /* ignore */ }
        }
        if (doAll || sources.includes('tasks')) {
          const tasks = await prisma.orbitTask.findMany({ where: { OR: [{ title: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }, { project: { contains: query, mode: 'insensitive' } }] }, take: limit })
          if (tasks.length) results.tasks = tasks
        }
        if (doAll || sources.includes('contacts')) {
          const contacts = await prisma.orbitContact.findMany({ where: { OR: [{ name: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }, { notes: { contains: query, mode: 'insensitive' } }] }, take: limit })
          if (contacts.length) results.contacts = contacts
        }
        if (doAll || sources.includes('memory')) {
          try {
            const { generateEmbedding } = await import('./embeddings')
            const emb = await generateEmbedding(query)
            const memRows = await prisma.$queryRawUnsafe<Array<{ content: string; type: string; similarity: number }>>(
              `SELECT content, type, 1 - (embedding <=> $1::vector) AS similarity FROM "MemoryVector" WHERE 1 - (embedding <=> $1::vector) > 0.6 ORDER BY embedding <=> $1::vector LIMIT $2`,
              emb, limit
            )
            if (memRows.length) results.memory = memRows
          } catch { /* pgvector pode não estar disponível */ }
        }
        const total = Object.values(results).reduce((s, arr) => s + arr.length, 0)
        return { success: true, data: { query, totalFound: total, results, note: total === 0 ? `Nenhum resultado para "${query}"` : undefined } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M55 getSixthSense ──
    if (toolName === 'getSixthSense') {
      try {
        const pool = await getTraccarPool()
        const { fuseSignals } = await import('./eventFusion')
        if (args.deviceId) {
          const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [String(args.deviceId)])
          if (!devR.rows.length) return { success: false, error: 'Dispositivo não encontrado' }
          return { success: true, data: await fuseSignals(devR.rows[0].id, devR.rows[0].name, pool) }
        }
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE disabled = false AND lastupdate > NOW() - INTERVAL '1 hour' LIMIT 30`)
        const all = await Promise.all(devR.rows.map(d => fuseSignals(d.id, d.name, pool)))
        all.sort((a, b) => b.score - a.score)
        return { success: true, data: all.filter(d => d.score > 10).slice(0, 10) }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M56 getActiveIncidents ──
    if (toolName === 'getActiveIncidents') {
      const { getOrbitConfig } = await import('./orbitConfig')
      const raw = await getOrbitConfig('active_incidents')
      const incidents = raw ? JSON.parse(raw) : []
      return { success: true, data: { total: incidents.length, incidents } }
    }

    // ── M57 detectTemporalAnomaly ──
    if (toolName === 'detectTemporalAnomaly') {
      try {
        const pool = await getTraccarPool()
        const devName = String(args.deviceId || '')
        const hours = typeof args.hours === 'number' ? args.hours : 6
        const since = new Date(Date.now() - hours * 3600000)
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const devId = devR.rows[0].id
        const anomalies: Array<Record<string, unknown>> = []
        const mvR = await pool.query(`SELECT fixtime, speed * 1.852 AS speed_kmh, attributes->>'ignition' AS ignition FROM tc_positions WHERE deviceid = $1 AND fixtime >= $2 AND speed > 5 AND (attributes->>'ignition' = 'false' OR attributes->>'ignition' IS NULL) ORDER BY fixtime DESC LIMIT 10`, [devId, since])
        for (const row of mvR.rows) anomalies.push({ type: 'movement_without_ignition', time: row.fixtime, detail: `${Math.round(parseFloat(row.speed_kmh))} km/h com ignição desligada`, severity: 'ALTO' })
        const offR = await pool.query(`SELECT e.servertime AS offline_at, (SELECT p.fixtime FROM tc_positions p WHERE p.deviceid = $1 AND p.fixtime > e.servertime LIMIT 1) AS pos_after FROM tc_events e WHERE e.deviceid = $1 AND e.servertime >= $2 AND e.type = 'deviceOffline' LIMIT 5`, [devId, since])
        for (const row of offR.rows) {
          if (row.pos_after) {
            const diffMs = new Date(row.pos_after).getTime() - new Date(row.offline_at).getTime()
            if (diffMs < 30000) anomalies.push({ type: 'position_after_offline', time: row.offline_at, detail: `Posição GPS ${Math.round(diffMs / 1000)}s após offline`, severity: 'MÉDIO' })
          }
        }
        return { success: true, data: { device: devR.rows[0].name, period: `${hours}h`, anomaliesFound: anomalies.length, anomalies, conclusion: anomalies.length > 0 ? 'Sequências impossíveis — possível manipulação.' : 'Nenhuma anomalia temporal.' } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M58 checkDeviceBaseline ──
    if (toolName === 'checkDeviceBaseline') {
      try {
        const pool = await getTraccarPool()
        const { getOrbitConfig } = await import('./orbitConfig')
        const devName = String(args.deviceId || '')
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const devId = devR.rows[0].id
        const baseRaw = await getOrbitConfig(`device_baseline_${devId}`)
        if (!baseRaw) return { success: false, error: 'Baseline não calculado (requer 50+ amostras de 30 dias).' }
        const baseline = JSON.parse(baseRaw)
        const posR = await pool.query(`SELECT (attributes->>'power')::float AS power, (attributes->>'rssi')::float AS rssi, (attributes->>'sat')::float AS sat, fixtime FROM tc_positions WHERE deviceid = $1 ORDER BY fixtime DESC LIMIT 1`, [devId])
        const current = posR.rows[0]
        const deviations: Array<Record<string, unknown>> = []
        if (current && baseline.avgPower && current.power) {
          const sigmas = Math.abs(current.power - baseline.avgPower) / (baseline.stdPower || 1)
          if (sigmas > 2) deviations.push({ metric: 'tensão', baseline: `${baseline.avgPower.toFixed(1)}V ±${(baseline.stdPower || 0).toFixed(2)}`, current: `${current.power.toFixed(1)}V`, sigmas: sigmas.toFixed(1), alert: sigmas > 3 ? 'CRÍTICO' : 'ATENÇÃO' })
        }
        if (current && baseline.avgRssi && current.rssi) {
          const sigmas = Math.abs(current.rssi - baseline.avgRssi) / (baseline.stdRssi || 1)
          if (sigmas > 2) deviations.push({ metric: 'RSSI GSM', baseline: `${baseline.avgRssi.toFixed(0)} ±${(baseline.stdRssi || 0).toFixed(1)}`, current: `${current.rssi}`, sigmas: sigmas.toFixed(1), alert: sigmas > 3 ? 'CRÍTICO — antena/jammer' : 'ATENÇÃO' })
        }
        return { success: true, data: { device: devR.rows[0].name, baseline, current: current ? { power: current.power, rssi: current.rssi, sat: current.sat, at: current.fixtime } : null, deviations, healthy: deviations.length === 0, conclusion: deviations.length === 0 ? 'Métricas dentro do baseline.' : `${deviations.length} desvio(s) significativo(s) — possível degradação.` } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M59 runPostIncidentAnalysis ──
    if (toolName === 'runPostIncidentAnalysis') {
      try {
        const { execSync } = await import('child_process')
        const { callLLMAuto } = await import('./llm')
        const pool = await getTraccarPool()
        const incidentTs = new Date(String(args.incidentTime))
        const description = args.description ? String(args.description) : 'falha não especificada'
        const windowMins = typeof args.windowMinutes === 'number' ? args.windowMinutes : 30
        const startTs = new Date(incidentTs.getTime() - windowMins * 60000)
        const endTs = new Date(incidentTs.getTime() + windowMins * 60000)
        let systemLogs = ''
        try { systemLogs = execSync(`journalctl --since "${startTs.toISOString()}" --until "${endTs.toISOString()}" -n 200 --no-pager 2>/dev/null`, { timeout: 10000 }).toString().slice(0, 3000) } catch { systemLogs = '(sem acesso)' }
        const evR = await pool.query(`SELECT type, COUNT(*) AS cnt, MIN(servertime) AS first_seen, MAX(servertime) AS last_seen FROM tc_events WHERE servertime BETWEEN $1 AND $2 GROUP BY type ORDER BY cnt DESC`, [startTs, endTs])
        const gpsEvents = evR.rows.map(r => `${r.type}: ${r.cnt} (${new Date(r.first_seen).toLocaleTimeString('pt-PT')}–${new Date(r.last_seen).toLocaleTimeString('pt-PT')})`).join('\n')
        const orbitLogs = await prisma.orbitAuditLog.findMany({ where: { createdAt: { gte: startTs, lte: endTs } }, orderBy: { createdAt: 'asc' }, take: 50 })
        const orbitLogText = orbitLogs.map(l => `[${l.createdAt.toLocaleTimeString('pt-PT')}] ${l.source}/${l.action}: ${l.detail || ''}`).join('\n')
        const prompt = `Análise pós-incidente ORBIT.\nIncidente: "${description}"\nPeríodo: ${startTs.toLocaleString('pt-PT')} – ${endTs.toLocaleString('pt-PT')}\n\nLOGS:\n${systemLogs.slice(0, 2000)}\n\nEVENTOS GPS:\n${gpsEvents || '(nenhum)'}\n\nACÇÕES ORBIT:\n${orbitLogText || '(nenhuma)'}\n\nReconstrói: 1. Causa raiz → 2. Impacto → 3. Cascata → 4. Efeito final.\nIdentifica o que causou, o que amplificou, e o que evitar. Sugere 2-3 acções preventivas. Português, máx 400 palavras.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { incidentTime: incidentTs, description, windowMinutes: windowMins, gpsEventsFound: evR.rows.length, orbitActionsFound: orbitLogs.length, rootCauseAnalysis: llm.content } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M60 getSilenceEvents ──
    if (toolName === 'getSilenceEvents') {
      const { getOrbitConfig } = await import('./orbitConfig')
      const raw = await getOrbitConfig('silence_events')
      const events = raw ? JSON.parse(raw) : []
      return { success: true, data: { total: events.length, events } }
    }

    // ── M61 generateNarrative ──
    if (toolName === 'generateNarrative') {
      try {
        const pool = await getTraccarPool()
        const { callLLMAuto } = await import('./llm')
        const devName = String(args.deviceId)
        const endTime = args.endTime ? new Date(String(args.endTime)) : new Date()
        const startTime = args.startTime ? new Date(String(args.startTime)) : new Date(endTime.getTime() - 3 * 3600000)
        const audience = args.audience ? String(args.audience) : 'summary'
        const lang = args.language === 'en' ? 'English' : 'português'
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const devId = devR.rows[0].id
        const [evR, posR] = await Promise.all([
          pool.query(`SELECT type, servertime, attributes FROM tc_events WHERE deviceid = $1 AND servertime BETWEEN $2 AND $3 ORDER BY servertime ASC LIMIT 30`, [devId, startTime, endTime]),
          pool.query(`SELECT fixtime, latitude, longitude, speed * 1.852 AS speed_kmh, attributes->>'ignition' AS ignition, attributes->>'alarm' AS alarm FROM tc_positions WHERE deviceid = $1 AND fixtime BETWEEN $2 AND $3 ORDER BY fixtime ASC LIMIT 50`, [devId, startTime, endTime]),
        ])
        const rawEvents = [
          ...evR.rows.map(e => ({ time: new Date(e.servertime).toLocaleTimeString('pt-PT'), event: `${e.type}: ${JSON.stringify(e.attributes)}` })),
          ...posR.rows.filter((_, i) => i % 5 === 0 || posR.rows[i]?.alarm).map(p => ({ time: new Date(p.fixtime).toLocaleTimeString('pt-PT'), event: `posição ${parseFloat(p.latitude).toFixed(4)}, ${parseFloat(p.longitude).toFixed(4)}, ${Math.round(parseFloat(p.speed_kmh))} km/h${p.alarm ? ` ALARME:${p.alarm}` : ''}` })),
        ].sort((a, b) => a.time.localeCompare(b.time))
        const audienceCtx: Record<string, string> = { client: 'Tom empático e simples, sem jargão.', police: 'Tom formal e factual, com coordenadas e timestamps.', technical: 'Tom técnico completo com IDs e parâmetros.', summary: 'Resumo conciso em 2-3 frases.' }
        const prompt = `Sequência de eventos do GPS "${devR.rows[0].name}":\n${rawEvents.map(e => `[${e.time}] ${e.event}`).join('\n')}\n\nTransforma em narrativa: ${audienceCtx[audience] || audienceCtx.summary}\nEscreve em ${lang} como uma história — não uma lista.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { device: devR.rows[0].name, period: { from: startTime, to: endTime }, audience, narrative: llm.content, rawEvents: rawEvents.length } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M62 detectTemporalEchoes ──
    if (toolName === 'detectTemporalEchoes') {
      try {
        const pool = await getTraccarPool()
        const { callLLMAuto } = await import('./llm')
        const weeks = typeof args.weeks === 'number' ? args.weeks : 8
        const type = args.type ? String(args.type) : 'all'
        const since = new Date(Date.now() - weeks * 7 * 86400000)
        const evTypes = type === 'failures' ? `('deviceOffline','deviceUnknown')` : type === 'alarms' ? `('alarm')` : type === 'offline' ? `('deviceOffline')` : `('deviceOffline','deviceUnknown','alarm')`
        const dowR = await pool.query(`SELECT EXTRACT(DOW FROM servertime) AS dow, EXTRACT(HOUR FROM servertime) AS hour, COUNT(*) AS cnt FROM tc_events WHERE servertime > $1 AND type IN ${evTypes} GROUP BY dow, hour ORDER BY cnt DESC`, [since])
        const total = dowR.rows.reduce((s, r) => s + parseInt(r.cnt), 0)
        const avg = total / (7 * 24)
        const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
        const peaks = dowR.rows.filter(r => parseInt(r.cnt) > avg * 2).slice(0, 10).map(r => ({ dayOfWeek: days[parseInt(r.dow)], hour: `${r.hour}h`, count: parseInt(r.cnt), vsAverage: `${Math.round(parseInt(r.cnt) / avg)}x média` }))
        if (!peaks.length) return { success: true, data: { weeks, message: 'Nenhum padrão temporal significativo.', totalEvents: total } }
        const prompt = `Picos temporais de falha/alarme num sistema GPS nos últimos ${weeks} semanas:\n${peaks.map(p => `• ${p.dayOfWeek} ${p.hour}: ${p.count} eventos (${p.vsAverage})`).join('\n')}\nIdentifica padrões e causas prováveis. Português, máx 150 palavras.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { weeks, totalEvents: total, peaksFound: peaks.length, peaks, interpretation: llm.content } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M63 inferIntent ──
    if (toolName === 'inferIntent') {
      try {
        const pool = await getTraccarPool()
        const { callLLMAuto } = await import('./llm')
        const devName = String(args.deviceId)
        const windowMins = typeof args.windowMins === 'number' ? args.windowMins : 60
        const since = new Date(Date.now() - windowMins * 60000)
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const posR = await pool.query(`SELECT fixtime, latitude, longitude, speed * 1.852 AS speed_kmh, course, attributes->>'ignition' AS ignition FROM tc_positions WHERE deviceid = $1 AND fixtime >= $2 ORDER BY fixtime ASC LIMIT 100`, [devR.rows[0].id, since])
        if (posR.rows.length < 5) return { success: false, error: 'Dados insuficientes (< 5 posições).' }
        const speeds = posR.rows.map(p => parseFloat(p.speed_kmh) || 0)
        const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length
        const maxSpeed = Math.max(...speeds)
        const stops = speeds.filter(s => s < 3).length
        const stopRatio = stops / speeds.length
        const headings = posR.rows.map(p => parseFloat(p.course) || 0)
        let turns = 0
        for (let i = 1; i < headings.length; i++) { const delta = Math.abs(headings[i] - headings[i - 1]); if (delta > 45 && delta < 315) turns++ }
        const turnRatio = turns / posR.rows.length
        const lats = posR.rows.map(p => parseFloat(p.latitude))
        const lngs = posR.rows.map(p => parseFloat(p.longitude))
        const areaKm2 = (Math.max(...lats) - Math.min(...lats)) * 111 * (Math.max(...lngs) - Math.min(...lngs)) * 111
        const summary = `\n- Velocidade média: ${Math.round(avgSpeed)} km/h (máx: ${Math.round(maxSpeed)})\n- Paragens: ${Math.round(stopRatio * 100)}%\n- Mudanças de direcção: ${Math.round(turnRatio * 100)}%\n- Área: ~${areaKm2.toFixed(2)} km²\n- Posições: ${posR.rows.length}\n- Duração: ${windowMins} min`
        const prompt = `Analisa o comportamento de um veículo GPS nos últimos ${windowMins} min:${summary}\n\nInfere a INTENÇÃO. Hipóteses: Ocultação, Vigilância, Condução normal, Fuga, Patrulha, Lazer.\nPara cada hipótese relevante, score 0-100 + justificação 1 frase. Conclui com a mais provável e nível de confiança. Português, tom analítico.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { device: devR.rows[0].name, windowMins, behaviorMetrics: { avgSpeed_kmh: Math.round(avgSpeed), maxSpeed_kmh: Math.round(maxSpeed), stopRatioPct: Math.round(stopRatio * 100), turnRatioPct: Math.round(turnRatio * 100), areaKm2: parseFloat(areaKm2.toFixed(2)), samples: posR.rows.length }, intentAnalysis: llm.content, disclaimer: 'Interpretação probabilística.' } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M65 generateContentFromEvent ──
    if (toolName === 'generateContentFromEvent') {
      try {
        const pool = await getTraccarPool()
        const { callLLMAuto } = await import('./llm')
        const devName = String(args.deviceId)
        const format = args.format ? String(args.format) : 'instagram_caption'
        const tone = args.tone ? String(args.tone) : 'dramatic'
        const since = args.eventTime ? new Date(String(args.eventTime)) : new Date(Date.now() - 3600000)
        const devR = await pool.query(`SELECT id, name FROM tc_devices WHERE name ILIKE '%' || $1 || '%' OR uniqueid = $1 LIMIT 1`, [devName])
        if (!devR.rows.length) return { success: false, error: `Dispositivo "${devName}" não encontrado` }
        const devId = devR.rows[0].id
        const [evR, posR] = await Promise.all([
          pool.query(`SELECT type, servertime, attributes FROM tc_events WHERE deviceid = $1 AND servertime >= $2 ORDER BY servertime ASC LIMIT 20`, [devId, since]),
          pool.query(`SELECT fixtime, latitude, longitude, speed * 1.852 AS speed_kmh, attributes->>'alarm' AS alarm FROM tc_positions WHERE deviceid = $1 AND fixtime >= $2 ORDER BY fixtime ASC LIMIT 50`, [devId, since]),
        ])
        if (!evR.rows.length && !posR.rows.length) return { success: false, error: 'Nenhum evento neste período.' }
        const maxSpeed = posR.rows.length ? Math.max(...posR.rows.map(p => parseFloat(p.speed_kmh) || 0)) : 0
        const alarmEvents = evR.rows.filter(e => e.type === 'alarm')
        const firstEvent = evR.rows[0] || posR.rows[0]
        const eventHour = firstEvent ? new Date(firstEvent.servertime || firstEvent.fixtime).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '??:??'
        const firstPos = posR.rows[0]
        const city = firstPos ? `${parseFloat(firstPos.latitude).toFixed(3)}, ${parseFloat(firstPos.longitude).toFixed(3)}` : 'Portugal'
        const fmtInstr: Record<string, string> = {
          instagram_caption: 'Caption Instagram 150-300 chars + 10-15 hashtags. Tom visual e emocional.',
          tiktok_script: 'Script TikTok 30-60s. Hook (3s), acção, revelação, CTA. Indica cenas.',
          whatsapp_story: 'Story WhatsApp curta (máx 200 chars). Directa com CTA.',
          email: 'Email assunto + corpo 150-250 palavras. Profissional com CTA claro.',
          ad_copy: 'Anúncio: headline 30 chars + descrição 90 chars + CTA. Meta Ads.',
        }
        const toneInstr: Record<string, string> = { dramatic: 'Thriller. Tensão, alívio.', professional: 'Factual e confiante.', educational: '"Sabia que...?"', urgency: '"Se não tens..." medo da perda.' }
        const prompt = `Conteúdo de marketing para Rinosat (GPS motos Portugal).\nDADOS REAIS:\n- Dispositivo: ${devR.rows[0].name}\n- Hora: ${eventHour}\n- Velocidade máxima: ${Math.round(maxSpeed)} km/h\n- Alarmes: ${alarmEvents.length}\n- Localização: ${city}\n\nFORMATO: ${fmtInstr[format] || fmtInstr.instagram_caption}\nTOM: ${toneInstr[tone] || toneInstr.dramatic}\n\nUsa só os dados acima. Não inventes. Conteúdo pronto, sem introdução.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { device: devR.rows[0].name, format, tone, realFacts: { eventHour, maxSpeed_kmh: Math.round(maxSpeed), alarms: alarmEvents.length, location: city }, content: llm.content, note: 'Verificar antes de publicar.' } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M66 getLeadIntelligence ──
    if (toolName === 'getLeadIntelligence') {
      try {
        const classification = args.classification ? String(args.classification) : 'all'
        const hours = typeof args.hours === 'number' ? args.hours : 48
        const since = Date.now() - hours * 3600000
        const allKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } })
        const leads = allKeys
          .map(k => { try { return JSON.parse(k.value) } catch { return null } })
          .filter((l: any) => l && new Date(l.classifiedAt).getTime() > since)
          .filter((l: any) => classification === 'all' || l.classification === classification)
        const prio: Record<string, number> = { URGENTE: 0, QUENTE: 1, MORNO: 2, SUPORTE: 3, FRIO: 4 }
        leads.sort((a, b) => (prio[a.classification] ?? 5) - (prio[b.classification] ?? 5))
        return { success: true, data: { total: leads.length, urgente: leads.filter(l => l.classification === 'URGENTE').length, quente: leads.filter(l => l.classification === 'QUENTE').length, leads: leads.slice(0, 20) } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M67 generateCopy ──
    if (toolName === 'generateCopy') {
      try {
        const { callLLMAuto } = await import('./llm')
        const copyType = String(args.type)
        const context = args.context ? String(args.context) : ''
        const quantity = typeof args.quantity === 'number' ? args.quantity : 3
        let realData = ''
        if (args.useRecentEvents) {
          try {
            const pool = await getTraccarPool()
            const r = await pool.query(`SELECT COUNT(*) AS total_alarms FROM tc_events WHERE servertime > NOW() - INTERVAL '30 days' AND type = 'alarm'`)
            if (r.rows[0]) realData = `Dados reais 30d: ${r.rows[0].total_alarms} alertas processados.`
          } catch { /* ignore */ }
        }
        const typePrompts: Record<string, string> = {
          ad_headline: `${quantity} headlines Meta (máx 40 chars). Impactante, urgência ou prova social.`,
          ad_description: `${quantity} descrições Meta (máx 125 chars). Benefício + prova social + CTA.`,
          whatsapp_script: `${quantity} mensagens WhatsApp para prospects (máx 150 chars). Conversacional, pergunta no final.`,
          email_subject: `${quantity} assuntos email (máx 50 chars). Open rate alto.`,
          tiktok_hook: `${quantity} hooks TikTok (1 frase, 3 segundos). Para parar scroll.`,
          landing_hero: `${quantity} propostas hero landing (headline + subtítulo). Diferencial.`,
          objection_handler: `${quantity} respostas a objecções (preço alto, "já tenho alarme"). Empáticas mas persuasivas.`,
        }
        const prompt = `Empresa: Rinosat — GPS motos Portugal.\nDiferenciais: instalação 30 min, monitorização 24h, app, histórico, bloqueio remoto.\n${context ? `Contexto: ${context}` : ''}\n${realData}\n\n${typePrompts[copyType] || typePrompts.ad_headline}\n\nNumera cada variação. Sem explicações.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { type: copyType, quantity, copies: llm.content, realDataUsed: !!realData } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M68 getCompetitorIntelligence ──
    if (toolName === 'getCompetitorIntelligence') {
      try {
        const { getOrbitConfig } = await import('./orbitConfig')
        const { callLLMAuto } = await import('./llm')
        const digest = await getOrbitConfig('competitor_ads_digest')
        const date = await getOrbitConfig('competitor_ads_date')
        const count = await getOrbitConfig('competitor_ads_count')
        if (!digest) return { success: false, error: 'Nenhum scan ainda. Configura META_ADS_TOKEN e aguarda.' }
        const prompt = `Anúncios de concorrentes GPS motos Portugal:\n${digest}\nIdentifica: mensagens usadas, gaps da Rinosat, oportunidades de diferenciação. Português, máx 200 palavras.`
        const llm = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        return { success: true, data: { scanDate: date, adsFound: parseInt(count || '0'), rawDigest: digest, analysis: llm.content } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M69 saveHook / getHooks ──
    if (toolName === 'saveHook') {
      try {
        const hook = await prisma.marketingHook.create({
          data: { type: String(args.type), content: String(args.content), context: args.context ? String(args.context) : undefined, channel: args.channel ? String(args.channel) : undefined, performance: args.performance ? String(args.performance) : 'untested', notes: args.notes ? String(args.notes) : undefined, tags: args.tags ? String(args.tags) : undefined },
        })
        return { success: true, data: { id: hook.id, type: hook.type, saved: true } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }
    if (toolName === 'getHooks') {
      try {
        const type = args.type && args.type !== 'all' ? String(args.type) : undefined
        const channel = args.channel && args.channel !== 'all' ? String(args.channel) : undefined
        const performance = args.performance && args.performance !== 'all' ? String(args.performance) : undefined
        const search = args.search ? String(args.search) : undefined
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const hooks = await prisma.marketingHook.findMany({
          where: { ...(type ? { type } : {}), ...(channel ? { channel } : {}), ...(performance ? { performance } : {}), ...(search ? { OR: [{ content: { contains: search, mode: 'insensitive' } }, { tags: { contains: search, mode: 'insensitive' } }, { context: { contains: search, mode: 'insensitive' } }] } : {}) },
          orderBy: [{ performance: 'asc' }, { createdAt: 'desc' }], take: limit,
        })
        return { success: true, data: { total: hooks.length, hooks } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M70 sendLeadReactivation ──
    if (toolName === 'sendLeadReactivation') {
      try {
        const contact = String(args.contact)
        const msgIndex = typeof args.messageIndex === 'number' ? args.messageIndex : 0
        const sanitized = contact.replace(/[^a-zA-Z0-9]/g, '_')
        const allKeys = await prisma.systemConfig.findMany({ where: { key: { startsWith: `reactivation_${sanitized}` } }, orderBy: { updatedAt: 'desc' }, take: 1 })
        if (!allKeys.length) return { success: false, error: `Nenhuma sequência de reactivação para "${contact}"` }
        const data = JSON.parse(allKeys[0].value)
        const messages: string[] = data.messages || []
        if (msgIndex >= messages.length) return { success: false, error: `Sequência tem ${messages.length} mensagens (pediste ${msgIndex})` }
        try {
          const { sendViaWhatsAppWeb } = await import('./whatsappWeb')
          const sendResult = await sendViaWhatsAppWeb(contact, messages[msgIndex])
          if (!sendResult.ok) return { success: false, error: sendResult.error || 'Erro ao enviar' }
        } catch (e) {
          return { success: false, error: 'sendViaWhatsAppWeb não disponível' }
        }
        return { success: true, data: { contact, messageSent: messages[msgIndex], index: msgIndex } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }


    // ── M171 revenueAutopilot ──
    if (toolName === 'revenueAutopilot') {
      try {
        const { runRevenueAutopilot } = await import('./revenueIntelligence')
        const result_text = await runRevenueAutopilot()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M174 revenueForecast ──
    if (toolName === 'revenueForecast') {
      try {
        const { revenueForecast } = await import('./revenueIntelligence')
        const days = typeof args.days === 'number' ? args.days : 30
        const result_text = await revenueForecast(days)
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M175 funnelAnalysis ──
    if (toolName === 'funnelAnalysis') {
      try {
        const { funnelAnalysis } = await import('./revenueIntelligence')
        const result_text = await funnelAnalysis()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M180 growthSimulate ──
    if (toolName === 'growthSimulate') {
      try {
        const { growthSimulate } = await import('./revenueIntelligence')
        const result_text = await growthSimulate(Number(args.extraBudgetDay) || 10, String(args.campaign || 'campanha'))
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M185 ceoDecision ──
    if (toolName === 'ceoDecision') {
      try {
        const { ceoDecision } = await import('./revenueIntelligence')
        const result_text = await ceoDecision(args.question ? String(args.question) : undefined)
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M186 opportunityAlert ──
    if (toolName === 'opportunityAlert') {
      try {
        const { opportunityAlert } = await import('./revenueIntelligence')
        const result_text = await opportunityAlert()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M178 generateVideoScript ──
    if (toolName === 'generateVideoScript') {
      try {
        const { generateVideoScript } = await import('./scriptGenerator')
        const result_text = await generateVideoScript({
          audience: args.audience ? String(args.audience) : undefined,
          platform: args.platform ? String(args.platform) : undefined,
          duration: typeof args.duration === 'number' ? args.duration : 30,
          angle: args.angle ? String(args.angle) : undefined,
          context: args.context ? String(args.context) : undefined,
        })
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M181 generateAdaptiveCopy ──
    if (toolName === 'generateAdaptiveCopy') {
      try {
        const { generateAdaptiveCopy } = await import('./scriptGenerator')
        const result_text = await generateAdaptiveCopy({
          profile: String(args.profile || 'emocional'),
          format: String(args.format || 'whatsapp'),
          topic: String(args.topic || 'GPS para motos'),
        })
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M182 smartFollowup ──
    if (toolName === 'smartFollowup') {
      try {
        const { smartFollowup } = await import('./scriptGenerator')
        const result_text = await smartFollowup()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M179 marketReaction ──
    if (toolName === 'marketReaction') {
      try {
        const { marketReaction } = await import('./scriptGenerator')
        const result_text = await marketReaction()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }


    // ── M191 dailyOS ──
    if (toolName === 'dailyOS') {
      try {
        const { dailyOS } = await import('./dailyOS')
        const result_text = await dailyOS()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M198 quickSummary ──
    if (toolName === 'quickSummary') {
      try {
        const { quickSummary } = await import('./dailyOS')
        const result_text = await quickSummary()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M195 focusBlocks ──
    if (toolName === 'focusBlocks') {
      try {
        const { focusBlocks } = await import('./dailyOS')
        const result_text = await focusBlocks()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M199/207 dailyDecision ──
    if (toolName === 'dailyDecision') {
      try {
        const { dailyDecision } = await import('./dailyOS')
        const result_text = await dailyDecision(args.proposedAction ? String(args.proposedAction) : undefined)
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M205 dailyFollowups ──
    if (toolName === 'dailyFollowups') {
      try {
        const { dailyFollowups } = await import('./dailyOS')
        const result_text = await dailyFollowups()
        return { success: true, data: { result: result_text } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro' } }
    }

    // ── M72 getMetaCampaigns ──
    if (toolName === 'getMetaCampaigns') {
      try {
        const { getCampaigns, getAdSets, getAds, extractMetrics } = await import('./metaAds')
        const datePreset = args.datePreset ? String(args.datePreset) : 'last_7d'
        const level = args.level ? String(args.level) : 'campaigns'
        const parentId = args.parentId ? String(args.parentId) : undefined

        let raw: Awaited<ReturnType<typeof getCampaigns>>
        if (level === 'adsets') raw = await getAdSets(parentId, datePreset)
        else if (level === 'ads') raw = await getAds(parentId, datePreset)
        else raw = await getCampaigns(datePreset)

        const enriched = raw.map(c => ({
          id:        c.id,
          name:      c.name,
          status:    c.status,
          objective: c.objective,
          metrics:   extractMetrics(c.insights),
        })).sort((a, b) => parseFloat(b.metrics.spend_eur) - parseFloat(a.metrics.spend_eur))

        return { success: true, data: { datePreset, level, total: enriched.length, items: enriched } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro Meta Ads' } }
    }

    // ── M72 controlMetaCampaign ──
    if (toolName === 'controlMetaCampaign') {
      try {
        const { pauseCampaign, resumeCampaign, setCampaignBudget, pauseAd, resumeAd } = await import('./metaAds')
        const action = String(args.action || '')
        const id     = String(args.id || '')
        const target = args.target ? String(args.target) : 'campaign'
        if (!id) return { success: false, error: 'id obrigatório' }

        if (action === 'pause') {
          await (target === 'ad' ? pauseAd(id) : pauseCampaign(id))
          return { success: true, data: { action, id, target, result: 'pausado' } }
        }
        if (action === 'resume') {
          await (target === 'ad' ? resumeAd(id) : resumeCampaign(id))
          return { success: true, data: { action, id, target, result: 'activado' } }
        }
        if (action === 'set_budget') {
          if (target === 'ad') return { success: false, error: 'set_budget só para campaign' }
          const eur = typeof args.dailyBudgetEur === 'number' ? args.dailyBudgetEur : NaN
          if (!isFinite(eur) || eur <= 0) return { success: false, error: 'dailyBudgetEur > 0 obrigatório' }
          await setCampaignBudget(id, Math.round(eur * 100))
          return { success: true, data: { action, id, dailyBudget_eur: eur } }
        }
        return { success: false, error: `Acção desconhecida: ${action}` }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro Meta Ads' } }
    }

    // ── M73 analyzeInstagramComments ──
    if (toolName === 'analyzeInstagramComments') {
      try {
        const { getRecentMedia, getMediaComments } = await import('./instagramService')
        const { callLLMAuto } = await import('./llm')
        const mediaLimit = typeof args.mediaLimit === 'number' ? args.mediaLimit : 5
        const commentsPerPost = typeof args.commentsPerPost === 'number' ? args.commentsPerPost : 30

        const media = await getRecentMedia(mediaLimit)
        if (!media.length) return { success: true, data: { posts: [], summary: 'Sem posts recentes' } }

        const all: Array<{ post: string; permalink?: string; comments: Array<{ id: string; user: string; text: string }> }> = []
        for (const m of media) {
          if ((m.comments_count || 0) === 0) continue
          try {
            const comments = await getMediaComments(m.id, commentsPerPost)
            all.push({
              post: (m.caption || m.id).slice(0, 80),
              permalink: m.permalink,
              comments: comments.map(c => ({ id: c.id, user: c.username || '?', text: c.text })),
            })
          } catch { /* skip post */ }
        }
        if (!all.length) return { success: true, data: { posts: [], summary: 'Posts recentes sem comentários' } }

        const flat = all.flatMap(p => p.comments.map(c => `[${p.post.slice(0,40)}] ${c.user}: ${c.text}`)).slice(0, 80)
        const prompt = `Analisa estes comentários do Instagram da Rinosat (GPS para motos em Portugal) e classifica cada um em PERGUNTA, LEAD (interesse de compra), SUPORTE (cliente actual), ELOGIO ou SPAM. Para PERGUNTA e LEAD sugere uma resposta curta (máx 200 chars).

Comentários:
${flat.join('\n')}

Responde em JSON válido (sem markdown):
{"summary":"1 frase","items":[{"comment":"...","class":"PERGUNTA|LEAD|SUPORTE|ELOGIO|SPAM","reply":"..."}]}`

        const llmR = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
        const raw = (llmR.content || '').trim()
        const start = raw.indexOf('{')
        const end = raw.lastIndexOf('}')
        const parsed = (start !== -1 && end !== -1)
          ? (() => { try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null } })()
          : null

        return {
          success: true,
          data: {
            postsAnalyzed: all.length,
            commentsAnalyzed: flat.length,
            posts: all,
            analysis: parsed || { raw: llmR.content },
          },
        }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro Instagram' } }
    }

    // ── M73 getInstagramPerformance ──
    if (toolName === 'getInstagramPerformance') {
      try {
        const { getRecentMedia, getMediaInsights } = await import('./instagramService')
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const media = await getRecentMedia(limit)
        if (!media.length) return { success: true, data: { posts: [] } }

        const enriched: Array<Record<string, unknown>> = []
        for (const m of media) {
          let insights: Record<string, unknown> = {}
          try { insights = await getMediaInsights(m.id) } catch { /* skip */ }
          enriched.push({
            id: m.id,
            type: m.media_type,
            caption: (m.caption || '').slice(0, 120),
            permalink: m.permalink,
            timestamp: m.timestamp,
            likes: m.like_count,
            comments: m.comments_count,
            insights,
          })
        }
        return { success: true, data: { posts: enriched } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro Instagram' } }
    }

    // ── M74 getGoogleAdsPerformance ──
    if (toolName === 'getGoogleAdsPerformance') {
      try {
        const { getGoogleCampaigns, getKeywordPerformance } = await import('./googleAds')
        const view       = args.view ? String(args.view) : 'campaigns'
        const dateRange  = args.dateRange ? String(args.dateRange) : 'LAST_7_DAYS'
        const campaignId = args.campaignId ? String(args.campaignId) : undefined

        if (view === 'campaigns') {
          const campaigns = await getGoogleCampaigns(dateRange)
          return { success: true, data: { dateRange, campaigns } }
        }
        const keywords = await getKeywordPerformance(campaignId, dateRange)
        const wasteful = keywords.filter(k => k.flag.includes('🔴')).length
        return {
          success: true,
          data: {
            dateRange,
            totalKeywords:    keywords.length,
            wastefulKeywords: wasteful,
            keywords,
            recommendation:   wasteful > 0
              ? `${wasteful} keywords com gasto sem conversão — considerar pausa`
              : 'Keywords dentro do normal',
          },
        }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro Google Ads' } }
    }

    // ── M75 getTikTokPerformance ──
    if (toolName === 'getTikTokPerformance') {
      try {
        const { getTikTokCampaigns, getTikTokVideoMetrics } = await import('./tiktokService')
        const view = args.view ? String(args.view) : 'videos'
        const days = typeof args.days === 'number' ? args.days : 7
        const end = new Date()
        const start = new Date(Date.now() - days * 86400000)
        const fmt = (d: Date) => d.toISOString().slice(0, 10)

        if (view === 'campaigns') {
          const data = await getTikTokCampaigns(fmt(start), fmt(end))
          return { success: true, data: { days, campaigns: data } }
        }

        const videos = await getTikTokVideoMetrics(fmt(start), fmt(end))
        const enriched = videos.map(v => {
          const m = (v.metrics || {}) as Record<string, number | string>
          const dim = (v.dimensions || {}) as Record<string, string>
          const plays    = Number(m.video_play_actions) || 0
          const watch2s  = Number(m.video_watched_2s)   || 0
          const watch6s  = Number(m.video_watched_6s)   || 0
          const watch100 = Number(m.video_views_p100)   || 0
          const ratio2 = plays > 0 ? watch2s / plays : 0
          const ratioFull = plays > 0 ? watch100 / plays : 0
          let recommendation = ''
          if (plays > 30 && ratio2 < 0.4) recommendation = '⚠️ Hook fraco — < 40% assistem 2s'
          else if (ratioFull > 0.3) recommendation = '✅ Retenção excelente'
          return {
            ad_id:          dim.ad_id,
            ad_name:        m.ad_name,
            plays,
            retention_2s:   plays > 0 ? ((watch2s / plays) * 100).toFixed(0) + '%'  : 'N/A',
            retention_6s:   plays > 0 ? ((watch6s / plays) * 100).toFixed(0) + '%'  : 'N/A',
            retention_full: plays > 0 ? ((watch100 / plays) * 100).toFixed(0) + '%' : 'N/A',
            spend_eur:      Number(m.spend || 0).toFixed(2),
            clicks:         Number(m.clicks || 0),
            ctr:            String(m.ctr || ''),
            recommendation,
          }
        }).sort((a, b) => b.plays - a.plays)

        return { success: true, data: { days, videos: enriched } }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro TikTok' } }
    }

    // ── M76 getMarketingDashboard ──
    if (toolName === 'getMarketingDashboard') {
      try {
        const datePreset = args.datePreset ? String(args.datePreset) : 'last_7d'
        const dateRangeGoogle: Record<string, string> = {
          last_7d:    'LAST_7_DAYS',
          last_14d:   'LAST_14_DAYS',
          last_30d:   'LAST_30_DAYS',
          this_month: 'THIS_MONTH',
        }
        const days = datePreset === 'last_30d' ? 30 : datePreset === 'last_14d' ? 14 : 7

        const { extractMetrics, getCampaigns } = await import('./metaAds')
        const { getGoogleCampaigns } = await import('./googleAds')
        const { getTikTokCampaigns } = await import('./tiktokService')
        const { getRecentMedia, getMediaInsights } = await import('./instagramService')
        const { getOrbitConfig } = await import('./orbitConfig')

        const fmt = (d: Date) => d.toISOString().slice(0, 10)
        const tStart = new Date(Date.now() - days * 86400000)
        const tEnd = new Date()

        const [meta, google, tiktok, ig, leadKeys, competitorDigest] = await Promise.all([
          getCampaigns(datePreset).then(rs => rs.map(c => ({
            name: c.name, status: c.status, ...extractMetrics(c.insights),
          }))).catch(err => ({ error: err instanceof Error ? err.message : 'Erro Meta' })),
          getGoogleCampaigns(dateRangeGoogle[datePreset] || 'LAST_7_DAYS')
            .catch(err => ({ error: err instanceof Error ? err.message : 'Erro Google' })),
          getTikTokCampaigns(fmt(tStart), fmt(tEnd))
            .catch(err => ({ error: err instanceof Error ? err.message : 'Erro TikTok' })),
          (async () => {
            const media = await getRecentMedia(5).catch(() => [])
            const out: Array<Record<string, unknown>> = []
            for (const m of media) {
              let insights: Record<string, unknown> = {}
              try { insights = await getMediaInsights(m.id) } catch { /* skip */ }
              out.push({
                caption: (m.caption || '').slice(0, 80),
                likes: m.like_count, comments: m.comments_count,
                reach: insights.reach, engagement: insights.engagement,
              })
            }
            return out
          })().catch(() => []),
          prisma.systemConfig.findMany({ where: { key: { startsWith: 'lead_' } } }).catch(() => []),
          getOrbitConfig('competitor_ads_digest').catch(() => ''),
        ])

        // Sumarizar leads
        const leads: Record<string, number> = { URGENTE: 0, QUENTE: 0, MORNO: 0, FRIO: 0, SUPORTE: 0 }
        for (const k of leadKeys) {
          try {
            const v = JSON.parse(k.value) as { classification?: string }
            if (v.classification && leads[v.classification] !== undefined) leads[v.classification]++
          } catch { /* skip */ }
        }

        // Total spend agregado (best effort)
        let totalSpend = 0
        if (Array.isArray(meta)) totalSpend += meta.reduce((s, c) => s + parseFloat(c.spend_eur || '0'), 0)
        if (Array.isArray(google)) totalSpend += google.reduce((s, c) => s + parseFloat(c.cost_eur || '0'), 0)
        if (Array.isArray(tiktok)) totalSpend += tiktok.reduce((s, c) => {
          const m = (c.metrics || {}) as Record<string, number | string>
          return s + (Number(m.spend) || 0)
        }, 0)

        return {
          success: true,
          data: {
            period: datePreset,
            totalSpend_eur: totalSpend.toFixed(2),
            channels: {
              meta_ads: meta,
              google_ads: google,
              tiktok_ads: tiktok,
              instagram_organic: ig,
            },
            whatsapp_leads: leads,
            competitors: competitorDigest || 'sem dados (corre runCompetitorScan)',
          },
        }
      } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Erro dashboard' } }
    }

    if (toolName === 'selfEdit') {
      const { selfEditFile } = await import('./selfEdit')
      const { file, oldCode, newCode, reason } = args as { file: string; oldCode: string; newCode: string; reason: string }
      if (!file || !oldCode || !newCode) return { success: false, error: 'file, oldCode e newCode são obrigatórios' }
      return await selfEditFile(file, oldCode, newCode, reason || 'correcção de bug')
    }

    if (toolName === 'selfDebug') {
      const { selfEditFile } = await import('./selfEdit')
      const { errorDescription, file } = args as { errorDescription?: string; file?: string }
      // Read the file to inspect it
      if (file) {
        const fs = await import('fs')
        const path = await import('path')
        const absPath = path.default.join('/opt/ai-command-center', file)
        if (fs.default.existsSync(absPath)) {
          const content = fs.default.readFileSync(absPath, 'utf-8')
          return { success: true, data: { file, content: content.substring(0, 8000), message: `Ficheiro ${file} lido. Analisa e usa selfEdit para corrigir.` } }
        }
        return { success: false, error: `Ficheiro não encontrado: ${file}` }
      }
      return { success: false, error: 'Indica o ficheiro a analisar ou descreve melhor o erro.' }
    }

    if (toolName === 'readSourceFile') {
      const { file } = args as { file: string }
      const fs = await import('fs')
      const path = await import('path')
      const absPath = path.default.join('/opt/ai-command-center', file)
      if (!fs.default.existsSync(absPath)) return { success: false, error: `Ficheiro não encontrado: ${file}` }
      const content = fs.default.readFileSync(absPath, 'utf-8')
      return { success: true, data: { file, lines: content.split('\n').length, content: content.substring(0, 10000) } }
    }

    return null
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro na execução da tool JARVIS' }
  }
}
