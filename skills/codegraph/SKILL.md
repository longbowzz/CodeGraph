---
name: codegraph
description: "Generate source-linked Mermaid diagrams and long-form CodeWalkthrough explainer pages from a codebase, with diff-aware review mode."
---

# CodeGraph Skill

> Generate an interactive, single-page HTML visualization of a specific code flow
> (control flow and/or call sequence) from the user's repository, with clickable
> jump-to-source behavior in their preferred editor.

This document is the operational contract for the agent. Follow it precisely.
All directives in this file are **English**; the data you produce (node labels,
messages, notes, topic slug) MUST be in the **user's preferred language**, which
you confirm during the alignment step.

---

## 0. Runtime Requirements & Skill Location

### 0.1 Runtime requirements

Graph generation and viewing require **no runtime npm install**. The scripts use
Node.js standard-library modules and the vendored Mermaid engine. Development
dependencies used to rebuild vendored assets are separate.

Required on the host machine:

- **Node.js 18 or newer.** Verify with `node --version`. Required for
  `validate.mjs` and `build-html.mjs` (ESM + `node:` prefix imports).
- **A supported editor** for click-to-jump (VS Code / Cursor / JetBrains family),
  **or** the `web` editor which opens source in an in-page code panel (no
  external editor needed). See §2 Step 1 and §6 for the full list. Non-`web`
  editors must be installed and reachable via their OS URL scheme.
- **An internet connection is NOT required** after the skill is installed.
  The Mermaid engine and supporting assets are vendored under `vendor/`.
  External images and icons are outside the offline guarantee.

### 0.2 Skill directory resolution

The agent MUST resolve the skill's own directory before invoking scripts. The
skill can be installed in one of these locations (check in order):

1. **Project-local (Claude)**: `<repo>/.claude/skills/codegraph/`
2. **User-global (Claude)**: `~/.claude/skills/codegraph/`
3. **Project-local (DSH)**: `<repo>/.dsh/skills/codegraph/`
4. **User-global (DSH)**: `~/.dsh/skills/codegraph/` or `~/.agents/skills/codegraph/`
5. **Cloned repo or bundle**: `skills/codegraph/` in the CodeGraph checkout.

In all cases, the scripts are at `<skill-dir>/scripts/`, templates at
`<skill-dir>/template/`, and the vendored Mermaid engine and browser assets at `<skill-dir>/vendor/`.

To find the skill dir from a shell:

```bash
find . ~/.claude/skills ~/.dsh/skills ~/.agents/skills -type f -name SKILL.md \
  \( -path '*codegraph*' -o -path '*CodeGraph*' \) 2>/dev/null | head -1 | xargs dirname
```

In examples below, `<SKILL_DIR>` refers to this resolved directory.

### 0.3 Target repository

The user's target repo (the code being analyzed) is referred to as `<repo>`.
All paths in `graph.locs.json` are relative to `<repo>`. The agent MUST obtain
`<repo>` (typically the current working directory) and pass it to scripts via
`--repo <abs-path>`.

The output directory `<repo>/.codegraph/output/` is created on demand.

---

## 1. Choose the workflow

This skill has two workflows. Pick one before doing anything else.

### 1.1 Graph workflow

Trigger it when the user's message:

- Contains the literal token **"CodeGraph"** (any case) AND one of:
  - "流程图" / "flowchart"
  - "时序图" / "sequence diagram"
  - "调用流程" / "call flow"
  - "流程" / "flow"
  - "PR" / "commit" / "diff" / "review" / "改动" / "变更" / "评审"
- OR explicitly says "use CodeGraph" / "用 CodeGraph 技能" together with a
  request to draw, visualize, map, or review.

If the request is primarily "介绍 / 讲解 / 科普 / 写网页 / 教程 / 原理", use the
CodeWalkthrough workflow below instead, even if it also contains the word "流程".

The rest of this file is the graph contract. Follow it exactly for this workflow.

### 1.2 CodeWalkthrough workflow

Trigger it when the user asks CodeGraph to **explain, introduce, teach, or build
a long-form interactive explainer** about a module or flow, including:

- "介绍 / 讲解 / 科普 / 说明 / 教程 / 原理 / 深入理解"
- "写一个网页介绍 / 做一个讲解页面 / 生成一个学习页面"
- "用 CodeGraph 为我介绍 XX 流程"
- "用 CodeGraph 写一个网页介绍 XXX 模块"

Read `references/walkthrough.md` **before** gathering evidence or writing the
page. That file defines the intake questions, the evidence table, the page
structure, the content/source-link format, the build command, and the self-check
protocol. Do not use the graph contract for this workflow.

If the user's intent is ambiguous (for example just "用 CodeGraph 看一下这个模块"),
ask exactly one question:

> 你是想要一张流程图，还是一篇可以交互阅读的讲解网页？

Do not trigger either workflow on generic "explain the code" or "draw me a
diagram" requests that do not mention CodeGraph.

---

## 2. Interaction Flow

Execute these steps in order.

### Step 1 — Editor configuration

1. Read `<repo>/.codegraph/config.json` if it exists.
2. If it does not exist, or `editor.id` is missing:
   - Ask the user to choose one editor from the supported list:
     `vscode`, `vscode-insiders`, `cursor`, `idea`, `pycharm`, `webstorm`,
     `goland`, `phpstorm`, `rider`, `clion`, `rubymine`, **`web`**.
   - For the `web` editor: **no install verification is needed.** It opens
     source in an in-page code panel inside the same browser tab — nothing
     launches externally. Skip the `which` / `ls /Applications` check.
   - For the other editors, verify the editor is installed by running one of:
     - `which code` (vscode)
     - `which cursor` (cursor)
     - `ls /Applications | grep -i "IntelliJ\|PyCharm\|WebStorm\|GoLand\|PhpStorm\|Rider\|CLion\|RubyMine\|VS Code\|Cursor"`
     - For VS Code: `ls /Applications | grep -i "Visual Studio Code"`
   - If the editor is **not** found, tell the user and ask them to pick another.
   - On success, write `<repo>/.codegraph/config.json`:

     ```json
     {
       "editor": { "id": "vscode", "label": "VS Code" },
       "outputDir": ".codegraph/output"
     }
     ```

     `web` is also a valid `editor.id` (e.g. `{"editor": {"id": "web", "label": "Web"}}`).

> **Note on `web`**: when `editor.id === 'web'`, `build-html.mjs` embeds every
> file referenced in `graph.locs.json` into the HTML at build time, and the
> renderer opens an in-page code panel (right side of the canvas, default
> canvas:code = 1:2, drag the splitter to resize) instead of jumping to an
> external editor. This is useful when the viewer doesn't have a supported
> editor installed locally. The HTML stays single-file and offline-capable.

### Step 2 — Alignment with user (max 3 rounds total)

Clarify these five things. If the user's first answer is vague, you may
heuristic-expand **1–2 levels** (e.g. list 2–3 candidate flows and ask which).
**Hard cap: 3 rounds of clarification.** If still ambiguous, pick the most
reasonable interpretation, state it explicitly, and proceed.

1. **Which flow** — exact entry point or feature name.
2. **Scope** — which directories/files are in scope.
3. **Depth** — how many call layers deep to follow (default: 2).
4. **Breadth** — within scope, fan out into sibling branches or stay linear.
5. **Diagram type** — `flowchart`, `sequence`, or `both`.
6. **Language** — what language to use for labels/messages (default: user's
   UI language; confirm once).

### Step 3 — Read code and produce data files

1. Read the relevant code. **You (the agent) must produce the topology by
   reading code.** Do NOT write or invoke any script that greps, parses, or
   otherwise auto-extracts call relationships. AST/grep helpers are forbidden
   for topology generation.
2. Read the surrounding source context for every proposed location and verify
   that it implements the behavior described by the label. A behavior node must
   point to its actual statement; only an entry/declaration node may point to a
   definition line. Edges point to the actual caller-side call, publish, branch,
   or return statement. Sequence messages follow the same actual-occurrence rule.
   Reusing a location is valid when elements describe the same real statement.
   Never substitute a convenient function header or invent a location. If one
   location cannot truthfully express an element, split the diagram or narrow
   its semantics.
3. Produce **two files** in the output directory (see §4 for formats):
   - `graph.mmd` — a flowchart and/or sequence diagram using supported Mermaid syntax (see the Mermaid Support Contract).
   - `graph.locs.json` — semantic source locations, including every flowchart
     node and edge using the recommended `flowchart: {nodes, edges}` form.
4. Hand these to the validator (§9). It checks structure, paths, and line ranges;
   it cannot prove that natural-language labels match source semantics. You must
   verify that correspondence by reading code. On failure, read the error report, fix,
   and re-run. **Maximum 3 retry rounds.** If still failing after 3 rounds,
   stop, paste the latest error report to the user, and ask for guidance.

### Step 4 — Build HTML

Run `build-html.mjs` to produce `graph.html`. Open path is reported to user.

### Step 5 — Report to user

Report:
- The absolute path to `graph.html`.
- A one-line hint: "For silent click-to-jump, open in Chrome / Edge / Firefox.
  Safari will prompt on every click."

---

## 3. Review Mode

Review mode produces a diff-aware diagram from a PR, single commit, `base..head`
ref range, or the working tree. Every node / edge / actor / message is colored
by diff status:

| Status | Color | Visual |
|---|---|---|
| added | green | solid fill |
| modified | orange | solid fill |
| removed | red | dashed fill + border |
| unchanged | default | unchanged |

### Trigger

Same as §1, plus any of these keywords: `PR`, `commit`, `diff`, `review`,
`改动`, `变更`, `评审`.

### Workflow

1. **Resolve diff source**:
   - PR number: `node <SKILL_DIR>/scripts/diff-status.mjs --repo <repo> --base pr/<num> --head pr/<num>` (uses `gh pr view`).
   - Single commit: base = `<sha>~1`, head = `<sha>`.
   - Working tree: base = `HEAD`, head = `WORKTREE`.
   - Ref range: pass `--base <ref>` and `--head <ref>` directly.
2. **Run `diff-status.mjs`**: get `addedLines` / `removedLines` per file.
3. **Read code** (primarily the new version) and produce topology manually.
   Attribute status with the diff table:
   - Node loc line ∈ `addedLines` → `"added"`.
   - Node loc line ∈ `removedLines` → `"removed"`.
   - File is `modified` but the exact line isn't in either set, and the node's
     semantics clearly changed → `"modified"`.
   - Otherwise → `"unchanged"`.
4. **Write `graph.mmd`**: include diff-touched nodes **plus surrounding context**
   (caller chain, callers of callers, related branches). Merge adjacent trivial
   steps. Don't render line-by-line.
5. **Write `graph.locs.json`**: use 3-element entries `[file, line, status]`.
6. **Validate** with `validate.mjs` (extended for review mode).
7. **Build** with `--diff-base` and `--diff-head` so the legend and colors render:

   ```bash
   node <SKILL_DIR>/scripts/build-html.mjs \
     --mmd <output>/graph.mmd \
     --locs <output>/graph.locs.json \
     --repo <repo-root> \
     --out <output>/graph.html \
     --editor-config <repo>/.codegraph/config.json \
     --diff-base <base> \
     --diff-head <head>
   ```

8. **Report** the output path; mention it's a review-mode diagram.

### Removed-node rule

For removed behavior, read the old source and diff to verify what disappeared.
Do not invent a current location or substitute an unrelated surviving statement
or function header. Include a removed element only when its source reference
can truthfully express the label within the available source context; otherwise
split the diagram or narrow its semantics. A guessed nearby line is not semantic
evidence.

### Simplification rule

A diagram with 30 nodes where 5 are touched is better than a diagram with only
those 5 nodes. The reviewer needs the surrounding context to understand where
the change fits.

---

## Mermaid Support Contract

Mermaid syntax support follows the official Mermaid **11.12.0** engine, fixed
and vendored with the skill; see `vendor/mermaid-manifest.json` for bundle details. The supported contract is
the syntax accepted by that engine and representable by CodeGraph's graph model
and renderer. This is not a promise that every Mermaid diagram type or feature is
supported. Each `graph.mmd` may contain one `graph` / `flowchart` diagram and/or
one `sequenceDiagram`; other diagram types are outside this contract.

Common constructs within this boundary include:

- **Flowcharts:** `graph` / `flowchart` headers in `TD`, `TB`, `BT`, `LR`, or `RL`; commonly used node shapes; labeled
  and styled edges; chained connections; subgraphs; style and class declarations;
  quoted labels and multiline labels.
- **Sequence diagrams:** actor / participant declarations, including implicit
  participants accepted by Mermaid; message arrows; activation and deactivation;
  notes; `loop`, `alt`, `opt`, `par`, `critical`, and `break` fragments; `rect`
  and `box` grouping; and `autonumber`.

This list is representative, not an exhaustive feature matrix. Keep Mermaid
syntax valid for the pinned engine. If a construct is not accepted by validation
or cannot be represented faithfully in the generated view, simplify the diagram
or narrow its scope; do not invent source locations or change the meaning to
work around a display limitation. CodeGraph imposes no arbitrary two-level
nesting limit on flowcharts or sequence fragments.

### Labels

**Label rules (content — IMPORTANT)**:

Labels must be **concise, human-readable descriptions in the user's language**,
not raw identifiers or code snippets. The audience is a non-engineer (e.g. a
product manager) trying to understand the flow at a glance.

Rules:
1. **Description first, function name optional.** The description must make
   sense standalone. The function name may be appended in parentheses as an
   annotation for engineers who want to dig deeper.
2. **Use the user's preferred language** for the description (e.g. Chinese if
   the user is conversing in Chinese). Function names, HTTP methods, and
   status codes stay in English.
3. **Never use a raw function name, file name, class name, or code snippet
   as the entire label.** Always pair it with a description.
4. **For decision nodes (`{...}`)**, phrase the label as a yes/no question
   or a clear condition — not as the variable being checked.

| Bad | Good | Why |
|---|---|---|
| `[verifyPassword()]` | `[校验用户密码 verifyPassword()]` | Description first; function name as annotation |
| `[handleInput]` | `[读取用户输入]` | Description only when name adds nothing |
| `[if (user.role === 'admin')]` | `{是管理员?}` | Decisions must be questions, not code |
| `[POST /api/login]` | `[发送登录请求 POST /api/login]` | Description first; endpoint as annotation |
| `[user.isAuthenticated()]` | `{已登录?}` | Decisions must be questions, not code |
| `[return 401]` | `[返回未授权 401]` | Translate / annotate; bare codes are opaque |
| `[processPayment(userId, amount)]` | `[处理支付 processPayment()]` | Description first; drop noisy parameters |
| `[step1]` | `[第一步：解析请求]` | Placeholder names are forbidden |
| `[AuthService.login()]` | `[登录鉴权 AuthService.login()]` | Description first; qualified name as annotation |

The label-content rules apply equally to **sequence message text** and to
**sequence actor display names** (actor names should be role-based: `Client`,
`Auth Service`, `数据库` — not raw class names).

### Source locations and visual-only constructs

`graph.locs.json` maps semantic code elements, not every visual item:

- Every flowchart node and every flowchart edge has exactly one verified source
  location. Node IDs and edge identities must match `graph.mmd` exactly; edge
  mappings cover all edges, including repeated and chain-expanded edges (§4.1).
- Every sequence actor / participant and every message has a matching verified
  source location. Message locations follow message-arrow order exactly (§4.2).
- Subgraph or box groups, notes, and fragment / control-block markers (including
  branch separators such as `else`, `and`, and `option`) are visual structure;
  they do not require location entries. They do not replace or weaken the
  complete mapping required for nodes, edges, actors, and messages.

Rendering uses Mermaid strict security. Mermaid callbacks and links are not CodeGraph source mappings and must not
replace or redirect CodeGraph's click-to-source behavior. External images and
icons are not guaranteed to work offline. External ELK layouts and image / icon
assets are not bundled. Do not rely on remote assets for essential diagram meaning.

The builder embeds the vendored Mermaid engine and graph assets into a single
HTML file. The generated HTML has no runtime npm or network dependency.
Development packages used to rebuild vendored assets are separate from the
graph-generation and viewer runtime; users do not need `npm install` to generate
or open a graph.

---

## 4. `graph.locs.json` Format

A JSON file containing semantic source locations for diagram elements. Each
location is `[relativeFilePath, lineNumber]` or
`[relativeFilePath, lineNumber, diffStatus]`.

The optional third element `diffStatus` is used in **review mode** (§3). It must
be one of:

- `"added"` — new in this diff.
- `"modified"` — changed in this diff.
- `"removed"` — deleted in this diff.
- `"unchanged"` — not touched by this diff (same as omitting the third element).

When the third element is omitted, the element is treated as `"unchanged"`.

### 4.1 For flowchart

Recommended form (for `A --> B --> C`):

```json
{
  "flowchart": {
    "nodes": {
      "A": ["src/handler.ts", 12],
      "B": ["src/handler.ts", 20, "modified"],
      "C": ["src/handler.ts", 35, "added"]
    },
    "edges": [
      {"from": "A", "to": "B", "occurrence": 1, "loc": ["src/handler.ts", 15]},
      {"from": "B", "to": "C", "occurrence": 1, "loc": ["src/handler.ts", 28, "added"]}
    ]
  }
}
```

For a single flowchart, the unwrapped `{ "nodes": {...}, "edges": [...] }`
form is also accepted. `nodes` keys must exactly match the node IDs in
`graph.mmd`. Every edge MUST have exactly one matching location record in the
new format, including unlabeled, dashed, repeated, and chain-expanded edges;
partial coverage and orphan records are invalid.

An edge's identity is **`JSON.stringify([from, to, occurrence])`**.
`occurrence` is a **1-based counter per directed endpoint pair**, assigned in
`graph.mmd` order, expanding chains left to right. For `A --> B --> A` followed
by `A --> B`, the identities are `["A","B",1]`, `["B","A",1]`, and
`["A","B",2]`. Unrelated edges do not change these counters; labels and styles
are not part of identity. Reordering edges with the same directed endpoints
requires regenerating their location records together with the Mermaid.

Each node value and edge `loc` is a 2- or 3-element array:
1. File path **relative to repo root**. Use `/` as separator. No `./` prefix.
2. Line number (1-based positive integer within the file).
3. (optional) Diff status: `"added"`, `"modified"`, `"removed"`, or `"unchanged"`.

Node locations identify the actual statement implementing the label's behavior;
only entry/declaration nodes may use a definition line. Edge locations identify
the caller-side call, publish, branch, or return where the relationship actually
occurs, rather than the callee's definition. Multiple elements may share a
location when they describe the same real statement. Read context to verify
this; do not fabricate lines or use function headers as substitutes. If a single
location cannot express the meaning faithfully, split the diagram or narrow the
label's semantics.

**Legacy compatibility:** the old flat node map `{ "A": [file, line], ... }`
(and that map inside the `flowchart` wrapper) remains readable. Its edges use an
**approximate source fallback**, not an explicit semantic edge location. Use the
new fully covered `nodes`/`edges` format for generation; legacy fallback does not
relax the new format's full-edge-coverage requirement.

### 4.2 For sequence

```json
{
  "actors": {
    "C": ["src/client.ts", 1],
    "S": ["src/server.ts", 30, "removed"],
    "A": ["src/auth.ts", 1]
  },
  "messages": [
    ["src/client.ts", 18],
    ["src/server.ts", 35, "modified"],
    ["src/auth.ts", 25],
    ["src/server.ts", 50]
  ]
}
```

- `actors` keys must exactly match every actor / participant ID in `sequenceDiagram`, including implicitly declared participants.
- `messages` is a **flat array in the order messages appear in `graph.mmd`**.
  Each entry = `[file, line]` or `[file, line, status]`. The array length MUST
  equal the number of message arrows in `graph.mmd`. Notes, groups, and fragment
  markers / separators (such as `else`, `and`, and `option`) are visual-only and
  do not need locations or count as messages.
- Message locations point to the actual sending-side call/publish or returning
  statement, including self-calls; never use a receiver's definition as a proxy.
  Read the surrounding code to confirm the message text matches the statement.
  Locations may repeat when messages refer to the same real statement. If one
  location cannot express a message truthfully, split the diagram or narrow its
  semantics. Actor locations may identify their actual entry/declaration.

---

## 5. Output Directory Layout

```
<repo>/.codegraph/output/<YYYYMMDD-HHMM>-<topic-slug>/
├── graph.mmd
├── graph.locs.json
└── graph.html
```

- `YYYYMMDD-HHMM` = local time at start of generation.
- `<topic-slug>` = short slug derived from the flow name. Use ASCII lowercase
  with hyphens, OR keep CJK characters if the flow name is in CJK. No spaces,
  no `/`, no `:`. Example: `20260704-1015-用户登录`.

---

## 6. Paired Examples

These three examples are the **specification by example**. Match their
structure exactly. Paths and lines illustrate hypothetical source statements;
when generating a real diagram, read the actual code and replace every location
with a verified semantic reference.

### Example 1 — Flowchart only

`graph.mmd`:

```
flowchart TD
    A([接收登录请求]) --> B{已登录?}
    B -->|是| C[返回用户信息 getUserInfo]
    B -->|否| D[验证密码 verifyPassword]
    D --> E[生成 token issueToken]
    E --> C
    C --> F[(写审计日志)]
```

`graph.locs.json`:

```json
{
  "flowchart": {
    "nodes": {
      "A": ["src/handler.ts", 12],
      "B": ["src/handler.ts", 20],
      "C": ["src/handler.ts", 35],
      "D": ["src/auth.ts", 8],
      "E": ["src/auth.ts", 45],
      "F": ["src/audit.ts", 4]
    },
    "edges": [
      {"from": "A", "to": "B", "occurrence": 1, "loc": ["src/handler.ts", 20]},
      {"from": "B", "to": "C", "occurrence": 1, "loc": ["src/handler.ts", 21]},
      {"from": "B", "to": "D", "occurrence": 1, "loc": ["src/handler.ts", 25]},
      {"from": "D", "to": "E", "occurrence": 1, "loc": ["src/handler.ts", 28]},
      {"from": "E", "to": "C", "occurrence": 1, "loc": ["src/handler.ts", 35]},
      {"from": "C", "to": "F", "occurrence": 1, "loc": ["src/handler.ts", 36]}
    ]
  }
}
```

### Example 2 — Sequence only

`graph.mmd`:

```
sequenceDiagram
    participant C as Client
    participant S as Server
    participant A as Auth
    C->>S: POST /login
    S->>A: verifyPassword()
    A-->>S: ok
    S->>S: generateToken()
    S-->>C: 200 + token
```

`graph.locs.json`:

```json
{
  "actors": {
    "C": ["src/client.ts", 1],
    "S": ["src/server.ts", 30],
    "A": ["src/auth.ts", 1]
  },
  "messages": [
    ["src/client.ts", 18],
    ["src/server.ts", 35],
    ["src/auth.ts", 25],
    ["src/server.ts", 48],
    ["src/server.ts", 50]
  ]
}
```

### Example 3 — Both diagrams

When the user asks for both `flowchart` and `sequence`, **combine them in a
single `graph.mmd`**, separated by a blank line. The two diagrams share a
single `graph.locs.json` with `flowchart` and `sequence` wrappers. The flowchart
wrapper contains `nodes` and a fully covered `edges` array:

```
graph.mmd:

flowchart TD
    A([入口]) --> B[校验]
    B --> C[处理]

sequenceDiagram
    participant A as Handler
    participant B as Service
    A->>B: process()
    B-->>A: result
```

`graph.locs.json`:

```json
{
  "flowchart": {
    "nodes": {
      "A": ["src/main.ts", 5],
      "B": ["src/validate.ts", 12],
      "C": ["src/handle.ts", 35]
    },
    "edges": [
      {"from": "A", "to": "B", "occurrence": 1, "loc": ["src/main.ts", 8]},
      {"from": "B", "to": "C", "occurrence": 1, "loc": ["src/main.ts", 10]}
    ]
  },
  "sequence": {
    "actors": {
      "A": ["src/main.ts", 5],
      "B": ["src/handle.ts", 30]
    },
    "messages": [
      ["src/main.ts", 10],
      ["src/handle.ts", 60]
    ]
  }
}
```

> For a flowchart alone, prefer the `flowchart: {nodes, edges}` wrapper (§4.1);
> unwrapped `{nodes, edges}` is also accepted. For a sequence alone, use
> `actors`/`messages` (§4.2). For both, use the `flowchart`/`sequence` wrappers
> shown in Example 3. Old flat node maps are legacy input only; their edge
> navigation is an approximate source fallback.

---

## 7. Hard Rules

1. **Topology is produced by you reading code.** Do not write or call any
   script that auto-extracts call relationships from source.
2. **Every node / edge / actor / message must have a location.** Generated
   flowcharts use `nodes`/`edges` with full edge coverage. Legacy flat maps are
   readable only with approximate source fallback for edges (§4.1). Visual-only
   groups, notes, and fragment markers do not require locations.
3. **Paths are relative to the repo root.** No absolute paths. No `./` prefix.
4. **Read source context to verify semantics.** Validation checks structure,
   paths, and line ranges; it cannot prove that natural-language labels describe
   the referenced statements.
5. **Line numbers are 1-based positive integers within the file.** Behavior
   nodes point to the actual statements implementing their labels. Only
   entry/declaration nodes may point to definition lines. Edges and sequence
   messages point to actual caller/sender-side calls, publishes, branches, or
   returns. Never substitute function headers or invent locations. Repeated
   locations are allowed for the same real statement. If one location cannot
   faithfully express the meaning, split the diagram or narrow its semantics.
6. **IDs and edge identities must align exactly.** Node keys must match the
   Mermaid node IDs with no orphans. Each edge record must match exactly one
   `JSON.stringify([from, to, occurrence])` identity (§4.1), with no missing or
   extra edges. Count each directed pair from 1 in Mermaid order, expanding
   chains left to right. Unrelated edges do not affect the count; regenerate
   matching records when reordering edges with the same directed endpoints.
7. **Message count must match.** For sequence diagrams, the number of message
   arrows in `graph.mmd` must equal `messages.length` in `graph.locs.json`.
8. **Use the user's language** for all node labels, message texts, notes, and
   the topic slug. Use English for code identifiers in labels (function names,
   HTTP methods, status codes).
9. **Use Mermaid syntax within the supported boundary**: the pinned engine must parse it, and CodeGraph must be able to represent it faithfully.
10. **Maximum 3 retry rounds.** If validation fails 3 times in a row, stop,
    paste the latest error report to the user, and ask for guidance.

---

## 8. Common Mistakes (Avoid These)

| Mistake | Why it fails | Fix |
|---|---|---|
| Using syntax that the pinned Mermaid engine does not accept | Validation follows the fixed vendored engine version (see the Mermaid Support Contract) | Check the vendor manifest and use syntax supported by that version |
| Assuming every Mermaid feature or diagram type is supported | CodeGraph supports a bounded flowchart / sequence workflow, not all Mermaid features (see the Mermaid Support Contract) | Keep to supported syntax that the generated view can represent faithfully |
| Treating subgraphs, groups, notes, or fragment markers as source-mapped elements | These are visual-only and do not need location records | Map all semantic nodes, edges, actors, and messages instead |
| Expecting Mermaid callbacks or links to replace CodeGraph source navigation | CodeGraph click behavior is driven by semantic source locations | Use `graph.locs.json` for source navigation |
| Relying on external image or icon URLs in an offline graph | External assets may not be available without a network | Keep essential meaning in text and locally available graph content |
| Missing a node, edge, actor, or message location | Semantic source mappings require complete coverage | Add the exact matching record; for flowchart edges use the directed-pair occurrence identity (§4.1) |
| Reordering repeated edges without updating their occurrences | Edge identity is assigned per directed endpoint pair in Mermaid order | Regenerate the affected edge mappings (§4.1) |
| Using a function header or nearby line as a behavior location | Structural validation cannot establish semantic correspondence | Read surrounding source and point to the actual statement; narrow or split the diagram if needed |
| Using an absolute path or a `./` / `../` prefix | Paths must be relative to the repository root | Use the real repository-relative path |
| Using a path that does not exist or a line outside the file | Validator checks containment, file type, and line range | Fix the path or use a valid 1-based line number; removed review locations may refer to deleted files |
| Wrong sequence message count | `messages` must match message-arrow order and count | Re-count message arrows; notes, groups, and fragment markers do not count |
| Orphan location entry | Every node / actor ID and every edge identity must align with `graph.mmd` | Remove the orphan or add the matching Mermaid element |
| Using flat-form locations for two diagrams | The two diagrams need `flowchart` / `sequence` wrappers | Use the wrapper form shown in Example 3 |

---

## 9. Validation Failure Protocol

Run the validator:

```
node <SKILL_DIR>/scripts/validate.mjs \
  --mmd <output>/graph.mmd \
  --locs <output>/graph.locs.json \
  --repo <repo-root>
```

Exit code 0 + `{"ok": true}` means pass. Non-zero + a JSON error report means
failure — read it and fix.

When `validate.mjs` returns a non-zero exit with a JSON error report:

1. Read each error object's `code`, `path`, `message`, and especially
   `fix_hint`.
2. Apply the fix suggested by `fix_hint`. If multiple errors, fix all in one
   pass to conserve rounds.
3. Re-run the validator.
4. Count this as one retry round. Stop after 3 rounds.

The error report looks like:

```json
{
  "ok": false,
  "errors": [
    {
      "level": "error",
      "code": "UNKNOWN_NODE_ID",
      "path": "graph.mmd:3",
      "message": "node id 'X' has no entry in graph.locs.json",
      "fix_hint": "Add an entry \"X\": [\"<relative/path>\", <line>] to graph.locs.json"
    }
  ]
}
```

---

## 10. Build & Reporting

After validation passes, run `build-html.mjs`:

```
node <SKILL_DIR>/scripts/build-html.mjs \
  --mmd <output>/graph.mmd \
  --locs <output>/graph.locs.json \
  --repo <repo-root> \
  --out <output>/graph.html \
  --editor-config <repo>/.codegraph/config.json
```

Then report to the user:

> CodeGraph generated: `<absolute path to graph.html>`
> Tip: open in Chrome / Edge / Firefox for silent click-to-jump. Safari will
> prompt on every click.

---

## 11. Language Policy (Summary)

| Artifact | Language |
|---|---|
| This SKILL.md | English |
| Mermaid support contract, error messages from scripts | English |
| `graph.mmd` node labels, messages, notes, topic slug | User's preferred language |
| Communication with user during alignment | User's preferred language |
