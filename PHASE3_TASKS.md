# Fase 3 — Embeddings, Memória Semântica e Acções Proactivas

> Lê este ficheiro na totalidade antes de começar.
> Executa as tarefas por ordem. Um commit por tarefa.
> No final: `npx tsc --noEmit` deve passar sem erros.

## REGRAS ABSOLUTAS

1. Só adicionar código — nunca alterar lógica existente
2. Nunca renomear variáveis ou funções que já existem
3. Ler cada ficheiro na totalidade antes de o editar
4. Não adicionar dependências npm sem verificar o package.json primeiro
5. Se tiveres dúvida, cria ficheiro novo em vez de editar existente

## ESTADO ACTUAL (o que já existe)

- `src/modules/humanApproval.ts` — Kill Switch funcional
- `src/modules/reactLoop.ts` — Chain-of-Thought funcional
- `src/modules/agenticMemory.ts` — JSONL + saveMemoryVector + searchMemory (textual)
- `src/services/llm.ts` — callLLMAuto, callLLM, streamLLM
- `src/services/providerConfig.ts` — getNextAvailableKey(provider)
- `prisma/migrations/manual_pgvector.sql` — tabela MemoryVector já criada na BD
- `public/admin/index.html` — secção "Memória IA" já existe

---

## TAREFA 1 — Serviço de Embeddings (ficheiro novo)

**Cria:** `src/services/embeddings.ts`

```typescript
import OpenAI from 'openai'
import { getNextAvailableKey } from './providerConfig'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Tenta OpenAI text-embedding-3-small
  try {
    const info = await getNextAvailableKey('OPENAI')
    if (info?.key) {
      const client = new OpenAI({ apiKey: info.key })
      const resp = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      })
      return resp.data[0]?.embedding ?? null
    }
  } catch {}

  // Tenta Cohere embed-english-light-v3.0
  try {
    const info = await getNextAvailableKey('COHERE')
    if (info?.key) {
      const resp = await fetch('https://api.cohere.com/v2/embed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${info.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: [text.slice(0, 8000)],
          model: 'embed-english-light-v3.0',
          input_type: 'search_document',
        }),
      })
      const data = await resp.json() as any
      return data?.embeddings?.[0] ?? null
    }
  } catch {}

  return null
}
```

**Commit:** `feat(embeddings): serviço provider-agnostic OpenAI → Cohere → null`

---

## TAREFA 2 — Busca Semântica Real

**Edita:** `src/modules/agenticMemory.ts`

Adiciona no topo (imports):
```typescript
import { generateEmbedding } from '../services/embeddings'
```

Substitui o corpo de `saveMemoryVector` (mantém a assinatura):
```typescript
  try {
    const embedding = await generateEmbedding(entry.content)
    if (embedding) {
      const vec = `[${embedding.join(',')}]`
      await prisma.$executeRaw`
        INSERT INTO "MemoryVector"
          ("id","createdAt","siteId","sessionId","type","content","embedding","metadata")
        VALUES (
          gen_random_uuid()::text, NOW(),
          ${entry.siteId ?? null}, ${entry.sessionId ?? null},
          ${entry.type}, ${entry.content},
          ${vec}::vector,
          ${JSON.stringify(entry.metadata ?? {})}::jsonb
        )
      `
    } else {
      await prisma.$executeRaw`
        INSERT INTO "MemoryVector"
          ("id","createdAt","siteId","sessionId","type","content","metadata")
        VALUES (
          gen_random_uuid()::text, NOW(),
          ${entry.siteId ?? null}, ${entry.sessionId ?? null},
          ${entry.type}, ${entry.content},
          ${JSON.stringify(entry.metadata ?? {})}::jsonb
        )
      `
    }
  } catch (err) {
    console.warn('[agenticMemory] saveMemoryVector falhou:', (err as Error).message)
  }
```

Substitui o corpo de `searchMemory` (mantém a assinatura):
```typescript
  try {
    const embedding = await generateEmbedding(query)
    if (embedding) {
      const vec = `[${embedding.join(',')}]`
      const results = await prisma.$queryRaw<Array<{ id: string; type: string; content: string; createdAt: Date }>>`
        SELECT id, type, content, "createdAt"
        FROM "MemoryVector"
        WHERE (${siteId ?? null}::text IS NULL OR "siteId" = ${siteId ?? null})
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${limit}
      `
      if (results.length > 0) return results
    }
    return await prisma.$queryRaw<Array<{ id: string; type: string; content: string; createdAt: Date }>>`
      SELECT id, type, content, "createdAt"
      FROM "MemoryVector"
      WHERE (${siteId ?? null}::text IS NULL OR "siteId" = ${siteId ?? null})
        AND content ILIKE ${'%' + query + '%'}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `
  } catch {
    return []
  }
```

**Commit:** `feat(memory): embeddings reais + busca semântica coseno com fallback textual`

---

## TAREFA 3 — Resumos de Sessão (Memória Episódica)

**Cria:** `src/modules/sessionSummary.ts`

```typescript
import { PrismaClient } from '@prisma/client'
import { callLLMAuto } from '../services/llm'
import { saveMemoryVector } from './agenticMemory'
import type { LLMMessage } from '../types'

const prisma = new PrismaClient()
const MIN_MESSAGES = 6

export async function maybeSummarizeSession(sessionId: string): Promise<void> {
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } }, site: true },
    })
    if (!session || session.messages.length < MIN_MESSAGES) return

    const transcript = session.messages
      .map(m => `${m.role === 'USER' ? 'Cliente' : 'Agente'}: ${m.content}`)
      .join('\n')

    const msgs: LLMMessage[] = [
      {
        role: 'system',
        content: 'Faz um resumo conciso desta conversa de suporte em 3-5 frases. Inclui: o problema do cliente, como foi resolvido, e informação útil para futuras interacções.',
      },
      { role: 'user', content: transcript.slice(0, 6000) },
    ]

    const result = await callLLMAuto(msgs)
    if (!result.content) return

    await saveMemoryVector({
      siteId: session.siteId,
      sessionId,
      type: 'session_summary',
      content: result.content,
      metadata: {
        userId: session.userId,
        messageCount: session.messages.length,
        domain: session.site.domain,
      },
    })
  } catch (err) {
    console.warn('[sessionSummary] Falhou:', (err as Error).message)
  }
}

export async function getPreviousSummary(userId: string, siteId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ content: string }>>`
      SELECT mv.content
      FROM "MemoryVector" mv
      JOIN "ChatSession" cs ON cs.id = mv."sessionId"
      WHERE mv."siteId" = ${siteId}
        AND cs."userId" = ${userId}
        AND mv.type = 'session_summary'
      ORDER BY mv."createdAt" DESC
      LIMIT 1
    `
    return rows[0]?.content ?? null
  } catch {
    return null
  }
}
```

**Edita:** `src/routes/chat.ts` — adiciona em 3 sítios:

1. No topo (imports):
```typescript
import { maybeSummarizeSession, getPreviousSummary } from '../modules/sessionSummary'
```

2. Logo após `const userId = req.headers['x-user-id']...` (já existe):
```typescript
    // Memória episódica: resumo de sessões anteriores do mesmo utilizador
    let prevSummary: string | null = null
    if (userId) prevSummary = await getPreviousSummary(userId, session.siteId)
```

3. Logo após `let systemPrompt = baseSystemPrompt + knowledgeContext` (já existe):
```typescript
    if (prevSummary) {
      systemPrompt += `\n\n## Contexto de visitas anteriores deste utilizador:\n${prevSummary}`
    }
```

4. No final, antes do último `return res.json(...)`:
```typescript
    void maybeSummarizeSession(sessionId)
```

**Commit:** `feat(memory): resumos episódicos de sessão — gera e injeta contexto de visitas anteriores`

---

## TAREFA 4 — Detector de Frustração

**Cria:** `src/modules/frustrationDetector.ts`

```typescript
import { appendMemoryEntry } from './agenticMemory'

const SIGNALS = [
  'não funciona','nao funciona','não consigo','nao consigo',
  'problema','erro','bug','ajuda','help','urgente','urgent',
  'já disse','ja disse','quantas vezes','ridiculo','ridículo',
  'péssimo','pessimo','horrivel','horrível','inaceitável','inaceitavel',
  "doesn't work",'not working',
]

export function scoreFrustration(messages: Array<{ role: string; content: string }>): number {
  const userMsgs = messages.filter(m => m.role === 'USER' || m.role === 'user')
  if (userMsgs.length < 2) return 0

  const recent = userMsgs.slice(-5)
  let score = 0

  for (const msg of recent) {
    const lower = msg.content.toLowerCase()
    for (const signal of SIGNALS) {
      if (lower.includes(signal)) score += 1
    }
  }

  // Penaliza repetição da mesma pergunta
  const texts = recent.map(m => m.content.toLowerCase().slice(0, 60))
  const unique = new Set(texts)
  if (unique.size < texts.length * 0.6) score += 2

  return score
}

export async function checkFrustration(
  sessionId: string,
  siteId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  try {
    const score = scoreFrustration(messages)
    if (score < 3) return

    void appendMemoryEntry({
      type: 'insight',
      sessionId,
      siteId,
      input: `Frustração detectada (score: ${score})`,
      output: messages.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n'),
      metadata: { score, alertedAt: new Date().toISOString() },
    })

    console.warn(`[frustration] score=${score} sessão=${sessionId}`)
  } catch (err) {
    console.warn('[frustration] Falhou:', (err as Error).message)
  }
}
```

**Edita:** `src/routes/chat.ts`:

1. Import:
```typescript
import { checkFrustration } from '../modules/frustrationDetector'
```

2. No final, junto ao `maybeSummarizeSession`:
```typescript
    void checkFrustration(sessionId, session.siteId, [
      ...historyMessages,
      { role: 'user', content: message },
    ])
```

**Commit:** `feat(agentic): detector de frustração com score por sessão`

---

## TAREFA 5 — Métricas Fase 3 na API Admin

**Edita:** `src/routes/adminApi.ts`

Adiciona ANTES do `export default router`:

```typescript
router.get('/memory/metrics', async (_req: Request, res: Response) => {
  try {
    const [byType, embeddingStats, recentInsights] = await Promise.all([
      prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
        SELECT type, COUNT(*) as count FROM "MemoryVector" GROUP BY type ORDER BY count DESC
      `,
      prisma.$queryRaw<Array<{ has_embedding: boolean; count: bigint }>>`
        SELECT (embedding IS NOT NULL) as has_embedding, COUNT(*) as count
        FROM "MemoryVector" GROUP BY has_embedding
      `,
      prisma.$queryRaw<Array<{ content: string; createdAt: Date; metadata: unknown }>>`
        SELECT content, "createdAt", metadata FROM "MemoryVector"
        WHERE type = 'insight'
          AND "createdAt" > NOW() - INTERVAL '24 hours'
        ORDER BY "createdAt" DESC LIMIT 20
      `,
    ])
    return res.json({
      byType:         byType.map(r => ({ type: r.type, count: Number(r.count) })),
      embeddingStats: embeddingStats.map(r => ({ hasEmbedding: r.has_embedding, count: Number(r.count) })),
      recentInsights,
    })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})

router.post('/memory/:id/mark-insight', async (req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`UPDATE "MemoryVector" SET type = 'insight' WHERE id = ${req.params.id as string}`
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Erro' })
  }
})
```

**Commit:** `feat(admin): endpoints /memory/metrics e /memory/:id/mark-insight`

---

## TAREFA 6 — UI de Métricas no Painel Admin

**Edita:** `public/admin/index.html`

Na secção `#section-memory` (já existe), adiciona NO TOPO da secção (antes das tabs):

```html
<div id="memory-metrics" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;padding:16px 16px 0"></div>
```

Adiciona a função JS (antes da função `loadApprovals`):

```javascript
async function loadMemoryMetrics() {
  const data = await api('/memory/metrics')
  if (!data) return
  const el = document.getElementById('memory-metrics')
  if (!el) return
  const total = data.byType.reduce((a, r) => a + r.count, 0)
  const withEmb = data.embeddingStats.find(r => r.hasEmbedding)?.count ?? 0
  const insights24h = data.recentInsights?.length ?? 0
  const types = data.byType.map(r =>
    `<div style="background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:10px;text-align:center">
      <div style="font-size:20px;font-weight:700;color:#7ee787">${r.count}</div>
      <div style="font-size:11px;color:#8b949e">${r.type}</div>
    </div>`
  ).join('')
  el.innerHTML = types +
    `<div style="background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:10px;text-align:center">
      <div style="font-size:20px;font-weight:700;color:#58a6ff">${withEmb}/${total}</div>
      <div style="font-size:11px;color:#8b949e">com embedding</div>
    </div>
    <div style="background:#0d1117;border:1px solid ${insights24h>0?'#f59e0b40':'#21262d'};border-radius:8px;padding:10px;text-align:center">
      <div style="font-size:20px;font-weight:700;color:${insights24h>0?'#f59e0b':'#8b949e'}">${insights24h}</div>
      <div style="font-size:11px;color:#8b949e">frustrações 24h</div>
    </div>`
}
```

Na função `load` (o objeto que mapeia secções a funções), adiciona `memory: () => { loadMemory(); loadMemoryMetrics() }`.
Se `memory` já existir no objeto, substitui só esse valor.

Para cada entrada na lista de correções/raciocínios, adiciona botão:
```javascript
// dentro do map de cada item da lista, adiciona:
`<button onclick="markAsInsight('${item.id}')" class="btn btn-ghost btn-sm" style="font-size:10px;margin-top:6px">Marcar como insight</button>`
```

Adiciona função:
```javascript
async function markAsInsight(id) {
  const r = await api('/memory/' + id + '/mark-insight', { method: 'POST' })
  if (r?.ok) { showToast('Marcado como insight', 'success'); loadMemory(); loadMemoryMetrics() }
}
```

**Commit:** `feat(admin): UI métricas Fase 3 — cards por tipo, embeddings, frustrações 24h`

---

## TAREFA 7 — PHASE3.md

Cria `PHASE3.md` na raiz:

```markdown
# Fase 3 — Embeddings, Memória Semântica e Acções Proactivas

## Implementado

- **Embeddings:** serviço provider-agnostic (OpenAI → Cohere → null sem falhar)
- **Busca semântica:** cosine similarity via pgvector quando embedding disponível; fallback ILIKE
- **Memória episódica:** resumo automático de sessões com 6+ mensagens; injectado em visitas seguintes do mesmo utilizador
- **Detector de frustração:** score por sessão, alerta guardado como 'insight' na memória
- **Métricas admin:** cards por tipo, % com embedding, alertas de frustração últimas 24h
- **Mark as insight:** botão no viewer para promover entradas de memória

## Como activar embeddings

No painel admin → Providers IA → OpenAI (ou Cohere) → adicionar chave API.
O sistema activa automaticamente embeddings reais para novas entradas.
Entradas antigas sem embedding continuam a usar busca textual.

## Roadmap Fase 4

1. **Multi-agente:** orquestrador que divide tarefas complexas entre agentes especializados
2. **Acções agendadas:** BullMQ jobs para follow-ups automáticos (email/WhatsApp após sessão sem resolução)
3. **Notificações proactivas:** quando frustração detectada, notifica admin via email em tempo real
4. **Fine-tuning:** exportar pares de treino aprovados para fine-tune de modelo próprio
5. **Voice:** integração Whisper para input de voz no widget
```

**Commit:** `docs: PHASE3.md — implementado e roadmap Fase 4`

---

## VALIDAÇÃO FINAL

```bash
npx tsc --noEmit
```

Zero erros. Se houver erros de tipo no `$queryRaw`, usa cast explícito ou `Prisma.sql`.
