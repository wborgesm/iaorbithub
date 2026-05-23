# ORBIT — Voz em Tempo Real (Web Speech API)

## Objectivo
Conversa contínua por voz directamente no browser em `/orbit`.
Sem APIs externas — usa Web Speech API nativa do Chrome.

Fluxo:
1. Utilizador clica "🎤 Activar voz" 
2. ORBIT fica a ouvir continuamente (microfone sempre activo)
3. Quando o utilizador para de falar → envia automaticamente para o ORBIT
4. ORBIT responde em voz (SpeechSynthesis) e em texto no chat
5. Após terminar de falar → volta a ouvir automaticamente
6. Ao dizer **"pode ir"** → desactiva o microfone e para a sessão de voz

---

## Alterações em `public/orbit/index.html`

### 1. Adicionar botão de voz na barra de input

Localizar a zona do input de texto (onde está o botão de enviar) e adicionar ao lado:

```html
<button id="btn-voice" onclick="toggleVoice()" title="Activar/desactivar voz" class="btn-voice">
  🎤
</button>
```

### 2. Adicionar indicador de estado de voz

Logo acima do input, adicionar (inicialmente oculto):

```html
<div id="voice-status" class="voice-status-bar" style="display:none">
  <span id="voice-state-icon">🎤</span>
  <span id="voice-state-text">A ouvir...</span>
  <span id="voice-interim" class="voice-interim"></span>
</div>
```

### 3. Adicionar CSS no `<style>` existente

```css
.btn-voice {
  background: transparent;
  border: 1px solid #444;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}
.btn-voice.active {
  background: #1a3a1a;
  border-color: #4CAF50;
  animation: pulse-mic 1.5s infinite;
}
.btn-voice.speaking {
  background: #1a2a3a;
  border-color: #2196F3;
}
@keyframes pulse-mic {
  0%, 100% { box-shadow: 0 0 0 0 rgba(76,175,80,0.4); }
  50% { box-shadow: 0 0 0 8px rgba(76,175,80,0); }
}
.voice-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #1a1a2e;
  border-top: 1px solid #333;
  font-size: 13px;
  color: #aaa;
}
.voice-interim {
  font-style: italic;
  color: #666;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### 4. Adicionar o bloco JavaScript completo no final do `<script>` existente

```javascript
// ─── ORBIT VOICE ────────────────────────────────────────────────────────────

let voiceActive = false
let recognition = null
let synth = window.speechSynthesis
let isSpeaking = false
let voiceSessionId = null

const STOP_PHRASES = ['pode ir', 'orbit pode ir', 'olá orbit pode ir', 'desliga', 'para a voz']

function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) {
    alert('O teu browser não suporta reconhecimento de voz. Usa Chrome.')
    return null
  }
  const r = new SR()
  r.lang = 'pt-PT'
  r.continuous = false       // uma frase de cada vez — mais fiável
  r.interimResults = true
  r.maxAlternatives = 1

  r.onstart = () => {
    setVoiceState('listening')
  }

  r.onresult = (e) => {
    let interim = ''
    let final = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) final += t
      else interim += t
    }
    if (interim) document.getElementById('voice-interim').textContent = interim
    if (final) {
      document.getElementById('voice-interim').textContent = ''
      handleVoiceInput(final.trim())
    }
  }

  r.onerror = (e) => {
    if (e.error === 'no-speech') {
      // sem input — reinicia ouvir
      if (voiceActive && !isSpeaking) startListening()
      return
    }
    console.warn('Voice error:', e.error)
    if (voiceActive && !isSpeaking) setTimeout(startListening, 1000)
  }

  r.onend = () => {
    if (voiceActive && !isSpeaking) {
      setTimeout(startListening, 300)
    }
  }

  return r
}

function startListening() {
  if (!voiceActive || isSpeaking) return
  if (!recognition) recognition = initRecognition()
  if (!recognition) return
  try { recognition.start() } catch(e) { /* já está a correr */ }
}

function stopListening() {
  if (recognition) {
    try { recognition.stop() } catch(e) {}
  }
}

function setVoiceState(state) {
  const icon = document.getElementById('voice-state-icon')
  const text = document.getElementById('voice-state-text')
  if (!icon) return
  if (state === 'listening') { icon.textContent = '🎤'; text.textContent = 'A ouvir...' }
  else if (state === 'thinking') { icon.textContent = '⏳'; text.textContent = 'A pensar...' }
  else if (state === 'speaking') { icon.textContent = '🔊'; text.textContent = 'A falar...' }
}

async function handleVoiceInput(text) {
  if (!text) return

  // Verificar stop phrase
  const lower = text.toLowerCase().replace(/[.,!?]/g, '').trim()
  if (STOP_PHRASES.some(p => lower.includes(p))) {
    speak('Até logo, Wanderson.')
    setTimeout(() => deactivateVoice(), 2000)
    return
  }

  stopListening()
  setVoiceState('thinking')

  // Mostrar no chat como mensagem do utilizador
  addMsg('user', text)

  try {
    const body = { message: text, sessionId: voiceSessionId || undefined }
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-site-domain': 'orbit.internal', 'x-orbit-key': ORBIT_KEY },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.sessionId) voiceSessionId = data.sessionId

    const reply = data.reply || data.message || ''
    addMsg('bot', reply)
    speak(reply)
  } catch(e) {
    speak('Ocorreu um erro. Tenta novamente.')
    setVoiceState('listening')
    if (voiceActive) startListening()
  }
}

function speak(text) {
  if (!text) { isSpeaking = false; if (voiceActive) startListening(); return }

  // Limpar markdown para TTS
  const clean = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`(.+?)`/g, '$1')
    .slice(0, 500) // limitar comprimento para TTS

  synth.cancel()
  const utt = new SpeechSynthesisUtterance(clean)
  utt.lang = 'pt-PT'
  utt.rate = 1.05
  utt.pitch = 1.0

  // Tentar usar voz portuguesa se disponível
  const voices = synth.getVoices()
  const ptVoice = voices.find(v => v.lang.startsWith('pt') && v.name.toLowerCase().includes('female'))
    || voices.find(v => v.lang.startsWith('pt'))
  if (ptVoice) utt.voice = ptVoice

  isSpeaking = true
  setVoiceState('speaking')
  document.getElementById('btn-voice')?.classList.replace('active', 'speaking')

  utt.onend = () => {
    isSpeaking = false
    if (voiceActive) {
      document.getElementById('btn-voice')?.classList.replace('speaking', 'active')
      startListening()
    }
  }

  utt.onerror = () => {
    isSpeaking = false
    if (voiceActive) startListening()
  }

  synth.speak(utt)
}

function toggleVoice() {
  if (voiceActive) {
    deactivateVoice()
  } else {
    activateVoice()
  }
}

function activateVoice() {
  voiceActive = true
  recognition = initRecognition()
  if (!recognition) { voiceActive = false; return }

  document.getElementById('btn-voice').classList.add('active')
  document.getElementById('btn-voice').textContent = '🎤'
  document.getElementById('voice-status').style.display = 'flex'

  speak('Estou a ouvir, Wanderson.')
}

function deactivateVoice() {
  voiceActive = false
  isSpeaking = false
  stopListening()
  synth.cancel()

  document.getElementById('btn-voice').classList.remove('active', 'speaking')
  document.getElementById('btn-voice').textContent = '🎤'
  document.getElementById('voice-status').style.display = 'none'
  document.getElementById('voice-interim').textContent = ''
  voiceSessionId = null
}
// ─── FIM VOICE ───────────────────────────────────────────────────────────────
```

---

## Notas importantes

- **Só funciona em HTTPS** — já está em `ia.orbithubos.pt` (ok)
- **Chrome/Edge/Android Chrome** — melhor suporte. Safari tem suporte parcial.
- **Não precisa de nenhuma API externa** — tudo nativo do browser
- O botão de voz fica ao lado do botão de enviar
- A sessão de voz mantém o `sessionId` para contexto contínuo
- `continuous: false` + reinício automático é mais fiável que `continuous: true`

---

## Compilar e deployar

```bash
cd /opt/ai-command-center
npx tsc --noEmit
# public/orbit/index.html não precisa de compilação TypeScript
systemctl restart ai-command-center
sleep 2
systemctl status ai-command-center --no-pager | grep Active
```

