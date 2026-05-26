import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { getOrbitConfig } from '../services/orbitConfig'
import { callLLMAuto } from '../services/llm'

const UPLOAD_TMP = path.join(process.cwd(), 'data', 'uploads', 'tmp')

export async function stripImageMetadata(inputPath: string, outputPath?: string): Promise<string> {
  const out = outputPath || inputPath
  await sharp(inputPath).rotate().withMetadata({ exif: undefined }).toFile(out + '.tmp')
  fs.renameSync(out + '.tmp', out)
  return out
}

export async function onNewImageUpload(filePath: string): Promise<{ ok: boolean; path: string; error?: string }> {
  try {
    const ext = path.extname(filePath).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp', '.tiff'].includes(ext)) {
      return { ok: true, path: filePath }
    }
    await stripImageMetadata(filePath)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, path: filePath, error: e instanceof Error ? e.message : 'Erro metadados' }
  }
}

export async function enviarIdeiaParaTrello(texto: string): Promise<{ ok: boolean; error?: string; cardId?: string }> {
  const key = await getOrbitConfig('trello_key')
  const token = await getOrbitConfig('trello_token')
  const listId = await getOrbitConfig('trello_list_id')
  if (!key || !token || !listId) {
    return { ok: false, error: 'Trello não configurado (trello_key, trello_token, trello_list_id)' }
  }

  const lines = texto.trim().split('\n').filter(Boolean)
  const titulo = lines[0]?.slice(0, 120) || 'Ideia ORBIT'
  const descricao = lines.slice(1).join('\n') || texto

  const params = new URLSearchParams({
    key,
    token,
    idList: listId,
    name: titulo,
    desc: descricao,
  })
  const res = await fetch('https://api.trello.com/1/cards', { method: 'POST', body: params })
  if (!res.ok) return { ok: false, error: `Trello HTTP ${res.status}` }
  const card = await res.json() as { id: string }
  return { ok: true, cardId: card.id }
}

export async function gerarSlogansBranding(dominio: string): Promise<string[]> {
  const prompt = `Gera exactamente 5 slogans curtos e optimizados para SEO para o domínio "${dominio}".
Responde só com JSON: {"slogans":["...","...","...","...","..."]}`
  const result = await callLLMAuto([{ role: 'user', content: prompt }], 'GROQ')
  try {
    const parsed = JSON.parse(result.content || '{}') as { slogans?: string[] }
    if (Array.isArray(parsed.slogans) && parsed.slogans.length > 0) return parsed.slogans.slice(0, 5)
  } catch { /* fallback */ }
  return [
    `${dominio} — soluções que funcionam`,
    `Confia em ${dominio}`,
    `${dominio} — qualidade e confiança`,
    `O teu parceiro em ${dominio}`,
    `${dominio} — sempre contigo`,
  ]
}

async function sweepOldAssets(): Promise<number> {
  fs.mkdirSync(UPLOAD_TMP, { recursive: true })
  const cutoff = Date.now() - 30 * 86400000
  let deleted = 0
  for (const name of fs.readdirSync(UPLOAD_TMP)) {
    const full = path.join(UPLOAD_TMP, name)
    try {
      const st = fs.statSync(full)
      if (st.isFile() && st.mtimeMs < cutoff) {
        fs.unlinkSync(full)
        deleted++
      }
    } catch { /* ignore */ }
  }
  return deleted
}

function isLastDayOfMonth(): boolean {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  return tomorrow.getDate() === 1
}

export function startMediaWorker(): void {
  setInterval(() => {
    if (isLastDayOfMonth()) {
      void sweepOldAssets().then(n => {
        if (n > 0) console.log(`[mediaWorker] Asset Sweeper — ${n} ficheiro(s) apagado(s)`)
      })
    }
  }, 24 * 60 * 60 * 1000)
  console.log('[mediaWorker] Activo — metadados, Trello, slogans, sweeper mensal')
}

export { sweepOldAssets, UPLOAD_TMP }
