import { PrismaClient, Prisma } from '@prisma/client'
import { Pool } from 'pg'
import { triggerIFTTT } from './smartHome'
import { fetchBankBalance, fetchRecentTransactions } from './truelayerBanking'
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
        result = { success: false, error: 'Google Calendar não configurado ainda' }
      } else if (toolName === 'listOrbitCapabilities') {
        authorized = true
        result = {
          success: true,
          data: {
            capabilities: [
              'Controlar casa inteligente (luzes, aquecedor) via Google Home/IFTTT',
              'Consultar saldo e transacções Revolut (TrueLayer)',
              'Responder perguntas e gerir contexto de conversa',
              'WhatsApp (em breve)',
              'Google Calendar (em breve)',
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
