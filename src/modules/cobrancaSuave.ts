import { callLLMAuto } from '../services/llm'

export interface FaturaAtrasada {
  cliente: string
  valor: number
  diasAtraso: number
  referencia?: string
}

export async function gerarCobrancaSuave(faturas: FaturaAtrasada[]): Promise<string> {
  const lista = faturas.map(f =>
    `- ${f.cliente}: €${f.valor.toFixed(2)}, ${f.diasAtraso} dias em atraso${f.referencia ? `, ref. ${f.referencia}` : ''}`,
  ).join('\n')

  const prompt = `Gera uma mensagem de cobrança educada em português de Portugal para enviar por email ou WhatsApp.
Usa vocabulário PT-PT (multibanco, telemóvel, fatura, cumprimentos).
Tom: cordial, profissional, sem ameaças.
Faturas em atraso:
${lista}

Responde só com o texto da mensagem, pronto a enviar.`

  const result = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
  return result.content?.trim() || 'Olá, verificámos que existe uma fatura pendente. Pode regularizar via multibanco quando lhe for conveniente? Obrigado.'
}
