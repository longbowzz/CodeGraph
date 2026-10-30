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
    // Internal mode used when the page is framed by the Harness graph tab:
    // clicks are relayed to the host and the in-page code pane stays off.
    'dsh':              { label: 'DSH',              bridge: true },
  };

  // When the page is framed by the DSH graph tab, the tab appends
  // `#dsh=<token>` and owns source navigation. Send the semantic location to
  // the parent instead of launching an external editor.
  const dshBridge = (() => {
    try {
      const hash = window.location.hash || '';
      const match = /(?:^|[#&])dsh=([^&]+)/.exec(hash);
      const fsMatch = /(?:^|[#&])fs=([\d.]+)/.exec(hash);
      return match
        ? { token: decodeURIComponent(match[1]), fontSize: fsMatch ? Number(fsMatch[1]) : 0 }
        : null;
    } catch {
      return null;
    }
  })();
  function codeLineHeight() {
    const fontSize = dshBridge !== null && Number.isFinite(dshBridge.fontSize) && dshBridge.fontSize > 0
      ? dshBridge.fontSize
      : 13;
    return fontSize * 1.6;
  }

  // The Harness source preview scrolls the requested line to the top of its
  // content area. Move the request up by roughly half a viewport so the real
  // target lands near the middle. The line ruler below still reports the true
  // target line; this only changes the navigation request.
  function isCodeSource(file) {
    return /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|c|h|cc|cpp|cxx|hpp|css|html?|svg|json|sh|bash|ya?ml|sql)$/i.test(file);
  }
  function dshNavLine(file, line) {
    if (!isCodeSource(file)) return line;
    const paneHeight = window.innerHeight || 0;
    const chromeHeight = 72;   // preview header + code toolbar, roughly
    const lineHeight = codeLineHeight();
    const visible = Math.max(1, (paneHeight - chromeHeight) / lineHeight);
    const lead = Math.max(0, Math.floor(visible / 2));
    return Math.max(1, line - lead);
  }
  function sendNavigation(file, line, status) {
    if (dshBridge === null) return;
    parent.postMessage({
      v: 1,
      type: 'codegraph.navigate',
      token: dshBridge.token,
      repo,
      file,
      line: dshNavLine(file, line),
      targetLine: line,
      status,
    }, '*');
  }

  // ---- Safari detection (for banner) ----
  if (/^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)) {
    document.body.classList.add('safari');
  }

  // ---- Editor selector ----
  // A sandboxed preview (for example the DSH graph tab) has an opaque origin
  // where localStorage access throws. Fall back to the embedded editor choice.
  let editorStorage = null;
  try { editorStorage = window.localStorage; } catch {}
  let storedEditor = null;
  try { storedEditor = editorStorage?.getItem('cg-editor') ?? null; } catch {}
  let currentEditor = storedEditor || data.editor?.id || 'vscode';
  if (dshBridge) currentEditor = 'dsh';
  if (!editors[currentEditor]) currentEditor = 'vscode';

  const editorSel = document.getElementById('editor-select');
  for (const [id, e] of Object.entries(editors)) {
    if (id === 'dsh') continue;
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = e.label;
    if (id === currentEditor) opt.selected = true;
    editorSel.appendChild(opt);
  }
  editorSel.addEventListener('change', () => {
    currentEditor = editorSel.value;
    try { editorStorage?.setItem('cg-editor', currentEditor); } catch {}
    applyWebMode();
  });

  // Toggle the in-page code pane on/off based on current editor.
  function applyWebMode() {
    const on = editors[currentEditor]?.inPage === true;
    document.body.classList.toggle('cg-web-mode', on);
    document.body.classList.toggle('cg-dsh-mode', dshBridge !== null);
  }
  applyWebMode();
  if (dshBridge) {
    const footer = document.querySelector('footer');
    if (footer) {
      footer.textContent = 'Hover to highlight · Click to open source in the side panel · Scroll to zoom · Drag to pan';
    }
  }

  // ---- Topic / header ----
  // The folder carries the timestamp; the header reads better without it.
  document.getElementById('topic').textContent = String(data.topic || '(untitled)').replace(/^\d{8}-\d{4}-/, '');
  document.getElementById('repo').textContent = repo;

  // ---- Build absolute path ----
  function absPath(rel) {
    // rel uses forward slashes; repo is the repo root.
    if (!repo) return rel;
    return repo.replace(/\/$/, '') + '/' + rel;
  }

  // ---- Right-edge file-position ruler ----
  // A rough, non-pixel-aligned indicator that follows the preview viewport:
  // centered lines land mid-track, head/tail clamp near the track ends.
  // The source preview still owns the exact scroll position.
  const lineRuler = document.getElementById('cg-line-ruler');
  const lineCard = document.getElementById('cg-line-card');
  const lineFile = document.getElementById('cg-line-file');
  const lineFn = document.getElementById('cg-line-fn');
  const lineNum = document.getElementById('cg-line-num');

  if (lineCard !== null) {
    lineCard.addEventListener('pointerdown', (event) => event.stopPropagation());
    lineCard.addEventListener('click', (event) => {
      event.stopPropagation();
      if (lastMarker !== null) sendNavigation(lastMarker.file, lastMarker.line, lastMarker.status);
    });
  }

  const fileMaxLine = new Map();
  function noteLine(loc) {
    if (loc !== null && typeof loc === 'object' && !Array.isArray(loc)) loc = loc.loc;
    if (!Array.isArray(loc)) return;
    const [file, line] = loc;
    if (typeof file !== 'string' || !Number.isInteger(line) || line < 1) return;
    if (!fileMaxLine.has(file) || fileMaxLine.get(file) < line) fileMaxLine.set(file, line);
  }
  if (data.flowchart) {
    for (const loc of Object.values(data.flowchart.locs || {})) noteLine(loc);
    for (const loc of Object.values(data.flowchart.edgeLocs || {})) noteLine(loc);
  }
  if (data.sequence) {
    for (const loc of Object.values(data.sequence.locs?.actors || {})) noteLine(loc);
    for (const loc of data.sequence.locs?.messages || []) noteLine(loc);
  }
  if (data.classDiagram) {
    for (const loc of Object.values(data.classDiagram.locs?.classes || {})) noteLine(loc);
    for (const loc of Object.values(data.classDiagram.relationLocs || {})) noteLine(loc);
  }

  function countLines(text) {
    if (typeof text !== 'string' || text === '') return 0;
    const normalized = text.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    return normalized.endsWith('\n') ? lines.length - 1 : lines.length;
  }

  // Heuristics for the nearest enclosing declaration above the target line.
  // This is intentionally approximate; a line outside a function shows a
  // placeholder rather than a guessed name.
  const FUNCTION_PATTERNS = [
    /^\s*return\s+function\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/,
    /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /^\s*(?:export\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
    /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|async|override|virtual|internal|export)\s+)*(?:[\w<>\[\],.?]+\s+)+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\{/,
    /^\s*def\s+([A-Za-z_]\w*)/,
    /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
    /^\s*fn\s+([A-Za-z_]\w*)/,
  ];
  const FUNCTION_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with',
    'do', 'else', 'try', 'finally', 'new', 'typeof', 'await', 'yield',
    'throw', 'case', 'default', 'constructor',
  ]);

  function extractFunctionName(file, line) {
    const text = data.files?.[file];
    if (typeof text !== 'string' || text === '') return '';
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const end = Math.min(line, lines.length) - 1;
    const start = Math.max(0, end - 400);
    for (let index = end; index >= start; index -= 1) {
      const source = lines[index];
      if (typeof source !== 'string') continue;
      for (const pattern of FUNCTION_PATTERNS) {
        const match = pattern.exec(source);
        if (match !== null && typeof match[1] === 'string' && match[1] !== '' && !FUNCTION_KEYWORDS.has(match[1])) {
          return match[1];
        }
      }
    }
    return '';
  }

  let lastMarker = null;

  function showLineMarker(loc) {
    // The card is a Harness navigation aid only; a standalone browser keeps
    // its own Web code pane and shows no overlay.
    if (dshBridge === null) return;
    if (!Array.isArray(loc) || lineRuler === null || lineCard === null || lineFile === null || lineFn === null || lineNum === null) return;
    const file = loc[0];
    const line = loc[1];
    const status = loc[2];
    if (typeof file !== 'string' || !Number.isInteger(line) || line < 1) return;

    lastMarker = { file, line, status };
    const total = countLines(data.files?.[file]) || fileMaxLine.get(file) || 0;
    lineFile.textContent = file.split('/').pop() || file;
    lineFn.textContent = extractFunctionName(file, line) || '(未识别函数)';
    lineNum.textContent = `第 ${line} 行`;
    lineCard.title = `${file}:${line} · 点击重新定位`;
    lineCard.dataset.status = status || 'unchanged';
    lineRuler.classList.add('visible');

    // Match the code pane's viewport, not the file's proportional length:
    // the preview centers the target when it can, pins it near the top during
    // the file head, and pins it near the bottom during the file tail. Use the
    // same line/header estimates as dshNavLine so the card tracks that scroll.
    const lineHeight = codeLineHeight();
    const chromeHeight = 72;
    const paneHeight = window.innerHeight || 0;
    const viewportHeight = Math.max(lineHeight, paneHeight - chromeHeight);
    const contentHeight = Math.max(total, line) * lineHeight;
    const desiredScroll = (line - 1) * lineHeight - (viewportHeight - lineHeight) / 2;
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    const scrollTop = Math.min(Math.max(0, desiredScroll), maxScroll);
    const lineScreenY = total > 0
      ? chromeHeight + (line - 1) * lineHeight - scrollTop + lineHeight / 2
      : paneHeight / 2;

    const graphTop = document.querySelector('header')?.offsetHeight || 0;
    const rulerTop = graphTop + 16;
    const cardHeight = lineCard.offsetHeight;
    // Let the card use the canvas bottom margin; only keep it on screen.
    const maxTop = Math.max(0, lineRuler.clientHeight + 16 - cardHeight);
    const top = Math.min(
      Math.max(0, lineScreenY - rulerTop - cardHeight / 2),
      maxTop,
    );
    lineCard.style.top = `${Math.round(top)}px`;
  }

  function hideLineCard() {
    lastMarker = null;
    if (lineRuler !== null) lineRuler.classList.remove('visible');
  }

  function clearSelection() {
    for (const el of document.querySelectorAll('.cg-selected')) el.classList.remove('cg-selected');
  }

  function selectElement(el) {
    clearSelection();
    if (el !== null) el.classList.add('cg-selected');
  }

  // Clicking a graph element keeps/updates the card; clicking anywhere else
  // dismisses it. The card itself is handled by its own click listener.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target === null || typeof target.closest !== 'function') {
      hideLineCard();
      clearSelection();
      return;
    }
    if (target.closest('#cg-line-card, #code-pane, #splitter')) return;
    if (target.closest('.cg-node, .cg-edge, .cg-msg, .cg-actor, .cg-class, .cg-relation')) return;
    hideLineCard();
    clearSelection();
  });


  window.addEventListener('resize', () => {
    if (lastMarker === null) return;
    requestAnimationFrame(() => showLineMarker([lastMarker.file, lastMarker.line, lastMarker.status]));
  });

  // The tab pane can resize without a window resize (dock, split, web pane),
  // and the first click may land before the canvas settles. Keep the marker
  // proportional to the current track height.
  const canvasWrap = document.getElementById('canvas-wrap');
  if (canvasWrap !== null && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (lastMarker !== null) showLineMarker([lastMarker.file, lastMarker.line, lastMarker.status]);
    }).observe(canvasWrap);
  }

  function jumpTo(loc) {
    if (!loc) return;
    // locs are stored as [file, line] arrays; accept both forms defensively.
    const file = Array.isArray(loc) ? loc[0] : loc.file;
    const line = Array.isArray(loc) ? loc[1] : loc.line;
    if (!file || !line) return;
    const status = Array.isArray(loc) ? loc[2] : loc.status;
    showLineMarker([file, line, status]);
    if (dshBridge) {
      sendNavigation(file, line, status);
      return;
    }
    if (status === 'removed' && !editors[currentEditor].inPage) {
      currentEditor = 'web';
      editorSel.value = 'web';
      applyWebMode();
    }
    if (editors[currentEditor].inPage) {
      showCodeInPane(file, line, status);
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
    hit.removeAttribute('data-cg-relation');
    hit.removeAttribute('marker-start');
    hit.removeAttribute('marker-end');
    hit.setAttribute('class', className);
    path.parentNode.insertBefore(hit, path);
    return hit;
  }

  function viewBoxBounds(root) {
    const parts = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) {
      throw new Error('Mermaid returned SVG without a valid viewBox');
    }
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }

  function markEdgeGroup(el, fc, edgeById, edgeGroups, nodeById) {
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
    const fromNode = nodeById.get(from);
    const toNode = nodeById.get(to);
    const fromDiff = fromNode?.diff || locs[from]?.[2];
    const toDiff = toNode?.diff || locs[to]?.[2];
    const diff = fc.edgeLocs !== undefined
      ? (loc?.[2] || 'unchanged')
      : (edge.diff || inferEdgeDiff({ diff: fromDiff }, { diff: toDiff }));

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
      lineCounts.set(id, lineCounts.get(id) + markEdgeGroup(el, fc, edgeById, edgeGroups, nodeById));
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

  function classEntryInfo(entry) {
    const loc = Array.isArray(entry) ? entry : (entry !== null && typeof entry === 'object' && Array.isArray(entry.loc) ? entry.loc : null);
    return {
      loc,
      stereotype: entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry.stereotype || '') : '',
      summary: entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry.summary || '') : '',
    };
  }

  function decorateClass(root, cl) {
    const classById = new Map((cl.classes || []).map(klass => [klass.id, klass]));
    const classEls = new Map();
    const relationEls = [];
    const seenClasses = new Set();
    for (const el of root.querySelectorAll('[data-cg-class]')) {
      const id = el.getAttribute('data-cg-class');
      const klass = classById.get(id);
      if (!klass || seenClasses.has(id)) throw new Error(`Missing or duplicate Mermaid class marker: ${id || '(empty)'}`);
      seenClasses.add(id);
      classEls.set(id, el);
      const info = classEntryInfo(cl.locs?.classes?.[id]);
      addClass(el, 'cg-class');
      el.setAttribute('data-id', id);
      el.setAttribute('data-loc', info.loc ? 'true' : 'false');
      const diff = klass.diff || info.loc?.[2];
      if (diff) el.setAttribute('data-diff', diff);
      else el.removeAttribute('data-diff');
    }
    for (const id of classById.keys()) {
      if (!seenClasses.has(id)) throw new Error(`Missing Mermaid class marker: ${id}`);
    }

    const relationById = new Map((cl.relations || []).map(relation => [relation.id, relation]));
    const seenRelations = new Set();
    for (const el of root.querySelectorAll('[data-cg-relation]')) {
      const id = el.getAttribute('data-cg-relation');
      const relation = relationById.get(id);
      if (!relation || seenRelations.has(id)) throw new Error(`Missing or duplicate Mermaid relation marker: ${id || '(empty)'}`);
      seenRelations.add(id);
      const loc = cl.relationLocs?.[id];
      addClass(el, 'cg-relation');
      el.setAttribute('data-rel-id', id);
      el.setAttribute('data-from', relation.from);
      el.setAttribute('data-to', relation.to);
      el.setAttribute('data-loc', loc ? 'true' : 'false');
      const diff = relation.diff || loc?.[2];
      if (diff) el.setAttribute('data-diff', diff);
      else el.removeAttribute('data-diff');
      relationEls.push({ el, relation });
      if (el.localName === 'path') {
        const hit = addHitPath(el, 'cg-relation-hit');
        hit.classList.add('cg-relation');
        hit.setAttribute('data-rel-id', id);
        hit.setAttribute('data-from', relation.from);
        hit.setAttribute('data-to', relation.to);
        hit.setAttribute('data-loc', loc ? 'true' : 'false');
        relationEls.push({ el: hit, relation });
      }
    }
    for (const id of relationById.keys()) {
      if (!seenRelations.has(id)) throw new Error(`Missing Mermaid relation marker: ${id}`);
    }

    const classCard = document.getElementById('cg-class-card');
    const className = document.getElementById('cg-class-name');
    const classStereotype = document.getElementById('cg-class-stereotype');
    const classSummary = document.getElementById('cg-class-summary');
    const classMeta = document.getElementById('cg-class-meta');

    function clearFocus() {
      for (const el of classEls.values()) el.classList.remove('cg-dim');
      for (const { el } of relationEls) el.classList.remove('cg-dim');
    }

    function focusClass(id) {
      const related = new Set([id]);
      for (const relation of cl.relations || []) {
        if (relation.from === id) related.add(relation.to);
        if (relation.to === id) related.add(relation.from);
      }
      for (const [classId, el] of classEls) el.classList.toggle('cg-dim', !related.has(classId));
      for (const { el, relation } of relationEls) {
        el.classList.toggle('cg-dim', relation.from !== id && relation.to !== id);
      }
    }

    function showCard(klass, info) {
      if (!classCard || !className || !classStereotype || !classSummary || !classMeta) return;
      className.textContent = klass.label || klass.id;
      classStereotype.textContent = info.stereotype || klass.type || '';
      classSummary.textContent = info.summary || '';
      const loc = info.loc;
      const facts = [];
      if (loc) facts.push(`${loc[0]}:${loc[1]}`);
      if (klass.methods?.length) facts.push(`${klass.methods.length} method${klass.methods.length === 1 ? '' : 's'}`);
      if (klass.members?.length) facts.push(`${klass.members.length} field${klass.members.length === 1 ? '' : 's'}`);
      classMeta.textContent = facts.join(' · ');
      classSummary.hidden = classSummary.textContent === '';
      classMeta.hidden = classMeta.textContent === '';
      classCard.hidden = false;
    }

    function hideCard() {
      if (classCard) classCard.hidden = true;
    }

    for (const [id, el] of classEls) {
      const klass = classById.get(id);
      const info = classEntryInfo(cl.locs?.classes?.[id]);
      el.addEventListener('mouseenter', () => {
        focusClass(id);
        showCard(klass, info);
      });
      el.addEventListener('mouseleave', () => {
        clearFocus();
        hideCard();
      });
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
    else if (name === 'sequence') decorateSequence(root, diagram);
    else decorateClass(root, diagram);

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
  const clTab = document.getElementById('tab-class');

  const fcSvg = document.getElementById('svg-flowchart');
  const sqSvg = document.getElementById('svg-sequence');
  const clSvg = document.getElementById('svg-class');

  const state = {
    current: null,
    viewports: {},     // tab-name -> { viewport, bbox }
    transforms: {},    // tab-name -> { scale, tx, ty }
  };

  const loading = document.getElementById('loading');
  const renderErrors = new Map();

  function showRenderError(name, error) {
    const label = name === 'flowchart' ? 'Flowchart' : name === 'sequence' ? 'Sequence' : 'Class';
    const message = `${label} render error: ${error.message || error}`;
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
      ['class', data.classDiagram, clSvg, clTab],
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
      else if (state.viewports.class) switchTo('class');
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
    clTab.classList.toggle('active', name === 'class');
    fcSvg.style.display = name === 'flowchart' ? '' : 'none';
    sqSvg.style.display = name === 'sequence' ? '' : 'none';
    clSvg.style.display = name === 'class' ? '' : 'none';
    applyTransform(name);
  }

  fcTab.addEventListener('click', () => switchTo('flowchart'));
  sqTab.addEventListener('click', () => switchTo('sequence'));
  clTab.addEventListener('click', () => switchTo('class'));

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
    if (e.target.closest('.cg-node, .cg-edge, .cg-msg, .cg-actor, .cg-class, .cg-relation')) return;
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
      selectElement(nodeEl);
      jumpTo(loc);
      return;
    }
    const edgeEl = e.target.closest('.cg-edge');
    if (edgeEl) {
      const loc = flowEdgeLoc(data.flowchart, edgeEl.getAttribute('data-edge-id'),
        edgeEl.getAttribute('data-from'), edgeEl.getAttribute('data-to'));
      if (loc) {
        selectElement(edgeEl);
        jumpTo(loc);
      }
    }
  });

  sqSvg.addEventListener('click', (e) => {
    const msgEl = e.target.closest('.cg-msg[data-loc="true"]');
    if (msgEl) {
      const idx = parseInt(msgEl.getAttribute('data-idx'), 10);
      const loc = data.sequence.locs.messages[idx];
      selectElement(msgEl);
      jumpTo(loc);
      return;
    }
    const actorEl = e.target.closest('.cg-actor[data-loc="true"]');
    if (actorEl) {
      const id = actorEl.getAttribute('data-id');
      const loc = data.sequence.locs.actors[id];
      if (loc) {
        selectElement(actorEl);
        jumpTo(loc);
      }
    }
  });

  clSvg.addEventListener('click', (e) => {
    const classEl = e.target.closest('.cg-class[data-loc="true"]');
    if (classEl) {
      const id = classEl.getAttribute('data-id');
      const entry = data.classDiagram.locs.classes[id];
      const loc = Array.isArray(entry) ? entry : entry?.loc;
      if (loc) {
        selectElement(classEl);
        jumpTo(loc);
      }
      return;
    }
    const relationEl = e.target.closest('.cg-relation[data-loc="true"]');
    if (relationEl) {
      const id = relationEl.getAttribute('data-rel-id');
      const loc = data.classDiagram.relationLocs[id];
      if (loc) {
        selectElement(relationEl);
        jumpTo(loc);
      }
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

  function showCodeInPane(file, line, status) {
    const pane = document.getElementById('code-pane');
    const header = document.getElementById('code-pane-header');
    const body = document.getElementById('code-pane-body');
    const files = data.files || {};
    pane.style.display = '';

    function setHeader(text) {
      header.textContent = text;
    }

    if (data.diff?.files?.[file] && (status === 'removed' || data.diff.files[file].status === 'deleted')) {
      renderDiffView(file, line, files[file] || '', status);
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
      renderDiffView(file, line, text, status);
      return;
    }

    renderFileView(file, line, text);
  }

  function normalizeNewlines(text) {
    return text.replace(/\r\n?/g, '\n');
  }

  function renderFileView(file, line, text) {
    text = normalizeNewlines(text);
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
    const oldLines = normalizeNewlines(baseText).split('\n');
    const newLines = normalizeNewlines(headText).split('\n');
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

  function renderDiffView(file, targetLine, headText, locationStatus) {
    const header = document.getElementById('code-pane-header');
    const body = document.getElementById('code-pane-body');
    const diffInfo = data.diff.files[file];
    const baseText = normalizeNewlines(diffInfo.baseText || '');
    const targetSide = locationStatus === 'removed' ? 'oldN' : 'newN';
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
      renderFileView(file, targetLine, targetSide === 'oldN' ? baseText : headText);
      if (targetSide === 'oldN') header.textContent = `${file} · base line ${targetLine}`;
      return;
    }

    // Include the selected anchor even when it falls in omitted context.
    const targetIndex = rows.findIndex(row => row[targetSide] === targetLine);
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
    header.textContent = `${file} \u00b7 ${targetSide === 'oldN' ? 'base line' : 'line'} ${targetLine} \u00b7 diff (${hunks.length} hunk${hunks.length > 1 ? 's' : ''})`;

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

        if (targetRow === null && row[targetSide] === targetLine) {
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
