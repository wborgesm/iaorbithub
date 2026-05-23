# Fase 2 — Memória Semântica e Viewer Admin

## Implementado

### Infraestrutura e .gitignore
- Exclusão de `data/snapshots/`, `data/memory/`, ficheiros `.bak` e `.cursorrules` do controlo de versão.

### Painel Admin — Memória IA
- Endpoints `GET /api/admin/memory/reasoning` e `GET /api/admin/memory/corrections` (últimas 50 entradas, mais recentes primeiro).
- Secção **Memória IA** no painel com stats (`/memory/stats`), tabs Raciocínios/Correções e listagem com timestamp, siteId, input e output.

### Memória Semântica (pgvector)
- Modelo Prisma `MemoryVector` com coluna `embedding vector(1536)` (Unsupported no client).
- Migração SQL manual em `prisma/migrations/manual_pgvector.sql` (extensão `vector`, tabela, índices IVFFlat).
- `saveMemoryVector()` — persiste entradas na BD (embedding = null por agora).
- `searchMemory()` — busca textual ILIKE como fallback.
- `appendMemoryEntry()` também grava na tabela `MemoryVector` (JSONL + BD em paralelo).

### Chat — Contexto de Memória
- Quando `enableReact` está activo no site, o chat consulta `searchMemory()` e injecta até 3 memórias relevantes no `systemPrompt`.

### Stats Admin
- Campo `agenticSites` em `GET /api/admin/stats` — conta sites com `enableReact` ou `enableHumanApproval` activos.

---

## O que falta para a Fase 3 (Acções Proactivas)

1. **Embeddings reais** — gerar vectores com `text-embedding-3-small` (ou equivalente) ao guardar memória; popular coluna `embedding` e activar busca por similaridade coseno em vez de ILIKE.

2. **Índice IVFFlat útil** — o índice existe mas precisa de dados suficientes e `ANALYZE` após bulk load; considerar HNSW se a escala crescer.

3. **Acções proactivas** — agente que monitoriza conversas/sessões e:
   - detecta padrões (frustração, abandono, erros repetidos);
   - sugere ou executa follow-ups (email, notificação admin, mensagem proactiva no widget);
   - agenda tarefas com BullMQ/cron.

4. **Memória episódica por sessão** — resumos automáticos ao fechar sessão, injectados na próxima visita do mesmo utilizador.

5. **Correções humanas no viewer** — UI para editar/aprovar entradas de memória e re-indexar embeddings.

6. **Dashboard Fase 3** — métricas de acções proactivas disparadas, taxa de conversão pós-follow-up, alertas de anomalias.

7. **Extensão pgvector em produção** — garantir `postgresql-*-pgvector` instalado e `CREATE EXTENSION vector` executado pelo superuser em cada ambiente.

---

## Verificação

```bash
npx tsc --noEmit   # ✅ sem erros
```

Regra respeitada: apenas código **adicionado** — nenhuma função existente foi renomeada ou reescrita.
