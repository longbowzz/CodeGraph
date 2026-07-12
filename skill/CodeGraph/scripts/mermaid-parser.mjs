// mermaid-parser.mjs
// Recursive-descent parser for the CodeGraph Mermaid subset.
// Spec: skill/CodeGraph/SKILL.md §3 (Mermaid Subset Contract)
//
// Exports:
//   parseMermaid(text): { flowchart?, sequence? }
//   throws ParseError on any out-of-subset syntax or malformed input.

export class ParseError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`);
    this.line = line;
    this.message = message;
  }
}

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*/;
// Forbidden raw chars in labels (use HTML entities instead — they don't trip the parser).
const FORBIDDEN_LABEL_CHARS = /[{}\]|]/;

function isBlank(s) {
  return s === undefined || s.trim() === '';
}

// ---------- Flowchart ----------

function parseFlowchartLine(rawLine, lineNum) {
  // Tokenize, then interpret as a chain.
  const line = rawLine.replace(/\s+$/g, '');
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }

    // arrows
    if (line.startsWith('-.->', i)) {
      tokens.push({ kind: 'arrow', style: 'dashed' });
      i += 4;
      continue;
    }
    if (line.startsWith('-->', i)) {
      tokens.push({ kind: 'arrow', style: 'solid' });
      i += 3;
      continue;
    }

    // edge label |...|
    if (c === '|') {
      const end = line.indexOf('|', i + 1);
      if (end === -1) throw new ParseError(lineNum, `unterminated |label|`);
      const text = line.slice(i + 1, end).trim();
      if (!text) throw new ParseError(lineNum, `empty |label|`);
      tokens.push({ kind: 'edgelabel', text });
      i = end + 1;
      continue;
    }

    // identifier + optional shape
    const m = ID_RE.exec(line.slice(i));
    if (!m) {
      throw new ParseError(lineNum, `unexpected char ${JSON.stringify(c)} at column ${i + 1}`);
    }
    const id = m[0];
    i += id.length;
    // skip whitespace before shape
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;

    let shape = null;
    let label = null;
    if (i < line.length) {
      // Detect unsupported shape openers early with clear errors
      if (line.startsWith('[/', i) || line.startsWith('[\\', i)) {
        throw new ParseError(lineNum,
          `parallelogram shape '[/.../]' or '[\\...\\]' is not supported; use rectangle A[label] instead`);
      }
      if (line[i] === '(' && !line.startsWith('([', i)) {
        throw new ParseError(lineNum,
          `round node A(...) and circle A((...)) are not supported; use A[label] or A([label]) terminal`);
      }
      if (line.startsWith('{{', i) || (line[i] === '{' && line[i+1] === '{')) {
        throw new ParseError(lineNum,
          `hexagon shape '{{...}}' is not supported; use A[label] or A{label} decision`);
      }
      if (line.startsWith('[(', i)) {
        const end = line.indexOf(')]', i + 2);
        if (end === -1) throw new ParseError(lineNum, `unterminated '[(...)]'`);
        shape = 'storage';
        label = line.slice(i + 2, end);
        i = end + 2;
      } else if (line[i] === '[') {
        const end = line.indexOf(']', i + 1);
        if (end === -1) throw new ParseError(lineNum, `unterminated '[...]'`);
        shape = 'normal';
        label = line.slice(i + 1, end);
        i = end + 1;
      } else if (line[i] === '{') {
        const end = line.indexOf('}', i + 1);
        if (end === -1) throw new ParseError(lineNum, `unterminated '{...}'`);
        shape = 'decision';
        label = line.slice(i + 1, end);
        i = end + 1;
      } else if (line.startsWith('([', i)) {
        const end = line.indexOf('])', i + 2);
        if (end === -1) throw new ParseError(lineNum, `unterminated '([...])'`);
        shape = 'terminal';
        label = line.slice(i + 2, end);
        i = end + 2;
      }
    }

    if (label !== null) {
      if (FORBIDDEN_LABEL_CHARS.test(label)) {
        throw new ParseError(lineNum,
          `label ${JSON.stringify(label)} contains forbidden char ({, }, ], or |); ` +
          `use HTML entities &#123; &#125; &#93; &#124; instead`);
      }
    }
    tokens.push({ kind: 'node', id, shape, label });
  }

  // Interpret tokens: a chain of (node) (arrow edgelabel? node)*
  const nodes = [];
  const edges = [];
  let expectNode = true;
  let lastNode = null;
  let pendingArrow = null; // {style}
  let pendingLabel = null;

  function emitNode(t) {
    const existing = nodes.find(n => n.id === t.id);
    if (!existing) {
      nodes.push({ id: t.id, shape: t.shape, label: t.label, line: lineNum });
    } else {
      // Re-declaration allowed only if consistent (shape/label match) or purely reference (shape=null).
      if (t.shape !== null) {
        if (existing.shape !== null && (existing.shape !== t.shape || existing.label !== t.label)) {
          throw new ParseError(lineNum,
            `node '${t.id}' redeclared with different shape/label`);
        }
        existing.shape = t.shape;
        existing.label = t.label;
      }
    }
    return existing || nodes[nodes.length - 1];
  }

  for (const t of tokens) {
    if (expectNode) {
      if (t.kind === 'edgelabel') {
        // |text| between arrow and target node — Mermaid style `A -->|text| B`
        if (!pendingArrow) throw new ParseError(lineNum, `|label| without arrow`);
        pendingLabel = t.text;
        continue;
      }
      if (t.kind !== 'node') {
        throw new ParseError(lineNum, `expected node id, got ${t.kind}`);
      }
      const n = emitNode(t);
      if (pendingArrow) {
        if (!lastNode) throw new ParseError(lineNum, `edge without source`);
        edges.push({
          from: lastNode.id,
          to: n.id,
          style: pendingArrow.style,
          label: pendingLabel || null,
          line: lineNum,
        });
        pendingArrow = null;
        pendingLabel = null;
      }
      lastNode = n;
      expectNode = false;
    } else {
      // expect arrow
      if (t.kind === 'arrow') {
        pendingArrow = { style: t.style };
        expectNode = true;
      } else if (t.kind === 'edgelabel') {
        throw new ParseError(lineNum, `|label| must come after an arrow, not before`);
      } else {
        throw new ParseError(lineNum, `expected arrow, got ${t.kind}`);
      }
    }
  }

  if (pendingArrow) {
    throw new ParseError(lineNum, `dangling arrow at end of line`);
  }

  return { nodes, edges };
}

// ---------- Sequence ----------

function parseSequenceLine(rawLine, lineNum) {
  const line = rawLine.trim();
  if (!line) return null;

  // participant <id> as <name>
  {
    const m = /^participant\s+([A-Za-z][A-Za-z0-9_]*)\s+as\s+(.+)$/.exec(line);
    if (m) {
      const name = m[2].trim();
      if (FORBIDDEN_LABEL_CHARS.test(name)) {
        throw new ParseError(lineNum, `actor display name contains forbidden char`);
      }
      return { kind: 'participant', id: m[1], name, line: lineNum };
    }
  }
  // bare "participant X" (without as) is rejected
  {
    const m = /^participant\s+([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(line);
    if (m) {
      throw new ParseError(lineNum,
        `participant must use 'participant <id> as <displayName>' form`);
    }
  }
  // Note left of A: text / right of A / over A
  {
    const m = /^Note\s+(left of|right of|over)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(line);
    if (m) {
      return {
        kind: 'note',
        position: m[1].replace(' of', ''),
        actor: m[2],
        text: m[3].trim(),
        line: lineNum,
      };
    }
  }
  // control-block openers: loop / opt / alt
  {
    const m = /^(loop|opt|alt)\s+(.+)$/.exec(line);
    if (m) return { kind: 'block-open', block: m[1], label: m[2].trim(), line: lineNum };
  }
  // else inside alt
  {
    const m = /^else\s+(.+)$/.exec(line);
    if (m) return { kind: 'block-else', label: m[1].trim(), line: lineNum };
  }
  // end
  if (line === 'end') return { kind: 'block-end', line: lineNum };

  // messages: A->>B: text  /  A-->>B: text  /  A-)B: text
  for (const style of [
    { tok: '-->>', style: 'return' },
    { tok: '->>',  style: 'sync' },
    { tok: '-)',  style: 'async' },
  ]) {
    const idx = line.indexOf(style.tok);
    if (idx > 0) {
      const from = line.slice(0, idx).trim();
      if (!ID_RE.test(from)) break;
      const rest = line.slice(idx + style.tok.length);
      const colon = rest.indexOf(':');
      if (colon === -1) {
        throw new ParseError(lineNum, `message missing ': text' after arrow`);
      }
      const to = rest.slice(0, colon).trim();
      const text = rest.slice(colon + 1).trim();
      if (!ID_RE.test(to)) {
        throw new ParseError(lineNum, `invalid target actor ${JSON.stringify(to)}`);
      }
      if (FORBIDDEN_LABEL_CHARS.test(text)) {
        throw new ParseError(lineNum, `message text contains forbidden char`);
      }
      return {
        kind: 'message',
        from,
        to,
        style: style.style,
        text,
        line: lineNum,
      };
    }
  }

  throw new ParseError(lineNum, `unrecognized sequence line: ${JSON.stringify(line)}`);
}

// ---------- Block stack validator ----------

function validateBlockStructure(seqItems, lineNumOf) {
  const stack = [];
  for (const item of seqItems) {
    if (item.kind === 'block-open') {
      stack.push(item);
    } else if (item.kind === 'block-end') {
      if (stack.length === 0) {
        throw new ParseError(item.line, `'end' without matching block opener`);
      }
      const open = stack.pop();
      if (open.block === 'alt') {
        // alt may contain 'else' but no specific check needed; just close
      }
    }
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    throw new ParseError(open.line, `unclosed '${open.block}' block (missing 'end')`);
  }
}

// ---------- Top-level ----------

export function parseMermaid(text) {
  const lines = text.split(/\r?\n/);
  const result = { flowchart: null, sequence: null };

  let i = 0;
  while (i < lines.length) {
    // skip blanks
    while (i < lines.length && isBlank(lines[i])) i++;
    if (i >= lines.length) break;

    const header = lines[i].trim();
    const lineNum = i + 1;

    if (/^flowchart\s+(TD|LR)\s*$/.test(header)) {
      const direction = /TD/.test(header) ? 'TD' : 'LR';
      i++;
      const nodes = [];
      const edges = [];
      while (i < lines.length && !isBlank(lines[i]) &&
             !/^flowchart\s+(TD|LR)\s*$/.test(lines[i].trim()) &&
             !/^sequenceDiagram\s*$/.test(lines[i].trim())) {
        const line = lines[i];
        if (line.trim() === '') { i++; continue; }
        const { nodes: ln, edges: le } = parseFlowchartLine(line, i + 1);
        // merge
        for (const n of ln) {
          const ex = nodes.find(x => x.id === n.id);
          if (!ex) nodes.push(n);
          else {
            if (n.shape !== null) {
              if (ex.shape !== null && (ex.shape !== n.shape || ex.label !== n.label)) {
                throw new ParseError(i + 1, `node '${n.id}' redeclared with different shape/label`);
              }
              ex.shape = n.shape; ex.label = n.label;
            }
          }
        }
        edges.push(...le);
        i++;
      }
      if (result.flowchart) {
        throw new ParseError(lineNum, `multiple flowchart blocks not supported`);
      }
      result.flowchart = { direction, nodes, edges };
    } else if (/^sequenceDiagram\s*$/.test(header)) {
      i++;
      const seqItems = [];
      const actors = [];
      const messages = [];
      const notes = [];
      const blocks = [];
      while (i < lines.length && !isBlank(lines[i]) &&
             !/^flowchart\s+(TD|LR)\s*$/.test(lines[i].trim()) &&
             !/^sequenceDiagram\s*$/.test(lines[i].trim())) {
        const item = parseSequenceLine(lines[i], i + 1);
        if (item) {
          seqItems.push(item);
          if (item.kind === 'participant') {
            if (actors.find(a => a.id === item.id)) {
              throw new ParseError(item.line, `duplicate participant '${item.id}'`);
            }
            actors.push({ id: item.id, name: item.name, line: item.line });
          } else if (item.kind === 'message') {
            // actor existence check deferred (actor may be declared later in mermaid)
            messages.push({
              from: item.from, to: item.to, style: item.style,
              text: item.text, line: item.line,
            });
          } else if (item.kind === 'note') {
            notes.push({
              position: item.position, actor: item.actor,
              text: item.text, line: item.line,
            });
          } else if (item.kind === 'block-open') {
            blocks.push({ kind: item.block, label: item.label, startLine: item.line, endLine: null });
          } else if (item.kind === 'block-end') {
            // close deepest open block
            for (let k = blocks.length - 1; k >= 0; k--) {
              if (blocks[k].endLine === null) { blocks[k].endLine = item.line; break; }
            }
          }
        }
        i++;
      }
      validateBlockStructure(seqItems);
      // Now: in mermaid, actors used in messages can be auto-declared; but our subset
      // REQUIRES explicit participant declaration. Enforce.
      const declared = new Set(actors.map(a => a.id));
      for (const m of messages) {
        if (!declared.has(m.from)) {
          throw new ParseError(m.line, `actor '${m.from}' used in message but not declared as participant`);
        }
        if (!declared.has(m.to)) {
          throw new ParseError(m.line, `actor '${m.to}' used in message but not declared as participant`);
        }
      }
      if (result.sequence) {
        throw new ParseError(lineNum, `multiple sequence blocks not supported`);
      }
      result.sequence = { actors, messages, notes, blocks };
    } else {
      throw new ParseError(lineNum,
        `expected 'flowchart TD|LR' or 'sequenceDiagram' header, got ${JSON.stringify(header)}`);
    }
  }

  if (!result.flowchart && !result.sequence) {
    throw new ParseError(1, `empty or unrecognized input`);
  }
  return result;
}
