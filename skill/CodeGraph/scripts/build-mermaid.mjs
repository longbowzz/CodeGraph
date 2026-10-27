// Build pinned offline Mermaid bundles for CodeGraph.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'vendor');
mkdirSync(vendor, { recursive: true });
// Node only extracts semantic data; it never renders this unsanitized label text.
// Browser rendering bundles real DOMPurify and reparses source under strict mode.
const nodeOnly = { name: 'codegraph-node-parser', setup(b) {
  b.onResolve({ filter: /^dompurify$/ }, () => ({ path: 'dompurify', namespace: 'cg-parser' }));
  b.onLoad({ filter: /.*/, namespace: 'cg-parser' }, () => ({ contents:
    'export default { sanitize(value) { return String(value); }, addHook() {}, removeHook() {} };', loader: 'js' }));
  b.onLoad({ filter: /sequenceDiagram-.*\.mjs$/ }, ({ path }) => {
    // Box color validation is browser presentation; semantic actor membership
    // does not need CSS.supports / Option, neither of which exists in Node.
    const source = readFileSync(path, 'utf8');
    const anchor = /    if \(window\?\.CSS\) \{[\s\S]*?    const \{ wrap, cleanedText \} = this.extractWrap\(title\);/g;
    if ([...source.matchAll(anchor)].length !== 1) throw new Error('Mermaid Node box patch anchor changed');
    const contents = source.replace(anchor, '    const { wrap, cleanedText } = this.extractWrap(title);');
    return { contents, loader: 'js' };
  });
}};
const staleShim = resolve(vendor, '.dompurify-shim.mjs');
if (existsSync(staleShim)) unlinkSync(staleShim);

await build({
  entryPoints: [resolve(root, 'scripts/mermaid-adapter.mjs')],
  outfile: resolve(vendor, 'mermaid-parser.bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [nodeOnly],
  logLevel: 'warning',
});
await build({
  entryPoints: [resolve(root, 'scripts/mermaid-browser-entry.mjs')],
  outfile: resolve(vendor, 'mermaid.min.js'),
  bundle: true,
  format: 'iife',
  globalName: 'CodeGraphMermaidVendor',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'codegraph-semantic-identity', setup(b) {
    b.onLoad({ filter: /(?:dagre-|chunk-QXUST7PY).*\.mjs$/ }, ({ path }) => {
      let contents = readFileSync(path, 'utf8');
      const replace = (before, after) => {
        if (contents.split(before).length !== 2) throw new Error(`Mermaid flow patch anchor changed: ${before}`);
        contents = contents.replace(before, after);
      };
      if (path.includes('/dagre-')) {
        // Official dagre splits every self-loop into three cloned edges. Preserve
        // the DB id before cloning and key helper nodes/segments by this edge,
        // so parallel self-loops cannot overwrite each other in graphlib.
        replace('const nodeId = edge.start;', 'edge.cgOriginalEdgeId = edge.id;\n      const nodeId = edge.start;');
        replace('const specialId1 = nodeId + "---" + nodeId + "---1";', 'const specialId1 = edge.id + "---cg-loop-1";');
        replace('const specialId2 = nodeId + "---" + nodeId + "---2";', 'const specialId2 = edge.id + "---cg-loop-2";');
        for (const suffix of ['1', 'mid', '2']) replace(`= nodeId + "-cyclic-special-${suffix}";`, `= edge.id + "-cyclic-special-${suffix}";`);
        for (const suffix of ['0', '1']) replace(`, nodeId + "-cyclic-special-${suffix}");`, `, edge.id + "-cyclic-special-${suffix}");`);
        replace(', nodeId + "-cyc<lic-special-2");', ', edge.id + "-cyclic-special-2");');
      } else {
        // Both the edge path and its independent label retain official DB id.
        const before = '.attr("data-id", edge.id)';
        if (contents.split(before).length !== 3) throw new Error('Mermaid edge data-id patch anchors changed');
        contents = contents.replaceAll(before, '.attr("data-id", edge.cgOriginalEdgeId || edge.id)');
      }
      return { contents, loader: 'js' };
    });
    b.onLoad({ filter: /sequenceDiagram-.*\.mjs$/ }, async ({ path }) => {
      let contents = readFileSync(path, 'utf8');
      const replace = (before, after) => {
        if (contents.split(before).length !== 2) throw new Error(`Mermaid patch anchor changed: ${before}`);
        contents = contents.replace(before, after);
      };
      // Carry actual arrow indices from the official DB into the delayed render
      // model; autonumber, notes, activations, and fragments consume no index.
      replace('const messages = diagObj.db.getMessages();', `const messages = diagObj.db.getMessages();
  let cgIndex = 0;
  for (const message of messages) if ([0,1,3,4,5,6,24,25,33,34].includes(message.type)) message.cgIndex = cgIndex++;`);
      replace('msgModel = msg.msgModel;', 'msgModel = msg.msgModel; msgModel.cgIndex = msg.cgIndex;');
      replace('async function(diagram2, msgModel, lineStartY, diagObj) {', `async function(diagram2, msgModel, lineStartY, diagObj) {
  diagram2 = diagram2.append("g").attr("data-cg-message", msgModel.cgIndex);`);
      // All eight official actor shapes share this dispatcher; semantic name is
      // the DB actor id (description is only the display label).
      replace('async function(elem, actor, conf2, isFooter) {', `async function(elem, actor, conf2, isFooter) {
  elem = elem.append("g").attr("data-cg-actor", actor.name);`);
      return { contents, loader: 'js' };
    });
  }}],
  logLevel: 'warning',
});
const packageDir = resolve(root, '../../node_modules/mermaid');
const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
if (pkg.version !== '11.12.0') throw new Error('Expected pinned Mermaid 11.12.0');
writeFileSync(resolve(vendor, 'mermaid-LICENSE'), readFileSync(resolve(packageDir, 'LICENSE')));
const artifacts = ['mermaid.min.js', 'mermaid-parser.bundle.mjs', 'mermaid-LICENSE'];
const files = Object.fromEntries(artifacts.map(name => {
  const bytes = readFileSync(resolve(vendor, name));
  return [name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
}));
writeFileSync(resolve(vendor, 'mermaid-manifest.json'), JSON.stringify({
  name: 'mermaid', version: pkg.version, license: 'MIT',
  source: 'https://registry.npmjs.org/mermaid/-/mermaid-11.12.0.tgz',
  integrity: 'sha512-ZudVx73BwrMJfCFmSSJT84y6u5brEoV8DOItdHomNLz32uBjNrelm7mg95X7g+C6UoQH/W6mBLGDEDv73JdxBg==',
  build: 'npm ci --ignore-scripts && npm run build:mermaid',
  patches: ['Dagre self-loop clones preserve original DB edge id in path/label data-id; helper nodes and segment ids are unique per original edge.',
    'Sequence renderer carries arrow-only DB index into data-cg-message group; actor dispatcher wraps all actor shapes with data-cg-actor.',
    'Node-only DOMPurify identity shim for semantic extraction; Node box CSS validation omitted. Browser retains real DOMPurify and CSS validation.'],
  files,
}, null, 2) + '\n');
console.log('Built Mermaid 11.12.0 offline bundles and checksum manifest.');
