import { PrismaClient } from '@prisma/client'
import { callLLMAuto } from '../services/llm'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()
const SNAPSHOTS_DIR = path.join(__dirname, '../../data/snapshots')
const MAX_PAGES = 8
const PAGE_TIMEOUT_MS = 8000
const DELAY_MS = 1200

// Mapa de domínios que estão hospedados localmente — lê ficheiros em vez de HTTP
const LOCAL_PATHS: Record<string, string> = {
  'gps.autotrack.pt':   '/opt/autotrack/admin',
  'app.orbithubos.pt':  '/var/www/autotrack',
  'orbithubos.pt':      '/var/www/autotrack',
  'autotrack.pt':       '/opt/autotrack/marketing',
  'app.rinosat.com':    '/var/www/autotrack/orbitrent/frontend',
}

// ── Ler app local do filesystem ───────────────────────────────────────────────
function extractTextFromTsx(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')          // remove /* comments */
    .replace(/\/\/.*/g, '')                     // remove // comments
    .replace(/import\s+.*?from\s+['"][^'"]+['"]/g, '')  // remove imports
    .replace(/<[A-Z][^>]*>/g, '')               // remove JSX components open tags
    .replace(/<\/[A-Z][^>]*>/g, '')             // remove JSX components close tags
    .replace(/<[a-z][^>]*>/g, ' ')              // inline HTML tags → space
    .replace(/<\/[a-z]+>/g, ' ')
    .replace(/\{[^}]{0,200}\}/g, ' ')           // remove short JS expressions
    .replace(/className=["'][^'"]*["']/g, '')
    .replace(/style=\{[^}]*\}/g, '')
    .replace(/["'`]([^"'`\n]{10,120})["'`]/g, '$1\n')  // extract string literals
    .replace(/\s{3,}/g, '\n')
    .trim()
}

function readLocalApp(appPath: string, domain: string): string {
  const texts: string[] = []
  const ext = ['.tsx', '.ts', '.jsx', '.js', '.md', '.mdx']
  const skipDirs = ['node_modules', '.next', 'dist', '.git', 'public', 'styles', '__tests__']

  function walk(dir: string, depth = 0) {
    if (depth > 3) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }

    for (const e of entries) {
      if (skipDirs.includes(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
      } else if (ext.includes(path.extname(e.name))) {
        try {
          const raw = fs.readFileSync(full, 'utf8').slice(0, 4000)
          const text = extractTextFromTsx(raw)
          if (text.length > 50) {
            const rel = full.replace(appPath, '').replace(/^\//, '')
            texts.push(`[Ficheiro: ${rel}]\n${text.slice(0, 800)}`)
          }
        } catch {}
      }
    }
  }

  // Prioridade: pages/, app/, src/app/, src/pages/, README.md
  const priority = ['pages', 'app', 'src/app', 'src/pages']
  for (const sub of priority) {
    const subPath = path.join(appPath, sub)
    if (fs.existsSync(subPath)) walk(subPath)
  }

  // README se existir
  const readme = path.join(appPath, 'README.md')
  if (fs.existsSync(readme)) {
    texts.unshift(`[README]\n${fs.readFileSync(readme, 'utf8').slice(0, 2000)}`)
  }

  console.log(`  [local] ${domain} — ${texts.length} ficheiros lidos`)
  return texts.slice(0, 20).join('\n\n---\n\n')
}

// ── HTML → texto limpo ────────────────────────────────────────────────────────
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n').trim().slice(0, 6000)
}

function extractLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const links: string[] = []
  const re = /href=["']([^"'#?]+)["']/gi
  let m
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], baseUrl)
      if (u.hostname === base.hostname && !u.pathname.match(/\.(pdf|jpg|png|gif|svg|zip|css|js|xml|ico)$/i))
        links.push(u.origin + u.pathname)
    } catch {}
  }
  return [...new Set(links)].slice(0, 20)
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'AI-Crawler/1.0' } })
    clearTimeout(timer)
    if (!res.ok) return null
    if (!(res.headers.get('content-type') || '').includes('html')) return null
    return await res.text()
  } catch { return null }
}

async function crawlSiteHttp(domain: string): Promise<string> {
  const startUrl = `https://${domain}`
  const visited = new Set<string>()
  const queue: string[] = [startUrl]
  const texts: string[] = []
  console.log(`  [http] ${domain} — a iniciar crawl HTTP`)
  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift()!
    if (visited.has(url)) continue
    visited.add(url)
    const html = await fetchPage(url)
    if (!html) { console.log(`  [http]   SKIP ${url}`); continue }
    const text = htmlToText(html)
    if (text.length > 100) {
      texts.push(`[Pagina: ${url}]\n${text}`)
      console.log(`  [http]   OK ${url} (${text.length} chars)`)
    }
    if (visited.size <= 2) {
      const links = extractLinks(html, url)
      for (const l of links) if (!visited.has(l)) queue.push(l)
    }
    await new Promise(r => setTimeout(r, DELAY_MS))
  }
  return texts.join('\n\n---\n\n')
}

function buildRawDocument(domain: string, brand: string, rawText: string): string {
  const lines = rawText.split('\n').map((l: string) => l.trim())
    .filter((l: string) => l.length > 20 && l.length < 300)
    .filter((l: string) => !/^(cookie|privacy|copyright|all rights|terms|menu|navigation)/i.test(l))
  return `Conteudo extraido de ${domain} (${brand}) em ${new Date().toLocaleDateString('pt')}.\n\n${[...new Set(lines)].slice(0, 80).join('\n')}`
}

async function extractKnowledge(domain: string, brand: string, rawText: string): Promise<string> {
  if (!rawText.trim()) return ''
  const prompt = `Analisa o conteudo extraido do site/app ${domain} (marca: ${brand}) e cria um documento de conhecimento estruturado para um assistente de IA de suporte/vendas.

CONTEUDO:
${rawText.slice(0, 9000)}

Cria um documento claro (apenas com informacao real presente no conteudo, sem inventar) com:
- Descricao do servico/produto
- Funcionalidades e paginas disponiveis
- Planos e precos (se visiveis)
- Como funciona (processo, passos)
- Contactos e suporte
- Limitacoes ou requisitos conhecidos

Sê preciso. Responde em Portugues.`

  try {
    const result = await callLLMAuto([{ role: 'user', content: prompt }])
    const knowledge = result.content?.trim() ?? ''
    if (knowledge.length > 100) return knowledge
    return buildRawDocument(domain, brand, rawText)
  } catch (e) {
    console.warn(`  [llm] Falhou — fallback texto bruto`)
    return buildRawDocument(domain, brand, rawText)
  }
}

// ── Crawl principal ───────────────────────────────────────────────────────────
export async function crawlAllSites(targetDomain?: string): Promise<{ domain: string; status: string }[]> {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
  const where = targetDomain ? { domain: targetDomain, isActive: true } : { isActive: true }
  const sites = await prisma.aISite.findMany({ where })
  const results: { domain: string; status: string }[] = []

  for (const site of sites) {
    console.log(`\n[crawler] ${site.domain}`)
    try {
      let rawText = ''

      const localPath = LOCAL_PATHS[site.domain]
      if (localPath && fs.existsSync(localPath)) {
        console.log(`  [local] A ler ficheiros de ${localPath}`)
        rawText = readLocalApp(localPath, site.domain)
      } else {
        rawText = await crawlSiteHttp(site.domain)
      }

      if (!rawText.trim()) {
        console.log(`  Sem conteudo em ${site.domain}`)
        results.push({ domain: site.domain, status: 'sem_conteudo' })
        continue
      }

      console.log(`  A estruturar conhecimento (${rawText.length} chars brutos)...`)
      const knowledge = await extractKnowledge(site.domain, site.brand, rawText)
      if (!knowledge) { results.push({ domain: site.domain, status: 'error' }); continue }

      const snapFile = path.join(SNAPSHOTS_DIR, `${site.domain}.md`)
      fs.writeFileSync(snapFile, `# ${site.brand} -- ${site.domain}\nActualizado: ${new Date().toISOString()}\n\n${knowledge}`, 'utf8')

      await prisma.aISite.update({ where: { id: site.id }, data: { factsDocument: knowledge } })

      console.log(`  OK — ${knowledge.length} chars gravados`)
      results.push({ domain: site.domain, status: 'ok' })

      await new Promise(r => setTimeout(r, 2000))
    } catch (e) {
      console.error(`  ERRO:`, (e as Error).message)
      results.push({ domain: site.domain, status: 'error' })
    }
  }

  await prisma.$disconnect()
  return results
}

if (require.main === module) {
  const target = process.argv[2]
  crawlAllSites(target)
    .then(r => { console.log('\nConcluido:', r); process.exit(0) })
    .catch(e => { console.error('ERRO FATAL:', e); process.exit(1) })
}
