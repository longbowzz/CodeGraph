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

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
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
    else if (k === '--diff-base') a.diffBase = argv[++i];
    else if (k === '--diff-head') a.diffHead = argv[++i];
    else if (k === '-h' || k === '--help') {
      console.error('Usage: build-html.mjs --mmd <p> --locs <p> --repo <p> --out <p> --editor-config <p> [--diff-base <ref> --diff-head <ref>]');
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

// 6a. Review mode: when --diff-base and --diff-head are both provided,
// attach a review descriptor. The renderer uses its presence to show the
// diff legend and rely on the per-loc 3rd element for color attribution.
if (args.diffBase && args.diffHead) {
  dataBlob.review = {
    base: args.diffBase,
    head: args.diffHead,
    range: `${args.diffBase}..${args.diffHead}`,
  };
}

// 6b. Embed every referenced source file so the in-page code pane works
// whenever the user switches to the `web` editor. Unreadable files are skipped
// with a stderr warning (build continues). This makes editor selection a
// runtime display preference rather than a build-time decision.
const paths = new Set();
if (merged.flowchart?.locs) {
  for (const v of Object.values(merged.flowchart.locs)) {
    if (Array.isArray(v) && v[0]) paths.add(v[0]);
  }
}
if (merged.sequence?.locs) {
  const actors = merged.sequence.locs.actors || {};
  for (const v of Object.values(actors)) {
    if (Array.isArray(v) && v[0]) paths.add(v[0]);
  }
  const messages = merged.sequence.locs.messages || [];
  for (const v of messages) {
    if (Array.isArray(v) && v[0]) paths.add(v[0]);
  }
}
const files = {};
for (const rel of paths) {
  const abs = resolve(repoAbs, rel);
  try {
    if (!existsSync(abs)) {
      console.error(`[web] skip missing: ${rel}`);
      continue;
    }
    files[rel] = readFileSync(abs, 'utf8');
  } catch (e) {
    console.error(`[web] skip unreadable ${rel}: ${e.message}`);
  }
}
dataBlob.files = files;

// 7. Read template parts
const pageHtml = readFileSync(resolve(TEMPLATE_DIR, 'page.html'), 'utf8');
const renderJs = readFileSync(resolve(TEMPLATE_DIR, 'render.js'), 'utf8');
const stylesCss = readFileSync(resolve(TEMPLATE_DIR, 'styles.css'), 'utf8');
const dagreJs = readFileSync(resolve(VENDOR_DIR, 'dagre.min.js'), 'utf8');
// highlight.js is required for the in-page code pane; keep it inlined so the
// HTML stays single-file and the web editor works regardless of default editor.
const highlightJs = readFileSync(resolve(VENDOR_DIR, 'highlight.min.js'), 'utf8');

// 8. Inline. Use a sentinel unlikely to appear in data.
// IMPORTANT: __DATA__ must be substituted LAST. The data blob may contain
// arbitrary source code (embedded for the `web` editor), which can include
// any of the other placeholder literals — replacing those after the data
// would corrupt the JSON. Doing data last means earlier replaces only see
// the real template placeholders.
//
// The data JSON is embedded inside <script id="cg-data" type="application/json">.
// HTML parsing of script-data treats literal `</script>` (and a few related
// sequences like `<!--` / `<script`) as block terminators regardless of the
// `type` attribute — JSON-escaped source files containing those bytes would
// silently truncate the block. Escape `<`, `>`, `&` as \u003c / \u003e / \u0026
// so the HTML parser can never see them; JSON.parse reverses all three
// transparently.
const dataJson = JSON.stringify(dataBlob)
  .replace(/[<&>]/g, c => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' }[c]));
const out = pageHtml
  .replace('__CSS__', stylesCss)
  .replace(/__TOPIC__/g, escapeHtml(topicSlug))
  .replace('__DAGRE__', dagreJs)
  .replace('__HIGHLIGHT__', highlightJs)
  .replace('__RENDER__', renderJs)
  .replace('__DATA__', dataJson);

// 9. Write
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, out);

// 10. Verify: parse the just-written HTML to confirm the cg-data JSON and
// every inline <script> are syntactically valid. If anything is wrong, drop
// the corrupt output and exit non-zero so callers (and CI) can detect it.
const verifyPath = resolve(__dirname, 'verify-html.mjs');
const { verifyHtml } = await import(verifyPath);
const vr = verifyHtml(args.out);
for (const s of vr.summaries) console.log(s);
if (!vr.ok) {
  console.error(`\nverify-html: ${vr.failures.length} failure(s):`);
  for (const f of vr.failures) {
    console.error(`  ✗ ${f.block}`);
    console.error(`      ${f.msg}`);
  }
  try { unlinkSync(args.out); } catch {}
  console.error(`\nBuild failed verification; removed ${args.out}.`);
  process.exit(1);
}

console.log(`Wrote ${args.out} (${(out.length / 1024).toFixed(1)} KB)`);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
