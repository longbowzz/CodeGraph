// _smoke-parser.mjs — quick smoke tests for mermaid-parser.mjs
// Run: node skill/CodeGraph/scripts/_smoke-parser.mjs
import { parseMermaid, ParseError } from './mermaid-parser.mjs';

const cases = [
  {
    name: 'flowchart basic',
    text: `flowchart TD
    A([接收登录请求]) --> B{已登录?}
    B -->|是| C[返回用户信息]
    B -->|否| D[验证密码]
    D --> E[生成 token]
    E --> C
    C --> F[(写审计日志)]`,
    expect: { nodes: 6, edges: 6 },
  },
  {
    name: 'sequence basic',
    text: `sequenceDiagram
    participant C as Client
    participant S as Server
    participant A as Auth
    C->>S: POST /login
    S->>A: verifyPassword()
    A-->>S: ok
    S->>S: generateToken()
    S-->>C: 200 + token`,
    expect: { actors: 3, messages: 5 },
  },
  {
    name: 'mixed both',
    text: `flowchart TD
    A([入口]) --> B[校验]

    sequenceDiagram
    participant A as Handler
    participant B as Service
    A->>B: process()
    B-->>A: result`,
    expect: { flowNodes: 2, flowEdges: 1, seqActors: 2, seqMessages: 2 },
  },
  {
    name: 'loop block',
    text: `sequenceDiagram
    participant A as Alice
    participant B as Bob
    loop retry 3 times
      A->>B: ping
      B-->>A: pong
    end`,
    expect: { actors: 2, messages: 2, blocks: 1 },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  try {
    const r = parseMermaid(c.text);
    const got = {};
    if (r.flowchart) {
      got.flowNodes = r.flowchart.nodes.length;
      got.flowEdges = r.flowchart.edges.length;
    }
    if (r.sequence) {
      got.seqActors = r.sequence.actors.length;
      got.seqMessages = r.sequence.messages.length;
      got.blocks = r.sequence.blocks.length;
    }
    if (r.flowchart && !c.expect.flowNodes) {
      got.nodes = r.flowchart.nodes.length;
      got.edges = r.flowchart.edges.length;
    }
    if (r.sequence && !c.expect.seqActors) {
      got.actors = r.sequence.actors.length;
      got.messages = r.sequence.messages.length;
      got.blocks = r.sequence.blocks?.length;
    }
    const ok = Object.entries(c.expect).every(([k, v]) => got[k] === v);
    if (ok) {
      console.log(`PASS  ${c.name}`);
      pass++;
    } else {
      console.log(`FAIL  ${c.name} — expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
      fail++;
    }
  } catch (e) {
    console.log(`ERROR ${c.name} — ${e.message}`);
    fail++;
  }
}

// Negative cases
const negs = [
  { name: 'subgraph forbidden', text: `flowchart TD\nsubgraph X\nA --> B\nend` },
  { name: 'activate forbidden', text: `sequenceDiagram\nparticipant A as A\nparticipant B as B\nA->>B: hi\nactivate B` },
  { name: 'autonumber forbidden', text: `sequenceDiagram\nautonumber\nparticipant A as A` },
  { name: 'bad node id with dash', text: `flowchart TD\nnode-a[hi] --> B` },
  { name: 'bare participant no as', text: `sequenceDiagram\nparticipant A` },
  { name: 'unclosed loop', text: `sequenceDiagram\nparticipant A as A\nloop x\nA->>A: y` },
  { name: 'unknown actor in message', text: `sequenceDiagram\nparticipant A as A\nA->>B: hi` },
  { name: 'label with unescaped ]', text: `flowchart TD\nA[foo] bar]` },
  { name: 'message missing colon', text: `sequenceDiagram\nparticipant A as A\nparticipant B as B\nA->>B hi` },
  // New: expanded forbidden-list coverage
  { name: 'graph TD header (not flowchart)', text: `graph TD\nA[x] --> B[y]` },
  { name: 'flowchart TB direction', text: `flowchart TB\nA[x] --> B[y]` },
  { name: 'flowchart RL direction', text: `flowchart RL\nA[x] --> B[y]` },
  { name: 'round node (paren)', text: `flowchart TD\nA(x) --> B[y]` },
  { name: 'circle node', text: `flowchart TD\nA((x)) --> B[y]` },
  { name: 'hexagon node', text: `flowchart TD\nA{{x}} --> B[y]` },
  { name: 'parallelogram node', text: `flowchart TD\nA[/x/] --> B[y]` },
  { name: 'thick edge', text: `flowchart TD\nA ==> B` },
  { name: 'single-dash arrow', text: `flowchart TD\nA -> B` },
  { name: 'label outside pipes', text: `flowchart TD\nA -- text --> B` },
  { name: 'no-arrowhead edge', text: `flowchart TD\nA --- B` },
  { name: 'bidirectional arrow', text: `flowchart TD\nA <-> B` },
  { name: 'style directive', text: `flowchart TD\nA[x]\nstyle A fill:#f00` },
  { name: 'classDef directive', text: `flowchart TD\nA[x]\nclassDef foo fill:#f00` },
  { name: 'click directive', text: `flowchart TD\nA[x]\nclick A callback` },
  { name: 'actor keyword', text: `sequenceDiagram\nactor A as Alice` },
  { name: 'par fragment', text: `sequenceDiagram\nparticipant A as A\npar x\nA->>A: y\nend` },
  { name: 'critical fragment', text: `sequenceDiagram\nparticipant A as A\ncritical x\nA->>A: y\nend` },
  { name: 'break fragment', text: `sequenceDiagram\nparticipant A as A\nbreak x\nA->>A: y\nend` },
  { name: 'create participant', text: `sequenceDiagram\nparticipant A as A\ncreate participant B as B` },
  { name: 'destroy actor', text: `sequenceDiagram\nparticipant A as A\ndestroy A` },
  { name: 'box directive', text: `sequenceDiagram\nbox foo\nparticipant A as A\nend` },
  { name: 'multi-actor Note over', text: `sequenceDiagram\nparticipant A as A\nparticipant B as B\nNote over A,B: hi` },
  { name: 'single-dash message arrow', text: `sequenceDiagram\nparticipant A as A\nparticipant B as B\nA->B: hi` },
  { name: 'dotted message arrow', text: `sequenceDiagram\nparticipant A as A\nparticipant B as B\nA-->B: hi` },
  { name: 'activation shorthand plus', text: `sequenceDiagram\nparticipant A as A\nparticipant B as B\nA->>+B: hi` },
  { name: 'links directive', text: `sequenceDiagram\nparticipant A as A\nlinks A: {"x": "y"}` },
  { name: 'mermaid comment line', text: `flowchart TD\n%% comment\nA[x] --> B[y]` },
];

for (const c of negs) {
  try {
    parseMermaid(c.text);
    console.log(`FAIL  ${c.name} — expected ParseError, got success`);
    fail++;
  } catch (e) {
    console.log(`PASS  ${c.name} (rejected: ${e.message})`);
    pass++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
