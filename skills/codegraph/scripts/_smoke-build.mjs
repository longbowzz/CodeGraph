// Build integration regressions. Run with node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHtml } from './verify-html.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));

function fixture(run) {
  const repo = mkdtempSync(join(tmpdir(), 'cg-build-'));
  try { return run(repo); }
  finally { rmSync(repo, { recursive: true, force: true }); }
}

function build(repo, source, locations, extra = []) {
  writeFileSync(join(repo, 'graph.mmd'), source);
  writeFileSync(join(repo, 'graph.locs.json'), JSON.stringify(locations));
  const html = join(repo, 'output', 'graph.html');
  const result = spawnSync(process.execPath, [join(scripts, 'build-html.mjs'),
    '--mmd', join(repo, 'graph.mmd'), '--locs', join(repo, 'graph.locs.json'),
    '--repo', repo, '--out', html, ...extra], { encoding: 'utf8' });
  return { result, html };
}

function dataFrom(html) {
  const text = readFileSync(html, 'utf8');
  const match = /<script id="cg-data"[^>]*>([\s\S]*?)<\/script>/.exec(text);
  assert.ok(match, 'embedded data block exists');
  return { text, data: JSON.parse(match[1]) };
}

test('build preserves source bytes, independent edge files and literal replacement tokens', () => fixture(repo => {
  const source = 'const text = "</script><!-- <script> & $& $` $\' __RENDER__ __DATA__";\n';
  writeFileSync(join(repo, 'node.js'), source);
  writeFileSync(join(repo, 'edge.js'), 'work();\n');
  const { result, html } = build(repo, 'flowchart LR\nA[Read] --> B[Write]', {
    nodes: { A: ['node.js', 1], B: ['node.js', 1] },
    edges: [{ from: 'A', to: 'B', occurrence: 1, loc: ['edge.js', 1] }],
  });
  assert.equal(result.status, 0, result.stderr);
  const { text, data } = dataFrom(html);
  assert.equal(data.files['node.js'], source);
  assert.equal(data.files['edge.js'], 'work();\n');
  assert.deepEqual(data.flowchart.edgeLocs['["A","B",1]'], ['edge.js', 1]);
  assert.equal(verifyHtml(html).ok, true);
  assert.doesNotMatch(text, /<script\b[^>]*\bsrc\s*=/i);
}));

test('both diagrams preserve message ordering and legacy flow locations', () => fixture(repo => {
  writeFileSync(join(repo, 'source.js'), 'one();\ntwo();\n');
  const locations = {
    flowchart: { A: ['source.js', 1], B: ['source.js', 2] },
    sequence: { actors: { A: ['source.js', 1], B: ['source.js', 2] },
      messages: [['source.js', 2], ['source.js', 1]] },
  };
  const { result, html } = build(repo,
    'flowchart LR\nA --> B\n\nsequenceDiagram\nA->>B: same\nB-->>A: same', locations);
  assert.equal(result.status, 0, result.stderr);
  const { data } = dataFrom(html);
  assert.deepEqual(data.sequence.locs, locations.sequence);
  assert.deepEqual(data.flowchart.locs, locations.flowchart);
  assert.equal(Object.hasOwn(data.flowchart, 'edgeLocs'), false);
}));

test('review build embeds the deleted base source rather than substituting surviving code', () => fixture(repo => {
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  writeFileSync(join(repo, 'source.js'), 'old();\n');
  git('add', 'source.js');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'source.js'), 'current();\n');
  const { result, html } = build(repo, 'flowchart LR\nA[Removed behavior]',
    { A: ['source.js', 1, 'removed'] }, ['--diff-base', base, '--diff-head', 'WORKTREE']);
  assert.equal(result.status, 0, result.stderr);
  const { data } = dataFrom(html);
  assert.equal(data.review.base, base);
  assert.equal(data.diff.files['source.js'].baseText, 'old();\n');
  assert.equal(data.files['source.js'], 'current();\n');
}));

test('invalid Mermaid exits unsuccessfully before writing output', () => fixture(repo => {
  const { result } = build(repo, 'flowchart LR\nA[unfinished', {});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /failed to parse/);
}));

test('HTML verifier rejects truncated JSON and invalid inline JavaScript', () => fixture(repo => {
  mkdirSync(join(repo, 'output'));
  const html = join(repo, 'output', 'bad.html');
  for (const content of [
    '<script id="cg-data" type="application/json">{"source":"</script>"}</script>',
    '<script>const broken = ;</script>',
    '<html>No script blocks</html>',
  ]) {
    writeFileSync(html, content);
    assert.equal(verifyHtml(html).ok, false, content);
  }
}));


test('class diagram embeds classes and relation locations', () => fixture(repo => {
  writeFileSync(join(repo, 'source.js'), 'class A {}\nclass B extends A {}\n');
  const locations = {
    classDiagram: {
      classes: { A: ['source.js', 1], B: ['source.js', 2] },
      relations: [
        { from: 'A', to: 'B', kind: 'extension', occurrence: 1, loc: ['source.js', 2] },
      ],
    },
  };
  const { result, html } = build(repo, 'classDiagram\nA <|-- B', locations);
  assert.equal(result.status, 0, result.stderr);
  const { data } = dataFrom(html);
  assert.deepEqual(data.classDiagram.locs.classes, locations.classDiagram.classes);
  assert.deepEqual(data.classDiagram.relationLocs, {
    '["A","B","extension",1]': ['source.js', 2],
  });
  assert.equal(data.files['source.js'], 'class A {}\nclass B extends A {}\n');
  assert.equal(verifyHtml(html).ok, true);
}));

test('class diagram embeds sources for classes given as objects with stereotype and summary', () => fixture(repo => {
  writeFileSync(join(repo, 'source.js'), 'class A {}\n');
  const locations = {
    classDiagram: {
      classes: {
        A: { loc: ['source.js', 1], stereotype: 'model', summary: 'One sentence.' },
      },
      relations: [],
    },
  };
  const { result, html } = build(repo, 'classDiagram\nclass A', locations);
  assert.equal(result.status, 0, result.stderr);
  const { data } = dataFrom(html);
  assert.equal(data.files['source.js'], 'class A {}\n');
  assert.equal(verifyHtml(html).ok, true);
}));
