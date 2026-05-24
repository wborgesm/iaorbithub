#!/usr/bin/env node
/**
 * Seed perfil pessoal e preferências do Wanderson (ChatGPT + Gemini).
 * Uso: node scripts/seed-orbit-profile.js
 */
require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const { appendMemoryEntry } = require('../dist/modules/agenticMemory')

const PROFILE_FACTS = [
  // Identidade
  { category: 'pessoal', fact: 'Nome: Wanderson. Dev full-stack: Next.js, React, TypeScript, Tailwind CSS' },
  { category: 'pessoal', fact: 'Vive em Portugal, região Lisboa/Odivelas' },
  { category: 'trabalho', fact: 'Fundador da Rinosat GPS e OrbitHub OS — rastreamento veicular e telemática' },

  // Preferências de comunicação (ChatGPT)
  { category: 'preferencia', fact: 'Prefere respostas directas, práticas e aplicáveis — soluções técnicas completas, não só teoria' },
  { category: 'preferencia', fact: 'Quer passo a passo, código completo, prompts completos, prontos a copiar e usar' },
  { category: 'preferencia', fact: 'Valoriza automação, integração e controlo próprio da infraestrutura' },
  { category: 'preferencia', fact: 'Prefere ferramentas self-hosted ou independentes quando possível' },
  { category: 'preferencia', fact: 'Gosta de prompts detalhados e estruturados para IA' },
  { category: 'preferencia', fact: 'Trabalha iterando rápido com IA + código' },
  { category: 'preferencia', fact: 'Quer que respostas considerem contexto anterior sem precisar repetir tudo' },
  { category: 'preferencia', fact: 'Evita dependência de serviços pagos desnecessários' },
  { category: 'preferencia', fact: 'Em produtos/sistemas busca: custo-benefício, escalabilidade, automação, robustez' },

  // UI
  { category: 'preferencia', fact: 'UI preferida: fundo escuro, contraste forte, vermelho/preto/branco, visual premium tech' },
  { category: 'preferencia', fact: 'Em projectos técnicos quer: lógica realista, foco UX, foco comercial, comportamento de produção real' },

  // Regras de código (Gemini)
  { category: 'preferencia', fact: 'Código: NUNCA alterar layout, refactorizar ou mudar nomes de variáveis sem permissão explícita' },
  { category: 'preferencia', fact: 'Código: foco estrito no erro ou função pedida — resto intacto' },
  { category: 'preferencia', fact: 'Código: se encontrar outros erros, perguntar primeiro se quer corrigir antes de alterar' },

  // Marca
  { category: 'trabalho', fact: 'Rinosat GPS: nunca mencionar publicamente que o sistema tem base em Traccar' },

  // Pessoal
  { category: 'pessoal', fact: 'Motos: Kawasaki Ninja 650 (modelo 2025), faz manutenção própria, usa óleo Motul 7100' },
  { category: 'pessoal', fact: 'Fotografia/vídeo: câmara Insta360 X3' },
  { category: 'pessoal', fact: 'Tem filho; parceria profissional ligada a oficina automóvel' },
  { category: 'pessoal', fact: 'Viagem planeada Madrid final maio 2026 — visita ao Parque Warner' },
]

async function main() {
  const prisma = new PrismaClient()
  const site = await prisma.aISite.findFirst({ where: { domain: 'orbit.internal' } })
  if (!site) {
    console.error('Site orbit.internal não encontrado')
    process.exit(1)
  }

  for (const { category, fact } of PROFILE_FACTS) {
    await appendMemoryEntry({
      type: 'preference',
      siteId: site.id,
      input: `[${category}] ${fact}`,
      output: '',
      metadata: { category, fact, source: 'seed-orbit-profile' },
    })
    console.log('✓', fact.slice(0, 70) + (fact.length > 70 ? '…' : ''))
  }

  await prisma.$disconnect()
  console.log(`\n${PROFILE_FACTS.length} factos de perfil guardados`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
