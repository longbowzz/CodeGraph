// verify-walkthrough.mjs — static self-check for a CodeWalkthrough artifact.
//
// Usage:
//   node verify-walkthrough.mjs --file <walkthrough.html> [--repo <repo-root>]
//
// Prints JSON { ok, checks, errors, warnings } and exits 1 on errors.
// This is the deterministic half of the self-check; runtime interaction checks
// still need a browser (or window.__cwCheck()).

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--file') args.file = argv[++i]
    else if (argv[i] === '--repo') args.repo = argv[++i]
    else if (argv[i] === '-h' || argv[i] === '--help') {
      console.error('Usage: verify-walkthrough.mjs --file <walkthrough.html> [--repo <repo-root>]')
      process.exit(2)
    }
  }
  if (!args.file) {
    console.error('Missing required --file')
    process.exit(2)
  }
  return args
}

const args = parseArgs(process.argv)
const file = resolve(args.file)
const repo = args.repo ? resolve(args.repo) : null
const errors = []
const warnings = []
const checks = []

function ok(name, condition, detail) {
  const passed = Boolean(condition)
  checks.push({ name, ok: passed, detail: passed ? null : (detail ?? null) })
  if (!passed) errors.push(`${name}${detail ? `: ${detail}` : ''}`)
}

if (!existsSync(file)) {
  console.log(JSON.stringify({ ok: false, checks, errors: ['file does not exist'], warnings }))
  process.exit(1)
}

const html = readFileSync(file, 'utf8')
const bytes = Buffer.byteLength(html)
ok('doctype', /^<!doctype html>/i.test(html.trimStart()))
ok('title', /<title>[^<]+<\/title>/i.test(html), 'missing or empty <title>')
ok('size', bytes < 16_000_000, `${bytes} bytes; consider reducing embedded source`)
for (const placeholder of ['__LANG__', '__TITLE__', '__CSS__', '__CONTENT__', '__DATA__', '__JS__']) {
  ok(`placeholder ${placeholder}`, !html.includes(placeholder), 'unexpanded shell placeholder')
}
for (const id of ['cw-content', 'cw-nav-links', 'cw-main', 'cw-source', 'cw-data']) {
  ok(`shell #${id}`, html.includes(`id="${id}"`), 'missing shell element')
}
ok('bridge message', html.includes('codewalk.navigate'), 'missing codewalk bridge')
ok('runtime check', html.includes('__cwCheck'), 'missing window.__cwCheck')
ok('no data-code placeholders', !/\bdata-code\s*=\s*["'][^"']+["']/.test(html), 'unexpanded data-code block')
ok('no external script', !/<script\b[^>]*\bsrc\s*=/i.test(html), 'external script')
ok('no external stylesheet', !/<link\b[^>]*\brel\s*=\s*["']stylesheet/i.test(html), 'external stylesheet')
ok('no iframe', !/<iframe\b[^>]*\bsrc\s*=/i.test(html), 'iframe resource')
for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi)) {
  errors.push(`external image: ${match[1]}`)
}

const dataMatch = /<script id="cw-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
ok('cw-data block', dataMatch !== null)
let data = null
if (dataMatch !== null) {
  try { data = JSON.parse(dataMatch[1]) } catch (e) {
    errors.push(`cw-data is not valid JSON: ${e.message}`)
  }
}
ok('cw-data parsed', data !== null)
const meta = data?.meta !== null && typeof data?.meta === 'object' ? data.meta : {}
const files = data?.files !== null && typeof data?.files === 'object' ? data.files : {}
ok('kind', meta.kind === 'walkthrough', `expected walkthrough, got ${meta.kind}`)
ok('topic', typeof meta.topic === 'string' && meta.topic.trim() !== '')
ok('pages', Array.isArray(meta.pages) && meta.pages.length > 0, 'no pages')
if (Array.isArray(meta.pages)) {
  const ids = new Set()
  for (const page of meta.pages) {
    if (typeof page?.id !== 'string' || page.id === '') errors.push('page without id')
    else if (ids.has(page.id)) errors.push(`duplicate meta page id: ${page.id}`)
    else ids.add(page.id)
  }
}
const pageSections = [...html.matchAll(/<section\b([^>]*)>/gi)]
  .filter((match) => /\bclass\s*=\s*["'][^"']*\bcw-(?:page|slide|section)\b/.test(match[1])).length
ok('content sections', pageSections > 0, `${pageSections} cw-section sections`)
ok('nav', html.includes('id="cw-nav-links"'))
ok('main', html.includes('id="cw-main"'))
ok('source pane', html.includes('id="cw-source-body"'))
ok('files embedded', Object.keys(files).length > 0, 'no source files embedded')

const idCounts = new Map()
for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
  idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1)
}
for (const [id, count] of idCounts) {
  if (count > 1) errors.push(`duplicate id: ${id}`)
}

function parseRef(raw) {
  const value = String(raw || '').trim()
  const split = value.lastIndexOf(':')
  if (split <= 0) return null
  const file = value.slice(0, split).replaceAll('\\', '/').replace(/^\.\//, '')
  const line = Number(value.slice(split + 1))
  if (!Number.isInteger(line) || line < 1) return null
  return { file, line }
}

let sourceLinks = 0
let codeBlocks = 0
for (const match of html.matchAll(/\bdata-source\s*=\s*["']([^"']+)["']/g)) {
  sourceLinks += 1
  const ref = parseRef(match[1])
  if (ref === null) {
    errors.push(`bad data-source: ${match[1]}`)
    continue
  }
  const entry = files[ref.file]
  if (entry === undefined) {
    errors.push(`source not embedded: ${ref.file}`)
    continue
  }
  const text = typeof entry === 'string' ? entry : entry.content
  if (typeof text !== 'string') {
    errors.push(`embedded source is not text: ${ref.file}`)
    continue
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n').length
  if (ref.line > lines) errors.push(`source line out of range: ${ref.file}:${ref.line}`)
}
for (const match of html.matchAll(/<figure\b[^>]*class="[^"]*\bcw-code\b[^"]*"[^>]*>/g)) {
  codeBlocks += 1
}
ok('code blocks', codeBlocks === (meta.stats?.codeBlocks ?? codeBlocks), `meta says ${meta.stats?.codeBlocks}, found ${codeBlocks}`)
ok('source links', sourceLinks > 0, 'no source references')

if (repo !== null) {
  for (const [path, entry] of Object.entries(files)) {
    const abs = resolve(repo, path)
    const rel = relative(repo, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      errors.push(`embedded source outside repo: ${path}`)
      continue
    }
    if (!existsSync(abs)) {
      warnings.push(`source file no longer exists: ${path}`)
      continue
    }
    try {
      const current = readFileSync(abs, 'utf8')
      const embedded = typeof entry === 'string' ? entry : entry.content
      if (typeof embedded === 'string' && current !== embedded) {
        warnings.push(`source changed since build: ${path}`)
      }
    } catch (e) {
      warnings.push(`cannot re-read ${path}: ${e.message}`)
    }
  }
}

const result = {
  ok: errors.length === 0,
  file,
  bytes,
  pages: meta.pages?.length ?? pageSections,
  sources: Object.keys(files).length,
  sourceLinks,
  codeBlocks,
  checks,
  errors,
  warnings,
}
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exit(1)
