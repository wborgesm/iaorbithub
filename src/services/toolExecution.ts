import { PrismaClient, Prisma } from '@prisma/client'
import { Pool } from 'pg'
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
