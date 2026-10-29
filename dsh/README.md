# CodeGraph for DeepSeek Harness

This bundle turns [CodeGraph](../../README.md) into a Harness capability:

- **Skill** — `codegraph` teaches the agent the Mermaid + source-location contract.
- **Tools** — `codegraph_build` validates and builds a graph in one call;
  `codegraph_list` finds earlier artifacts.
- **Chat card** — every build reports its topic, diagram kinds, stats, and
  validation errors, with a button that opens the graph.
- **Graph tab** — generated `.codegraph/output/**/graph.html` files open in a
  dedicated right-Sidebar tab. Clicking a node, edge, sequence message, or
  actor opens the exact source line in the Harness source preview, preferably
  in a second pane.

## Install

Requires Node.js 18+ and a DSH build with plugin-manager support. In DSH, ask
the agent to install this local bundle:

> Install the CodeGraph plugin bundle from `/absolute/path/to/CodeGraph/dsh`.

The agent performs this with the plugin manager
(`plugin_manager install_bundle /absolute/path/to/CodeGraph/dsh`). The bundle is
installed as a linked local package, so it reuses `../skill/CodeGraph` in place
(scripts, template, and vendored Mermaid). Keep the CodeGraph checkout in place;
moving or deleting it requires reinstalling the bundle. If the skill, tools, or
graph tab do not appear, reload the DSH page.

The plugin writes only under `<workspace>/.codegraph/` and refuses a `repo`
outside the session workspace.

## Use

Ask the agent to draw a flow, for example:

> Use CodeGraph to draw the login flow as a sequence diagram.

> 画一下登录流程的时序图，用 CodeGraph。

The agent loads `codegraph`, reads the code, and calls `codegraph_build` with
the Mermaid text and the location table. The resulting card opens the graph.
Review mode uses `review: { base, head }`.

Clicking a node, edge, message, or actor opens the **current source** at that
line. DSH's native changed-files review tab is turn-scoped and is not opened per
graph element; use the separate changes review when you need a diff.

## Layout

```text
dsh/
├── index.js             Host: skill + tools
├── client.js            Web: result card + graph tab
├── lib/build.js         validation/build/list pipeline
├── skill-adapter.md     DSH runtime overrides prepended to SKILL.md
├── cordis.patch.yml     bundle row
├── locale/{en,zh}.json  plugin-manager metadata
└── icon.svg
```

The renderer is shared with the standalone skill. It gains a sandbox-safe
`localStorage` guard, persistent selection (clicking blank canvas clears it),
and a one-row header with a truncated topic. DSH-specific hooks are gated by
`#dsh`: a `postMessage` bridge, a presentation mode that hides the in-page Web
code pane, editor picker, and workspace path while the file is framed by the
graph tab, and a file/function/line card at the graph's right edge. A standalone
browser renders neither the card nor the ruler, and keeps its Web code pane.
The same HTML still opens normally in a browser.
