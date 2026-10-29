// CodeGraph for DeepSeek Harness — Client half.
//
// Surfaces:
//   1. a chat result card for `codegraph_build`;
//   2. a chat result card for `codegraph_walkthrough_build`;
//   3. right-Sidebar tab types for generated `.codegraph/output/**/graph.html`
//      and `walkthrough.html` files. Each tab frames the self-contained artifact
//      and relays source clicks to the harness's own source preview.
//
// The artifacts stay the single source of truth; this file only supplies host
// chrome, loading state, and the source-jump bridge.

window.__ModuleLoader__.load({
  id: '@longbowzz/dsh-codegraph',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'codegraph'
    const GRAPH_TAB_ID = '@longbowzz/dsh-codegraph/graph'
    const WALKTHROUGH_TAB_ID = '@longbowzz/dsh-codegraph/walkthrough'

    const zh = {
      'card.title': 'CodeGraph',
      'card.running': '正在生成图…',
      'card.ok': '已生成',
      'card.invalid': '校验失败',
      'card.failed': '构建失败',
      'card.open': '打开图',
      'card.openMmd': '查看 mmd',
      'card.errors': '查看错误',
      'card.hideErrors': '收起错误',
      'card.more': '还有 {count} 个错误',
      'card.flowchart': '流程图',
      'card.sequence': '时序图',
      'card.review': '审阅',
      'card.nodes': '{count} 个节点',
      'card.edges': '{count} 条边',
      'card.actors': '{count} 个参与者',
      'card.messages': '{count} 条消息',
      'card.summary': '{kinds} · {facts}',
      'card.noMeta': '图已生成，但结果信息不完整。',
      'tab.loading': '正在加载图…',
      'tab.error': '无法加载图',
      'tab.retry': '重试',
      'tab.reload': '重新加载',
      'tab.removed': '该节点在本次 diff 中已删除，无法打开当前源码。',
      'tab.unavailable': '找不到这张图的来源信息，暂时无法跳转源码。',
      'tab.frameTitle': 'CodeGraph 图',
      'tab.title': 'CodeGraph',
      'cw.title': 'CodeWalkthrough',
      'cw.running': '正在生成讲解页…',
      'cw.ok': '已生成',
      'cw.invalid': '自检失败',
      'cw.failed': '生成失败',
      'cw.open': '打开讲解页',
      'cw.pages': '{count} 节',
      'cw.sources': '{count} 个源码文件',
      'cw.verified': '自检通过',
      'cw.verifyFailed': '自检失败',
      'cw.more': '还有 {count} 个错误',
      'cw.noMeta': '讲解页已生成，但结果信息不完整。',
      'cw.summary': '{facts}',
      'cw.tab.loading': '正在加载讲解页…',
      'cw.tab.error': '无法加载讲解页',
      'cw.tab.retry': '重试',
      'cw.tab.reload': '重新加载',
      'cw.tab.removed': '该位置在本次 diff 中已删除。',
      'cw.tab.unavailable': '找不到这个讲解页的来源信息，暂时无法跳转源码。',
      'cw.tab.frameTitle': 'CodeWalkthrough 讲解页',
      'cw.tab.title': 'CodeWalkthrough',
    }

    const en = {
      'card.title': 'CodeGraph',
      'card.running': 'Generating graph…',
      'card.ok': 'Built',
      'card.invalid': 'Validation failed',
      'card.failed': 'Build failed',
      'card.open': 'Open graph',
      'card.openMmd': 'View mmd',
      'card.errors': 'Show errors',
      'card.hideErrors': 'Hide errors',
      'card.more': '{count} more error(s)',
      'card.flowchart': 'Flowchart',
      'card.sequence': 'Sequence',
      'card.review': 'Review',
      'card.nodes': '{count} nodes',
      'card.edges': '{count} edges',
      'card.actors': '{count} actors',
      'card.messages': '{count} messages',
      'card.summary': '{kinds} · {facts}',
      'card.noMeta': 'The graph was built, but its result metadata is incomplete.',
      'tab.loading': 'Loading graph…',
      'tab.error': 'Could not load graph',
      'tab.retry': 'Retry',
      'tab.reload': 'Reload',
      'tab.removed': 'This node was removed in the diff, so there is no current source line to open.',
      'tab.unavailable': 'The source location for this graph is unavailable.',
      'tab.frameTitle': 'CodeGraph',
      'tab.title': 'CodeGraph',
      'cw.title': 'CodeWalkthrough',
      'cw.running': 'Generating walkthrough…',
      'cw.ok': 'Built',
      'cw.invalid': 'Self-check failed',
      'cw.failed': 'Build failed',
      'cw.open': 'Open walkthrough',
      'cw.pages': '{count} sections',
      'cw.sources': '{count} source files',
      'cw.verified': 'Self-check passed',
      'cw.verifyFailed': 'Self-check failed',
      'cw.more': '{count} more error(s)',
      'cw.noMeta': 'The walkthrough was built, but its result metadata is incomplete.',
      'cw.summary': '{facts}',
      'cw.tab.loading': 'Loading walkthrough…',
      'cw.tab.error': 'Could not load walkthrough',
      'cw.tab.retry': 'Retry',
      'cw.tab.reload': 'Reload',
      'cw.tab.removed': 'This location was removed in the diff.',
      'cw.tab.unavailable': 'The source location for this walkthrough is unavailable.',
      'cw.tab.frameTitle': 'CodeWalkthrough',
      'cw.tab.title': 'CodeWalkthrough',
    }

    function fill(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
      ))
    }

    function decodeSegment(segment) {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    }

    function parseFileAddress(address) {
      const prefix = 'dsh-resource://file/'
      if (typeof address !== 'string' || !address.startsWith(prefix)) return null
      const end = address.search(/[?#]/)
      const raw = address.slice(prefix.length, end === -1 ? undefined : end)
      const parts = raw.split('/')
      const scope = parts.shift()
      if (scope !== 'session') return null
      const id = parts.shift()
      if (id === undefined || id === '') return null
      const path = parts.map(decodeSegment).join('/')
      if (path === '') return null
      return { sessionId: decodeSegment(id), path }
    }

    function fileAddress(sessionId, absolutePath) {
      const normalized = String(absolutePath).replace(/\\/g, '/')
      const encoded = normalized.split('/').map(encodeURIComponent).join('/')
      return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`
    }

    function isGraphAddress(address) {
      const parsed = parseFileAddress(address)
      if (parsed === null) return false
      const path = parsed.path.replace(/\\/g, '/')
      return /(?:^|\/)\.codegraph\/(?:[^/]+\/)*graph\.html$/.test(path)
    }

    function graphTitle(address) {
      const parsed = parseFileAddress(address)
      if (parsed === null) return 'CodeGraph'
      const directory = parsed.path.replace(/\\/g, '/').replace(/\/graph\.html$/i, '').split('/').pop() || ''
      return directory.replace(/^\d{8}-\d{4}-/, '') || 'CodeGraph'
    }

    function isWalkthroughAddress(address) {
      const parsed = parseFileAddress(address)
      if (parsed === null) return false
      const path = parsed.path.replace(/\\/g, '/')
      return /(?:^|\/)\.codegraph\/(?:[^/]+\/)*walkthrough\.html$/.test(path)
    }

    function walkthroughTitle(address) {
      const parsed = parseFileAddress(address)
      if (parsed === null) return 'CodeWalkthrough'
      const directory = parsed.path.replace(/\\/g, '/').replace(/\/walkthrough\.html$/i, '').split('/').pop() || ''
      return directory.replace(/^\d{8}-\d{4}-/, '') || 'CodeWalkthrough'
    }

    function normalizeMeta(meta) {
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
      if (meta.v !== 1) return null
      return meta
    }

    function resultText(block) {
      const parts = []
      for (const item of Array.isArray(block?.content) ? block.content : []) {
        if (item !== null && typeof item === 'object' && item.type === 'text') parts.push(item.text)
        else parts.push(JSON.stringify(item, null, 2))
      }
      if (parts.length === 0 && block?.error) parts.push(`${block.error.name}: ${block.error.code}`)
      return parts.join('\n')
    }

    function kindLabel(t, kind) {
      if (kind === 'flowchart') return t('card.flowchart')
      if (kind === 'sequence') return t('card.sequence')
      return kind
    }

    function factsOf(t, meta) {
      const facts = []
      if (meta.stats?.nodes) {
        facts.push(fill(t('card.nodes'), { count: meta.stats.nodes }))
        facts.push(fill(t('card.edges'), { count: meta.stats.edges ?? 0 }))
      }
      if (meta.stats?.messages) {
        facts.push(fill(t('card.actors'), { count: meta.stats.actors ?? 0 }))
        facts.push(fill(t('card.messages'), { count: meta.stats.messages }))
      }
      if (meta.review?.base && meta.review?.head) facts.push(`${t('card.review')} ${meta.review.base}..${meta.review.head}`)
      return facts
    }

    function openSafely(openFile, path) {
      try {
        const result = openFile(path)
        if (result !== null && typeof result === 'object' && typeof result.catch === 'function') result.catch(() => {})
      } catch {}
    }

    const CARD_CSS = `
.cg-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary);max-width:720px}
.cg-card *{box-sizing:border-box}
.cg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cg-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.cg-dot[data-state="ok"]{background:var(--dsw-alias-state-success-primary)}
.cg-dot[data-state="invalid"]{background:var(--dsw-alias-state-warn-primary)}
.cg-dot[data-state="failed"]{background:var(--dsw-alias-state-error-primary)}
.cg-title{font-weight:600;letter-spacing:.01em}
.cg-topic{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cg-badge{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.cg-meta{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:12px}
.cg-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.cg-actions button{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.cg-actions button:hover{background:var(--dsw-alias-bg-layer-1)}
.cg-actions button.cg-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.cg-errors{margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;display:grid;gap:6px}
.cg-error{font-size:12px;min-width:0}
.cg-error-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-state-error-primary)}
.cg-error-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);margin-left:6px}
.cg-error-msg{margin-top:1px;white-space:pre-wrap;word-break:break-word}
.cg-fix{margin-top:1px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.cg-pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;margin:6px 0 0;max-height:220px;overflow:auto}
.cg-more{font-size:12px;color:var(--dsw-alias-label-secondary)}
`

    function ErrorList({ t, meta }) {
      const errors = Array.isArray(meta.errors) ? meta.errors : []
      if (errors.length === 0) {
        return meta.message
          ? h('div', { className: 'cg-errors' }, h('div', { className: 'cg-error-msg' }, meta.message))
          : null
      }
      return h('div', { className: 'cg-errors' },
        errors.slice(0, 3).map((error, index) => h('div', { className: 'cg-error', key: index },
          h('span', { className: 'cg-error-code' }, error?.code ?? 'ERROR'),
          error?.path ? h('span', { className: 'cg-error-path' }, error.path) : null,
          error?.message ? h('div', { className: 'cg-error-msg' }, error.message) : null,
          error?.fix_hint ? h('div', { className: 'cg-fix' }, `Fix: ${error.fix_hint}`) : null,
        )),
        errors.length > 3 ? h('div', { className: 'cg-more' }, fill(t('card.more'), { count: errors.length - 3 })) : null,
        meta.message && errors.length > 0 ? h('div', { className: 'cg-error-msg' }, meta.message) : null,
      )
    }

    function CodeGraphCard(props) {
      const { phase, block, openFile } = props
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const meta = normalizeMeta(block?.meta)
      const [showErrors, setShowErrors] = React.useState(false)

      if (phase !== 'result') {
        return h('div', { className: 'cg-card', 'data-codegraph-card': 'running' },
          h('style', null, CARD_CSS),
          h('div', { className: 'cg-head' },
            h('span', { className: 'cg-dot' }),
            h('span', { className: 'cg-title' }, t('card.title')),
            h('span', { className: 'cg-badge' }, t('card.running')),
          ),
        )
      }

      if (block?.isError || meta === null) {
        const text = resultText(block)
        const state = block?.isError ? 'failed' : 'invalid'
        return h('div', { className: 'cg-card', 'data-codegraph-card': state },
          h('style', null, CARD_CSS),
          h('div', { className: 'cg-head' },
            h('span', { className: 'cg-dot', 'data-state': state }),
            h('span', { className: 'cg-title' }, t('card.title')),
            h('span', { className: 'cg-badge' }, block?.isError ? t('card.failed') : t('card.invalid')),
          ),
          text ? h('pre', { className: 'cg-pre' }, text) : h('div', { className: 'cg-meta' }, t('card.noMeta')),
        )
      }

      const ok = meta.ok === true
      const state = ok ? 'ok' : (meta.stage === 'validate' ? 'invalid' : 'failed')
      const kinds = Array.isArray(meta.kinds) ? meta.kinds : []
      const facts = factsOf(t, meta)
      const summary = facts.length > 0
        ? fill(t('card.summary'), {
          kinds: kinds.length > 0 ? kinds.map((kind) => kindLabel(t, kind)).join(' · ') : t('card.title'),
          facts: facts.join(' · '),
        })
        : (kinds.length > 0 ? kinds.map((kind) => kindLabel(t, kind)).join(' · ') : '')
      const errors = Array.isArray(meta.errors) ? meta.errors : []

      return h('div', { className: 'cg-card', 'data-codegraph-card': state },
        h('style', null, CARD_CSS),
        h('div', { className: 'cg-head' },
          h('span', { className: 'cg-dot', 'data-state': state }),
          h('span', { className: 'cg-title' }, t('card.title')),
          meta.topic ? h('span', { className: 'cg-topic' }, meta.topic) : null,
          h('span', { className: 'cg-badge' }, ok ? t('card.ok') : (state === 'invalid' ? t('card.invalid') : t('card.failed'))),
        ),
        summary ? h('div', { className: 'cg-meta' }, summary) : null,
        errors.length > 0 && showErrors ? h(ErrorList, { t, meta }) : null,
        h('div', { className: 'cg-actions' },
          ok && typeof openFile === 'function' && meta.html
            ? h('button', {
              type: 'button',
              className: 'cg-primary',
              onClick: () => openSafely(openFile, meta.htmlAbs ?? meta.html),
            }, t('card.open'))
            : null,
          ok && typeof openFile === 'function' && meta.mmd
            ? h('button', {
              type: 'button',
              onClick: () => openSafely(openFile, meta.mmdAbs ?? meta.mmd),
            }, t('card.openMmd'))
            : null,
          errors.length > 0 || meta.message
            ? h('button', {
              type: 'button',
              onClick: () => setShowErrors((value) => !value),
            }, showErrors ? t('card.hideErrors') : `${t('card.errors')}${errors.length > 0 ? ` (${errors.length})` : ''}`)
            : null,
        ),
      )
    }

    function CodeWalkthroughCard(props) {
      const { phase, block, openFile } = props
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const meta = normalizeMeta(block?.meta)
      const [showErrors, setShowErrors] = React.useState(false)

      if (phase !== 'result') {
        return h('div', { className: 'cg-card', 'data-codewalkthrough-card': 'running' },
          h('style', null, CARD_CSS),
          h('div', { className: 'cg-head' },
            h('span', { className: 'cg-dot' }),
            h('span', { className: 'cg-title' }, t('cw.title')),
            h('span', { className: 'cg-badge' }, t('cw.running')),
          ),
        )
      }

      if (block?.isError || meta === null) {
        const text = resultText(block)
        const state = block?.isError ? 'failed' : 'invalid'
        return h('div', { className: 'cg-card', 'data-codewalkthrough-card': state },
          h('style', null, CARD_CSS),
          h('div', { className: 'cg-head' },
            h('span', { className: 'cg-dot', 'data-state': state }),
            h('span', { className: 'cg-title' }, t('cw.title')),
            h('span', { className: 'cg-badge' }, block?.isError ? t('cw.failed') : t('cw.invalid')),
          ),
          text ? h('pre', { className: 'cg-pre' }, text) : h('div', { className: 'cg-meta' }, t('cw.noMeta')),
        )
      }

      const ok = meta.ok === true
      const verifyOk = meta.verify?.ok === true
      const state = ok ? (verifyOk ? 'ok' : 'invalid') : 'failed'
      const stats = meta.stats !== null && typeof meta.stats === 'object' ? meta.stats : {}
      const facts = []
      if (stats.pages) facts.push(fill(t('cw.pages'), { count: stats.pages }))
      if (stats.sources) facts.push(fill(t('cw.sources'), { count: stats.sources }))
      if (meta.verify !== null && meta.verify !== undefined) {
        facts.push(verifyOk ? t('cw.verified') : t('cw.verifyFailed'))
      }
      const errors = [
        ...(Array.isArray(meta.errors) ? meta.errors : []),
        ...(Array.isArray(meta.verify?.errors) ? meta.verify.errors.map((message) => ({ code: 'verify', message: String(message) })) : []),
      ]
      const errorMeta = { ...meta, errors }

      return h('div', { className: 'cg-card', 'data-codewalkthrough-card': state },
        h('style', null, CARD_CSS),
        h('div', { className: 'cg-head' },
          h('span', { className: 'cg-dot', 'data-state': state }),
          h('span', { className: 'cg-title' }, t('cw.title')),
          meta.topic ? h('span', { className: 'cg-topic' }, meta.topic) : null,
          h('span', { className: 'cg-badge' }, ok ? (verifyOk ? t('cw.ok') : t('cw.invalid')) : t('cw.failed')),
        ),
        facts.length > 0 ? h('div', { className: 'cg-meta' }, facts.join(' · ')) : null,
        errors.length > 0 && showErrors ? h(ErrorList, { t, meta: errorMeta }) : null,
        h('div', { className: 'cg-actions' },
          ok && typeof openFile === 'function' && meta.html
            ? h('button', {
              type: 'button',
              className: 'cg-primary',
              onClick: () => openSafely(openFile, meta.htmlAbs ?? meta.html),
            }, t('cw.open'))
            : null,
          errors.length > 0 || meta.message
            ? h('button', {
              type: 'button',
              onClick: () => setShowErrors((value) => !value),
            }, showErrors ? t('card.hideErrors') : `${t('card.errors')}${errors.length > 0 ? ` (${errors.length})` : ''}`)
            : null,
        ),
      )
    }

    const TAB_CSS = `
.cg-tab{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.cg-tab-head{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill)}
.cg-tab-title{font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cg-tab-head button{margin-left:auto;font:inherit;font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.cg-tab-head button:hover{background:var(--dsw-alias-bg-layer-1)}
.cg-frame{flex:1;width:100%;min-height:0;border:0;display:block;background:var(--dsw-alias-bg-base)}
.cg-status{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;font-size:13px;color:var(--dsw-alias-label-secondary);text-align:center}
.cg-status code{max-width:100%;white-space:pre-wrap;word-break:break-word;font-size:12px;color:var(--dsw-alias-label-primary)}
.cg-status button{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.cg-notice{padding:6px 10px;font-size:12px;color:var(--dsw-alias-state-warn-primary);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
`

    function makeHtmlTab(ctx, scope, options = {}) {
      const tabOptions = {
        messageType: 'codegraph.navigate',
        noncePrefix: 'cg',
        titleKey: 'tab.title',
        frameTitleKey: 'tab.frameTitle',
        loadingKey: 'tab.loading',
        errorKey: 'tab.error',
        retryKey: 'tab.retry',
        reloadKey: 'tab.reload',
        removedKey: 'tab.removed',
        unavailableKey: 'tab.unavailable',
        ...options,
      }
      return function CodeGraphHtmlTab(props) {
        const { useTabInfo } = props
        const t = typeof props.t === 'function' ? props.t : (key) => key
        const tRef = React.useRef(t)
        tRef.current = t
        const { tab } = useTabInfo()
        const parsed = React.useMemo(() => parseFileAddress(tab.contentId), [tab.contentId])
        const codeFontSize = React.useMemo(() => {
          try {
            const raw = getComputedStyle(document.documentElement).getPropertyValue('--dsh-content-font-size-secondary').trim()
            const value = Number.parseFloat(raw)
            return Number.isFinite(value) && value > 0 ? value : 13
          } catch {
            return 13
          }
        }, [])
        const [reloadKey, setReloadKey] = React.useState(0)
        const [notice, setNotice] = React.useState(null)
        const [state, setState] = React.useState({ status: 'loading' })
        const frameRef = React.useRef(null)
        const nonce = React.useMemo(
          () => `${tabOptions.noncePrefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`,
          [tabOptions.noncePrefix],
        )

        React.useEffect(() => {
          if (parsed === null) {
            setState({ status: 'error', message: tRef.current(tabOptions.unavailableKey) })
            return undefined
          }
          const controller = new AbortController()
          let objectUrl = null
          setState({ status: 'loading' })
          setNotice(null)

          scope.remote.workspaceFiles
            .readBytes(parsed.sessionId, parsed.path, {}, controller.signal)
            .then((result) => {
              if (controller.signal.aborted) return
              if (result === null || typeof result !== 'object' || result.ok !== true) {
                const message = result?.error?.message ?? tRef.current(tabOptions.errorKey)
                setState({ status: 'error', message })
                return
              }
              const data = result.value?.data
              if (data === undefined) {
                setState({ status: 'error', message: tRef.current(tabOptions.errorKey) })
                return
              }
              objectUrl = URL.createObjectURL(new Blob([data], { type: 'text/html' }))
              setState({ status: 'ready', url: objectUrl })
            }).catch((error) => {
              if (controller.signal.aborted) return
              setState({ status: 'error', message: error?.message ?? String(error) })
            })

          return () => {
            controller.abort()
            if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
          }
        }, [scope, parsed?.sessionId, parsed?.path, reloadKey])

        React.useEffect(() => {
          function onMessage(event) {
            if (event.source !== frameRef.current?.contentWindow) return
            const data = event.data
            if (data === null || typeof data !== 'object') return
            if (data.v !== 1 || data.type !== tabOptions.messageType || data.token !== nonce) return
            if (typeof data.file !== 'string' || typeof data.line !== 'number') return
            if (data.status === 'removed') {
              setNotice(tRef.current(tabOptions.removedKey))
              return
            }
            const repo = typeof data.repo === 'string' ? data.repo : ''
            if (repo === '' || parsed === null) {
              setNotice(tRef.current(tabOptions.unavailableKey))
              return
            }
            const absolute = data.file.startsWith('/')
              ? data.file
              : `${repo.replace(/\/$/, '')}/${data.file}`
            try {
              setNotice(null)
              ctx.sidebarRight.openResource(
                fileAddress(parsed.sessionId, absolute),
                { params: { line: data.line }, preferNewPane: true },
              )
            } catch (error) {
              setNotice(error?.message ?? String(error))
            }
          }
          window.addEventListener('message', onMessage)
          return () => window.removeEventListener('message', onMessage)
        }, [ctx, nonce, parsed])

        if (state.status === 'ready') {
          return h('div', { className: 'cg-tab' },
            h('style', null, TAB_CSS),
            h('div', { className: 'cg-tab-head' },
              h('span', { className: 'cg-tab-title' }, tab.title || t(tabOptions.titleKey)),
              h('button', {
                type: 'button',
                onClick: () => setReloadKey((value) => value + 1),
              }, t(tabOptions.reloadKey)),
            ),
            notice ? h('div', { className: 'cg-notice' }, notice) : null,
            h('iframe', {
              ref: frameRef,
              className: 'cg-frame',
              sandbox: 'allow-scripts',
              src: `${state.url}#dsh=${encodeURIComponent(nonce)}&fs=${codeFontSize}`,
              title: t(tabOptions.frameTitleKey),
            }),
          )
        }

        return h('div', { className: 'cg-tab' },
          h('style', null, TAB_CSS),
          h('div', { className: 'cg-tab-head' },
            h('span', { className: 'cg-tab-title' }, tab.title || t(tabOptions.titleKey)),
          ),
          notice ? h('div', { className: 'cg-notice' }, notice) : null,
          h('div', { className: 'cg-status' },
            state.status === 'error'
              ? h(React.Fragment, null,
                h('span', null, t(tabOptions.errorKey)),
                h('code', null, state.message ?? ''),
                h('button', {
                  type: 'button',
                  onClick: () => setReloadKey((value) => value + 1),
                }, t(tabOptions.retryKey)),
              )
              : h('span', null, t(tabOptions.loadingKey)),
          ),
        )
      }
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'remote'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codegraph: locale')

        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'codegraph_build',
          locale: NS,
        }, CodeGraphCard))

        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'codegraph_walkthrough_build',
          locale: NS,
        }, CodeWalkthroughCard))

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: GRAPH_TAB_ID,
          kind: 'codegraph',
          patterns: ['*.html'],
          priority: 'extension',
          canOpen: isGraphAddress,
          title: graphTitle,
        }), 'codegraph: graph tab type')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: WALKTHROUGH_TAB_ID,
          kind: 'walkthrough',
          patterns: ['*.html'],
          priority: 'extension',
          canOpen: isWalkthroughAddress,
          title: walkthroughTitle,
        }), 'codegraph: walkthrough tab type')

        ctx.inject(['remote', 'remote.workspaceFiles'], (scope) => {
          ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: GRAPH_TAB_ID,
            locale: NS,
          }, makeHtmlTab(ctx, scope, {
            messageType: 'codegraph.navigate',
            noncePrefix: 'cg',
          })))

          ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: WALKTHROUGH_TAB_ID,
            locale: NS,
          }, makeHtmlTab(ctx, scope, {
            messageType: 'codewalk.navigate',
            noncePrefix: 'cw',
            titleKey: 'cw.tab.title',
            frameTitleKey: 'cw.tab.frameTitle',
            loadingKey: 'cw.tab.loading',
            errorKey: 'cw.tab.error',
            retryKey: 'cw.tab.retry',
            reloadKey: 'cw.tab.reload',
            removedKey: 'cw.tab.removed',
            unavailableKey: 'cw.tab.unavailable',
          })))
        })
      },
    }
  },
})
