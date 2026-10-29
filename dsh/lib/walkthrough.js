// Host-side CodeWalkthrough pipeline.
//
// The skill script owns content parsing, source embedding, shell assembly, and
// static verification. This module only owns:
//   - temp content placement,
//   - invoking the script,
//   - returning UI-relative artifact paths,
//   - running the verifier before reporting success.

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runNode } from './build.js'

const DEFAULT_TIMEOUT_MS = 240_000

function failure(stage, message, extra = {}) {
  return { ok: false, stage, message, errors: [], warnings: [], ...extra }
}

function parseJson(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  try { return JSON.parse(raw) } catch {}
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null }
}

function lastLines(text, count = 8) {
  return String(text ?? '').trimEnd().split(/\r?\n/).filter(Boolean).slice(-count).join('\n')
}

/**
 * Build one CodeWalkthrough artifact.
 *
 * @param {object} options
 * @param {string} options.skillDir  CodeGraph skill directory.
 * @param {string} options.repo      Absolute repository root.
 * @param {string} options.cwd       Session working directory.
 * @param {string} options.topic     Human topic.
 * @param {string} options.html      Content body fragment.
 * @param {string} [options.language]
 * @param {string} [options.audience]
 * @param {string} [options.scope]
 * @param {object} [options.config]  Plugin config (outputDir).
 * @param {AbortSignal} [options.signal]
 */
export async function buildWalkthrough({ skillDir, repo, cwd, topic, html, language, audience, scope, config, signal }) {
  const repoAbs = resolve(repo)
  if (!existsSync(repoAbs) || !statSync(repoAbs).isDirectory()) {
    return failure('args', `Repository not found: ${repoAbs}`)
  }

  const tmpRoot = resolve(repoAbs, '.codegraph/.tmp')
  const work = join(tmpRoot, `walkthrough-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const contentPath = join(work, 'content.html')
  try {
    mkdirSync(work, { recursive: true })
    writeFileSync(contentPath, String(html), 'utf8')
  } catch (error) {
    rmSync(work, { recursive: true, force: true })
    return failure('write', `Cannot write walkthrough content: ${error.message ?? String(error)}`)
  }

  const outputDir = typeof config?.outputDir === 'string' && config.outputDir.trim() !== ''
    ? config.outputDir.trim()
    : '.codegraph/output'
  const args = [
    '--content', contentPath,
    '--repo', repoAbs,
    '--topic', String(topic),
    '--language', typeof language === 'string' && language.trim() !== '' ? language.trim() : 'en',
    '--output-dir', outputDir,
  ]
  if (typeof audience === 'string' && audience.trim() !== '') args.push('--audience', audience.trim())
  if (typeof scope === 'string' && scope.trim() !== '') args.push('--scope', scope.trim())

  let built
  try {
    built = await runNode(resolve(skillDir, 'scripts/build-walkthrough.mjs'), args, {
      cwd: repoAbs,
      signal,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
  } catch (error) {
    rmSync(work, { recursive: true, force: true })
    return failure('build', error.message ?? String(error))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  if (built.timedOut || built.overflow || built.code !== 0) {
    const message = built.timedOut
      ? 'CodeWalkthrough build timed out.'
      : built.overflow
        ? 'CodeWalkthrough build output was too large.'
        : lastLines(built.stderr) || lastLines(built.stdout) || 'CodeWalkthrough build failed.'
    const report = parseJson(built.stdout)
    return failure('build', message, {
      errors: Array.isArray(report?.errors) ? report.errors : [],
      warnings: Array.isArray(report?.warnings) ? report.warnings : [],
    })
  }

  const result = parseJson(built.stdout)
  if (result === null || result.ok !== true) {
    return failure('build', result?.message ?? 'CodeWalkthrough build returned no result.', {
      errors: Array.isArray(result?.errors) ? result.errors : [],
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    })
  }

  let verify = null
  try {
    const verified = await runNode(resolve(skillDir, 'scripts/verify-walkthrough.mjs'), [
      '--file', result.htmlAbs,
      '--repo', repoAbs,
    ], { cwd: repoAbs, signal, timeoutMs: 60_000 })
    verify = parseJson(verified.stdout)
    if (verify === null) {
      return failure('verify', lastLines(verified.stderr) || 'CodeWalkthrough verifier returned no report.', {
        dir: result.dir,
        html: result.html,
        htmlRel: result.htmlRel,
        htmlAbs: result.htmlAbs,
        repo: repoAbs,
        pages: result.pages,
        sources: result.sources,
        stats: result.stats,
      })
    }
    if (verify.ok !== true) {
      const errors = (Array.isArray(verify.errors) ? verify.errors : []).map((message) => ({
        code: 'verify',
        message: String(message),
      }))
      return failure('verify', 'CodeWalkthrough self-check failed.', {
        dir: result.dir,
        html: result.html,
        htmlRel: result.htmlRel,
        htmlAbs: result.htmlAbs,
        repo: repoAbs,
        pages: result.pages,
        sources: result.sources,
        stats: result.stats,
        verify,
        errors,
        warnings: Array.isArray(verify.warnings) ? verify.warnings : [],
      })
    }
  } catch (error) {
    return failure('verify', error.message ?? String(error))
  }

  return {
    ok: true,
    kind: 'walkthrough',
    topic: result.topic,
    dir: result.dir,
    html: result.html,
    htmlRel: result.htmlRel,
    htmlAbs: result.htmlAbs,
    meta: result.meta,
    metaRel: result.metaRel,
    metaAbs: result.metaAbs,
    content: result.content,
    contentRel: result.contentRel,
    contentAbs: result.contentAbs,
    repo: result.repo,
    pages: Array.isArray(result.pages) ? result.pages : [],
    sources: Array.isArray(result.sources) ? result.sources : [],
    stats: result.stats ?? null,
    verify,
    errors: [],
    warnings: [
      ...(Array.isArray(result.warnings) ? result.warnings : []),
      ...(Array.isArray(verify?.warnings) ? verify.warnings : []),
    ],
  }
}
