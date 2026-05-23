# ORBIT — Memória de Preferências Pessoais

## Objectivo
ORBIT lembra preferências e factos pessoais do Wanderson automaticamente.
Quando o utilizador diz "prefiro X" ou "o meu carro é Y", ORBIT guarda e usa nas respostas futuras.

---

## Passo 1 — Adicionar tool `rememberFact` em `src/services/toolExecution.ts`

### 1a. Adicionar na lista TOOL_DEFINITIONS (a seguir ao último item existente):

```typescript
{
  type: 'function',
  function: {
    name: 'rememberFact',
    description: 'Guarda um facto ou preferência pessoal do utilizador para usar no futuro. Usa quando o utilizador partilha informação sobre si próprio, as suas preferências, rotinas, ou qualquer facto relevante.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'O facto ou preferência a guardar. Ser específico e conciso. Ex: "Prefere respostas curtas", "O carro é um Tesla Model 3 preto, matrícula XX-00-XX", "Acorda às 7h", "A empresa chama-se Rinosat"' },
        category: { type: 'string', enum: ['preferencia', 'trabalho', 'pessoal', 'rotina', 'financeiro', 'saude', 'outro'], description: 'Categoria do facto' },
      },
      required: ['fact', 'category'],
    },
  },
},
```

### 1b. Adicionar import no topo (junto aos outros imports de módulos):

```typescript
import { appendMemoryEntry } from './agenticMemory'
```

(verificar se já existe — se existir não adicionar)

### 1c. Adicionar handler de execução (dentro do else-if chain, a seguir ao último handler):

```typescript
} else if (toolName === 'rememberFact') {
  const { fact, category } = args as { fact: string; category: string }
  try {
    await appendMemoryEntry(sessionId, siteId, `[${category}] ${fact}`, 'preference')
    return `Guardei: "${fact}"`
  } catch (e) {
    return `Erro ao guardar: ${(e as Error).message}`
  }
```

**Nota:** O handler recebe `sessionId` e `siteId` do contexto — verificar como os outros handlers os recebem e seguir o mesmo padrão.

---

## Passo 2 — Injectar preferências no system prompt do ORBIT

Em `src/routes/chat.ts`, na secção que constrói o `systemPrompt` para `orbit.internal`:

Localizar o bloco que já injeta memórias (algo como `## Memória de interacções passadas`).

A seguir a esse bloco, adicionar:

```typescript
// Injectar preferências pessoais guardadas
if (session.site.domain === 'orbit.internal') {
  try {
    const { queryMemory } = await import('../modules/agenticMemory')
    const prefs = await queryMemory(session.site.id, 'preference', 20)
    if (prefs.length > 0) {
      const prefText = prefs.map(p => `- ${p.content}`).join('\n')
      systemPrompt += `\n\n## Factos e preferências do Wanderson:\n${prefText}`
    }
  } catch { /* não quebrar o fluxo */ }
}
```

**Nota:** Se `queryMemory` já é importado estaticamente no topo do ficheiro, usar directamente sem o dynamic import.

---

## Passo 3 — Adicionar `rememberFact` às tools do ORBIT em `src/routes/chat.ts`

Na linha que define `orbitExtraTools`, adicionar `'rememberFact'`:

```typescript
const orbitExtraTools = session.site.domain === 'orbit.internal'
  ? ['controlSmartHome', 'sendWhatsApp', 'createCalendarEvent', 'listCalendarEvents', 'listOrbitCapabilities', 'getBankBalance', 'getRecentTransactions', 'readEmails', 'readEmailContent', 'listEmailFolders', 'sendEmail', 'rememberFact']
  : []
```

---

## Passo 4 — Verificar que `appendMemoryEntry` aceita tipo `'preference'`

Em `src/modules/agenticMemory.ts`, verificar os tipos aceites em `appendMemoryEntry`.

Se o tipo `'preference'` não estiver na union type, adicionar:

```typescript
// Antes:
type MemoryType = 'reasoning' | 'correction' | 'metric' | 'session_summary'
// Depois:
type MemoryType = 'reasoning' | 'correction' | 'metric' | 'session_summary' | 'preference'
```

Ajustar conforme o código real — não alterar lógica, apenas adicionar o tipo.

---

## Passo 5 — Actualizar system prompt do orbit.internal na BD

```sql
UPDATE "AISite"
SET "systemPrompt" = "systemPrompt" || E'\n\nTool disponível: rememberFact — usa-a sempre que o utilizador partilhar um facto pessoal, preferência, ou informação relevante sobre si próprio. Guarda automaticamente sem pedir confirmação.'
WHERE domain = 'orbit.internal';
```

Executar com:
```bash
PGPASSWORD=aicommand_secure_2026 psql -h localhost -U ai_command_user -d ai_command_center -c "UPDATE \"AISite\" SET \"systemPrompt\" = \"systemPrompt\" || E'\\n\\nTool disponível: rememberFact — usa-a sempre que o utilizador partilhar um facto pessoal, preferência, ou informação relevante sobre si próprio. Guarda automaticamente sem pedir confirmação.' WHERE domain = 'orbit.internal';"
```

---

## Passo 6 — Compilar e reiniciar

```bash
cd /opt/ai-command-center
npx tsc --noEmit
# Se 0 erros:
npx tsc && systemctl restart ai-command-center
sleep 3
systemctl status ai-command-center --no-pager | grep Active
journalctl -u ai-command-center -n 5 --no-pager
```

---

## Resultado esperado

- ORBIT usa `rememberFact` automaticamente quando o utilizador partilha algo
- Preferências guardadas aparecem no contexto de todas as conversas futuras
- Exemplos de uso:
  - "o meu carro é um Tesla Model 3" → ORBIT guarda e lembra
  - "prefiro respostas em pontos" → ORBIT adapta estilo
  - "trabalho das 9h às 18h" → ORBIT considera na agenda
  - "a minha empresa é a Rinosat" → ORBIT sabe o contexto de trabalho

