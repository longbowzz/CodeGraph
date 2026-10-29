// Smoke test for the CodeWalkthrough builder + verifier.
//
// Run from the repository root: node skill/CodeGraph/scripts/_smoke-walkthrough.mjs
// It builds the committed sample into a temp directory and removes it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skillDir = resolve(here, '..')
const repo = resolve(skillDir, '..', '..')
const temp = mkdtempSync(join(tmpdir(), 'cg-walkthrough-'))
const out = join(temp, 'walkthrough.html')

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
