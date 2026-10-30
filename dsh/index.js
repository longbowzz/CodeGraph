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
import { buildWalkthrough } from './lib/walkthrough.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(HERE, '..', 'skills', 'codegraph')
const ADAPTER = resolve(HERE, 'skill-adapter.md')
const VERSION = '0.2.0'

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
      description: 'Mermaid flowchart, sequenceDiagram, or classDiagram source. Load the codegraph skill first; it defines the supported syntax and label rules.',
    },
    locs: {
      type: 'object',
      additionalProperties: true,
      description: 'Source-location table matching mmd exactly. Load the codegraph skill for the flowchart, sequence, and classDiagram formats.',
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

const WALKTHROUGH_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    kind: { type: 'string' },
    stage: { type: 'string' },
    topic: { type: 'string' },
    dir: { type: 'string' },
    html: { type: 'string' },
    htmlRel: { type: 'string' },
    htmlAbs: { type: 'string' },
    meta: { type: 'string' },
    metaRel: { type: 'string' },
    metaAbs: { type: 'string' },
    content: { type: 'string' },
    contentRel: { type: 'string' },
    contentAbs: { type: 'string' },
    repo: { type: 'string' },
    pages: { type: 'array', items: { type: 'object', additionalProperties: true } },
    sources: { type: 'array', items: { type: 'string' } },
    stats: { type: 'object', additionalProperties: true },
    verify: { type: 'object', additionalProperties: true },
    errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    warnings: { type: 'array', items: { type: 'object', additionalProperties: true } },
    message: { type: 'string' },
  },
}

const WALKTHROUGH_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topic: {
      type: 'string',
      description: 'Short human-readable title in the user\'s language. Used for the output folder and the article title.',
    },
    html: {
      type: 'string',
      description: 'The CodeWalkthrough content body fragment (sections with class="cw-section"; arbitrary inline HTML/SVG/CSS/JS is allowed). Read references/walkthrough.md before writing it. Source code must be referenced with data-source/data-code, not hand-copied.',
    },
    language: {
      type: 'string',
      description: 'Content/UI language, for example zh or en. Use the user\'s usual chat language unless they explicitly request another one.',
    },
    audience: {
      type: 'string',
      description: 'One-line reader profile confirmed during intake, for example: web developer new to the payments domain.',
    },
    scope: {
      type: 'string',
      description: 'One-line scope confirmed during intake, for example: refund entry point through ledger posting.',
    },
    repo: {
      type: 'string',
      description: 'Repository root, relative to the session workspace. Defaults to the workspace itself and must stay inside it.',
    },
  },
  required: ['topic', 'html'],
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
      'List recent CodeGraph artifacts in the workspace, newest first. Includes graphs and CodeWalkthrough explainers; use it to find or reopen an earlier artifact or one created by a subagent.',
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
          const kind = item.kind === 'walkthrough' ? 'walkthrough' : 'graph'
          const kinds = Array.isArray(item.kinds) && item.kinds.length > 0 ? ` (${item.kinds.join(' + ')})` : ''
          const facts = kind === 'walkthrough'
            ? ` · ${item.pages ?? 0} sections / ${item.sources ?? 0} sources`
            : kinds
          return `- [${kind}] ${item.topic}${facts}: ${item.htmlRel ?? item.html}`
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

function validateWalkthroughArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return 'arguments must be an object'
  }
  if (typeof args.topic !== 'string' || args.topic.trim() === '') return 'topic must be a non-empty string'
  if (typeof args.html !== 'string' || args.html.trim() === '') return 'html must be a non-empty string'
  for (const key of ['language', 'audience', 'scope', 'repo']) {
    if (args[key] !== undefined && typeof args[key] !== 'string') return `${key} must be a string`
  }
  return null
}

function renderWalkthrough(value) {
  if (value.ok) {
    const lines = [`CodeWalkthrough built: ${value.htmlRel ?? value.html ?? value.dir}`]
    const facts = []
    if (value.stats?.pages) facts.push(`${value.stats.pages} sections`)
    if (value.stats?.sources) facts.push(`${value.stats.sources} source files`)
    if (value.stats?.codeBlocks) facts.push(`${value.stats.codeBlocks} code blocks`)
    if (facts.length > 0) lines.push(facts.join(' · '))
    if (value.verify?.ok === true) lines.push('Self-check passed.')
    if (Array.isArray(value.warnings) && value.warnings.length > 0) {
      lines.push(`${value.warnings.length} warning(s)`)
    }
    return [{ type: 'text', text: lines.join('\n') }]
  }

  const lines = [`CodeWalkthrough ${value.stage ?? 'build'} failed.`]
  for (const error of Array.isArray(value.errors) ? value.errors : []) {
    const head = [error.code, error.path].filter(Boolean).join(' ')
    lines.push(`- ${head}${head ? ': ' : ''}${error.message ?? ''}`.trimEnd())
    if (error.fix_hint) lines.push(`  Fix: ${error.fix_hint}`)
  }
  if (value.message) lines.push(value.message)
  return [{ type: 'text', text: lines.join('\n') }]
}

function walkthroughTool(ctx, config, skillDir) {
  return {
    name: 'codegraph_walkthrough_build',
    description:
      'Build a single-file, long-form CodeWalkthrough explainer that explains a module or flow. Use this (not codegraph_build) for an introduction, walkthrough, tutorial, or explainer article. First load the `codegraph` skill and read `references/walkthrough.md`; ask the user the intake questions, read the relevant code and tests, and write objective content with data-source/data-code references. The tool embeds the source, assembles the shell, runs the static self-check, and returns structured errors with fix hints. At most 3 repair rounds, then stop.',
    parameters: WALKTHROUGH_PARAMETERS,
    output: {
      schema: WALKTHROUGH_OUTPUT,
      render: (_args, value) => renderWalkthrough(value),
      presentationMeta: (_args, value) => ({
        v: 1,
        version: VERSION,
        kind: 'walkthrough',
        ok: value.ok === true,
        stage: value.stage ?? null,
        topic: value.topic ?? null,
        dir: value.dir ?? null,
        html: value.htmlRel ?? value.html ?? null,
        htmlAbs: value.htmlAbs ?? null,
        pages: Array.isArray(value.pages) ? value.pages : [],
        sources: Array.isArray(value.sources) ? value.sources : [],
        stats: value.stats ?? null,
        verify: value.verify ?? null,
        errors: Array.isArray(value.errors) ? value.errors : [],
        warnings: Array.isArray(value.warnings) ? value.warnings : [],
        message: value.message ?? null,
      }),
    },
    timeoutMs: 240_000,
    isConcurrencySafe: false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('codegraph_walkthrough_build requires an agent Session')
      const invalid = validateWalkthroughArgs(args)
      if (invalid !== null) return failure('args', invalid)

      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const target = resolveRepo(cwd, args.repo)
      if (target.error !== undefined) return failure('args', target.error)

      try {
        return await buildWalkthrough({
          skillDir,
          repo: target.repo,
          cwd,
          topic: args.topic.trim(),
          html: args.html,
          language: args.language,
          audience: args.audience,
          scope: args.scope,
          config,
          signal: exec.signal,
        })
      } catch (error) {
        return failure('internal', error?.message ?? String(error))
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
        'Generate source-linked diagrams and long-form CodeWalkthrough explainers from a codebase, with diff-aware graph review mode.',
      whenToUse:
        'Use when the user asks CodeGraph to visualize a flow, call sequence, lifecycle, architecture path, or UML class model (graph workflow), or to introduce/explain/teach a module or flow as a long-form interactive explainer (CodeWalkthrough workflow) — even when they do not say CodeGraph.',
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
    () => ctx.tools.register(walkthroughTool(ctx, options, SKILL_DIR)),
    'codegraph: codegraph_walkthrough_build',
  )
  ctx.effect(
    () => ctx.tools.register(listTool(ctx, options)),
    'codegraph: codegraph_list',
  )
}
