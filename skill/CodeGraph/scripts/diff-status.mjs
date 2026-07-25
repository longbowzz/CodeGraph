// diff-status.mjs — line-level diff attribution for CodeGraph review mode.
//
// Resolves a base/head pair (commit SHA, PR number, ref, or WORKTREE) to a
// per-file table of added/removed line numbers, plus a coarse file status
// (added / modified / deleted / renamed).
//
// Usage:
//   node diff-status.mjs --repo <repo-root> --base <ref> --head <ref> [--out <path>]
//
// --base / --head accept:
//   - commit SHA (full or abbreviated, with optional ~N suffix)
//   - PR number as `pr/123` (resolved via `gh pr view` to base/head SHAs)
//   - branch / tag / `HEAD` / `HEAD~3`
//   - `WORKTREE` (only valid for --head): compare index+worktree vs --base
//
// Output JSON (stdout or --out file):
//   {
//     "base": "abc123",
//     "head": "def456",
//     "files": {
//       "src/foo.ts": { "status": "modified", "addedLines": [12,13], "removedLines": [20] },
//       "src/old.ts": { "status": "deleted", "addedLines": [], "removedLines": [] },
//       "src/new.ts": { "status": "added",   "addedLines": [1,2,3], "removedLines": [] }
//     }
//   }
//
// Zero npm deps (only node:child_process and node:fs).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--repo') a.repo = argv[++i];
    else if (k === '--base') a.base = argv[++i];
    else if (k === '--head') a.head = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '-h' || k === '--help') {
      console.error('Usage: diff-status.mjs --repo <root> --base <ref> --head <ref> [--out <path>]');
      process.exit(2);
    } else {
      console.error(`Unknown arg: ${k}`);
      process.exit(2);
    }
  }
  for (const k of ['repo', 'base', 'head']) {
    if (!a[k]) { console.error(`Missing required --${k}`); process.exit(2); }
  }
  return a;
}

function git(repo, ...args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const msg = (e.stderr || e.message || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

function resolveRef(repo, ref) {
  // Returns the commit SHA for a ref. Throws if git can't resolve it.
  const sha = git(repo, 'rev-parse', '--verify', `${ref}^{commit}`).trim();
  return sha;
}

function resolvePR(repo, prNumber) {
  // Uses `gh pr view` to get baseRefOid/headRefOid. Returns [baseSha, headSha].
  const out = execFileSync('gh', ['pr', 'view', String(prNumber), '--json', 'baseRefOid,headRefOid'], {
    encoding: 'utf8',
    cwd: repo,
  });
  const j = JSON.parse(out);
  if (!j.baseRefOid || !j.headRefOid) {
    throw new Error(`PR ${prNumber} missing baseRefOid/headRefOid`);
  }
  return [j.baseRefOid, j.headRefOid];
}

// Parse @@ -a,b +c,d @@ hunk headers from a unified diff for one file,
// returning the set of added (new) and removed (old) line numbers.
// In `git diff --unified=0`, context lines are suppressed, so:
//   - lines starting with '+' are added (new file line `c + i`)
//   - lines starting with '-' are removed (old file line `a + i`)
// The hunk header itself is the source of the starting line numbers.
function parseHunks(diffText) {
  const added = [];
  const removed = [];
  let oldStart = 0, newStart = 0;
  let oldIdx = 0, newIdx = 0;
  for (const line of diffText.split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      oldStart = parseInt(m[1], 10);
      newStart = parseInt(m[2], 10);
      oldIdx = 0;
      newIdx = 0;
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) continue;
    if (line.startsWith('+')) {
      added.push(newStart + newIdx);
      newIdx++;
    } else if (line.startsWith('-')) {
      removed.push(oldStart + oldIdx);
      oldIdx++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — ignore
    } else {
      // context line (shouldn't appear with --unified=0, but be safe)
      oldIdx++;
      newIdx++;
    }
  }
  return { added, removed };
}

// Main exported API. Returns the JSON-serializable status object.
export function getDiffStatus(repo, baseRef, headRef) {
  const repoAbs = resolve(repo);

  // Resolve base/head to concrete commit SHAs. WORKTREE is special: it means
  // compare the working tree (including unstaged changes) against --base.
  let baseSha, headSha, headIsWorktree = false;
  if (headRef === 'WORKTREE') {
    baseSha = resolveRef(repoAbs, baseRef);
    headSha = null; // no commit — we'll diff against the working tree
    headIsWorktree = true;
  } else {
    baseSha = resolveRef(repoAbs, baseRef);
    headSha = resolveRef(repoAbs, headRef);
  }

  // File-level status via --name-status. Format:
  //   M\tpath
  //   A\tpath
  //   D\tpath
  //   R<number>\told\tnew   (rename; v1 treats as delete+add, see below)
  const nameStatusRaw = headIsWorktree
    ? git(repoAbs, 'diff', '--no-color', '--name-status', baseSha)
    : git(repoAbs, 'diff', '--no-color', '--name-status', `${baseSha}..${headSha}`);

  const files = {};
  for (const line of nameStatusRaw.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const st = parts[0];
    let status, path;
    if (st === 'A') { status = 'added'; path = parts[1]; }
    else if (st === 'M') { status = 'modified'; path = parts[1]; }
    else if (st === 'D') { status = 'deleted'; path = parts[1]; }
    else if (st.startsWith('R')) {
      // Rename: treat as delete old + add new (v1 simplification).
      const oldPath = parts[1];
      const newPath = parts[2];
      files[oldPath] = { status: 'deleted', addedLines: [], removedLines: [] };
      files[newPath] = { status: 'added', addedLines: [], removedLines: [] };
      continue;
    } else {
      continue;
    }
    files[path] = { status, addedLines: [], removedLines: [] };
  }

  // Per-file hunks for line-level data.
  for (const path of Object.keys(files)) {
    const fileDiff = headIsWorktree
      ? git(repoAbs, 'diff', '--unified=0', '--no-color', baseSha, '--', path)
      : git(repoAbs, 'diff', '--unified=0', '--no-color', `${baseSha}..${headSha}`, '--', path);
    const { added, removed } = parseHunks(fileDiff);
    files[path].addedLines = added;
    files[path].removedLines = removed;
  }

  return {
    base: baseSha,
    head: headSha || 'WORKTREE',
    files,
  };
}

// ---- CLI entrypoint ----
// Only run CLI code when this module is executed directly. When imported by
// build-html.mjs for its getDiffStatus export, we must not parse process.argv.
function main() {
  const args = parseArgs(process.argv);
  let baseRef = args.base;
  let headRef = args.head;

  // PR shorthand: `pr/123` for --base means "use the PR's base"; for --head
  // means "use the PR's head". If only --head is pr/N, also pull base from PR.
  if (/^pr\/\d+$/i.test(args.base) || /^pr\/\d+$/i.test(args.head)) {
    const prNum = /^pr\/(\d+)$/i.exec(args.base)?.[1] || /^pr\/(\d+)$/i.exec(args.head)?.[1];
    const [prBase, prHead] = resolvePR(args.repo, prNum);
    if (/^pr\/\d+$/i.test(args.base)) baseRef = prBase;
    if (/^pr\/\d+$/i.test(args.head)) headRef = prHead;
  }

  const result = getDiffStatus(args.repo, baseRef, headRef);
  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    writeFileSync(args.out, json);
    console.error(`Wrote ${args.out}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
