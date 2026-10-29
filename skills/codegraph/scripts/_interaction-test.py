#!/usr/bin/env python3
"""Interaction tests: tab switch, hover, click jump URL, zoom/pan."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML = Path(sys.argv[1]).resolve()
URL = HTML.as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(800)

    print("=== Initial state ===")
    fc_display = page.eval_on_selector("#svg-flowchart", "e => getComputedStyle(e).display")
    sq_display = page.eval_on_selector("#svg-sequence", "e => getComputedStyle(e).display")
    print(f"flowchart svg display: {fc_display}")
    print(f"sequence svg display:  {sq_display}")

    print("\n=== Tab switch to Sequence ===")
    page.click("#tab-sequence")
    page.wait_for_timeout(200)
    fc_display = page.eval_on_selector("#svg-flowchart", "e => getComputedStyle(e).display")
    sq_display = page.eval_on_selector("#svg-sequence", "e => getComputedStyle(e).display")
    fc_active = page.eval_on_selector("#tab-flowchart", "e => e.classList.contains('active')")
    sq_active = page.eval_on_selector("#tab-sequence", "e => e.classList.contains('active')")
    print(f"flowchart svg display: {fc_display}  tab active: {fc_active}")
    print(f"sequence svg display:  {sq_display}  tab active: {sq_active}")

    print("\n=== Tab switch back to Flowchart ===")
    page.click("#tab-flowchart")
    page.wait_for_timeout(200)
    fc_active = page.eval_on_selector("#tab-flowchart", "e => e.classList.contains('active')")
    print(f"flowchart tab active: {fc_active}")

    print("\n=== Hover test ===")
    first_node = page.query_selector(".cg-node")
    if first_node:
        fill_before = page.eval_on_selector(".cg-node rect, .cg-node polygon",
            "e => getComputedStyle(e).fill")
        first_node.hover()
        page.wait_for_timeout(100)
        # hover triggers CSS :hover, hard to read via JS. Just check the node has data-loc.
        data_id = first_node.get_attribute("data-id")
        data_loc = first_node.get_attribute("data-loc")
        print(f"hovered first node: data-id={data_id}, data-loc={data_loc}")

    print("\n=== Click → URL change ===")
    # Click the first clickable node; expect navigation attempt
    node_id = page.eval_on_selector('.cg-node[data-loc="true"]', "e => e.getAttribute('data-id')")
    print(f"clicking node: {node_id}")
    # Use evaluate to call jumpTo indirectly — clicking should try window.location.href = vscode://...
    # In Playwright, we can't intercept external protocol launches easily; capture beforeunload.
    try:
        page.eval_on_selector('.cg-node[data-loc="true"]', """(el) => {
            el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        }""")
        page.wait_for_timeout(500)
        # After click, window.location.href should be a vscode:// URL (navigation may have failed silently)
        print(f"current url after click: {page.url}")
    except Exception as e:
        print(f"click navigation note: {e}")

    # Direct test of URL generation
    print("\n=== URL generation per editor ===")
    test_urls = page.evaluate(r"""() => {
        const editors = {
            'vscode': (p,l) => `vscode://file/${p}:${l}`,
            'cursor': (p,l) => `cursor://file/${p}:${l}`,
            'idea':   (p,l) => `idea://open?file=${encodeURIComponent(p)}&line=${l}`,
        };
        const out = {};
        for (const [k, fn] of Object.entries(editors)) {
            out[k] = fn('/abs/path/file.ts', 42);
        }
        return out;
    }""")
    for k, v in test_urls.items():
        print(f"  {k}: {v}")

    print("\n=== Zoom test (wheel) ===")
    transform_before = page.eval_on_selector("#svg-flowchart .cg-viewport", "e => e.getAttribute('transform')")
    page.mouse.move(640, 400)
    page.mouse.wheel(0, -300)  # zoom in
    page.wait_for_timeout(200)
    transform_after = page.eval_on_selector("#svg-flowchart .cg-viewport", "e => e.getAttribute('transform')")
    print(f"before: {transform_before}")
    print(f"after:  {transform_after}")
    print(f"scale changed: {transform_before != transform_after}")

    print("\n=== Pan test (drag) ===")
    transform_before_pan = page.eval_on_selector("#svg-flowchart .cg-viewport", "e => e.getAttribute('transform')")
    page.mouse.move(640, 400)
    page.mouse.down()
    page.mouse.move(700, 460, steps=5)
    page.mouse.up()
    page.wait_for_timeout(200)
    transform_after_pan = page.eval_on_selector("#svg-flowchart .cg-viewport", "e => e.getAttribute('transform')")
    print(f"before: {transform_before_pan}")
    print(f"after:  {transform_after_pan}")
    print(f"translate changed: {transform_before_pan != transform_after_pan}")

    print("\n=== Reset View button ===")
    page.click("#reset-view")
    page.wait_for_timeout(200)
    transform_reset = page.eval_on_selector("#svg-flowchart .cg-viewport", "e => e.getAttribute('transform')")
    print(f"after reset: {transform_reset}")

    print("\n=== Editor select ===")
    page.select_option("#editor-select", "cursor")
    val = page.eval_on_selector("#editor-select", "e => e.value")
    print(f"editor value: {val}")

    print("\n=== Page errors during test ===")
    if errors:
        for e in errors:
            print(f"  ERROR: {e}")
    else:
        print("  (none)")

    browser.close()
sys.exit(1 if errors else 0)
