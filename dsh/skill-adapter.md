# DSH runtime contract (this section overrides the workflow below)

You are running inside DeepSeek Harness, and the `codegraph` plugin is installed.
Use the `codegraph_build` tool; do **not** write `graph.mmd` / `graph.locs.json`
and do **not** run the Node scripts described below.

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

Only if `codegraph_build` is unavailable should you fall back to the script
workflow described in the rest of this document.
