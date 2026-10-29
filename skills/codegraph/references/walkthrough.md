# CodeWalkthrough — the second CodeGraph workflow

This file is loaded only when the user wants an explanation, not a diagram.
It is part of the `codegraph` skill; CodeWalkthrough is a named capability, not
a separate skill or installation.

## 1. Choose this workflow when

The user asks for any of:

- "介绍 / 讲解 / 科普 / 说明 / 教程 / 原理 / 深入理解"
- "写一个网页介绍 / 做一个讲解页面 / 生成一个学习页面"
- "用 CodeGraph 为我介绍 XX 流程"
- "用 CodeGraph 写一个网页介绍 XXX 模块"

Do **not** use it when the user asks for a flowchart, sequence diagram,
architecture graph, or PR-as-diagram. That is the graph workflow in `SKILL.md`.

If the intent is ambiguous, ask exactly one question:

> 你是想要一张流程图，还是一篇可以交互阅读的讲解网页？

## 2. Ask before reading code

Ask at most **five** questions, with options and room for free text. Skip
anything the user already answered. Never ask about the host environment;
detect it.

1. **Familiarity** — completely new to the domain / heard the concepts / can
   read the code but not the business / wants deep internals.
2. **Goal** — quick overview / prepare to change code / debug / technical
   research / teach or share.
3. **Scope** — one module / one end-to-end flow / one file or class / custom.
4. **Depth** — 5-minute overview / 20-minute systematic tour / deep principles
   and edge cases.
5. **Self-test** — add 3–5 questions at the end? Options: yes / no / only open
   questions. Ask this explicitly; do not add a quiz by default.

Language: use the user's usual chat language. If the user explicitly asks for a
language, use that. Do not ask a language question when it is already clear.

Before reading code, confirm the learning contract in one short paragraph:

> 读者：会 Web 开发但不熟支付清结算；范围：退款入口到账务；目标：能讲清主流程和幂等；深度：20 分钟；自测：要 3 道；语言：中文。

## 3. Read code first, then write

Do not start the article before the evidence is collected.

Read:

- the target module and its entry points;
- direct callers and callees;
- tests and fixtures (behavioral evidence);
- config, schemas, migrations, feature flags;
- README/docs/ADRs if they exist;
- git history only for *why*, never as a substitute for current behavior.

Build an evidence table:

```text
claim / source (file:line) / observed or inferred / confidence
```

Rules:

- Never invent business rules, SLAs, actors, or historical reasons.
- If the repo does not contain the business context, ask the user or mark it
  explicitly as an assumption.
- Distinguish "the code does X" from "X is intended to happen".
- If the code is ambiguous, say so; do not smooth it over with general knowledge.
- Use tests as evidence for behavior, but read them critically.

After reading, produce a **section outline** of 5–8 sections and confirm it with
the user only if the scope is large or ambiguous. Otherwise proceed.

## 4. Long-form explainer, not a slide deck

This is a vertically scrolling, visually rich article — like a good engineering
deep dive. It is **not** a slide deck: sections may be longer than one screen,
and the reader controls the pace by scrolling.

A good default sequence:

1. **Hero** — file/scope chip, one-sentence thesis, one lead paragraph, 2–3
   proof cards or stats.
2. **Big picture** — one pipeline / architecture diagram; where this module sits.
3. **Running example** — one real request/task, stepped through visually.
4. **Mechanism 1** — diagram/chart + explanation + code anchor.
5. **Mechanism 2** — same; one idea per section.
6. **Boundaries** — failure modes, edge cases, tradeoffs; cards or comparison.
7. **Recap / quiz** — three takeaways; if requested, 3–5 self-test questions.

Hard rules:

- **One idea per section.** If you need two headlines, make two sections.
- **Visual first.** Prefer a diagram, chart, pipeline, comparison, table, or code
  panel to a wall of paragraphs. A section that is only prose is a failure.
- **The visual carries the explanation.** Labels on the visual should do most of
  the work; prose is the narration.
- **Paragraphs stay short.** Usually 1–4 paragraphs per block, with a heading or
  visual between them. No nested bullet walls.
- **One running example.** Reuse it across sections; do not switch examples.
- **No slide gimmicks.** No page-flip navigation, no 16:9 stage, no hiding
  content behind pagination. The page scrolls normally.
- **Code is an exhibit.** Keep excerpts short; highlight one idea; link to the
  full source with `data-source`.
- **Optional quiz at the end.** Only when the user asked for it; 3–5 questions
  that test understanding, not trivia.

## 5. Write the article HTML

The content is a **body fragment**; the builder wraps it in the article shell.
You may write arbitrary HTML, SVG, CSS, and inline JavaScript, but:

- no external scripts, stylesheets, fonts, images, or CDNs;
- no build step or network calls at view time;
- use inline SVG/CSS/JS for diagrams and animation;
- keep animation purposeful, pausable/steppable where it matters, and respect
  `prefers-reduced-motion`.

Use sections as direct children of the content:

```html
<section class="cw-hero cw-section" id="overview" data-title="总览">
  <div class="cw-file">src/payments/refund.ts · 420 lines</div>
  <h1>把 <em>退款</em> 变成一条可追踪的状态链</h1>
  <p class="cw-lead">一句 thesis；读者为什么应该继续往下看。</p>
  <div class="cw-cards cw-c3">
    <div class="cw-card"><span class="cw-card-tag">input</span><h3>...</h3><p>...</p></div>
    ...
  </div>
</section>

<section class="cw-section" id="big-picture" data-title="全局位置">
  <p class="cw-kicker">01 · Big picture</p>
  <h2>它在整条链路上的位置</h2>
  <p>1–2 段短解释。</p>
  <div class="cw-pipeline">...</div>
  <div class="cw-note">关键分界。</div>
</section>
```

The shell provides these layout helpers; use them before inventing new ones:

- `.cw-hero`, `.cw-file`, `.cw-lead`, `.cw-em`, `.cw-kicker`.
- `.cw-cards` + `.cw-c2/.cw-c3` + `.cw-card` + `.cw-card-tag`.
- `.cw-pipeline` + `.cw-step` + `.cw-step-n/t/s` — process stages.
- `.cw-split` + `.cw-visual` / `.cw-chart` — visual and points side by side.
- `.cw-points` + `.cw-point` — 2–4 numbered takeaways.
- `.cw-stat-row` + `.cw-stat` — 2–3 proof numbers.
- `.cw-note`, `.cw-warn`, `.cw-pit` — blue / amber / violet callouts.
- `.cw-tblwrap` + a normal `<table>` — comparison tables.
- `.cw-code` — the builder fills it from `data-code`.
- `.cw-quiz`, `.cw-q`, `.cw-q-opt`, `.cw-q-fb`, `.cw-reveal`, `.cw-answer` —
  optional self-test.
- `.cw-muted`, `.cw-small`.

If there are no `.cw-section` sections, the shell treats the whole content as
one section. A section id must be unique. `.cw-page` / `.cw-slide` are accepted
for older content, but new content must use `.cw-section`.

Navigation is a sticky section nav with anchor links and normal vertical
scrolling. The shell also shows a reading-progress bar. In DSH, section links
preserve the bridge token; source links open the host pane. Do not add page-turn
swipes or a deck pager.

### Source links

Use `data-source="file:line"` on any element. The shell opens the source pane in
a browser, or the host code pane in DSH:

```html
<a href="#" data-source="src/payments/refund.ts:42">refund.ts:42</a>
```

Use `data-code` on an empty `<div>` to have the builder extract the actual
source (never hand-copy code):

```html
<div data-code="src/payments/refund.ts:38-64"></div>
```

The builder replaces it with a figure containing the real lines and an "open
source" action. Do not invent or paraphrase code inside `data-code`; the builder
owns extraction.

Optional metadata is passed on the build command/tool, not in the HTML:
`topic`, `language`, `audience`, `scope`.

### Self-test (only when requested)

If the intake says yes, add 3–5 questions at the end. Use multiple choice with
an explanation, or open questions with a reveal. The shell handles the click
behavior; do not write custom quiz JavaScript.

Multiple choice:

```html
<div class="cw-quiz">
  <div class="cw-q" data-answer="b">
    <div class="cw-q-title">Q1. ...</div>
    <div class="cw-q-opts">
      <button type="button" class="cw-q-opt" data-opt="a">A. ...</button>
      <button type="button" class="cw-q-opt" data-opt="b">B. ...</button>
      <button type="button" class="cw-q-opt" data-opt="c">C. ...</button>
    </div>
    <div class="cw-q-fb"><strong>答案：B。</strong>解释为什么，并给出源码/测试依据。</div>
  </div>
</div>
```

Open question:

```html
<div class="cw-q">
  <div class="cw-q-title">Q2. 用自己的话解释 ...</div>
  <button type="button" class="cw-reveal" data-reveal="q2-answer">查看答案</button>
  <div class="cw-answer" id="q2-answer" hidden><strong>参考：</strong>...</div>
</div>
```

Questions must test causal understanding, not trivia. Answers should explain
why and, where possible, link to a source line.

### Style hooks

The shell provides reading typography and the classes above. You may add your
own `<style>` for section-specific presentation.

## 6. Recommended stack (suggestions, not mandates)

The shell is vanilla HTML/CSS/JS and single-file. Start with **no framework**;
the shell already owns sections, sticky navigation, source links, and the source
drawer. Add technology only when the content needs it.

| Need | Default | Upgrade, if justified |
|---|---|---|
| Article layout | CSS grid/flex + inline HTML | — |
| Diagram / flow | hand-authored inline SVG | D3 for data-driven diagrams |
| Chart | inline SVG / CSS bars | D3 for complex charts |
| Stateful widget | vanilla JS + event delegation | Preact + htm, or Alpine.js |
| Timeline animation | CSS transitions/keyframes | Web Animations API |
| Complex choreography | WAAPI + step controls | GSAP/Motion One, vendored inline |
| Icons | inline SVG | — |
| Fonts | system font stack | — |

Guidance:

- **No external dependencies by default.** No CDN, no external fonts, no icon
  fonts, no remote images. If a library is genuinely needed, vendor a small
  build inline and keep the artifact single-file.
- **Framework:** avoid React/Vue build toolchains for a single HTML artifact.
  Preact + htm (~4 KB) is the pragmatic step up for several stateful widgets;
  Alpine.js is fine for small declarative interactions. The default is vanilla.
- **Drawing:** hand-authored SVG is best for 2–10 nodes, pipelines, state
  machines, and annotated diagrams. Use D3 only when the geometry is genuinely
  data-driven. Avoid canvas chart libraries: they are harder to style, inspect,
  and make accessible. Do not add Mermaid unless a renderer is already present
  in the artifact.
- **Animation:** use CSS for reveals and state transitions; WAAPI for a
  multi-step sequence with pause/step; a timeline library only when the
  choreography is complex enough to justify it. Every meaningful animation must
  be pausable/steppable and must degrade under `prefers-reduced-motion`.
  Animation should reveal state, data flow, or causality, not decorate.
- **One visual per section.** If a section needs a second chart, split it.
- **Keep sections readable.** A section can be longer than one screen, but if
  it becomes a wall of text, split it or add a visual.
- **Do not add a quiz by default.** It is opt-in from the intake; when present,
  put it at the end and keep it to 3–5 questions.

Agents may choose another approach when the situation warrants it, but must
keep the no-CDN / single-file / reduced-motion constraints and explain the
tradeoff in the delivery summary.

## 7. Build

In a normal skill environment (Claude Code, Codex, manual):

```bash
node <SKILL_DIR>/scripts/build-walkthrough.mjs \
  --content /path/to/content.html \
  --repo /path/to/repo \
  --topic "退款流程" \
  --language zh \
  --audience "会 Web 开发但不熟支付" \
  --scope "退款入口到账务"
```

A small committed fixture lives at `examples/walkthrough-sample.html`; use it to
check the shell, source pane, and verifier without writing new content.

Output goes to `<repo>/.codegraph/output/<YYYYMMDD-HHMM>-<slug>/`:

- `walkthrough.html` — the deliverable;
- `walkthrough.meta.json` — kind, section metadata, sources, language, commit;
- `walkthrough.content.html` — the authored fragment, for regeneration.

In DSH, use the `codegraph_walkthrough_build` tool with `{ topic, html,
language?, audience?, scope?, repo? }` instead of running the script.

## 8. Self-check before delivery

Run:

```bash
node <SKILL_DIR>/scripts/verify-walkthrough.mjs \
  --file <walkthrough.html> --repo /path/to/repo
```

Then inspect the article in a browser (and in DSH when available):

- every section is reachable from the sticky nav; anchor links work;
- every source link opens the correct file/line in the source pane;
- in DSH, a source link opens the host code pane and the in-page pane is hidden;
- no console errors, no horizontal overflow, no missing assets;
- animations can be paused/stepped and reduced motion is respected;
- `window.__cwCheck()` returns `ok: true`; fix every error.

Also review the content against the evidence table:

- every key claim is supported by code/tests/docs or marked as an assumption;
- code blocks come from the builder and match current source;
- no invented business context, no contradictory explanations;
- the order is progressive: why → big picture → running example → mechanisms → boundaries → recap.

Deliver only after the technical and content checks pass. Report the output path
and a short summary; do not claim checks you did not run.

## 9. Delivery

Tell the user:

- the absolute path to `walkthrough.html`;
- the section count and source count;
- that it opens standalone in a browser, and in DSH the source links use the
  DSH code pane;
- that the artifact is generated from the current checkout, so it should be
  regenerated after major code changes.
