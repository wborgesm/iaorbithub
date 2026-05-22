# AI Command Center

Backend centralizado de orquestração de LLMs para os produtos OrbitHub OS, Autotrack GPS e Rinosat GPS.

## Visão geral

O AI Command Center é um servidor Express que gere todas as conversas de IA de forma unificada. Em vez de cada produto ter a sua própria integração com LLMs, todos comunicam com este servidor que trata da sessão, histórico, knowledge base, ferramentas, auto-treino e logging.

```
OrbitHub OS (app.orbithubos.pt) ──┐
Autotrack GPS (gps.autotrack.pt) ─┼──► ia.orbithubos.pt ──► GROQ / Gemini / Cohere / ...
Rinosat GPS   (app.rinosat.com)  ──┘
```

---

## Stack

- **Runtime:** Node.js + TypeScript + Express 5
- **Base de dados:** PostgreSQL via Prisma ORM
- **Cache / Filas:** Redis + BullMQ
- **LLM providers:** GROQ, Gemini, Claude, OpenAI, DeepSeek, OpenRouter, Cohere, HuggingFace
- **Deploy:** systemd (`ai-command-center.service`), porta 3002, proxy Apache → `ia.orbithubos.pt`

---

## Estrutura

```
src/
├── index.ts                   # Entry point, rotas montadas
├── routes/
│   ├── chat.ts                # POST /api/chat/send + /session + /session/domain
│   ├── adminApi.ts            # GET|POST|PUT|DELETE /api/admin/*
│   ├── simulation.ts          # Simulações manuais de treino
│   ├── autoTrain.ts           # Auto-treino IA vs IA (POST /auto-train, /batch-train)
│   └── evaluation.ts          # Worker de avaliação de simulações
├── scripts/
│   └── crawlSites.ts          # Crawler diário de sites (systemd timer às 03:00)
├── services/
│   ├── llm.ts                 # callLLM(), streamLLM(), callLLMAuto() com fallback
│   ├── providerConfig.ts      # Chaves API com cache 30s + circuit breaker por chave
│   ├── knowledge.ts           # Retrieval + injecção de factsDocument/restrictedTopics
│   ├── rateLimiter.ts         # Rate limit por sessão via Redis
│   ├── emailService.ts        # Envio de e-mail (notificações)
│   └── toolExecution.ts       # Execução de ferramentas (Autotrack/Rinosat)
├── middleware/
│   └── adminAuth.ts           # Cookie auth para /admin e /api/admin
├── workers/
│   └── evaluationWorker.ts    # BullMQ worker — avalia simulações com IA
└── types/
    └── index.ts
prisma/
└── schema.prisma              # 11 modelos
public/
├── admin/index.html           # Painel de administração (SPA vanilla)
├── login.html
└── widget.js                  # Widget embebível nos sites clientes
```

---

## Providers LLM

Os providers são configurados na base de dados (`ProviderConfig`) pelo painel admin. Não há chaves API no `.env`.

| Provider | Modelo padrão |
|---|---|
| GROQ | llama-3.3-70b-versatile |
| GEMINI | gemini-2.0-flash |
| CLAUDE | claude-haiku-4-5-20251001 |
| OPENAI | gpt-4o-mini |
| DEEPSEEK | deepseek-chat |
| OPENROUTER | meta-llama/llama-3.3-70b-instruct:free |
| COHERE | command-r-plus |
| HUGGINGFACE | mistralai/Mistral-7B-Instruct-v0.3 |

### Multi-chave e rotação automática

Cada provider suporta até **3 chaves API** (`apiKey`, `apiKey2`, `apiKey3`). Quando uma chave atinge o limite de taxa (429), o sistema:

1. Marca a chave em **cooldown de 60 segundos**
2. Passa automaticamente para a próxima chave disponível do mesmo provider
3. Se todas as 3 chaves estiverem em cooldown, passa para o **provider seguinte** na ordem de prioridade

O `callLLMAuto()` percorre todos os providers activos por ordem de prioridade até obter resposta, registando quais foram tentados.

---

## Conhecimento em tempo real

Cada site tem dois campos que controlam o que a IA sabe e o que pode dizer:

- **`factsDocument`** — descreve exactamente o que o sistema oferece. A IA responde *apenas* com base neste documento, sem inventar funcionalidades nem ir buscar informação à internet.
- **`restrictedTopics`** — informação confidencial que a IA nunca deve revelar ao cliente (ex: preços internos, condições especiais, sistemas em desenvolvimento).

Ambos são injectados no topo do system prompt com prioridade máxima, antes dos exemplos de treino.

### Crawler diário

O script `crawlSites.ts` corre todos os dias às **03:00** (systemd timer `ai-crawl.timer`) e actualiza automaticamente o `factsDocument` de cada site:

- Para sites com login (apps): lê directamente os ficheiros `.tsx`/`.ts` da VPS
- Para sites públicos: faz HTTP crawl das páginas (até 8 por domínio)
- O conteúdo é estruturado via LLM; se o LLM estiver em rate limit, usa texto bruto como fallback
- Resultado guardado em `data/snapshots/<domain>.md`

Mapeamento VPS:
| Domínio | Caminho |
|---|---|
| `gps.autotrack.pt` | `/opt/autotrack/admin` |
| `app.orbithubos.pt` | `/var/www/autotrack` |
| `orbithubos.pt` | `/var/www/autotrack` |
| `autotrack.pt` | `/opt/autotrack/marketing` |
| `app.rinosat.com` | `/var/www/autotrack/orbitrent/frontend` |

Também pode ser disparado manualmente no painel admin (botão "Actualizar Conhecimento") ou via API (`POST /api/admin/crawl`).

---

## Auto-treino IA vs IA

O sistema consegue treinar-se a si próprio sem intervenção humana. Uma IA simula o cliente, outra simula o agente de suporte.

### Perfis de cliente simulado

Quando inicia um auto-treino, o cliente simulado é aleatorizado entre 4 perfis reais:

| Perfil | Características |
|---|---|
| **Idoso** | +65 anos, pouca tecnologia, frases simples, erros de ortografia |
| **Pouca escolaridade** | Linguagem coloquial, sem termos técnicos, perguntas muito básicas |
| **Adulto comum** | 40-50 anos, uso básico de tecnologia, razoavelmente claro |
| **Conhecedor** | Usa termos técnicos correctos, exigente, compara com outros sistemas |

### Detecção de nível pelo agente

O agente detecta automaticamente o nível de conhecimento do cliente e adapta a linguagem:

- **BAIXO** — respostas simples, passo a passo, sem jargão, confirma compreensão
- **MÉDIO** — explicações moderadas, termos básicos com contexto
- **ALTO** — directo ao ponto, termos técnicos, sem simplificações desnecessárias

Se o nível for incerto, o agente pode pedir esclarecimento de forma natural, sem ofender.

### Promoção automática

Se uma sessão de auto-treino obtiver score ≥ 9.5/10, o systemPrompt é promovido automaticamente para produção.

### Batch train

O painel admin tem modo de batch train que corre múltiplas sessões em paralelo (configurable) e apresenta score médio e exemplos das melhores respostas.

---

## Modelos de dados

| Modelo | Descrição |
|---|---|
| `AISite` | Site cliente (domínio, agentType, provider, systemPrompt, factsDocument, restrictedTopics) |
| `ChatSession` | Sessão de conversa (siteId, visitorIp, userId) |
| `ChatMessage` | Mensagem individual (role USER/ASSISTANT) |
| `ProviderConfig` | Até 3 chaves API + modelo + prioridade + isEnabled por provider |
| `KnowledgeEntry` | Base de conhecimento (trigger → resposta aprovada) |
| `LLMCallLog` | Log de cada chamada LLM (tokens, latência, modelo) |
| `ToolExecutionLog` | Log de ferramentas executadas pelo agente |
| `TrainingScenario` | Cenário de treino para simulações |
| `UserSimulation` | Sessão de simulação (manual ou auto) |
| `SimulationMessage` | Mensagens de uma simulação |
| `PromptHistory` | Histórico de versões do systemPrompt por site |

---

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

Quando o site está desactivado no admin, devolve `"offline": true` e `"content": null`.

---

## Painel Admin

Disponível em `ia.orbithubos.pt/admin` (protegido por cookie, sessão de 8h).

| Secção | O que faz |
|---|---|
| **Dashboard** | Métricas gerais: sessões, mensagens, tokens, simulações |
| **Sites** | Gerir sites clientes, ativar/desativar, editar systemPrompt, factsDocument, restrictedTopics |
| **Providers IA** | Configurar até 3 chaves por provider, ver cooldown por chave, testar, reordenar prioridade |
| **Conhecimento** | Rever, aprovar e editar respostas aprendidas pela IA |
| **Conversas** | Histórico de sessões com transcrição completa |
| **Analytics** | Mensagens por dia (30 dias) + perguntas mais frequentes |
| **Logs LLM** | Histórico de chamadas: tokens, latência, modelo usado |
| **Auto-Treino** | Lançar sessões IA vs IA, batch train, ver scores e aplicar a produção |
| **Simulações** | Ver resultados de simulações manuais |
| **Testar Chat** | Testar qualquer site directamente no admin |

---

## Aprendizagem automática

Quando o agente responde a uma mensagem com mais de 60 caracteres, a resposta é guardada como `KnowledgeEntry` com status `PENDING`. O admin revê e aprova no painel. Após aprovação, a resposta é usada directamente (sem chamar a IA) para perguntas semelhantes.

---

## Configuração

```env
DATABASE_URL="postgresql://..."
REDIS_URL="redis://localhost:6379"
PORT=3002
INTERNAL_API_SECRET="segredo_para_api_interna"
```

As chaves API dos providers são geridas exclusivamente pelo painel admin (guardadas na BD).

---

## Deploy

```bash
# Build
cd /opt/ai-command-center
npx tsc

# Restart
systemctl restart ai-command-center

# Logs
journalctl -u ai-command-center -f

# Crawler manual
npx tsx src/scripts/crawlSites.ts
```

O crawler diário corre automaticamente via `ai-crawl.timer` (systemd) às 03:00 com variação aleatória de até 10 minutos.

---

**AI:** Claude (Anthropic)
