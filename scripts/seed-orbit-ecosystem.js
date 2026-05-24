#!/usr/bin/env node
/**
 * Seed factos do ecossistema de trabalho do Wanderson na memória ORBIT.
 * Uso: node scripts/seed-orbit-ecosystem.js
 */
require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const { appendMemoryEntry } = require('../dist/modules/agenticMemory')

const FACTS = [
  { category: 'trabalho', fact: 'O Wanderson gere a Rinosat GPS — site rinosat.com, app/servidor app.rinosat.com' },
  { category: 'trabalho', fact: 'Autotrack: site autotrack.pt, servidor/plataforma GPS gps.autotrack.pt' },
  { category: 'trabalho', fact: 'OrbitHub OS: site orbithubos.pt, aluguer em rent.orbithubos.pt' },
  { category: 'trabalho', fact: 'ORBIT (assistente IA pessoal) corre em ia.orbithubos.pt/orbit' },
  { category: 'trabalho', fact: 'Ecossistema de trabalho: Rinosat GPS, Autotrack, OrbitHub OS — rastreamento GPS e plataformas SaaS' },
  { category: 'pessoal', fact: 'Utilizador principal do ORBIT: Wanderson (wborges.mwork@gmail.com)' },
]

async function main() {
  const prisma = new PrismaClient()
  const site = await prisma.aISite.findFirst({ where: { domain: 'orbit.internal' } })
  if (!site) {
    console.error('Site orbit.internal não encontrado')
    process.exit(1)
  }

  for (const { category, fact } of FACTS) {
    await appendMemoryEntry({
      type: 'preference',
      siteId: site.id,
      input: `[${category}] ${fact}`,
      output: '',
      metadata: { category, fact, source: 'seed-orbit-ecosystem' },
    })
    console.log('✓', fact.slice(0, 60) + '…')
  }

  await prisma.$disconnect()
  console.log(`\n${FACTS.length} factos guardados para site ${site.id}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
