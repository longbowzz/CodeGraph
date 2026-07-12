// validate.mjs — CodeGraph validator.
// Usage:
//   node validate.mjs --mmd <path> --locs <path> --repo <repo-root>
//
// Validates:
//   1. graph.mmd parses against the Mermaid subset (via mermaid-parser.mjs).
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

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { parseMermaid, ParseError } from './mermaid-parser.mjs';

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
function err(code, path, message, fix_hint) {
  errors.push({ level: 'error', code, path, message, fix_hint });
}

function ok() {
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}
function fail() {
  console.log(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

const args = parseArgs(process.argv);
const repoAbs = resolve(args.repo);

// ---------- 1. Read & parse graph.mmd ----------
let parsed;
try {
  const mmdText = readFileSync(args.mmd, 'utf8');
  parsed = parseMermaid(mmdText);
} catch (e) {
  if (e instanceof ParseError) {
    err('MMD_PARSE_ERROR', `${args.mmd}:${e.line}`, e.message,
      `Edit graph.mmd line ${e.line} to match the Mermaid subset contract in SKILL.md §3.`);
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

// Detect which form the locs file is in:
// - Flat form (flowchart only): { "<id>": [file, line], ... }
// - Sequence form (sequence only): { actors: {...}, messages: [[file,line], ...] }
// - Wrapper form (both): { flowchart: {...flat...}, sequence: {...seq...} }
function isSeqShape(o) {
  return o && typeof o === 'object' &&
         'actors' in o && 'messages' in o &&
         !('flowchart' in o) && !('sequence' in o);
}
function isFlatShape(o) {
  return o && typeof o === 'object' &&
         !('actors' in o) && !('messages' in o) &&
         !('flowchart' in o) && !('sequence' in o);
}

let flowLocs = null;   // Map<id, [file, line]>
let seqLocs = null;    // { actors: Map<id, [file,line]>, messages: [[file,line]] }

if (parsed.flowchart && parsed.sequence) {
  // Expect wrapper form
  if (!locsRaw.flowchart || !locsRaw.sequence) {
    err('LOCS_SHAPE_MISMATCH', args.locs,
      `graph.mmd contains both flowchart and sequence, but graph.locs.json does not have 'flowchart' and 'sequence' wrappers`,
      `Use the wrapper form: { "flowchart": {...flat...}, "sequence": { "actors": {...}, "messages": [...] } }`);
    fail();
  }
  flowLocs = new Map(Object.entries(locsRaw.flowchart));
  seqLocs = {
    actors: new Map(Object.entries(locsRaw.sequence.actors || {})),
    messages: locsRaw.sequence.messages || [],
  };
} else if (parsed.flowchart) {
  // Expect flat form (or wrapper with only flowchart)
  if (locsRaw.flowchart && !locsRaw.sequence) {
    flowLocs = new Map(Object.entries(locsRaw.flowchart));
  } else if (isFlatShape(locsRaw)) {
    flowLocs = new Map(Object.entries(locsRaw));
  } else {
    err('LOCS_SHAPE_MISMATCH', args.locs,
      `graph.mmd has only a flowchart; graph.locs.json must be flat { "<id>": [file, line] } or { "flowchart": {...} }`,
      `Use the flat form shown in SKILL.md §4.1.`);
    fail();
  }
} else if (parsed.sequence) {
  if (locsRaw.sequence && !locsRaw.flowchart) {
    seqLocs = {
      actors: new Map(Object.entries(locsRaw.sequence.actors || {})),
      messages: locsRaw.sequence.messages || [],
    };
  } else if (isSeqShape(locsRaw)) {
    seqLocs = {
      actors: new Map(Object.entries(locsRaw.actors || {})),
      messages: locsRaw.messages || [],
    };
  } else {
    err('LOCS_SHAPE_MISMATCH', args.locs,
      `graph.mmd has only a sequence; graph.locs.json must be { "actors": {...}, "messages": [...] } or { "sequence": {...} }`,
      `Use the sequence form shown in SKILL.md §4.2.`);
    fail();
  }
}

// ---------- 3. Validate locs structure ----------
function validateEntry(entry, keyPath) {
  if (!Array.isArray(entry) || entry.length !== 2) {
    err('LOCS_ENTRY_SHAPE', `${args.locs}:${keyPath}`,
      `entry must be a 2-element [file, line] array, got ${JSON.stringify(entry)}`,
      `Use ["relative/path", <lineNumber>].`);
    return null;
  }
  const [file, line] = entry;
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
  return entry;
}

const checkedEntries = [];
if (flowLocs) {
  for (const [id, entry] of flowLocs.entries()) {
    const e = validateEntry(entry, id);
    if (e) checkedEntries.push([id, e, 'flow']);
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

// ---------- 5. Path existence ----------
for (const [key, [file, line], kind] of checkedEntries) {
  const abs = join(repoAbs, file);
  if (!existsSync(abs)) {
    err('PATH_NOT_FOUND', `${args.locs}:${key}`,
      `file does not exist under repo root: ${file} (looked at ${abs})`,
      `Fix the path. Must be relative to repo root. Verify with: ls ${relative(process.cwd(), abs) || abs}`);
  }
}

if (errors.length === 0) ok();
else fail();
