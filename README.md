# AI Command Center

Backend centralizado de orquestração de LLMs para os produtos OrbitHub OS, Autotrack GPS e Rinosat GPS.

## Visão geral

O AI Command Center é um servidor Express que gere todas as conversas de IA de forma unificada. Em vez de cada produto ter a sua própria integração com LLMs, todos comunicam com este servidor que trata da sessão, histórico, knowledge base, ferramentas e logging.

```
OrbitHub OS ──┐
Autotrack GPS ─┼──► ia.orbithubos.pt ──► GROQ / Gemini / Claude / OpenAI / DeepSeek
Rinosat GPS  ──┘
```

## Stack

- **Runtime:** Node.js + TypeScript + Express 5
- **Base de dados:** PostgreSQL via Prisma ORM
- **Cache / Filas:** Redis + BullMQ
- **LLM providers:** GROQ, Gemini, Claude (Anthropic), OpenAI, DeepSeek
- **Deploy:** PM2 (id 9), porta 3002, proxy Apache → `ia.orbithubos.pt`

## Estrutura

```
src/
├── index.ts                  # Entry point, rotas montadas
├── routes/
│   ├── chat.ts               # POST /api/chat/send + /session + /session/domain
│   ├── adminApi.ts           # GET|POST|PUT|DELETE /api/admin/*
│   ├── simulation.ts         # Simulações de treino de agentes
│   └── evaluation.ts         # Worker de avaliação de simulações
├── services/
│   ├── llm.ts                # callLLM(provider, messages) — genérico
│   ├── providerConfig.ts     # Lê chaves API da BD (cache 30s)
│   ├── knowledge.ts          # Retrieval + saveKnowledge
│   ├── rateLimiter.ts        # Rate limit por sessão via Redis
│   └── toolExecution.ts      # Execução de ferramentas (Autotrack/Rinosat)
├── middleware/
│   └── adminAuth.ts          # Cookie auth para /admin e /api/admin
├── workers/
│   └── evaluationWorker.ts   # BullMQ worker — avalia simulações com IA
└── types/
    └── index.ts
prisma/
└── schema.prisma             # 11 modelos
public/
├── admin/index.html          # Painel de administração (SPA vanilla)
├── login.html
└── widget.js                 # Widget embebível nos sites clientes
```

## Modelos de dados

| Modelo | Descrição |
|---|---|
| `AISite` | Site cliente (domínio, agentType, provider, systemPrompt, ferramentas) |
| `ChatSession` | Sessão de conversa (siteId, visitorIp, userId) |
| `ChatMessage` | Mensagem individual (role USER/ASSISTANT) |
| `ProviderConfig` | Chave API + modelo + isEnabled por provider |
| `KnowledgeEntry` | Base de conhecimento (trigger → resposta aprovada) |
| `LLMCallLog` | Log de cada chamada LLM (tokens, latência, modelo) |
| `ToolExecutionLog` | Log de ferramentas executadas pelo agente |
| `TrainingScenario` | Cenário de treino para simulações |
| `UserSimulation` | Sessão de simulação de um agente humano |
| `SimulationMessage` | Mensagens de uma simulação |

## API pública

### Criar sessão
```http
POST /api/chat/session
{ "siteId": "uuid", "userId": "opcional" }
→ { "sessionId", "isActive", "agentType" }
```

### Criar sessão por domínio
```http
POST /api/chat/session/domain
{ "domain": "app.rinosat.com" }
→ { "sessionId", "siteId", "isActive", "agentType" }
```

### Enviar mensagem
```http
POST /api/chat/send
{ "sessionId": "uuid", "message": "texto" }
→ { "content": "resposta", "sessionId", "agentType", "offline": false }
```

Quando o site está desativado no admin, devolve `"offline": true` e `"content": null`.

## Providers LLM

Os providers são configurados na base de dados (`ProviderConfig`) pelo painel admin. Não há chaves API no `.env`.

| Provider | Modelo padrão |
|---|---|
| GROQ | llama-3.3-70b-versatile |
| GEMINI | gemini-2.0-flash |
| CLAUDE | claude-3-5-haiku-20241022 |
| OPENAI | gpt-4o-mini |
| DEEPSEEK | deepseek-chat |

Cada site pode ter um `activeProvider` e um `fallbackProvider`. Se o primário falhar (ex: quota), o fallback é chamado automaticamente.

## Painel Admin

Disponível em `ia.orbithubos.pt/admin` (protegido por cookie).

Secções:
- **Dashboard** — métricas gerais (sessões, mensagens, tokens, simulações)
- **Sites** — gerir sites clientes, ativar/desativar em tempo real
- **Providers IA** — configurar chaves e modelos, botão "Testar" por provider
- **Conhecimento** — rever, aprovar e editar respostas aprendidas pela IA
- **Conversas** — historial de sessões com transcrição completa
- **Analytics** — mensagens por dia (últimos 30 dias) + perguntas mais frequentes
- **Logs LLM** — histórico de chamadas com tokens, latência e modelo
- **Cenários de Treino** — criar cenários para simulação de agentes
- **Simulações** — ver resultados e scores de simulações
- **Testar Chat** — testar qualquer site diretamente no admin

## Aprendizagem automática

Quando o agente responde a uma mensagem com mais de 60 caracteres, a resposta é guardada como `KnowledgeEntry` com status `PENDING`. O admin revê e aprova no painel. Após aprovação, a resposta é usada diretamente (sem chamar a IA) para perguntas semelhantes.

## Configuração

```env
DATABASE_URL="postgresql://..."
REDIS_URL="redis://localhost:6379"
PORT=3002
INTERNAL_API_SECRET="segredo_para_api_interna"
```

## Desenvolvimento

```bash
npm install
npx prisma generate
npm run dev
```

## Build e deploy

```bash
npm run build
sudo pm2 restart 9
```

---

**AI:** Claude (Anthropic)
