#!/usr/bin/env python3
"""Offline official-Mermaid browser fixtures; requires installed Playwright/Chromium.

Run: /path/to/python3 -I skill/CodeGraph/scripts/_mermaid-browser-test.py
All diagram/source/HTML fixtures are temporary; no target diagrams are modified.
"""
import json
import re
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

SCRIPTS = Path(__file__).resolve().parent
FLOW = '''flowchart LR
    subgraph group[Processing]
        A([Start]) -->|request| B{{Validate}}
        B -.-> C[(Store)]
        C ==> D((Done))
    end
    classDef emphasis fill:#d8ebff,stroke:#174a75,stroke-width:3px
    class B emphasis
    style C fill:#ffe9c7,stroke:#805400
    linkStyle 0 stroke:#8451a1,stroke-width:3px
'''
FLOW_DIRECTION = '''flowchart {direction}
    A[Start] --> B[Validate] --> C[Done]
'''
SEQUENCE = '''sequenceDiagram
    autonumber
    actor A as Caller
    participant B as Worker
    A->>+B: repeated request
    Note over A,B: request context
    loop retries
        B->>B: repeated request
        alt accepted
            B-->>A: repeated reply
        else rejected
            B-->>A: repeated reply
        end
    end
    opt audit
        A-)B: repeated request
    end
    B-->>-A: repeated reply
'''


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    assert result.returncode == 0, (args, result.stdout, result.stderr)
    return result.stdout


def build(root, name, source, locs):
    mmd, locations, html = (root / f'{name}.{ext}' for ext in ('mmd', 'locs.json', 'html'))
    mmd.write_text(source, encoding='utf-8')
    locations.write_text(json.dumps(locs), encoding='utf-8')
    args = ('--mmd', str(mmd), '--locs', str(locations), '--repo', str(root))
    validation = json.loads(run('node', str(SCRIPTS / 'validate.mjs'), *args))
    assert validation['ok'], validation
    run('node', str(SCRIPTS / 'build-html.mjs'), *args, '--out', str(html))
    return html


def rewrite_data(html, output, mutate):
    text = html.read_text(encoding='utf-8')
    match = re.search(r'(<script id="cg-data" type="application/json">)(.*?)(</script>)', text, re.S)
    assert match
    data = json.loads(match[2])
    mutate(data)
    payload = json.dumps(data).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    output.write_text(text[:match.start(2)] + payload + text[match.end(2):], encoding='utf-8')
    return output


def open_page(browser, html, color='light'):
    context = browser.new_context(viewport={'width': 1600, 'height': 1000},
                                  offline=True, color_scheme=color)
    page = context.new_page()
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url)
            if request.url.startswith(('http://', 'https://')) else None)
    page.goto(html.as_uri(), wait_until='load')
    return context, page, errors, requests


def assert_geometry(locator):
    assert locator.count(), str(locator)
    for element in locator.all():
        bounds = element.bounding_box()
        assert bounds and bounds['width'] > 0 and bounds['height'] > 0, (str(element), bounds)


def jump(page, selector, root, line):
    page.select_option('#editor-select', 'cursor')
    page.locator('#reset-view').click()
    page.evaluate('window.__cg_captureUrl = true; window.__cg_lastUrl = null')
    target = page.locator(selector).first
    assert_geometry(target)
    # A self-message group's center is empty space inside its bent arrow.
    child = target.locator('text, foreignObject').first
    (child if child.count() else target).click()
    assert page.evaluate('window.__cg_lastUrl') == f'cursor://file{root / "source.py"}:{line}'


def pan_reset(page, name):
    viewport = page.locator(f'#svg-{name} .cg-viewport')
    page.locator('#reset-view').click()
    original = viewport.get_attribute('transform')
    # Find background with elementFromPoint, then use trusted browser mouse input.
    point = page.locator('#canvas-wrap').evaluate('''wrap => {
        const r = wrap.getBoundingClientRect();
        for (let y = r.top + 12; y < r.bottom - 80; y += 30) {
            for (let x = r.left + 12; x < r.right - 80; x += 30) {
                const el = document.elementFromPoint(x,y);
                if (el && wrap.contains(el) && !el.closest('.cg-node,.cg-edge,.cg-msg,.cg-actor,#cg-diff-legend'))
                    return {x,y};
            }
        }
    }''')
    assert point, 'no exposed pan background'
    page.mouse.move(point['x'], point['y'])
    page.mouse.down()
    page.mouse.move(point['x'] + 50, point['y'] + 40, steps=5)
    page.mouse.up()
    assert viewport.get_attribute('transform') != original, 'real pan did not move viewport'
    page.locator('#reset-view').click()
    expect(viewport).to_have_attribute('transform', original)
    page.mouse.move(point['x'], point['y'])
    page.mouse.wheel(0, -200)
    expect(viewport).not_to_have_attribute('transform', original)
    page.locator('#reset-view').click()
    expect(viewport).to_have_attribute('transform', original)


def check_flow(browser, html, root, direction, nodes, complex_graph=False):
    context, page, errors, requests = open_page(browser, html)
    try:
        expect(page.locator('.cg-node')).to_have_count(len(nodes), timeout=30000)
        expect(page.locator('#loading')).to_be_hidden()
        expect(page.locator('#cg-render-errors')).to_have_count(0)
        assert_geometry(page.locator('.cg-node'))
        if complex_graph:
            assert_geometry(page.locator('#svg-flowchart .cluster'))
        expect(page.locator('.cg-edge-line')).to_have_count(3 if complex_graph else 2)
        if complex_graph:
            assert page.locator('.cg-node[data-id="D"] circle').count() > 0, 'circle shape was lost'
            assert page.locator('.cg-node[data-id="B"]').evaluate("el => el.classList.contains('emphasis')")
            assert page.locator('#svg-flowchart .cluster').count()
            jump(page, '.cg-node[data-id="B"]', root, 2)
        else:
            a, c = (page.locator(f'.cg-node[data-id="{node}"]').bounding_box() for node in ('A', 'C'))
            axis = 'x' if direction in ('LR', 'RL') else 'y'
            sign = -1 if direction in ('RL', 'BT') else 1
            assert (c[axis] - a[axis]) * sign > 0, (direction, a, c)
            jump(page, '.cg-node[data-id="B"]', root, 2)
        pan_reset(page, 'flowchart')
        jump(page, '.cg-node[data-id="B"]', root, 2)
        assert not errors, errors
        assert not requests, requests
    finally:
        context.close()
    features = 'shapes/subgraph/styles' if complex_graph else 'simple-chain direction geometry'
    print(f'PASS flowchart {direction}: {features}, real click/pan/zoom/reset, offline zero HTTP requests')


def check_both(browser, html, root, source, color, review=False):
    context, page, errors, requests = open_page(browser, html, color)
    try:
        expect(page.locator('.cg-node')).to_have_count(4, timeout=30000)
        expect(page.locator('.cg-msg')).to_have_count(6, timeout=30000)
        assert page.locator('.cg-actor').count() >= 2
        assert set(page.locator('.cg-actor').evaluate_all('els => els.map(el => el.dataset.id)')) == {'A', 'B'}
        expect(page.locator('#cg-render-errors')).to_have_count(0)
        page.locator('#tab-sequence').click()
        expect(page.locator('#svg-sequence')).to_be_visible()
        assert_geometry(page.locator('.cg-msg'))
        assert_geometry(page.locator('.cg-actor'))
        assert_geometry(page.locator('#svg-sequence .note'))
        assert_geometry(page.locator('#svg-sequence [class^="activation"]'))
        assert page.locator('#svg-sequence .loopLine').count() >= 3, 'fragment borders missing'
        expect(page.locator('#svg-sequence .sequenceNumber')).to_have_count(6)
        # Repeated labels, self-call, note, activation, and fragments must not shift IDs.
        for index in range(6):
            jump(page, f'.cg-msg[data-idx="{index}"]', root, index + 5)
        ys = page.locator('.cg-msg').evaluate_all('els => els.map(el => el.getBoundingClientRect().y)')
        assert ys == sorted(ys) and len(set(ys)) == 6, ys
        jump(page, '.cg-actor[data-id="A"]', root, 1)
        pan_reset(page, 'sequence')
        jump(page, '.cg-msg[data-idx="5"]', root, 10)
        if review:
            expect(page.locator('#cg-diff-legend')).to_be_visible()
            expect(page.locator('.cg-msg[data-idx="0"]')).to_have_attribute('data-diff', 'modified')
            page.select_option('#editor-select', 'web')
            page.locator('#reset-view').click()
            page.locator('.cg-msg[data-idx="0"]').click()
            expect(page.locator('#code-pane-header')).to_contain_text('source.py · line 5 · diff')
            current = page.locator('.cg-current-line')
            expect(current).to_have_count(1)
            expect(current).to_have_attribute('data-line', '5')
            expect(current.locator('.cg-line-content')).to_have_text(source.splitlines()[4])
            expect(page.locator('.cg-diff-add')).to_have_count(1)
            expect(page.locator('.cg-diff-del')).to_have_count(1)
        page.mouse.move(20, 20)
        page.screenshot(path=f'/tmp/codegraph-mermaid-sequence-{color}.png')
        page.locator('#tab-flowchart').click()
        jump(page, '.cg-node[data-id="B"]', root, 2)
        if color == 'light':
            page.mouse.move(20, 20)
            page.screenshot(path='/tmp/codegraph-mermaid-flowchart-light.png')
        assert not errors, errors
        assert not requests, requests
    finally:
        context.close()
    print(f'PASS both {color}{" review" if review else ""}: actors/activation/notes/fragments/autonumber, repeated message IDs, real clicks, offline zero HTTP requests')


def main():
    with tempfile.TemporaryDirectory(prefix='codegraph-mermaid-browser-') as temporary:
        root = Path(temporary).resolve()
        source = ''.join(f'value_{n} = {n}\n' for n in range(1, 15))
        (root / 'source.py').write_text(source, encoding='utf-8')
        flow_locs = {'nodes': {node: ['source.py', i] for i, node in enumerate('ABCD', 1)},
                     'edges': [{'from': a, 'to': b, 'occurrence': 1, 'loc': ['source.py', i]}
                               for i, (a, b) in enumerate(zip('ABC', 'BCD'), 5)]}
        seq_locs = {'actors': {'A': ['source.py', 1], 'B': ['source.py', 2]},
                    'messages': [['source.py', n] for n in range(5, 11)]}
        direction_locs = {'nodes': {node: ['source.py', i] for i, node in enumerate('ABC', 1)},
                          'edges': [{'from': a, 'to': b, 'occurrence': 1, 'loc': ['source.py', i]}
                                    for i, (a, b) in enumerate(zip('AB', 'BC'), 5)]}
        flows = {direction: build(root, direction, FLOW_DIRECTION.replace('{direction}', direction), direction_locs)
                 for direction in ('TD', 'TB', 'BT', 'LR', 'RL')}
        complex_flow = build(root, 'complex', FLOW, flow_locs)
        both = build(root, 'both', FLOW + '\n' + SEQUENCE,
                     {'flowchart': flow_locs, 'sequence': seq_locs})
        def review_data(data):
            data['review'] = {'base': 'fixture-base', 'head': 'fixture-head', 'range': 'fixture-base..fixture-head'}
            data['diff'] = {'files': {'source.py': {'status': 'modified', 'addedLines': [5],
                            'removedLines': [5], 'baseText': source.replace('value_5 = 5', 'value_5 = 0')}}}
            data['sequence']['locs']['messages'][0].append('modified')
        review = rewrite_data(both, root / 'review.html', review_data)
        def invalid_source(data):
            data['flowchart']['source'] = 'flowchart LR\n A[unterminated'
        broken = rewrite_data(flows['LR'], root / 'render-error.html', invalid_source)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for direction, html in flows.items():
                    check_flow(browser, html, root, direction, 'ABC')
                check_flow(browser, complex_flow, root, 'complex', 'ABCD', complex_graph=True)
                check_both(browser, both, root, source, 'light')
                check_both(browser, review, root, source, 'dark', review=True)
                context, page, errors, requests = open_page(browser, broken)
                try:
                    expect(page.locator('#cg-render-errors[role="alert"]')).to_be_visible(timeout=30000)
                    expect(page.locator('#cg-render-errors')).to_contain_text('Flowchart render error:')
                    expect(page.locator('#loading')).to_be_hidden()
                    assert not requests, requests
                finally:
                    context.close()
                print('PASS render failure: visible error alert, loading dismissed, offline zero HTTP requests')
            finally:
                browser.close()
    print('PASS official Mermaid browser integration: 7 builds, 9 browser cases; fixtures cleaned up')


if __name__ == '__main__':
    main()
