# CHANGELOG — AI Command Center

## [1.0.0] — 2026-05-18

### Added
- Microserviço backend completo em `/opt/ai-command-center` (Node.js + TypeScript + Express)
- Banco de dados PostgreSQL dedicado `ai_command_center` com schema Prisma v6
- **8 modelos Prisma**: AISite, ChatSession, ChatMessage, ToolExecutionLog, LocalKnowledge, SuggestedKnowledge, TrainingScenario, UserSimulation, SimulationMessage, LLMCallLog
- **LLM Service** com suporte a 4 providers: Gemini, Claude, OpenAI, DeepSeek — lazy-initialized
- **ToolExecutionService** com Zero-Trust RBAC: `executeVehicleAction`, `fetchBillingInvoice`, `updateClientContact`
- **POST /api/chat/send** — endpoint de chat com tool use loop (até 5 iterações), rate limit 25 msg/hora
- **POST /api/chat/session** — criação de sessão de chat
- **POST /api/simulation/advance** — SSE streaming com optimistic locking (controle de versão), rate limit 10 req/min, fallback automático de provider
- **POST /api/simulation/create** — criação de simulação de treino
- **POST /api/simulation/evaluate** — enfileira avaliação assíncrona (BullMQ + Redis)
- **GET /api/simulation/status/:id** — consulta status/score/feedback da simulação
- **Worker BullMQ** `evaluationWorker` — avalia transcrições com LLM, valida JSON com Zod, fallback entre providers, status `COMPLETED` ou `EVALUATION_FAILED`
- **Endpoints admin** (protegidos por `x-internal-secret`): CRUD de AISites e TrainingScenarios
- **GET /health** — health check
- Redis instalado e configurado no servidor
- PM2 id 9: `ai-command-center` rodando na porta 3002

### Technical
- Prisma 6 (downgrade do 7.x incompatível com sintaxe `url`)
- BigInt serializado como string nas respostas JSON
- `systemInstruction` do Gemini passada corretamente via `getGenerativeModel()`
- AUTOTRACK_DATABASE_URL configurado para checks de RBAC de veículos/faturas

**AI:** Claude (Anthropic)
