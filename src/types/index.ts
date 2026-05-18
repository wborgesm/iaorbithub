export interface SessionContext {
  userId?: string
  sessionId: string
  role?: string
}

export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
}

export interface LLMToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface LLMResponse {
  content: string | null
  tool_calls?: LLMToolCall[]
  promptTokens: number
  completionTokens: number
  model: string
}

export type SupportedProvider = 'GEMINI' | 'OPENAI' | 'CLAUDE' | 'DEEPSEEK' | 'GROQ'
