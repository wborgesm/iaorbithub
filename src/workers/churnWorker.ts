import { PrismaClient } from '@prisma/client'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'

const prisma = new PrismaClient()
const CHURN_DAYS = 15
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface ChurnRiskAccount {
  id: string
  email?: string
  name?: string
  lastLogin: string
  daysInactive: number
  source: string
}

export async function analisarChurn(): Promise<ChurnRiskAccount[]> {
  const risco: ChurnRiskAccount[] = []
  const cutoff = new Date(Date.now() - CHURN_DAYS * 86400000)

  const admins = await prisma.adminUser.findMany({ where: { isActive: true } })
  for (const u of admins) {
    const last = u.lastLogin || u.createdAt
    if (last < cutoff) {
      risco.push({
        id: u.id,
        email: u.email,
        name: u.name,
        lastLogin: last.toISOString(),
        daysInactive: Math.floor((Date.now() - last.getTime()) / 86400000),
        source: 'AdminUser',
      })
    }
  }

  const autotrackUrl = process.env.AUTOTRACK_DATABASE_URL
  if (autotrackUrl) {
    try {
      const { Client } = await import('pg')
      const client = new Client({ connectionString: autotrackUrl })
      await client.connect()
      const { rows } = await client.query(
        'SELECT id::text, email, last_login FROM users WHERE last_login IS NOT NULL AND last_login < $1 LIMIT 500',
        [cutoff],
      )
      await client.end()
      for (const r of rows as Array<{ id: string; email: string; last_login: Date }>) {
        risco.push({
          id: r.id,
          email: r.email,
          lastLogin: r.last_login.toISOString(),
          daysInactive: Math.floor((Date.now() - r.last_login.getTime()) / 86400000),
          source: 'autotrack_users',
        })
      }
    } catch { /* tabela externa indisponível */ }
  }

  await setOrbitConfig('churn_risco', JSON.stringify(risco))
  return risco
}

export function startChurnAnalysisWorker(): void {
  void analisarChurn()
  setInterval(() => { void analisarChurn() }, WEEK_MS)
  console.log('[churnWorker] Activo — semanal, last_login >15 dias')
}
