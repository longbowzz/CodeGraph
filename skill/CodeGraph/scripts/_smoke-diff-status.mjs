// _smoke-diff-status.mjs — quick smoke tests for diff-status.mjs
// Run: node skill/CodeGraph/scripts/_smoke-diff-status.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, 'diff-status.mjs');

const tmp = mkdtempSync(join(tmpdir(), 'cg-diff-'));

// Initialize a fresh git repo with a couple of commits.
function git(...args) {
  return execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8' });
}
git('init');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');

mkdirSync(join(tmp, 'src'), { recursive: true });
writeFileSync(join(tmp, 'src/a.ts'), 'line1\nline2\nline3\nline4\n');
writeFileSync(join(tmp, 'src/b.ts'), 'alpha\nbeta\n');
git('add', '.');
git('commit', '-m', 'initial');

const first = git('rev-parse', 'HEAD').trim();

// Second commit: modify a.ts (delete line2, add line2a, line2b), add c.ts, leave b.ts alone.
writeFileSync(join(tmp, 'src/a.ts'), 'line1\nline2a\nline2b\nline3\nline4\n');
writeFileSync(join(tmp, 'src/c.ts'), 'new1\nnew2\n');
git('add', '.');
git('commit', '-m', 'second');

const second = git('rev-parse', 'HEAD').trim();

function run(args) {
  const fullArgs = [scriptPath, '--repo', tmp, ...args];
  return JSON.parse(execFileSync('node', fullArgs, { encoding: 'utf8' }));
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); pass++; }
  else { console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}

// Case 1: commit range
const range = run(['--base', `${second}~1`, '--head', second]);
check('range base sha', range.base === first, `base=${range.base} first=${first}`);
check('range head sha', range.head === second, `head=${range.head} second=${second}`);
check('range a.ts modified', range.files['src/a.ts']?.status === 'modified');
check('range a.ts added lines', JSON.stringify(range.files['src/a.ts']?.addedLines) === '[2,3]',
  JSON.stringify(range.files['src/a.ts']?.addedLines));
check('range a.ts removed lines', JSON.stringify(range.files['src/a.ts']?.removedLines) === '[2]',
  JSON.stringify(range.files['src/a.ts']?.removedLines));
check('range c.ts added', range.files['src/c.ts']?.status === 'added');
check('range c.ts added lines count', range.files['src/c.ts']?.addedLines.length === 2);
check('range b.ts untouched', !('src/b.ts' in range.files));

// Case 2: working tree vs HEAD (no changes)
const wtClean = run(['--base', 'HEAD', '--head', 'WORKTREE']);
check('WORKTREE clean files empty', Object.keys(wtClean.files).length === 0,
  Object.keys(wtClean.files).join(', '));

// Case 3: working tree with unstaged change
writeFileSync(join(tmp, 'src/b.ts'), 'alpha\nbeta\ngamma\n');
const wtDirty = run(['--base', 'HEAD', '--head', 'WORKTREE']);
check('WORKTREE b.ts modified', wtDirty.files['src/b.ts']?.status === 'modified');
check('WORKTREE b.ts added line', JSON.stringify(wtDirty.files['src/b.ts']?.addedLines) === '[3]',
  JSON.stringify(wtDirty.files['src/b.ts']?.addedLines));

console.log(`\n${pass} passed, ${fail} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
