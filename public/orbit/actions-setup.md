# Configurar ORBIT no Google Actions Console

## 1. Criar projecto

- Ir a [console.actions.google.com](https://console.actions.google.com)
- **New project** → nome: **ORBIT** → país: **Portugal**
- Tipo: **Custom** → **Blank project**

## 2. Invocação

- **Display name:** ORBIT
- **Pronunciation:** orbit
- O utilizador dirá: *"Hey Google, fala com ORBIT"* ou *"Hey Google, chama o ORBIT"*

## 3. Webhook (Fulfillment)

- **Develop** → **Webhook**
- **URL:** `https://ia.orbithubos.pt/api/orbit/google-action`
- Não precisa de autenticação HTTP extra (validação interna opcional via `ORBIT_GOOGLE_PROJECT_ID`)

## 4. Cenas (Scenes)

- Criar cena: **ORBIT_conversation**
- Em **When entering the scene** → **Webhook** → handler name: `orbit_message`
- Activar **Wait for user input** sempre

## 5. Main invocation

- **Webhook** → handler name: `actions.handler.MAIN`

## 6. Testar

- Clicar **Test** no console
- Dizer: *"Talk to ORBIT"*
- No Google Home: *"Hey Google, fala com ORBIT"*

## 7. Variáveis no servidor (`.env`)

```env
ORBIT_API_KEY=chave_aleatoria_segura_para_siri
IFTTT_WEBHOOK_KEY=chave_do_ifttt_maker
ORBIT_GOOGLE_PROJECT_ID=id_do_projecto_google_actions
```

## Fluxo de conversa

1. *"OK Google, chama o ORBIT"* → Google abre a Action
2. ORBIT: *"ORBIT online. O que precisas, Wanderson?"*
3. Conversa contínua — fala sem repetir *"Hey Google"* a cada frase
4. *"Olá Orbit, pode ir"* → *"ORBIT a encerrar. Até logo, Wanderson."*

## IFTTT (casa inteligente)

1. Entrar em [ifttt.com](https://ifttt.com)
2. Criar applet: **Webhooks** → **Google Home**
3. Event names: `orbit_luzes_sala_on`, `orbit_luzes_sala_off`, `orbit_aquecedor_on`, etc.
4. Copiar a Webhook key em [ifttt.com/maker/settings](https://ifttt.com/maker/settings)

## Siri Shortcut (iPhone)

1. **Atalhos** → Novo Atalho
2. **Ditar texto** → **Obter conteúdo de URL**
   - URL: `https://ia.orbithubos.pt/api/orbit/voice`
   - Método: **POST**
   - Headers: `x-orbit-key: <ORBIT_API_KEY>`
   - Body JSON: `{"message": [Texto Ditado], "sessionId": ""}`
3. **Falar texto** → campo `reply` do JSON
4. Frase Siri: **"ORBIT"**
