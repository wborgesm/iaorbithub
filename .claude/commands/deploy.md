Faz deploy das alterações no AI Command Center no servidor de produção.

Executa por ordem:
1. `ssh root@autotrack.pt "cd /opt/ai-command-center && git pull origin main 2>&1"`
2. `ssh root@autotrack.pt "cd /opt/ai-command-center && npx tsc 2>&1"`
   - Se houver erros de TypeScript, para e mostra os erros. Não continua.
3. `ssh root@autotrack.pt "systemctl restart ai-command-center && sleep 3 && systemctl status ai-command-center --no-pager | grep Active"`
4. `ssh root@autotrack.pt "journalctl -u ai-command-center -n 10 --no-pager"`

Reporta cada passo. Se algum falhar, diagnostica e propõe solução antes de continuar.
