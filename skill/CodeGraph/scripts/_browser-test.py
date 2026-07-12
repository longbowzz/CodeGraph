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

    print(f"dagre defined: {dagre_defined}")
    print(f"#svg-flowchart <g> children: {fc_svg_children}")
    print(f"#svg-sequence <g> children: {sq_svg_children}")
    print(f".cg-node count: {nodes}")
    print(f".cg-edge count: {edges}")
    print(f".cg-msg count: {msgs}")
    print(f".cg-actor count: {actors}")

    print("\n--- console logs ---")
    for l in logs:
        print(l)
    print("\n--- page errors ---")
    for e in errors:
        print(e)

    browser.close()

sys.exit(1 if errors else 0)
