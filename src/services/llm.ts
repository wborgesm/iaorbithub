import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { LLMMessage, LLMResponse, SupportedProvider } from '../types'
import { getProviderConfig } from './providerConfig'

const DEFAULT_MODELS: Record<SupportedProvider, string> = {
  CLAUDE:   'claude-haiku-4-5-20251001',
  OPENAI:   'gpt-4o-mini',
  GEMINI:   'gemini-2.0-flash',
  DEEPSEEK: 'deepseek-chat',
  GROQ:     'llama-3.3-70b-versatile',
}

async function resolveKey(provider: SupportedProvider): Promise<{ key: string; model: string }> {
  const cfg = await getProviderConfig(provider)
  if (!cfg.isEnabled || !cfg.apiKey) throw new Error(`Provider ${provider} não está activo ou sem chave API configurada.`)
  return { key: cfg.apiKey, model: cfg.model || DEFAULT_MODELS[provider] }
}

export async function callLLM(
  provider: SupportedProvider,
  messages: LLMMessage[],
  tools?: object[],
): Promise<LLMResponse> {
  const { key, model } = await resolveKey(provider)

  if (provider === 'CLAUDE') {
    const anthropic = new Anthropic({ apiKey: key })
    const systemMsg = messages.find(m => m.role === 'system')
    const chatMsgs = messages.filter(m => m.role !== 'system')
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 1024,
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
        function: {
          name: b.type === 'tool_use' ? b.name : '',
          arguments: b.type === 'tool_use' ? JSON.stringify(b.input) : '{}',
        },
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
    const history = chatMsgs.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))
    const lastMsg = chatMsgs[chatMsgs.length - 1]
    const chat = geminiModel.startChat({ history })
    const result = await chat.sendMessage(lastMsg?.content || '')
    const text = result.response.text()
    const usage = result.response.usageMetadata
    return {
      content: text,
      tool_calls: [],
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      model,
    }
  }

  const client = provider === 'DEEPSEEK'
    ? new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' })
    : provider === 'GROQ'
    ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' })
    : new OpenAI({ apiKey: key })

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
      return {
        id: tc.id,
        type: 'function' as const,
        function: { name: fn.name, arguments: fn.arguments },
      }
    }),
    promptTokens: resp.usage?.prompt_tokens ?? 0,
    completionTokens: resp.usage?.completion_tokens ?? 0,
    model,
  }
}

export async function streamLLM(
  provider: SupportedProvider,
  messages: LLMMessage[],
  onChunk: (token: string) => void,
): Promise<{ content: string; promptTokens: number; completionTokens: number; model: string }> {
  const { key, model } = await resolveKey(provider)

  if (provider === 'CLAUDE') {
    const anthropic = new Anthropic({ apiKey: key })
    const systemMsg = messages.find(m => m.role === 'system')
    const chatMsgs = messages.filter(m => m.role !== 'system')
    let fullText = ''
    let promptTokens = 0
    let completionTokens = 0
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 1024,
      system: systemMsg?.content,
      messages: chatMsgs as Anthropic.MessageParam[],
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onChunk(event.delta.text)
        fullText += event.delta.text
      }
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
    const history = chatMsgs.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))
    const lastMsg = chatMsgs[chatMsgs.length - 1]
    const chat = geminiModel.startChat({ history })
    const result = await chat.sendMessageStream(lastMsg?.content || '')
    let fullText = ''
    for await (const chunk of result.stream) {
      const text = chunk.text()
      onChunk(text)
      fullText += text
    }
    const finalResp = await result.response
    const usage = finalResp.usageMetadata
    return {
      content: fullText,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      model,
    }
  }

  const client = provider === 'DEEPSEEK'
    ? new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' })
    : provider === 'GROQ'
    ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' })
    : new OpenAI({ apiKey: key })

  const stream = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
    stream: true,
    stream_options: { include_usage: true },
  })
  let fullText = ''
  let promptTokens = 0
  let completionTokens = 0
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) { onChunk(delta); fullText += delta }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens
      completionTokens = chunk.usage.completion_tokens
    }
  }
  return { content: fullText, promptTokens, completionTokens, model }
}
