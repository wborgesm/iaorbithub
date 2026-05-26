import { PrismaClient, Prisma } from '@prisma/client'
import { Pool } from 'pg'
import { triggerIFTTT } from './smartHome'
import {
  isHomeAssistantConfigured,
  controlHomeAssistantEntity,
  listControllableDevices,
  getEntityState,
} from './homeAssistant'
import { fetchBankBalance, fetchRecentTransactions } from './truelayerBanking'
import { isGoogleConnected } from './googleAuth'
import { readEmails as gmailReadEmails, readEmailById as gmailReadById, sendEmail, listGmailLabels } from './gmailService'
import { readEmails as imapReadEmails, readEmailById as imapReadById, listEmailFolders as imapListFolders } from './emailReader'
import { listCalendarEvents, createCalendarEvent as createGCalEvent } from './calendarService'
import { appendMemoryEntry, listFacts, saveFact, resolveContactPhone } from '../modules/agenticMemory'
import { cleanGpsHistoryManual } from '../workers/garbageCollector'
import { execOnVps, getVpsServers } from './vpsManager'
import { JARVIS_TOOL_DEFINITIONS, executeJarvisTool } from './jarvisTools'

async function gmailViaApi(): Promise<boolean> {
  try {
    return await isGoogleConnected()
  } catch {
    return false
  }
}
import type { SessionContext, ToolCallResult } from '../types'

const prisma = new PrismaClient()

const autotrackDb = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'executeVehicleAction',
      description: 'Block or unblock a vehicle engine. Requires owner or admin rights and an active plan with engine cut enabled.',
      parameters: {
        type: 'object',
        properties: {
          vehicleId: { type: 'number', description: 'Traccar device ID' },
          action: { type: 'string', enum: ['BLOCK', 'UNBLOCK'], description: 'Action to perform' },
        },
        required: ['vehicleId', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetchBillingInvoice',
      description: 'Fetch a billing invoice for the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'Invoice ID' },
        },
        required: ['invoiceId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateClientContact',
      description: 'Update client contact information (phone and/or email).',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'controlSmartHome',
      description: 'Controla dispositivos da casa via Home Assistant (preferido) ou IFTTT. Usa entity_id (ex: light.sala) ou nome amigável.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'entity_id HA (light.sala) ou nome do dispositivo' },
          entity_id: { type: 'string', description: 'Alternativa: entity_id directo do Home Assistant' },
          action: { type: 'string', enum: ['on', 'off', 'toggle'], description: 'Acção a executar' },
          value: { type: 'string', description: 'Valor opcional (ex: brilho 50%, temperatura 22)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listHomeDevices',
      description: 'Lista dispositivos da casa no Home Assistant (luzes, switches, clima, etc.)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getHomeDeviceState',
      description: 'Estado actual de um dispositivo Home Assistant',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'entity_id (ex: light.sala)' },
        },
        required: ['entity_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendWhatsApp',
      description: 'Envia WhatsApp pela conta PESSOAL do Wanderson (ORBIT). Nunca usar WhatsApp empresarial OrbitHub/Autotrack/Rinosat.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Número de telefone com código de país (ex: +351912345678)' },
          message: { type: 'string', description: 'Mensagem a enviar' },
        },
        required: ['to', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readWhatsAppMessages',
      description: 'Lê as últimas mensagens recebidas/enviadas no WhatsApp pessoal do Wanderson.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Número de mensagens a devolver (default 5, max 10).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createCalendarEvent',
      description: 'Cria um evento no calendário Google de Wanderson.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título do evento' },
          date: { type: 'string', description: 'Data e hora ISO 8601 (ex: 2026-05-23T15:00:00)' },
          duration: { type: 'number', description: 'Duração em minutos (default 60)' },
          description: { type: 'string', description: 'Descrição opcional' },
        },
        required: ['title', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listOrbitCapabilities',
      description: 'Lista o que o ORBIT pode fazer para ajudar Wanderson no trabalho e na vida.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getBankBalance',
      description: 'Consulta o saldo actual da conta Revolut de Wanderson.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getRecentTransactions',
      description: 'Lista as transacções recentes da conta Revolut de Wanderson.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Número de dias a consultar (default: 30)' },
          limit: { type: 'number', description: 'Máximo de transacções a devolver (default: 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readEmails',
      description: 'Lê os emails de Wanderson. Pode filtrar por não lidos, pasta, ou termo de pesquisa.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Pasta a ler (default: INBOX). Exemplos: INBOX, Sent, Spam' },
          limit: { type: 'number', description: 'Quantos emails mostrar (default: 10, máx: 20)' },
          onlyUnread: { type: 'boolean', description: 'true para mostrar apenas emails não lidos' },
          search: { type: 'string', description: 'Filtrar por remetente ou assunto' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readEmailContent',
      description: 'Lê o conteúdo completo de um email específico pelo seu ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do email (obtido com readEmails)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listEmailFolders',
      description: 'Lista todas as pastas/etiquetas do email de Wanderson.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendEmail',
      description: 'Envia um email pelo Gmail do utilizador',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Endereço de email destinatário' },
          subject: { type: 'string', description: 'Assunto do email' },
          body: { type: 'string', description: 'Corpo do email em texto simples' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listCalendarEvents',
      description: 'Lista os próximos eventos do Google Calendar do utilizador',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Número de dias a frente (default 7)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cleanGpsHistory',
      description: 'Limpeza manual de dados históricos GPS (Traccar). Apaga registos RECENTES no período indicado. targets: logs (tc_events), positions (tc_positions), telemetry (tc_statistics). Ex: últimos 3 dias de logs.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['logs', 'positions', 'telemetry', 'all'],
            description: 'logs=eventos GPS; positions=posições; telemetry=estatísticas; all=todos',
          },
          days: { type: 'number', description: 'Apagar registos dos últimos N dias (ex: 3)' },
          sinceDate: { type: 'string', description: 'Alternativa: apagar desde YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMyLocation',
      description: 'Obtém a posição GPS mais recente do dispositivo Traccar de Wanderson e converte em morada.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createTask',
      description: 'Cria uma nova tarefa pessoal do Wanderson com prioridade e prazo opcionais.',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title:       { type: 'string', description: 'Título breve da tarefa' },
          description: { type: 'string', description: 'Detalhes adicionais da tarefa' },
          priority:    { type: 'string', enum: ['URGENTE', 'IMPORTANTE', 'NORMAL', 'BAIXA'], description: 'Prioridade da tarefa' },
          deadline:    { type: 'string', description: 'Data prazo em formato ISO 8601 (ex: 2026-06-01T18:00:00)' },
          project:     { type: 'string', description: 'Nome do projecto ou área (opcional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listTasks',
      description: 'Lista as tarefas pessoais do Wanderson, com filtros opcionais.',
      parameters: {
        type: 'object',
        properties: {
          status:   { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'], description: 'Filtrar por estado (omitir = PENDING + IN_PROGRESS)' },
          priority: { type: 'string', enum: ['URGENTE', 'IMPORTANTE', 'NORMAL', 'BAIXA'], description: 'Filtrar por prioridade' },
          limit:    { type: 'number', description: 'Máximo de tarefas a retornar (default 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateTaskStatus',
      description: 'Actualiza o estado de uma tarefa (completar, cancelar, iniciar).',
      parameters: {
        type: 'object',
        required: ['id', 'status'],
        properties: {
          id:     { type: 'string', description: 'ID da tarefa a actualizar' },
          status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteTask',
      description: 'Apaga uma tarefa permanentemente.',
      parameters: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'ID da tarefa a apagar' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'saveContact',
      description: 'Guarda ou actualiza informação sobre uma pessoa no contexto do Wanderson.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name:       { type: 'string', description: 'Nome da pessoa' },
          relation:   { type: 'string', description: 'Relação: colega, cliente, amigo, família, fornecedor, parceiro' },
          phone:      { type: 'string' },
          email:      { type: 'string' },
          company:    { type: 'string' },
          notes:      { type: 'string', description: 'Notas gerais sobre a pessoa' },
          context:    { type: 'string', description: 'Última conversa ou o que ficou em aberto' },
          followUpAt: { type: 'string', description: 'Data de follow-up em ISO 8601' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getContacts',
      description: 'Lista contactos guardados, com pesquisa opcional por nome ou empresa.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Texto a pesquisar no nome ou empresa' },
          withFollowUp: { type: 'boolean', description: 'true = só os que têm follow-up pendente' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getContactBriefing',
      description: 'Devolve briefing completo de um contacto: histórico, notas, pendentes.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Nome (ou parte do nome) do contacto' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'logExpense',
      description: 'Regista uma despesa pessoal ou de negócio do Wanderson.',
      parameters: {
        type: 'object',
        required: ['amount', 'description'],
        properties: {
          amount:      { type: 'number', description: 'Valor em euros' },
          description: { type: 'string', description: 'Descrição da despesa' },
          category:    { type: 'string', enum: ['Alimentação', 'Transportes', 'Casa', 'Saúde', 'Lazer', 'Negócio', 'Outros'] },
          date:        { type: 'string', description: 'Data em ISO 8601 (omitir = agora)' },
          method:      { type: 'string', enum: ['Multibanco', 'MB WAY', 'Dinheiro', 'Crédito'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getExpenseSummary',
      description: 'Resume despesas por categoria para o período pedido.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['semana', 'mes', '30dias'], description: 'Período do resumo (default: semana)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'logHealth',
      description: 'Regista dados de saúde e bem-estar do Wanderson (sono, energia, treino).',
      parameters: {
        type: 'object',
        properties: {
          sleepHours:   { type: 'number', description: 'Horas de sono' },
          sleepQuality: { type: 'number', description: 'Qualidade de sono 1-10' },
          energy:       { type: 'number', description: 'Nível de energia 1-10' },
          mood:         { type: 'number', description: 'Humor 1-10' },
          exercise:     { type: 'string', description: 'Tipo e duração do exercício feito' },
          notes:        { type: 'string', description: 'Outras notas de saúde/bem-estar' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getHealthSummary',
      description: 'Resume dados de saúde dos últimos N dias para identificar padrões.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Número de dias a analisar (default: 7)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listCameras',
      description: 'Lista as câmaras disponíveis no Home Assistant.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCameraSnapshot',
      description: 'Obtém a URL de snapshot de uma câmara do Home Assistant para análise visual.',
      parameters: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', description: 'Entity ID da câmara (ex: camera.entrada, camera.garagem)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listXiaomiCameras',
      description: 'Lista as câmaras Xiaomi configuradas e o seu estado de acessibilidade.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getXiaomiSnapshot',
      description: 'Obtém snapshot de uma câmara Xiaomi (tenta RTSP primeiro, depois HA).',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Nome da câmara (ex: Entrada, Garagem)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFitnessData',
      description: 'Obtém dados de saúde do Google Fit (Apple Watch sincroniza via iPhone): passos, sono e batimento cardíaco.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['steps', 'sleep', 'heart_rate', 'all'], description: 'Tipo de dados (default: all)' },
          days: { type: 'number', description: 'Dias a analisar (default: 7)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rememberFact',
      description: 'Guarda facto, compromisso ou preferência do Wanderson. Usa dueDate para viagens/prazos (YYYY-MM-DD). Usa factType trip para viagens.',
      parameters: {
        type: 'object',
        properties: {
          fact: { type: 'string', description: 'Facto conciso e específico.' },
          category: {
            type: 'string',
            enum: ['preferencia', 'trabalho', 'pessoal', 'rotina', 'financeiro', 'saude', 'viagem', 'outro'],
            description: 'Categoria',
          },
          dueDate: { type: 'string', description: 'Data limite ou evento (YYYY-MM-DD). Opcional.' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Prioridade. Default medium.' },
          factType: {
            type: 'string',
            enum: ['preference', 'commitment', 'idea', 'trip', 'contact', 'maintenance'],
            description: 'trip = viagem; maintenance = equipamento físico',
          },
          asset: { type: 'string', description: 'Equipamento (ex: Ninja 650)' },
          last_metric: { type: 'number', description: 'Valor actual (ex: km)' },
          threshold: { type: 'number', description: 'Limite para alerta (ex: km troca óleo)' },
          metric_unit: { type: 'string', description: 'Unidade (default km)' },
          phone: { type: 'string', description: 'Número de telefone do contacto (ex: +351912345678). Só para factType=contact.' },
        },
        required: ['fact', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listFacts',
      description: 'Lista factos e preferências pessoais guardados sobre o utilizador.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vpsCommand',
      description: 'Executa um comando SSH numa VPS gerida pelo ORBIT. Usa para verificar CPU, RAM, disco, estado de serviços, logs em tempo real. Prefere comandos não interactivos e seguros.',
      parameters: {
        type: 'object',
        required: ['serverId', 'command'],
        properties: {
          serverId: { type: 'string', description: 'ID da VPS (ex: "autotrack-vps", "llama-vps"). Usa listVpsServers para ver os IDs disponíveis.' },
          command: { type: 'string', description: 'Comando shell a executar. Ex: "df -h", "free -h", "systemctl status nginx", "journalctl -u ai-command-center -n 20 --no-pager"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listVpsServers',
      description: 'Lista todas as VPS configuradas e acessíveis pelo ORBIT via SSH.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

async function authorizeVehicleAction(userId: string, vehicleId: number): Promise<boolean> {
  try {
    const { rows } = await autotrackDb.query(
      `SELECT d.id FROM tc_devices d
       JOIN tc_user_device ud ON ud.deviceid = d.id
       LEFT JOIN subscription_plan sp ON sp.id = d.plan_id
       WHERE d.id = $1
         AND ud.userid = $2
         AND COALESCE(sp.allow_engine_cut, false) = true`,
      [vehicleId, userId],
    )
    return rows.length > 0
  } catch {
    return false
  }
}

async function authorizeInvoiceAccess(userId: string, invoiceId: string): Promise<boolean> {
  try {
    const { rows } = await autotrackDb.query(
      `SELECT id FROM invoices WHERE id = $1 AND user_id = $2`,
      [invoiceId, userId],
    )
    return rows.length > 0
  } catch {
    return false
  }
}

async function runVehicleAction(vehicleId: number, action: string): Promise<ToolCallResult> {
  return { success: false, error: `Acção "${action}" no veículo ${vehicleId} não está disponível neste contexto.` }
}

async function runFetchInvoice(invoiceId: string): Promise<ToolCallResult> {
  return { success: false, error: `Consulta de factura não disponível. ID: ${invoiceId}` }
}

async function runUpdateContact(phone?: string, email?: string): Promise<ToolCallResult> {
  return { success: false, error: `Para guardar contactos usa rememberFact com factType=contact.` }
}


// Resolve datas em português ("hoje", "amanhã") para Date objects
function resolvePortugueseDate(dateStr: string, timeStr?: string): Date {
  const now = new Date()
  const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const normalized = (dateStr || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  let base: Date
  if (normalized === 'hoje' || normalized === 'today') {
    base = new Date(todayBase)
  } else if (normalized === 'amanha' || normalized === 'tomorrow' || normalized === 'proximo dia') {
    base = new Date(todayBase)
    base.setDate(base.getDate() + 1)
  } else if (normalized === 'depois de amanha' || normalized === 'depois amanha') {
    base = new Date(todayBase)
    base.setDate(base.getDate() + 2)
  } else {
    const parsed = new Date(dateStr)
    base = isNaN(parsed.getTime()) ? new Date(todayBase) : parsed
  }
  if (timeStr) {
    const clean = timeStr.replace(/[^0-9:]/g, '')
    const parts = clean.split(':')
    const h = parseInt(parts[0] || '0', 10)
    const m = parseInt(parts[1] || '0', 10)
    if (!isNaN(h)) { base.setHours(h, m || 0, 0, 0) }
  }
  return base
}

// Anexar tools dos módulos 18-71 (JARVIS extras)
;(TOOL_DEFINITIONS as Array<typeof TOOL_DEFINITIONS[number]>).push(...(JARVIS_TOOL_DEFINITIONS as unknown as Array<typeof TOOL_DEFINITIONS[number]>))

export class ToolExecutionService {
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: SessionContext,
    chatMessageId: string,
  ): Promise<ToolCallResult> {
    let authorized = false
    let result: ToolCallResult = { success: false, error: 'Unknown tool' }

    try {
      if (toolName === 'executeVehicleAction') {
        const vehicleId = args.vehicleId as number
        const action = args.action as string
        authorized = !!ctx.userId && await authorizeVehicleAction(ctx.userId, vehicleId)
        result = authorized ? await runVehicleAction(vehicleId, action) : { success: false, error: 'Operation unauthorized for this user context.' }
      } else if (toolName === 'fetchBillingInvoice') {
        const invoiceId = args.invoiceId as string
        authorized = !!ctx.userId && await authorizeInvoiceAccess(ctx.userId, invoiceId)
        result = authorized ? await runFetchInvoice(invoiceId) : { success: false, error: 'Operation unauthorized for this user context.' }
      } else if (toolName === 'updateClientContact') {
        authorized = !!ctx.userId
        result = authorized ? await runUpdateContact(args.phone as string, args.email as string) : { success: false, error: 'Operation unauthorized for this user context.' }
      } else if (toolName === 'controlSmartHome') {
        authorized = true
        const action = args.action as 'on' | 'off' | 'toggle'
        const value = args.value as string | undefined
        const target = (args.entity_id as string) || (args.device as string) || ''
        if (!target) {
          result = { success: false, error: 'Indica device ou entity_id' }
        } else if (await isHomeAssistantConfigured()) {
          const ha = await controlHomeAssistantEntity(target, action, value)
          result = ha.ok
            ? { success: true, data: { device: target, entity_id: ha.entity_id, action, via: 'home_assistant' } }
            : { success: false, error: ha.error || 'Falha Home Assistant' }
        } else {
          const device = (args.device as string) || target.replace(/\./g, '_')
          const eventName = `orbit_${device}_${action}`
          const ok = await triggerIFTTT(eventName, value)
          result = ok
            ? { success: true, data: { device, action, value, eventName, via: 'ifttt' } }
            : { success: false, error: 'Configure Home Assistant (URL+token) ou IFTTT webhook key' }
        }
      } else if (toolName === 'listHomeDevices') {
        authorized = true
        if (!(await isHomeAssistantConfigured())) {
          result = { success: false, error: 'Home Assistant não configurado' }
        } else {
          const devices = await listControllableDevices()
          result = { success: true, data: { devices } }
        }
      } else if (toolName === 'getHomeDeviceState') {
        authorized = true
        const entityId = args.entity_id as string
        if (!(await isHomeAssistantConfigured())) {
          result = { success: false, error: 'Home Assistant não configurado' }
        } else {
          const state = await getEntityState(entityId)
          result = state
            ? { success: true, data: state }
            : { success: false, error: 'Entidade não encontrada' }
        }
      } else if (toolName === 'sendWhatsApp') {
        authorized = true
        const rawTo = String(args.to || '').trim()
        const msg = String(args.message || '')
        const digits = rawTo.replace(/\D/g, '')
        const isPhone = digits.length >= 7

        if (!isPhone) {
          // É um nome — tentar enviar directo pelo chat (evita bug "No LID for user")
          const { sendViaWhatsAppByName } = await import('./whatsappWeb')
          const byName = await sendViaWhatsAppByName(rawTo, msg)
          if (byName.ok) {
            result = { success: true, data: { message: `WhatsApp enviado para ${rawTo} (${byName.phone || rawTo})` } }
          } else {
            // Fallback: tentar resolver telefone em MemoryVector
            const resolved = ctx.siteId ? await resolveContactPhone(ctx.siteId, rawTo) : null
            if (resolved) {
              const { sendWhatsAppMessage } = await import('./whatsappService')
              const wa = await sendWhatsAppMessage(resolved, msg)
              result = wa.ok
                ? { success: true, data: { message: `WhatsApp enviado para ${rawTo} (${resolved})` } }
                : { success: false, error: wa.error }
            } else {
              result = {
                success: false,
                error: byName.error || `Não encontrei "${rawTo}" nas conversas do WhatsApp. Qual é o número de telefone?`,
              }
            }
          }
        } else {
          const { sendWhatsAppMessage } = await import('./whatsappService')
          const wa = await sendWhatsAppMessage(rawTo, msg)
          result = wa.ok
            ? { success: true, data: { message: `WhatsApp enviado para ${rawTo}` } }
            : { success: false, error: wa.error }
        }
      } else if (toolName === 'readWhatsAppMessages') {
        authorized = true
        const limit = typeof args.limit === 'number' ? Math.min(args.limit, 10) : 5
        const { getRecentWhatsAppMessages } = await import('./whatsappWeb')
        const res = await getRecentWhatsAppMessages(limit)
        result = res.ok
          ? { success: true, data: { messages: res.messages } }
          : { success: false, error: res.error }
      } else if (toolName === 'createCalendarEvent') {
        authorized = true
        try {
          const title = args.title as string
          let start: string
          let end: string
          if (typeof args.start === 'string' && typeof args.end === 'string') {
            start = args.start
            end = args.end
          } else {
            const rawDate = (args.date as string) || ''
            const rawTime = (args.startTime as string) || (args.time as string) || ''
            const rawEndTime = (args.endTime as string) || ''
            const duration = typeof args.duration === 'number' ? args.duration : 60
            const startDate = resolvePortugueseDate(rawDate, rawTime)
            const endDate = rawEndTime
              ? resolvePortugueseDate(rawDate, rawEndTime)
              : new Date(startDate.getTime() + duration * 60000)
            start = startDate.toISOString()
            end = endDate.toISOString()
          }
          const eventId = await createGCalEvent({
            title,
            start,
            end,
            description: typeof args.description === 'string' ? args.description : undefined,
            location: typeof args.location === 'string' ? args.location : undefined,
          })
          result = { success: true, data: { eventId, message: `Evento criado com ID: ${eventId}` } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao criar evento' }
        }
      } else if (toolName === 'listCalendarEvents') {
        authorized = true
        try {
          const days = typeof args.days === 'number' ? args.days : 7
          const events = await listCalendarEvents(days)
          result = { success: true, data: { events } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao ler calendário' }
        }
      } else if (toolName === 'listOrbitCapabilities') {
        authorized = true
        result = {
          success: true,
          data: {
            capabilities: [
              'Controlar casa via Home Assistant ou IFTTT (listHomeDevices, getHomeDeviceState)',
              'Consultar saldo e transacções Revolut (TrueLayer)',
              'Ler, enviar e pesquisar emails Gmail (OAuth2)',
              'Ver agenda e criar eventos no Google Calendar',
              'Responder perguntas e gerir contexto de conversa',
              'WhatsApp pessoal do Wanderson (Web + QR — separado do sistema OrbitHub)',
              'Integração com AI Command Center e sites OrbitHub',
            ],
          },
        }
      } else if (toolName === 'getBankBalance') {
        authorized = true
        try {
          const balance = await fetchBankBalance()
          result = { success: true, data: balance }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao consultar saldo' }
        }
      } else if (toolName === 'getRecentTransactions') {
        authorized = true
        try {
          const days = typeof args.days === 'number' ? args.days : 30
          const limit = typeof args.limit === 'number' ? args.limit : 20
          const items = await fetchRecentTransactions(days, limit)
          result = { success: true, data: { items } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao consultar transacções' }
        }
      } else if (toolName === 'readEmails') {
        authorized = true
        try {
          const opts = {
            folder: typeof args.folder === 'string' ? args.folder : undefined,
            limit: typeof args.limit === 'number' ? args.limit : undefined,
            onlyUnread: typeof args.onlyUnread === 'boolean' ? args.onlyUnread : undefined,
            search: typeof args.search === 'string' ? args.search : undefined,
          }
          const items = (await gmailViaApi())
            ? await gmailReadEmails(opts)
            : await imapReadEmails(opts)
          result = { success: true, data: { items } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao ler emails' }
        }
      } else if (toolName === 'readEmailContent') {
        authorized = true
        try {
          const id = args.id as string
          const email = (await gmailViaApi()) ? await gmailReadById(id) : await imapReadById(id)
          result = email
            ? { success: true, data: email }
            : { success: false, error: 'Email não encontrado' }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao ler email' }
        }
      } else if (toolName === 'listEmailFolders') {
        authorized = true
        try {
          const folders = (await gmailViaApi()) ? await listGmailLabels() : await imapListFolders()
          result = { success: true, data: { folders } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao listar pastas' }
        }
      } else if (toolName === 'sendEmail') {
        authorized = true
        try {
          if (!(await gmailViaApi())) {
            result = { success: false, error: 'Enviar email requer Ligar Google (OAuth). App Password só permite ler.' }
          } else {
            const to = args.to as string
            const subject = args.subject as string
            const body = args.body as string
            await sendEmail(to, subject, body)
            result = { success: true, data: { message: `Email enviado para ${to}` } }
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao enviar email' }
        }
      } else if (toolName === 'getMyLocation') {
        try {
          const { Pool } = await import('pg')
          const pool = new Pool({ connectionString: process.env.AUTOTRACK_DATABASE_URL })
          const r = await pool.query(`SELECT d.name, p.latitude, p.longitude, p.fixtime, p.speed FROM tc_devices d JOIN tc_positions p ON p.id = d.positionid ORDER BY p.fixtime DESC LIMIT 1`)
          await pool.end()
          if (!r.rows.length) {
            result = { success: false, error: 'Sem dados GPS' }
          } else {
            const row = r.rows[0]
            const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${row.latitude}&lon=${row.longitude}&format=json`, { headers: { 'User-Agent': 'OrbitAI/1.0' } })
            const geoData: any = await geo.json()
            const address = geoData.display_name ?? `${row.latitude}, ${row.longitude}`
            result = { success: true, data: { device: row.name, address, lat: row.latitude, lng: row.longitude, speed: row.speed, fixtime: row.fixtime } }
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro GPS' }
        }
      } else if (toolName === 'createTask') {
        authorized = true
        try {
          const task = await prisma.orbitTask.create({
            data: {
              title:       String(args.title),
              description: args.description ? String(args.description) : undefined,
              priority:    args.priority    ? String(args.priority)    : 'NORMAL',
              project:     args.project     ? String(args.project)     : undefined,
              deadline:    args.deadline    ? new Date(String(args.deadline)) : undefined,
            },
          })
          result = { success: true, data: { id: task.id, title: task.title, priority: task.priority, deadline: task.deadline } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao criar tarefa' }
        }
      } else if (toolName === 'listTasks') {
        authorized = true
        try {
          const statusFilter = args.status ? String(args.status) : undefined
          const priorityFilter = args.priority ? String(args.priority) : undefined
          const limit = typeof args.limit === 'number' ? args.limit : 20
          const tasks = await prisma.orbitTask.findMany({
            where: {
              status:   statusFilter  ? { equals: statusFilter }  : { in: ['PENDING', 'IN_PROGRESS'] },
              priority: priorityFilter ? { equals: priorityFilter } : undefined,
            },
            orderBy: [
              { priority: 'asc' },
              { deadline: 'asc' },
              { createdAt: 'desc' },
            ],
            take: limit,
          })
          result = { success: true, data: tasks }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao listar tarefas' }
        }
      } else if (toolName === 'updateTaskStatus') {
        authorized = true
        try {
          const updated = await prisma.orbitTask.update({
            where: { id: String(args.id) },
            data:  {
              status:      String(args.status),
              completedAt: args.status === 'DONE' ? new Date() : undefined,
            },
          })
          result = { success: true, data: { id: updated.id, status: updated.status } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Tarefa não encontrada' }
        }
      } else if (toolName === 'deleteTask') {
        authorized = true
        try {
          await prisma.orbitTask.delete({ where: { id: String(args.id) } })
          result = { success: true, data: { deleted: true } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Tarefa não encontrada' }
        }
      } else if (toolName === 'saveContact') {
        authorized = true
        try {
          const name = String(args.name)
          const existing = await prisma.orbitContact.findFirst({ where: { name: { contains: name, mode: 'insensitive' } } })
          const data = {
            name,
            relation:   args.relation   ? String(args.relation)   : undefined,
            phone:      args.phone      ? String(args.phone)      : undefined,
            email:      args.email      ? String(args.email)      : undefined,
            company:    args.company    ? String(args.company)    : undefined,
            notes:      args.notes      ? String(args.notes)      : undefined,
            context:    args.context    ? String(args.context)    : undefined,
            lastContact: new Date(),
            followUpAt: args.followUpAt ? new Date(String(args.followUpAt)) : undefined,
          }
          const contact = existing
            ? await prisma.orbitContact.update({ where: { id: existing.id }, data })
            : await prisma.orbitContact.create({ data })
          result = { success: true, data: { id: contact.id, name: contact.name, action: existing ? 'updated' : 'created' } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao guardar contacto' }
        }
      } else if (toolName === 'getContacts') {
        authorized = true
        try {
          const search = args.search ? String(args.search) : undefined
          const withFollowUp = args.withFollowUp === true
          const contacts = await prisma.orbitContact.findMany({
            where: {
              ...(search ? { OR: [
                { name:    { contains: search, mode: 'insensitive' as const } },
                { company: { contains: search, mode: 'insensitive' as const } },
              ]} : {}),
              ...(withFollowUp ? { followUpAt: { lte: new Date() } } : {}),
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
          })
          result = { success: true, data: contacts }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao listar contactos' }
        }
      } else if (toolName === 'getContactBriefing') {
        authorized = true
        try {
          const name = String(args.name)
          const contact = await prisma.orbitContact.findFirst({
            where: { name: { contains: name, mode: 'insensitive' } },
          })
          if (!contact) {
            result = { success: false, error: `Contacto "${name}" não encontrado` }
          } else {
            result = { success: true, data: contact }
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao obter briefing' }
        }
      } else if (toolName === 'logExpense') {
        authorized = true
        try {
          const expense = await prisma.orbitExpense.create({
            data: {
              amount:      Number(args.amount),
              description: String(args.description),
              category:    args.category ? String(args.category) : 'Outros',
              method:      args.method   ? String(args.method)   : undefined,
              date:        args.date     ? new Date(String(args.date)) : new Date(),
            },
          })
          result = { success: true, data: { id: expense.id, amount: expense.amount, category: expense.category } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao registar despesa' }
        }
      } else if (toolName === 'getExpenseSummary') {
        authorized = true
        try {
          const period = args.period ? String(args.period) : 'semana'
          const days = period === 'mes' || period === '30dias' ? 30 : 7
          const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          const expenses = await prisma.orbitExpense.findMany({ where: { date: { gte: since } } })
          const byCategory: Record<string, number> = {}
          let total = 0
          for (const e of expenses) {
            byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
            total += e.amount
          }
          result = { success: true, data: { period, totalDays: days, total: Math.round(total * 100) / 100, byCategory, count: expenses.length } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao obter resumo' }
        }
      } else if (toolName === 'logHealth') {
        authorized = true
        try {
          const log = await prisma.orbitHealthLog.create({
            data: {
              sleepHours:   args.sleepHours   !== undefined ? Number(args.sleepHours)   : undefined,
              sleepQuality: args.sleepQuality !== undefined ? Number(args.sleepQuality) : undefined,
              energy:       args.energy       !== undefined ? Number(args.energy)       : undefined,
              mood:         args.mood         !== undefined ? Number(args.mood)         : undefined,
              exercise:     args.exercise     ? String(args.exercise) : undefined,
              notes:        args.notes        ? String(args.notes)    : undefined,
            },
          })
          result = { success: true, data: { id: log.id, date: log.date } }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao registar saúde' }
        }
      } else if (toolName === 'getHealthSummary') {
        authorized = true
        try {
          const days = typeof args.days === 'number' ? args.days : 7
          const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          const logs = await prisma.orbitHealthLog.findMany({ where: { date: { gte: since } }, orderBy: { date: 'desc' } })
          if (!logs.length) {
            result = { success: true, data: { days, message: 'Sem dados de saúde registados neste período.' } }
          } else {
            const avg = (arr: (number | null)[]) => {
              const vals = arr.filter(v => v !== null) as number[]
              return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
            }
            result = { success: true, data: {
              days,
              entries: logs.length,
              avgSleepHours:   avg(logs.map(l => l.sleepHours)),
              avgSleepQuality: avg(logs.map(l => l.sleepQuality)),
              avgEnergy:       avg(logs.map(l => l.energy)),
              avgMood:         avg(logs.map(l => l.mood)),
              recentLogs:      logs.slice(0, 3),
            }}
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao obter resumo de saúde' }
        }
      } else if (toolName === 'listCameras') {
        authorized = true
        try {
          const states = await (await import('./homeAssistant')).getHomeAssistantStates('')
          const cameras = states.filter(s => s.entity_id.startsWith('camera.'))
          result = {
            success: true,
            data: cameras.map(c => ({
              entityId:    c.entity_id,
              name:        (c.attributes?.friendly_name as string) || c.entity_id,
              state:       c.state,
              snapshotUrl: `/api/orbit/camera-snapshot?entityId=${c.entity_id}`,
            })),
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao listar câmaras' }
        }
      } else if (toolName === 'getCameraSnapshot') {
        authorized = true
        try {
          const entityId = String(args.entityId)
          const { getHomeAssistantAccessToken } = await import('./homeAssistantAuth')
          const cfg = await getHomeAssistantAccessToken()
          if (!cfg) {
            result = { success: false, error: 'Home Assistant não configurado' }
          } else {
            const directUrl = `${cfg.baseUrl}/api/camera_proxy/${entityId}`
            const snapshotUrl = `/api/orbit/camera-snapshot?entityId=${entityId}`
            result = {
              success: true,
              data: {
                entityId,
                snapshotUrl,
                directUrl,
                note: 'Snapshot disponível. Se o modelo suportar visão (Gemini), pode analisar a imagem directamente.',
              },
            }
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao obter câmara' }
        }
      } else if (toolName === 'listXiaomiCameras') {
        authorized = true
        try {
          const { getXiaomiCameras } = await import('./xiaomiCameraService')
          const cameras = getXiaomiCameras()
          if (!cameras.length) {
            result = { success: false, error: 'Nenhuma câmara Xiaomi configurada. Adicionar XIAOMI_CAMERAS no .env' }
          } else {
            result = { success: true, data: cameras.map(c => ({
              name:    c.name,
              hasRtsp: !!c.rtsp,
              hasHA:   !!c.haEntity,
            }))}
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro' }
        }
      } else if (toolName === 'getXiaomiSnapshot') {
        authorized = true
        try {
          const { getXiaomiCameras, snapshotViaRtsp, snapshotViaHA } = await import('./xiaomiCameraService')
          const cameras = getXiaomiCameras()
          const name = String(args.name)
          const cam = cameras.find(c => c.name.toLowerCase().includes(name.toLowerCase()))
          if (!cam) {
            result = { success: false, error: `Câmara "${name}" não encontrada. Disponíveis: ${cameras.map(c => c.name).join(', ')}` }
          } else {
            let buf: Buffer | null = null
            let source = ''

            if (cam.rtsp) {
              buf = await snapshotViaRtsp(cam.rtsp)
              if (buf) source = 'rtsp'
            }

            if (!buf && cam.haEntity) {
              const { getHomeAssistantAccessToken } = await import('./homeAssistantAuth')
              const cfg = await getHomeAssistantAccessToken()
              if (cfg) {
                buf = await snapshotViaHA(cam.haEntity, cfg.baseUrl, cfg.token)
                if (buf) source = 'homeassistant'
              }
            }

            if (!buf) {
              result = { success: false, error: `Não foi possível obter snapshot da câmara "${cam.name}". Verificar RTSP ou ligação HA.` }
            } else {
              const fsMod = await import('fs')
              const tmpName = `xiaomi_${Date.now()}.jpg`
              const tmpDir  = '/opt/ai-command-center/public/tmp'
              fsMod.mkdirSync(tmpDir, { recursive: true })
              const tmpPath = `${tmpDir}/${tmpName}`
              fsMod.writeFileSync(tmpPath, buf)
              setTimeout(() => { try { fsMod.unlinkSync(tmpPath) } catch { /* ignore */ } }, 60000)
              result = { success: true, data: {
                camera:      cam.name,
                source,
                snapshotUrl: `/tmp/${tmpName}`,
                size:        buf.length,
                note:        'Snapshot disponível por 60 segundos. Se usares Gemini como provider, podes pedir para analisar a imagem.',
              }}
            }
          }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao obter snapshot' }
        }
      } else if (toolName === 'getFitnessData') {
        authorized = true
        try {
          const { getFitSteps, getFitSleep, getFitHeartRate } = await import('./fitService')
          const type = args.type ? String(args.type) : 'all'
          const days = typeof args.days === 'number' ? args.days : 7
          const data: Record<string, unknown> = { days }
          if (type === 'steps' || type === 'all') data.steps = await getFitSteps(days)
          if (type === 'sleep' || type === 'all') data.sleep = await getFitSleep(days)
          if (type === 'heart_rate' || type === 'all') data.heartRate = await getFitHeartRate(days)
          result = { success: true, data }
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Erro ao obter dados Fit' }
        }
      } else if (toolName === 'rememberFact') {
        authorized = true
        const fact = args.fact as string
        const category = (args.category as string) || 'outro'
        const dueDate = typeof args.dueDate === 'string' ? args.dueDate.trim() : undefined
        const priority = typeof args.priority === 'string' ? args.priority : 'medium'
        const factType = typeof args.factType === 'string' ? args.factType : category === 'viagem' ? 'trip' : 'preference'
        const asset = typeof args.asset === 'string' ? args.asset : undefined
        const last_metric = typeof args.last_metric === 'number' ? args.last_metric : undefined
        const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
        const metric_unit = typeof args.metric_unit === 'string' ? args.metric_unit : 'km'
        const phone = typeof args.phone === 'string' ? args.phone.trim() : undefined
        const siteId = ctx.siteId
        if (!siteId) {
          result = { success: false, error: 'siteId em falta no contexto' }
        } else {
          try {
            await saveFact({ siteId, sessionId: ctx.sessionId, fact, category, dueDate, priority, factType, asset, last_metric, threshold, metric_unit, phone })
            await appendMemoryEntry({
              type: 'preference',
              sessionId: ctx.sessionId,
              siteId,
              input: `[${category}] ${fact}`,
              output: '',
              metadata: { category, fact, dueDate, priority, factType, phone },
            })
            const extra = dueDate ? ` (prazo: ${dueDate})` : ''
            result = { success: true, data: { message: `Guardei: "${fact}"${extra}` } }
          } catch (e) {
            result = { success: false, error: e instanceof Error ? e.message : 'Erro ao guardar' }
          }
        }
      } else if (toolName === 'listFacts') {
        authorized = true
        const siteId = ctx.siteId
        const facts = siteId ? await listFacts(siteId, 30) : []
        result = { success: true, data: { facts } }
      } else if (toolName === 'vpsCommand') {
        const serverId = String(args.serverId || '')
        const command = String(args.command || '')
        if (!serverId || !command) return { success: false, error: 'serverId e command são obrigatórios.' }
        // Bloqueia comandos destrutivos directamente
        const blocked = /rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot|init\s+0|halt/.test(command)
        if (blocked) return { success: false, error: 'Comando não permitido por segurança. Pede confirmação ao utilizador primeiro.' }
        try {
          const result = await execOnVps(serverId, command)
          const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
          const codeInfo = result.code !== 0 ? " (exit code " + result.code + ")" : ""
          return { success: result.code === 0, data: (output || "(sem output)") + codeInfo }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : 'Erro SSH' }
        }
      } else if (toolName === 'listVpsServers') {
        try {
          const servers = await getVpsServers()
          if (!servers.length) return { success: true, data: 'Nenhuma VPS configurada ainda. Adiciona na admin panel → VPS.' }
          const list = servers.map(s => `• ${s.id} — ${s.name} (${s.user}@${s.host}:${s.port})${s.description ? ': ' + s.description : ''}`).join('\n')
          return { success: true, data: list }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar VPS' }
        }
      } else if (toolName === 'cleanGpsHistory') {
        authorized = true
        const target = typeof args.target === 'string' ? args.target as 'logs' | 'positions' | 'telemetry' | 'all' : 'logs'
        const days = typeof args.days === 'number' ? args.days : undefined
        const sinceDate = typeof args.sinceDate === 'string' ? args.sinceDate : undefined
        const out = await cleanGpsHistoryManual({ target, days, sinceDate })
        if (out.error) {
          result = { success: false, error: out.error }
        } else {
          result = {
            success: true,
            data: {
              message: `Limpeza GPS concluída: ${JSON.stringify(out.deleted)}`,
              deleted: out.deleted,
            },
          }
        }
      } else {
        // Fallback para ferramentas JARVIS (módulos 18-71)
        const jarvisResult = await executeJarvisTool(toolName, args, ctx)
        if (jarvisResult !== null) {
          authorized = true
          result = jarvisResult
        }
      }
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : 'Tool execution error' }
    }

    await prisma.toolExecutionLog.create({
      data: {
        chatMessageId,
        toolName,
        arguments: args as Prisma.InputJsonValue,
        authorized,
        result: result as unknown as Prisma.InputJsonValue,
        errorMessage: result.success ? null : result.error,
      },
    })

    // Black Box (M28): audit log paralelo (não interrompe se falhar)
    try {
      await prisma.orbitAuditLog.create({
        data: {
          source: 'tool',
          action: toolName,
          detail: result.success
            ? JSON.stringify(result.data ?? null).slice(0, 500)
            : (result.error ?? '').slice(0, 200),
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          metadata: { args: JSON.stringify(args).slice(0, 300), success: result.success } as any,
        },
      })
    } catch { /* audit nunca interrompe */ }

    return result
  }
}
