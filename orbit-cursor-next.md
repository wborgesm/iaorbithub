# orbit-cursor-next.md
**Gerado:** 2026-05-24 22:33 | **Por:** scripts/orbitMonitor.js
**Plano completo:** /opt/ai-command-center/orbit-plan.md

## URGENTE (2 itens — resolver primeiro)
- [P4] criticalAlertMonitor falso positivo (grep apanha o próprio log)
- [quota] Todos os providers em cooldown simultâneo → ORBIT indisponível

## Atenção (1 itens)
- [chat] Erro não-429 no endpoint chat/send

## Próximos passos do plano (ordem recomendada):
```
1. 1 — Corrigir `habitSignature` para não contar hábitos com dados inválidos
2. 2 — Adicionar campo `phone` ao schema de `rememberFact` + lookup por nome
3. 3 — Criar função `resolveContactPhone` e usá-la em `sendWhatsApp`
4. 4 — Criar ferramenta `readWhatsAppMessages`
5. 5 — Corrigir `criticalAlertMonitor` — excluir linhas do próprio monitor
6. 6 — SIGTERM graceful shutdown (Puppeteer não bloqueia restart)
7. 7 — Regra ORBIT: pedir número ANTES de chamar sendWhatsApp
```

## Regras (não alterar):
- Nunca mudar layout, refactorizar variáveis ou alterar schema Prisma
- Adicionar blocos `else if` inline nos ficheiros indicados
- Compilar: `npx tsc` | Reiniciar: `systemctl restart ai-command-center`
- Após deploy: `psql ... UPDATE "SystemConfig" SET value='{}' WHERE key='orbit.habit_trust'`