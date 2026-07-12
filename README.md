# CodeGraph

> Generate interactive, single-page flowchart / sequence-diagram HTML from any
> codebase, with click-to-jump-to-source in your editor. Designed to be driven
> by an AI agent (Claude Code, etc.) — the agent reads your code and produces
> the graph; this repo provides the skill, validator, and HTML builder.
>
> 用 AI Agent 阅读你的代码，生成交互式单页流程图 / 时序图 HTML，点击节点
> 直接跳转到编辑器对应代码位置。

---

## What it does

CodeGraph turns a request like *"use CodeGraph to draw the login flow as a
flowchart"* into a self-contained `graph.html` file you can open in any browser:

- The agent reads your repo and produces two artifacts:
  - `graph.mmd` — topology in a strict Mermaid subset.
  - `graph.locs.json` — flat `[file, line]` lookup per node.
- A validator checks syntax + ID alignment + path existence.
- A builder inlines everything (vendored dagre + renderer + your data) into one
  HTML file with zoom/pan/hover/click-to-jump.

The HTML has **zero runtime dependencies** — no server, no CDN, no npm install
on the viewer's machine.

---

## Why not just use Mermaid?

- Mermaid text alone can't carry `file:line` metadata per node — CodeGraph uses
  a sidecar JSON for that.
- Mermaid's SVG output doesn't give you per-element click handlers easily —
  CodeGraph renders its own SVG with hover highlight and click-to-jump built in.
- The strict Mermaid subset (see `skill/CodeGraph/SKILL.md` §3) makes AI output
  reliable and parser-friendly.

---

## Install / 安装

### Requirements / 环境要求

- **Node.js 18+** (uses native `node:*` ESM imports; no `npm install` needed
  for runtime — all dependencies are either vendored or standard-library).
- A supported editor for click-to-jump (see below).
- An AI agent that supports skills (e.g. Claude Code) — or you can run the
  scripts manually.

### Add to Claude Code / 添加到 Claude Code

Clone the repo, then symlink (or copy) the skill into your Claude skills
directory:

```bash
git clone https://github.com/longbowzz/CodeGraph.git
ln -s "$(pwd)/CodeGraph/skill/CodeGraph" ~/.claude/skills/CodeGraph
```

(Or copy the `skill/CodeGraph/` directory into a project-local
`.claude/skills/CodeGraph/`.)

> 中文：克隆仓库后，把 `skill/CodeGraph/` 软链或复制到
> `~/.claude/skills/CodeGraph/`，或直接在目标项目内放置 `.claude/skills/`。

### Verify / 验证

```bash
node CodeGraph/skill/CodeGraph/scripts/_smoke-parser.mjs
node CodeGraph/skill/CodeGraph/scripts/_smoke-validate.mjs
```

Both should report all-pass.

---

## Usage / 使用

### Via Claude Code skill (recommended)

In any repo you want to analyze, just say:

> 用 CodeGraph 技能生成 X 流程的流程图 / 时序图

The agent will:

1. Ask you to pick an editor the first time (writes `.codegraph/config.json`).
2. Clarify scope with you (≤ 3 rounds).
3. Read your code and produce `graph.mmd` + `graph.locs.json`.
4. Validate, retry on errors, build the HTML.
5. Report the output path.

### Manual / 手动

```bash
node skill/CodeGraph/scripts/validate.mjs \
  --mmd path/to/graph.mmd \
  --locs path/to/graph.locs.json \
  --repo /path/to/your/repo

node skill/CodeGraph/scripts/build-html.mjs \
  --mmd path/to/graph.mmd \
  --locs path/to/graph.locs.json \
  --repo /path/to/your/repo \
  --out path/to/graph.html \
  --editor-config /path/to/your/repo/.codegraph/config.json
```

---

## Output structure / 输出结构

```
<repo>/.codegraph/
├── config.json                              # editor choice (auto-generated)
└── output/
    └── <YYYYMMDD-HHMM>-<topic-slug>/
        ├── graph.mmd                        # topology
        ├── graph.locs.json                  # file:line lookup
        └── graph.html                       # final single-page output
```

Each invocation produces a new timestamped subdirectory — history is
preserved, never overwritten.

---

## Supported editors / 支持的编辑器

Click-to-jump uses OS-level URL schemes (no helper app required).

| Editor | URL scheme | macOS out-of-box |
|---|---|---|
| VS Code | `vscode://file...` | ✅ |
| VS Code Insiders | `vscode-insiders://file...` | ✅ |
| Cursor | `cursor://file...` | ✅ |
| IntelliJ IDEA | `idea://open?...` | ✅ |
| PyCharm | `pycharm://open?...` | ✅ |
| WebStorm | `webstorm://open?...` | ✅ |
| GoLand / PhpStorm / Rider / CLion / RubyMine | `<product>://open?...` | ✅ |

**Not supported** (no native URL scheme): Sublime, Zed, Neovim, Vim, Trae.

> Safari shows a confirmation prompt on every click. Chrome / Firefox / Edge
> ask once and remember. Recommend Chrome for frictionless jumping.

---

## How it works / 工作原理

```
User request
    ↓
Agent reads code (NO ast-grep / auto-extraction)
    ↓
Produces graph.mmd (Mermaid subset) + graph.locs.json
    ↓
validate.mjs  ← parser + ID alignment + fs.existsSync
    ↓  (retry ≤ 3 rounds on failure)
build-html.mjs  ← parse + merge locs + inline templates
    ↓
graph.html (single file, offline, zero deps)
```

See [`docs/TECH_DESIGN.md`](docs/TECH_DESIGN.md) for the full design rationale
and [`docs/PRD.md`](docs/PRD.md) for product requirements.

---

## Project layout / 项目结构

```
CodeGraph/
├── skill/CodeGraph/
│   ├── SKILL.md                  # Agent instructions (English)
│   ├── scripts/
│   │   ├── mermaid-parser.mjs    # Strict Mermaid subset parser
│   │   ├── validate.mjs          # Schema + ID + path validator
│   │   ├── build-html.mjs        # Single-page HTML builder
│   │   ├── _smoke-parser.mjs     # Parser tests
│   │   ├── _smoke-validate.mjs   # Validator tests
│   │   ├── _browser-test.py      # Playwright render tests
│   │   ├── _interaction-test.py  # Playwright interaction tests
│   │   └── _click-pan-test.py    # Playwright click/pan tests
│   ├── template/
│   │   ├── page.html
│   │   ├── render.js             # SVG renderer + zoom/pan + click handler
│   │   └── styles.css
│   └── vendor/
│       └── dagre.min.js          # Bundled @dagrejs/dagre + graphlib (42KB)
├── docs/
│   ├── PRD.md
│   └── TECH_DESIGN.md
├── CLAUDE.md                     # Behavioral guidelines for the agent
├── LICENSE
└── README.md
```

---

## Limitations / 已知限制

- **Strict Mermaid subset only.** See `SKILL.md` §3 for the allow-list. This is
  intentional for parser simplicity and AI output reliability.
- **Browser → editor** via URL scheme only; cannot invoke CLI from a static
  HTML. Editors without a URL scheme are not supported.
- **Hover preview of code snippet** is intentionally omitted in v1.
- **History index page** is intentionally omitted — outputs are just files.

---

## Contributing

Issues and PRs welcome. Please run the smoke tests before submitting:

```bash
node skill/CodeGraph/scripts/_smoke-parser.mjs
node skill/CodeGraph/scripts/_smoke-validate.mjs
```

For browser-level changes, also run:

```bash
python3 skill/CodeGraph/scripts/_browser-test.py path/to/graph.html
```

---

## License

[MIT](LICENSE).
