// _smoke-validate.mjs — quick smoke tests for validate.mjs
// Run: node skill/CodeGraph/scripts/_smoke-validate.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'cg-validate-'));
const repo = tmp;
// Fake source files for path-existence checks
mkdirSync(join(repo, 'src'), { recursive: true });
writeFileSync(join(repo, 'src/handler.ts'), 'export const a = 1;\n'.repeat(60));
writeFileSync(join(repo, 'src/auth.ts'), 'export const b = 2;\n'.repeat(60));
writeFileSync(join(repo, 'src/audit.ts'), 'export const c = 3;\n'.repeat(10));
writeFileSync(join(repo, 'src/client.ts'), 'export const d = 4;\n'.repeat(10));
writeFileSync(join(repo, 'src/server.ts'), 'export const e = 5;\n'.repeat(60));

const outDir = join(repo, '.codegraph', 'output', 'test');
mkdirSync(outDir, { recursive: true });

const V = join(repo, '..', '..', 'skill', 'CodeGraph', 'scripts', 'validate.mjs');
// Resolve V relative to project root
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const validatePath = join(here, 'validate.mjs');

function runExpect(args, expectOk, name) {
  const mmd = join(outDir, 'graph.mmd');
  const locs = join(outDir, 'graph.locs.json');
  writeFileSync(mmd, args.mmd);
  writeFileSync(locs, JSON.stringify(args.locs, null, 2));
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync('node', [validatePath, '--mmd', mmd, '--locs', locs, '--repo', repo], {
      encoding: 'utf8',
    });
  } catch (e) {
    stdout = e.stdout || '';
    exitCode = e.status ?? 1;
  }
  const parsed = JSON.parse(stdout);
  const actualOk = parsed.ok === true;
  if (actualOk === expectOk) {
    console.log(`PASS  ${name}${actualOk ? '' : ' (rejected: ' + (parsed.errors?.[0]?.code || '?') + ')'}`);
    return true;
  } else {
    console.log(`FAIL  ${name} — expected ok=${expectOk}, got ok=${parsed.ok}`);
    console.log('       ' + JSON.stringify(parsed.errors || parsed).slice(0, 300));
    return false;
  }
}

let pass = 0, fail = 0;
const cases = [
  // Should pass: flowchart with all aligned
  {
    name: 'flowchart happy',
    mmd: `flowchart TD
A([接收登录请求]) --> B{已登录?}
B -->|是| C[返回用户信息]
B -->|否| D[验证密码]
D --> E[生成 token]
E --> C
C --> F[(写审计日志)]`,
    locs: {
      A: ['src/handler.ts', 12],
      B: ['src/handler.ts', 20],
      C: ['src/handler.ts', 35],
      D: ['src/auth.ts', 8],
      E: ['src/auth.ts', 45],
      F: ['src/audit.ts', 4],
    },
    expectOk: true,
  },
  // Should fail: missing loc
  {
    name: 'missing loc',
    mmd: `flowchart TD\nA[x] --> B[y]`,
    locs: { A: ['src/handler.ts', 1] },
    expectOk: false,
  },
  // Should fail: orphan loc
  {
    name: 'orphan loc',
    mmd: `flowchart TD\nA[x] --> B[y]`,
    locs: { A: ['src/handler.ts', 1], B: ['src/handler.ts', 2], Z: ['src/handler.ts', 3] },
    expectOk: false,
  },
  // Should fail: bad path (absolute)
  {
    name: 'absolute path',
    mmd: `flowchart TD\nA[x] --> B[y]`,
    locs: { A: ['/etc/passwd', 1], B: ['src/handler.ts', 2] },
    expectOk: false,
  },
  // Should fail: nonexistent file
  {
    name: 'nonexistent file',
    mmd: `flowchart TD\nA[x] --> B[y]`,
    locs: { A: ['src/nope.ts', 1], B: ['src/handler.ts', 2] },
    expectOk: false,
  },
  // Should fail: bad line number
  {
    name: 'bad line',
    mmd: `flowchart TD\nA[x] --> B[y]`,
    locs: { A: ['src/handler.ts', 0], B: ['src/handler.ts', 2] },
    expectOk: false,
  },
  // Sequence happy
  {
    name: 'sequence happy',
    mmd: `sequenceDiagram
participant C as Client
participant S as Server
C->>S: req
S-->>C: res`,
    locs: {
      actors: {
        C: ['src/client.ts', 1],
        S: ['src/server.ts', 30],
      },
      messages: [
        ['src/server.ts', 35],
        ['src/server.ts', 50],
      ],
    },
    expectOk: true,
  },
  // Sequence: wrong message count
  {
    name: 'seq msg count mismatch',
    mmd: `sequenceDiagram
participant C as Client
participant S as Server
C->>S: req
S-->>C: res`,
    locs: {
      actors: { C: ['src/client.ts', 1], S: ['src/server.ts', 30] },
      messages: [['src/server.ts', 35]],
    },
    expectOk: false,
  },
  // Sequence: missing actor
  {
    name: 'seq missing actor',
    mmd: `sequenceDiagram
participant C as Client
participant S as Server
C->>S: req`,
    locs: {
      actors: { C: ['src/client.ts', 1] },
      messages: [['src/server.ts', 35]],
    },
    expectOk: false,
  },
  // Mixed both: wrapper form
  {
    name: 'mixed both happy',
    mmd: `flowchart TD
A([入口]) --> B[校验]

sequenceDiagram
participant A as H
participant B as S
A->>B: process()
B-->>A: result`,
    locs: {
      flowchart: {
        A: ['src/handler.ts', 5],
        B: ['src/auth.ts', 12],
      },
      sequence: {
        actors: { A: ['src/handler.ts', 5], B: ['src/auth.ts', 12] },
        messages: [
          ['src/handler.ts', 20],
          ['src/handler.ts', 25],
        ],
      },
    },
    expectOk: true,
  },
];

for (const c of cases) {
  if (runExpect(c, c.expectOk, c.name)) pass++; else fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
