// render.js — inlined into the final HTML.
// Reads graph data from <script id="cg-data">, renders flowchart and/or sequence
// diagrams as SVG, wires up tabs, editor dropdown, zoom/pan, hover, click-to-jump.
(function () {
  'use strict';

  const data = JSON.parse(document.getElementById('cg-data').textContent);
  const repo = data.repo;
  const editors = {
    // Absolute path p starts with '/'. The VS Code / Cursor / Insiders URL form
    // is `<scheme>://file<path>:<line>` — 'file' is the host, <path> begins with
    // the leading slash of the absolute path. Do NOT add another slash between
    // 'file' and p, otherwise VS Code sees '//tmp/...' and misinterprets it.
    'vscode':           { label: 'VS Code',         url: (p, l) => `vscode://file${p}:${l}` },
    'vscode-insiders':  { label: 'VS Code Insiders', url: (p, l) => `vscode-insiders://file${p}:${l}` },
    'cursor':           { label: 'Cursor',           url: (p, l) => `cursor://file${p}:${l}` },
    // JetBrains uses a query-string form: file=<absolute path>.
    'idea':             { label: 'IntelliJ IDEA',    url: (p, l) => `idea://open?file=${encodeURIComponent(p)}&line=${l}` },
    'pycharm':          { label: 'PyCharm',          url: (p, l) => `pycharm://open?file=${encodeURIComponent(p)}&line=${l}` },
    'webstorm':         { label: 'WebStorm',         url: (p, l) => `webstorm://open?file=${encodeURIComponent(p)}&line=${l}` },
    'goland':           { label: 'GoLand',           url: (p, l) => `goland://open?file=${encodeURIComponent(p)}&line=${l}` },
    'phpstorm':         { label: 'PhpStorm',         url: (p, l) => `phpstorm://open?file=${encodeURIComponent(p)}&line=${l}` },
    'rider':            { label: 'Rider',            url: (p, l) => `rider://open?file=${encodeURIComponent(p)}&line=${l}` },
    'clion':            { label: 'CLion',            url: (p, l) => `clion://open?file=${encodeURIComponent(p)}&line=${l}` },
    'rubymine':         { label: 'RubyMine',         url: (p, l) => `rubymine://open?file=${encodeURIComponent(p)}&line=${l}` },
    // `web` opens source in an in-page code pane (right side of the canvas).
    // No URL scheme — clicking a node routes through showCodeInPane() below.
    'web':              { label: 'Web',              inPage: true },
  };

  // ---- Safari detection (for banner) ----
  if (/^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)) {
    document.body.classList.add('safari');
  }

  // ---- Editor selector ----
  let currentEditor = localStorage.getItem('cg-editor') || data.editor?.id || 'vscode';
  if (!editors[currentEditor]) currentEditor = 'vscode';

  const editorSel = document.getElementById('editor-select');
  for (const [id, e] of Object.entries(editors)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = e.label;
    if (id === currentEditor) opt.selected = true;
    editorSel.appendChild(opt);
  }
  editorSel.addEventListener('change', () => {
    currentEditor = editorSel.value;
    localStorage.setItem('cg-editor', currentEditor);
    applyWebMode();
  });

  // Toggle the in-page code pane on/off based on current editor.
  function applyWebMode() {
    const on = editors[currentEditor]?.inPage === true;
    document.body.classList.toggle('cg-web-mode', on);
  }
  applyWebMode();

  // ---- Topic / header ----
  document.getElementById('topic').textContent = data.topic || '(untitled)';
  document.getElementById('repo').textContent = repo;

  // ---- Build absolute path ----
  function absPath(rel) {
    // rel uses forward slashes; repo is the repo root.
    if (!repo) return rel;
    return repo.replace(/\/$/, '') + '/' + rel;
  }

  function jumpTo(loc) {
    if (!loc) return;
    // locs are stored as [file, line] arrays; accept both forms defensively.
    const file = Array.isArray(loc) ? loc[0] : loc.file;
    const line = Array.isArray(loc) ? loc[1] : loc.line;
    if (!file || !line) return;
    if (editors[currentEditor].inPage) {
      showCodeInPane(file, line);
      return;
    }
    const p = absPath(file);
    const url = editors[currentEditor].url(p, line);
    // Test hook: expose last URL for headless verification (no navigation in tests).
    if (window.__cg_captureUrl) { window.__cg_lastUrl = url; return; }
    window.location.href = url;
  }

  // ============================================================
  // MERMAID RENDERING
  // ============================================================
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function flowEdgeLoc(fc, id, from, to) {
    if (fc.edgeLocs !== undefined) return fc.edgeLocs[id];
    return fc.locs?.[from] || fc.locs?.[to];
  }

  function inferEdgeDiff(a, b) {
    const order = { added: 4, removed: 3, modified: 2, unchanged: 1 };
    const ax = a && order[a.diff] ? a.diff : null;
    const bx = b && order[b.diff] ? b.diff : null;
    if (!ax && !bx) return null;
    return (ax && order[ax] || 0) >= (bx && order[bx] || 0) ? ax : bx;
  }

  function diagramSource(name, diagram) {
    if (typeof diagram.source !== 'string') throw new Error(`Missing Mermaid source for ${name}`);
    return diagram.source;
  }

  function addClass(el, className) {
    const classes = new Set((el.getAttribute('class') || '').split(/\s+/).filter(Boolean));
    classes.add(className);
    el.setAttribute('class', [...classes].join(' '));
  }

  function addHitPath(path, className) {
    const hit = path.cloneNode(false);
    hit.removeAttribute('id');
    hit.removeAttribute('style');
    hit.removeAttribute('data-cg-edge');
    hit.removeAttribute('marker-start');
    hit.removeAttribute('marker-end');
    hit.setAttribute('class', className);
    path.parentNode.insertBefore(hit, path);
  }

  function viewBoxBounds(root) {
    const parts = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) {
      throw new Error('Mermaid returned SVG without a valid viewBox');
    }
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }

  function markEdgeGroup(el, fc, edgeById, edgeGroups) {
    const id = el.getAttribute('data-cg-edge');
    if (el.localName === 'path') {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('data-cg-edge', id);
      el.parentNode.insertBefore(group, el);
      group.appendChild(el);
      el.removeAttribute('data-cg-edge');
      el = group;
    }
    const edge = edgeById.get(id);
    if (!edge) throw new Error(`Mermaid returned an unknown edge marker: ${id || '(empty)'}`);
    const [from, to] = JSON.parse(id);
    const loc = flowEdgeLoc(fc, id, from, to);
    const locs = fc.locs || {};
    const nodeById = new Map((fc.nodes || []).map(node => [node.id, node]));
    const fromNode = nodeById.get(from);
    const toNode = nodeById.get(to);
    const fromDiff = fromNode?.diff || locs[from]?.[2];
    const toDiff = toNode?.diff || locs[to]?.[2];
    const diff = edge.diff || loc?.[2] || inferEdgeDiff({ diff: fromDiff }, { diff: toDiff });

    addClass(el, 'cg-edge');
    el.setAttribute('data-edge-id', id);
    el.setAttribute('data-from', from);
    el.setAttribute('data-to', to);
    el.setAttribute('data-location-kind', fc.edgeLocs !== undefined ? 'exact' : 'approximate');
    el.setAttribute('data-loc', loc ? 'true' : 'false');
    if (diff) el.setAttribute('data-diff', diff);
    else el.removeAttribute('data-diff');
    if (!edgeGroups.has(id)) edgeGroups.set(id, []);
    edgeGroups.get(id).push(el);

    const linePaths = [...el.querySelectorAll('path[d]')];
    for (const path of linePaths) {
      addClass(path, 'cg-edge-line');
      addHitPath(path, 'cg-edge-hit');
    }
    if (el.querySelector('text, foreignObject')) {
      for (const rect of el.querySelectorAll('rect')) addClass(rect, 'cg-edge-label-bg');
    }
    return linePaths.length;
  }

  function decorateFlowchart(root, fc) {
    const nodeById = new Map((fc.nodes || []).map(node => [node.id, node]));
    const seenNodes = new Set();
    for (const el of root.querySelectorAll('[data-cg-node]')) {
      const id = el.getAttribute('data-cg-node');
      const node = nodeById.get(id);
      if (!node || seenNodes.has(id)) throw new Error(`Missing or duplicate Mermaid node marker: ${id || '(empty)'}`);
      seenNodes.add(id);
      const loc = fc.locs?.[id];
      addClass(el, 'cg-node');
      el.setAttribute('data-id', id);
      el.setAttribute('data-shape', node.shape || 'normal');
      el.setAttribute('data-loc', loc ? 'true' : 'false');
      const diff = node.diff || loc?.[2];
      if (diff) el.setAttribute('data-diff', diff);
      else el.removeAttribute('data-diff');
    }
    for (const id of nodeById.keys()) {
      if (!seenNodes.has(id)) throw new Error(`Missing Mermaid node marker: ${id}`);
    }

    const edgeById = new Map((fc.edges || []).map(edge => [edge.id, edge]));
    const seenEdges = new Set();
    const edgeGroups = new Map();
    const lineCounts = new Map();
    for (const el of root.querySelectorAll('[data-cg-edge]')) {
      const id = el.getAttribute('data-cg-edge');
      if (!edgeById.has(id)) throw new Error(`Missing or unknown Mermaid edge marker: ${id || '(empty)'}`);
      seenEdges.add(id);
      lineCounts.set(id, lineCounts.get(id) || 0);
      lineCounts.set(id, lineCounts.get(id) + markEdgeGroup(el, fc, edgeById, edgeGroups));
    }
    for (const id of edgeById.keys()) {
      if (!seenEdges.has(id) || !lineCounts.get(id)) throw new Error(`Missing Mermaid edge marker or line: ${id}`);
    }
    for (const groups of edgeGroups.values()) {
      for (const el of groups) {
        el.addEventListener('pointerenter', () => {
          for (const group of groups) group.classList.add('cg-edge-hover');
        });
        el.addEventListener('pointerleave', event => {
          const relatedEdge = event.relatedTarget?.closest?.('.cg-edge[data-edge-id]');
          if (relatedEdge && groups.includes(relatedEdge)) return;
          for (const group of groups) group.classList.remove('cg-edge-hover');
        });
      }
    }
  }

  function decorateSequence(root, sq) {
    const actorById = new Map((sq.actors || []).map(actor => [actor.id, actor]));
    const seenActors = new Set();
    for (const el of root.querySelectorAll('[data-cg-actor]')) {
      const id = el.getAttribute('data-cg-actor');
      const actor = actorById.get(id);
      if (!actor) throw new Error(`Unknown Mermaid actor marker: ${id || '(empty)'}`);
      seenActors.add(id);
      const loc = sq.locs?.actors?.[id];
      addClass(el, 'cg-actor');
      el.setAttribute('data-id', id);
      el.setAttribute('data-loc', loc ? 'true' : 'false');
      const diff = actor.diff || loc?.[2];
      if (diff) el.setAttribute('data-diff', diff);
      else el.removeAttribute('data-diff');
    }
    for (const id of actorById.keys()) {
      if (!seenActors.has(id)) throw new Error(`Missing Mermaid actor marker: ${id}`);
    }

    const messages = sq.messages || [];
    const seenMessages = new Set();
    for (const el of root.querySelectorAll('[data-cg-message]')) {
      const rawIndex = el.getAttribute('data-cg-message');
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 0 || index >= messages.length || seenMessages.has(index)) {
        throw new Error(`Missing or duplicate Mermaid message marker: ${rawIndex || '(empty)'}`);
      }
      seenMessages.add(index);
      const message = messages[index];
      const loc = sq.locs?.messages?.[index];
      addClass(el, 'cg-msg');
      el.setAttribute('data-idx', String(index));
      el.setAttribute('data-loc', loc ? 'true' : 'false');
      if (message.style === 'return') addClass(el, 'cg-return');
      if (message.style === 'async') addClass(el, 'cg-async');
      const diff = message.diff || loc?.[2];
      if (diff) el.setAttribute('data-diff', diff);
      else el.removeAttribute('data-diff');
      for (const path of el.querySelectorAll('path[d], line')) {
        addClass(path, 'cg-msg-line');
        addHitPath(path, 'cg-msg-hit');
      }
    }
    for (let i = 0; i < messages.length; i++) {
      if (!seenMessages.has(i)) throw new Error(`Missing Mermaid message marker: ${i}`);
    }
  }

  async function renderDiagram(name, diagram, svg, theme) {
    if (!window.CodeGraphMermaid || typeof window.CodeGraphMermaid.render !== 'function') {
      throw new Error('CodeGraph Mermaid adapter is unavailable');
    }
    const result = await window.CodeGraphMermaid.render(`cg-${name}`, diagramSource(name, diagram), {
      theme,
      securityLevel: 'strict',
    });
    const markup = typeof result === 'string' ? result : result?.svg;
    if (typeof markup !== 'string') throw new Error('Mermaid adapter returned no SVG');
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    let root = parsed.documentElement;
    if (!root || root.localName !== 'svg' || parsed.querySelector('parsererror')) {
      const html = new DOMParser().parseFromString(markup, 'text/html');
      root = html.querySelector('svg');
    }
    if (!root || root.localName !== 'svg') throw new Error('Mermaid adapter returned invalid SVG');
    const bbox = viewBoxBounds(root);
    if (name === 'flowchart') decorateFlowchart(root, diagram);
    else decorateSequence(root, diagram);

    const viewport = document.createElementNS(SVG_NS, 'g');
    viewport.setAttribute('class', 'cg-viewport');
    if (root.id) viewport.id = root.id;
    const rootClass = root.getAttribute('class');
    if (rootClass) for (const className of rootClass.split(/\s+/).filter(Boolean)) addClass(viewport, className);
    while (root.firstChild) viewport.appendChild(document.adoptNode(root.firstChild));
    svg.replaceChildren(viewport);
    return { viewport, bbox };
  }

  // Review-mode diff legend. Renders inside #cg-diff-legend only when
  // data.review is present. Shows four color swatches: added, modified,
  // removed, unchanged.
  function renderLegend() {
    if (!data.review) return;
    const el = document.getElementById('cg-diff-legend');
    if (!el) return;
    const items = [
      { status: 'added', label: 'added' },
      { status: 'modified', label: 'modified' },
      { status: 'removed', label: 'removed' },
      { status: 'unchanged', label: 'unchanged' },
    ];
    for (const { status, label } of items) {
      const row = document.createElement('div');
      row.className = 'cg-legend-item';
      const swatch = document.createElement('span');
      swatch.className = `cg-legend-swatch cg-legend-${status}`;
      const txt = document.createElement('span');
      txt.className = 'cg-legend-label';
      txt.textContent = label;
      row.appendChild(swatch);
      row.appendChild(txt);
      el.appendChild(row);
    }
    el.classList.add('visible');
  }

  // ============================================================
  // WIRE UP TABS & CANVAS
  // ============================================================
  const fcTab = document.getElementById('tab-flowchart');
  const sqTab = document.getElementById('tab-sequence');

  const fcSvg = document.getElementById('svg-flowchart');
  const sqSvg = document.getElementById('svg-sequence');

  const state = {
    current: null,
    viewports: {},     // tab-name -> { viewport, bbox }
    transforms: {},    // tab-name -> { scale, tx, ty }
  };

  const loading = document.getElementById('loading');
  const renderErrors = new Map();

  function showRenderError(name, error) {
    const message = `${name === 'flowchart' ? 'Flowchart' : 'Sequence'} render error: ${error.message || error}`;
    renderErrors.set(name, message);
    let notice = document.getElementById('cg-render-errors');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'cg-render-errors';
      notice.className = 'cg-render-errors';
      notice.setAttribute('role', 'alert');
      document.getElementById('canvas-wrap').appendChild(notice);
    }
    notice.hidden = false;
    notice.textContent = [...renderErrors.values()].join('\n');
  }

  function getMermaidTheme() {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
  }

  async function renderAvailableDiagrams(theme = getMermaidTheme()) {
    const jobs = [];
    for (const [name, diagram, svg, tab] of [
      ['flowchart', data.flowchart, fcSvg, fcTab],
      ['sequence', data.sequence, sqSvg, sqTab],
    ]) {
      if (!diagram) {
        tab.classList.add('hidden');
        svg.style.display = 'none';
        continue;
      }
      jobs.push((async () => {
        try {
          const rendered = await renderDiagram(name, diagram, svg, theme);
          state.viewports[name] = rendered;
          if (!state.transforms[name]) state.transforms[name] = fitTransform(rendered.bbox);
          tab.classList.remove('hidden');
          renderErrors.delete(name);
          const notice = document.getElementById('cg-render-errors');
          if (notice) {
            notice.textContent = [...renderErrors.values()].join('\n');
            notice.hidden = renderErrors.size === 0;
          }
          applyTransform(name);
        } catch (error) {
          showRenderError(name, error);
          tab.classList.add('hidden');
          svg.style.display = 'none';
        }
      })());
    }
    await Promise.all(jobs);
    loading.style.display = 'none';
    if (!state.current) {
      if (state.viewports.flowchart) switchTo('flowchart');
      else if (state.viewports.sequence) switchTo('sequence');
    }
  }

  renderLegend();
  renderAvailableDiagrams();

  const themePreference = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (themePreference) {
    const updateTheme = event => renderAvailableDiagrams(event.matches ? 'dark' : 'default');
    if (themePreference.addEventListener) themePreference.addEventListener('change', updateTheme);
    else if (themePreference.addListener) themePreference.addListener(updateTheme);
  }

  function fitTransform(bbox) {
    const wrap = document.getElementById('canvas-wrap');
    const cw = wrap.clientWidth || 800;
    const ch = wrap.clientHeight || 600;
    const scale = Math.min(cw / bbox.w, ch / bbox.h, 1.2) * 0.9;
    const tx = (cw - bbox.w * scale) / 2 - bbox.x * scale;
    const ty = (ch - bbox.h * scale) / 2 - bbox.y * scale;
    return { scale, tx, ty };
  }

  function applyTransform(name) {
    const v = state.viewports[name];
    const t = state.transforms[name];
    if (!v || !t) return;
    v.viewport.setAttribute('transform', `translate(${t.tx},${t.ty}) scale(${t.scale})`);
  }

  function switchTo(name) {
    state.current = name;
    fcTab.classList.toggle('active', name === 'flowchart');
    sqTab.classList.toggle('active', name === 'sequence');
    fcSvg.style.display = name === 'flowchart' ? '' : 'none';
    sqSvg.style.display = name === 'sequence' ? '' : 'none';
    applyTransform(name);
  }

  fcTab.addEventListener('click', () => switchTo('flowchart'));
  sqTab.addEventListener('click', () => switchTo('sequence'));

  // Initial view is selected after the asynchronous Mermaid render completes.

  // ============================================================
  // ZOOM & PAN
  // ============================================================
  const wrap = document.getElementById('canvas-wrap');
  let dragging = false;
  let lastX = 0, lastY = 0;

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const t = state.transforms[state.current];
    if (!t) return;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.1, Math.min(5, t.scale * factor));
    // zoom-to-cursor
    t.tx = mx - (mx - t.tx) * (newScale / t.scale);
    t.ty = my - (my - t.ty) * (newScale / t.scale);
    t.scale = newScale;
    applyTransform(state.current);
  }, { passive: false });

  wrap.addEventListener('pointerdown', (e) => {
    // Don't pan when clicking on a node/edge
    if (e.target.closest('.cg-node, .cg-edge, .cg-msg, .cg-actor')) return;
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const t = state.transforms[state.current];
    if (!t) return;
    t.tx += e.clientX - lastX;
    t.ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    applyTransform(state.current);
  });
  wrap.addEventListener('pointerup', (e) => {
    dragging = false;
    try { wrap.releasePointerCapture(e.pointerId); } catch {}
  });

  document.getElementById('reset-view').addEventListener('click', () => {
    const v = state.viewports[state.current];
    if (v) {
      state.transforms[state.current] = fitTransform(v.bbox);
      applyTransform(state.current);
    }
  });

  // ============================================================
  // CLICK → JUMP
  // ============================================================
  fcSvg.addEventListener('click', (e) => {
    const nodeEl = e.target.closest('.cg-node[data-loc="true"]');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-id');
      const loc = data.flowchart.locs[id];
      jumpTo(loc);
      return;
    }
    const edgeEl = e.target.closest('.cg-edge');
    if (edgeEl) {
      const loc = flowEdgeLoc(data.flowchart, edgeEl.getAttribute('data-edge-id'),
        edgeEl.getAttribute('data-from'), edgeEl.getAttribute('data-to'));
      if (loc) jumpTo(loc);
    }
  });

  sqSvg.addEventListener('click', (e) => {
    const msgEl = e.target.closest('.cg-msg[data-loc="true"]');
    if (msgEl) {
      const idx = parseInt(msgEl.getAttribute('data-idx'), 10);
      const loc = data.sequence.locs.messages[idx];
      jumpTo(loc);
      return;
    }
    const actorEl = e.target.closest('.cg-actor[data-loc="true"]');
    if (actorEl) {
      const id = actorEl.getAttribute('data-id');
      const loc = data.sequence.locs.actors[id];
      jumpTo(loc);
    }
  });

  // ============================================================
  // WEB MODE: in-page code pane + splitter
  // ============================================================
  // File-extension → highlight.js language id. Falls back to auto-detect.
  const EXT_LANG = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
    '.css': 'css',
    '.html': 'xml', '.htm': 'xml', '.svg': 'xml',
    '.json': 'json',
    '.md': 'markdown', '.markdown': 'markdown',
    '.sh': 'bash', '.bash': 'bash',
    '.yml': 'yaml', '.yaml': 'yaml',
    '.sql': 'sql',
  };

  function langForFile(file) {
    const lower = file.toLowerCase();
    // Match the longest extension so '.tsx' wins over '.x'.
    let best = null;
    for (const ext of Object.keys(EXT_LANG)) {
      if (lower.endsWith(ext) && (best === null || ext.length > best.length)) best = ext;
    }
    return best ? EXT_LANG[best] : null;
  }

  function showCodeInPane(file, line) {
    const pane = document.getElementById('code-pane');
    const header = document.getElementById('code-pane-header');
    const body = document.getElementById('code-pane-body');
    const files = data.files || {};
    pane.style.display = '';

    function setHeader(text) {
      header.textContent = text;
    }

    if (data.diff?.files?.[file]?.status === 'deleted') {
      renderDiffView(file, line, '');
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(files, file)) {
      setHeader(file);
      body.innerHTML = `<div id="code-pane-empty">File not embedded: <code>${file}</code></div>`;
      return;
    }

    const text = files[file];

    // Review mode: render a git-diff-like unified view when diff data exists.
    if (data.diff?.files?.[file]) {
      renderDiffView(file, line, text);
      return;
    }

    renderFileView(file, line, text);
  }

  function renderFileView(file, line, text) {
    const header = document.getElementById('code-pane-header');
    const body = document.getElementById('code-pane-body');
    const lang = langForFile(file);
    let html;
    try {
      html = lang
        ? window.hljs.highlight(text, { language: lang }).value
        : window.hljs.highlightAuto(text).value;
    } catch {
      html = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    }
    const lines = html.split('\n');
    const total = lines.length;
    header.textContent = `${file} \u00b7 line ${line} / ${total}`;

    const frag = document.createDocumentFragment();
    lines.forEach((lineHtml, i) => {
      const n = i + 1;
      const row = document.createElement('div');
      row.className = 'cg-code-line';
      row.dataset.line = n;
      if (n === line) row.classList.add('cg-current-line');
      const num = document.createElement('span');
      num.className = 'cg-line-num';
      num.textContent = n;
      const content = document.createElement('span');
      content.className = 'cg-line-content';
      content.innerHTML = lineHtml || ' ';
      row.appendChild(num);
      row.appendChild(content);
      frag.appendChild(row);
    });
    body.innerHTML = '';
    body.appendChild(frag);

    requestAnimationFrame(() => {
      const target = body.querySelector('.cg-current-line');
      if (target) target.scrollIntoView({ block: 'center' });
    });
  }

  function buildUnifiedDiff(baseText, headText, addedLines, removedLines) {
    const oldLines = baseText.split('\n');
    const newLines = headText.split('\n');
    const addedSet = new Set(addedLines);
    const removedSet = new Set(removedLines);
    const rows = [];

    let oldI = 0, newI = 0;
    while (oldI < oldLines.length || newI < newLines.length) {
      const oldN = oldI + 1;
      const newN = newI + 1;
      if (removedSet.has(oldN) && oldI < oldLines.length) {
        rows.push({ type: 'del', oldN, newN: null, text: oldLines[oldI] });
        oldI++;
      } else if (addedSet.has(newN) && newI < newLines.length) {
        rows.push({ type: 'add', oldN: null, newN, text: newLines[newI] });
        newI++;
      } else {
        const text = newI < newLines.length ? newLines[newI] : oldLines[oldI];
        rows.push({ type: 'ctx', oldN, newN, text });
        if (oldI < oldLines.length) oldI++;
        if (newI < newLines.length) newI++;
      }
    }

    const CONTEXT = 3;
    const changed = rows.map((r, i) => r.type !== 'ctx' ? i : -1).filter(i => i >= 0);
    if (changed.length === 0) return { rows, hunks: [] };

    const hunks = [];
    let lastEnd = -1;
    for (const idx of changed) {
      const start = Math.max(0, idx - CONTEXT);
      const end = Math.min(rows.length - 1, idx + CONTEXT);
      if (start > lastEnd + 1) {
        hunks.push({ startRow: start, endRow: end });
      } else if (hunks.length > 0) {
        hunks[hunks.length - 1].endRow = Math.max(hunks[hunks.length - 1].endRow, end);
      } else {
        hunks.push({ startRow: start, endRow: end });
      }
      lastEnd = hunks[hunks.length - 1].endRow;
    }

    return { rows, hunks };
  }

  function renderDiffView(file, targetLine, headText) {
    const header = document.getElementById('code-pane-header');
    const body = document.getElementById('code-pane-body');
    const diffInfo = data.diff.files[file];
    const baseText = diffInfo.baseText || '';
    const status = diffInfo.status;

    if (status === 'deleted') {
      header.textContent = `${file} \u00b7 line ${targetLine} \u00b7 DELETED`;
      const banner = document.createElement('div');
      banner.className = 'cg-file-deleted-banner';
      banner.textContent = 'This file was deleted in the reviewed change.';
      const frag = document.createDocumentFragment();
      frag.appendChild(banner);
      renderPlainLines(frag, baseText.split('\n'), 'del', 1);
      body.innerHTML = '';
      body.appendChild(frag);
      const target = body.querySelector(`[data-line="${targetLine}"]`);
      if (target) {
        target.classList.add('cg-current-line');
        requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
      }
      return;
    }

    const { rows, hunks } = buildUnifiedDiff(
      baseText,
      headText,
      diffInfo.addedLines || [],
      diffInfo.removedLines || []
    );

    if (hunks.length === 0) {
      renderFileView(file, targetLine, headText);
      return;
    }

    // Include the selected anchor even when it falls in omitted context.
    const targetIndex = rows.findIndex(row => row.newN === targetLine);
    if (targetIndex >= 0 && !hunks.some(h => targetIndex >= h.startRow && targetIndex <= h.endRow)) {
      hunks.push({ startRow: Math.max(0, targetIndex - 3), endRow: Math.min(rows.length - 1, targetIndex + 3) });
      hunks.sort((a, b) => a.startRow - b.startRow);
      for (let i = 1; i < hunks.length;) {
        if (hunks[i].startRow <= hunks[i - 1].endRow + 1) {
          hunks[i - 1].endRow = Math.max(hunks[i - 1].endRow, hunks[i].endRow);
          hunks.splice(i, 1);
        } else i++;
      }
    }
    header.textContent = `${file} \u00b7 line ${targetLine} \u00b7 diff (${hunks.length} hunk${hunks.length > 1 ? 's' : ''})`;

    const frag = document.createDocumentFragment();
    let targetRow = null;

    let previousEnd = -1;
    hunks.forEach(h => {
      if (h.startRow > previousEnd + 1) {
        const omitted = h.startRow - previousEnd - 1;
        const gap = document.createElement('div');
        gap.className = 'cg-diff-hunk-header';
        gap.textContent = `\u22ef ${omitted} unchanged line${omitted === 1 ? '' : 's'} omitted \u22ef`;
        frag.appendChild(gap);
      }
      previousEnd = h.endRow;

      const firstRow = rows[h.startRow];
      const lastRow = rows[h.endRow];
      const oldStart = firstRow.oldN || lastRow.oldN || 1;
      const newStart = firstRow.newN || lastRow.newN || 1;
      let oldCount = 0, newCount = 0;
      for (let ri = h.startRow; ri <= h.endRow; ri++) {
        const r = rows[ri];
        if (r.type !== 'add') oldCount++;
        if (r.type !== 'del') newCount++;
      }
      const hunkHeader = document.createElement('div');
      hunkHeader.className = 'cg-diff-hunk-header';
      hunkHeader.textContent = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
      frag.appendChild(hunkHeader);

      for (let ri = h.startRow; ri <= h.endRow; ri++) {
        const row = rows[ri];
        const div = document.createElement('div');
        div.className = 'cg-code-line cg-diff-' + row.type;
        div.dataset.line = row.newN || row.oldN || '';
        const num = document.createElement('span');
        num.className = 'cg-line-num';
        num.textContent = row.type === 'del' ? row.oldN : (row.newN || '');
        const content = document.createElement('span');
        content.className = 'cg-line-content';
        content.innerHTML = (row.text || ' ').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        div.appendChild(num);
        div.appendChild(content);
        frag.appendChild(div);

        if (targetRow === null && row.newN === targetLine) {
          div.classList.add('cg-current-line');
          targetRow = div;
        }
      }
    });

    body.innerHTML = '';
    body.appendChild(frag);

    requestAnimationFrame(() => {
      const scrollTarget = targetRow || body.querySelector('.cg-diff-add, .cg-diff-del');
      if (scrollTarget) scrollTarget.scrollIntoView({ block: 'center' });
    });
  }

  function renderPlainLines(frag, lines, type, startNumber) {
    lines.forEach((text, i) => {
      const n = startNumber + i;
      const div = document.createElement('div');
      div.className = `cg-code-line cg-diff-${type}`;
      div.dataset.line = n;
      const num = document.createElement('span');
      num.className = 'cg-line-num';
      num.textContent = n;
      const content = document.createElement('span');
      content.className = 'cg-line-content';
      content.innerHTML = (text || ' ').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      div.appendChild(num);
      div.appendChild(content);
      frag.appendChild(div);
    });
  }

  // ---- Splitter drag + dblclick reset ----
  (function wireSplitter() {
    const splitter = document.getElementById('splitter');
    const canvasWrap = document.getElementById('canvas-wrap');
    const codePane = document.getElementById('code-pane');
    if (!splitter) return;
    const MIN = 200;

    function setRatio(canvasPx) {
      const main = document.getElementById('main');
      const total = main.clientWidth;
      const clamped = Math.max(MIN, Math.min(total - MIN - splitter.offsetWidth, canvasPx));
      canvasWrap.style.flex = `0 0 ${clamped}px`;
      codePane.style.flex = '1 1 auto';
    }

    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      splitter.classList.add('cg-dragging');
      const main = document.getElementById('main');
      const total = main.clientWidth;
      const startX = e.clientX;
      const startCanvasWidth = canvasWrap.getBoundingClientRect().width;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        setRatio(startCanvasWidth + dx);
      };
      const onUp = () => {
        splitter.classList.remove('cg-dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.dispatchEvent(new Event('resize'));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Double-click resets to default 1:2 (canvas:code).
    splitter.addEventListener('dblclick', () => {
      canvasWrap.style.flex = '1 1 auto';
      codePane.style.flex = '2 1 auto';
      window.dispatchEvent(new Event('resize'));
    });
  })();
})();
