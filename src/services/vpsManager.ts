import { Client as SshClient } from 'ssh2'
import path from 'path'
import fs from 'fs'
import { getOrbitConfig } from './orbitConfig'

export const VPS_KEYS_DIR = path.join(process.cwd(), 'data', 'vps-keys')

export interface VpsServer {
  id: string
  name: string
  host: string
  port: number
  user: string
  keyFile: string  // nome do ficheiro em data/vps-keys/
  description?: string
}

export interface VpsExecResult {
  stdout: string
  stderr: string
  code: number
}

export async function getVpsServers(): Promise<VpsServer[]> {
  try {
    const raw = await getOrbitConfig('vps_servers')
    if (!raw) return []
    return JSON.parse(raw) as VpsServer[]
  } catch {
    return []
  }
}

export async function saveVpsServers(servers: VpsServer[]): Promise<void> {
  const { setOrbitConfig } = await import('./orbitConfig')
  await setOrbitConfig('vps_servers', JSON.stringify(servers))
}

export async function execOnVps(serverId: string, command: string, timeoutMs = 20000): Promise<VpsExecResult> {
  const servers = await getVpsServers()
  const srv = servers.find(s => s.id === serverId)
  if (!srv) throw new Error(`VPS "${serverId}" não encontrada. Usa listVpsServers para ver as disponíveis.`)

  const keyPath = path.join(VPS_KEYS_DIR, srv.keyFile)
  if (!fs.existsSync(keyPath)) throw new Error(`Chave SSH não encontrada: ${srv.keyFile}`)
  const privateKey = fs.readFileSync(keyPath)

  return new Promise((resolve, reject) => {
    const conn = new SshClient()
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { conn.end() } catch { /* ignore */ }
      reject(new Error(`Timeout (${timeoutMs / 1000}s) na VPS "${srv.name}"`))
    }, timeoutMs)

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          settled = true
          conn.end()
          return reject(err)
        }
        let stdout = ''
        let stderr = ''
        stream.on('close', (code: number) => {
          clearTimeout(timer)
          settled = true
          conn.end()
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 })
        })
        stream.on('data', (d: Buffer) => { stdout += d.toString() })
        stream.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      })
    })

    conn.on('error', (err) => {
      if (settled) return
      clearTimeout(timer)
      settled = true
      reject(new Error(`SSH "${srv.name}": ${err.message}`))
    })

    conn.connect({
      host: srv.host,
      port: srv.port,
      username: srv.user,
      privateKey,
      readyTimeout: Math.min(timeoutMs - 2000, 15000),
    })
  })
}

export async function vpsQuickStatus(serverId: string): Promise<string> {
  const cmd = [
    "echo '--- CPU ---'",
    "top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4\"%\"}'",
    "echo '--- RAM ---'",
    "free -h | awk '/^Mem/{print $3\" usado / \"$2\" total\"}'",
    "echo '--- DISCO ---'",
    "df -h / | awk 'NR==2{print $5\" usado de \"$2\" (\"$4\" livres)\"}'",
    "echo '--- UPTIME ---'",
    "uptime -p",
  ].join('; ')
  const { stdout } = await execOnVps(serverId, cmd, 10000)
  return stdout
}
