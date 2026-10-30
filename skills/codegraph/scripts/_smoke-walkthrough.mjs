// Smoke test for the CodeWalkthrough builder + verifier.
//
// Runs from a cloned repo or an installed skill: it builds the committed sample
// against a self-contained fixture repo, then removes the temp directory.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skillDir = resolve(here, '..')
const temp = mkdtempSync(join(tmpdir(), 'cg-walkthrough-'))
const out = join(temp, 'walkthrough.html')

// The committed sample references DSH source files. Build a tiny fixture repo
// instead of assuming this script still lives inside the CodeGraph checkout.
const repo = join(temp, 'repo')
mkdirSync(join(repo, 'dsh', 'lib'), { recursive: true })
const filler = (label, lines) => Array.from({ length: lines }, (_, i) => `// ${label} ${i + 1}`).join('\n') + '\n'
writeFileSync(join(repo, 'dsh', 'index.js'), filler('index', 700))
writeFileSync(join(repo, 'dsh', 'client.js'), filler('client', 700))
writeFileSync(join(repo, 'dsh', 'lib', 'build.js'), filler('build', 700))

try {
  const raw = execFileSync(process.execPath, [
    resolve(here, 'build-walkthrough.mjs'),
    '--content', resolve(skillDir, 'examples', 'walkthrough-sample.html'),
    '--repo', repo,
    '--topic', 'CodeWalkthrough smoke test',
    '--language', 'zh',
    '--out', out,
  ], { cwd: repo, encoding: 'utf8' })
  const built = JSON.parse(raw)
  assert.equal(built.ok, true)
  assert.equal(built.stats.pages, 6)
  assert.equal(built.stats.sources, 3)
  assert.equal(built.stats.codeBlocks, 1)
  assert.equal(existsSync(out), true)

  const verifiedRaw = execFileSync(process.execPath, [
    resolve(here, 'verify-walkthrough.mjs'),
    '--file', out,
    '--repo', repo,
  ], { cwd: repo, encoding: 'utf8' })
  const verified = JSON.parse(verifiedRaw)
  assert.equal(verified.ok, true, JSON.stringify(verified.errors))
  assert.equal(verified.pages, 6)
  assert.equal(verified.codeBlocks, 1)
  console.log('walkthrough smoke: all-pass')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
