(() => {
  'use strict'

  const dataEl = document.getElementById('cw-data')
  if (dataEl === null) return
  let data
  try { data = JSON.parse(dataEl.textContent || '{}') } catch { data = {} }
  const meta = data.meta !== null && typeof data.meta === 'object' ? data.meta : {}
  const files = data.files !== null && typeof data.files === 'object' ? data.files : {}
  const labels = data.labels !== null && typeof data.labels === 'object' ? data.labels : {}
  const repo = typeof data.repo === 'string' ? data.repo : (typeof meta.repo === 'string' ? meta.repo : '')

  const contentEl = document.getElementById('cw-content')
  const navLinks = document.getElementById('cw-nav-links')
  const sourceToggle = document.getElementById('cw-source-toggle')
  const sourceEl = document.getElementById('cw-source')
  const sourceBody = document.getElementById('cw-source-body')
  const sourceFileEl = document.getElementById('cw-source-file')
  const sourceLineEl = document.getElementById('cw-source-line')
  const sourceClose = document.getElementById('cw-source-close')
  const backdrop = document.getElementById('cw-backdrop')
  const progressBar = document.getElementById('cw-progress-bar')
  const footerEl = document.getElementById('cw-footer')

  if (contentEl === null || navLinks === null) return

  function parseHash() {
    const raw = String(location.hash || '').replace(/^#/, '')
    if (raw === '') return { section: '', dsh: null, fs: 13 }
    if (!raw.includes('=')) return { section: decodeURIComponent(raw), dsh: null, fs: 13 }
    const params = new URLSearchParams(raw)
    const fs = Number(params.get('fs'))
    return {
      section: params.get('section') || '',
      dsh: params.get('dsh') || null,
      fs: Number.isFinite(fs) && fs > 0 ? fs : 13,
    }
  }

  let bridge = parseHash()
  const isDsh = bridge.dsh !== null

  function applyLabels() {
    for (const el of document.querySelectorAll('[data-label]')) {
      const key = el.getAttribute('data-label')
      if (typeof labels[key] !== 'string') continue
      if (key === 'close') el.setAttribute('aria-label', labels[key])
      else el.textContent = labels[key]
    }
    document.body.classList.toggle('cw-dsh', isDsh)
    if (isDsh) {
      sourceToggle.hidden = true
      sourceEl.hidden = true
      sourceEl.setAttribute('aria-hidden', 'true')
      backdrop.hidden = true
    }
    if (typeof labels.generated === 'string') {
      footerEl.textContent = labels.generated
    }
    for (const btn of document.querySelectorAll('[data-reveal]')) {
      if (btn.dataset.revealed !== 'true' && typeof labels.reveal === 'string') btn.textContent = labels.reveal
    }
  }

  // ── sections / nav ───────────────────────────────────────────────────────
  let sections = Array.from(contentEl.children).filter((el) => (
    el.tagName === 'SECTION' || (el.classList && (el.classList.contains('cw-section') || el.classList.contains('cw-page') || el.classList.contains('cw-slide')))
  ))
  if (sections.length === 0) {
    const section = document.createElement('section')
    section.className = 'cw-section'
    section.id = 'overview'
    section.dataset.title = typeof meta.topic === 'string' ? meta.topic : 'Overview'
    while (contentEl.firstChild) section.appendChild(contentEl.firstChild)
    contentEl.appendChild(section)
    sections = [section]
  }

  const usedIds = new Set()
  const sectionData = sections.map((el, index) => {
    el.classList.add('cw-section')
    let id = String(el.id || '').trim()
    if (id === '' || usedIds.has(id)) {
      id = `section-${index + 1}`
      while (usedIds.has(id)) id += '-x'
      el.id = id
    }
    usedIds.add(id)
    let title = String(el.dataset.title || '').trim()
    if (title === '') {
      const heading = el.querySelector('h1, h2')
      title = heading !== null ? String(heading.textContent || '').trim() : `Section ${index + 1}`
    }
    if (title === '') title = `Section ${index + 1}`
    el.dataset.title = title
    const kicker = el.querySelector('.cw-kicker')
    return {
      id,
      title,
      el,
      kicker: kicker !== null ? String(kicker.textContent || '').trim() : '',
    }
  })

  const sectionById = new Map(sectionData.map((section) => [section.id, section]))

  function buildNav() {
    navLinks.replaceChildren()
    for (const section of sectionData) {
      const link = document.createElement('a')
      link.href = `#${section.id}`
      link.dataset.section = section.id
      link.textContent = section.title
      link.addEventListener('click', (event) => {
        event.preventDefault()
        scrollToSection(section.id)
        updateHashSection(section.id)
      })
      navLinks.appendChild(link)
    }
    updateActiveNav()
  }

  function updateActiveNav() {
    const navHeight = (document.querySelector('.cw-nav')?.getBoundingClientRect().height || 56) + 24
    let active = sectionData[0]?.id
    for (const section of sectionData) {
      if (section.el.getBoundingClientRect().top <= navHeight) active = section.id
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      active = sectionData[sectionData.length - 1]?.id
    }
    for (const link of navLinks.querySelectorAll('a')) {
      const on = link.dataset.section === active
      link.classList.toggle('is-active', on)
      if (on) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    }
  }

  function scrollToSection(id, smooth = true) {
    const section = sectionById.get(id)
    if (section === undefined) return
    const navHeight = document.querySelector('.cw-nav')?.getBoundingClientRect().height || 56
    const top = Math.max(0, section.el.getBoundingClientRect().top + window.scrollY - navHeight - 14)
    const root = document.documentElement
    if (!smooth) {
      const previous = root.style.scrollBehavior
      root.style.scrollBehavior = 'auto'
      try { window.scrollTo({ top, behavior: 'auto' }) } catch { window.scrollTo(0, top) }
      root.style.scrollBehavior = previous
    } else {
      try {
        window.scrollTo({ top, behavior: 'smooth' })
      } catch {
        window.scrollTo(0, top)
      }
    }
    // Some embedded/headless engines ignore smooth scrolling; make the
    // navigation deterministic instead of leaving the reader at the top.
    setTimeout(() => {
      if (Math.abs(window.scrollY - top) > 6) {
        const previous = root.style.scrollBehavior
        root.style.scrollBehavior = 'auto'
        window.scrollTo(0, top)
        root.style.scrollBehavior = previous
      }
      updateActiveNav()
      updateProgress()
    }, smooth ? 420 : 0)
  }

  function routeForSection(id) {
    if (isDsh) {
      const params = new URLSearchParams()
      params.set('dsh', bridge.dsh)
      params.set('fs', String(bridge.fs || 13))
      params.set('section', id)
      return `#${params.toString()}`
    }
    return `#${encodeURIComponent(id)}`
  }

  function updateHashSection(id) {
    const route = routeForSection(id)
    try { history.replaceState(null, '', route) } catch { location.hash = route }
    updateActiveNav()
  }

  function updateProgress() {
    const doc = document.documentElement
    const max = Math.max(0, doc.scrollHeight - window.innerHeight)
    const percent = max === 0 ? 0 : Math.min(100, Math.max(0, (window.scrollY / max) * 100))
    progressBar.style.width = `${percent}%`
  }

  // ── source drawer ────────────────────────────────────────────────────────
  let currentSource = null

  function isCodeSource(file) {
    return /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|c|h|cc|cpp|cxx|hpp|css|html?|svg|json|sh|bash|ya?ml|sql)$/i.test(file)
  }

  function navigationLine(file, line) {
    if (!isCodeSource(file)) return line
    const lineHeight = (Number(bridge.fs) > 0 ? Number(bridge.fs) : 13) * 1.6
    const visible = Math.max(1, (window.innerHeight - 72) / lineHeight)
    const lead = Math.max(0, Math.floor(visible / 2))
    return Math.max(1, line - lead)
  }

  function sendNavigation(file, line) {
    if (!isDsh) return false
    parent.postMessage({
      v: 1,
      type: 'codewalk.navigate',
      token: bridge.dsh,
      repo,
      file,
      line: navigationLine(file, line),
      targetLine: line,
      status: 'unchanged',
    }, '*')
    return true
  }

  function sourceText(file) {
    const entry = files[file]
    if (typeof entry === 'string') return entry
    if (entry !== null && typeof entry === 'object' && typeof entry.content === 'string') return entry.content
    return null
  }

  function updateBackdrop() {
    if (isDsh) { backdrop.hidden = true; return }
    const narrow = window.matchMedia('(max-width: 900px)').matches
    backdrop.hidden = !(narrow && !sourceEl.hidden)
  }

  function setSourceVisible(visible) {
    if (isDsh) return
    sourceEl.hidden = !visible
    sourceEl.setAttribute('aria-hidden', visible ? 'false' : 'true')
    sourceToggle.setAttribute('aria-expanded', visible ? 'true' : 'false')
    updateBackdrop()
  }

  function renderSource(file, line) {
    const text = sourceText(file)
    sourceFileEl.textContent = file
    sourceLineEl.textContent = (typeof labels.line === 'string' ? labels.line : 'line {n}').replace('{n}', String(line))
    sourceBody.replaceChildren()
    if (text === null) {
      const error = document.createElement('div')
      error.className = 'cw-src-error'
      error.textContent = `Source not embedded: ${file}`
      sourceBody.appendChild(error)
      return
    }
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const total = lines.length
    const target = Math.max(1, Math.min(Number.isInteger(line) ? line : 1, Math.max(1, total)))
    const maxRows = 5000
    let start = 0
    let end = total
    if (total > maxRows) {
      start = Math.max(0, target - 1 - Math.floor(maxRows / 2))
      end = Math.min(total, start + maxRows)
    }
    if (start > 0 || end < total) {
      const note = document.createElement('div')
      note.className = 'cw-src-note'
      note.textContent = (typeof labels.sourceWindow === 'string' ? labels.sourceWindow : 'Showing lines {start}–{end} of {total}.')
        .replace('{start}', String(start + 1))
        .replace('{end}', String(end))
        .replace('{total}', String(total))
      sourceBody.appendChild(note)
    }
    const fragment = document.createDocumentFragment()
    for (let index = start; index < end; index += 1) {
      const number = index + 1
      const row = document.createElement('div')
      row.className = 'cw-src-row'
      row.dataset.line = String(number)
      if (number === target) row.classList.add('is-target')
      const n = document.createElement('span')
      n.className = 'cw-src-n'
      n.textContent = String(number)
      const t = document.createElement('span')
      t.className = 'cw-src-text'
      t.textContent = lines[index] === '' ? ' ' : lines[index]
      row.append(n, t)
      fragment.appendChild(row)
    }
    sourceBody.appendChild(fragment)
    const targetRow = sourceBody.querySelector('.cw-src-row.is-target')
    if (targetRow !== null) {
      requestAnimationFrame(() => {
        const top = targetRow.offsetTop - sourceBody.clientHeight / 2 + targetRow.clientHeight / 2
        sourceBody.scrollTop = Math.max(0, top)
      })
    }
  }

  function openSource(file, line) {
    if (sendNavigation(file, line)) return
    currentSource = { file, line }
    setSourceVisible(true)
    renderSource(file, line)
  }

  function showEmptySource() {
    sourceFileEl.textContent = labels.source || 'Source'
    sourceLineEl.textContent = ''
    sourceBody.replaceChildren()
    const empty = document.createElement('div')
    empty.className = 'cw-src-empty'
    empty.textContent = typeof labels.emptySource === 'string'
      ? labels.emptySource
      : 'Click a source reference in the article to inspect it here.'
    sourceBody.appendChild(empty)
    setSourceVisible(true)
  }

  function closeSource() {
    setSourceVisible(false)
  }

  function toggleSource() {
    if (isDsh) return
    if (!sourceEl.hidden) {
      closeSource()
      return
    }
    if (currentSource !== null) {
      setSourceVisible(true)
      renderSource(currentSource.file, currentSource.line)
    } else {
      showEmptySource()
    }
  }

  function parseRef(raw) {
    const value = String(raw || '').trim()
    const split = value.lastIndexOf(':')
    if (split <= 0) return null
    const file = value.slice(0, split).replaceAll('\\', '/').replace(/^\.\//, '')
    const line = Number(value.slice(split + 1))
    if (!Number.isInteger(line) || line < 1) return null
    return { file, line }
  }

  // ── quiz ─────────────────────────────────────────────────────────────────
  function setupQuizzes() {
    for (const q of document.querySelectorAll('.cw-q')) {
      const answer = String(q.dataset.answer || '').trim().toLowerCase()
      const options = q.querySelectorAll('.cw-q-opt')
      const feedback = q.querySelector('.cw-q-fb')
      for (const option of options) {
        option.addEventListener('click', () => {
          const chosen = String(option.dataset.opt || '').trim().toLowerCase()
          for (const other of options) other.classList.remove('is-right', 'is-wrong')
          const right = answer !== '' && chosen === answer
          option.classList.add(right ? 'is-right' : 'is-wrong')
          if (feedback !== null) {
            feedback.classList.add('is-show')
            feedback.setAttribute('aria-live', 'polite')
          }
        })
      }
    }
    for (const button of document.querySelectorAll('[data-reveal]')) {
      const targetId = button.getAttribute('data-reveal')
      const target = targetId ? document.getElementById(targetId) : null
      if (target === null) continue
      button.setAttribute('aria-expanded', String(!target.hidden))
      if (typeof labels.reveal === 'string' && button.dataset.revealed !== 'true') {
        button.textContent = labels.reveal
      }
      button.addEventListener('click', () => {
        const show = target.hidden
        target.hidden = !show
        button.setAttribute('aria-expanded', show ? 'true' : 'false')
        button.dataset.revealed = show ? 'true' : 'false'
        button.textContent = show
          ? (labels.hideAnswer || 'Hide answer')
          : (labels.reveal || 'Show answer')
      })
    }
  }

  // ── self-check ───────────────────────────────────────────────────────────
  const runtimeErrors = []
  window.__cwRuntimeErrors = runtimeErrors
  window.addEventListener('error', (event) => { runtimeErrors.push(String(event.message || 'script error')) })
  window.addEventListener('unhandledrejection', (event) => { runtimeErrors.push(String(event.reason || 'unhandled rejection')) })

  function check() {
    const errors = []
    const warnings = []
    const ids = new Set()
    for (const section of sectionData) {
      if (ids.has(section.id)) errors.push(`duplicate section id: ${section.id}`)
      ids.add(section.id)
      if (!section.title) warnings.push(`section without title: ${section.id}`)
    }
    const links = navLinks.querySelectorAll('a').length
    if (links !== sectionData.length) errors.push(`nav has ${links} links for ${sectionData.length} sections`)

    const allIds = new Set()
    for (const el of document.querySelectorAll('[id]')) {
      if (allIds.has(el.id)) errors.push(`duplicate id: ${el.id}`)
      allIds.add(el.id)
    }

    let sourceLinks = 0
    let codeBlocks = 0
    for (const el of document.querySelectorAll('[data-source]')) {
      sourceLinks += 1
      const ref = parseRef(el.getAttribute('data-source'))
      if (ref === null) {
        errors.push(`bad data-source: ${el.getAttribute('data-source')}`)
        continue
      }
      const text = sourceText(ref.file)
      if (text === null) {
        errors.push(`source not embedded: ${ref.file}`)
        continue
      }
      const count = text.replace(/\r\n?/g, '\n').split('\n').length
      if (ref.line > count) errors.push(`source line out of range: ${ref.file}:${ref.line}`)
    }
    for (const figure of document.querySelectorAll('.cw-code')) {
      codeBlocks += 1
      if (figure.querySelector('.cw-code-line') === null) errors.push('code block has no lines')
    }
    for (const el of document.querySelectorAll('script[src], iframe[src]')) errors.push(`external resource: ${el.getAttribute('src')}`)
    for (const el of document.querySelectorAll('link[rel="stylesheet"]')) errors.push('external stylesheet')
    for (const img of document.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src') || ''
      if (/^(?:https?:)?\/\//i.test(src)) errors.push(`external image: ${src}`)
    }
    if (runtimeErrors.length > 0) errors.push(...runtimeErrors.map((e) => `runtime: ${e}`))
    if (document.querySelector('.cw-nav') === null) errors.push('missing nav')
    if (document.querySelector('#cw-source') === null) errors.push('missing source drawer')

    return {
      ok: errors.length === 0,
      sections: sectionData.length,
      sourceLinks,
      codeBlocks,
      sources: Object.keys(files).length,
      dsh: isDsh,
      errors,
      warnings,
    }
  }
  window.__cwCheck = check

  // ── events ───────────────────────────────────────────────────────────────
  document.addEventListener('click', (event) => {
    const target = event.target
    if (target === null || typeof target.closest !== 'function') return

    const sourceTrigger = target.closest('[data-source]')
    if (sourceTrigger !== null) {
      const ref = parseRef(sourceTrigger.getAttribute('data-source'))
      if (ref !== null) {
        event.preventDefault()
        openSource(ref.file, ref.line)
        return
      }
    }

    const anchor = target.closest('a[href^="#"]')
    if (anchor !== null) {
      const raw = anchor.getAttribute('href').slice(1)
      if (raw === '' || raw.includes('=')) return
      const id = decodeURIComponent(raw)
      if (!sectionById.has(id)) return
      event.preventDefault()
      scrollToSection(id)
      updateHashSection(id)
    }
  })

  sourceToggle.addEventListener('click', toggleSource)
  sourceClose.addEventListener('click', closeSource)
  backdrop.addEventListener('click', closeSource)
  window.addEventListener('resize', updateBackdrop)

  window.addEventListener('scroll', () => {
    updateProgress()
    updateActiveNav()
  }, { passive: true })

  window.addEventListener('hashchange', () => {
    const state = parseHash()
    if (state.dsh !== null && state.dsh !== bridge.dsh) {
      bridge = state
      return
    }
    if (state.section && sectionById.has(state.section)) scrollToSection(state.section, false)
  })

  applyLabels()
  buildNav()
  setupQuizzes()
  updateProgress()
  updateActiveNav()

  const initial = bridge.section || (location.hash && !location.hash.includes('=') ? decodeURIComponent(location.hash.slice(1)) : '')
  if (initial && sectionById.has(initial)) {
    // Wait for layout/fonts; an early scroll can compute the wrong offset.
    const jump = () => scrollToSection(initial, false)
    setTimeout(jump, 120)
    window.addEventListener('load', jump, { once: true })
  }
})()
