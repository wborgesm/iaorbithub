# ORBIT — Painel de Configuração

## Contexto
AI Command Center — Express + TypeScript + Prisma, porta 3002.
`SystemConfig` já existe na BD (colunas: key TEXT, value TEXT, updatedAt TIMESTAMP).
É usada pelo `emailService.ts` com chaves como `smtp.host`, `smtp.user`, etc.
A página `/orbit` já existe em `public/orbit/index.html` (protegida por cookie admin).
O backend lê configs: `prisma.systemConfig.findMany()`.

## Objectivo
Adicionar um painel de configuração na página `/orbit` onde Wanderson gere todas
as chaves e credenciais do ORBIT — sem tocar no .env.

---

## Tarefa 1 — Endpoints de config em `src/routes/orbitVoice.ts`

Adicionar (nunca alterar o existente):

```
GET  /api/orbit/config        → devolve todas as chaves orbit.* da BD (valores mascarados: só últimos 4 chars)
POST /api/orbit/config        → salva/actualiza uma chave { key, value }
DELETE /api/orbit/config/:key → apaga uma chave
```

Proteger com `requireAdminAuth` (importar de `../middleware/adminAuth`).

Lógica de GET — mascarar valores sensíveis:
```ts
// Para cada entrada com key que começa por "orbit."
// Se value.length > 8: mostrar "••••••••" + value.slice(-4)
// Senão: "••••"
// Excepção: orbit.google_project_id pode ser mostrado em claro (não é segredo)
```

Lógica de POST:
```ts
// Upsert na SystemConfig: se key existir actualiza, senão insere
// Validar que key começa por "orbit." (rejeitar outras)
```

Registar as rotas em `src/index.ts` sob `requireAdminAuth`:
```ts
// Adicionar junto às outras rotas admin — usar o mesmo router orbitVoice
// app.use('/api/orbit', requireAdminAuth, orbitConfigRouter)  ← já deve existir, só garantir que as novas rotas ficam protegidas
```

Actualizar `src/routes/orbitVoice.ts` para ler chaves da BD em vez de process.env:
```ts
// Função helper:
async function getOrbitConfig(key: string): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { key: `orbit.${key}` } })
  return row?.value || process.env[key.toUpperCase().replace('.', '_')] || ''
}
// Usar em vez de process.env.ORBIT_API_KEY → getOrbitConfig('api_key')
// Usar em vez de process.env.IFTTT_WEBHOOK_KEY → getOrbitConfig('ifttt_key')
```

---

## Tarefa 2 — Secção de configuração em `public/orbit/index.html`

Adicionar botão de engrenagem (⚙) no header da página `/orbit`, ao lado do título "ORBIT".

Ao clicar: abre painel lateral (ou modal) com os campos de configuração:

### Grupos de configuração:

**Voz & Integrações**
| Chave (orbit.*) | Label | Tipo |
|---|---|---|
| `api_key` | API Key (Siri/externa) | password |
| `ifttt_key` | IFTTT Webhook Key | password |
| `google_project_id` | Google Actions Project ID | text |

**Email (Gmail)**
| Chave | Label | Tipo |
|---|---|---|
| `gmail_user` | Gmail (utilizador) | text |
| `gmail_app_password` | Gmail App Password | password |

**WhatsApp**
| Chave | Label | Tipo |
|---|---|---|
| `whatsapp_api_url` | WhatsApp API URL | text |
| `whatsapp_api_key` | WhatsApp API Key | password |

**Calendário**
| Chave | Label | Tipo |
|---|---|---|
| `gcal_client_id` | Google Calendar Client ID | text |
| `gcal_client_secret` | Google Calendar Secret | password |
| `gcal_refresh_token` | Refresh Token | password |

Comportamento do painel:
- Ao abrir: GET /api/orbit/config → preenche campos com valores mascarados
- Campos type="password" — não mostrar valor actual, só placeholder "••••••••••••" se já tiver valor
- Botão "Guardar" por grupo → POST /api/orbit/config para cada campo alterado
- Botão de lixo por campo → DELETE /api/orbit/config/:key
- Feedback visual: "Guardado ✓" ou "Erro ✗"
- Design consistente com o resto da página /orbit (fundo escuro, accent azul)

---

## Validação
`npx tsc --noEmit` deve passar sem erros.

## Commit
`feat(orbit): painel de configuração — chaves e credenciais geridas pela UI`

## Resultado
Wanderson entra em `https://ia.orbithubos.pt/orbit`, clica ⚙, e configura:
- IFTTT key → ORBIT passa a controlar a casa
- Gmail → ORBIT passa a ler/enviar emails
- Tudo guardado na BD de forma segura, nunca exposto em plain text
