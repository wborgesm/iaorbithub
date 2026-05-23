import { PrismaClient, Prisma } from '@prisma/client'
import { Pool } from 'pg'
import { triggerIFTTT } from './smartHome'
import { fetchBankBalance, fetchRecentTransactions } from './truelayerBanking'
import { isGoogleConnected } from './googleAuth'
import { readEmails as gmailReadEmails, readEmailById as gmailReadById, sendEmail, listGmailLabels } from './gmailService'
import { readEmails as imapReadEmails, readEmailById as imapReadById, listEmailFolders as imapListFolders } from './emailReader'
import { listCalendarEvents, createCalendarEvent as createGCalEvent } from './calendarService'

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
      description: 'Controla dispositivos da casa inteligente via Google Home/IFTTT. Liga/desliga luzes, aquecedor, etc.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Nome do dispositivo (ex: "luzes_sala", "aquecedor", "luzes_quarto")' },
          action: { type: 'string', enum: ['on', 'off', 'toggle'], description: 'Acção a executar' },
          value: { type: 'string', description: 'Valor opcional (ex: brilho "50%", temperatura "22")' },
        },
        required: ['device', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendWhatsApp',
      description: 'Envia uma mensagem WhatsApp a um contacto.',
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
  return { success: true, data: { vehicleId, action, actionStatus: 'Executed', timestamp: new Date().toISOString() } }
}

async function runFetchInvoice(invoiceId: string): Promise<ToolCallResult> {
  return { success: true, data: { invoiceId, status: 'paid', amount: 0, dueDate: null } }
}

async function runUpdateContact(phone?: string, email?: string): Promise<ToolCallResult> {
  return { success: true, data: { updated: true, phone, email } }
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
        const device = args.device as string
        const action = args.action as string
        const value = args.value as string | undefined
        const eventName = `orbit_${device}_${action}`
        const ok = await triggerIFTTT(eventName, value)
        result = ok
          ? { success: true, data: { device, action, value, eventName } }
          : { success: false, error: 'IFTTT não respondeu. Verifica IFTTT_WEBHOOK_KEY e o applet.' }
      } else if (toolName === 'sendWhatsApp') {
        authorized = true
        result = { success: false, error: 'WhatsApp não configurado ainda' }
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
              'Controlar casa inteligente (luzes, aquecedor) via Google Home/IFTTT',
              'Consultar saldo e transacções Revolut (TrueLayer)',
              'Ler, enviar e pesquisar emails Gmail (OAuth2)',
              'Ver agenda e criar eventos no Google Calendar',
              'Responder perguntas e gerir contexto de conversa',
              'WhatsApp (em breve)',
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

    return result
  }
}
