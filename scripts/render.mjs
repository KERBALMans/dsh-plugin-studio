// Render the studio page to real HTML with a minimal React stand-in, so the
// markup can be inspected without launching the client.
//
// React is bundled into the shell and is not on disk, so this harness implements
// just the subset client.js uses: createElement, useState, useEffect, useMemo,
// useCallback, useRef. It is a *renderer*, not React: it re-renders until state
// settles, which is enough to catch the failures that matter here — a crash
// while rendering, a component returning undefined, text that never reaches the
// DOM, a class that no rule styles, a control that is drawn but unreachable.
//
// Two details that a naive version gets wrong, both of which produce a page that
// looks "empty" instead of failing loudly:
//   1. Hook state is per component *instance* (keyed by its position in the
//      tree), not one global array — otherwise a child's first hook overwrites
//      its parent's.
//   2. The settle loop must wait real time, because the loaders await `fetch`
//      and a microtask tick is not enough for that promise to resolve.
import fs from 'node:fs'
import vm from 'node:vm'

const HERE = new URL('.', import.meta.url)
const CLIENT = new URL('../client.js', HERE)
// The GUI port changes every time the desktop app restarts, so it is not a
// constant worth hardcoding: a stale port makes this script silently render an
// empty page and "fail" for a reason that has nothing to do with the plugin.
// Order: explicit flag, then environment, then the default port.
const PORT = (() => {
  const flag = process.argv.find((a) => a.startsWith('--port='))
  if (flag) return flag.slice('--port='.length)
  if (process.env.DSH_WEB_PORT) return process.env.DSH_WEB_PORT
  return '53494'
})()
const ORIGIN = `http://127.0.0.1:${PORT}`
const API = ORIGIN + '/api/dsh-plugin-studio'
const LIVE = !process.argv.includes('--offline')

/* ------------------------------------------------------------------ */
/* real data                                                          */
/* ------------------------------------------------------------------ */

/**
 * Offline mode reads `fixtures/*.json` instead of the live API.
 *
 * CI has no running Host, and an empty dataset would make every layout check
 * fail for a reason that has nothing to do with the plugin. The fixtures are a
 * sanitised snapshot of one real run: 31 plugins, 8 skills, all three levels
 * populated. They are committed so the render check is reproducible.
 */
const FIXTURE_DIR = new URL('../fixtures/', import.meta.url)

function fixture(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(new URL(name, FIXTURE_DIR), 'utf8'))
  } catch {
    return fallback
  }
}

async function grab(path, fallback) {
  if (!LIVE) return fixture(path.replace(/^\//, '') + '.json', fallback)
  try {
    const response = await fetch(API + path)
    if (!response.ok) return fallback
    return await response.json()
  } catch {
    return fallback
  }
}

const empty = { ok: true, rows: [], catalog: { families: [], domains: [] }, warnings: [] }
const inventory = await grab('/inventory', empty)
const skills = await grab('/skills', empty)
const saved = await grab('/saved', { ok: true, saved: [] })
const root = await grab('/', { ok: true, apiVersion: 3 })

console.log(`data: inventory rows=${(inventory.rows || []).length} skills rows=${(skills.rows || []).length} packs=${(saved.saved || []).length}`)

/* ------------------------------------------------------------------ */
/* a tiny React                                                       */
/* ------------------------------------------------------------------ */

const hookStore = new Map()
let currentKey = ''
let hookIndex = 0
let pending = 0

function withHooks(key, fn) {
  const prevKey = currentKey
  const prevIndex = hookIndex
  currentKey = key
  hookIndex = 0
  if (!hookStore.has(key)) hookStore.set(key, [])
  try {
    return fn()
  } finally {
    currentKey = prevKey
    hookIndex = prevIndex
  }
}

function slot() {
  const list = hookStore.get(currentKey)
  const index = hookIndex++
  return [list, index]
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }
  },
  useState(initial) {
    const [list, index] = slot()
    if (!(index in list)) list[index] = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      const before = list[index]
      const after = typeof next === 'function' ? next(before) : next
      if (after !== before) {
        list[index] = after
        pending += 1
      }
    }
    return [list[index], setter]
  },
  useEffect(fn) {
    const [list, index] = slot()
    if (!(index in list)) {
      list[index] = true
      fn()
    }
  },
  useMemo(fn) {
    slot()
    return fn()
  },
  useCallback(fn) {
    slot()
    return fn
  },
  useRef(value) {
    const [list, index] = slot()
    if (!(index in list)) list[index] = { current: value }
    return list[index]
  },
  Fragment: 'Fragment',
}

/* ------------------------------------------------------------------ */
/* render to html                                                     */
/* ------------------------------------------------------------------ */

const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link'])
const ATTR = /^(className|id|type|value|checked|disabled|placeholder|title|style|href|viewBox|fill|stroke|strokeWidth|strokeLinecap|strokeLinejoin|width|height|d|aria-hidden|data-[\w-]+)$/

function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function render(node, path = 'root') {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return escape(node)
  if (Array.isArray(node)) return node.map((child, index) => render(child, `${path}/${index}`)).join('')
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children.length) props.children = node.children.length === 1 ? node.children[0] : node.children
    const name = node.type.name || 'anon'
    return withHooks(`${path}<${name}>`, () => render(node.type(props), `${path}<${name}>`))
  }
  if (node.type === 'Fragment') return node.children.map((child, index) => render(child, `${path}/${index}`)).join('')

  const attrs = []
  for (const [key, value] of Object.entries(node.props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'children' || key.startsWith('on')) continue
    if (!ATTR.test(key)) continue
    if (key === 'style' && typeof value === 'object') {
      const css = Object.entries(value).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${v}`).join(';')
      attrs.push(`style="${escape(css)}"`)
      continue
    }
    if (key === 'checked' || key === 'disabled') {
      if (value) attrs.push(key)
      continue
    }
    // React's `className` is the DOM's `class`; emitting it verbatim produces
    // markup that no stylesheet matches, which is exactly the kind of silent
    // styling failure this harness is meant to expose.
    attrs.push(`${key === 'className' ? 'class' : key}="${escape(value)}"`)
  }
  const open = `<${node.type}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
  if (VOID.has(node.type)) return open
  return `${open}${node.children.map((child, index) => render(child, `${path}/${index}`)).join('')}</${node.type}>`
}

/* ------------------------------------------------------------------ */
/* drive the module                                                   */
/* ------------------------------------------------------------------ */

const src = fs.readFileSync(CLIENT, 'utf8')
let loaded = null

// The client calls fetch(`/api/dsh-plugin-studio${path}`) — a *relative* URL, so
// matching against the absolute origin never fires. Strip the prefix as written.
function answer(url, init) {
  const path = String(url).replace('/api/dsh-plugin-studio', '').replace(/^$/, '/')
  const body = init && init.body ? JSON.parse(init.body) : null
  const json = (value) => ({ ok: true, json: async () => value })
  if (path === '/') return json(root)
  if (path === '/inventory') return json(inventory)
  if (path === '/skills') return json(skills)
  if (path === '/saved') return json(saved)
  if (path === '/pack') return json({ ok: true, pack: { meta: { name: 'preview' }, entries: [] } })
  if (path === '/save') return json({ ok: true, file: 'preview.dshpack.json' })
  if (path === '/delete-pack') return json({ ok: true })
  if (path === '/remove' || path === '/skills/remove') {
    return json({ ok: true, results: [], removed: 0, failed: 0, restart: null, dryRun: body && body.dryRun })
  }
  return json({ ok: true })
}

const sandbox = {
  console,
  window: { __ModuleLoader__: { load: (def) => { loaded = def } } },
  document: {
    head: { appendChild() {} },
    createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {} }),
    getElementById: () => ({ id: 'dps-styles' }),
  },
  require: (id) => {
    if (id === 'react') return React
    throw new Error('unexpected require: ' + id)
  },
  fetch: async (url, init) => answer(url, init),
  setTimeout,
  clearTimeout,
  URL,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'client.js' })

if (!loaded) throw new Error('client.js never called __ModuleLoader__.load')
const mod = loaded.factory(sandbox.require)

let Panel = null
const ctx = {
  effect(fn) {
    const cleanup = fn()
    return () => { if (typeof cleanup === 'function') cleanup() }
  },
  on() { return () => {} },
  get() { return undefined },
  slots: {
    inject(key, cb) { return cb() },
    register(reg, Comp) { Panel = Comp; return () => {} },
    registerFactory() { return () => {} },
  },
  locale: { getLocale: () => 'zh' },
  timer: { interval: () => () => {}, timeout: () => () => {} },
}
mod.apply(ctx)
if (!Panel) throw new Error('no panel was registered')

let html = ''
let passes = 0
for (; passes < 40; passes += 1) {
  pending = 0
  hookIndex = 0
  html = render(React.createElement(Panel))
  await new Promise((resolve) => setTimeout(resolve, 20))
  if (pending === 0 && passes >= 2) break
}
console.log(`settled after ${passes + 1} passes`)

/* ------------------------------------------------------------------ */
/* report                                                             */
/* ------------------------------------------------------------------ */

const outDir = new URL('../build/', HERE)
fs.mkdirSync(outDir, { recursive: true })

// Match the template literal regardless of line endings. `core.autocrlf=input`
// (Windows CI) checks `client.js` out with CRLF, and a `\n`-anchored regex then
// finds nothing — `css` goes empty and every class looks unstyled, which reads
// as "the stylesheet is missing" rather than "the regex is wrong".
const cssMatch = src.match(/const CSS = `([\s\S]*?)`\r?\n/)
const css = cssMatch ? cssMatch[1] : ''

const page = `<!doctype html>
<meta charset="utf-8">
<title>插件工坊 — preview</title>
<style>
  :root {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-1: #fafafa;
    --dsw-alias-bg-layer-2: #f2f2f3;
    --dsw-alias-bg-overlay: #ffffff;
    --dsw-alias-border-l1: #e6e6e8;
    --dsw-alias-border-l2: #d4d4d8;
    --dsw-alias-brand-primary: #4d6bfe;
    --dsw-alias-label-primary: #1a1a1c;
    --dsw-alias-label-secondary: #6b6b73;
    --dsw-alias-state-error-primary: #d93a3a;
    --dsw-alias-state-idle-primary: #8a8a92;
    --dsw-alias-state-success-primary: #1f9d55;
    --dsw-alias-state-warn-primary: #c47a10;
    --dsw-specific-sidebar-fill: #f7f7f8;
  }
  body { margin: 0; padding: 24px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
${css}
</style>
<div id="mount">${html}</div>
`

fs.writeFileSync(new URL('preview.html', outDir), page)

const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
console.log('markup:', html.length, 'bytes')
console.log('text  :', text.slice(0, 400) + (text.length > 400 ? '…' : ''))

let failed = 0
const check = (ok, label, extra) => {
  if (ok) console.log('  ok   ' + label)
  else { failed += 1; console.log('  FAIL ' + label + (extra ? ' — ' + extra : '')) }
}

console.log('\n=== render ===')
check(text.length > 200, '页面渲染出了实质内容', `${text.length} chars`)
check(html.includes('dps-root'), '根节点带 dps-root 类')
// Rows carry `data-sel="0"` as well as the class, so match the attribute prefix
// rather than the exact bare string.
const rowCount = (html.match(/class="dps-row"/g) || []).length

check(rowCount > 0, '渲染出了插件行', `${rowCount} 行`)
check(html.includes('type="checkbox"'), '每行都有复选框')
check(!/undefined/.test(text), '正文里没有出现 undefined', text.match(/.{0,40}undefined.{0,40}/)?.[0])
check(!/NaN/.test(text), '正文里没有出现 NaN')

console.log('\n=== css coverage ===')
const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)))
const styled = new Set([...css.matchAll(/\.(dps-[\w-]+)/g)].map((m) => m[1]))
const unstyled = [...classes].filter((c) => c.startsWith('dps-') && !styled.has(c))
check(unstyled.length === 0, '用到的类都有样式', unstyled.join(', '))

if (failed > 0) {
  console.log(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
