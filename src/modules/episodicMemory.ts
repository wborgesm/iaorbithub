import { PrismaClient } from '@prisma/client'
import { saveMemoryVector } from './agenticMemory'

const prisma = new PrismaClient()
const ORBIT_DOMAIN = 'orbit.internal'

const TRIGGERS = [
  { pattern: /gostou de\s+(.{3,80})/i, label: 'gostou_de' },
  { pattern: /queria ganhar\s+(.{3,80})/i, label: 'queria_ganhar' },
  { pattern: /restaurante\s+(.{3,80})/i, label: 'restaurante' },
  { pattern: /adorei\s+(.{3,80})/i, label: 'adorei' },
  { pattern: /prefere\s+(.{3,80})/i, label: 'prefere' },
]

async function orbitSiteId(): Promise<string | null> {
  const site = await prisma.aISite.findFirst({ where: { domain: ORBIT_DOMAIN } })
  return site?.id ?? null
}

export async function extractPersonalPreferencesFromText(text: string, source?: string): Promise<string[]> {
  const extracted: string[] = []
  const siteId = await orbitSiteId()
  if (!siteId || !text?.trim()) return extracted

  for (const { pattern, label } of TRIGGERS) {
    const m = text.match(pattern)
    if (!m?.[1]) continue
    const entity = m[1].trim().replace(/[.!?]+$/, '')
    if (entity.length < 3) continue
    extracted.push(entity)
    await saveMemoryVector({
      siteId,
      type: 'preferência_pessoal',
      content: `${label}: ${entity}`,
      metadata: {
        category: 'preferência_pessoal',
        trigger: label,
        entity,
        source: source || null,
      },
    })
  }
  return extracted
}
