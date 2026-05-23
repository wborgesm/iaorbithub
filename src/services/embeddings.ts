import OpenAI from 'openai'
import { getNextAvailableKey } from './providerConfig'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Tenta OpenAI text-embedding-3-small
  try {
    const info = await getNextAvailableKey('OPENAI')
    if (info?.key) {
      const client = new OpenAI({ apiKey: info.key })
      const resp = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      })
      return resp.data[0]?.embedding ?? null
    }
  } catch {}

  // Tenta Cohere embed-english-light-v3.0
  try {
    const info = await getNextAvailableKey('COHERE')
    if (info?.key) {
      const resp = await fetch('https://api.cohere.com/v2/embed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${info.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: [text.slice(0, 8000)],
          model: 'embed-english-light-v3.0',
          input_type: 'search_document',
        }),
      })
      const data = await resp.json() as { embeddings?: number[][] }
      return data?.embeddings?.[0] ?? null
    }
  } catch {}

  return null
}
