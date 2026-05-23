Mostra os logs recentes do AI Command Center e explica o que está a acontecer.

1. `ssh root@autotrack.pt "journalctl -u ai-command-center -n 50 --no-pager"`
2. Analisa os logs e explica:
   - Há erros? O que significam?
   - Algum provider em cooldown?
   - Chamadas de ferramentas recentes?
   - Alertas de frustração detectados?
3. Se houver problemas, sugere como resolver.
