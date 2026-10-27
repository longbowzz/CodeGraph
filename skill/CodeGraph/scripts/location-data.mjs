// Normalize graph.locs.json into a stable shape shared by validation and build.

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSequenceShape(value) {
  return isRecord(value) &&
    'actors' in value && 'messages' in value &&
    !('flowchart' in value) && !('sequence' in value);
}

function isFlatShape(value) {
  return isRecord(value) &&
    !('actors' in value) && !('messages' in value) &&
    !('flowchart' in value) && !('sequence' in value);
}

function shapeError(message, fixHint) {
  return Object.assign(new Error(message), {
    code: 'LOCS_SHAPE_MISMATCH',
    fix_hint: fixHint,
  });
}

function readFlowchart(value) {
  if (!isRecord(value)) {
    throw shapeError('flowchart locations must be an object',
      'Use a node map or { "nodes": {...}, "edges": [...] }.');
  }

  // A legacy node may itself be named "nodes" or "edges" and hold a tuple.
  const structured = ('nodes' in value && !Array.isArray(value.nodes)) ||
    ('edges' in value && (!Array.isArray(value.edges) ||
      value.edges.length === 0 || isRecord(value.edges[0])));
  if (!structured) {
    return { nodes: value, edges: null };
  }

  if (!isRecord(value.nodes) || !Array.isArray(value.edges)) {
    throw shapeError(
      'structured flowchart locations require a nodes object and an edges array',
      'Use { "nodes": { "A": ["file", 1] }, "edges": [{ "from": "A", "to": "B", "occurrence": 1, "loc": ["file", 2] }] }.');
  }
  return { nodes: value.nodes, edges: value.edges };
}

function readSequence(value) {
  if (!isRecord(value) || !isRecord(value.actors) || !Array.isArray(value.messages)) {
    throw shapeError(
      'sequence locations require an actors object and a messages array',
      'Use { "actors": { "A": ["file", 1] }, "messages": [["file", 2]] }.');
  }
  return {
    actors: value.actors,
    messages: value.messages,
  };
}

export function normalizeLocations(parsed, raw) {
  if (!isRecord(raw)) {
    throw shapeError('graph.locs.json must be an object',
      'Use a flowchart or sequence location object.');
  }

  let flowchart = null;
  let sequence = null;
  if (parsed.flowchart && parsed.sequence) {
    if (!raw.flowchart || !raw.sequence) {
      throw shapeError(
        "graph.mmd contains both flowchart and sequence, but graph.locs.json does not have 'flowchart' and 'sequence' wrappers",
        'Use the wrapper form: { "flowchart": {...flat...}, "sequence": { "actors": {...}, "messages": [...] } }.');
    }
    flowchart = readFlowchart(raw.flowchart);
    sequence = readSequence(raw.sequence);
  } else if (parsed.flowchart) {
    if (raw.flowchart && !raw.sequence) {
      flowchart = readFlowchart(raw.flowchart);
    } else if (isFlatShape(raw)) {
      flowchart = readFlowchart(raw);
    } else {
      throw shapeError(
        'graph.mmd has only a flowchart; graph.locs.json must be flat { "<id>": [file, line] } or { "flowchart": {...} }',
        'Use the flat form shown in SKILL.md §4.1.');
    }
  } else if (parsed.sequence) {
    if (raw.sequence && !raw.flowchart) {
      sequence = readSequence(raw.sequence);
    } else if (isSequenceShape(raw)) {
      sequence = readSequence(raw);
    } else {
      throw shapeError(
        'graph.mmd has only a sequence; graph.locs.json must be { "actors": {...}, "messages": [...] } or { "sequence": {...} }',
        'Use the sequence form shown in SKILL.md §4.2.');
    }
  }

  return { flowchart, sequence };
}
