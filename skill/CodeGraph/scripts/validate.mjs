// validate.mjs — CodeGraph validator.
// Usage:
//   node validate.mjs --mmd <path> --locs <path> --repo <repo-root>
//
// Validates:
//   1. graph.mmd parses with the official Mermaid parser (via mermaid-parser.mjs).
//   2. graph.locs.json is well-formed and structurally correct.
//   3. ID sets align between mmd and locs (no orphans either direction).
//   4. Sequence: messages.length === arrow count in mmd.
//   5. Every file path exists under repo root (fs.existsSync).
//
// Output (always JSON to stdout):
//   { "ok": true }  on success
//   { "ok": false, "errors": [ { level, code, path, message, fix_hint } ] }  on failure
//
// Exit code: 0 on success, 1 on any error.

import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { parseMermaid, ParseError } from './mermaid-parser.mjs';
import { normalizeLocations, isRecord } from './location-data.mjs';

function parseArgs(argv) {
  const args = { mmd: null, locs: null, repo: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mmd') args.mmd = argv[++i];
    else if (a === '--locs') args.locs = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.error('Usage: validate.mjs --mmd <path> --locs <path> --repo <repo-root>');
      process.exit(2);
    }
  }
  if (!args.mmd || !args.locs || !args.repo) {
    console.error('Missing required --mmd / --locs / --repo');
    process.exit(2);
  }
  return args;
}

const errors = [];
const warnings = [];
function err(code, path, message, fix_hint) {
  errors.push({ level: 'error', code, path, message, fix_hint });
}
function warn(code, path, message, fix_hint) {
  warnings.push({ level: 'warning', code, path, message, fix_hint });
}

function ok() {
  console.log(JSON.stringify({ ok: true, warnings }));
  process.exit(0);
}
function fail() {
  console.log(JSON.stringify({ ok: false, errors, warnings }, null, 2));
  process.exit(1);
}

const args = parseArgs(process.argv);
const repoAbs = resolve(args.repo);

// ---------- 1. Read & parse graph.mmd ----------
let parsed;
try {
  const mmdText = readFileSync(args.mmd, 'utf8');
  parsed = await parseMermaid(mmdText);
} catch (e) {
  if (e instanceof ParseError) {
    err('MMD_PARSE_ERROR', `${args.mmd}:${e.line}`, e.message,
      `Edit graph.mmd line ${e.line} to fix Mermaid syntax.`);
    fail();
  } else {
    err('MMD_READ_ERROR', args.mmd, e.message, `Ensure graph.mmd exists and is readable.`);
    fail();
  }
}

// ---------- 2. Read & parse graph.locs.json ----------
let locsRaw;
try {
  locsRaw = JSON.parse(readFileSync(args.locs, 'utf8'));
} catch (e) {
  err('LOCS_JSON_ERROR', args.locs,
    `failed to parse graph.locs.json: ${e.message}`,
    `Ensure graph.locs.json is valid JSON.`);
  fail();
}

let flowLocs = null;   // Map<id, [file, line]>
let edgeLocs = null;   // Structured flowchart form opts into exact edge coverage.
let seqLocs = null;    // { actors: Map<id, [file,line]>, messages: [[file,line]] }

try {
  const locations = normalizeLocations(parsed, locsRaw);
  if (locations.flowchart) {
    flowLocs = new Map(Object.entries(locations.flowchart.nodes));
    edgeLocs = locations.flowchart.edges;
    if (edgeLocs === null && parsed.flowchart.edges.length > 0) {
      warn('LEGACY_EDGE_LOCS_APPROXIMATE', args.locs,
        'legacy node-only locations provide approximate edge navigation',
        'Use { "nodes": {...}, "edges": [...] } to map every edge to its source location.');
    }
  }
  if (locations.sequence) {
    seqLocs = {
      actors: new Map(Object.entries(locations.sequence.actors)),
      messages: locations.sequence.messages,
    };
  }
} catch (e) {
  err(e.code || 'LOCS_SHAPE_MISMATCH', args.locs, e.message,
    e.fix_hint || 'Use a flowchart or sequence location object.');
  fail();
}

// ---------- 3. Validate locs structure ----------
const DIFF_STATUSES = new Set(['added', 'modified', 'removed', 'unchanged']);
function validateEntry(entry, keyPath) {
  if (!Array.isArray(entry) || entry.length < 2 || entry.length > 3) {
    err('LOCS_ENTRY_SHAPE', `${args.locs}:${keyPath}`,
      `entry must be a 2- or 3-element [file, line(, status)] array, got ${JSON.stringify(entry)}`,
      `Use ["relative/path", <lineNumber>] or ["relative/path", <lineNumber>, "added|modified|removed|unchanged"].`);
    return null;
  }
  const [file, line, status] = entry;
  if (typeof file !== 'string' || file.length === 0) {
    err('LOCS_ENTRY_SHAPE', `${args.locs}:${keyPath}`,
      `file path must be a non-empty string, got ${JSON.stringify(file)}`,
      `Provide a path relative to repo root.`);
    return null;
  }
  if (isAbsolute(file) || file.startsWith('./') || file.startsWith('../')) {
    err('LOCS_PATH_NOT_RELATIVE', `${args.locs}:${keyPath}`,
      `path ${JSON.stringify(file)} must be relative to repo root without './' or '../' prefix`,
      `Strip the prefix and any repo-root portion.`);
    return null;
  }
  if (!Number.isInteger(line) || line < 1) {
    err('LOCS_ENTRY_SHAPE', `${args.locs}:${keyPath}`,
      `line number must be a positive integer, got ${JSON.stringify(line)}`,
      `Use a 1-based line number.`);
    return null;
  }
  if (status !== undefined && !DIFF_STATUSES.has(status)) {
    err('LOCS_DIFF_STATUS_INVALID', `${args.locs}:${keyPath}`,
      `diff status must be one of added|modified|removed|unchanged, got ${JSON.stringify(status)}`,
      `Drop the third element, or use one of: "added", "modified", "removed", "unchanged".`);
    return null;
  }
  return entry;
}

const checkedEntries = [];
if (flowLocs) {
  for (const [id, entry] of flowLocs.entries()) {
    const e = validateEntry(entry, id);
    if (e) checkedEntries.push([id, e, 'flow']);
  }
}
if (edgeLocs) {
  const mappedIds = new Set();
  const graphIds = new Set(parsed.flowchart.edges.map(edge => edge.id));
  for (let idx = 0; idx < edgeLocs.length; idx++) {
    const edge = edgeLocs[idx];
    const key = `edges[${idx}]`;
    if (!isRecord(edge) || typeof edge.from !== 'string' || !edge.from ||
        typeof edge.to !== 'string' || !edge.to) {
      err('LOCS_EDGE_SHAPE', `${args.locs}:${key}`,
        'edge mapping must have non-empty from and to strings, occurrence, and loc',
        'Use { "from": "A", "to": "B", "occurrence": 1, "loc": ["file", 1] }.');
      continue;
    }
    if (!Number.isSafeInteger(edge.occurrence) || edge.occurrence < 1) {
      err('LOCS_EDGE_OCCURRENCE_INVALID', `${args.locs}:${key}`,
        `occurrence must be a positive integer, got ${JSON.stringify(edge.occurrence)}`,
        'Count edges with the same directed endpoints in parsing order, starting at 1.');
      continue;
    }
    const id = JSON.stringify([edge.from, edge.to, edge.occurrence]);
    if (mappedIds.has(id)) {
      err('DUPLICATE_EDGE_LOC', `${args.locs}:${key}`, `duplicate edge mapping ${id}`,
        'Keep exactly one location mapping per edge.');
    }
    mappedIds.add(id);
    if (!graphIds.has(id)) {
      err('ORPHAN_EDGE_LOC', `${args.locs}:${key}`, `no such flowchart edge ${id}`,
        'Use endpoints and occurrence from graph.mmd.');
    }
    const entry = validateEntry(edge.loc, `${key}.loc`);
    if (entry) checkedEntries.push([`${key}.loc`, entry, 'flow-edge']);
  }
  for (const id of graphIds) {
    if (!mappedIds.has(id)) {
      err('MISSING_EDGE_LOC', args.locs, `flowchart edge ${id} has no location mapping`,
        'Add exactly one mapping with from, to, occurrence, and loc for this edge.');
    }
  }
}
if (seqLocs) {
  for (const [id, entry] of seqLocs.actors.entries()) {
    const e = validateEntry(entry, `actors.${id}`);
    if (e) checkedEntries.push([`actors.${id}`, e, 'seq-actor']);
  }
  for (let idx = 0; idx < seqLocs.messages.length; idx++) {
    const e = validateEntry(seqLocs.messages[idx], `messages[${idx}]`);
    if (e) checkedEntries.push([`messages[${idx}]`, e, 'seq-msg']);
  }
}

// ---------- 4. ID alignment ----------
if (parsed.flowchart) {
  const mmdIds = new Set(parsed.flowchart.nodes.map(n => n.id));
  const locIds = new Set(flowLocs ? flowLocs.keys() : []);
  for (const id of mmdIds) {
    if (!locIds.has(id)) {
      err('MISSING_LOC', `${args.locs}`,
        `flowchart node '${id}' has no entry in graph.locs.json`,
        `Add an entry "${id}": ["<relative/path>", <line>] to graph.locs.json.`);
    }
  }
  for (const id of locIds) {
    if (!mmdIds.has(id)) {
      err('ORPHAN_LOC', `${args.locs}`,
        `graph.locs.json has entry '${id}' but no such node exists in graph.mmd`,
        `Remove the '${id}' entry or fix the node id in graph.mmd.`);
    }
  }
}

if (parsed.sequence) {
  const mmdActorIds = new Set(parsed.sequence.actors.map(a => a.id));
  const locActorIds = new Set(seqLocs ? seqLocs.actors.keys() : []);
  for (const id of mmdActorIds) {
    if (!locActorIds.has(id)) {
      err('MISSING_LOC', `${args.locs}`,
        `sequence actor '${id}' has no entry in graph.locs.json.actors`,
        `Add "${id}": ["<relative/path>", <line>] under "actors".`);
    }
  }
  for (const id of locActorIds) {
    if (!mmdActorIds.has(id)) {
      err('ORPHAN_LOC', `${args.locs}`,
        `graph.locs.json has actor '${id}' but no such participant exists in graph.mmd`,
        `Remove the '${id}' entry from "actors" or add a matching participant.`);
    }
  }
  const mmdMsgCount = parsed.sequence.messages.length;
  const locMsgCount = seqLocs ? seqLocs.messages.length : 0;
  if (mmdMsgCount !== locMsgCount) {
    err('MESSAGE_COUNT_MISMATCH', `${args.locs}`,
      `sequence has ${mmdMsgCount} message arrows but graph.locs.json has ${locMsgCount} messages entries`,
      `Adjust 'messages' array to have exactly ${mmdMsgCount} [file, line] entries in arrow order.`);
  }
}

// ---------- 5. Repository containment, regular files, and line bounds ----------
const repoReal = realpathSync(repoAbs);
const lineCounts = new Map();
function outside(root, target) {
  const rel = relative(root, target);
  return rel === '..' || rel.startsWith('../') || isAbsolute(rel);
}
for (const [key, entry] of checkedEntries) {
  const [file, line, status] = entry;
  const abs = resolve(repoAbs, file);
  if (outside(repoAbs, abs)) {
    err('LOCS_PATH_OUTSIDE_REPO', `${args.locs}:${key}`, `path escapes repo root: ${file}`,
      'Use a path inside the repository.');
    continue;
  }
  try {
    // Resolve the nearest existing ancestor too, so removed/missing files cannot
    // escape through a symlink to a directory outside the repository.
    let ancestor = abs;
    while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
    if (outside(repoReal, realpathSync(ancestor))) {
      err('LOCS_PATH_OUTSIDE_REPO', `${args.locs}:${key}`, `path resolves outside repo root: ${file}`,
        'Use a file whose real path is inside the repository.');
      continue;
    }
    if (!existsSync(abs)) {
      if (status === 'removed') {
        warn('PATH_NOT_FOUND', `${args.locs}:${key}`,
          `file does not exist under repo root (acceptable for status='removed'): ${file}`,
          'Keep the location tied to the removed statement; use review mode to inspect its base-version source.');
      } else {
        err('PATH_NOT_FOUND', `${args.locs}:${key}`, `file does not exist under repo root: ${file}`,
          'Fix the path. Must be relative to repo root.');
      }
      continue;
    }
    if (!statSync(abs).isFile()) {
      err('PATH_NOT_FILE', `${args.locs}:${key}`, `path is not a regular file: ${file}`,
        'Point the location at a source file.');
      continue;
    }
    if (status !== 'removed') {
      if (!lineCounts.has(abs)) {
        const text = readFileSync(abs, 'utf8');
        const count = text === '' ? 0 : text.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(text) ? 1 : 0);
        lineCounts.set(abs, count);
      }
      const count = lineCounts.get(abs);
      if (line > count) {
        err('LOCS_LINE_OUT_OF_RANGE', `${args.locs}:${key}`,
          `line ${line} exceeds ${file}'s ${count} lines`,
          'Use a line number within the current file.');
      }
    }
  } catch (e) {
    err('PATH_READ_ERROR', `${args.locs}:${key}`, `cannot inspect ${file}: ${e.message}`,
      'Use a readable regular file inside the repository.');
  }
}

if (errors.length === 0) ok();
else fail();
