// verify-html.mjs — post-build sanity check for graph.html.
//
// Reads a generated HTML file, extracts every inline <script> block, and
// validates each one:
//   - The <script id="cg-data" type="application/json"> block is parsed as
//     JSON. This catches any corruption that survived the build (e.g. an
//     embedded source file containing a literal </script> that terminated
//     the block early, or a botched placeholder replacement).
//   - Every other inline <script> is parsed as JS via `new Function(code)`
//     without being invoked. This catches syntax errors introduced by
//     template substitution or vendor bundling.
//
// Exits 0 on success, 1 on any failure. Designed to be called from
// build-html.mjs after writing the HTML, and also runnable standalone:
//
//   node verify-html.mjs --html path/to/graph.html

import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--html') a.html = argv[++i];
    else if (k === '-h' || k === '--help') {
      console.error('Usage: verify-html.mjs --html <path>');
      process.exit(2);
    } else {
      console.error(`Unknown arg: ${k}`);
      process.exit(2);
    }
  }
  if (!a.html) { console.error('Missing required --html'); process.exit(2); }
  return a;
}

// Extract every inline <script> block as {startLine, raw, isJson}.
// We deliberately use regex rather than a DOM parser: we need byte-faithful
// extraction of exactly what the browser will see, including any surprises
// in the body. Inline means no src= attribute.
function extractInlineScripts(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    // Skip external scripts (src=...).
    if (/\bsrc\s*=/.test(attrs)) continue;
    // Skip empty blocks (whitespace only).
    if (!body.trim()) continue;
    const startLine = html.slice(0, m.index).split('\n').length;
    const isJson = /\bid\s*=\s*"cg-data"/.test(attrs) ||
                   /\btype\s*=\s*"application\/json"/.test(attrs);
    blocks.push({ startLine, raw: body, isJson, attrs: attrs.trim() });
  }
  return blocks;
}

function fmt(n) {
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function verify(htmlPath) {
  const abs = resolve(htmlPath);
  let html;
  try {
    html = readFileSync(abs, 'utf8');
  } catch (e) {
    return { ok: false, failures: [{ block: '(read)', msg: e.message }], summaries: [] };
  }

  const blocks = extractInlineScripts(html);
  if (blocks.length === 0) {
    return { ok: false, failures: [{ block: '(no-scripts)', msg: 'no inline <script> blocks found' }], summaries: [] };
  }

  const failures = [];
  const summaries = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const label = b.isJson
      ? `cg-data JSON`
      : `inline script (${b.attrs || 'no attrs'})`;
    const where = `${basename(abs)}:${b.startLine}`;

    if (b.isJson) {
      try {
        const data = JSON.parse(b.raw);
        const nodeCount = data.flowchart?.nodes?.length || Object.keys(data.flowchart?.locs || {}).length;
        const fileCount = data.files ? Object.keys(data.files).length : 0;
        const parts = [`JSON.parse OK (${fmt(b.raw.length)}`];
        if (nodeCount !== undefined) parts.push(`${nodeCount} flow nodes`);
        if (data.sequence) parts.push(`sequence present`);
        if (fileCount) parts.push(`${fileCount} files embedded`);
        summaries.push(`  ✓ [${where}] ${label}: ${parts.join(', ')})`);
      } catch (e) {
        const pos = (e.message.match(/position (\d+)/) || [])[1];
        const ctx = pos ? `\n      context: ${JSON.stringify(b.raw.slice(Math.max(0, +pos - 50), +pos + 50))}` : '';
        failures.push({
          block: `${where} ${label}`,
          msg: `${e.message}${ctx}`,
        });
      }
    } else {
      try {
        // `new Function(code)` parses without executing. Throws on syntax error.
        // eslint-disable-next-line no-new-func
        new Function(b.raw);
        summaries.push(`  ✓ [${where}] ${label}: syntax OK (${fmt(b.raw.length)})`);
      } catch (e) {
        failures.push({
          block: `${where} ${label}`,
          msg: e.message,
        });
      }
    }
  }

  return { ok: failures.length === 0, failures, summaries };
}

// Exported for build-html.mjs to call in-process.
export function verifyHtml(htmlPath) {
  return verify(htmlPath);
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const r = verify(args.html);
  for (const s of r.summaries) console.log(s);
  if (!r.ok) {
    console.error(`\nverify-html: ${r.failures.length} failure(s):`);
    for (const f of r.failures) {
      console.error(`  ✗ ${f.block}`);
      console.error(`      ${f.msg}`);
    }
    process.exit(1);
  }
  console.log(`verify-html: all checks passed.`);
}
