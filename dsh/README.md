# CodeGraph for DeepSeek Harness

[English](README.md) · [中文](README.zh-CN.md)

This bundle turns [CodeGraph](../README.md) into a Harness capability:

- **Skill** — `codegraph` teaches the agent the Mermaid + source-location contract.
- **Tools** — `codegraph_build` validates and builds a graph in one call;
  `codegraph_walkthrough_build` builds an explainer; `codegraph_list` finds
  earlier artifacts of both kinds.
- **Chat card** — every build reports its topic, diagram kinds, stats, and
  validation errors, with a button that opens the graph.
- **Graph tab** — generated `.codegraph/output/**/graph.html` files open in a
  dedicated right-Sidebar tab. Clicking a node, edge, sequence message, or
  actor opens the exact source line in the Harness source preview, preferably
  in a second pane.
- **CodeWalkthrough** — the same CodeGraph skill can also build an interactive
  long-form explainer. `codegraph_walkthrough_build` writes
  `.codegraph/output/**/walkthrough.html`; the page has sections, inline
  SVG/CSS/JS, source links, and a collapsible browser source pane. In DSH the
  source link opens the Harness code pane instead.

## Install

Requires Node.js 18+ and DSH 0.2.x. Install the published bundle into the
profile you actually boot — DSH profiles are isolated:

```bash
# Desktop app (normally the desktop profile)
dsh plugin --profile desktop add -w @longbowzz/dsh-codegraph

# Web (dsh web, which uses the web profile)
dsh plugin --profile web add -w @longbowzz/dsh-codegraph
```

`--profile web` does not affect the Desktop app. The `-w` flag adds the bundle
to the profile's workspace root; pnpm requires it on some DSH builds.

For local development, install the repository checkout instead (use the same
profile name you boot):

```bash
dsh plugin --profile desktop add -w /absolute/path/to/CodeGraph
```

After installing, quit and reopen DSH and start a new session; bundles and
client tabs load at boot. Verify that `dependencies` and `dsh.profile.bundles`
in `~/.dsh/profiles/<name>/package.json` include the package.

The package includes `skills/codegraph` (scripts, template, and vendored
Mermaid), so no separate checkout is needed at runtime. If the skill, tools, or
graph tab do not appear, restart DSH and start a new session.

The plugin writes only under `<workspace>/.codegraph/` and refuses a `repo`
outside the session workspace.

## Use

Ask the agent to draw a flow, for example:

> Use CodeGraph to draw the login flow as a sequence diagram.

The agent loads `codegraph`, reads the code, and calls `codegraph_build` with
the Mermaid text and the location table. The resulting card opens the graph.
Review mode uses `review: { base, head }`.

Clicking a node, edge, message, or actor opens the **current source** at that
line. DSH's native changed-files review tab is turn-scoped and is not opened per
graph element; use the separate changes review when you need a diff.

For an explainer instead of a diagram:

> Use CodeGraph to explain the refund flow as an interactive webpage.

CodeWalkthrough asks the intake questions first, including whether to add a
3–5 question self-test, reads the relevant code and tests, then calls
`codegraph_walkthrough_build` with a free-form HTML body fragment and source
references. If requested, the quiz sits at the end with click-to-reveal or
multiple-choice answers. The tool embeds the actual source, assembles the shell,
and runs the static self-check before returning. The content remains objective
only when the agent uses the evidence table and the runtime check in
`window.__cwCheck()`.

## Layout

```text
dsh/
├── index.js             Host: skill + tools
├── client.js            Web: result cards + graph/walkthrough tabs
├── lib/build.js         graph validation/build/list pipeline
├── lib/walkthrough.js   walkthrough invocation + self-check wrapper
├── skill-adapter.md     DSH runtime overrides prepended to SKILL.md
├── cordis.patch.yml     bundle row
├── locale/{en,zh}.json  plugin-manager metadata
└── icon.svg
```

The graph renderer is shared with the standalone skill. It gains a sandbox-safe
`localStorage` guard, persistent selection (clicking blank canvas clears it),
and a one-row header with a truncated topic. DSH-specific hooks are gated by
`#dsh`: a `postMessage` bridge, a presentation mode that hides the in-page Web
code pane, editor picker, and workspace path while the file is framed by the
graph tab, and a file/function/line card at the graph's right edge. A standalone
browser renders neither the card nor the ruler, and keeps its Web code pane.

CodeWalkthrough has its own shell under
`../skills/codegraph/template/walkthrough/`. It embeds the referenced source
into a single HTML file so the browser pane works offline; in DSH the shell
hides that pane and posts `codewalk.navigate` to the tab. Its workflow contract
is `../skills/codegraph/references/walkthrough.md`.
