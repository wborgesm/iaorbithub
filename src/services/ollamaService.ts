// Cliente Ollama — OpenAI-compatible API em localhost:11434
// NÃO altera nenhum ficheiro existente; é apenas um serviço novo

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'

export interface OllamaStreamChunk {
  content: string
  done: boolean
}

export async function ollamaChat(
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: OllamaStreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: true }),
    signal,
  })

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`)
  if (!res.body) throw new Error('Ollama: sem body na resposta')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const json = JSON.parse(line)
        const content = json.message?.content ?? ''
        onChunk({ content, done: json.done ?? false })
      } catch { /* ignorar linhas incompletas */ }
    }
  }
}

export async function ollamaHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

export async function ollamaListModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`)
    const data = await res.json() as { models?: Array<{ name: string }> }
    return (data.models ?? []).map(m => m.name)
  } catch {
    return []
  }
}
