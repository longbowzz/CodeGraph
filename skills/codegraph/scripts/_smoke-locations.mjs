// Location format compatibility regressions. Run with node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocations } from './location-data.mjs';

const node = ['source.js', 1];
const nodes = { A: node };
const flow = { flowchart: {}, sequence: null };
const sequence = { flowchart: null, sequence: {} };

test('flow formats preserve explicit empty edges versus legacy fallback', () => {
  for (const input of [nodes, { flowchart: nodes }]) {
    assert.deepEqual(normalizeLocations(flow, input), {
      flowchart: { nodes, edges: null }, sequence: null,
    });
  }
  for (const input of [{ nodes, edges: [] }, { flowchart: { nodes, edges: [] } }]) {
    assert.deepEqual(normalizeLocations(flow, input), {
      flowchart: { nodes, edges: [] }, sequence: null,
    });
  }
});

test('reserved legacy node names remain node locations', () => {
  const legacy = { nodes: node, edges: node };
  assert.deepEqual(normalizeLocations(flow, legacy).flowchart, { nodes: legacy, edges: null });
});

test('sequence and both wrappers preserve message order', () => {
  const locations = { actors: nodes, messages: [node, ['other.js', 2]] };
  for (const input of [locations, { sequence: locations }]) {
    assert.deepEqual(normalizeLocations(sequence, input).sequence, locations);
  }
  assert.deepEqual(normalizeLocations({ flowchart: {}, sequence: {} }, {
    flowchart: { nodes, edges: [] }, sequence: locations,
  }), { flowchart: { nodes, edges: [] }, sequence: locations });
});

test('malformed structures fail with a location shape diagnostic', () => {
  for (const [parsed, input] of [
    [flow, null], [flow, []], [flow, { nodes: null, edges: [] }],
    [flow, { nodes }], [flow, { nodes, edges: {} }],
    [sequence, { actors: [], messages: [] }],
    [sequence, { actors: nodes, messages: {} }],
    [{ flowchart: {}, sequence: {} }, { flowchart: nodes }],
  ]) {
    assert.throws(() => normalizeLocations(parsed, input), error => {
      assert.equal(error.code, 'LOCS_SHAPE_MISMATCH');
      assert.ok(error.fix_hint);
      return true;
    });
  }
});
