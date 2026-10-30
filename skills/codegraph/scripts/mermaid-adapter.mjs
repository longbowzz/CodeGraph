// Shared semantic extraction and browser rendering for the pinned official engine.
import mermaid from 'mermaid';

export const version = '11.12.0';
export const messageTypes = new Set([0, 1, 3, 4, 5, 6, 24, 25, 33, 34]);
export const MAX_TEXT_SIZE = 500000;
const config = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: MAX_TEXT_SIZE };

function checkSourceSize(source) {
  if (source.length > MAX_TEXT_SIZE) throw new Error(`Mermaid source exceeds ${MAX_TEXT_SIZE} characters`);
}

export async function parseDiagram(source) {
  checkSourceSize(source);
  mermaid.initialize(config);
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
  const db = diagram.db;
  if (diagram.type.startsWith('flowchart')) {
    const occurrences = new Map();
    const groups = new Set(db.getSubGraphs().map(group => group.id));
    return {
      type: 'flowchart', source, direction: db.getDirection() || 'TB',
      nodes: [...db.getVertices().values()].filter(n => !groups.has(n.id)).map(n => ({
        id: n.id, label: n.text ?? n.id, shape: n.type || 'square', domId: n.domId,
      })),
      edges: db.getEdges().map(e => {
        const pair = JSON.stringify([e.start, e.end]);
        const occurrence = (occurrences.get(pair) || 0) + 1;
        occurrences.set(pair, occurrence);
        return { from: e.start, to: e.end, occurrence,
          id: JSON.stringify([e.start, e.end, occurrence]), domId: e.id,
          label: e.text || null, style: e.stroke === 'dotted' ? 'dashed' : 'solid' };
      }),
    };
  }
  if (diagram.type === 'class' || diagram.type === 'classDiagram') {
    const relationTypes = { 0: 'aggregation', 1: 'extension', 2: 'composition', 3: 'dependency', 4: 'lollipop' };
    const relationKind = (relation) => {
      const ends = [relation.type1, relation.type2]
        .filter((value) => value !== 'none' && value !== undefined)
        .map((value) => relationTypes[value] || String(value));
      const kind = ends.length > 0 ? ends.join('-') : 'association';
      // Mermaid encodes both `-->` and `..>` as a dependency end; only the
      // dotted relation carries lineType 1. Keep the familiar UML distinction.
      if (kind === 'dependency' && relation.lineType !== 1) return 'association';
      return kind;
    };
    const occurrences = new Map();
    return {
      type: 'classDiagram', source, direction: db.getDirection() || 'TB',
      classes: [...db.getClasses().values()].map((klass) => ({
        id: klass.id, label: klass.label || klass.id, type: klass.type || '',
        domId: klass.domId,
        members: (klass.members || []).map((member) => member.text ?? String(member)),
        methods: (klass.methods || []).map((method) => method.text ?? String(method)),
        annotations: [...(klass.annotations || [])],
      })),
      relations: db.getRelations().map((relation) => {
        const from = relation.id1;
        const to = relation.id2;
        const kind = relationKind(relation.relation);
        const pair = JSON.stringify([from, to, kind]);
        const occurrence = (occurrences.get(pair) || 0) + 1;
        occurrences.set(pair, occurrence);
        return {
          from, to, kind, occurrence,
          id: JSON.stringify([from, to, kind, occurrence]),
          label: relation.title || '',
          dashed: relation.relation.lineType === 1,
        };
      }),
    };
  }
  if (diagram.type === 'sequence') {
    const events = db.getMessages();
    const blocks = [], stack = [];
    const starts = { 10: 'loop', 12: 'alt', 15: 'opt', 19: 'par', 22: 'rect', 27: 'critical', 30: 'break', 32: 'par' };
    const ends = new Set([11, 14, 16, 21, 23, 29, 31]);
    for (const event of events) {
      if (starts[event.type]) {
        const block = { kind: starts[event.type], label: event.message, startLine: null, endLine: null };
        blocks.push(block); stack.push(block);
      } else if (ends.has(event.type)) stack.pop();
    }
    return {
      type: 'sequence', source,
      actors: [...db.getActors()].map(([id, a]) => ({ id, name: a.description || a.name, type: a.type })),
      messages: events.filter(e => messageTypes.has(e.type)).map((e, index) => ({
        from: e.from, to: e.to, text: e.message, index,
        style: [1, 4, 6, 25, 34].includes(e.type) ? 'return' : [5, 6].includes(e.type) ? 'async' : 'sync',
      })),
      notes: events.filter(e => e.type === 2).map(e => ({ actor: e.from, actors: [e.from, e.to],
        position: ['left', 'right', 'over'][e.placement], text: e.message })),
      blocks,
    };
  }
  throw new Error(`CodeGraph supports flowchart and sequence diagrams, got ${diagram.type}`);
}

export async function render(id, source, options = {}) {
  const model = await parseDiagram(source);
  mermaid.initialize({ ...config, ...options, startOnLoad: false, securityLevel: 'strict', maxTextSize: MAX_TEXT_SIZE });
  const result = await mermaid.render(id, source);
  // Mermaid emits HTML void tags inside foreignObject labels. HTML parsing
  // preserves SVG namespaces while accepting that embedded label markup.
  const template = document.createElement('template');
  template.innerHTML = result.svg;
  const svg = template.content.querySelector('svg');
  // Source navigation belongs to CodeGraph even when the Mermaid source uses
  // click/link directives. Keep anchor contents without native navigation.
  for (const anchor of svg.querySelectorAll('a')) {
    anchor.removeAttribute('href');
    anchor.removeAttribute('xlink:href');
    anchor.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    anchor.removeAttribute('target');
  }
  if (model.type === 'flowchart') {
    const ids = new Map([...svg.querySelectorAll('[id]')].map(el => [el.id, el]));
    const edgeParts = new Map();
    for (const el of svg.querySelectorAll('[data-id]')) {
      const key = el.getAttribute('data-id');
      if (!edgeParts.has(key)) edgeParts.set(key, []);
      edgeParts.get(key).push(el);
    }
    for (const node of model.nodes) ids.get(node.domId)?.setAttribute('data-cg-node', node.id);
    for (const edge of model.edges) {
      for (const el of edgeParts.get(edge.domId) || []) {
        const target = el.closest('.edgeLabels > .edgeLabel') || el;
        target.setAttribute('data-cg-edge', edge.id);
      }
      ids.get(edge.domId)?.setAttribute('data-cg-edge', edge.id);
    }
  }
  if (model.type === 'classDiagram') {
    const ids = new Map([...svg.querySelectorAll('[id]')].map(el => [el.id, el]));
    const classNodes = [...svg.querySelectorAll('g.node')];
    for (const klass of model.classes) {
      const el = ids.get(klass.domId) || classNodes.find(node => node.id.startsWith(`classId-${klass.id}-`));
      if (!el) throw new Error(`Mermaid class node not found: ${klass.domId}`);
      el.setAttribute('data-cg-class', klass.id);
    }
    const relationPaths = [...svg.querySelectorAll('path.relation')];
    if (relationPaths.length !== model.relations.length) {
      throw new Error(`Mermaid class relation count changed: expected ${model.relations.length}, got ${relationPaths.length}`);
    }
    model.relations.forEach((relation, index) => {
      relationPaths[index].setAttribute('data-cg-relation', relation.id);
    });
  }
  return { svg: new XMLSerializer().serializeToString(svg) };
}
