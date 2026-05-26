import crypto from 'crypto'
import { callLLMAuto } from '../services/llm'
import { getOrbitConfig, setOrbitConfig } from '../services/orbitConfig'

const DRAFTS_KEY = 'wa_mimetismo_drafts'

export interface WaMimetismoDraft {
  id: string
  incoming: string
  draft: string
  createdAt: string
  status: 'pending_approval'
}

async function loadDrafts(): Promise<WaMimetismoDraft[]> {
  const raw = await getOrbitConfig(DRAFTS_KEY)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as WaMimetismoDraft[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export async function gerarRespostaMimetizada(mensagemRecebida: string): Promise<WaMimetismoDraft> {
  const systemPrompt = 'Responda no tom de um desenvolvedor brasileiro, usando gírias comuns do Brasil de forma natural, curto e direto'
  const result = await callLLMAuto([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: mensagemRecebida },
  ], 'GROQ')

  const draft: WaMimetismoDraft = {
    id: crypto.randomUUID(),
    incoming: mensagemRecebida,
    draft: result.content?.trim() || 'Beleza, já vejo isso!',
    createdAt: new Date().toISOString(),
    status: 'pending_approval',
  }

  const drafts = await loadDrafts()
  drafts.unshift(draft)
  await setOrbitConfig(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 50)))
  return draft
}

export async function listMimetismoDrafts(): Promise<WaMimetismoDraft[]> {
  return loadDrafts()
}
