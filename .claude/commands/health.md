Faz uma verificação completa de saúde do AI Command Center e reporta o estado.

Executa por ordem:

1. **Serviço:**
   `ssh -i ~/.ssh/id_ed25519_vps root@autotrack.pt "systemctl status ai-command-center --no-pager | grep -E 'Active|Memory|CPU'"`

2. **Erros recentes (últimos 30 min):**
   `ssh -i ~/.ssh/id_ed25519_vps root@autotrack.pt "journalctl -u ai-command-center --since '30 min ago' --no-pager | grep -iE 'error|fatal|crash|unhandled' | tail -10"`

3. **TypeScript (só se houver commits novos desde o último check):**
   `ssh -i ~/.ssh/id_ed25519_vps root@autotrack.pt "cd /opt/ai-command-center && git log --oneline -3"`

4. **Memória e actividade:**
   Faz login na API e verifica:
   - GET /api/admin/memory/stats
   - GET /api/admin/approvals (aprovações pendentes?)
   - GET /api/admin/stats (sessões hoje)

5. **Providers:**
   GET /api/admin/providers/status — algum em cooldown prolongado?

Apresenta um resumo em formato de dashboard:
```
✅ Serviço: activo (Xh Ymin)
✅/❌ Erros: N nos últimos 30min
✅/⚠️  Providers: GROQ ok | GEMINI ok | ...
📊 Memória: X raciocínios | Y correções
🔔 Aprovações pendentes: N
💬 Sessões hoje: N
```

Se encontrares algo quebrado, tenta corrigir autonomamente antes de reportar.
Se houver commits novos não deployados, faz build e restart.
