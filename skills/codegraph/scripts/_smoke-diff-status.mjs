// _smoke-diff-status.mjs — quick smoke tests for diff-status.mjs
// Run: node skills/codegraph/scripts/_smoke-diff-status.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, 'diff-status.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'cg-diff-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(...args) {
  return execFileSync('git', ['-C', tmp, ...args], { encoding: 'utf8', env });
}
function run(args) {
  return JSON.parse(execFileSync(process.execPath, [scriptPath, '--repo', tmp, ...args], {
    encoding: 'utf8', env,
  }));
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); pass++; }
  else { console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); fail++; }
}
function checkFile(result, path, status, addedLines, removedLines) {
  const actual = result.files[path];
  check(`${path}: ${status} with exact lines`,
    JSON.stringify(actual) === JSON.stringify({ status, addedLines, removedLines }),
    JSON.stringify(actual));
}

try {
  // Ignore user Git defaults so fixtures and rename detection stay deterministic.
  git('init', '--initial-branch=main');
  for (const [key, value] of Object.entries({
    'user.email': 'test@example.com',
    'user.name': 'Test',
    'commit.gpgsign': 'false',
    'core.autocrlf': 'false',
    'core.quotePath': 'true',
    'core.hooksPath': '/dev/null',
    'diff.renames': 'true',
    'diff.algorithm': 'myers',
  })) git('config', '--local', key, value);

  mkdirSync(join(tmp, 'src'));
  const initialFiles = {
    'a.ts': 'line1\nline2\nline3\nline4\n',
    'b.ts': 'alpha\nbeta\n',
    'deleted.ts': 'delete1\ndelete2\n',
    'rename-old.ts': 'rename1\nrename2\nrename3\n',
    'hunks.ts': 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n',
    'insert.ts': 'one\ntwo\n',
    'remove.ts': 'first\nkeep1\nmiddle\nkeep2\nlast\n',
    'no-newline.ts': 'first\nold',
    'space name.ts': 'space old\n',
    '中文.ts': 'unicode old\n',
    'space 中文.ts': 'combined old\n',
  };
  for (const [path, content] of Object.entries(initialFiles)) {
    writeFileSync(join(tmp, 'src', path), content);
  }
  git('add', '.');
  git('commit', '-m', 'initial');
  const first = git('rev-parse', 'HEAD').trim();

  writeFileSync(join(tmp, 'src/a.ts'), 'line1\nline2a\nline2b\nline3\nline4\n');
  writeFileSync(join(tmp, 'src/c.ts'), 'new1\nnew2\n');
  rmSync(join(tmp, 'src/deleted.ts'));
  git('mv', 'src/rename-old.ts', 'src/rename-new.ts');
  writeFileSync(join(tmp, 'src/hunks.ts'), 'ONE\ntwo\nthree\nFOUR-a\nFOUR-b\nfive\nsix\nseven\nEIGHT\n');
  writeFileSync(join(tmp, 'src/insert.ts'), 'start\none\nmiddle\ntwo\nend\n');
  writeFileSync(join(tmp, 'src/remove.ts'), 'keep1\nkeep2\n');
  writeFileSync(join(tmp, 'src/no-newline.ts'), 'first\nnew');
  writeFileSync(join(tmp, 'src/space name.ts'), 'space new\n');
  writeFileSync(join(tmp, 'src/中文.ts'), 'unicode new\n');
  writeFileSync(join(tmp, 'src/space 中文.ts'), 'combined new\n');
  git('add', '.');
  git('commit', '-m', 'second');
  const second = git('rev-parse', 'HEAD').trim();

  const range = run(['--base', `${second}~1`, '--head', second]);
  check('range base sha', range.base === first, range.base);
  check('range head sha', range.head === second, range.head);
  checkFile(range, 'src/a.ts', 'modified', [2, 3], [2]);
  checkFile(range, 'src/c.ts', 'added', [1, 2], []);
  check('range b.ts untouched', !('src/b.ts' in range.files));
  checkFile(range, 'src/deleted.ts', 'deleted', [], [1, 2]);
  // Renames deliberately retain the v1 delete+add contract, including full lines.
  checkFile(range, 'src/rename-old.ts', 'deleted', [], [1, 2, 3]);
  checkFile(range, 'src/rename-new.ts', 'added', [1, 2, 3], []);
  checkFile(range, 'src/hunks.ts', 'modified', [1, 4, 5, 9], [1, 4, 8]);
  // Pure hunks at beginning, middle and end exercise zero-count header ranges.
  checkFile(range, 'src/insert.ts', 'modified', [1, 3, 5], []);
  checkFile(range, 'src/remove.ts', 'modified', [], [1, 3, 5]);
  checkFile(range, 'src/no-newline.ts', 'modified', [2], [2]);
  for (const path of ['space name.ts', '中文.ts', 'space 中文.ts']) {
    checkFile(range, `src/${path}`, 'modified', [1], [1]);
  }
  check('range includes exactly expected paths', Object.keys(range.files).length === 12,
    Object.keys(range.files).join(', '));

  const wtClean = run(['--base', 'HEAD', '--head', 'WORKTREE']);
  check('WORKTREE base sha', wtClean.base === second, wtClean.base);
  check('WORKTREE head sentinel', wtClean.head === 'WORKTREE', wtClean.head);
  check('WORKTREE clean files empty', Object.keys(wtClean.files).length === 0);

  writeFileSync(join(tmp, 'src/b.ts'), 'alpha\nbeta\ngamma\n');
  const wtDirty = run(['--base', 'HEAD', '--head', 'WORKTREE']);
  checkFile(wtDirty, 'src/b.ts', 'modified', [3], []);

  // WORKTREE compares tracked/index content with base; untracked files are excluded
  // until git add puts them in the index. It includes both staged and unstaged edits.
  writeFileSync(join(tmp, 'src/untracked.ts'), 'untracked\n');
  const wtUntracked = run(['--base', 'HEAD', '--head', 'WORKTREE']);
  check('WORKTREE excludes untracked file', !('src/untracked.ts' in wtUntracked.files));
  git('add', 'src/b.ts', 'src/untracked.ts');
  const wtStaged = run(['--base', 'HEAD', '--head', 'WORKTREE']);
  checkFile(wtStaged, 'src/b.ts', 'modified', [3], []);
  checkFile(wtStaged, 'src/untracked.ts', 'added', [1], []);
  writeFileSync(join(tmp, 'src/b.ts'), 'ALPHA\nbeta\ngamma\n');
  const wtMixed = run(['--base', 'HEAD', '--head', 'WORKTREE']);
  checkFile(wtMixed, 'src/b.ts', 'modified', [1, 3], [1]);
  checkFile(wtMixed, 'src/untracked.ts', 'added', [1], []);
  check('WORKTREE includes exactly tracked changes', Object.keys(wtMixed.files).length === 2);

  for (const [base, head] of [
    ['missing-base', 'HEAD'],
    ['HEAD', 'missing-head'],
    ['missing-base', 'WORKTREE'],
    ['WORKTREE', 'HEAD'],
  ]) {
    const invalid = spawnSync(process.execPath, [scriptPath, '--repo', tmp, '--base', base, '--head', head], {
      encoding: 'utf8', env,
    });
    check(`invalid refs ${base}..${head} exit nonzero`, invalid.status !== null && invalid.status !== 0);
    check(`invalid refs ${base}..${head} diagnostic`, /rev-parse.*failed/.test(invalid.stderr), invalid.stderr);
    check(`invalid refs ${base}..${head} no JSON`, invalid.stdout === '', invalid.stdout);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
