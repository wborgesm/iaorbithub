# Verificação Completa do Projecto

Lê estes ficheiros antes de qualquer coisa:
- `CLAUDE.md` — contexto completo do projecto
- `PHASE2.md` — o que foi feito na Fase 2
- `PHASE3.md` — o que foi feito na Fase 3

Depois faz uma auditoria completa ao código e responde a cada ponto:

---

## 1. Módulos Agentic — verificar existência e integridade

Confirma que estes ficheiros existem e têm o código correcto:

| Ficheiro | Deve exportar |
|---|---|
| `src/modules/humanApproval.ts` | `requestApproval`, `resolveApproval`, `getPendingApprovals` |
| `src/modules/reactLoop.ts` | `generateReasoning` |
| `src/modules/agenticMemory.ts` | `appendMemoryEntry`, `queryMemory`, `saveMemoryVector`, `searchMemory`, `getMemoryStats` |
| `src/modules/sessionSummary.ts` | `maybeSummarizeSession`, `getPreviousSummary` |
| `src/modules/frustrationDetector.ts` | `scoreFrustration`, `checkFrustration` |
| `src/services/embeddings.ts` | `generateEmbedding` |

Para cada um: lê o ficheiro, confirma que as funções existem e que não há erros óbvios.

---

## 2. Ligações em chat.ts — verificar que estão todas presentes

Abre `src/routes/chat.ts` e confirma que tem:
- Import de `requestApproval` de `humanApproval`
- Import de `generateReasoning` de `reactLoop`
- Import de `maybeSummarizeSession` e `getPreviousSummary` de `sessionSummary`
- Import de `checkFrustration` de `frustrationDetector`
- Bloco ReAct após `let systemPrompt = ...`
- Injecção de `prevSummary` no systemPrompt
- Kill switch antes de `toolService.execute`
- `void maybeSummarizeSession(sessionId)` no final
- `void checkFrustration(...)` no final

Se alguma ligação estiver em falta, adiciona-a seguindo o padrão dos que já existem.

---

## 3. Endpoints admin — verificar que existem

Abre `src/routes/adminApi.ts` e confirma que tem:
- `GET /approvals`
- `POST /approvals/:id/approve`
- `POST /approvals/:id/reject`
- `GET /memory/stats`
- `GET /memory/reasoning`
- `GET /memory/corrections`
- `GET /memory/metrics`
- `POST /memory/:id/mark-insight`
- `POST /crawl`
- `GET /crawl/status`

Se algum estiver em falta, adiciona-o.

---

## 4. Schema Prisma — verificar campos novos

Abre `prisma/schema.prisma` e confirma que `AISite` tem:
- `factsDocument String?`
- `restrictedTopics String?`
- `enableHumanApproval Boolean @default(false)`
- `enableReact Boolean @default(false)`

E que `ProviderConfig` tem:
- `apiKey2 String @default("")`
- `apiKey3 String @default("")`

Se algum estiver em falta no schema mas já na BD (via ALTER TABLE), apenas documenta — não executa `prisma db push`.

---

## 5. TypeScript — compilação limpa

Corre: `npx tsc --noEmit`

Se houver erros, corrige-os sem alterar lógica existente.
Lista os erros encontrados e as correcções aplicadas.

---

## 6. O que falta implementar

Após a auditoria, identifica o que ainda não foi feito comparando com o roadmap:

**Fase 4 (pendente):**
- [ ] Notificações por email quando frustração detectada (emailService.ts já existe — usa-o)
- [ ] Endpoint `GET /memory/reasoning` e `GET /memory/corrections` no adminApi (se em falta)
- [ ] Painel admin: secção de métricas de frustração com lista das sessões alertadas
- [ ] Resumo automático visível no painel (sessões com `session_summary` na memória)

**Melhorias de qualidade:**
- [ ] `src/routes/chat.ts`: o import dinâmico `await import('../modules/agenticMemory')` 
  deve ser import estático no topo do ficheiro — se estiver dinâmico, corrige
- [ ] Garantir que todos os `void` calls têm try/catch internos para não quebrar o fluxo

---

## 7. Próxima tarefa autónoma

Com base na auditoria, escolhe a tarefa mais impactante que ainda não foi feita e implementa-a.

Regras:
- Só adicionar código, nunca alterar existente
- Um commit por tarefa com mensagem clara em português
- `npx tsc --noEmit` deve passar no final

Quando terminares, lista o que fizeste e o que ainda falta para a Fase 4.
