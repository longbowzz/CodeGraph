// Official Mermaid grammar, with one flowchart and/or sequence document, or one class diagram, per file.
import { parseDiagram } from '../vendor/mermaid-parser.bundle.mjs';

export class ParseError extends Error {
  constructor(line, message) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
  }
}

function diagnostic(error, offset = 0) {
  const line = Number(error.hash?.loc?.first_line) ||
    Number(/(?:line|Line)\s+(\d+)/.exec(error.message)?.[1]) || 1;
  return new ParseError(offset + line, error.message || String(error));
}

export async function parseMermaid(text) {
  const source = String(text).replace(/\r\n?/g, '\n');
  const result = { flowchart: null, sequence: null, classDiagram: null };
  let splitError;
  let duplicateTypes = false;
  const lines = source.split('\n');
  const header = /^\s*(?:(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b|sequenceDiagram\b|classDiagram(?:-v2)?\b)/;
  const headerType = (line) => {
    if (/^\s*(?:flowchart|graph)\b/.test(line)) return 'flowchart';
    if (/^\s*sequenceDiagram\b/.test(line)) return 'sequence';
    if (/^\s*classDiagram(?:-v2)?\b/.test(line)) return 'classDiagram';
    return null;
  };
  const cuts = [];
  for (let i = 1; i < lines.length; i++) if (header.test(lines[i])) cuts.push(i);
  const headerCount = lines.filter((line) => header.test(line)).length;

  const normalize = (type) => type === 'class' ? 'classDiagram' : type;
  const assign = async (boundaries) => {
    const starts = [0, ...boundaries];
    const ends = [...boundaries, lines.length];
    const slices = [];
    for (let i = 0; i < starts.length; i++) {
      const part = lines.slice(starts[i], ends[i]).join('\n');
      if (part.trim() === '') return null;
      try {
        const slice = await parseDiagram(part);
        const type = normalize(slice.type);
        const expected = headerType(lines[starts[i]]);
        if (expected !== null && type !== expected) return null;
        slices.push(slice);
      } catch (error) {
        if (error instanceof ParseError) {
          splitError = new ParseError(starts[i] + (Number(error.line) || 1), error.message);
        } else {
          splitError = diagnostic(error, starts[i]);
        }
        return null;
      }
    }
    if (headerCount > 0 && slices.length !== headerCount) return null;
    const types = slices.map((slice) => normalize(slice.type));
    if (new Set(types).size !== types.length) {
      duplicateTypes = true;
      return null;
    }
    if (types.some((type) => !['flowchart', 'sequence', 'classDiagram'].includes(type))) return null;
    for (const slice of slices) {
      const { type, ...model } = slice;
      result[normalize(type)] = model;
    }
    return result;
  };

  // A class diagram's grammar is permissive enough to swallow a following
  // flowchart/sequence header, so try explicit boundaries before whole-file
  // parsing. One boundary covers two diagrams; two cover all three.
  for (const boundary of cuts) {
    const assigned = await assign([boundary]);
    if (assigned) return assigned;
  }
  for (let a = 0; a < cuts.length; a++) {
    for (let b = a + 1; b < cuts.length; b++) {
      const assigned = await assign([cuts[a], cuts[b]]);
      if (assigned) return assigned;
    }
  }

  if (duplicateTypes) {
    throw new ParseError(1, 'Multiple diagrams of the same type are not supported in one file');
  }

  try {
    const parsed = await parseDiagram(source);
    const type = parsed.type === 'class' ? 'classDiagram' : parsed.type;
    const { type: _type, ...model } = parsed;
    result[type] = model;
    return result;
  } catch (error) {
    if (error instanceof ParseError) throw splitError instanceof ParseError ? splitError : error;
    throw splitError instanceof ParseError ? splitError : diagnostic(error);
  }
}
