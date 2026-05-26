import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const ROOT = '/opt/ai-command-center'
const PROTECTED_FILE = path.join(ROOT, 'orbit-protected.json')
const DB_URL = 'postgresql://ai_command_user:aicommand_secure_2026@localhost:5432/ai_command_center'

interface Protected {
  protected_files: string[]
  protected_patterns: string[]
  forbidden_commands: string[]
}

function loadProtected(): Protected {
  try {
    return JSON.parse(fs.readFileSync(PROTECTED_FILE, 'utf-8')) as Protected
  } catch {
    return {
      protected_files: ['orbit-protected.json', 'src/services/llm.ts', '.env'],
      protected_patterns: [],
      forbidden_commands: ['git push'],
    }
  }
}

function isProtected(filePath: string): boolean {
  const p = loadProtected()
  const rel = filePath.replace(ROOT + '/', '').replace(/^\//, '')
  if (p.protected_files.some(f => rel === f || rel.endsWith(f))) return true
  for (const pattern of p.protected_patterns) {
    const regex = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\./g, '\\.')
    if (new RegExp(regex).test(rel)) return true
  }
  return false
}

export interface EditResult {
  success: boolean
  message: string
  compiled?: boolean
  restarted?: boolean
  prismaGenerated?: boolean
}

// Detect new enum values added to schema.prisma and apply them via ALTER TYPE
function applyPrismaEnumChanges(oldContent: string, newContent: string): string[] {
  const logs: string[] = []
  const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g
  const oldEnums: Record<string, string[]> = {}
  const newEnums: Record<string, string[]> = {}

  let m: RegExpExecArray | null
  while ((m = enumRegex.exec(oldContent)) !== null) {
    oldEnums[m[1]] = m[2].split(/\s+/).filter(Boolean)
  }
  enumRegex.lastIndex = 0
  while ((m = enumRegex.exec(newContent)) !== null) {
    newEnums[m[1]] = m[2].split(/\s+/).filter(Boolean)
  }

  for (const [enumName, newVals] of Object.entries(newEnums)) {
    const oldVals = oldEnums[enumName] || []
    const added = newVals.filter(v => !oldVals.includes(v))
    for (const val of added) {
      try {
        execSync(
          `psql "${DB_URL}" -c "ALTER TYPE \\"${enumName}\\" ADD VALUE IF NOT EXISTS '${val}';"`,
          { encoding: 'utf-8', timeout: 15000 }
        )
        logs.push(`ALTER TYPE "${enumName}" ADD VALUE '${val}' — OK`)
      } catch (e) {
        logs.push(`ALTER TYPE "${enumName}" ADD VALUE '${val}' — FALHOU: ${e instanceof Error ? e.message : e}`)
      }
    }
  }
  return logs
}

export async function selfEditFile(
  relPath: string,
  oldCode: string,
  newCode: string,
  reason: string
): Promise<EditResult> {
  const absPath = path.join(ROOT, relPath)

  if (isProtected(absPath)) {
    return { success: false, message: `🔒 Ficheiro protegido: ${relPath} — não posso modificar.` }
  }

  if (!fs.existsSync(absPath)) {
    return { success: false, message: `Ficheiro não encontrado: ${relPath}` }
  }

  const original = fs.readFileSync(absPath, 'utf-8')
  if (!original.includes(oldCode)) {
    return { success: false, message: `Código a substituir não encontrado em ${relPath}. Pode ter mudado entretanto.` }
  }

  const updated = original.replace(oldCode, newCode)
  fs.writeFileSync(absPath, updated, 'utf-8')

  const isPrisma = relPath.endsWith('.prisma')
  const sqlLogs: string[] = []

  // Prisma schema: apply enum changes via SQL + regenerate client
  if (isPrisma) {
    const enumLogs = applyPrismaEnumChanges(original, updated)
    sqlLogs.push(...enumLogs)
    try {
      execSync(
        `cd ${ROOT} && DATABASE_URL='${DB_URL}' npx prisma generate 2>&1`,
        { encoding: 'utf-8', timeout: 60000 }
      )
    } catch (e) {
      fs.writeFileSync(absPath, original, 'utf-8')
      return { success: false, message: `prisma generate falhou — revertido: ${e instanceof Error ? e.message : e}` }
    }
  }

  // Compile TypeScript
  let compileOutput = ''
  try {
    compileOutput = execSync(
      `cd ${ROOT} && NODE_OPTIONS='--max-old-space-size=3000' npx tsc --noEmitOnError false 2>&1 | grep -v 'embeddingService\\|eventFusion\\|fetchTripWeather\\|MADRID_COORDS\\|googleAds' | grep -i error | head -5`,
      { encoding: 'utf-8', timeout: 90000 }
    )
    if (compileOutput.trim() !== '') {
      fs.writeFileSync(absPath, original, 'utf-8')
      return { success: false, message: `Erros de compilação — revertido:\n${compileOutput}`, compiled: false }
    }
  } catch (e) {
    fs.writeFileSync(absPath, original, 'utf-8')
    return { success: false, message: `Falha ao compilar — revertido: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Restart
  try {
    execSync('systemctl restart ai-command-center', { timeout: 15000 })
  } catch (e) {
    return {
      success: true, compiled: true, restarted: false,
      message: `Edição aplicada e compilada, mas restart falhou: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Auto git commit + push — registo automático de cada auto-edição
  let gitNote = ''
  try {
    const safeReason = reason.replace(/'/g, '').replace(/"/g, '').slice(0, 120)
    execSync(
      `cd ${ROOT} && git add -A && git commit -m "auto: ${relPath} — ${safeReason}" 2>&1`,
      { encoding: 'utf-8', timeout: 30000 }
    )
    try {
      execSync(`cd ${ROOT} && git push origin main 2>&1`, { encoding: 'utf-8', timeout: 30000 })
      gitNote = '\nGit: commit + push OK'
    } catch {
      gitNote = '\nGit: commit OK, push falhou (tenta manualmente)'
    }
  } catch {
    gitNote = ''  // sem alterações para commit ou git não disponível
  }

  const sqlNote = sqlLogs.length > 0 ? `\nSQL: ${sqlLogs.join('; ')}` : ''
  return {
    success: true, compiled: true, restarted: true,
    prismaGenerated: isPrisma,
    message: `✅ ${relPath} corrigido. Motivo: ${reason}. Compilado e reiniciado.${sqlNote}${gitNote}`,
  }
}
