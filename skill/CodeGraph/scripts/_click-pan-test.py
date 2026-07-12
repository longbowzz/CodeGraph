#!/usr/bin/env python3
"""Focused tests for pan and click-jump URL."""
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

    # Enable test capture mode in render.js
    page.evaluate("window.__cg_captureUrl = true")

    # Pick any clickable element: flowchart node, sequence actor, or sequence message
    clickable_selector = '.cg-node[data-loc="true"], .cg-actor[data-loc="true"], .cg-msg[data-loc="true"]'

    # ---- Click test ----
    print("=== Click on first clickable element ===")
    page.eval_on_selector(clickable_selector, "(el) => el.dispatchEvent(new MouseEvent('click', {bubbles: true}))")
    page.wait_for_timeout(300)
    captured = page.evaluate("window.__cg_lastUrl")
    print(f"captured URL: {captured}")
    assert captured and captured.startswith("vscode://"), f"expected vscode:// URL, got: {captured}"
    print("OK")

    # ---- Switch editor to cursor, click again ----
    print("\n=== Switch to Cursor editor + click ===")
    page.select_option("#editor-select", "cursor")
    page.evaluate("window.__cg_lastUrl = null")
    page.eval_on_selector(clickable_selector, "(el) => el.dispatchEvent(new MouseEvent('click', {bubbles: true}))")
    page.wait_for_timeout(300)
    captured = page.evaluate("window.__cg_lastUrl")
    print(f"captured URL: {captured}")
    assert captured and captured.startswith("cursor://"), f"expected cursor:// URL, got: {captured}"
    print("OK")

    # ---- Pan test: real drag via dispatchEvent ----
    print("\n=== Pan via synthesized pointer events ===")
    vp_selector = ".cg-viewport"  # only the active tab's viewport is visible
    transform_before = page.eval_on_selector(vp_selector, "e => e.getAttribute('transform')")
    page.evaluate("""() => {
        const wrap = document.getElementById('canvas-wrap');
        const r = wrap.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const pd = new PointerEvent('pointerdown', {bubbles: true, clientX: cx, clientY: cy, pointerId: 1});
        wrap.dispatchEvent(pd);
        for (let i = 1; i <= 5; i++) {
            const pm = new PointerEvent('pointermove', {bubbles: true, clientX: cx + i*12, clientY: cy + i*12, pointerId: 1});
            wrap.dispatchEvent(pm);
        }
        const pu = new PointerEvent('pointerup', {bubbles: true, clientX: cx+60, clientY: cy+60, pointerId: 1});
        wrap.dispatchEvent(pu);
    }""")
    page.wait_for_timeout(200)
    transform_after = page.eval_on_selector(vp_selector, "e => e.getAttribute('transform')")
    print(f"before: {transform_before}")
    print(f"after:  {transform_after}")
    assert transform_before != transform_after, "pan did not update transform"
    print("OK")

    # ---- Zoom test (wheel) ----
    print("\n=== Zoom via wheel ===")
    transform_before = page.eval_on_selector(vp_selector, "e => e.getAttribute('transform')")
    page.mouse.move(640, 400)
    page.mouse.wheel(0, -300)
    page.wait_for_timeout(200)
    transform_after = page.eval_on_selector(vp_selector, "e => e.getAttribute('transform')")
    print(f"before: {transform_before}")
    print(f"after:  {transform_after}")
    assert transform_before != transform_after, "zoom did not update transform"
    print("OK")

    print(f"\n=== Page errors ({len(errors)}) ===")
    for e in errors:
        print(f"  {e}")

    browser.close()
sys.exit(1 if errors else 0)
