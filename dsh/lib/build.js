// Host-side build/list pipeline for the CodeGraph DSH plugin.
//
// The plugin deliberately reuses the existing CodeGraph CLI scripts instead of
// re-implementing validation or HTML assembly. Those scripts are the single
// source of truth for the artifact contract; this module only owns:
//   - argument/paths resolution,
//   - the timestamped output directory,
//   - atomic-ish temp -> output placement,
//   - graph.meta.json for the viewer.
//
// Only Node built-ins are imported, so the bundle needs no npm dependencies.

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const GENERATOR = { name: '@longbowzz/dsh-codegraph', version: '0.1.0' }
const MAX_OUTPUT = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 180_000

/** Normalize an OS path for display and wire use. */
function posix(path) {
  return path.split(sep).join('/')
}

/** A path relative to cwd when possible, otherwise an absolute path. */
function relativeOrAbsolute(cwd, absolute) {
  const rel = relative(cwd, absolute)
  if (rel === '') return '.'
  if (rel.startsWith('..') || isAbsolute(rel)) return posix(absolute)
  return posix(rel)
}

function relativeTo(repo, absolute) {
  return posix(relative(repo, absolute))
}

/** Local YYYYMMDD-HHMM, matching the CodeGraph output convention. */
function localStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

/**
 * A short directory slug that keeps CJK while dropping separators that would
 * change the directory shape. Mirrors the skill's topic-slug rule.
 */
export function slugify(topic) {
  const slug = String(topic ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[\s/\\:]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_.]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 60)
  return slug || 'graph'
}

/** Diagram kinds present in a Mermaid source. */
export function kindsOf(mmd) {
  const kinds = []
  if (/^\s*(?:flowchart|graph)\b/m.test(mmd)) kinds.push('flowchart')
  if (/^\s*sequenceDiagram\b/m.test(mmd)) kinds.push('sequence')
  return kinds
}

/** Counts derived from the location table (not from the Mermaid text). */
export function statsOf(locs) {
  if (locs === null || typeof locs !== 'object' || Array.isArray(locs)) {
    return { nodes: 0, edges: 0, actors: 0, messages: 0 }
  }
  const flowchart = locs.flowchart !== undefined ? locs.flowchart : locs
  const nodes = flowchart?.nodes && typeof flowchart.nodes === 'object' && !Array.isArray(flowchart.nodes)
    ? Object.keys(flowchart.nodes).length
    : 0
  const edges = Array.isArray(flowchart?.edges) ? flowchart.edges.length : 0

  const sequence = locs.sequence !== undefined ? locs.sequence : locs
  const actors = sequence?.actors && typeof sequence.actors === 'object' && !Array.isArray(sequence.actors)
    ? Object.keys(sequence.actors).length
    : 0
  const messages = Array.isArray(sequence?.messages) ? sequence.messages.length : 0
  return { nodes, edges, actors, messages }
}

function nodeLaunch() {
  // Inside the Desktop app process.execPath is the Electron binary; setting
  // ELECTRON_RUN_AS_NODE makes it behave as the bundled Node runtime.
  if (process.versions.electron) {
    return { command: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { command: process.execPath, env: { ...process.env } }
}

function runOnce(command, script, args, { cwd, signal, timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error('CodeGraph build aborted'))
      return
    }
    const child = spawn(command, [script, ...args], {
      cwd,
      env: nodeLaunch().env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let overflow = false
    let timedOut = false
    let aborted = false
    let spawnError

    const append = (current, chunk) => {
      if (overflow) return current
      const next = current + chunk
      if (next.length > MAX_OUTPUT) {
        overflow = true
        child.kill('SIGKILL')
        return next.slice(0, MAX_OUTPUT)
      }
      return next
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.on('error', (error) => { spawnError = error })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = () => {
      aborted = true
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('close', (code, signalName) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (spawnError) {
        const error = new Error(`Cannot start Node for CodeGraph: ${spawnError.message}`)
        error.code = spawnError.code
        reject(error)
        return
      }
      if (aborted) {
        reject(new Error('CodeGraph build aborted'))
        return
      }
      resolvePromise({
        code: code ?? 1,
        signal: signalName ?? null,
        stdout,
        stderr,
        timedOut,
        overflow,
      })
    })
  })
}

async function runNode(script, args, options) {
  const first = nodeLaunch()
  try {
    return await runOnce(first.command, script, args, options)
  } catch (error) {
    // Desktop packaged without a usable Electron Node shim: retry with PATH.
    if (error.code === 'ENOENT' && first.command !== 'node') {
      return await runOnce('node', script, args, options)
    }
    throw error
  }
}

function parseValidation(stdout) {
  const text = stdout.trim()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function lastLines(text, count = 8) {
  const lines = String(text ?? '').trimEnd().split(/\r?\n/).filter(Boolean)
  return lines.slice(-count).join('\n')
}

function failure(stage, message, extra = {}) {
  return { ok: false, stage, message, errors: [], warnings: [], ...extra }
}

function readMeta(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'graph.meta.json'), 'utf8'))
  } catch {
    return null
  }
}

function fallbackTopic(dirName) {
  return dirName.replace(/^\d{8}-\d{4}-/, '') || dirName
}

function inferKindsFromDir(dir) {
  try {
    return kindsOf(readFileSync(join(dir, 'graph.mmd'), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Validate and build one diagram.
 *
 * @param {object} options
 * @param {string} options.skillDir  CodeGraph skill directory (scripts/template/vendor).
 * @param {string} options.repo      Absolute target repository root.
 * @param {string} options.cwd       Session working directory, for UI-relative paths.
 * @param {string} options.topic     Human topic; used for folder + meta.
 * @param {string} options.mmd       Mermaid source.
 * @param {object} options.locs      Location table.
 * @param {{base: string, head: string}|undefined} options.review
 * @param {object} options.config    Plugin config (outputDir, editor).
 * @param {AbortSignal} [options.signal]
 */
export async function buildDiagram({ skillDir, repo, cwd, topic, mmd, locs, review, config, signal }) {
  const repoAbs = resolve(repo)
  if (!existsSync(repoAbs) || !statSync(repoAbs).isDirectory()) {
    return failure('args', `Repository not found: ${repoAbs}`)
  }

  const outputDir = typeof config?.outputDir === 'string' && config.outputDir.trim() !== ''
    ? config.outputDir.trim()
    : '.codegraph/output'
  const outRoot = resolve(repoAbs, outputDir)
  const tmpRoot = resolve(repoAbs, '.codegraph/.tmp')
  const work = join(tmpRoot, `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  mkdirSync(work, { recursive: true })
  const mmdPath = join(work, 'graph.mmd')
  const locsPath = join(work, 'graph.locs.json')
  writeFileSync(mmdPath, String(mmd), 'utf8')
  writeFileSync(locsPath, `${JSON.stringify(locs, null, 2)}\n`, 'utf8')

  let report
  try {
    const validated = await runNode(
      resolve(skillDir, 'scripts/validate.mjs'),
      ['--mmd', 'graph.mmd', '--locs', 'graph.locs.json', '--repo', repoAbs],
      { cwd: work, signal, timeoutMs: DEFAULT_TIMEOUT_MS },
    )
    report = parseValidation(validated.stdout)
    if (validated.timedOut || validated.overflow || validated.code !== 0 || report === null || report.ok !== true) {
      rmSync(work, { recursive: true, force: true })
      const details = (report?.errors ?? []).map((error) => ({
        ...error,
        path: typeof error.path === 'string' && error.path.startsWith(work)
          ? posix(relative(work, error.path))
          : error.path,
      }))
      const suffix = validated.timedOut
        ? 'Validation timed out.'
        : validated.overflow
          ? 'Validation output was too large.'
          : lastLines(validated.stderr) || 'Validation failed.'
      return failure('validate', suffix, {
        errors: details,
        warnings: report?.warnings ?? [],
      })
    }
  } catch (error) {
    rmSync(work, { recursive: true, force: true })
    return failure('validate', error.message ?? String(error))
  }

  signal?.throwIfAborted()

  const stamp = localStamp()
  const slug = slugify(topic)
  mkdirSync(outRoot, { recursive: true })
  let dirName = `${stamp}-${slug}`
  let outDir = join(outRoot, dirName)
  for (let index = 2; existsSync(outDir); index += 1) {
    dirName = `${stamp}-${slug}-${index}`
    outDir = join(outRoot, dirName)
  }
  renameSync(work, outDir)

  const finalMmd = join(outDir, 'graph.mmd')
  const finalLocs = join(outDir, 'graph.locs.json')
  const htmlPath = join(outDir, 'graph.html')
  const metaPath = join(outDir, 'graph.meta.json')

  const editor = typeof config?.editor === 'string' && config.editor !== '' ? config.editor : 'web'
  const editorConfig = join(tmpRoot, 'editor-config.json')
  writeFileSync(editorConfig, `${JSON.stringify({ editor: { id: editor, label: editor === 'web' ? 'Web' : editor } })}\n`, 'utf8')

  const args = [
    '--mmd', 'graph.mmd',
    '--locs', 'graph.locs.json',
    '--repo', repoAbs,
    '--out', 'graph.html',
    '--editor-config', editorConfig,
  ]
  if (review !== undefined) {
    args.push('--diff-base', review.base, '--diff-head', review.head)
  }

  let built
  try {
    built = await runNode(resolve(skillDir, 'scripts/build-html.mjs'), args, {
      cwd: outDir,
      signal,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
  } catch (error) {
    return failure('build', error.message ?? String(error), {
      dir: relativeTo(repoAbs, outDir),
      mmd: relativeTo(repoAbs, finalMmd),
      locs: relativeTo(repoAbs, finalLocs),
    })
  } finally {
    try { rmSync(editorConfig, { force: true }) } catch {}
  }

  if (built.timedOut || built.overflow || built.code !== 0 || !existsSync(htmlPath)) {
    const message = built.timedOut
      ? 'HTML build timed out.'
      : built.overflow
        ? 'HTML build output was too large.'
        : lastLines(built.stderr) || lastLines(built.stdout) || 'HTML build failed.'
    return failure('build', message, {
      dir: relativeTo(repoAbs, outDir),
      mmd: relativeTo(repoAbs, finalMmd),
      locs: relativeTo(repoAbs, finalLocs),
    })
  }

  const kinds = kindsOf(String(mmd))
  const stats = statsOf(locs)
  const meta = {
    schemaVersion: 1,
    topic: String(topic),
    createdAt: new Date().toISOString(),
    kinds,
    stats,
    review: review ?? null,
    repo: repoAbs,
    dir: relativeTo(repoAbs, outDir),
    html: relativeTo(repoAbs, htmlPath),
    generator: GENERATOR,
  }
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    topic: String(topic),
    dir: relativeTo(repoAbs, outDir),
    html: relativeTo(repoAbs, htmlPath),
    htmlRel: relativeOrAbsolute(cwd, htmlPath),
    htmlAbs: htmlPath,
    mmd: relativeTo(repoAbs, finalMmd),
    mmdRel: relativeOrAbsolute(cwd, finalMmd),
    mmdAbs: finalMmd,
    locs: relativeTo(repoAbs, finalLocs),
    locsRel: relativeOrAbsolute(cwd, finalLocs),
    locsAbs: finalLocs,
    meta: relativeTo(repoAbs, metaPath),
    metaRel: relativeOrAbsolute(cwd, metaPath),
    metaAbs: metaPath,
    repo: repoAbs,
    kinds,
    stats,
    ...(review !== undefined ? { review } : {}),
    errors: [],
    warnings: report.warnings ?? [],
  }
}

/**
 * List recent artifacts under the repository output root, newest first.
 */
export function listDiagrams({ repo, cwd, config, limit = 10 }) {
  const repoAbs = resolve(repo)
  const outputDir = typeof config?.outputDir === 'string' && config.outputDir.trim() !== ''
    ? config.outputDir.trim()
    : '.codegraph/output'
  const outRoot = resolve(repoAbs, outputDir)
  if (!existsSync(outRoot)) return { ok: true, items: [] }

  const entries = readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(outRoot, name, 'graph.html')))
    .map((name) => {
      try {
        return { name, mtime: statSync(join(outRoot, name, 'graph.html')).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)))

  const items = entries.map(({ name }) => {
    const dir = join(outRoot, name)
    const meta = readMeta(dir)
    const htmlPath = join(dir, 'graph.html')
    return {
      topic: typeof meta?.topic === 'string' ? meta.topic : fallbackTopic(name),
      dir: relativeTo(repoAbs, dir),
      html: relativeTo(repoAbs, htmlPath),
      htmlRel: relativeOrAbsolute(cwd, htmlPath),
      createdAt: typeof meta?.createdAt === 'string' ? meta.createdAt : null,
      kinds: Array.isArray(meta?.kinds) ? meta.kinds : inferKindsFromDir(dir),
      review: meta?.review ?? null,
      stats: meta?.stats ?? null,
    }
  })

  return { ok: true, items }
}
