import nodemailer from 'nodemailer'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function getConfig(): Promise<Record<string, string>> {
  const configs = await prisma.systemConfig.findMany()
  return Object.fromEntries(configs.map(c => [c.key, c.value]))
}

export async function sendAlert(subject: string, body: string): Promise<void> {
  try {
    const cfg = await getConfig()
    if (!cfg['smtp.host'] || !cfg['smtp.user'] || !cfg['smtp.pass'] || !cfg['alerts.email']) return
    const transporter = nodemailer.createTransport({
      host: cfg['smtp.host'],
      port: parseInt(cfg['smtp.port'] || '587'),
      secure: cfg['smtp.port'] === '465',
      auth: { user: cfg['smtp.user'], pass: cfg['smtp.pass'] },
    })
    await transporter.sendMail({
      from: cfg['smtp.from'] || cfg['smtp.user'],
      to: cfg['alerts.email'],
      subject: `[AI Command Center] ${subject}`,
      text: body,
    })
    console.log(`[emailService] Alert sent: ${subject}`)
  } catch (err) {
    console.warn('[emailService] Failed to send alert:', err)
  }
}
