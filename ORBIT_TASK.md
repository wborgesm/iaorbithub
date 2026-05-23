# ORBIT — Interface Pessoal de Chat

## Contexto
AI Command Center — Express + TypeScript + Prisma, porta 3002, em `/opt/ai-command-center`.

Já existe na BD o site `orbit.internal` com `enableReact: true`.
Já existem:
- `POST /api/chat/session/domain` — cria sessão por domínio
- `POST /api/chat/send` — envia mensagem, recebe resposta IA
- Middleware `requireAdminAuth` em `src/middleware/adminAuth.ts`
- Cookie de autenticação `admin_token`

## O que construir (só adicionar, nunca alterar código existente)

---

### 1. `src/routes/orbit.ts` — ficheiro novo

```ts
import { Router, Request, Response } from 'express'
import path from 'path'

const router = Router()

router.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../public/orbit/index.html'))
})

export default router
```

---

### 2. `src/index.ts` — adicionar 2 linhas apenas

Após `import adminApiRouter from './routes/adminApi'` adicionar:
```ts
import orbitRouter from './routes/orbit'
```

Após `app.use('/api/admin', requireAdminAuth, adminApiRouter)` adicionar:
```ts
app.use('/orbit', requireAdminAuth, orbitRouter)
```

---

### 3. `public/orbit/index.html` — interface de chat full-screen

**Design:**
- Fundo `#0d1117`, texto `#e6edf3`, fonte `'Inter', system-ui, sans-serif`
- Header fixo com nome "ORBIT" em monospace, ponto verde animado (status Online/A pensar...)
- Área de mensagens com scroll automático, padding 16px
- Input fixo na base: textarea + botão enviar
- Mensagens do utilizador: alinhadas à direita, fundo `#1d4ed8`, texto branco, border-radius 16px 4px 16px 16px
- Mensagens ORBIT: alinhadas à esquerda, fundo `#1e2433`, texto `#e6edf3`, border-radius 4px 16px 16px 16px
- Animação typing: 3 pontos pulsantes enquanto aguarda
- Mobile-friendly (max-width 800px centrado)
- Links clicáveis: mesma lógica do `/widget.js` (renderBotText — escapa HTML, converte markdown links e URLs nuas em `<a target="_blank">`)

**Lógica JS:**

```
1. window.onload:
   - POST /api/chat/session/domain { domain: 'orbit.internal', pageUrl: location.href }
   - Guardar sessionId (localStorage para persistir entre reloads se quiser, ou só memória)
   - Mostrar mensagem de boas-vindas: "ORBIT online. Como posso ajudar, Wanderson?"

2. Enviar mensagem:
   - Mostra mensagem do utilizador imediatamente
   - Mostra animação typing
   - POST /api/chat/send { sessionId, message }
   - Remove typing, mostra resposta com renderBotText()
   - Scroll para o fundo

3. Input:
   - Enter → envia (sem Shift)
   - Shift+Enter → nova linha
   - Desactiva input/botão durante envio
```

---

## Validação final

Corre `npx tsc --noEmit` — deve passar sem erros.

Commit: `feat(orbit): interface pessoal de chat ORBIT`

---

## Resultado esperado

Após deploy, `https://ia.orbithubos.pt/orbit` (com login admin) abre uma interface de chat
full-screen escura onde Wanderson pode falar directamente com o ORBIT.
