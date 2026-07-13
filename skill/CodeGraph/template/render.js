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
  });

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
    const p = absPath(file);
    const url = editors[currentEditor].url(p, line);
    // Test hook: expose last URL for headless verification (no navigation in tests).
    if (window.__cg_captureUrl) { window.__cg_lastUrl = url; return; }
    window.location.href = url;
  }

  // ============================================================
  // FLOWCHART RENDERING (uses dagre)
  // ============================================================

  // CJK / full-width char detection for width estimation.
  // Covers CJK Unified, CJK punctuation, full-width forms, Hiragana, Katakana, Hangul.
  const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;

  // Estimate rendered width of a string at 13px font.
  // CJK / full-width chars ≈ 14px; ASCII ≈ 7px; other Latin ≈ 8px.
  function estimateTextWidth(s) {
    let w = 0;
    for (const c of s) {
      if (CJK_RE.test(c)) w += 14;
      else if (/[a-z0-9]/.test(c)) w += 7;
      else if (/[A-Z]/.test(c)) w += 9;
      else if (c === ' ') w += 4;
      else w += 8; // punctuation
    }
    return w;
  }

  // Convert an array of {x,y} points (dagre edge waypoints) to a smooth SVG
  // path using Catmull-Rom → cubic Bezier conversion. Produces curves similar
  // to Mermaid's default edge style. Falls back to a straight line for 2 points.
  function smoothPathThrough(points) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) return `M${points[0].x},${points[0].y}`;
    if (points.length === 2) {
      return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
    }
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      // Catmull-Rom to Bezier (tension 0.5). The /6 factor is standard.
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  function renderFlowchart(svg, fc) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: fc.direction === 'LR' ? 'LR' : 'TB', nodesep: 50, ranksep: 70, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const n of fc.nodes) {
      const loc = fc.locs && fc.locs[n.id];
      const label = n.label != null ? n.label : n.id;
      const lines = String(label).split('\n');
      // CJK-aware size estimation; comfortable padding so text never overflows.
      const widest = Math.max(...lines.map(s => estimateTextWidth(s)));
      const w = Math.max(120, widest + 40);     // 20px padding each side
      const h = Math.max(44, lines.length * 20 + 20); // 10px padding top/bottom
      g.setNode(n.id, { width: w, height: h, _meta: { ...n, location: loc } });
    }
    for (const e of fc.edges) {
      g.setEdge(e.from, e.to, { _meta: e });
    }

    dagre.layout(g);

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    g.nodes().forEach(id => {
      const nd = g.node(id);
      minX = Math.min(minX, nd.x - nd.width / 2);
      minY = Math.min(minY, nd.y - nd.height / 2);
      maxX = Math.max(maxX, nd.x + nd.width / 2);
      maxY = Math.max(maxY, nd.y + nd.height / 2);
    });
    g.edges().forEach(e => {
      const ed = g.edge(e);
      ed.points.forEach(pt => {
        minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
      });
    });
    const pad = 20;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const vbX = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    vbX.setAttribute('class', 'cg-viewport');
    svg.appendChild(vbX);

    // Arrow marker defs
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="cg-arrow-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#555"/></marker>
      <marker id="cg-arrow-dashed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#888"/></marker>
      <marker id="cg-arrow-async" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5" stroke="#555" stroke-width="2" fill="none"/></marker>
    `;
    vbX.appendChild(defs);

    // Edges first (so nodes draw over)
    g.edges().forEach(e => {
      const ed = g.edge(e);
      const meta = ed._meta;
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      grp.setAttribute('class', 'cg-edge' + (meta.style === 'dashed' ? ' cg-dashed' : ''));
      grp.setAttribute('data-from', e.v);
      grp.setAttribute('data-to', e.w);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // Use smooth Catmull-Rom curves through dagre's waypoints.
      path.setAttribute('d', smoothPathThrough(ed.points));
      path.setAttribute('marker-end', meta.style === 'dashed' ? 'url(#cg-arrow-dashed)' : 'url(#cg-arrow-solid)');
      if (meta.style === 'dashed') path.style.strokeDasharray = '5 3';
      grp.appendChild(path);
      if (meta.label) {
        // Place label near the midpoint of the smoothed path.
        const mid = ed.points[Math.floor(ed.points.length / 2)];
        // Offset perpendicular to the path so the label doesn't sit on the line.
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', mid.x);
        text.setAttribute('y', mid.y - 6);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = meta.label;
        grp.appendChild(text);
      }
      vbX.appendChild(grp);
    });

    // Nodes
    g.nodes().forEach(id => {
      const nd = g.node(id);
      const meta = nd._meta;
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      grp.setAttribute('class', 'cg-node');
      grp.setAttribute('data-id', id);
      grp.setAttribute('data-shape', meta.shape || 'normal');
      grp.setAttribute('data-loc', meta.location ? 'true' : 'false');
      const cx = nd.x, cy = nd.y, w = nd.width, h = nd.height;
      const x = cx - w / 2, y = cy - h / 2;
      const shape = meta.shape || 'normal';
      if (shape === 'normal') {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('rx', 4);
        grp.appendChild(r);
      } else if (shape === 'decision') {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        p.setAttribute('points', `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`);
        grp.appendChild(p);
      } else if (shape === 'terminal') {
        // Stadium: rounded rect with rx=h/2
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('rx', h / 2);
        grp.appendChild(r);
      } else if (shape === 'storage') {
        // Cylinder: rect with curved top/bottom (simplified as rect + ellipse top)
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const ey = 4;
        r.setAttribute('d',
          `M ${x},${y + ey}` +
          ` A ${w / 2},${ey} 0 0 1 ${x + w},${y + ey}` +
          ` L ${x + w},${y + h - ey}` +
          ` A ${w / 2},${ey} 0 0 1 ${x},${y + h - ey}` +
          ` Z`
        );
        grp.appendChild(r);
        const top = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        top.setAttribute('cx', cx); top.setAttribute('cy', y + ey);
        top.setAttribute('rx', w / 2); top.setAttribute('ry', ey);
        top.setAttribute('fill', 'none');
        grp.appendChild(top);
      }
      // Text
      const labelLines = String(meta.label != null ? meta.label : id).split('\n');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', cx);
      text.setAttribute('y', cy - (labelLines.length - 1) * 10);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      labelLines.forEach((line, i) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', cx);
        tspan.setAttribute('dy', i === 0 ? 0 : 20);
        tspan.textContent = line;
        text.appendChild(tspan);
      });
      grp.appendChild(text);
      vbX.appendChild(grp);
    });

    return { viewport: vbX, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  }

  // ============================================================
  // SEQUENCE RENDERING (hand-rolled)
  // ============================================================
  function renderSequence(svg, sq) {
    const PADX = 40, PADTOP = 60, ROWH = 44, ACTOR_W = 140, ACTOR_H = 36, LIFELINE_BOTTOM_PAD = 40;
    const actorX = new Map();
    sq.actors.forEach((a, i) => actorX.set(a.id, PADX + ACTOR_W / 2 + i * (ACTOR_W + 60)));

    // Compute messages y
    const msgs = sq.messages.map((m, i) => ({ ...m, y: PADTOP + i * ROWH }));

    const maxBottomY = msgs.length > 0 ? msgs[msgs.length - 1].y : PADTOP;
    const lifelineBottom = maxBottomY + LIFELINE_BOTTOM_PAD;
    const totalH = lifelineBottom + 20;
    const totalW = (sq.actors.length * (ACTOR_W + 60)) + PADX;

    const vbX = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    vbX.setAttribute('class', 'cg-viewport');
    svg.appendChild(vbX);

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="cg-seq-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#555"/></marker>
      <marker id="cg-seq-dashed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#888"/></marker>
      <marker id="cg-seq-async" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5" stroke="#555" stroke-width="2" fill="none"/></marker>
    `;
    vbX.appendChild(defs);

    // Actors (top headers)
    sq.actors.forEach(a => {
      const x = actorX.get(a.id);
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      grp.setAttribute('class', 'cg-actor');
      grp.setAttribute('data-id', a.id);
      grp.setAttribute('data-loc', sq.locs?.actors?.[a.id] ? 'true' : 'false');
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x - ACTOR_W / 2); r.setAttribute('y', PADTOP - ACTOR_H - 12);
      r.setAttribute('width', ACTOR_W); r.setAttribute('height', ACTOR_H);
      r.setAttribute('rx', 4);
      grp.appendChild(r);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', PADTOP - ACTOR_H / 2 - 12);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = a.name;
      grp.appendChild(text);
      vbX.appendChild(grp);
    });

    // Lifelines
    sq.actors.forEach(a => {
      const x = actorX.get(a.id);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'cg-lifeline');
      line.setAttribute('x1', x); line.setAttribute('y1', PADTOP - 12);
      line.setAttribute('x2', x); line.setAttribute('y2', lifelineBottom);
      vbX.appendChild(line);
    });

    // Messages
    msgs.forEach((m, i) => {
      const fromX = actorX.get(m.from);
      const toX = actorX.get(m.to);
      const isSelf = m.from === m.to;
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      let cls = 'cg-msg';
      if (m.style === 'return') cls += ' cg-return';
      if (m.style === 'async') cls += ' cg-async';
      grp.setAttribute('class', cls);
      grp.setAttribute('data-idx', i);
      grp.setAttribute('data-loc', sq.locs?.messages?.[i] ? 'true' : 'false');

      if (isSelf) {
        const loop = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const offset = 24;
        loop.setAttribute('class', 'cg-self-loop');
        loop.setAttribute('d',
          `M ${fromX},${m.y} L ${fromX + offset},${m.y} L ${fromX + offset},${m.y + 14} L ${fromX},${m.y + 14}`);
        loop.setAttribute('marker-end', 'url(#cg-seq-solid)');
        grp.appendChild(loop);
      } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x1 = fromX < toX ? fromX + 1 : fromX - 1;
        const x2 = fromX < toX ? toX - 1 : toX + 1;
        path.setAttribute('d', `M ${x1},${m.y} L ${x2},${m.y}`);
        const marker = m.style === 'return' ? 'cg-seq-dashed' : (m.style === 'async' ? 'cg-seq-async' : 'cg-seq-solid');
        path.setAttribute('marker-end', `url(#${marker})`);
        if (m.style === 'return') path.style.strokeDasharray = '5 3';
        grp.appendChild(path);
      }

      // Text
      const midX = (fromX + toX) / 2;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', midX);
      text.setAttribute('y', m.y - 6);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = m.text;
      grp.appendChild(text);

      vbX.appendChild(grp);
    });

    // Notes
    if (sq.notes) {
      sq.notes.forEach(n => {
        const x = actorX.get(n.actor);
        const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        grp.setAttribute('class', 'cg-note');
        // Find a y — pick top of diagram for simplicity
        const y = PADTOP;
        const w = 100, h = 30;
        const nx = n.position === 'over' ? x - w / 2 : (n.position === 'left' ? x - w - 10 : x + 10);
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', nx); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        grp.appendChild(r);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', nx + w / 2);
        t.setAttribute('y', y + h / 2);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'middle');
        t.textContent = n.text;
        grp.appendChild(t);
        vbX.appendChild(grp);
      });
    }

    return {
      viewport: vbX,
      bbox: { x: 0, y: 0, w: totalW, h: totalH },
    };
  }

  // ============================================================
  // WIRE UP TABS & CANVAS
  // ============================================================
  const tabsBar = document.getElementById('tabs');
  const fcTab = document.getElementById('tab-flowchart');
  const sqTab = document.getElementById('tab-sequence');

  const fcSvg = document.getElementById('svg-flowchart');
  const sqSvg = document.getElementById('svg-sequence');

  const state = {
    current: null,
    viewports: {},     // tab-name -> { viewport, bbox }
    transforms: {},    // tab-name -> { scale, tx, ty }
  };

  if (data.flowchart) {
    const r = renderFlowchart(fcSvg, data.flowchart);
    state.viewports.flowchart = r;
    state.transforms.flowchart = fitTransform(r.bbox);
    fcTab.classList.remove('hidden');
  } else {
    fcTab.classList.add('hidden');
    fcSvg.style.display = 'none';
  }

  if (data.sequence) {
    const r = renderSequence(sqSvg, data.sequence);
    state.viewports.sequence = r;
    state.transforms.sequence = fitTransform(r.bbox);
    sqTab.classList.remove('hidden');
  } else {
    sqTab.classList.add('hidden');
    sqSvg.style.display = 'none';
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

  // Initial view
  if (data.flowchart) switchTo('flowchart');
  else if (data.sequence) switchTo('sequence');

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
      // Edges don't carry locations in v1; ignore.
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

  // Hide loading state
  document.getElementById('loading').style.display = 'none';
})();
