#!/usr/bin/env python3
"""Browser test for generated CodeGraph HTML."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML = Path(sys.argv[1]).resolve()
URL = HTML.as_uri()

errors = []
logs = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
    page.on("pageerror", lambda exc: errors.append(f"PAGEERROR: {exc}"))
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(1500)

    # Check that flowchart svg has children (rendered)
    fc_svg_children = page.eval_on_selector_all("#svg-flowchart > g", "els => els.length")
    sq_svg_children = page.eval_on_selector_all("#svg-sequence > g", "els => els.length")
    nodes = page.eval_on_selector_all(".cg-node", "els => els.length")
    edges = page.eval_on_selector_all(".cg-edge", "els => els.length")
    msgs = page.eval_on_selector_all(".cg-msg", "els => els.length")
    actors = page.eval_on_selector_all(".cg-actor", "els => els.length")

    # Check dagre global defined
    dagre_defined = page.evaluate("typeof dagre !== 'undefined'")

    # Review-mode checks (only when data.review is present)
    has_review = page.evaluate('''
        const data = JSON.parse(document.getElementById('cg-data').textContent);
        !!data.review;
    ''')
    legend_visible = page.eval_on_selector("#cg-diff-legend", "el => el && el.classList.contains('visible')")
    diff_nodes = page.eval_on_selector_all('[data-diff]', 'els => els.length')

    print(f"dagre defined: {dagre_defined}")
    print(f"#svg-flowchart <g> children: {fc_svg_children}")
    print(f"#svg-sequence <g> children: {sq_svg_children}")
    print(f".cg-node count: {nodes}")
    print(f".cg-edge count: {edges}")
    print(f".cg-msg count: {msgs}")
    print(f".cg-actor count: {actors}")
    print(f"review mode: {has_review}")
    print(f"legend visible: {legend_visible}")
    print(f"data-diff count: {diff_nodes}")

    if has_review:
        if not legend_visible:
            errors.append("Review mode enabled but #cg-diff-legend is not visible")
        if diff_nodes == 0:
            errors.append("Review mode enabled but no [data-diff] elements found")

    print("\n--- console logs ---")
    for l in logs:
        print(l)
    print("\n--- page errors ---")
    for e in errors:
        print(e)

    browser.close()

sys.exit(1 if errors else 0)
