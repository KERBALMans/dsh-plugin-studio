/**
 * Drive the real `analyse()` pipeline in Node, against the real profile.
 *
 * `scripts/smoke.mjs` tests the library functions one by one. This one tests the
 * wiring — the exact function the HTTP route calls — because that is where a
 * Map-vs-object mistake hid the first time: every library call passed, and the
 * page still returned 500.
 *
 * Run: node scripts/analyse.mjs
 */
import { setProfileDir } from '../lib/env.js'
import { resolveProfile } from './_profile.mjs'
import { analyse } from '../index.js'

const PROFILE = resolveProfile()
setProfileDir(PROFILE)

// Only `profileContext` — everything else falls back, which is the degraded path
// a fresh install hits before the other services are up.
const ctx = {
  get(name) {
    if (name === 'profileContext') return { dir: PROFILE }
    return undefined
  },
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

for (const kind of ['plugin', 'skill']) {
  console.log(`\n=== analyse(${kind}) ===`)
  let view
  try {
    view = await analyse(ctx, { kind })
  } catch (err) {
    failures += 1
    console.log(`  FAIL threw: ${err.stack}`)
    continue
  }
  console.log(`  rows=${view.rows.length} tree=${view.tree.length} warnings=${view.warnings.length}`)
  for (const row of view.rows) {
    console.log(
      `   ${String(row.name).padEnd(34)} ${String(row.family).padEnd(8)} ${String(row.domain).padEnd(16)} ${String(row.usedText || '-').padEnd(12)} ${row.confidence}`,
    )
  }
  check('每一行都有 family', view.rows.every((row) => typeof row.family === 'string' && row.family))
  check('每一行都有 domain', view.rows.every((row) => typeof row.domain === 'string' && row.domain))
  check('每一行都有中文标签', view.rows.every((row) => row.familyLabel && row.domainLabel))
  check('没有落进 other 的行', view.rows.every((row) => row.family !== 'other'), String(view.rows.filter((row) => row.family === 'other').length))
  check('树覆盖全部行', view.tree.reduce((sum, family) => sum + family.domains.reduce((inner, domain) => inner + domain.leaves.length, 0), 0) === view.rows.length)
  check('catalog 带全 8 个一级分类', view.catalog.families.length === 8, String(view.catalog.families.length))
  // The client renders straight off these two, so they must survive JSON.
  const round = JSON.parse(JSON.stringify(view.rows))
  check('行可以安全序列化给客户端', round.length === view.rows.length && round.every((row) => row.family && row.domain))
  check('内部 _code 不外泄', round.every((row) => !('_code' in row)))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
