import fs from 'fs'
import path from 'path'
import { Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'
import { getOrbitConfig } from '../services/orbitConfig'

const prisma = new PrismaClient()
const LOG_FILE = path.join(process.cwd(), 'data', 'admin-access.log')

function clientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string') return xf.split(',')[0].trim()
  return req.ip || req.socket.remoteAddress || 'unknown'
}

async function defaultWhitelist(): Promise<Set<string>> {
  const raw = await getOrbitConfig('admin_ip_whitelist')
  const ips = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
  if (ips.length === 0) {
  return new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
  }
  return new Set(ips)
}

function logAccess(ip: string, urlPath: string, blocked: boolean): void {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    const line = `${new Date().toISOString()}\t${ip}\t${blocked ? 'BLOCKED' : 'OK'}\t${urlPath}\n`
    fs.appendFileSync(LOG_FILE, line, 'utf8')
  } catch { /* ignore */ }
}

export async function adminIpWhitelist(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = clientIp(req)
  const whitelist = await defaultWhitelist()
  const allowed = whitelist.has(ip) || whitelist.has(ip.replace('::ffff:', ''))

  // Sessão autenticada válida bypassa IP restriction — permite acesso de qualquer lugar
  const sessionCookie = (req.cookies?.orbit_session || req.cookies?.adminToken || '').trim()
  if (!allowed && sessionCookie) {
    logAccess(ip, req.originalUrl, false)
    next()
    return
  }

  logAccess(ip, req.originalUrl, !allowed)
  if (!allowed) {
    res.status(403).json({ error: 'IP não autorizado. Faz login via IP autorizado primeiro.' })
    return
  }
  next()
}

export async function registrarAuditoriaAcesso(req: Request): Promise<void> {
  const ip = clientIp(req)
  const key = `admin_audit_${new Date().toISOString().slice(0, 10)}`
  const prev = await getOrbitConfig(key)
  const entries = prev ? JSON.parse(prev) as string[] : []
  entries.push(`${new Date().toISOString()}|${ip}|${req.method}|${req.path}`)
  await prisma.systemConfig.upsert({
    where: { key: `orbit.${key}` },
    update: { value: JSON.stringify(entries.slice(-500)) },
    create: { key: `orbit.${key}`, value: JSON.stringify(entries.slice(-500)) },
  })
}

export async function verificarAuditoriaAcessos(days = 7): Promise<Array<{ ip: string; count: number }>> {
  const counts = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `admin_audit_${d.toISOString().slice(0, 10)}`
    const raw = await getOrbitConfig(key)
    if (!raw) continue
    try {
      const entries = JSON.parse(raw) as string[]
      for (const e of entries) {
        const ip = e.split('|')[1]
        if (ip) counts.set(ip, (counts.get(ip) || 0) + 1)
      }
    } catch { /* ignore */ }
  }
  return [...counts.entries()].map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count)
}
