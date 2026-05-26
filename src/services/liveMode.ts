// Orquestrador do Modo Live: STT → Ollama → Kokoro → audio stream
// Usado pelo WebSocket handler em src/index.ts

import { ollamaChat } from './ollamaService'

const STT_URL = process.env.STT_URL || 'http://127.0.0.1:8881'
const TTS_URL = process.env.TTS_URL || 'http://127.0.0.1:8882'

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' }), 'audio.webm')

  const res = await fetch(`${STT_URL}/transcribe`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`STT error ${res.status}`)
  const data = await res.json() as { text: string }
  return data.text?.trim() ?? ''
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const res = await fetch(`${TTS_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: 'af_heart', speed: 1.0 }),
  })
  if (!res.ok) throw new Error(`TTS error ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export interface LiveSession {
  abort: () => void
}

/**
 * Pipeline completo: texto do utilizador → Ollama streaming → TTS → chunks de áudio
 * onAudioChunk é chamado com cada WAV chunk assim que o Kokoro o gera
 */
export async function runLivePipeline(
  userText: string,
  history: Array<{ role: string; content: string }>,
  onTextChunk: (text: string) => void,
  onAudioChunk: (wav: Buffer) => void,
  onDone: (fullReply: string) => void,
  onError: (err: string) => void,
): Promise<LiveSession> {
  const controller = new AbortController()
  let fullReply = ''
  let pendingText = ''

  // Frases que justificam enviar ao TTS (pontuação natural)
  const FLUSH_REGEX = /[.!?…\n]/

  const flushTTS = async (text: string) => {
    const clean = text.trim()
    if (!clean) return
    try {
      const wav = await synthesizeSpeech(clean)
      onAudioChunk(wav)
    } catch (e) {
      // TTS falhou — continua sem áudio para este chunk
      console.warn('[liveMode] TTS chunk falhou:', (e as Error).message)
    }
  }

  ;(async () => {
    try {
      const messages = [
        ...history,
        { role: 'user', content: userText },
      ]

      await ollamaChat(messages, async (chunk) => {
        if (controller.signal.aborted) return
        onTextChunk(chunk.content)
        fullReply += chunk.content
        pendingText += chunk.content

        // Enviar ao TTS em frases naturais (não palavra a palavra)
        if (FLUSH_REGEX.test(pendingText)) {
          const toSend = pendingText
          pendingText = ''
          await flushTTS(toSend)
        }
      }, controller.signal)

      // Flush final se sobrar texto
      if (pendingText.trim()) await flushTTS(pendingText)
      onDone(fullReply)
    } catch (e) {
      if (!controller.signal.aborted) {
        onError((e as Error).message)
      }
    }
  })()

  return { abort: () => controller.abort() }
}
