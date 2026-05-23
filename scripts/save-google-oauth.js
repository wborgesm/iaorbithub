#!/usr/bin/env node
/**
 * Guarda Client ID e Secret do Google OAuth na BD ORBIT.
 * Uso: node scripts/save-google-oauth.js CLIENT_ID CLIENT_SECRET
 */
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const [clientId, clientSecret] = process.argv.slice(2)
if (!clientId || !clientSecret) {
  console.error('Uso: node scripts/save-google-oauth.js CLIENT_ID CLIENT_SECRET')
  process.exit(1)
}

const prisma = new PrismaClient()
async function main() {
  for (const [key, value] of [
    ['orbit.google_client_id', clientId],
    ['orbit.google_client_secret', clientSecret],
  ]) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
    console.log('OK', key)
  }
  console.log('\nPróximo passo: https://ia.orbithubos.pt/orbit → ⚙ → Ligar Google')
}

main().finally(() => prisma.$disconnect())
