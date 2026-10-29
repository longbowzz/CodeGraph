# DSH runtime contract (this section overrides the workflow below)

You are running inside DeepSeek Harness, and the `codegraph` plugin is installed.
Choose the workflow before doing anything else:

- **Graph** — draw a flowchart/sequence/architecture path:
  use `codegraph_build`; do **not** write `graph.mmd` / `graph.locs.json` and do
  **not** run the graph Node scripts described below.
- **CodeWalkthrough** — introduce/explain/teach a module or flow as a long-form interactive explainer:
  read `references/walkthrough.md`, ask the intake questions, read the code and
  tests, then use `codegraph_walkthrough_build`. Do **not** use
  `codegraph_build` for this workflow.

If the intent is ambiguous, ask one question: “你是想要一张流程图，还是一篇
可以交互阅读的讲解网页？”

### Graph workflow

1. Do **not** ask the user to choose an editor and do **not** write
   `.codegraph/config.json`. In Harness, clicking a graph node opens the exact
   source line in the side panel.
2. Do **not** create the output directory or compute a timestamp. The tool owns
   `.codegraph/output/<YYYYMMDD-HHMM>-<topic-slug>/`.
3. Put the Mermaid text in `mmd` and the location object in `locs`, then call:

   ```text
   codegraph_build({ topic, mmd, locs, review? })
   ```

   `review` is optional and is `{ base, head }` for diff-aware review mode
   (for example `{ "base": "HEAD", "head": "WORKTREE" }` or
   `{ "base": "pr/123", "head": "pr/123" }`).
4. On `ok: false`, read every `errors[].fix_hint`, fix the `mmd` or `locs`, and
   call `codegraph_build` again. At most 3 rounds; then stop and ask the user.
5. Use `codegraph_list` to find or reopen a graph generated earlier.
6. The rest of this document is the **semantic contract**: label rules, source
   locations, Mermaid support, edge identities, sequence message counts, and
   review-mode attribution. Follow it exactly. Where a later step tells you to
   write files or run `node`, replace that step with `codegraph_build`.

### CodeWalkthrough workflow

Use `codegraph_walkthrough_build({ topic, html, language?, audience?, scope?, repo? })`.

- `html` is a body fragment; sections with `class="cw-section"` become article sections. One section should make one point; the page scrolls vertically.
- Reference source with `data-source="file:line"` and empty
  `<div data-code="file:start-end"></div>` blocks; the tool extracts the code.
- Do not embed external scripts/styles/fonts/images.
- The tool writes
  `.codegraph/output/<YYYYMMDD-HHMM>-<topic-slug>/walkthrough.html` and
  `walkthrough.meta.json`, then runs the static self-check.
- On `ok: false`, read every error/fix hint, fix the content, and call again
  (at most 3 rounds). On `stage: "verify"`, the artifact exists but failed the
  check; fix it before showing it to the user.
- Then inspect the article in a browser (and in DSH when possible) and run the
  runtime self-check (`window.__cwCheck()`).

Only if `codegraph_build` is unavailable should you fall back to the graph
script workflow described in the rest of this document. If
`codegraph_walkthrough_build` is unavailable, fall back to
`<SKILL_DIR>/scripts/build-walkthrough.mjs` and `verify-walkthrough.mjs`.
