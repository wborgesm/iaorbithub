import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PLAIN_TEXT_KEYS = new Set([
  'orbit.google_project_id',
  'orbit.google_client_id',
  'orbit.gmail_user',
  'orbit.whatsapp_api_url',
])

export function normalizeOrbitKey(key: string): string {
  const k = key.trim()
  if (k.startsWith('orbit.')) return k
  return `orbit.${k}`
}

export function maskOrbitConfigValue(fullKey: string, value: string): string {
  if (!value) return ''
  if (PLAIN_TEXT_KEYS.has(fullKey) || fullKey.endsWith('.google_project_id')) return value
  if (value.length > 8) return '••••••••' + value.slice(-4)
  return '••••'
}

export async function getOrbitConfig(shortKey: string): Promise<string> {
  const fullKey = normalizeOrbitKey(shortKey)
  const suffix = shortKey.replace(/^orbit\./, '')
  const envSuffix = suffix.toUpperCase().replace(/\./g, '_')
  const row = await prisma.systemConfig.findUnique({ where: { key: fullKey } })
  return (
    row?.value ||
    process.env[`ORBIT_${envSuffix}`] ||
    process.env[envSuffix] ||
    ''
  )
}

export async function setOrbitConfig(shortKey: string, value: string): Promise<void> {
  const fullKey = normalizeOrbitKey(shortKey)
  await prisma.systemConfig.upsert({
    where: { key: fullKey },
    update: { value },
    create: { key: fullKey, value },
  })
}

export async function deleteOrbitConfig(shortKey: string): Promise<void> {
  const fullKey = normalizeOrbitKey(shortKey)
  await prisma.systemConfig.delete({ where: { key: fullKey } }).catch(() => {})
}

export async function listOrbitConfigs(): Promise<Array<{ key: string; value: string; hasValue: boolean; updatedAt: Date }>> {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: 'orbit.' } },
    orderBy: { key: 'asc' },
  })
  return rows.map(r => ({
    key: r.key,
    value: maskOrbitConfigValue(r.key, r.value),
    hasValue: r.value.length > 0,
    updatedAt: r.updatedAt,
  }))
}
