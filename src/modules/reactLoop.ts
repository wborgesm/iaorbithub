import { callLLMAuto } from '../services/llm'
import { appendMemoryEntry } from './agenticMemory'
import type { LLMMessage, SupportedProvider } from '../types'

export async function generateReasoning(
  sessionId: string,
  siteId: string,
  userMessage: string,
  conversationContext: string,
  preferredProvider?: SupportedProvider,
): Promise<string> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `És um motor de raciocínio interno. Analisa a mensagem do utilizador e responde de forma estruturada:

1. O QUE QUER: o que o utilizador realmente precisa?
2. INFORMAÇÃO DISPONÍVEL: o que sei para responder?
3. ACÇÃO NECESSÁRIA: preciso de usar alguma ferramenta? Se sim, qual e porquê?
4. RISCO: existe algum risco nesta acção?
5. ABORDAGEM: qual é a melhor forma de responder?

Este raciocínio é interno — nunca é mostrado ao utilizador. Sê conciso.`,
    },
    {
      role: 'user',
      content: `Histórico recente:\n${conversationContext}\n\nMensagem actual: "${userMessage}"\n\nRaciocina sobre como responder.`,
    },
  ]

  try {
    const result = await callLLMAuto(messages, preferredProvider)
    const reasoning = result.content ?? ''
    if (reasoning) {
      void appendMemoryEntry({
        type: 'reasoning',
        sessionId,
        siteId,
        input: userMessage,
        output: reasoning,
      })
    }
    return reasoning
  } catch (err) {
    console.warn('[reactLoop] Falhou — a continuar sem raciocínio:', (err as Error).message)
    return ''
  }
}
