// CodeGraph for DeepSeek Harness — Host half.
//
// Registers:
//   - the `codegraph` runtime skill (the existing CodeGraph contract plus a
//     short DSH runtime adapter),
//   - `codegraph_build` and `codegraph_list` tools.
//
// Only Node built-ins and workspace files are imported, so the bundle needs no
// npm dependency resolution.

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDiagram, listDiagrams } from './lib/build.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(HERE, '..', 'skill', 'CodeGraph')
const ADAPTER = resolve(HERE, 'skill-adapter.md')
const VERSION = '0.1.0'

export const name = 'codegraph'
export const inject = ['tools', 'skills', 'workingDirectory']

const DIAGNOSTIC = {
  type: 'object',
  additionalProperties: false,
  properties: {
    level: { type: 'string' },
    code: { type: 'string' },
    path: { type: 'string' },
    message: { type: 'string' },
    fix_hint: { type: 'string' },
  },
}

const BUILD_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    stage: { type: 'string' },
    topic: { type: 'string' },
    dir: { type: 'string' },
    html: { type: 'string' },
    htmlRel: { type: 'string' },
    htmlAbs: { type: 'string' },
    mmd: { type: 'string' },
    mmdRel: { type: 'string' },
    mmdAbs: { type: 'string' },
    locs: { type: 'string' },
    locsRel: { type: 'string' },
    locsAbs: { type: 'string' },
    meta: { type: 'string' },
    metaRel: { type: 'string' },
    metaAbs: { type: 'string' },
    repo: { type: 'string' },
    kinds: { type: 'array', items: { type: 'string' } },
    stats: { type: 'object', additionalProperties: true },
    review: { type: 'object', additionalProperties: true },
    errors: { type: 'array', items: DIAGNOSTIC },
    warnings: { type: 'array', items: DIAGNOSTIC },
    message: { type: 'string' },
  },
}

const BUILD_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topic: {
      type: 'string',
      description: 'Short human-readable title in the user\'s language. Used for the output folder and the graph title.',
    },
    mmd: {
      type: 'string',
      description: 'Mermaid flowchart and/or sequenceDiagram source. Load the codegraph skill first; it defines the supported syntax and label rules.',
    },
    locs: {
      type: 'object',
      additionalProperties: true,
      description: 'Source-location table matching mmd exactly. Load the codegraph skill for the flowchart and sequence formats.',
    },
    review: {
      type: 'object',
      additionalProperties: false,
      properties: {
        base: { type: 'string', description: 'Git base ref, commit, or pr/<number>.' },
        head: { type: 'string', description: 'Git head ref, commit, WORKTREE, or pr/<number>.' },
      },
      required: ['base', 'head'],
      description: 'Optional diff range. When set, the diagram is built in review mode with added/modified/removed colors.',
    },
    repo: {
      type: 'string',
      description: 'Repository root, relative to the session workspace. Defaults to the workspace itself and must stay inside it.',
    },
  },
  required: ['topic', 'mmd', 'locs'],
}

const LIST_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      description: 'Maximum number of artifacts to return, newest first. Defaults to 10, maximum 50.',
    },
    repo: {
      type: 'string',
      description: 'Repository root, relative to the session workspace. Defaults to the workspace itself.',
    },
  },
}

function failure(stage, message, errors = []) {
  return { ok: false, stage, message, errors, warnings: [] }
}

function resolveRepo(cwd, repoArg) {
  const repo = repoArg === undefined || repoArg === null || repoArg === ''
    ? cwd
    : resolve(cwd, repoArg)
  const rel = relative(cwd, repo)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    return { error: `repo must stay inside the session workspace: ${cwd}` }
  }
  return { repo }
}

function readLocs(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }
  return null
}

function validateBuildArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return 'arguments must be an object'
  }
  if (typeof args.topic !== 'string' || args.topic.trim() === '') return 'topic must be a non-empty string'
  if (typeof args.mmd !== 'string' || args.mmd.trim() === '') return 'mmd must be a non-empty string'
  if (readLocs(args.locs) === null) return 'locs must be a location object'
  if (args.review !== undefined) {
    if (args.review === null || typeof args.review !== 'object') return 'review must be { base, head }'
    if (typeof args.review.base !== 'string' || args.review.base.trim() === '') return 'review.base must be a non-empty string'
    if (typeof args.review.head !== 'string' || args.review.head.trim() === '') return 'review.head must be a non-empty string'
  }
  if (args.repo !== undefined && typeof args.repo !== 'string') return 'repo must be a string'
  return null
}

function renderBuild(value) {
  if (value.ok) {
    const lines = [`CodeGraph built: ${value.htmlRel ?? value.html ?? value.dir}`]
    const facts = []
    if (Array.isArray(value.kinds) && value.kinds.length > 0) facts.push(value.kinds.join(' + '))
    if (value.stats?.nodes) facts.push(`${value.stats.nodes} nodes / ${value.stats.edges} edges`)
    if (value.stats?.messages) facts.push(`${value.stats.actors} actors / ${value.stats.messages} messages`)
    if (value.review) facts.push(`review ${value.review.base}..${value.review.head}`)
    if (facts.length > 0) lines.push(facts.join(' · '))
    if (Array.isArray(value.warnings) && value.warnings.length > 0) {
      lines.push(`${value.warnings.length} warning(s)`)
    }
    return [{ type: 'text', text: lines.join('\n') }]
  }

  const lines = [`CodeGraph ${value.stage ?? 'build'} failed.`]
  for (const error of Array.isArray(value.errors) ? value.errors : []) {
    const head = [error.code, error.path].filter(Boolean).join(' ')
    lines.push(`- ${head}${head ? ': ' : ''}${error.message ?? ''}`.trimEnd())
    if (error.fix_hint) lines.push(`  Fix: ${error.fix_hint}`)
  }
  if (value.message) lines.push(value.message)
  return [{ type: 'text', text: lines.join('\n') }]
}

function buildTool(ctx, config, skillDir) {
  return {
    name: 'codegraph_build',
    description:
      'Build a CodeGraph diagram from Mermaid source plus exact source locations into a self-contained HTML artifact. Load the `codegraph` skill first; it defines the label, location, and edge-identity contract. Validation failures return structured errors with fix hints: correct the inputs and call again, at most three rounds.',
    parameters: BUILD_PARAMETERS,
    output: {
      schema: BUILD_OUTPUT,
      render: (_args, value) => renderBuild(value),
      presentationMeta: (_args, value) => ({
        v: 1,
        version: VERSION,
        ok: value.ok === true,
        stage: value.stage ?? null,
        topic: value.topic ?? null,
        dir: value.dir ?? null,
        html: value.htmlRel ?? value.html ?? null,
        htmlAbs: value.htmlAbs ?? null,
        mmd: value.mmdRel ?? value.mmd ?? null,
        mmdAbs: value.mmdAbs ?? null,
        kinds: Array.isArray(value.kinds) ? value.kinds : [],
        stats: value.stats ?? null,
        review: value.review ?? null,
        errors: Array.isArray(value.errors) ? value.errors : [],
        warnings: Array.isArray(value.warnings) ? value.warnings : [],
        message: value.message ?? null,
      }),
    },
    timeoutMs: 240_000,
    isConcurrencySafe: false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('codegraph_build requires an agent Session')
      const invalid = validateBuildArgs(args)
      if (invalid !== null) return failure('args', invalid)

      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const target = resolveRepo(cwd, args.repo)
      if (target.error !== undefined) return failure('args', target.error)

      try {
        return await buildDiagram({
          skillDir,
          repo: target.repo,
          cwd,
          topic: args.topic.trim(),
          mmd: args.mmd,
          locs: readLocs(args.locs),
          review: args.review,
          config,
          signal: exec.signal,
        })
      } catch (error) {
        return failure('internal', error?.message ?? String(error))
      }
    },
  }
}

function listTool(ctx, config) {
  return {
    name: 'codegraph_list',
    description:
      'List recent CodeGraph artifacts in the workspace, newest first. Use it to find or reopen a graph generated earlier or by a subagent.',
    parameters: LIST_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.ok !== true) {
          return [{ type: 'text', text: `CodeGraph list failed: ${value.message ?? 'unknown error'}` }]
        }
        if (value.items.length === 0) {
          return [{ type: 'text', text: 'No CodeGraph artifacts found in this workspace.' }]
        }
        const lines = value.items.map((item) => {
          const kinds = Array.isArray(item.kinds) && item.kinds.length > 0 ? ` (${item.kinds.join(' + ')})` : ''
          return `- ${item.topic}${kinds}: ${item.htmlRel ?? item.html}`
        })
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe: true,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('codegraph_list requires an agent Session')
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const target = resolveRepo(cwd, args?.repo)
      if (target.error !== undefined) return { ok: false, message: target.error, items: [] }
      try {
        return listDiagrams({
          repo: target.repo,
          cwd,
          config,
          limit: args?.limit,
        })
      } catch (error) {
        return { ok: false, message: error?.message ?? String(error), items: [] }
      }
    },
  }
}

function loadSkillBody() {
  const adapter = readFileSync(ADAPTER, 'utf8')
  const contract = readFileSync(resolve(SKILL_DIR, 'SKILL.md'), 'utf8')
  return `${adapter}\n\n---\n\n${contract}`
}

export function apply(ctx, config) {
  const options = config !== null && typeof config === 'object' ? config : {}

  ctx.effect(
    () => ctx.skills.register({
      name: 'codegraph',
      description:
        'Generate an interactive, source-linked flowchart or sequence diagram from a codebase, with diff-aware review mode.',
      whenToUse:
        'Use when the user asks to visualize a code flow, call sequence, request lifecycle, or architecture path, or to review a PR/commit as a diagram — even when they do not say CodeGraph.',
      content: loadSkillBody(),
      path: resolve(SKILL_DIR, 'SKILL.md'),
      resourceBase: { kind: 'directory', path: SKILL_DIR },
      source: 'custom',
      invocation: { modelInvocable: true, userInvocable: true },
    }),
    'codegraph: skill',
  )

  ctx.effect(
    () => ctx.tools.register(buildTool(ctx, options, SKILL_DIR)),
    'codegraph: codegraph_build',
  )
  ctx.effect(
    () => ctx.tools.register(listTool(ctx, options)),
    'codegraph: codegraph_list',
  )
}
