// Check that every custom property the studio page uses is a token the client
// actually declares. A typo here renders as an unstyled element, which is
// invisible to unit tests but obvious on screen — so it is asserted instead.
import fs from 'node:fs'

// From the client Theme provider's token list (cordis_inspect_query Theme.listTokens).
const DECLARED = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
])

const src = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const used = new Set()
for (const m of src.matchAll(/var\((--dsw-[a-z0-9-]+)/g)) used.add(m[1])

let failed = 0
const check = (ok, label, extra) => {
  if (ok) console.log('  ok   ' + label)
  else {
    failed += 1
    console.log('  FAIL ' + label + (extra ? ' — ' + extra : ''))
  }
}

console.log('=== theme tokens ===')
const unknown = [...used].filter((t) => !DECLARED.has(t))
check(unknown.length === 0, '用到的自定义属性都是客户端声明的 token', unknown.join(', '))
console.log(`  用到 ${used.size} 个 token：${[...used].sort().join(', ')}`)

console.log('\n=== hard-coded colours ===')
// Hex colours and rgb()/hsl() literals bypass the theme and stay light in dark
// mode. color-mix over a token is the supported way to tint.
const hex = [...src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]).filter((c) => c !== '#000')
check(hex.length === 0, '没有硬编码的十六进制颜色', hex.join(', '))
const rgb = [...src.matchAll(/\b(rgba?|hsla?)\(/g)].map((m) => m[0])
check(rgb.length === 0, '没有硬编码的 rgb()/hsl() 颜色', rgb.join(', '))

console.log('\n=== DOM safety ===')
// Comments talk about the rule ("nothing is appended to document.body"), so the
// check has to look at code only — otherwise the doc comment fails the audit it
// is describing.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/^\s*\/\/.*$/, '').replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n')
check(!code.includes('document.body'), '没有往 document.body 挂东西')
check(!code.includes('innerHTML'), '没有用 innerHTML')
check(!code.includes('dangerouslySetInnerHTML'), '没有用 dangerouslySetInnerHTML')
check(!/document\.querySelector/.test(code), '没有读别人的 DOM')

console.log('\n=== module contract ===')
check(src.includes("window.__ModuleLoader__.load({"), '走 __ModuleLoader__ 注册')
check(/inject:\s*\['slots'\]/.test(src), 'inject 只声明 slots')
const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
check(requires.length === 1 && requires[0] === 'react', '只 require react', requires.join(', '))

if (failed > 0) {
  console.log(`\n${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
