#!/usr/bin/env node
/**
 * Importa credenciais de ficheiro JSON descarregado do Google Cloud.
 * Uso: cat client_secret_*.json | node scripts/import-google-oauth-json.js
 */
const fs = require('fs')
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

async function main() {
  const raw = fs.readFileSync(0, 'utf8')
  const data = JSON.parse(raw)
  const web = data.web || data.installed
  if (!web?.client_id || !web?.client_secret) {
    console.error('JSON inválido: esperado web.client_id e web.client_secret')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  for (const [key, value] of [
    ['orbit.google_client_id', web.client_id],
    ['orbit.google_client_secret', web.client_secret],
  ]) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
    console.log('OK', key)
  }
  await prisma.$disconnect()
  console.log('\nPróximo: https://ia.orbithubos.pt/orbit → ⚙ → Ligar Google')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
