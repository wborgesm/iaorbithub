/**
 * Seed opcional — insere TrueLayer Client Secret na BD.
 * Uso: ORBIT_TRUELAYER_SECRET=xxx npx tsx scripts/seedOrbitConfig.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const secret = process.env.ORBIT_TRUELAYER_SECRET?.trim()
  if (!secret) {
    console.error('Define ORBIT_TRUELAYER_SECRET no ambiente antes de correr este script.')
    console.error('Alternativa: configura em /orbit → ⚙ → Banco → TrueLayer Client Secret')
    process.exit(1)
  }
  await prisma.systemConfig.upsert({
    where: { key: 'orbit.truelayer_secret' },
    update: { value: secret },
    create: { key: 'orbit.truelayer_secret', value: secret },
  })
  console.log('orbit.truelayer_secret guardado na BD.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
