# orbit-plan.md — Plano de alterações cirúrgicas ORBIT
**Data:** 2026-05-24  
**Autor:** Claude (análise de logs + pgvector + sessões de chat)  
**Regra:** Nunca alterar layout, nunca refactorizar variáveis. Só adições/substituições cirúrgicas.

---

## Diagnóstico — o que está partido

### P1 — `sendWhatsApp: to: undefined` (crítico)
O LLM chama `sendWhatsApp` com `to: "Vida"` (nome) ou `to: undefined` antes de saber o número.  
A validação em `toolExecution.ts:440` rejeita, mas é tarde demais — o modal já mostra  
`"Preciso da tua confirmação: Enviar WhatsApp para undefined: ''"`.  
**Raiz:** Não existe camada de resolução nome→número antes de o LLM chamar a ferramenta.

### P2 — `habit_trust` envenenado
`orbit.habit_trust = {"sendWhatsApp:":3}` — a chave de hábito para `sendWhatsApp` com `to=undefined`  
foi aprovada 3× (sem número) e agora contorna a confirmação para qualquer chamada com `to` vazio.  
**Raiz:** `habitSignature` em `orbitHabits.ts:28` usa `args.to` sem validar se é número real.

### P3 — Ferramenta `readWhatsApp` inexistente
O utilizador pediu "leia meu ultimo whatsapp" em 6+ sessões. ORBIT não tem nenhuma ferramenta  
de leitura de mensagens. O WhatsApp Web.js disponibiliza `client.getChats()` e  
`chat.fetchMessages()` que podem ser usados.  
**Raiz:** A ferramenta nunca foi criada; só `sendWhatsApp` existe.

### P4 — `criticalAlertMonitor` falso positivo em cada arranque
`criticalAlertMonitor.ts:12` grep: `'fatal|FATAL|panic|segfault'` — apanha a própria linha  
`[criticalAlertMonitor] Alerta fatal enviado` que está nos logs do restart anterior.  
Resultado: no arranque seguinte, a fingerprint muda (tem o novo timestamp) → envia alerta.  
**Raiz:** O grep não exclui as linhas do próprio monitor.

### P5 — SIGTERM timeout → SIGKILL em cada restart
`index.ts` não tem handler SIGTERM. O cliente Puppeteer fica vivo e o systemd mata com SIGKILL  
ao fim de 5s. Workers não encerram limpos; Chrome orphan fica pendurado.  
**Raiz:** `disconnectWhatsAppWeb()` nunca é chamado na saída do processo.

### P6 — Nenhuma resolução de contactos por nome em pgvector
`rememberFact` aceita `factType: 'contact'` mas não guarda `phone` nos metadados de forma  
estruturada, e `listFacts` não expõe pesquisa por nome. O LLM tem de adivinhar o número.  
**Raiz:** Falta campo `phone` no schema de `rememberFact` + função de lookup por nome.

---

## Plano de alterações — por ordem de prioridade

---

### PASSO 1 — Corrigir `habitSignature` para não contar hábitos com dados inválidos
**Ficheiro:** `src/modules/orbitHabits.ts`  
**Linhas:** 28–35 (função `habitSignature`, caso `sendWhatsApp`)

**Substituir** o bloco:
```typescript
  if (toolName === 'sendWhatsApp') {
    return `${toolName}:${String(args.to || '').toLowerCase()}`
  }
```
**Por:**
```typescript
  if (toolName === 'sendWhatsApp') {
    const digits = String(args.to || '').replace(/\D/g, '')
    if (digits.length < 7) return `${toolName}:__invalid__`  // nunca atinge threshold
    return `${toolName}:${digits}`
  }
```
**Limpar a DB após deploy:**
```sql
UPDATE "SystemConfig" SET value = '{}' WHERE key = 'orbit.habit_trust';
```

---

### PASSO 2 — Adicionar campo `phone` ao schema de `rememberFact` + lookup por nome
**Ficheiro:** `src/services/toolExecution.ts`  
**Linhas:** 266–291 (schema `rememberFact`)

**Adicionar** dentro de `properties`, depois de `metric_unit`:
```typescript
          phone: { type: 'string', description: 'Número de telefone do contacto (ex: +351912345678). Só para factType=contact.' },
```

**Ficheiro:** `src/services/toolExecution.ts`  
**Linhas:** 576–608 (bloco `rememberFact` em `execute()`)

**Adicionar** depois de `const metric_unit = ...`:
```typescript
        const phone = typeof args.phone === 'string' ? args.phone.trim() : undefined
```
**E** no `saveFact(...)` adicionar `phone` ao objeto `metadata` dentro de `agenticMemory.ts:saveFact`.

**Ficheiro:** `src/modules/agenticMemory.ts`  
**Linha ~232** (dentro de `saveFact`, objeto `metadata`)

**Adicionar** uma linha:
```typescript
    phone: input.phone || null,
```
**E** no tipo de entrada de `saveFact`, adicionar:
```typescript
  phone?: string
```

**Ficheiro:** `src/services/toolExecution.ts`  
**Após linha 606** (depois de `await saveFact({...})`, adicionar `phone` ao call):
```typescript
            await saveFact({ siteId, sessionId: ctx.sessionId, fact, category,
              dueDate, priority, factType, asset, last_metric, threshold, metric_unit, phone })
```

---

### PASSO 3 — Criar função `resolveContactPhone` e usá-la em `sendWhatsApp`
**Ficheiro:** `src/modules/agenticMemory.ts`  
**Adicionar após `listUpcomingFacts` (linha ~265)**:

```typescript
/** Procura número de telefone de um contacto guardado por nome */
export async function resolveContactPhone(siteId: string, name: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ content: string; metadata: unknown }>>`
      SELECT content, metadata FROM "MemoryVector"
      WHERE "siteId" = ${siteId} AND type = 'preference'
        AND (metadata->>'factType' = 'contact' OR metadata->>'category' = 'pessoal')
        AND LOWER(content) LIKE ${`%${name.toLowerCase()}%`}
      ORDER BY "createdAt" DESC LIMIT 5
    `
    for (const r of rows) {
      const meta = (r.metadata && typeof r.metadata === 'object') ? r.metadata as Record<string, unknown> : {}
      const phone = typeof meta.phone === 'string' ? meta.phone.trim() : ''
      if (phone && phone.replace(/\D/g, '').length >= 7) return phone
    }
    return null
  } catch { return null }
}
```

**Ficheiro:** `src/services/toolExecution.ts`  
**Linhas:** 434–449 (bloco `sendWhatsApp` em `execute()`)

**Adicionar import** no topo do ficheiro (após os imports existentes):
```typescript
import { resolveContactPhone } from '../modules/agenticMemory'
```

**Substituir** o início do bloco `sendWhatsApp`:
```typescript
      } else if (toolName === 'sendWhatsApp') {
        authorized = true
        let rawTo = String(args.to || '').trim()
        const digits = rawTo.replace(/\D/g, '')
        if (!rawTo || digits.length < 7) {
```
**Por:**
```typescript
      } else if (toolName === 'sendWhatsApp') {
        authorized = true
        let rawTo = String(args.to || '').trim()
        // Tentar resolver nome → número se o LLM passou um nome em vez de número
        if (rawTo && rawTo.replace(/\D/g, '').length < 7 && ctx.siteId) {
          const resolved = await resolveContactPhone(ctx.siteId, rawTo)
          if (resolved) rawTo = resolved
        }
        const digits = rawTo.replace(/\D/g, '')
        if (!rawTo || digits.length < 7) {
```

---

### PASSO 4 — Criar ferramenta `readWhatsAppMessages`
**Ficheiro:** `src/services/whatsappWeb.ts`  
**Adicionar após `sendViaWhatsAppWeb` (linha ~263)**:

```typescript
export async function getRecentWhatsAppMessages(
  limit = 5,
): Promise<{ ok: boolean; messages?: Array<{ from: string; body: string; timestamp: number; isMe: boolean }>; error?: string }> {
  if (state !== 'ready' || !client) {
    return { ok: false, error: 'WhatsApp não ligado.' }
  }
  try {
    const chats = await client.getChats()
    const messages: Array<{ from: string; body: string; timestamp: number; isMe: boolean }> = []
    for (const chat of chats.slice(0, 8)) {
      const msgs = await chat.fetchMessages({ limit: 2 })
      for (const m of msgs) {
        if (!m.body) continue
        messages.push({ from: chat.name || m.from, body: m.body.slice(0, 300), timestamp: m.timestamp, isMe: m.fromMe })
      }
      if (messages.length >= limit) break
    }
    messages.sort((a, b) => b.timestamp - a.timestamp)
    return { ok: true, messages: messages.slice(0, limit) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erro ao ler mensagens' }
  }
}
```

**Ficheiro:** `src/services/toolExecution.ts`  
**Secção de definição de ferramentas** — adicionar após o bloco `sendWhatsApp` (linha ~138):

```typescript
  {
    type: 'function',
    function: {
      name: 'readWhatsAppMessages',
      description: 'Lê as últimas mensagens recebidas/enviadas no WhatsApp pessoal do Wanderson.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Número de mensagens a devolver (default 5, max 10).' },
        },
        required: [],
      },
    },
  },
```

**Ficheiro:** `src/services/toolExecution.ts`  
**Secção de execução** — adicionar após o bloco `sendWhatsApp` (linha ~449):

```typescript
      } else if (toolName === 'readWhatsAppMessages') {
        authorized = true
        const limit = typeof args.limit === 'number' ? Math.min(args.limit, 10) : 5
        const { getRecentWhatsAppMessages } = await import('./whatsappWeb')
        const res = await getRecentWhatsAppMessages(limit)
        result = res.ok
          ? { success: true, data: { messages: res.messages } }
          : { success: false, error: res.error }
```

**Ficheiro:** `src/routes/chat.ts`  
**Linha ~242** (array `orbitExtraTools` ou onde estão listadas as ferramentas ORBIT):  
Adicionar `'readWhatsAppMessages'` à lista de ferramentas permitidas para orbit.internal.

---

### PASSO 5 — Corrigir `criticalAlertMonitor` — excluir linhas do próprio monitor
**Ficheiro:** `src/workers/criticalAlertMonitor.ts`  
**Linha 12** — substituir o grep:

```typescript
    const { stdout } = await execAsync(
      "journalctl -u ai-command-center --since '10 min ago' --no-pager 2>/dev/null | grep -iE 'fatal|FATAL|panic|segfault' | grep -v 'criticalAlertMonitor' | tail -20 || true",
    )
```

---

### PASSO 6 — SIGTERM graceful shutdown (Puppeteer não bloqueia restart)
**Ficheiro:** `src/index.ts`  
**Adicionar após `void resumeWhatsAppWebIfPossible()` (linha 179)**, antes de `app.listen`:

```typescript
// Encerramento limpo — evita SIGKILL por timeout do systemd (Puppeteer bloqueia)
const shutdown = async (signal: string) => {
  console.log(`[index] ${signal} recebido — a encerrar…`)
  try {
    const { disconnectWhatsAppWeb } = await import('./services/whatsappWeb')
    await Promise.race([disconnectWhatsAppWeb(), new Promise(r => setTimeout(r, 4000))])
  } catch { /* ignore */ }
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT',  () => void shutdown('SIGINT'))
```

---

### PASSO 7 — Regra ORBIT: pedir número ANTES de chamar sendWhatsApp
**Ficheiro:** `src/modules/orbitContext.ts`  
**Linha ~170** (bloco `## Regras ORBIT`)

**Substituir** a linha:
```
- Se não souberes o número/email de um contacto → pergunta: "Qual é o número de X?" — não passes undefined.
```
**Por:**
```
- Antes de chamar sendWhatsApp: se só tens o nome (ex: "Vida"), usa primeiro readWhatsAppMessages ou listFacts para tentar encontrar o número. Se não encontrares, pergunta directamente: "Qual é o número de Vida?" — NUNCA passes nome ou undefined em `to`.
- Se o utilizador der o número durante a conversa, guarda imediatamente com rememberFact(factType=contact, phone=número).
```

---

## Ordem de execução recomendada ao Cursor

```
1. orbitHabits.ts   — Passo 1 (habitSignature + limpeza DB)
2. agenticMemory.ts — Passo 2 (campo phone em saveFact + resolveContactPhone)
3. toolExecution.ts — Passo 2 + 3 + 4 (phone em rememberFact + resolução + readWhatsApp)
4. whatsappWeb.ts   — Passo 4 (getRecentWhatsAppMessages)
5. chat.ts          — Passo 4 linha orbitExtraTools
6. criticalAlertMonitor.ts — Passo 5 (grep fix)
7. index.ts         — Passo 6 (SIGTERM handler)
8. orbitContext.ts  — Passo 7 (regra atualizada)
9. npx tsc && systemctl restart ai-command-center
10. psql: UPDATE "SystemConfig" SET value = '{}' WHERE key = 'orbit.habit_trust';
```

---

## O que NÃO fazer
- Não mudar o schema Prisma — tudo usa `metadata` JSON no `MemoryVector`
- Não alterar a lógica de confirmação — apenas o habitSignature e a resolução de contactos
- Não refactorizar `toolExecution.ts` — adicionar blocos `else if` inline como os existentes
- Não mover `whatsappService.ts` — o wrapper permanece; apenas `whatsappWeb.ts` ganha a função de leitura

---

## Diagnósticos auto — 2026-05-24 21:22

- **[P4]** criticalAlertMonitor falso positivo (grep apanha o próprio log)
- **[P5]** SIGTERM timeout → SIGKILL (Puppeteer bloqueia saída)
- **[quota]** Todos os providers em cooldown simultâneo → ORBIT indisponível
- **[chat]** Erro não-429 no endpoint chat/send
- **[BD]** WhatsApp health check falhou (orbit.whatsapp_health_ok = 'vazio')
- **[BD]** CRÍTICO: Nenhum provider LLM activo na DB

> _Gerado por scripts/orbitMonitor.js — não editar manualmente esta secção_


---

## Esclarecimentos de âmbito — 2026-05-24

### E1 — Worker de viagem é GENÉRICO (não só Madrid)

**O que está errado:**
- `initiativeEngine.ts:107` — `tripCoords()` hardcoded: só reconhece Madrid/Warner
- `initiativeEngine.ts:149` — `checkCalendarTrips()` filtra por palavras-chave fixas (`madrid`, `warner`, `hotel`, `viagem`)
- Resultado: viagens a Lisboa, Porto, Londres, etc. não disparam o worker

**O que deve ser:**
- Qualquer fact com `factType: 'trip'` e `dueDate` → dispara automaticamente (já funciona)
- Qualquer evento de calendário com localização preenchida → dispara (independente do nome)
- Geocoding: para clima usar Open-Meteo Geocoding API (gratuita) pelo nome da cidade
- O guia temático (horários, atrações) deve ser gerado por LLM com base no destino, não hardcoded

**Ficheiros a alterar (Cursor):**
- `src/workers/initiativeEngine.ts` linha 107 — substituir `tripCoords()` por geocoding via fetch a `https://geocoding-api.open-meteo.com/v1/search?name={cidade}&count=1`
- `src/workers/initiativeEngine.ts` linha 149 — remover filtro por palavras-chave; usar `ev.location` preenchido OU título com palavras como `voo`, `hotel`, `viagem`, `trip`, `reserva`
- `src/services/weatherService.ts` — `fetchTripWeather` já aceita lat/lon dinâmico, não precisa mudar

---

### E2 — Telemetria de manutenção é GENÉRICA (não só a moto)

**O que está certo:**
- `maintenanceMonitor.ts` já é genérico — usa `listMaintenanceAssets(siteId)` sem hardcode
- `rememberFact` aceita `asset`, `last_metric`, `threshold`, `metric_unit` — funciona para qualquer equipamento

**O que está incompleto:**
- Não existe ferramenta `updateAssetMetric` — quando o Wanderson diz "fiz mais 300km na moto", o ORBIT cria um NOVO facto em vez de actualizar o existente
- `saveFact()` em `agenticMemory.ts` faz sempre INSERT — não há upsert por `asset`
- Resultado: acumulam-se registos duplicados do mesmo asset com métricas diferentes

**Ficheiro a alterar (Cursor):**
- `src/modules/agenticMemory.ts` — adicionar `upsertMaintenanceFact(siteId, asset, last_metric)` que faz UPDATE do registo existente com aquele `asset` em vez de criar novo
- `src/services/toolExecution.ts` — adicionar tool `updateAssetMetric`:
  ```typescript
  // Schema:
  { name: 'updateAssetMetric', params: { asset: string, current_value: number, unit?: string } }
  // Execução: chama upsertMaintenanceFact(); devolve estado actualizado (remaining até threshold)
  ```
- `src/modules/orbitContext.ts` regras — adicionar: "Quando o Wanderson reportar uso de um asset (km, horas, ciclos), chama updateAssetMetric antes de responder"

---

### E3 — ORBIT usa infra do admin mas NÃO é configurado nele (regra arquitectural)

**O que está correcto (não mudar):**
- ORBIT usa os mesmos providers LLM do `ProviderConfig` — partilha de infra é intencional
- `/orbit` e `/admin` têm rotas separadas com autenticação separada
- `adminApi.ts` não lê nem escreve chaves `orbit.*` no `SystemConfig`

**Regra a enforçar (nunca quebrar):**
- Chaves `orbit.*` em `SystemConfig` são EXCLUSIVAS da rota `/orbit` e do `orbitRouter`
- O painel `/admin` nunca deve expor: Gmail OAuth tokens, WhatsApp session, TrueLayer secret, ElevenLabs key, contactos pessoais, factos da memória pessoal
- Se um worker ORBIT precisar de config → lê via `getOrbitConfig()`, nunca via endpoint admin
- Se o painel admin precisar de saber se ORBIT está activo → usa apenas flags booleanos sem dados pessoais (ex: `orbit_wa_connected: true/false`)

**Acção imediata:**
- Adicionar `orbit.admin_ip_whitelist` à whitelist do painel `/orbit` (feito — IP 94.132.42.166)
- Quando o sistema estiver estável, migrar whitelist para variável de ambiente `ORBIT_ALLOWED_IPS` em vez de DB (mais seguro — não fica exposto em backups SQL)

---

## Diagnósticos auto — 2026-05-24 22:33

- **[P4]** criticalAlertMonitor falso positivo (grep apanha o próprio log)
- **[quota]** Todos os providers em cooldown simultâneo → ORBIT indisponível
- **[chat]** Erro não-429 no endpoint chat/send

> _Gerado por scripts/orbitMonitor.js — não editar manualmente esta secção_
