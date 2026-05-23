# ORBIT — Integração Bancária TrueLayer (Revolut)

## Contexto
AI Command Center — Express + TypeScript + Prisma, porta 3002.
SystemConfig na BD (key/value) já é usada para guardar configurações.
Credenciais TrueLayer sandbox:
- Client ID: `sandbox-orbit26-8b8b78`
- Client Secret: guardar em SystemConfig com key `orbit.truelayer_secret`
- Ambiente: sandbox (truelayer-sandbox.com) — mudar para produção depois

## Fluxo OAuth2 TrueLayer
1. GET /api/orbit/truelayer/connect → redireciona para TrueLayer auth
2. Utilizador selecciona Revolut Sandbox → autoriza
3. TrueLayer redireciona para /api/orbit/truelayer/callback?code=...
4. Backend troca code por access_token + refresh_token
5. Guarda tokens em SystemConfig
6. Redireciona para /orbit com mensagem de sucesso

---

## Tarefa 1 — Ficheiro novo `src/routes/orbitBanking.ts`

### Constantes
```ts
const TL_AUTH_BASE = 'https://auth.truelayer-sandbox.com'
const TL_API_BASE  = 'https://api.truelayer-sandbox.com'
const TL_CLIENT_ID = 'sandbox-orbit26-8b8b78'
const REDIRECT_URI = 'https://ia.orbithubos.pt/api/orbit/truelayer/callback'
// Client secret lido da BD: await getOrbitConfig('truelayer_secret')
```

### Helper `getOrbitConfig(key)`
```ts
async function getOrbitConfig(key: string): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { key: `orbit.${key}` } })
  return row?.value ?? ''
}
async function setOrbitConfig(key: string, value: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: `orbit.${key}` },
    update: { value, updatedAt: new Date() },
    create: { key: `orbit.${key}`, value, updatedAt: new Date() },
  })
}
```

### Endpoints

**GET /api/orbit/truelayer/connect** (requer requireAdminAuth)
```
Scopes: accounts balance transactions offline_access
URL: {TL_AUTH_BASE}/?
  response_type=code
  &client_id={TL_CLIENT_ID}
  &scope=accounts balance transactions offline_access
  &redirect_uri={REDIRECT_URI}
  &providers=ob-revolut  ← forçar Revolut no sandbox
```
→ res.redirect(url)

**GET /api/orbit/truelayer/callback** (público — chamado pela TrueLayer)
```
1. Receber code da query string
2. POST {TL_AUTH_BASE}/connect/token:
   {
     grant_type: 'authorization_code',
     client_id: TL_CLIENT_ID,
     client_secret: await getOrbitConfig('truelayer_secret'),
     code,
     redirect_uri: REDIRECT_URI
   }
3. Guardar em SystemConfig:
   - orbit.truelayer_access_token
   - orbit.truelayer_refresh_token
   - orbit.truelayer_token_expiry (Date.now() + expires_in * 1000).toString()
4. GET {TL_API_BASE}/data/v1/accounts com Bearer access_token
5. Guardar orbit.truelayer_account_id (primeiro account_id da lista)
6. Redirecionar para /orbit?bank=connected
```

**GET /api/orbit/truelayer/balance** (requer requireAdminAuth)
```
1. Verificar/refrescar token se expirado (ver helper abaixo)
2. GET {TL_API_BASE}/data/v1/accounts/{account_id}/balance
3. Devolver { currency, available, current }
```

**GET /api/orbit/truelayer/transactions** (requer requireAdminAuth)
```
1. Verificar/refrescar token
2. Query param: ?days=30 (default 30)
3. GET {TL_API_BASE}/data/v1/accounts/{account_id}/transactions
   com header: Authorization: Bearer {token}
4. Devolver lista de transacções: { date, description, amount, currency, type }
```

### Helper: refrescar token
```ts
async function ensureFreshToken(): Promise<string> {
  const expiry = parseInt(await getOrbitConfig('truelayer_token_expiry') || '0')
  if (Date.now() < expiry - 60000) {
    return getOrbitConfig('truelayer_access_token')
  }
  // Refrescar
  const refreshToken = await getOrbitConfig('truelayer_refresh_token')
  const secret = await getOrbitConfig('truelayer_secret')
  const resp = await fetch(`${TL_AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: TL_CLIENT_ID,
      client_secret: secret,
      refresh_token: refreshToken,
    }),
  })
  const data = await resp.json() as { access_token: string; refresh_token: string; expires_in: number }
  await setOrbitConfig('truelayer_access_token', data.access_token)
  await setOrbitConfig('truelayer_refresh_token', data.refresh_token)
  await setOrbitConfig('truelayer_token_expiry', (Date.now() + data.expires_in * 1000).toString())
  return data.access_token
}
```

---

## Tarefa 2 — Ferramentas em `src/services/toolExecution.ts`

Adicionar ao array TOOL_DEFINITIONS:
```ts
{
  name: 'getBankBalance',
  description: 'Consulta o saldo actual da conta Revolut de Wanderson.',
  parameters: { type: 'object', properties: {} }
},
{
  name: 'getRecentTransactions',
  description: 'Lista as transacções recentes da conta Revolut de Wanderson.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Número de dias a consultar (default: 30)' },
      limit: { type: 'number', description: 'Máximo de transacções a devolver (default: 20)' }
    }
  }
}
```

No switch de execução, adicionar casos que fazem fetch interno para os endpoints:
- `getBankBalance` → GET http://localhost:3002/api/orbit/truelayer/balance (com cookie admin ou token interno)
- `getRecentTransactions` → GET http://localhost:3002/api/orbit/truelayer/transactions?days={days}

Nota: para chamadas internas, passar header `x-internal-token: ${process.env.INTERNAL_API_SECRET}` e validar no endpoint.

---

## Tarefa 3 — Registar rotas em `src/index.ts`

```ts
import orbitBankingRouter from './routes/orbitBanking'
// Callback público (TrueLayer redireciona aqui)
app.use('/api/orbit/truelayer', orbitBankingRouter)
```

As rotas /balance e /transactions têm requireAdminAuth internamente.
A rota /callback é pública (chamada pela TrueLayer).

---

## Tarefa 4 — UI em `public/orbit/index.html`

No painel ⚙ de configuração (secção nova "Banco"):
- Botão "Ligar Revolut" → GET /api/orbit/truelayer/connect
- Se já ligado (orbit.truelayer_account_id existe): mostrar "Revolut ✓ ligado"
  com botão "Ver saldo" → chama /api/orbit/truelayer/balance e mostra
- Botão "Desligar" → apaga as chaves truelayer_* da BD

Também adicionar ao painel ⚙ (grupo Banco):
| Chave | Label | Tipo |
|---|---|---|
| `truelayer_secret` | TrueLayer Client Secret | password |

---

## Tarefa 5 — Configuração inicial

Criar script `scripts/seedOrbitConfig.ts` que insere o client secret inicial:
```ts
// Apenas para uso único — colocar o secret na BD
// Correr: npx ts-node scripts/seedOrbitConfig.ts
```
Não executar automaticamente — deixar para o utilizador correr manualmente
depois de preencher o secret no painel /orbit.

---

## Validação
`npx tsc --noEmit` deve passar sem erros.

## Commits
1. `feat(orbit): integração TrueLayer — OAuth2, balance, transacções Revolut`
2. `feat(orbit): ferramentas getBankBalance e getRecentTransactions`

## Resultado
- Wanderson abre /orbit → ⚙ → insere Client Secret → clica "Ligar Revolut"
- Autoriza no fluxo TrueLayer Sandbox (Revolut simulado)
- ORBIT passa a responder: "qual é o meu saldo?" → consulta a API → responde
- Sandbox primeiro → quando funcionar bem, mudar para produção
