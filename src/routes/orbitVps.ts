import { Router, Request, Response } from 'express'
import multer, { StorageEngine } from 'multer'
import path from 'path'
import fs from 'fs'
import { requireAdminAuth } from '../middleware/adminAuth'
import { getVpsServers, saveVpsServers, execOnVps, vpsQuickStatus, VPS_KEYS_DIR, VpsServer } from '../services/vpsManager'

const router = Router()

const storage: StorageEngine = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VPS_KEYS_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
})

const upload = multer({
  storage,
  limits: { fileSize: 64 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.pem', '.key', ''].includes(ext) || file.originalname.startsWith('id_')) {
      cb(null, true)
    } else {
      cb(new Error('Só .pem, .key ou id_* são aceites') as unknown as null, false)
    }
  },
})

// GET /api/orbit/vps/servers
router.get('/servers', requireAdminAuth, async (_req: Request, res: Response) => {
  const servers = await getVpsServers()
  res.json(servers.map(({ keyFile: _, ...rest }) => rest))
})

// POST /api/orbit/vps/servers
router.post('/servers', requireAdminAuth, async (req: Request, res: Response) => {
  const b = req.body as Partial<VpsServer>
  if (!b.id || !b.name || !b.host || !b.user || !b.keyFile) {
    return res.status(400).json({ error: 'Campos obrigatórios: id, name, host, user, keyFile' })
  }
  const servers = await getVpsServers()
  if (servers.find(s => s.id === b.id)) {
    return res.status(409).json({ error: `VPS com id "${b.id}" já existe` })
  }
  const entry: VpsServer = {
    id: b.id, name: b.name, host: b.host,
    port: Number(b.port) || 22, user: b.user, keyFile: b.keyFile,
    description: b.description,
  }
  await saveVpsServers([...servers, entry])
  res.json({ ok: true })
})

// PUT /api/orbit/vps/servers/:id
router.put('/servers/:id', requireAdminAuth, async (req: Request, res: Response) => {
  const servers = await getVpsServers()
  const idx = servers.findIndex(s => s.id === req.params.id)
  if (idx < 0) return res.status(404).json({ error: 'Servidor não encontrado' })
  servers[idx] = { ...servers[idx], ...req.body, id: req.params.id }
  await saveVpsServers(servers)
  res.json({ ok: true })
})

// DELETE /api/orbit/vps/servers/:id
router.delete('/servers/:id', requireAdminAuth, async (req: Request, res: Response) => {
  const servers = await getVpsServers()
  const updated = servers.filter(s => s.id !== req.params.id)
  if (updated.length === servers.length) return res.status(404).json({ error: 'Servidor não encontrado' })
  await saveVpsServers(updated)
  res.json({ ok: true })
})

// POST /api/orbit/vps/keys — upload de chave SSH
router.post('/keys', requireAdminAuth, upload.single('key'), (req: Request, res: Response) => {
  const file = (req as Request & { file?: Express.Multer.File }).file
  if (!file) return res.status(400).json({ error: 'Ficheiro não enviado' })
  try { fs.chmodSync(file.path, 0o600) } catch { /* ignore */ }
  res.json({ ok: true, fileName: file.filename })
})

// GET /api/orbit/vps/keys
router.get('/keys', requireAdminAuth, (_req: Request, res: Response) => {
  try {
    res.json(fs.readdirSync(VPS_KEYS_DIR))
  } catch {
    res.json([])
  }
})

// DELETE /api/orbit/vps/keys/:name
router.delete('/keys/:name', requireAdminAuth, (req: Request, res: Response) => {
  const name = String(req.params.name).replace(/[^a-zA-Z0-9._-]/g, '')
  const keyPath = path.join(VPS_KEYS_DIR, name)
  if (!fs.existsSync(keyPath)) return res.status(404).json({ error: 'Chave não encontrada' })
  fs.unlinkSync(keyPath)
  res.json({ ok: true })
})

// POST /api/orbit/vps/exec — executa comando
router.post('/exec', requireAdminAuth, async (req: Request, res: Response) => {
  const { serverId, command } = req.body as { serverId?: string; command?: string }
  if (!serverId || !command) return res.status(400).json({ error: 'serverId e command são obrigatórios' })
  try {
    const result = await execOnVps(serverId, String(command))
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro SSH' })
  }
})

// GET /api/orbit/vps/status/:id
router.get('/status/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const status = await vpsQuickStatus(String(req.params.id))
    res.json({ ok: true, status })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erro SSH' })
  }
})

export default router
