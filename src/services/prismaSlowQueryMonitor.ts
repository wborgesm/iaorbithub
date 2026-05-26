import { PrismaClient } from '@prisma/client'

const SLOW_MS = 2000

export function attachPrismaSlowQueryMonitor(prisma: PrismaClient): PrismaClient {
  const extended = prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = Date.now()
          const result = await query(args)
          const elapsed = Date.now() - start
          if (elapsed > SLOW_MS) {
            console.warn(
              `[prismaSlowQuery] ${String(model)}.${String(operation)} ${elapsed}ms — considerar indexação`,
              JSON.stringify(args ?? {}).slice(0, 300),
            )
          }
          return result
        },
      },
    },
  })
  return extended as unknown as PrismaClient
}
