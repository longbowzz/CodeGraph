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

The scripts in this skill have **zero npm dependencies at runtime** — they use
only Node.js standard-library modules (`node:fs`, `node:path`, `node:url`).
There is no `npm install` step.

Required on the host machine:

- **Node.js 18 or newer.** Verify with `node --version`. Required for
  `validate.mjs` and `build-html.mjs` (ESM + `node:` prefix imports).
- **A supported editor** for click-to-jump (VS Code / Cursor / JetBrains family),
  **or** the `web` editor which opens source in an in-page code panel (no
  external editor needed). See §2 Step 1 and §6 for the full list. Non-`web`
  editors must be installed and reachable via their OS URL scheme.
- **An internet connection is NOT required** at any point after the skill is
  installed. The dagre layout library is vendored at `vendor/dagre.min.js`.

### 0.2 Skill directory resolution

The agent MUST resolve the skill's own directory before invoking scripts. The
skill can be installed in one of these locations (check in order):

1. **Project-local**: `<repo>/.claude/skills/CodeGraph/`
2. **User-global**: `~/.claude/skills/CodeGraph/`
3. **Cloned repo**: any directory containing this `SKILL.md` file.

In all cases, the scripts are at `<skill-dir>/scripts/`, templates at
`<skill-dir>/template/`, and the vendored dagre at `<skill-dir>/vendor/`.

To find the skill dir from a shell:

```bash
find . ~/.claude/skills -type f -name SKILL.md -path '*CodeGraph*' 2>/dev/null | head -1 | xargs dirname
```

In examples below, `<SKILL_DIR>` refers to this resolved directory.

### 0.3 Target repository

The user's target repo (the code being analyzed) is referred to as `<repo>`.
All paths in `graph.locs.json` are relative to `<repo>`. The agent MUST obtain
`<repo>` (typically the current working directory) and pass it to scripts via
`--repo <abs-path>`.

The output directory `<repo>/.codegraph/output/` is created on demand.

---

## 1. When to Trigger

Trigger this skill when the user's message:

- Contains the literal token **"CodeGraph"** (any case) AND one of:
  - "流程图" / "flowchart"
  - "时序图" / "sequence diagram"
  - "调用流程" / "call flow"
  - "流程" / "flow"
  - "PR" / "commit" / "diff" / "review" / "改动" / "变更" / "评审"
- OR explicitly says "use CodeGraph" / "用 CodeGraph 技能".

Do **not** trigger on generic "explain the code" or "draw me a diagram" requests.

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
2. Produce **two files** in the output directory (see §4 for formats):
   - `graph.mmd` — topology (Mermaid subset, see §3).
   - `graph.locs.json` — flat location lookup.
3. Hand these to the validator (§6). On failure, read the error report, fix,
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

Removed nodes **must** appear in `graph.mmd` and carry `"removed"` status. Their
loc should point at the closest still-existing file and line (best guess for
"where it used to be"); if the file is gone, point at the most related existing
file. This keeps click-to-jump useful.

### Simplification rule

A diagram with 30 nodes where 5 are touched is better than a diagram with only
those 5 nodes. The reviewer needs the surrounding context to understand where
the change fits.

---

## 4. Mermaid Subset Contract

**You are restricted to this subset.** Anything outside it will be rejected by
the validator. The subset is intentionally minimal.

### 3.0 Default-deny policy

**The validator uses a strict allowlist, NOT a denylist.**

- If a keyword, arrow style, shape, or directive is **explicitly listed in an
  ALLOWED table below**, it is accepted.
- **Anything else is rejected**, regardless of whether it appears in the
  "Forbidden" list or not, and regardless of whether standard Mermaid supports
  it.
- When in doubt, do not use the feature. If you need to express something the
  subset cannot express (e.g. parallel branches in sequence, hexagon node),
  approximate it with the closest allowed form (e.g. use a `loop` block, use a
  normal rectangle).
- The "Forbidden" lists below are **non-exhaustive examples** of commonly
  emitted Mermaid features that the validator rejects; they are not the full
  set of rejections.

### 3.1 Flowchart subset

Header (exactly one):

```
flowchart TD
```

or

```
flowchart LR
```

Node declarations (one of four shapes only):

| Syntax | Meaning |
|---|---|
| `A[label]` | Normal node |
| `A{label}` | Decision / branch |
| `A([label])` | Start / end terminal |
| `A[(label)]` | Storage / external system |

Edge declarations (one of four styles only):

| Syntax | Meaning |
|---|---|
| `A --> B` | Solid arrow |
| `A -->\|text\| B` | Solid arrow with label |
| `A -.-> B` | Dashed arrow (use for async / return) |
| `A -.->\|text\| B` | Dashed arrow with label |

**Node ID rules**:
- Pattern: `[A-Za-z][A-Za-z0-9_]*`
- Must be unique across the file.
- Do NOT start with a digit, do NOT contain `-` or `.`.

**Label rules (syntax)**:
- Avoid `]`, `}`, `|` inside labels. If you must include them, escape as
  `&#93;`, `&#125;`, `&#124;`.
- Keep labels concise (ideally ≤ 20 characters; the renderer wraps on `\n`
  only — long single-line labels make wide boxes).

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

**Forbidden in flowcharts** (validator will reject; non-exhaustive — anything
not in the ALLOWED tables above is rejected):
- Headers: `graph TD`, `graph LR`, `flowchart TB`, `flowchart BT`,
  `flowchart RL` (only `flowchart TD` and `flowchart LR` are allowed).
- Other node shapes: `A(label)` (round), `A((label))` (circle),
  `A(((label)))` (double circle), `A{{label}}` (hexagon), `A[/label/]`
  (parallelogram), `A[\label\]` (reverse parallelogram), `A>label]` (async),
  `A{{label}}`, `A~~~label~~~`, double-pipe markers, etc.
- Other edge styles: `A -- text --> B` (label outside `|...|` pipes),
  `A == text ==> B` (thick), `A === B`, `A -> B` (single dash),
  `A --- B` (no arrowhead), `A <-> B` (bidirectional), `A x-- B`,
  `A o-- B`, `A -. text .- B`, dotted without arrow, point styles, etc.
- Structure / directives: `subgraph`, `end` (no subgraphs exist in this subset),
  `style`, `classDef`, `class`, `linkStyle`, `click`, `id`, `%%` frontmatter
  (`---` YAML or `%%{init:...}%%`), `accTitle`, `accDescr`, `direction`,
  `defaultFont*`, etc.
- Label content: HTML tags `<br>`, `<b>`, Markdown `**bold**`, backticks,
  quoted labels `A["x"]`, labels containing newlines or `\n`, `<br/>`,
  Markdown links, `#`-headings.
- Comments: `%% this is a comment` (no comments allowed; comments are
  rejected, not stripped).
- Whitespace tricks: indentation inside subgraph, multi-line statements
  joined with `\`.

### 3.2 Sequence subset

Header (exactly one):

```
sequenceDiagram
```

Participants (one line each, **mandatory `as` form**):

```
participant C as Client
participant S as Server
```

Messages (one of four arrow styles only):

| Syntax | Meaning |
|---|---|
| `A->>B: text` | Synchronous call |
| `A-->>B: text` | Return / reply |
| `A-)B: text` | Async (open arrow) |
| `A->>A: text` | Self-call |

Notes (optional):

```
Note left of A: text
Note right of A: text
Note over A: text
```

Control blocks (optional; nested up to 2 levels):

```
loop description
    ...
end

alt condition
    ...
else other condition
    ...
end

opt condition
    ...
end
```

**Forbidden in sequence** (validator will reject; non-exhaustive — anything not
in the ALLOWED tables above is rejected):
- Participants: `participant X` without `as`, `actor X as Y` (`actor` keyword
  is not allowed), `participant X #color;` (style suffix), undeclared actors
  used in messages (every actor used in a message MUST be declared).
- Activation: `activate A`, `deactivate A`, `+`/`-` activation shorthand
  (`A->>+B: x` / `B-->>-A: y`).
- Numbering: `autonumber`, `autonumber 5`, `autonumber off`.
- Visual grouping: `box`, `box Color Title ... end`, `rect rgb(...)`.
- Links: `links A: {"Label": "url"}`, `link A: ...`.
- Lifecycle: `create participant B`, `create actor B`, `destroy A`.
- Other fragments: `par ... and ... end` (parallel), `critical ... option ... end`,
  `break ... end`.
- Arrow variants beyond the 4 allowed: `A->B: text` (single `-`),
  `A-->B: text`, `A--xB: text`, `A-x B: text`, `A-)B: text` with extra dots,
  `<<->>` (bidirectional), `--x`, `-x`, `-\|`, `--\|`, `~/~`, etc.
- Notes: `Note over A,B: text` (multi-actor span — only single actor `over`
  is allowed), `Note over A,B,C:`, `Note left of A,B:`, color suffixes on
  notes.
- Comments: `%% comment`.
- Frontmatter / config: `%%{init:...}%%`, `--- config: ... ---`,
  `accTitle`, `accDescr`.

---

## 4. `graph.locs.json` Format

A flat JSON file mapping element identifiers to `[relativeFilePath, lineNumber]`
or `[relativeFilePath, lineNumber, diffStatus]`.

The optional third element `diffStatus` is used in **review mode** (§3). It must
be one of:

- `"added"` — new in this diff.
- `"modified"` — changed in this diff.
- `"removed"` — deleted in this diff.
- `"unchanged"` — not touched by this diff (same as omitting the third element).

When the third element is omitted, the element is treated as `"unchanged"`.

### 4.1 For flowchart

```json
{
  "A": ["src/handler.ts", 12],
  "B": ["src/handler.ts", 20, "modified"],
  "C": ["src/handler.ts", 35, "added"]
}
```

Keys = node IDs from `graph.mmd`. Values = 2- or 3-element arrays:
1. File path **relative to repo root**. Use `/` as separator. No `./` prefix.
2. Line number (1-based positive integer).
3. (optional) Diff status: `"added"`, `"modified"`, `"removed"`, or `"unchanged"`.

### 4.2 For sequence

```json
{
  "actors": {
    "C": ["src/client.ts", 1],
    "S": ["src/server.ts", 30, "removed"],
    "A": ["src/auth.ts", 1]
  },
  "messages": [
    ["src/server.ts", 35],
    ["src/auth.ts", 12, "modified"],
    ["src/auth.ts", 25],
    ["src/server.ts", 50]
  ]
}
```

- `actors` keys = participant IDs from `sequenceDiagram`.
- `messages` is a **flat array in the order messages appear in `graph.mmd`**.
  Each entry = `[file, line]` or `[file, line, status]`. The array length MUST
  equal the number of message arrows in `graph.mmd`. Notes and control-block
  headers do not count.

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
structure exactly.

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
  "A": ["src/handler.ts", 12],
  "B": ["src/handler.ts", 20],
  "C": ["src/handler.ts", 35],
  "D": ["src/auth.ts", 8],
  "E": ["src/auth.ts", 45],
  "F": ["src/audit.ts", 4]
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
    ["src/server.ts", 35],
    ["src/auth.ts", 12],
    ["src/auth.ts", 25],
    ["src/server.ts", 48],
    ["src/server.ts", 50]
  ]
}
```

### Example 3 — Both diagrams

When the user asks for both `flowchart` and `sequence`, **combine them in a
single `graph.mmd`**, separated by a blank line. The two diagrams share a
single `graph.locs.json` that uses both the flat form (for flowchart) and the
nested form (for sequence). To disambiguate, use the nested form:

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
    "A": ["src/main.ts", 5],
    "B": ["src/validate.ts", 12],
    "C": ["src/handle.ts", 30]
  },
  "sequence": {
    "actors": {
      "A": ["src/main.ts", 5],
      "B": ["src/handle.ts", 30]
    },
    "messages": [
      ["src/handle.ts", 35],
      ["src/handle.ts", 60]
    ]
  }
}
```

> If `graph.mmd` contains only a flowchart, `graph.locs.json` uses the flat
> form (§4.1). If it contains only a sequence, use the nested `actors`/`messages`
> form (§4.2). If it contains both, use the `flowchart`/`sequence` wrapper form
> shown in Example 3.

---

## 7. Hard Rules

1. **Topology is produced by you reading code.** Do not write or call any
   script that auto-extracts call relationships from source.
2. **Every node / actor / message must have a location.** No exceptions.
3. **Paths are relative to the repo root.** No absolute paths. No `./` prefix.
4. **Path existence is verified.** The validator runs `fs.existsSync` on every
   path. If you fabricate a path, validation fails.
5. **Line numbers are 1-based positive integers** pointing at the most
   representative line for that element (function definition, call site, etc.).
6. **ID sets must align exactly.** Every node ID in `graph.mmd` must appear in
   `graph.locs.json`. Every key in `graph.locs.json` must correspond to a real
   node ID. No orphans either direction.
7. **Message count must match.** For sequence diagrams, the number of message
   arrows in `graph.mmd` must equal `messages.length` in `graph.locs.json`.
8. **Use the user's language** for all node labels, message texts, notes, and
   the topic slug. Use English for code identifiers in labels (function names,
   HTTP methods, status codes).
9. **Stay within the Mermaid subset** (§3). Anything outside is rejected.
10. **Maximum 3 retry rounds.** If validation fails 3 times in a row, stop,
    paste the latest error report to the user, and ask for guidance.

---

## 8. Common Mistakes (Avoid These)

The validator will reject each of these. Learn from them.

### 8.1 Flowchart mistakes

| Mistake | Why it fails | Fix |
|---|---|---|
| Using `graph TD` or `graph LR` instead of `flowchart TD/LR` | Wrong header | Use `flowchart TD` or `flowchart LR` |
| Using `flowchart TB`/`BT`/`RL` | Out of subset | Use only `TD` or `LR` |
| Using `subgraph ... end` | Out of subset | Flatten the flowchart (inline all nodes) |
| Using `A(label)` round / `A((label))` circle / `A{{label}}` hex / `A[/x/]` parallelogram / `A>x]` asymmetric | Out of subset (only 4 shapes allowed: see §3.1) | Use `A[label]` rectangle instead |
| Using `A --> B -- text --> C` (label outside pipes) | Out of subset (edge label must be inside `\|...\|`) | Use `A -->\|text\| B --> C` |
| Using `A == text ==> B` thick / `A --- B` no arrow / `A <-> B` bidirectional / `A -> B` single dash | Out of subset (only 4 edge styles allowed: see §3.1) | Use `-->` or `-.->` with optional `\|text\|` |
| Using `style A fill:#f00` or `classDef` / `class` | Out of subset | Drop styling; colors are applied by the renderer based on shape |
| Using `click A callback` | Out of subset | Drop click directives; click is handled by the renderer |
| Node ID like `1a` or `node-a` or `node.x` | Invalid ID pattern (must be `[A-Za-z][A-Za-z0-9_]*`) | Rename to `A1`, `nodeA`, `nodeX` |
| Label containing unescaped `]`, `}`, `\|` | Breaks parser | Use HTML entities `&#93;` `&#125;` `&#124;` |
| Quoted label like `A["foo"]` or `A['foo']` | Out of subset (no quoted labels) | Use `A[foo]` |
| Markdown / HTML in labels (`**bold**`, `<br>`, backticks) | Out of subset | Plain text only; if multi-line needed, use a separate node |
| `%% comment` lines | Out of subset (no comments) | Remove the line |
| `accTitle` / `accDescr` / `---` YAML frontmatter | Out of subset | Remove |
| `%%{init: {...}}%%` config directive | Out of subset | Remove |

### 8.2 Sequence mistakes

| Mistake | Why it fails | Fix |
|---|---|---|
| Using `participant A` without `as Name` | Out of subset | Always use `participant A as DisplayName` |
| Using `actor A as Name` (`actor` keyword) | Out of subset | Use `participant A as Name` |
| Using `activate A` / `deactivate A` or `+`/`-` shorthand | Out of subset | Drop activation; rely on call→return pairs |
| Using `autonumber` | Out of subset | Drop it |
| Using `par ... and ... end` / `critical ... end` / `break ... end` | Out of subset | Use `loop` or `alt`/`opt` to approximate |
| Using `create participant B` / `destroy A` | Out of subset | Declare all participants up front |
| Using `A->B: x` (single dash) / `A-->B` / `A--xB` / `A-xB` / `<<->>` | Out of subset (only 4 arrow styles allowed: see §3.2) | Use `->>`, `-->>`, `-)`, or `->>A` self-call |
| Using `box` / `box Color Title ... end` | Out of subset | Drop; group conceptually via `loop` or naming |
| Using `Note over A,B: x` (multi-actor span) | Out of subset (only single-actor `over`/`left of`/`right of`) | Use `Note over A: x` per actor, or split |
| Using `links A: {...}` / `link A: ...` | Out of subset | Drop; locations live in `graph.locs.json` |
| Undeclared actor used in a message (`A->>B: x` where B has no `participant` line) | Out of subset (every actor must be declared) | Add `participant B as B` first |
| `rect rgb(...)`, color suffixes on notes/messages | Out of subset | Drop |

### 8.3 Cross-cutting mistakes

| Mistake | Why it fails | Fix |
|---|---|---|
| Missing location for some node/actor/message | ID misalignment | Add the missing `[file, line]` entry |
| Absolute path `/Users/foo/...` | Path must be relative to repo root | Strip repo prefix |
| Path with `./` or `../` prefix | Inconsistent | Remove prefix |
| Path that does not exist on disk | Validator runs `fs.existsSync` | Use the real relative path |
| Wrong message count (sequence) | Length mismatch | Re-count arrows in `graph.mmd`; `messages` array length must match |
| Orphan loc (entry in `graph.locs.json` with no matching node/actor in `graph.mmd`) | ID misalignment (reverse direction) | Remove the orphan entry |
| Two diagrams but using flat-form locs (no `flowchart`/`sequence` wrappers) | Shape mismatch | Use the wrapper form shown in Example 3 |
| Single diagram but using wrapper form unnecessarily | Shape mismatch | Use flat form (flowchart only) or sequence form (sequence only) per §4 |

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
| Mermaid subset contract, error messages from scripts | English |
| `graph.mmd` node labels, messages, notes, topic slug | User's preferred language |
| Communication with user during alignment | User's preferred language |
