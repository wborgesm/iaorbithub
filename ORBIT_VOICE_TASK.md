# ORBIT — Voz, Google Home e Casa Inteligente

## Contexto
AI Command Center — Express + TypeScript + Prisma, porta 3002.
AISite `orbit.internal` já existe na BD com `enableReact: true`.
Endpoints existentes:
- `POST /api/chat/session/domain` — cria sessão
- `POST /api/chat/send` — envia mensagem, recebe resposta IA
- Middleware `requireAdminAuth` para rotas admin
- `src/services/toolExecution.ts` — onde vivem as ferramentas da IA
- `src/index.ts` — registo de rotas

APENAS ADICIONAR código novo. Nunca alterar lógica existente.

---

## Tarefa 1 — Endpoint de voz pessoal `/api/orbit/voice`

**Ficheiro novo:** `src/routes/orbitVoice.ts`

Este endpoint é chamado pelo Siri Shortcut e por outros clientes de voz.
Autenticação por API key simples (header `x-orbit-key` comparado com `process.env.ORBIT_API_KEY`).

```ts
POST /api/orbit/voice
Headers: x-orbit-key: <ORBIT_API_KEY>
Body: { message: string, sessionId?: string }
Response: { reply: string, sessionId: string }
```

Lógica:
1. Valida `x-orbit-key` contra `process.env.ORBIT_API_KEY`
2. Se `sessionId` vier no body, usa esse. Senão, cria nova sessão para `orbit.internal` via Prisma (igual ao que `POST /api/chat/session/domain` faz internamente)
3. Guarda mensagem do utilizador no histórico (tipo `USER`)
4. Chama `callLLMAuto` com o histórico + systemPrompt do AISite `orbit.internal`
5. Guarda resposta no histórico (tipo `ASSISTANT`)
6. Devolve `{ reply: string, sessionId: string }`

Para o systemPrompt: buscar da BD `AISite` onde `domain = 'orbit.internal'`.

Registar em `src/index.ts`:
```ts
import orbitVoiceRouter from './routes/orbitVoice'
app.use('/api/orbit', orbitVoiceRouter)  // sem requireAdminAuth — usa x-orbit-key própria
```

---

## Tarefa 2 — Webhook Google Actions `/api/orbit/google-action`

**Adicionar ao mesmo ficheiro** `src/routes/orbitVoice.ts`

O Google Assistant chama este endpoint quando o utilizador diz "OK Google, fala com ORBIT".

```
POST /api/orbit/google-action
Body: Google Actions JSON request (ver formato abaixo)
Response: Google Actions JSON response
```

Formato do request Google Actions:
```json
{
  "handler": { "name": "actions.handler.MAIN" },
  "intent": { "name": "actions.intent.MAIN", "params": {} },
  "scene": { "name": "ORBIT_conversation" },
  "session": { "id": "session_id_from_google", "params": {} },
  "user": { "params": {} },
  "home": {},
  "device": {}
}
```
O texto do utilizador vem em:
`req.body.intent?.params?.query?.resolved` ou `req.body.scene?.slots?.query?.value`

Formato da resposta para Google:
```json
{
  "session": { "id": "<session_id>", "params": {} },
  "prompt": {
    "override": false,
    "firstSimple": { "speech": "<resposta_orbit>", "text": "<resposta_orbit>" }
  }
}
```

Lógica:
1. Extrai texto do pedido Google
2. Usa `session.id` do Google como sessionId (prefixado com `google_`)
3. Chama a mesma lógica de voz (reutiliza função interna)
4. Devolve formato Google

---

## Tarefa 3 — Ferramentas de Casa Inteligente

**Ficheiro novo:** `src/services/smartHome.ts`

O ORBIT controla o Google Home via **IFTTT Webhooks** (o utilizador cria os applets no IFTTT).

```ts
export async function triggerIFTTT(eventName: string, value1?: string, value2?: string, value3?: string): Promise<boolean>
// POST https://maker.ifttt.com/trigger/{eventName}/with/key/{IFTTT_KEY}
// Usa process.env.IFTTT_WEBHOOK_KEY
```

**Adicionar a `src/services/toolExecution.ts`** (APENAS adicionar ao array e ao switch, nunca alterar existente):

Novas ferramentas no array `TOOL_DEFINITIONS`:
```ts
{
  name: 'controlSmartHome',
  description: 'Controla dispositivos da casa inteligente via Google Home/IFTTT. Liga/desliga luzes, aquecedor, etc.',
  parameters: {
    type: 'object',
    properties: {
      device: { type: 'string', description: 'Nome do dispositivo (ex: "luzes_sala", "aquecedor", "luzes_quarto")' },
      action: { type: 'string', enum: ['on', 'off', 'toggle'], description: 'Acção a executar' },
      value: { type: 'string', description: 'Valor opcional (ex: brilho "50%", temperatura "22")' }
    },
    required: ['device', 'action']
  }
},
{
  name: 'sendWhatsApp',
  description: 'Envia uma mensagem WhatsApp a um contacto.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Número de telefone com código de país (ex: +351912345678)' },
      message: { type: 'string', description: 'Mensagem a enviar' }
    },
    required: ['to', 'message']
  }
},
{
  name: 'createCalendarEvent',
  description: 'Cria um evento no calendário Google de Wanderson.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título do evento' },
      date: { type: 'string', description: 'Data e hora ISO 8601 (ex: 2026-05-23T15:00:00)' },
      duration: { type: 'number', description: 'Duração em minutos (default 60)' },
      description: { type: 'string', description: 'Descrição opcional' }
    },
    required: ['title', 'date']
  }
},
{
  name: 'listOrbitCapabilities',
  description: 'Lista o que o ORBIT pode fazer para ajudar Wanderson no trabalho e na vida.',
  parameters: { type: 'object', properties: {} }
}
```

No switch de execução, adicionar casos:
- `controlSmartHome` → chama `triggerIFTTT('orbit_' + device + '_' + action, value)`
- `sendWhatsApp` → por agora retorna `{ success: false, message: 'WhatsApp não configurado ainda' }`
- `createCalendarEvent` → por agora retorna `{ success: false, message: 'Google Calendar não configurado ainda' }`
- `listOrbitCapabilities` → retorna lista hardcoded das capacidades actuais e futuras

---

## Tarefa 4 — Variáveis de ambiente

Adicionar ao `.env.example` (criar se não existir) e documentar:
```
ORBIT_API_KEY=gerar_uma_chave_aleatoria_segura
IFTTT_WEBHOOK_KEY=vai_buscar_ao_ifttt.com/maker
```

---

## Validação

`npx tsc --noEmit` deve passar sem erros.

Commits separados:
1. `feat(orbit): endpoint de voz /api/orbit/voice com autenticação por API key`
2. `feat(orbit): webhook Google Actions /api/orbit/google-action`
3. `feat(orbit): ferramentas casa inteligente — controlSmartHome, sendWhatsApp, createCalendarEvent`

---

## Resultado esperado

Após deploy:
- Siri Shortcut chama `POST https://ia.orbithubos.pt/api/orbit/voice` com header `x-orbit-key`
- Google Action chama `POST https://ia.orbithubos.pt/api/orbit/google-action`
- ORBIT pode ligar/desligar dispositivos via IFTTT
- Base preparada para Google Calendar e WhatsApp

## Instruções de configuração (para o utilizador fazer depois)

### IFTTT
1. Entrar em ifttt.com
2. Criar applet: Webhooks → Google Assistant ou Google Home
3. Event name: `orbit_luzes_sala_on`, `orbit_luzes_sala_off`, `orbit_aquecedor_on`, etc.
4. Copiar a Webhook key em ifttt.com/maker/settings

### Google Actions
1. console.actions.google.com → New project
2. Display name: "ORBIT"
3. Fulfillment webhook: `https://ia.orbithubos.pt/api/orbit/google-action`
4. Invocation: "talk to ORBIT" / "fala com ORBIT"
5. Deploy para testing → no telemóvel: "OK Google, fala com ORBIT"

### Siri Shortcut
1. iPhone → Atalhos → Novo Atalho
2. Adicionar: "Ditar texto" → "Obter conteúdo de URL"
   - URL: `https://ia.orbithubos.pt/api/orbit/voice`
   - Método: POST
   - Headers: `x-orbit-key: <ORBIT_API_KEY>`
   - Body JSON: `{"message": [Texto Ditado], "sessionId": ""}`
3. Adicionar: "Falar texto" → usar `reply` do resultado
4. Siri phrase: "ORBIT"
