import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

export interface XiaomiCamera {
  name:     string
  rtsp:     string
  haEntity: string
}

export function getXiaomiCameras(): XiaomiCamera[] {
  try {
    const raw = process.env.XIAOMI_CAMERAS || '[]'
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(c => c && typeof c.name === 'string') as XiaomiCamera[]
  } catch {
    return []
  }
}

/** Snapshot via RTSP com ffmpeg — Buffer JPEG ou null */
export async function snapshotViaRtsp(rtspUrl: string, timeoutSecs = 10): Promise<Buffer | null> {
  if (!rtspUrl) return null
  const tmpPath = path.join('/tmp', `xiaomi_snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`)
  try {
    await execFileAsync('ffmpeg', [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-frames:v', '1',
      '-q:v', '2',
      '-y', tmpPath,
    ], { timeout: timeoutSecs * 1000 })

    if (!fs.existsSync(tmpPath)) return null
    const buf = fs.readFileSync(tmpPath)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    return buf
  } catch {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    return null
  }
}

/** Snapshot via Home Assistant proxy — Buffer JPEG ou null */
export async function snapshotViaHA(haEntity: string, haUrl: string, haToken: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(`${haUrl}/api/camera_proxy/${haEntity}`, {
      headers: { Authorization: `Bearer ${haToken}` },
      signal: controller.signal,
    })
    clearTimeout(t)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return Buffer.from(buf)
  } catch {
    return null
  }
}
