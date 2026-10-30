// _smoke-validate.mjs — quick smoke tests for validate.mjs
// Run: node skills/codegraph/scripts/_smoke-validate.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'cg-validate-'));
const repo = join(tmp, 'repo');
// Fake source files for path-existence checks
mkdirSync(join(repo, 'src'), { recursive: true });
writeFileSync(join(repo, 'src/handler.ts'), 'export const a = 1;\n'.repeat(60));
writeFileSync(join(repo, 'src/auth.ts'), 'export const b = 2;\n'.repeat(60));
writeFileSync(join(repo, 'src/audit.ts'), 'export const c = 3;\n'.repeat(10));
writeFileSync(join(repo, 'src/client.ts'), 'export const d = 4;\n'.repeat(10));
writeFileSync(join(repo, 'src/server.ts'), 'export const e = 5;\n'.repeat(60));
writeFileSync(join(repo, 'src/empty.ts'), '');
writeFileSync(join(repo, 'src/one.ts'), 'one');
writeFileSync(join(repo, 'src/crlf.ts'), 'one\r\ntwo\r\n');
writeFileSync(join(tmp, 'outside.ts'), 'outside\n');
symlinkSync(join(tmp, 'outside.ts'), join(repo, 'src/outside.ts'));
symlinkSync(tmp, join(repo, 'src/outside-dir'));
symlinkSync(join(repo, 'src/handler.ts'), join(repo, 'src/inside.ts'));

const outDir = join(repo, '.codegraph', 'output', 'test');
mkdirSync(outDir, { recursive: true });

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const validatePath = join(here, 'validate.mjs');

function runExpect(args, expectOk, name, expectCode) {
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
  if (exitCode !== (expectOk ? 0 : 1)) {
    console.log(`FAIL  ${name} — unexpected exit code ${exitCode}`);
    return false;
  }
  if (args.expectWarning && !parsed.warnings?.some(w => w.code === args.expectWarning)) {
    console.log(`FAIL  ${name} — missing warning ${args.expectWarning}`);
    return false;
  }
  if (actualOk === expectOk) {
    if (expectCode) {
      const firstErr = parsed.errors?.[0]?.code;
      if (firstErr !== expectCode) {
        console.log(`FAIL  ${name} — expected code ${expectCode}, got ${firstErr}`);
        console.log('       ' + JSON.stringify(parsed.errors || parsed).slice(0, 300));
        return false;
      }
    }
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
  // Review mode: 3-element entries
  {
    name: 'review mode statuses',
    mmd: `flowchart TD
A[新增节点] --> B[修改节点]
B --> C[未改节点]
C --> D[删除节点]`,
    locs: {
      A: ['src/handler.ts', 10, 'added'],
      B: ['src/handler.ts', 20, 'modified'],
      C: ['src/handler.ts', 30],
      D: ['src/auth.ts', 5, 'removed'],
    },
    expectOk: true,
  },
  // Review mode: sequence 3-element entries
  {
    name: 'review sequence statuses',
    mmd: `sequenceDiagram
participant A as Client
participant B as Server
A->>B: call
B-->>A: result`,
    locs: {
      actors: { A: ['src/client.ts', 1, 'added'], B: ['src/server.ts', 30] },
      messages: [
        ['src/server.ts', 35, 'modified'],
        ['src/server.ts', 50, 'removed'],
      ],
    },
    expectOk: true,
  },
  // Should fail: invalid diff status
  {
    name: 'invalid diff status',
    mmd: `flowchart TD\nA[x]`,
    locs: { A: ['src/handler.ts', 1, 'touched'] },
    expectOk: false,
    expectCode: 'LOCS_DIFF_STATUS_INVALID',
  },
  // Removed node with missing file should warn but pass
  {
    name: 'removed missing file warns',
    mmd: `flowchart TD\nA[x]`,
    locs: { A: ['src/deleted.ts', 5, 'removed'] },
    expectOk: true,
  },
];

const nodes = { A: ['src/handler.ts', 1], B: ['src/auth.ts', 2] };
const edge = (from = 'A', to = 'B', occurrence = 1, loc = ['src/handler.ts', 3]) =>
  ({ from, to, occurrence, loc });
const structuredMmd = 'flowchart TD\nA[x] -->|one| B[y]\nA -.->|two| B\nB --> A';
const structuredEdges = [edge(), edge('A', 'B', 2), edge('B', 'A')];
cases.push(
  { name: 'structured wrapper parallel and reverse edges', mmd: structuredMmd,
    locs: { flowchart: { nodes, edges: structuredEdges } }, expectOk: true },
  { name: 'structured unwrapped shuffled edge mappings', mmd: structuredMmd,
    locs: { nodes, edges: [...structuredEdges].reverse() }, expectOk: true },
  { name: 'structured mixed sequence', mmd: structuredMmd + '\n\nsequenceDiagram\nparticipant A as Caller\nparticipant B as Callee\nA->>B: call',
    locs: { flowchart: { nodes, edges: structuredEdges }, sequence: { actors: nodes, messages: [['src/auth.ts', 3]] } }, expectOk: true },
  { name: 'structured chain and self edge', mmd: 'flowchart TD\nA[x] --> B[y] --> A\nA --> A',
    locs: { nodes, edges: [edge(), edge('B', 'A'), edge('A', 'A')] }, expectOk: true },
  { name: 'structured empty edge list', mmd: 'flowchart TD\nA[x]',
    locs: { nodes: { A: nodes.A }, edges: [] }, expectOk: true },
  { name: 'structured missing edge', mmd: structuredMmd,
    locs: { nodes, edges: structuredEdges.slice(0, 2) }, expectOk: false, expectCode: 'MISSING_EDGE_LOC' },
  { name: 'structured duplicate edge', mmd: structuredMmd,
    locs: { nodes, edges: [...structuredEdges, edge()] }, expectOk: false, expectCode: 'DUPLICATE_EDGE_LOC' },
  { name: 'structured orphan occurrence', mmd: structuredMmd,
    locs: { nodes, edges: [...structuredEdges, edge('A', 'B', 3)] }, expectOk: false, expectCode: 'ORPHAN_EDGE_LOC' },
  { name: 'structured orphan endpoint', mmd: structuredMmd,
    locs: { nodes, edges: [...structuredEdges, edge('A', 'Z')] }, expectOk: false, expectCode: 'ORPHAN_EDGE_LOC' },
  { name: 'structured malformed edge', mmd: structuredMmd,
    locs: { nodes, edges: [null] }, expectOk: false, expectCode: 'LOCS_EDGE_SHAPE' },
  { name: 'structured missing edge loc', mmd: 'flowchart TD\nA[x] --> B[y]',
    locs: { nodes, edges: [{ from: 'A', to: 'B', occurrence: 1 }] }, expectOk: false, expectCode: 'LOCS_ENTRY_SHAPE' },
  { name: 'structured missing edges array', mmd: 'flowchart TD\nA[x]',
    locs: { nodes: { A: nodes.A } }, expectOk: false, expectCode: 'LOCS_SHAPE_MISMATCH' },
  { name: 'structured malformed nodes', mmd: 'flowchart TD\nA[x]',
    locs: { nodes: null, edges: [] }, expectOk: false, expectCode: 'LOCS_SHAPE_MISMATCH' },
  { name: 'legacy node ids nodes and edges', mmd: 'flowchart TD\nnodes[x] --> edges[y]',
    locs: { nodes: nodes.A, edges: nodes.B }, expectOk: true, expectWarning: 'LEGACY_EDGE_LOCS_APPROXIMATE' },
  { name: 'structured missing occurrence', mmd: structuredMmd,
    locs: { nodes, edges: [{ from: 'A', to: 'B', loc: nodes.A }] },
    expectOk: false, expectCode: 'LOCS_EDGE_OCCURRENCE_INVALID' },
  { name: 'sequence message line beyond EOF',
    mmd: 'sequenceDiagram\nparticipant A as Caller\nparticipant B as Callee\nA->>B: call',
    locs: { actors: nodes, messages: [['src/auth.ts', 61]] },
    expectOk: false, expectCode: 'LOCS_LINE_OUT_OF_RANGE' },
  { name: 'sequence actor directory',
    mmd: 'sequenceDiagram\nparticipant A as Caller',
    locs: { actors: { A: ['src', 1] }, messages: [] },
    expectOk: false, expectCode: 'PATH_NOT_FILE' },
  { name: 'sequence actors must be object',
    mmd: 'sequenceDiagram\nparticipant A as Caller',
    locs: { actors: [], messages: [] },
    expectOk: false, expectCode: 'LOCS_SHAPE_MISMATCH' },
  { name: 'sequence messages must be array',
    mmd: 'sequenceDiagram\nparticipant A as Caller',
    locs: { actors: { A: ['src/client.ts', 1] }, messages: {} },
    expectOk: false, expectCode: 'LOCS_SHAPE_MISMATCH' },
);
for (const occurrence of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
  cases.push({ name: `invalid edge occurrence ${JSON.stringify(occurrence)}`, mmd: structuredMmd,
    locs: { nodes, edges: [edge('A', 'B', occurrence)] },
    expectOk: false, expectCode: 'LOCS_EDGE_OCCURRENCE_INVALID' });
}
const pathCases = [
  ['line at EOF', ['src/handler.ts', 60], true],
  ['line past trailing newline', ['src/handler.ts', 61], false, 'LOCS_LINE_OUT_OF_RANGE'],
  ['line past no trailing newline', ['src/one.ts', 2], false, 'LOCS_LINE_OUT_OF_RANGE'],
  ['line at CRLF EOF', ['src/crlf.ts', 2], true],
  ['line past CRLF EOF', ['src/crlf.ts', 3], false, 'LOCS_LINE_OUT_OF_RANGE'],
  ['empty file', ['src/empty.ts', 1], false, 'LOCS_LINE_OUT_OF_RANGE'],
  ['directory location', ['src', 1], false, 'PATH_NOT_FILE'],
  ['nested traversal', ['src/../../outside.ts', 1], false, 'LOCS_PATH_OUTSIDE_REPO'],
  ['external symlink', ['src/outside.ts', 1], false, 'LOCS_PATH_OUTSIDE_REPO'],
  ['internal symlink', ['src/inside.ts', 1], true],
  ['removed current line shorter', ['src/one.ts', 200, 'removed'], true],
  ['removed directory', ['src', 1, 'removed'], false, 'PATH_NOT_FILE'],
  ['removed traversal', ['src/../../gone.ts', 1, 'removed'], false, 'LOCS_PATH_OUTSIDE_REPO'],
  ['removed symlink ancestor', ['src/outside-dir/gone.ts', 1, 'removed'], false, 'LOCS_PATH_OUTSIDE_REPO'],
];
for (const [name, loc, expectOk, expectCode] of pathCases) {
  cases.push({ name, mmd: 'flowchart TD\nA[x]', locs: { A: loc }, expectOk, expectCode });
}
for (const [name, loc, expectOk, expectCode] of [
  ['edge directory', ['src', 1], false, 'PATH_NOT_FILE'],
  ['edge line beyond EOF', ['src/auth.ts', 61], false, 'LOCS_LINE_OUT_OF_RANGE'],
  ['edge outside repo', ['src/../../outside.ts', 1], false, 'LOCS_PATH_OUTSIDE_REPO'],
  ['edge invalid status', ['src/auth.ts', 1, 'bad'], false, 'LOCS_DIFF_STATUS_INVALID'],
  ['removed edge beyond EOF', ['src/one.ts', 200, 'removed'], true],
  ['removed edge missing file', ['src/gone.ts', 200, 'removed'], true],
]) {
  cases.push({ name, mmd: 'flowchart TD\nA[x] --> B[y]',
    locs: { nodes, edges: [edge('A', 'B', 1, loc)] }, expectOk, expectCode,
    ...(name === 'removed edge missing file' ? { expectWarning: 'PATH_NOT_FOUND' } : {}) });
}

for (const c of cases) {
  if (runExpect(c, c.expectOk, c.name, c.expectCode)) pass++; else fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
