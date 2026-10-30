# Class diagram example

This example maps CodeGraph's own build pipeline as a UML class diagram. The
source locations point at the real entry points in this repository, so it can be
validated and built from a checkout:

```bash
node skills/codegraph/scripts/validate.mjs \
  --mmd skills/codegraph/examples/class-diagram/graph.mmd \
  --locs skills/codegraph/examples/class-diagram/graph.locs.json \
  --repo .

node skills/codegraph/scripts/build-html.mjs \
  --mmd skills/codegraph/examples/class-diagram/graph.mmd \
  --locs skills/codegraph/examples/class-diagram/graph.locs.json \
  --repo . \
  --out /tmp/class-diagram.html
```
