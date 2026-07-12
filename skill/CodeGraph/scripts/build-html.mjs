// build-html.mjs — assemble single-page graph.html from graph.mmd + graph.locs.json.
//
// Usage:
//   node build-html.mjs \
//     --mmd <path> --locs <path> \
//     --repo <repo-root> \
//     --out <output-html-path> \
//     --editor-config <repo>/.codegraph/config.json
//
// Outputs single self-contained HTML at --out.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { parseMermaid, ParseError } from './mermaid-parser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, '..', 'template');
const VENDOR_DIR = resolve(__dirname, '..', 'vendor');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mmd') a.mmd = argv[++i];
    else if (k === '--locs') a.locs = argv[++i];
    else if (k === '--repo') a.repo = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--editor-config') a.editorConfig = argv[++i];
    else if (k === '-h' || k === '--help') {
      console.error('Usage: build-html.mjs --mmd <p> --locs <p> --repo <p> --out <p> --editor-config <p>');
      process.exit(2);
    } else {
      console.error(`Unknown arg: ${k}`);
      process.exit(2);
    }
  }
  for (const k of ['mmd', 'locs', 'repo', 'out']) {
    if (!a[k]) { console.error(`Missing required --${k}`); process.exit(2); }
  }
  return a;
}

const args = parseArgs(process.argv);
const repoAbs = resolve(args.repo);

// 1. Parse graph.mmd
const mmdText = readFileSync(args.mmd, 'utf8');
let parsed;
try {
  parsed = parseMermaid(mmdText);
} catch (e) {
  if (e instanceof ParseError) {
    console.error(`Error: graph.mmd failed to parse: line ${e.line}: ${e.message}`);
    console.error(`Run validate.mjs first to get a structured error report.`);
    process.exit(1);
  }
  throw e;
}

// 2. Parse locs
const locsRaw = JSON.parse(readFileSync(args.locs, 'utf8'));

// 3. Resolve locs shape and merge into parsed structure
function resolveLocs(parsed, locsRaw) {
  const out = {};
  if (parsed.flowchart) {
    let flat;
    if (parsed.sequence) {
      flat = locsRaw.flowchart || {};
    } else if (locsRaw.flowchart && !locsRaw.sequence) {
      flat = locsRaw.flowchart;
    } else if (!('actors' in locsRaw) && !('messages' in locsRaw)) {
      flat = locsRaw;
    } else {
      console.error(`Error: locs shape mismatch for flowchart-only graph`);
      process.exit(1);
    }
    out.flowchart = {
      ...parsed.flowchart,
      locs: flat,
    };
  }
  if (parsed.sequence) {
    let seq;
    if (parsed.flowchart) {
      seq = locsRaw.sequence || {};
    } else if (locsRaw.sequence && !locsRaw.flowchart) {
      seq = locsRaw.sequence;
    } else if ('actors' in locsRaw && 'messages' in locsRaw) {
      seq = locsRaw;
    } else {
      console.error(`Error: locs shape mismatch for sequence-only graph`);
      process.exit(1);
    }
    out.sequence = {
      ...parsed.sequence,
      locs: seq,
    };
  }
  return out;
}

const merged = resolveLocs(parsed, locsRaw);

// 4. Topic: derive from filename or arg
// Use the parent directory name of --out if available
const topicSlug = args.out
  ? resolve(dirname(args.out)).split(/[\\/]/).pop() || 'graph'
  : 'graph';

// 5. Read editor config
let editor = { id: 'vscode', label: 'VS Code' };
if (args.editorConfig) {
  try {
    const cfg = JSON.parse(readFileSync(args.editorConfig, 'utf8'));
    if (cfg.editor) editor = cfg.editor;
  } catch {}
}

// 6. Assemble the data blob
const dataBlob = {
  topic: topicSlug,
  repo: repoAbs,
  editor,
  flowchart: merged.flowchart || null,
  sequence: merged.sequence || null,
};

// 7. Read template parts
const pageHtml = readFileSync(resolve(TEMPLATE_DIR, 'page.html'), 'utf8');
const renderJs = readFileSync(resolve(TEMPLATE_DIR, 'render.js'), 'utf8');
const stylesCss = readFileSync(resolve(TEMPLATE_DIR, 'styles.css'), 'utf8');
const dagreJs = readFileSync(resolve(VENDOR_DIR, 'dagre.min.js'), 'utf8');

// 8. Inline. Use a sentinel unlikely to appear in data.
const dataJson = JSON.stringify(dataBlob);
const out = pageHtml
  .replace('__CSS__', stylesCss)
  .replace(/__TOPIC__/g, escapeHtml(topicSlug))
  .replace('__DATA__', dataJson)
  .replace('__DAGRE__', dagreJs)
  .replace('__RENDER__', renderJs);

// 9. Write
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, out);

console.log(`Wrote ${args.out} (${(out.length / 1024).toFixed(1)} KB)`);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
