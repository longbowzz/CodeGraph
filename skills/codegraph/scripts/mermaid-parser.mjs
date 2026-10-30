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
  // Always let the official grammar consume the entire input first. In
  // particular, a header-looking line inside a multiline label is just text.
  let wholeError;
  try {
    const parsed = await parseDiagram(source);
    const type = parsed.type === 'class' ? 'classDiagram' : parsed.type;
    const { type: _type, ...model } = parsed;
    result[type] = model;
    return result;
  } catch (error) { wholeError = error; }

  // Mermaid itself accepts one document. For CodeGraph's two-document format,
  // a boundary is valid only when the official parser accepts BOTH complete
  // slices and their diagram types differ. Quotes in comments / sequence text
  // cannot alter boundary detection, and no prefix or suffix is discarded.
  const lines = source.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*(?:(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b|sequenceDiagram\b|classDiagram(?:-v2)?\b)/.test(lines[i])) continue;
    try {
      const first = await parseDiagram(lines.slice(0, i).join('\n'));
      let second;
      try { second = await parseDiagram(lines.slice(i).join('\n')); }
      catch (error) { throw diagnostic(error, i); }
      if (first.type === second.type) throw new ParseError(i + 1, `Multiple ${first.type} diagrams are not supported in one file`);
      const firstType = first.type === 'class' ? 'classDiagram' : first.type;
      const secondType = second.type === 'class' ? 'classDiagram' : second.type;
      const { type: _firstType, ...firstModel } = first;
      const { type: _secondType, ...secondModel } = second;
      if (firstType === 'classDiagram' || secondType === 'classDiagram') {
        throw new ParseError(i + 1, 'A classDiagram cannot be combined with another diagram in one file');
      }
      result[firstType] = firstModel;
      result[secondType] = secondModel;
      return result;
    } catch (error) {
      // Prefer a diagnostic in a recognized second document to the whole-file
      // error at its header, while still trying later possible boundaries.
      if (error instanceof ParseError) wholeError = error;
    }
  }
  throw wholeError instanceof ParseError ? wholeError : diagnostic(wholeError);
}
