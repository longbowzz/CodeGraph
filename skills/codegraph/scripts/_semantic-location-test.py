#!/usr/bin/env python3
"""Semantic source navigation integration test.

Run with a Python that already has Playwright and Chromium installed:
    python3 -I skills/codegraph/scripts/_semantic-location-test.py
No dependencies are installed; all generated fixtures live in a temporary repo.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

SCRIPTS = Path(__file__).resolve().parent
TARGETS = (".cg-edge-line", ".cg-edge-hit", "text, foreignObject")


def edge_id(occurrence):
    return json.dumps(["A", "B", occurrence], separators=(",", ":"))


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def build(root, name, locs):
    loc_path = root / f"{name}.locs.json"
    loc_path.write_text(json.dumps(locs), encoding="utf-8")
    output = root / f"{name}.html"
    run("node", str(SCRIPTS / "build-html.mjs"),
        "--mmd", str(root / "graph.mmd"), "--locs", str(loc_path),
        "--repo", str(root), "--out", str(output))
    return output


def read_data(html):
    matches = list(re.finditer(
        r'(<script id="cg-data" type="application/json">)(.*?)(</script>)',
        html, re.DOTALL))
    assert len(matches) == 1, "expected one embedded cg-data block"
    match = matches[0]
    return match, json.loads(match.group(2))


def assert_flowchart_contract(flowchart, nodes, edges, edge_locs):
    assert flowchart["locs"] == nodes
    assert flowchart["edgeLocs"] == edge_locs
    actual_edges = flowchart["edges"]
    assert len(actual_edges) == len(edges), actual_edges
    for actual, required in zip(actual_edges, edges):
        # Official Mermaid retains additional metadata and may not expose line numbers.
        assert all(actual.get(key) == value for key, value in required.items()
                   if key != "line"), actual
        if "line" in required and actual.get("line") is not None:
            assert actual["line"] == required["line"], actual


def edge_target(page, occurrence, target):
    return page.locator(f".cg-edge[data-edge-id='{edge_id(occurrence)}']").locator(target)


def real_click(page, target):
    """Find an exposed part of the requested SVG element and use real input.

    Hit-path points are off the visible stroke; background points avoid text.
    Checking elementFromPoint prevents a different overlay from satisfying a test.
    """
    expect(target).to_have_count(1)
    point = target.evaluate("""el => {
        const matrix = el.getScreenCTM();
        const candidates = [];
        if (el.tagName.toLowerCase() === 'path') {
            const length = el.getTotalLength();
            for (let i = 12; i <= 88; i += 2) {
                const p = el.getPointAtLength(length * i / 100);
                const q = el.getPointAtLength(length * i / 100 + 0.1);
                const dx = q.x - p.x, dy = q.y - p.y;
                const norm = Math.hypot(dx, dy) || 1;
                const offsets = el.classList.contains('cg-edge-hit') ? [4, -4] : [0];
                for (const offset of offsets) {
                    candidates.push(new DOMPoint(p.x - dy / norm * offset,
                        p.y + dx / norm * offset).matrixTransform(matrix));
                }
            }
        } else {
            const box = el.getBBox();
            for (let yi = 1; yi < 100; yi += 2) {
                const fy = yi / 100;
                for (let xi = 1; xi < 100; xi += 2) {
                    const fx = xi / 100;
                    candidates.push(new DOMPoint(box.x + box.width * fx,
                        box.y + box.height * fy).matrixTransform(matrix));
                }
            }
        }
        for (const p of candidates) {
            const hit = document.elementFromPoint(p.x, p.y);
            if (hit === el || (el.localName === 'foreignObject' && el.contains(hit))) {
                return {x:p.x,y:p.y};
            }
        }
        return null;
    }""")
    assert point, (str(target), target.evaluate("""el => {
        const b = el.getBBox(); const r = el.getBoundingClientRect();
        return {bbox:[b.x,b.y,b.width,b.height],rect:[r.x,r.y,r.width,r.height],
            center:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};
    }"""))
    page.mouse.click(point["x"], point["y"])


def assert_jump(page, target, root, loc, sources):
    file, line = loc
    for editor in ("vscode", "cursor"):
        page.select_option("#editor-select", editor)
        page.locator("#reset-view").click()
        page.evaluate("window.__cg_lastUrl = null")
        real_click(page, target)
        actual = page.evaluate("window.__cg_lastUrl")
        expected = f"{editor}://file{root / file}:{line}"
        assert actual == expected, (target, actual, expected)

    page.select_option("#editor-select", "web")
    page.locator("#reset-view").click()
    # Clear prior output so a stale location cannot satisfy repeated clicks.
    page.evaluate("""() => {
        document.getElementById('code-pane-header').textContent = '';
        document.getElementById('code-pane-body').replaceChildren();
    }""")
    real_click(page, target)
    expect(page.locator("#code-pane-header")).to_contain_text(f"{file} · line {line} /")
    current = page.locator("#code-pane-body .cg-current-line")
    expect(current).to_have_count(1)
    expect(current).to_have_attribute("data-line", str(line))
    expect(current.locator(".cg-line-content")).to_have_text(sources[file].splitlines()[line - 1])
    expect(current).to_be_visible()
    assert page.locator('#code-pane-body [class^="hljs-"]').count() > 0
    assert page.locator("#code-pane-empty").count() == 0


def check_page(browser, html, root, sources, expected_locs, kind):
    context = browser.new_context(viewport={"width": 1600, "height": 1000}, offline=True)
    page = context.new_page()
    errors, requests = [], []
    page.on("request", lambda request: requests.append(request.url)
            if request.url.startswith(("http://", "https://")) else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(html.as_uri(), wait_until="load")
        expect(page.locator(".cg-node")).to_have_count(2, timeout=30000)
        expect(page.locator("#loading")).to_be_hidden()
        expect(page.locator("#cg-render-errors")).to_have_count(0)
        page.evaluate("window.__cg_captureUrl = true")
        expect(page.locator(".cg-edge-line")).to_have_count(2)
        # Count line bodies, since labels deliberately live in separate groups.
        paths = [edge_target(page, n, ".cg-edge-line").get_attribute("d") for n in (1, 2)]
        assert paths[0] != paths[1], "parallel edges were collapsed into the same route"
        for occurrence in (1, 2):
            for selector in TARGETS:
                target = edge_target(page, occurrence, selector)
                group = target.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' cg-edge ')][1]")
                expect(group).to_have_attribute("data-from", "A")
                expect(group).to_have_attribute("data-to", "B")
                expect(group).to_have_attribute("data-location-kind", kind)
                expect(group).to_have_attribute("data-loc", "true" if expected_locs else "false")
                if expected_locs:
                    assert_jump(page, target, root, expected_locs[occurrence - 1], sources)
                else:
                    page.select_option("#editor-select", "vscode")
                    page.locator("#reset-view").click()
                    page.evaluate("window.__cg_lastUrl = null")
                    real_click(page, target)
                    assert page.evaluate("window.__cg_lastUrl") is None, "empty exact map fell back to node"
                    page.select_option("#editor-select", "web")
                    page.locator("#reset-view").click()
                    page.locator('.cg-node[data-id="B"]').click()
                    before = page.locator("#code-pane").inner_html()
                    real_click(page, target)
                    assert page.locator("#code-pane").inner_html() == before, "empty exact map changed web location"
        assert not errors, errors
        assert not requests, requests
    finally:
        context.close()
    print(f"PASS {html.stem}: two parallel edges, real stroke/hit/label clicks, offline zero HTTP requests")


def main():
    with tempfile.TemporaryDirectory(prefix="codegraph-semantic-") as temp:
        root = Path(temp).resolve()
        run("git", "init", "--quiet", str(root))
        sources = {
            "main.py": "from worker import work\n\ndef start():\n    value = 20\n    value += 1\n\n    work(value)\n    return value\n\nstart()\n",
            "worker.py": "def work(value):\n    result = value * 2\n\n    result += 1\n    return result\n",
            "edge_only.py": "from worker import work\n\ndef alternate():\n    value = 40\n    value += 1\n    value += 1\n    value += 1\n\n    work(value)\n    return value\n\nalternate()\n",
        }
        for file, text in sources.items():
            (root / file).write_text(text, encoding="utf-8")
        # Execute real Python behavior; location targets are neither comments nor definitions.
        run(sys.executable, "-I", "-c",
            "import runpy,sys; sys.path.insert(0,sys.argv[1]); "
            "runpy.run_path(sys.argv[1]+'/main.py'); "
            "runpy.run_path(sys.argv[1]+'/edge_only.py')", str(root))
        nodes = {"A": ["main.py", 5], "B": ["worker.py", 4]}
        edges = [["main.py", 7], ["edge_only.py", 9]]
        assert len({3, 1, nodes["A"][1], nodes["B"][1], edges[0][1], edges[1][1]}) == 6
        (root / "graph.mmd").write_text(
            'flowchart LR\n    A["Increment input"]\n    B["Adjust result"]\n'
            '    A -->|primary call| B\n    A -->|alternate call| B\n', encoding="utf-8")
        structured = {"flowchart": {"nodes": nodes, "edges": [
            {"from": "A", "to": "B", "occurrence": n, "loc": loc}
            for n, loc in enumerate(edges, 1)
        ]}}
        exact = build(root, "exact", structured)
        match, data = read_data(exact.read_text(encoding="utf-8"))
        assert_flowchart_contract(data["flowchart"], nodes, [
            {"from": "A", "to": "B", "label": label, "style": "solid",
             "line": n + 3, "occurrence": n, "id": edge_id(n)}
            for n, label in enumerate(("primary call", "alternate call"), 1)
        ], {edge_id(n): loc for n, loc in enumerate(edges, 1)})
        assert data["files"] == sources, "edge-only source must be embedded verbatim"
        legacy = build(root, "legacy", {"flowchart": nodes})
        legacy_to = build(root, "legacy-target", {"flowchart": {"B": nodes["B"]}})
        for file in (legacy, legacy_to):
            _, old_data = read_data(file.read_text(encoding="utf-8"))
            assert "edgeLocs" not in old_data["flowchart"]
        # Tamper with the built HTML, retaining populated node locations and files.
        data["flowchart"]["edgeLocs"] = {}
        raw = exact.read_text(encoding="utf-8")
        payload = json.dumps(data).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        tampered = root / "empty-exact-map.html"
        tampered.write_text(raw[:match.start(2)] + payload + raw[match.end(2):], encoding="utf-8")
        unwrapped = build(root, "unwrapped", structured["flowchart"])
        _, unwrapped_data = read_data(unwrapped.read_text(encoding="utf-8"))
        assert_flowchart_contract(unwrapped_data["flowchart"], nodes, unwrapped_data["flowchart"]["edges"],
                                  {edge_id(n): loc for n, loc in enumerate(edges, 1)})
        sequence = 'sequenceDiagram\n    participant A as Caller\n    participant B as Worker\n    A->>B: invoke\n'
        sequence_locs = {"actors": nodes, "messages": [edges[1]]}
        (root / "graph.mmd").write_text(sequence, encoding="utf-8")
        sequence_html = build(root, "sequence", {"sequence": sequence_locs})
        _, sequence_data = read_data(sequence_html.read_text(encoding="utf-8"))
        assert sequence_data["flowchart"] is None
        assert sequence_data["sequence"]["locs"] == sequence_locs
        assert sequence_data["files"] == sources
        flow_text = 'flowchart LR\n    A["Increment input"]\n    B["Adjust result"]\n    A -->|primary call| B\n    A -->|alternate call| B\n'
        (root / "graph.mmd").write_text(flow_text + '\n' + sequence, encoding="utf-8")
        both_html = build(root, "both", {**structured, "sequence": sequence_locs})
        _, both_data = read_data(both_html.read_text(encoding="utf-8"))
        assert_flowchart_contract(both_data["flowchart"], nodes, [
            {key: edge[key] for key in ("from", "to", "label", "style", "occurrence", "id")}
            for edge in unwrapped_data["flowchart"]["edges"]
        ], unwrapped_data["flowchart"]["edgeLocs"])
        assert both_data["sequence"]["locs"] == sequence_locs
        assert both_data["files"] == sources
        print("PASS build/parser: six builds, tuple IDs, edge-only sources, unwrapped/legacy/sequence/both")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                check_page(browser, exact, root, sources, edges, "exact")
                check_page(browser, legacy, root, sources, [nodes["A"]] * 2, "approximate")
                check_page(browser, legacy_to, root, sources, [nodes["B"]] * 2, "approximate")
                check_page(browser, tampered, root, sources, None, "exact")
            finally:
                browser.close()
    print("PASS semantic location integration: 6 builds, 4 browser cases, real edge clicks; fixtures cleaned up")


if __name__ == "__main__":
    main()
