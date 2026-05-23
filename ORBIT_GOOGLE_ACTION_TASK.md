# ORBIT — Google Action com Conversa Contínua

## Contexto
AI Command Center — Express + TypeScript, porta 3002.
AISite `orbit.internal` já existe com `enableReact: true`.
ORBIT_VOICE_TASK.md já foi implementado (endpoint `/api/orbit/voice` existe).

## Fluxo pretendido
1. Wanderson diz: "OK Google, chama o ORBIT"
2. Google Home abre a Action ORBIT
3. Google diz: "ORBIT online. O que precisas, Wanderson?"
4. Conversa contínua — Wanderson fala, ORBIT responde — sem precisar de dizer "Hey Google" a cada vez
5. Wanderson diz: "Olá Orbit, pode ir" → ORBIT despede-se e encerra a sessão

## O que construir

### 1. Melhorar `src/routes/orbitVoice.ts` — webhook Google Actions

O endpoint `POST /api/orbit/google-action` já existe mas precisa suportar **conversa contínua**.

Formato do request Google Actions (Actions SDK v2):
```json
{
  "handler": { "name": "string" },
  "intent": {
    "name": "string",
    "params": {
      "query": { "original": "texto que o utilizador disse", "resolved": "texto que o utilizador disse" }
    }
  },
  "session": {
    "id": "session_id_do_google",
    "params": { "orbitSessionId": "id_da_sessão_orbit" }
  },
  "user": {},
  "scene": { "name": "string" }
}
```

Lógica completa do handler:
```
1. Extrair texto de intent.params.query.resolved ou intent.params.query.original
2. Se handler.name === 'actions.handler.MAIN' ou texto vazio:
   - Resposta de boas-vindas: "ORBIT online. O que precisas, Wanderson?"
   - Manter sessão aberta (expectUserResponse: true)
3. Verificar se é frase de saída:
   - texto contém "pode ir" ou "encerra" ou "até logo" ou "obrigado orbit"
   - Se sim: responder "ORBIT a encerrar. Até logo, Wanderson." + expectUserResponse: false
4. Senão: processar mensagem normalmente via ORBIT chat e responder com expectUserResponse: true
   - Usar session.params.orbitSessionId para manter contexto entre turnos
   - Se não existir orbitSessionId, criar nova sessão orbit.internal e guardar em session.params

Formato da resposta para Google (para MANTER conversa aberta):
{
  "session": {
    "id": "<google_session_id>",
    "params": { "orbitSessionId": "<orbit_session_id>" }
  },
  "prompt": {
    "override": false,
    "firstSimple": {
      "speech": "<resposta_orbit>",
      "text": "<resposta_orbit>"
    }
  },
  "scene": {
    "name": "ORBIT_conversation",
    "slots": {},
    "next": {
      "name": "ORBIT_conversation"  ← isto mantém a conversa activa
    }
  }
}

Para ENCERRAR conversa (quando "pode ir"):
- Omitir o campo "scene.next" ou usar "actions.scene.END_CONVERSATION"
```

### 2. Ficheiro `public/orbit/actions-setup.md` — guia de configuração

Criar este ficheiro com instruções passo-a-passo para o utilizador configurar a Google Action:

```markdown
# Configurar ORBIT no Google Actions Console

## 1. Criar projecto
- Ir a console.actions.google.com
- "New project" → nome: "ORBIT" → país: Portugal
- Tipo: Custom → Blank project

## 2. Invocação
- Display name: ORBIT
- Pronunciation: orbit
- → O utilizador dirá: "Hey Google, fala com ORBIT" ou "Hey Google, chama o ORBIT"

## 3. Webhook (Fulfillment)
- Ir a Develop → Webhook
- URL: https://ia.orbithubos.pt/api/orbit/google-action
- Não precisa de autenticação adicional (o endpoint é público mas tem validação interna)

## 4. Cenas (Scenes)
- Criar cena: ORBIT_conversation
- Em "When entering the scene" → Webhook → handler name: orbit_message
- Activar "Wait for user input" sempre

## 5. Main invocation
- Webhook → handler name: actions.handler.MAIN

## 6. Testar
- Clicar "Test" no console
- Dizer: "Talk to ORBIT"
- No Google Home: "Hey Google, fala com ORBIT"

## 7. Adicionar ao .env do servidor
ORBIT_GOOGLE_PROJECT_ID=<id_do_projecto_google>
```

### 3. Variáveis de ambiente a adicionar ao `.env`

Documentar em `.env.example`:
```
ORBIT_API_KEY=chave_aleatoria_segura_para_siri
IFTTT_WEBHOOK_KEY=chave_do_ifttt_maker
ORBIT_GOOGLE_PROJECT_ID=id_do_projecto_google_actions
```

## Validação
`npx tsc --noEmit` deve passar sem erros.

## Commits
1. `feat(orbit): Google Action com conversa contínua e detecção de frase de saída`
2. `docs(orbit): guia de configuração Google Actions Console`

## Resultado
- "OK Google, chama o ORBIT" → inicia conversa
- Conversa contínua sem precisar de "Hey Google" a cada frase
- "Olá Orbit, pode ir" → ORBIT despede-se e encerra
- Contexto mantido durante toda a conversa (mesma sessão orbit.internal)
