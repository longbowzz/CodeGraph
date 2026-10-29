// CLI contracts. Run with node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const tools = ['validate.mjs', 'build-html.mjs', 'diff-status.mjs', 'verify-html.mjs'];
function run(tool, args) {
  const result = spawnSync(process.execPath, [join(scripts, tool), ...args], { encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}

for (const tool of tools) {
  test(`${tool}: help and missing arguments use exit 2 and stderr`, () => {
    for (const args of [['--help'], []]) {
      const result = run(tool, args);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Usage:|Missing required/);
      assert.equal(result.stdout, '');
    }
  });
}

test('all CLIs reject unknown arguments even when required arguments are present', () => {
  const args = {
    'validate.mjs': ['--mmd', 'unused', '--locs', 'unused', '--repo', '.'],
    'build-html.mjs': ['--mmd', 'unused', '--locs', 'unused', '--repo', '.', '--out', 'unused'],
    'diff-status.mjs': ['--repo', '.', '--base', 'HEAD', '--head', 'WORKTREE'],
    'verify-html.mjs': ['--html', 'unused'],
  };
  for (const tool of tools) {
    const result = run(tool, [...args[tool], '--unexpected-option']);
    assert.equal(result.status, 2, `${tool}: ${result.stderr}`);
    assert.match(result.stderr, /Unknown arg/);
    assert.equal(result.stdout, '');
  }
});

test('invalid location JSON yields structured validator failure and no successful build', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cg-cli-'));
  try {
    const mmd = join(repo, 'graph.mmd'), locs = join(repo, 'graph.locs.json');
    const html = join(repo, 'graph.html');
    writeFileSync(mmd, 'flowchart LR\nA[Work]');
    writeFileSync(locs, '{broken');
    const args = ['--mmd', mmd, '--locs', locs, '--repo', repo];
    const validation = run('validate.mjs', args);
    assert.equal(validation.status, 1);
    const report = JSON.parse(validation.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.errors[0].code, 'LOCS_JSON_ERROR');
    const build = run('build-html.mjs', [...args, '--out', html]);
    assert.equal(build.status, 1);
    assert.ok(build.stderr);
    assert.equal(existsSync(html), false);
    const verification = run('verify-html.mjs', ['--html', html]);
    assert.equal(verification.status, 1);
    assert.match(verification.stderr, /read|ENOENT/i);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
