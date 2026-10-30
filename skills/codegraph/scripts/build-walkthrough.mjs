// build-walkthrough.mjs — assemble a single-file CodeWalkthrough HTML.
//
// Usage:
//   node build-walkthrough.mjs \
//     --content <content.html> --repo <repo-root> --topic <title> \
//     [--language zh] [--audience ...] [--scope ...] \
//     [--out <walkthrough.html>] [--output-dir .codegraph/output]
//
// The content is a body fragment. Sections with class="cw-page" become virtual
// pages. The builder extracts referenced source, embeds it, and wraps the
// content in the shared reading shell.

import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = resolve(__dirname, '..', 'template', 'walkthrough')
const MAX_FILE_BYTES = 1_500_000
const MAX_TOTAL_BYTES = 8_000_000
const GENERATOR = 'CodeGraph/CodeWalkthrough'
const VERSION = '0.3.0'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--content') args.content = argv[++i]
    else if (key === '--repo') args.repo = argv[++i]
    else if (key === '--topic') args.topic = argv[++i]
    else if (key === '--language') args.language = argv[++i]
    else if (key === '--audience') args.audience = argv[++i]
    else if (key === '--scope') args.scope = argv[++i]
    else if (key === '--out') args.out = argv[++i]
    else if (key === '--output-dir') args.outputDir = argv[++i]
    else if (key === '-h' || key === '--help') {
      console.error('Usage: build-walkthrough.mjs --content <p> --repo <p> --topic <t> [--language zh] [--audience ...] [--scope ...] [--out <p>] [--output-dir <p>]')
      process.exit(2)
    } else {
      console.error(`Unknown arg: ${key}`)
      process.exit(2)
    }
  }
  for (const key of ['content', 'repo', 'topic']) {
    if (!args[key]) {
      console.error(`Missing required --${key}`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(process.argv)
const repoAbs = resolve(args.repo)
const contentAbs = resolve(args.content)
const language = typeof args.language === 'string' && args.language.trim() !== '' ? args.language.trim() : 'en'
const topic = String(args.topic).trim()
const audience = typeof args.audience === 'string' ? args.audience.trim() : ''
const scope = typeof args.scope === 'string' ? args.scope.trim() : ''

function fail(stage, message, errors = [], warnings = []) {
  console.log(JSON.stringify({ ok: false, stage, message, errors, warnings }))
  process.exit(1)
}

function warning(code, path, message) {
  return { level: 'warning', code, path, message }
}

function error(code, path, message, fixHint) {
  return { code, path, message, fix_hint: fixHint }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;')
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function replaceOnce(haystack, needle, value) {
  return haystack.split(needle).join(value)
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return slug || 'walkthrough'
}

function timestamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

function parseRef(raw) {
  const value = String(raw).trim()
  const split = value.lastIndexOf(':')
  if (split <= 0) return null
  const file = value.slice(0, split).replaceAll('\\', '/').replace(/^\.\//, '')
  const match = /^(\d+)(?:-(\d+))?$/.exec(value.slice(split + 1))
  if (match === null) return null
  const start = Number(match[1])
  const end = match[2] === undefined ? start : Number(match[2])
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null
  return { file, start, end }
}

function insideRepo(file) {
  const abs = resolve(repoAbs, file)
  const rel = relative(repoAbs, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return { abs, rel: rel.split('\\').join('/') }
}

function countLines(text) {
  if (typeof text !== 'string' || text === '') return 0
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  return normalized.endsWith('\n') ? lines.length - 1 : lines.length
}

function labelsFor(lang) {
  if (/^zh\b/i.test(lang)) {
    return {
      contents: '目录', source: '源码', close: '关闭', previous: '上一页', next: '下一页',
      openSource: '打开源码', emptySource: '点击正文中的源码引用，在这里查看对应代码。',
      progress: '进度', generated: '由 CodeGraph · CodeWalkthrough 生成', selfCheck: '自检',
      overview: '目录', pagesUnit: '节', sourcesUnit: '个源码文件', line: '第 {n} 行',
      reveal: '查看答案', hideAnswer: '收起答案',
      sourceWindow: '显示第 {start}–{end} 行，共 {total} 行。',
      checkIntro: '检查页面导航、源码引用和单文件自包含。',
    }
  }
  return {
    contents: 'Contents', source: 'Source', close: 'Close', previous: 'Previous', next: 'Next',
    openSource: 'Open source', emptySource: 'Click a source reference in the text to inspect it here.',
    progress: 'Progress', generated: 'Generated by CodeGraph · CodeWalkthrough', selfCheck: 'Self-check',
    overview: 'Sections', pagesUnit: 'sections', sourcesUnit: 'source files', line: 'line {n}',
    reveal: 'Show answer', hideAnswer: 'Hide answer',
    sourceWindow: 'Showing lines {start}–{end} of {total}.',
    checkIntro: 'Runtime checks for navigation, source references, and self-containment.',
  }
}

let content
try {
  content = readFileSync(contentAbs, 'utf8')
} catch (e) {
  fail('read', `Cannot read content file: ${contentAbs}`, [error('content-read', contentAbs, e.message)])
}

if (content.trim() === '') fail('validate', 'Content is empty')
const authoredContent = content

// ── external assets: the artifact must stay self-contained ────────────────
const externalChecks = [
  [/<script\b[^>]*\bsrc\s*=/i, 'external <script src>'],
  [/<link\b[^>]*\brel\s*=\s*["']stylesheet/i, 'external stylesheet'],
  [/<img\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i, 'external image'],
  [/<iframe\b[^>]*\bsrc\s*=/i, 'iframe'],
  [/@import\s+/i, 'CSS @import'],
]
for (const [pattern, label] of externalChecks) {
  if (pattern.test(content)) {
    fail('validate', `Content contains ${label}; inline all assets in the single HTML file.`, [
      error('external-asset', null, `Found ${label}.`, 'Inline the asset (data URI / inline SVG / inline CSS) or remove it.'),
    ])
  }
}

// ── collect source references ─────────────────────────────────────────────
const sourceRefs = new Map() // path -> { content, bytes, lines }
const warnings = []
const errors = []
const allRefs = []

function collect(raw, kind) {
  const ref = parseRef(raw)
  if (ref === null) {
    errors.push(error('bad-source-ref', raw, `Invalid ${kind} reference "${raw}".`, 'Use path:line or path:start-end with positive line numbers.'))
    return null
  }
  const inside = insideRepo(ref.file)
  if (inside === null) {
    errors.push(error('outside-repo', ref.file, `Source reference is outside the repository: ${ref.file}`, 'Use a path relative to --repo.'))
    return null
  }
  if (!existsSync(inside.abs) || !statSync(inside.abs).isFile()) {
    errors.push(error('missing-source', ref.file, `Source file does not exist: ${ref.file}`, 'Fix the path or remove the reference.'))
    return null
  }
  const stat = statSync(inside.abs)
  if (stat.size > MAX_FILE_BYTES) {
    errors.push(error('source-too-large', ref.file, `Source file is ${stat.size} bytes (limit ${MAX_FILE_BYTES}).`, 'Reference a smaller file or reduce the walked scope.'))
    return null
  }
  let text = sourceRefs.get(inside.rel)?.content
  if (text === undefined) {
    try {
      text = readFileSync(inside.abs, 'utf8')
    } catch (e) {
      errors.push(error('source-read', ref.file, e.message, 'Check file permissions.'))
      return null
    }
    sourceRefs.set(inside.rel, { content: text, bytes: Buffer.byteLength(text), lines: countLines(text) })
  }
  const lines = countLines(text)
  if (ref.end > lines) {
    errors.push(error('line-out-of-range', `${inside.rel}:${ref.start}-${ref.end}`, `File has ${lines} lines.`, 'Fix the line range.'))
    return null
  }
  const parsed = { ...ref, file: inside.rel, abs: inside.abs }
  allRefs.push({ ...parsed, kind })
  return parsed
}

for (const match of content.matchAll(/\bdata-source\s*=\s*["']([^"']+)["']/g)) collect(match[1], 'source')
for (const match of content.matchAll(/\bdata-code\s*=\s*["']([^"']+)["']/g)) collect(match[1], 'code')

if (errors.length > 0) fail('validate', 'Source references could not be resolved.', errors, warnings)

const totalBytes = [...sourceRefs.values()].reduce((sum, entry) => sum + entry.bytes, 0)
if (totalBytes > MAX_TOTAL_BYTES) {
  fail('validate', `Embedded source is too large (${totalBytes} bytes; limit ${MAX_TOTAL_BYTES}).`, [
    error('source-budget', null, 'Too many or too-large files are referenced.', 'Reduce the number of files or the scope of the walkthrough.'),
  ], warnings)
}

// ── replace data-code placeholders with real source ───────────────────────
const labels = labelsFor(language)
const codeBlockCount = { value: 0 }

function renderCode(ref) {
  const entry = sourceRefs.get(ref.file)
  if (entry === undefined) return ''
  const lines = entry.content.replace(/\r\n?/g, '\n').split('\n')
  const selected = lines.slice(ref.start - 1, ref.end)
  const rows = selected.map((line, index) => {
    const number = ref.start + index
    return `<span class="cw-code-line"><span class="cw-code-n">${number}</span><span class="cw-code-t">${line === '' ? '&nbsp;' : escapeHtml(line)}</span></span>`
  }).join('')
  codeBlockCount.value += 1
  return [
    `<figure class="cw-code" data-file="${escapeAttr(ref.file)}" data-start="${ref.start}" data-end="${ref.end}">`,
    `<figcaption><span class="cw-code-path">${escapeHtml(ref.file)}:${ref.start}-${ref.end}</span>`,
    `<button type="button" class="cw-code-open" data-source="${escapeAttr(`${ref.file}:${ref.start}`)}">${escapeHtml(labels.openSource)}</button></figcaption>`,
    `<pre class="cw-code-pre"><code>${rows}</code></pre>`,
    '</figure>',
  ].join('')
}

content = content.replace(
  /<div\b([^>]*?)\bdata-code\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/div>/gi,
  (match, before, raw, after) => {
    const ref = parseRef(raw)
    if (ref === null) return match
    const inside = insideRepo(ref.file)
    if (inside === null) return match
    return renderCode({ ...ref, file: inside.rel })
  },
)

if (/\bdata-code\s*=\s*["'][^"']+["']/.test(content)) {
  errors.push(error('unexpanded-code', null, 'A data-code placeholder was not replaced.', 'Use an empty <div data-code="path:start-end"></div> with double quotes.'))
}
if (errors.length > 0) fail('build', 'Code block extraction failed.', errors, warnings)

// ── pages / TOC metadata ──────────────────────────────────────────────────
const pages = []
const sectionPattern = /<section\b([^>]*)>/gi
let sectionMatch
let pageIndex = 0
while ((sectionMatch = sectionPattern.exec(content)) !== null) {
  const attrs = sectionMatch[1]
  if (!/\bclass\s*=\s*["'][^"']*\bcw-(?:page|slide|section)\b/.test(attrs)) continue
  pageIndex += 1
  const idMatch = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs)
  const titleMatch = /\bdata-title\s*=\s*["']([^"']+)["']/.exec(attrs)
  pages.push({
    id: idMatch === null ? `page-${pageIndex}` : idMatch[1],
    title: titleMatch === null ? `Page ${pageIndex}` : titleMatch[1],
  })
}
if (pages.length === 0) pages.push({ id: 'overview', title: topic })

// ── output directory ──────────────────────────────────────────────────────
const outputDirArg = typeof args.outputDir === 'string' && args.outputDir.trim() !== ''
  ? args.outputDir.trim()
  : '.codegraph/output'
const stamp = timestamp()
const slug = slugify(topic)
let outDir
let htmlPath
if (typeof args.out === 'string' && args.out.trim() !== '') {
  htmlPath = resolve(args.out)
  outDir = dirname(htmlPath)
} else {
  const root = resolve(repoAbs, outputDirArg)
  outDir = resolve(root, `${stamp}-${slug}`)
  let suffix = 2
  while (existsSync(outDir)) {
    outDir = resolve(root, `${stamp}-${slug}-${suffix}`)
    suffix += 1
  }
  htmlPath = resolve(outDir, 'walkthrough.html')
}

const metaPath = resolve(outDir, 'walkthrough.meta.json')
const contentPath = resolve(outDir, 'walkthrough.content.html')
const createdAt = new Date().toISOString()
const meta = {
  v: 1,
  kind: 'walkthrough',
  topic,
  createdAt,
  language,
  audience: audience || null,
  scope: scope || null,
  repo: repoAbs,
  html: 'walkthrough.html',
  content: 'walkthrough.content.html',
  pages,
  sources: [...sourceRefs.keys()],
  stats: { pages: pages.length, sources: sourceRefs.size, codeBlocks: codeBlockCount.value },
  generator: GENERATOR,
  version: VERSION,
}

const files = {}
for (const [path, entry] of sourceRefs) files[path] = entry.content
const data = { meta, files, labels, repo: repoAbs }

// ── shell ─────────────────────────────────────────────────────────────────
let shell
let css
let js
try {
  shell = readFileSync(resolve(TEMPLATE_DIR, 'shell.html'), 'utf8')
  css = readFileSync(resolve(TEMPLATE_DIR, 'shell.css'), 'utf8')
  js = readFileSync(resolve(TEMPLATE_DIR, 'shell.js'), 'utf8')
} catch (e) {
  fail('template', `Cannot read walkthrough template: ${e.message}`)
}

let html = shell
html = replaceOnce(html, '__LANG__', escapeAttr(language))
html = replaceOnce(html, '__TITLE__', escapeHtml(topic))
html = replaceOnce(html, '__CSS__', css)
html = replaceOnce(html, '__CONTENT__', content)
html = replaceOnce(html, '__DATA__', jsonForScript(data))
html = replaceOnce(html, '__JS__', js)

try {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(htmlPath, html, 'utf8')
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  writeFileSync(contentPath, authoredContent, 'utf8')
} catch (e) {
  fail('write', `Cannot write walkthrough: ${e.message}`)
}

const rel = (path) => relative(repoAbs, path).split('\\').join('/')
const relCwd = (path) => relative(process.cwd(), path).split('\\').join('/') || path
console.log(JSON.stringify({
  ok: true,
  stage: 'build',
  topic,
  dir: rel(outDir),
  html: rel(htmlPath),
  htmlRel: relCwd(htmlPath),
  htmlAbs: htmlPath,
  meta: rel(metaPath),
  metaRel: relCwd(metaPath),
  metaAbs: metaPath,
  content: rel(contentPath),
  contentRel: relCwd(contentPath),
  contentAbs: contentPath,
  repo: repoAbs,
  pages,
  sources: [...sourceRefs.keys()],
  stats: meta.stats,
  errors: [],
  warnings,
}))
