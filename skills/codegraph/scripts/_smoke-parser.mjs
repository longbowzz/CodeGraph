// _smoke-parser.mjs — quick smoke tests for mermaid-parser.mjs
// Run: node skills/codegraph/scripts/_smoke-parser.mjs
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
    const r = await parseMermaid(c.text);
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

// Edge identities distinguish parallel edges and survive unrelated insertions.
const edgeText = `flowchart TD
A -->|first| B --> C
A -.->|second| B
A -->|first| B
B --> A
A --> A`;
const identities = (await parseMermaid(edgeText)).flowchart.edges.map(e => e.id);
const expectedIds = [
  '["A","B",1]', '["B","C",1]', '["A","B",2]',
  '["A","B",3]', '["B","A",1]', '["A","A",1]',
];
const inserted = (await parseMermaid(edgeText.replace('flowchart TD', 'flowchart TD\nX --> Y')))
  .flowchart.edges.slice(1).map(e => e.id);
if (JSON.stringify(identities) === JSON.stringify(expectedIds) &&
    JSON.stringify(inserted) === JSON.stringify(expectedIds)) {
  console.log('PASS  parallel, chain, reverse and self-loop edge identities');
  pass++;
} else {
  console.log('FAIL  edge identities', identities, inserted);
  fail++;
}

// Mainstream Mermaid flowchart syntax should parse into semantic graph elements.
for (const [name, header] of [
  ['graph LR alias', 'graph LR'],
  ['flowchart TB', 'flowchart TB'],
  ['flowchart BT', 'flowchart BT'],
  ['flowchart RL', 'flowchart RL'],
]) {
  try {
    const r = await parseMermaid(`${header}\nA --> B`);
    if (r.flowchart?.nodes.length === 2 && r.flowchart.edges.length === 1) {
      console.log(`PASS  ${name}`);
      pass++;
    } else {
      console.log(`FAIL  ${name} — unexpected semantic model`);
      fail++;
    }
  } catch (e) {
    console.log(`ERROR ${name} — ${e.message}`);
    fail++;
  }
}

const featureFlow = `flowchart LR
subgraph outer [Outer systems]
  A(Rounded) --> B((Circle))
  subgraph inner [Nested systems]
    B --> C{Decision}
  end
end
style A fill:#f9f
classDef hot fill:#f00
class C hot
linkStyle 0 stroke:#f00`;
try {
  const flow = (await parseMermaid(featureFlow)).flowchart;
  const ids = flow.nodes.map(n => n.id);
  const edgeIds = flow.edges.map(e => e.id);
  if (JSON.stringify(ids) === JSON.stringify(['A', 'B', 'C']) &&
      flow.edges.length === 2 && edgeIds.every(Boolean)) {
    console.log('PASS  shapes, nested subgraphs, styles and semantic node/edge extraction');
    pass++;
  } else {
    console.log('FAIL  flowchart features — unexpected semantic model', ids, edgeIds);
    fail++;
  }
} catch (e) {
  console.log(`ERROR flowchart features — ${e.message}`);
  fail++;
}

// Sequence constructs should not become actors or messages themselves.
const featureSequence = `sequenceDiagram
autonumber
A->>B: request
activate B
Note over A,B: processing
alt accepted
  B-->>A: accepted
else rejected
  B-->>A: rejected
end
par concurrent work
  A-)B: async event
and follow-up
  B->>A: follow-up
end
critical guarded work
  A->>B: guarded
option fallback
  B-->>A: fallback
end
break stop condition
  B-->>A: stop
end
deactivate B`;
try {
  const sequence = (await parseMermaid(featureSequence)).sequence;
  if (sequence.actors.length === 2 && sequence.messages.length === 8 &&
      sequence.messages.every(message => message.from && message.to)) {
    console.log('PASS  implicit actors, activation, notes, fragments and autonumber');
    pass++;
  } else {
    console.log('FAIL  sequence features — unexpected semantic model',
      sequence.actors.length, sequence.messages.length);
    fail++;
  }
} catch (e) {
  console.log(`ERROR sequence features — ${e.message}`);
  fail++;
}

// Document boundaries must not consume quoted labels or discard trailing input.
for (const [name, text, expected] of [
  ['multiline header-looking label', 'flowchart TD\nA["first\nsequenceDiagram\nlast"] --> B', ['flowchart']],
  ['comment quote before second diagram', 'flowchart TD\n%% " unmatched comment quote\nA --> B\n\nsequenceDiagram\nA->>B: work', ['flowchart', 'sequence']],
  ['reverse diagram order', 'sequenceDiagram\nA->>B: work\n\nflowchart LR\nA --> B', ['flowchart', 'sequence']],
]) {
  try {
    const result = await parseMermaid(text);
    if (expected.every(kind => result[kind])) {
      console.log(`PASS  ${name}`);
      pass++;
    } else {
      console.log(`FAIL  ${name} — missing diagram`);
      fail++;
    }
  } catch (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    fail++;
  }
}

// Keep negative coverage for genuinely malformed syntax only.
const invalid = [
  { name: 'third document rejected', text: 'flowchart TD\nA --> B\nsequenceDiagram\nA->>B: work\nflowchart LR\nC --> D' },
  { name: 'trailing junk rejected', text: 'flowchart TD\nA --> B\nsequenceDiagram\nA->>B: work\nnot valid Mermaid' },
  { name: 'unclosed loop', text: `sequenceDiagram\nloop retry\nA->>A: ping` },
  { name: 'message missing colon', text: `sequenceDiagram\nA->>B hi` },
];
for (const c of invalid) {
  try {
    await parseMermaid(c.text);
    console.log(`FAIL  ${c.name} — expected ParseError, got success`);
    fail++;
  } catch (e) {
    console.log(`PASS  ${c.name} (rejected: ${e.message})`);
    pass++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
