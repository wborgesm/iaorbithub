;(function () {
  'use strict'

  const SCRIPT = document.currentScript
  const BASE_URL = 'https://ia.orbithubos.pt'
  const DOMAIN = (SCRIPT && SCRIPT.getAttribute('data-domain')) || window.location.hostname
  const POSITION = (SCRIPT && SCRIPT.getAttribute('data-position')) || 'bottom-right'
  const BRAND_COLOR = (SCRIPT && SCRIPT.getAttribute('data-color')) || '#3b82f6'
  const WIDGET_LABEL = (SCRIPT && SCRIPT.getAttribute('data-label')) || 'Falar com IA'

  let sessionId = null
  let open = false
  let sending = false

  // ── Styles ──────────────────────────────────────────────────────────────────
  const css = `
    #aic-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #aic-btn {
      position: fixed; ${POSITION.includes('right') ? 'right:20px' : 'left:20px'}; bottom: 20px; z-index: 99999;
      background: ${BRAND_COLOR}; color: #fff; border: none; border-radius: 50px;
      padding: 12px 20px; cursor: pointer; font-size: 14px; font-weight: 600;
      display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,.25);
      transition: transform .15s, box-shadow .15s;
    }
    #aic-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,.3); }
    #aic-btn svg { width:18px; height:18px; flex-shrink:0; }
    #aic-badge {
      position: absolute; top: -4px; right: -4px; background: #ef4444;
      width: 10px; height: 10px; border-radius: 50%; display: none;
    }
    #aic-panel {
      position: fixed; ${POSITION.includes('right') ? 'right:16px' : 'left:16px'}; bottom: 80px; z-index: 99998;
      width: 360px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,.2);
      display: none; flex-direction: column; overflow: hidden;
      border: 1px solid rgba(0,0,0,.08);
    }
    #aic-panel.open { display: flex; }
    #aic-header {
      background: ${BRAND_COLOR}; color: #fff; padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
    }
    #aic-header-info { display: flex; align-items: center; gap: 10px; }
    #aic-avatar {
      width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.2);
      display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    #aic-header-name { font-size: 14px; font-weight: 700; }
    #aic-header-status { font-size: 11px; opacity: .8; }
    #aic-close { background: none; border: none; color: #fff; cursor: pointer; opacity: .8; padding: 4px; border-radius: 4px; }
    #aic-close:hover { opacity: 1; background: rgba(255,255,255,.15); }
    #aic-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;
      background: #f8fafc;
    }
    .aic-msg { max-width: 85%; padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; word-break: break-word; }
    .aic-msg.bot { background: #fff; border: 1px solid #e2e8f0; border-radius: 4px 12px 12px 12px; align-self: flex-start; color: #1e293b; }
    .aic-msg.user { background: ${BRAND_COLOR}; color: #fff; border-radius: 12px 4px 12px 12px; align-self: flex-end; }
    .aic-msg.typing { color: #94a3b8; font-style: italic; }
    #aic-footer { padding: 12px; background: #fff; border-top: 1px solid #e2e8f0; flex-shrink: 0; }
    #aic-form { display: flex; gap: 8px; }
    #aic-input {
      flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px 12px;
      font-size: 13px; outline: none; color: #1e293b; background: #f8fafc; resize: none;
      height: 38px; max-height: 120px; overflow-y: auto;
    }
    #aic-input:focus { border-color: ${BRAND_COLOR}; background: #fff; }
    #aic-send {
      background: ${BRAND_COLOR}; color: #fff; border: none; border-radius: 10px;
      width: 38px; height: 38px; cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity .15s;
    }
    #aic-send:disabled { opacity: .4; cursor: default; }
    #aic-powered { text-align: center; font-size: 10px; color: #94a3b8; padding: 6px 0 0; }
    #aic-powered a { color: #94a3b8; text-decoration: none; }
  `

  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  // ── DOM ──────────────────────────────────────────────────────────────────────
  const root = document.createElement('div')
  root.id = 'aic-widget'
  root.innerHTML = `
    <button id="aic-btn" title="${WIDGET_LABEL}">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 00-1.032-.211 50.89 50.89 0 00-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 002.433 3.984L7.28 21.53A.75.75 0 016 21v-4.03a48.527 48.527 0 01-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 001.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0015.75 7.5z"/></svg>
      ${WIDGET_LABEL}
      <span id="aic-badge"></span>
    </button>
    <div id="aic-panel">
      <div id="aic-header">
        <div id="aic-header-info">
          <div id="aic-avatar"></div>
          <div>
            <div id="aic-header-name">Assistente IA</div>
            <div id="aic-header-status">Online</div>
          </div>
        </div>
        <button id="aic-close" title="Fechar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div id="aic-messages"></div>
      <div id="aic-footer">
        <div id="aic-form">
          <textarea id="aic-input" placeholder="Escreva a sua mensagem…" rows="1"></textarea>
          <button id="aic-send" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/></svg>
          </button>
        </div>
        <div id="aic-powered">Desenvolvido com <a href="https://ia.orbithubos.pt" target="_blank" rel="noopener">OrbitHub AI</a></div>
      </div>
    </div>
  `
  document.body.appendChild(root)

  const btn = document.getElementById('aic-btn')
  const panel = document.getElementById('aic-panel')
  const messages = document.getElementById('aic-messages')
  const input = document.getElementById('aic-input')
  const sendBtn = document.getElementById('aic-send')

  // ── Session init ──────────────────────────────────────────────────────────────
  async function initSession() {
    try {
      const r = await fetch(BASE_URL + '/api/chat/session/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: DOMAIN, pageUrl: window.location.href }),
        credentials: 'omit',
      })
      const data = await r.json()
      if (!r.ok || !data.sessionId) throw new Error(data.error || 'Erro ao iniciar sessão')
      sessionId = data.sessionId

      if (!data.isActive) {
        addMsg('bot', 'O assistente está temporariamente indisponível. Por favor contacte-nos directamente.')
        sendBtn.disabled = true
        input.disabled = true
        return
      }

      addMsg('bot', 'Ola! Estou aqui para ajudar. Como posso ser útil hoje?')
      sendBtn.disabled = false
    } catch (e) {
      addMsg('bot', 'Não foi possível conectar ao assistente. Tente mais tarde.')
    }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  function addMsg(role, text) {
    const div = document.createElement('div')
    div.className = 'aic-msg ' + role
    div.textContent = text
    messages.appendChild(div)
    messages.scrollTop = messages.scrollHeight
    return div
  }

  function showTyping() {
    return addMsg('bot typing', '…')
  }

  // ── Send message ──────────────────────────────────────────────────────────────
  async function send() {
    if (sending || !sessionId) return
    const msg = input.value.trim()
    if (!msg) return

    sending = true
    sendBtn.disabled = true
    input.value = ''
    input.style.height = '38px'
    addMsg('user', msg)

    const typingEl = showTyping()
    try {
      const r = await fetch(BASE_URL + '/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: msg }),
        credentials: 'omit',
      })
      const data = await r.json()
      typingEl.remove()

      if (data.offline) {
        addMsg('bot', data.message || 'Assistente temporariamente indisponível.')
        sendBtn.disabled = true
        input.disabled = true
      } else if (data.content) {
        addMsg('bot', data.content)
      } else if (data.error) {
        addMsg('bot', 'Ocorreu um erro. Por favor tente novamente.')
      }
    } catch (e) {
      typingEl.remove()
      addMsg('bot', 'Erro de ligação. Verifique a sua conexão e tente novamente.')
    } finally {
      sending = false
      if (!input.disabled) sendBtn.disabled = false
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  btn.addEventListener('click', () => {
    open = !open
    panel.classList.toggle('open', open)
    if (open && !sessionId) initSession()
    if (open) setTimeout(() => input.focus(), 100)
  })

  document.getElementById('aic-close').addEventListener('click', () => {
    open = false
    panel.classList.remove('open')
  })

  sendBtn.addEventListener('click', send)

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  })

  input.addEventListener('input', () => {
    input.style.height = '38px'
    input.style.height = Math.min(input.scrollHeight, 120) + 'px'
  })

})()
