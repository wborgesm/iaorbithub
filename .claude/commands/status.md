Verifica o estado completo do AI Command Center e responde de forma conversacional.

Faz as seguintes verificações e apresenta um resumo claro:

1. Estado do serviço: `systemctl status ai-command-center --no-pager | grep Active`
2. Últimos 5 commits: `git -C /opt/ai-command-center log --oneline -5`
3. Estado dos providers (via API): login + GET /api/admin/providers/status
4. Métricas de memória: GET /api/admin/memory/stats
5. Aprovações pendentes: GET /api/admin/approvals
6. Erros recentes nos logs: `journalctl -u ai-command-center -n 20 --no-pager | grep -i error`

Apresenta tudo de forma conversacional, como se estivesses a fazer um briefing rápido.
Destaca problemas a vermelho (❌) e coisas a funcionar a verde (✅).
