import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { LLMMessage, LLMResponse, SupportedProvider } from '../types'
import { getEnabledProviders, markProviderCooldown, markKeyCooldown, getNextAvailableKey, isOnCooldown } from './providerConfig'

const DEFAULT_MODELS: Record<SupportedProvider, string> = {
  CLAUDE:       'claude-haiku-4-5-20251001',
  OPENAI:       'gpt-4o-mini',
  GEMINI:       'gemini-2.0-flash',
  DEEPSEEK:     'deepseek-chat',
  GROQ:         'llama-3.3-70b-versatile',
  OPENROUTER:   'meta-llama/llama-3.3-70b-instruct:free',
  COHERE:       'command-r-plus',
  HUGGINGFACE:  'mistralai/Mistral-7B-Instruct-v0.3',
}

function buildOpenAIClient(provider: SupportedProvider, key: string): OpenAI {
  if (provider === 'DEEPSEEK')    return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' })
  if (provider === 'GROQ')        return new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' })
  if (provider === 'OPENROUTER')  return new OpenAI({ apiKey: key, baseURL: 'https://openrouter.ai/api/v1', defaultHeaders: { 'HTTP-Referer': 'https://ia.orbithubos.pt', 'X-Title': 'AI Command Center' } })
  if (provider === 'COHERE')      return new OpenAI({ apiKey: key, baseURL: 'https://api.cohere.com/compatibility/v1' })
  if (provider === 'HUGGINGFACE') return new OpenAI({ apiKey: key, baseURL: 'https://api-inference.huggingface.co/v1' })
  return new OpenAI({ apiKey: key })
}

// ── Chamada com rotação de chaves para um provider ──────────────────────────
async function callWithKeyRotation(
  provider: SupportedProvider,
  messages: LLMMessage[],
  tools?: object[],
): Promise<LLMResponse> {
  const info = await getNextAvailableKey(provider)
  if (!info) throw new Error(`${provider}: sem chave disponível (todas em cooldown ou não configuradas)`)

  const model = info.model || DEFAULT_MODELS[provider]

  try {
    return await callWithKey(provider, info.key, model, messages, tools)
  } catch (e) {
    if (isQuotaError(e)) {
      markKeyCooldown(provider, info.keyIdx)
      console.warn(`[llm] ${provider} chave ${info.keyIdx + 1} em cooldown — a tentar próxima chave...`)
      // Tentar próxima chave disponível
      const info2 = await getNextAvailableKey(provider)
      if (info2) {
        try {
          return await callWithKey(provider, info2.key, model, messages, tools)
        } catch (e2) {
          if (isQuotaError(e2)) {
            markKeyCooldown(provider, info2.keyIdx)
            const info3 = await getNextAvailableKey(provider)
            if (info3) return await callWithKey(provider, info3.key, model, messages, tools)
          }
          throw e2
        }
      }
    }
    throw e
  }
}

async function callWithKey(
  provider: SupportedProvider,
  key: string,
  model: string,
  messages: LLMMessage[],
  tools?: object[],
): Promise<LLMResponse> {
  if (provider === 'CLAUDE') {
    const anthropic = new Anthropic({ apiKey: key })
    const systemMsg = messages.find(m => m.role === 'system')
    const chatMsgs = messages.filter(m => m.role !== 'system')
    const resp = await anthropic.messages.create({
      model, max_tokens: 1024,
      system: systemMsg?.content,
      messages: chatMsgs as Anthropic.MessageParam[],
      tools: tools as Anthropic.Tool[] | undefined,
    })
    const textBlock = resp.content.find(b => b.type === 'text')
    const toolUseBlocks = resp.content.filter(b => b.type === 'tool_use')
    return {
      content: textBlock?.type === 'text' ? textBlock.text : null,
      tool_calls: toolUseBlocks.map(b => ({
        id: b.type === 'tool_use' ? b.id : '',
        type: 'function' as const,
        function: { name: b.type === 'tool_use' ? b.name : '', arguments: b.type === 'tool_use' ? JSON.stringify(b.input) : '{}' },
      })),
      promptTokens: resp.usage.input_tokens,
      completionTokens: resp.usage.output_tokens,
      model,
    }
  }

  if (provider === 'GEMINI') {
    const geminiClient = new GoogleGenerativeAI(key)
    const systemMsg = messages.find(m => m.role === 'system')
    const chatMsgs = messages.filter(m => m.role !== 'system')
    const geminiModel = geminiClient.getGenerativeModel({ model, systemInstruction: systemMsg?.content })
    const history = chatMsgs.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const lastMsg = chatMsgs[chatMsgs.length - 1]
    const chat = geminiModel.startChat({ history })
    const result = await chat.sendMessage(lastMsg?.content || '')
    const text = result.response.text()
    const usage = result.response.usageMetadata
    return { content: text, tool_calls: [], promptTokens: usage?.promptTokenCount ?? 0, completionTokens: usage?.candidatesTokenCount ?? 0, model }
  }

  const client = buildOpenAIClient(provider, key)
  const resp = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
    tools: tools as OpenAI.Chat.ChatCompletionTool[] | undefined,
  })
  const choice = resp.choices[0]
  const toolCalls = choice?.message?.tool_calls ?? []
  return {
    content: choice?.message?.content ?? null,
    tool_calls: toolCalls.map(tc => {
      const fn = 'function' in tc ? tc.function : { name: '', arguments: '{}' }
      return { id: tc.id, type: 'function' as const, function: { name: fn.name, arguments: fn.arguments } }
    }),
    promptTokens: resp.usage?.prompt_tokens ?? 0,
    completionTokens: resp.usage?.completion_tokens ?? 0,
    model,
  }
}

export async function callLLM(
  provider: SupportedProvider,
  messages: LLMMessage[],
  tools?: object[],
): Promise<LLMResponse> {
  return callWithKeyRotation(provider, messages, tools)
}

export async function streamLLM(
  provider: SupportedProvider,
  messages: LLMMessage[],
  onChunk: (token: string) => void,
): Promise<{ content: string; promptTokens: number; completionTokens: number; model: string }> {
  const info = await getNextAvailableKey(provider)
  if (!info) throw new Error(`${provider}: sem chave disponível`)
  const model = info.model || DEFAULT_MODELS[provider]
  const key = info.key

  if (provider === 'CLAUDE') {
    const anthropic = new Anthropic({ apiKey: key })
    const systemMsg = messages.find(m => m.role === 'system')
    const chatMsgs = messages.filter(m => m.role !== 'system')
    let fullText = '', promptTokens = 0, completionTokens = 0
    const stream = anthropic.messages.stream({ model, max_tokens: 1024, system: systemMsg?.content, messages: chatMsgs as Anthropic.MessageParam[] })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') { onChunk(event.delta.text); fullText += event.delta.text }
      if (event.type === 'message_delta' && event.usage) completionTokens = event.usage.output_tokens
      if (event.type === 'message_start' && event.message.usage) promptTokens = event.message.usage.input_tokens
    }
    return { content: fullText, promptTokens, completionTokens, model }
  }

  if (provider === 'GEMINI') {
    const geminiClient = new GoogleGenerativeAI(key)
    const systemMsg = messages.find(m => m.role === 'system')
    const chatMsgs = messages.filter(m => m.role !== 'system')
    const geminiModel = geminiClient.getGenerativeModel({ model, systemInstruction: systemMsg?.content })
    const history = chatMsgs.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const lastMsg = chatMsgs[chatMsgs.length - 1]
    const chat = geminiModel.startChat({ history })
    const result = await chat.sendMessageStream(lastMsg?.content || '')
    let fullText = ''
    for await (const chunk of result.stream) { const t = chunk.text(); onChunk(t); fullText += t }
    const finalResp = await result.response
    const usage = finalResp.usageMetadata
    return { content: fullText, promptTokens: usage?.promptTokenCount ?? 0, completionTokens: usage?.candidatesTokenCount ?? 0, model }
  }

  const client = buildOpenAIClient(provider, key)
  const stream = await client.chat.completions.create({
    model, messages: messages as OpenAI.Chat.ChatCompletionMessageParam[], stream: true, stream_options: { include_usage: true },
  })
  let fullText = '', promptTokens = 0, completionTokens = 0
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) { onChunk(delta); fullText += delta }
    if (chunk.usage) { promptTokens = chunk.usage.prompt_tokens; completionTokens = chunk.usage.completion_tokens }
  }
  return { content: fullText, promptTokens, completionTokens, model }
}

// ─── Auto-fallback entre providers ───────────────────────────────────────────
export interface LLMAutoResult extends LLMResponse {
  usedProvider: SupportedProvider
  attemptedProviders: string[]
}

function isQuotaError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  const status = (e as any)?.status ?? (e as any)?.statusCode
  return status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('limit: 0') || msg.includes('não está activo') || msg.includes('sem chave api')
}

export async function callLLMAuto(
  messages: LLMMessage[],
  preferredProvider?: SupportedProvider,
  tools?: object[],
  options?: { useCooldown?: boolean },
): Promise<LLMAutoResult> {
  const useCooldown = options?.useCooldown ?? false

  // For normal use (ORBIT, sites): include all providers regardless of cooldown state
  // For simulations: skip providers already on cooldown
  const providers = await getEnabledProviders(useCooldown)

  if (preferredProvider && (!useCooldown || !isOnCooldown(preferredProvider))) {
    const idx = providers.findIndex(p => p.provider === preferredProvider)
    if (idx > 0) { const [pref] = providers.splice(idx, 1); providers.unshift(pref) }
  }

  if (providers.length === 0) {
    const allEnabled = await getEnabledProviders(false)
    if (allEnabled.length === 0) throw new Error('Nenhum provider de IA configurado e activo.')
    providers.push(...allEnabled)
  }

  const attempted: string[] = []
  let lastErr: unknown

  for (const { provider } of providers) {
    attempted.push(provider)
    try {
      const result = await callLLM(provider as SupportedProvider, messages, tools)
      if (attempted.length > 1) console.info(`[llm-auto] Fallback: usou ${provider} (após: ${attempted.slice(0, -1).join(', ')})`)
      return { ...result, usedProvider: provider as SupportedProvider, attemptedProviders: attempted }
    } catch (e) {
      lastErr = e
      const errStatus = (e as any)?.status ?? (e as any)?.statusCode ?? 0
      const errMsg = e instanceof Error ? e.message : String(e)
      if (useCooldown) {
        // Only mark cooldown for simulation/test calls
        if (isQuotaError(e)) {
          markProviderCooldown(provider, undefined, 429, 'rate limit')
          console.warn(`[llm-auto] ${provider} todas as chaves esgotadas — tentando próximo provider...`)
        } else {
          markProviderCooldown(provider, undefined, errStatus || 500, errMsg.slice(0, 80))
          console.error(`[llm-auto] ${provider} erro HTTP ${errStatus}:`, errMsg.slice(0, 100))
        }
      } else {
        // Normal use: just log and try next provider immediately, no cooldown
        console.warn(`[llm-auto] ${provider} falhou (${errStatus || 'err'}) — tentando próximo imediatamente...`)
      }
    }
  }

  throw lastErr ?? new Error('Todos os providers de IA falharam.')
}
