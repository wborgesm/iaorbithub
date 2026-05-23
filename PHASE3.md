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
