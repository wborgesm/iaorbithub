# AI Command Center — Contexto do Projecto

Backend centralizado de IA para OrbitHub OS, Autotrack GPS e Rinosat GPS.
URL de produção: `ia.orbithubos.pt` | Porta: 3002 | Systemd: `ai-command-center`

## Stack

- Node.js + TypeScript + Express 5
- PostgreSQL (Prisma ORM) + pgvector
- Redis + BullMQ
- 8 providers LLM: GROQ, Gemini, Claude, OpenAI, DeepSeek, OpenRouter, Cohere, HuggingFace
- Deploy: `npx tsc && systemctl restart ai-command-center`

## Sites geridos

| Domínio | Produto |
|---|---|
| `app.orbithubos.pt` | OrbitHub OS (gestão de frotas) |
| `gps.autotrack.pt` | Autotrack GPS (admin) |
| `autotrack.pt` | Autotrack (marketing) |
| `app.rinosat.com` | Rinosat (orbitrent frontend) |
| `rinosat.com` | Rinosat (marketing) |
| `orbithubos.pt` | OrbitHub (marketing) |

## Arquitectura de Módulos Agentic

```
chat.ts (orquestrador)
  ├── reactLoop.ts         → raciocínio interno antes de responder
  ├── agenticMemory.ts     → JSONL + pgvector (salva e busca memórias)
  ├── sessionSummary.ts    → resumo episódico de sessões
  ├── frustrationDetector.ts → score de frustração por sessão
  ├── humanApproval.ts     → kill switch (aprovação antes de ferramentas)
  └── toolExecution.ts     → executa ferramentas autorizadas
```

## Toggles por site (no painel admin)

- `enableReact` — activa raciocínio Chain-of-Thought + injecção de memória
- `enableHumanApproval` — activa kill switch para aprovação de ferramentas

## Providers — multi-chave

Cada provider suporta 3 chaves API com rotação automática em rate limit.
Cooldown de 60s por chave. `callLLMAuto()` percorre providers por prioridade.

## Comandos úteis

```bash
# Ver logs em tempo real
journalctl -u ai-command-center -f

# Deploy
cd /opt/ai-command-center && npx tsc && systemctl restart ai-command-center

# Crawler manual de sites
npx tsx src/scripts/crawlSites.ts

# Estado dos providers
curl -s -k -b cookies.txt https://ia.orbithubos.pt/api/admin/providers/status

# Aprovar uma acção pendente
curl -s -k -b cookies.txt -X POST https://ia.orbithubos.pt/api/admin/approvals/ID/approve
```

## Regras de desenvolvimento

- **NUNCA** alterar lógica existente — só adicionar
- **NUNCA** renomear variáveis existentes
- Sempre ler o ficheiro completo antes de editar
- Um commit por feature, mensagem clara em português
- `npx tsc --noEmit` deve passar antes de cada commit

## Fases do projecto Agentic AI

- ✅ Fase 1: Kill Switch + ReAct + Memória base
- ✅ Fase 2: pgvector + viewer admin + busca textual
- 🔄 Fase 3: Embeddings reais + memória episódica + detector de frustração
- ⏳ Fase 4: Multi-agente + acções agendadas + notificações proactivas

## Ficheiros de tarefa

- `PHASE3_TASKS.md` — tarefas detalhadas para o Cursor executar (Fase 3)
- `PHASE2.md` — o que foi feito na Fase 2
