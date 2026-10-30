// Measure the rendered page in a real browser.
//
// The screenshot is only useful to a human; this reports the numbers a layout
// bug actually shows up in: is the panel non-empty, are rows laid out, does
// anything overflow horizontally, did the theme tokens resolve (a miss renders
// as `rgba(0,0,0,0)` and silently loses contrast), and is the tree indented so
// the three levels read as three levels.
//
// Uses the Edge/Chrome binary already on this machine in headless mode and reads
// the result back out of the DOM, because there is no puppeteer here and adding
// one would mean a dependency the plugin does not need.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = new URL('.', import.meta.url)
const BUILD = new URL('../build/', HERE)
const PREVIEW = new URL('preview.html', BUILD)
const MEASURE = new URL('measure.html', BUILD)

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const browser = BROWSERS.find((path) => fs.existsSync(path))
if (!browser) {
  console.log('no browser found; skipping layout measurement')
  process.exit(0)
}

// `render.mjs` produces the page this script measures. Running this first on a
// clean checkout would otherwise die on a missing-file stack trace that says
// nothing about what to do, so build it here when it is absent.
if (!fs.existsSync(PREVIEW)) {
  console.log('preview.html missing; rendering it first')
  execFileSync(process.execPath, [fileURLToPath(new URL('render.mjs', HERE)), '--offline'], {
    stdio: 'inherit',
  })
}

const html = fs.readFileSync(PREVIEW, 'utf8')

// The probe runs inside the page: measure, then replace the document with the
// JSON so `--dump-dom` has something small and machine-readable to print.
const probe = `
<script>
(() => {
  const px = (n) => Math.round(n * 10) / 10
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: px(r.x), y: px(r.y), w: px(r.width), h: px(r.height) } }
  const root = document.querySelector('.dps-root')
  const rows = [...document.querySelectorAll('.dps-row')]
  const fams = [...document.querySelectorAll('.dps-famhead')]
  const doms = [...document.querySelectorAll('.dps-domhead')]
  const checks = [...document.querySelectorAll('.dps-check')]
  const cs = root ? getComputedStyle(root) : null

  // Resolve each theme token the way the page will in the real shell.
  const tokens = ['--dsw-alias-bg-base','--dsw-alias-bg-layer-1','--dsw-alias-bg-layer-2','--dsw-alias-brand-primary','--dsw-alias-label-primary','--dsw-alias-label-secondary','--dsw-alias-border-l1','--dsw-alias-state-error-primary','--dsw-alias-state-warn-primary','--dsw-alias-state-success-primary']
  const resolved = {}
  for (const name of tokens) resolved[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim()

  // The three levels are indented with padding-left, not offset — every level is
  // a full-width block. Measure the padding, and the text's own left edge, so an
  // indent that collapses to 0 is caught either way.
  const firstRowLeft = rows[0] ? px(rows[0].getBoundingClientRect().left + parseFloat(getComputedStyle(rows[0]).paddingLeft)) : null
  const firstDomLeft = doms[0] ? px(doms[0].getBoundingClientRect().left + parseFloat(getComputedStyle(doms[0]).paddingLeft)) : null
  const firstFamLeft = fams[0] ? px(fams[0].getBoundingClientRect().left + parseFloat(getComputedStyle(fams[0]).paddingLeft)) : null

  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth

  const result = {
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    root: box(root),
    counts: { rows: rows.length, families: fams.length, domains: doms.length, checkboxes: checks.length },
    indent: { family: firstFamLeft, domain: firstDomLeft, row: firstRowLeft },
    overflow,
    colors: { rootBg: cs ? cs.backgroundColor : null, rootColor: cs ? cs.color : null },
    tokens: resolved,
    rowHeights: rows.slice(0, 5).map((r) => px(r.getBoundingClientRect().height)),
    checkboxSizes: checks.slice(0, 3).map((c) => { const r = c.getBoundingClientRect(); return { w: px(r.width), h: px(r.height) } }),
  }
  const pre = document.createElement('pre')
  pre.id = 'measure'
  pre.textContent = JSON.stringify(result)
  document.documentElement.replaceChildren(pre)
})()
</script>
`

fs.writeFileSync(MEASURE, html.replace('</div>\n', '</div>\n' + probe))

const raw = execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--virtual-time-budget=4000',
  '--window-size=980,1400',
  '--dump-dom',
  'file:///' + MEASURE.pathname.replace(/^\//, ''),
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })

const match = raw.match(/<pre id="measure">([\s\S]*?)<\/pre>/)
if (!match) {
  console.log('FAIL: the page did not produce measurements')
  console.log(raw.slice(0, 600))
  process.exit(1)
}

const m = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

let failed = 0
const check = (ok, label, extra) => {
  if (ok) console.log('  ok   ' + label)
  else { failed += 1; console.log('  FAIL ' + label + (extra !== undefined ? ' — ' + extra : '')) }
}

console.log('=== layout ===')
console.log('  viewport', m.viewport.w + 'x' + m.viewport.h)
console.log('  counts  ', JSON.stringify(m.counts))
console.log('  indent  ', JSON.stringify(m.indent))
console.log('  row heights', JSON.stringify(m.rowHeights))
console.log('  checkboxes', JSON.stringify(m.checkboxSizes))

check(m.root && m.root.w > 300, '面板有实际宽度', m.root && m.root.w)
check(m.counts.rows > 0, '渲染出了行', m.counts.rows)
check(m.counts.checkboxes === m.counts.rows, '每行都有一个复选框', `${m.counts.checkboxes}/${m.counts.rows}`)
check(m.overflow <= 0, '没有横向溢出', m.overflow + 'px')
check(m.indent.family < m.indent.domain && m.indent.domain < m.indent.row, '三级分类有逐级缩进', JSON.stringify(m.indent))
check(m.rowHeights.every((h) => h > 20), '行高足够容纳内容', JSON.stringify(m.rowHeights))
check(m.checkboxSizes.every((s) => s.w >= 12 && s.h >= 12), '复选框可点击', JSON.stringify(m.checkboxSizes))

console.log('\n=== theme tokens resolve ===')
const missing = Object.entries(m.tokens).filter(([, v]) => !v).map(([k]) => k)
check(missing.length === 0, '全部 token 有值', missing.join(', '))
console.log('  colors', JSON.stringify(m.colors))

if (failed > 0) {
  console.log(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
