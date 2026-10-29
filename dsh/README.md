# CodeGraph for DeepSeek Harness

This bundle turns [CodeGraph](../../README.md) into a Harness capability:

- **Skill** — `codegraph` teaches the agent the Mermaid + source-location contract.
- **Tools** — `codegraph_build` validates and builds a graph in one call;
  `codegraph_list` finds earlier artifacts.
- **Chat card** — every build reports its topic, diagram kinds, stats, and
  validation errors, with a button that opens the graph.
- **Graph tab** — generated `.codegraph/output/**/graph.html` files open in a
  dedicated right-Sidebar tab. Clicking a node or edge opens the exact source
  line in the Harness source preview, preferably in a second pane.

## Install

From the CodeGraph repository root:

```text
plugin_manager install_bundle <absolute path to this dsh/ directory>
```

The bundle is installed as a linked local package, so it reuses
`../skill/CodeGraph` in place (scripts, template, and vendored Mermaid). Moving
or deleting the CodeGraph checkout requires reinstalling the bundle.

The plugin writes only under `<workspace>/.codegraph/` and refuses a `repo`
outside the session workspace.

## Use

Ask the agent to draw a flow, for example:

> 画一下登录流程的时序图，用 CodeGraph。

The agent loads `codegraph`, reads the code, and calls `codegraph_build` with
the Mermaid text and the location table. The resulting card opens the graph.
Review mode uses `review: { base, head }`.

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

The renderer itself is unchanged except for backward-compatible hooks in
`skill/CodeGraph/template/render.js`: a sandbox-safe `localStorage` guard, a
`#dsh=<token>` `postMessage` bridge, and a DSH presentation mode that hides the
in-page Web code pane, editor picker, and workspace path while the file is
framed by the graph tab; the header stays one row high with a truncated topic. Clicking a node or edge also shows a DSH-only file/function/line card at the graph's right edge; a standalone browser renders neither the card nor the ruler. The same HTML still opens normally in a browser, with the Web code pane.
