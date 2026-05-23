# ORBIT — Leitura de Email (Gmail IMAP)

## Contexto
AI Command Center — Express + TypeScript, porta 3002.
Credenciais já guardadas na BD SystemConfig:
- `orbit.gmail_user` — endereço Gmail
- `orbit.gmail_app_password` — App Password do Google (16 chars)

As credenciais lêem-se via `getOrbitConfig('gmail_user')` e `getOrbitConfig('gmail_app_password')`
(função já existe em `src/services/orbitConfig.ts`).

APENAS ADICIONAR código. Nunca alterar lógica existente.

---

## Tarefa 1 — Instalar dependência

```bash
cd /opt/ai-command-center && npm install imapflow
```

---

## Tarefa 2 — `src/services/emailReader.ts` (ficheiro novo)

Usar `imapflow` para ler emails via IMAP Gmail.

```ts
import { ImapFlow } from 'imapflow'
import { getOrbitConfig } from './orbitConfig'

export interface EmailSummary {
  id: string
  from: string
  subject: string
  date: string
  snippet: string   // primeiros 300 chars do corpo
  isRead: boolean
}

// Ler emails da caixa de entrada
export async function readEmails(options: {
  folder?: string    // default: 'INBOX'
  limit?: number     // default: 10
  onlyUnread?: boolean  // default: false
  search?: string    // filtro de texto no assunto/remetente
}): Promise<EmailSummary[]>

// Ler um email completo por ID
export async function readEmailById(id: string): Promise<{
  from: string
  to: string
  subject: string
  date: string
  body: string  // texto completo sem HTML
} | null>

// Listar pastas disponíveis
export async function listEmailFolders(): Promise<string[]>
```

Configuração IMAP para Gmail:
```ts
const client = new ImapFlow({
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: {
    user: await getOrbitConfig('gmail_user'),
    pass: await getOrbitConfig('gmail_app_password'),
  },
  logger: false,
})
```

Para extrair texto de HTML do corpo: usar regex simples para remover tags HTML
(não instalar bibliotecas extra — usar `body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()`).

Tratar erros de autenticação com mensagem clara: "Gmail não configurado ou App Password incorrecta".

---

## Tarefa 3 — Ferramentas em `src/services/toolExecution.ts`

Adicionar ao array TOOL_DEFINITIONS (nunca alterar existente):

```ts
{
  name: 'readEmails',
  description: 'Lê os emails de Wanderson. Pode filtrar por não lidos, pasta, ou termo de pesquisa.',
  parameters: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: 'Pasta a ler (default: INBOX). Exemplos: INBOX, Sent, Spam' },
      limit: { type: 'number', description: 'Quantos emails mostrar (default: 10, máx: 20)' },
      onlyUnread: { type: 'boolean', description: 'true para mostrar apenas emails não lidos' },
      search: { type: 'string', description: 'Filtrar por remetente ou assunto' }
    }
  }
},
{
  name: 'readEmailContent',
  description: 'Lê o conteúdo completo de um email específico pelo seu ID.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID do email (obtido com readEmails)' }
    },
    required: ['id']
  }
},
{
  name: 'listEmailFolders',
  description: 'Lista todas as pastas/etiquetas do email de Wanderson.',
  parameters: { type: 'object', properties: {} }
}
```

No switch de execução adicionar:
- `readEmails` → chama `emailReader.readEmails(args)`
- `readEmailContent` → chama `emailReader.readEmailById(args.id)`
- `listEmailFolders` → chama `emailReader.listEmailFolders()`

---

## Tarefa 4 — Disponibilizar ferramentas no site orbit.internal

Em `src/routes/chat.ts`, as ferramentas só são enviadas ao LLM se o site tiver `availableTools`.
Verificar como está configurado e garantir que `orbit.internal` tem acesso às novas ferramentas.

Se `availableTools` for um array de nomes de ferramentas por site, adicionar no DB:
```sql
UPDATE "AISite" SET "availableTools" = '["readEmails","readEmailContent","listEmailFolders","getBankBalance","getRecentTransactions","controlSmartHome","createCalendarEvent"]' WHERE domain = 'orbit.internal';
```

Se for controlado de outra forma, verificar a lógica e adaptar.

---

## Nota importante para o utilizador

Para o Gmail funcionar, o utilizador precisa de uma **App Password** — não a senha normal.
Se usar 2FA (recomendado): Google Account → Segurança → Verificação em 2 etapas → App Passwords → gerar para "Mail".
Se não usar 2FA: activar "Acesso a apps menos seguras" nas definições Google (não recomendado).

A App Password tem 16 caracteres sem espaços (ex: abcdabcdabcdabcd).

---

## Validação
`npx tsc --noEmit` deve passar sem erros.

## Commit
`feat(orbit): leitura de emails Gmail via IMAP — readEmails, readEmailContent, listEmailFolders`

## Resultado
ORBIT responde a "lê os meus emails" lendo directamente a caixa de entrada via IMAP.
