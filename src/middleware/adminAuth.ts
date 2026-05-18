import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

export function generateToken(secret: string): string {
  const payload = `admin:${Date.now()}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${Buffer.from(payload).toString('base64')}.${sig}`
}

export function verifyToken(token: string, secret: string): boolean {
  try {
    const [payloadB64, sig] = token.split('.')
    if (!payloadB64 || !sig) return false
    const payload = Buffer.from(payloadB64, 'base64').toString()
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as Request & { cookies: Record<string, string> }).cookies?.admin_token
  const secret = process.env.INTERNAL_API_SECRET || ''
  if (!token || !verifyToken(token, secret)) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Não autenticado' })
    }
    return res.redirect('/login')
  }
  next()
}
