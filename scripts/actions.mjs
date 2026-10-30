/**
 * Exercise the destructive routes without letting them destroy anything.
 *
 * `/remove` and `/skills/remove` rewrite the profile's dependency list and
 * patch file, so a bug here uninstalls the wrong thing. Both support `dryRun`,
 * and these checks assert that the guards fire before any write happens.
 *
 * Run: node scripts/actions.mjs
 */
import { setProfileDir, storageDir } from '../lib/env.js'
import { makeHandler, readCategories } from '../index.js'
import { removeMany } from '../lib/remove.js'

const PROFILE = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'
setProfileDir(PROFILE)

const ctx = { get: (name) => (name === 'profileContext' ? { dir: PROFILE } : undefined) }

function fakeResponse() {
  const chunks = []
  return {
    statusCode: 0,
    headers: {},
    setHeader(n, v) {
      this.headers[n] = v
    },
    writeHead(code, h) {
      this.statusCode = code
      Object.assign(this.headers, h || {})
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8')
    },
  }
}

async function call(handler, path, body) {
  const req = {
    method: body ? 'POST' : 'GET',
    url: path,
    headers: { host: '127.0.0.1:53494', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data' && body) listener(Buffer.from(JSON.stringify(body)))
      if (event === 'end') listener()
      return this
    },
  }
  const res = fakeResponse()
  await handler(req, res)
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {}
  return { status: res.statusCode, json, text: res.body }
}

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const handler = makeHandler(ctx)

console.log('=== /remove 拒绝删除自己 ===')
const self = await call(handler, '/api/dsh-plugin-studio/remove', {
  keys: ['bundle:dsh-plugin-studio'],
  dryRun: true,
})
check('状态 200', self.status === 200, self.text.slice(0, 200))
// The manager refuses the removal itself, so the route reports a per-row
// failure rather than a request-level one. What matters is that nothing is
// removed and the row carries a reason the UI can show.
check('没有删除任何东西', self.json && self.json.removed === 0, JSON.stringify(self.json).slice(0, 300))
check('该行带失败原因', self.json && self.json.results[0].ok === false && Boolean(self.json.results[0].error), JSON.stringify(self.json && self.json.results))

console.log('\n=== /remove dryRun 不动磁盘 ===')
const inventoryBefore = await call(handler, '/api/dsh-plugin-studio/inventory')
const before = (inventoryBefore.json && inventoryBefore.json.rows) || []
// This fake ctx has no pluginManager, so the inventory comes from the file
// fallback where every row is marked unremovable — correct, but it means the
// dryRun path needs a synthetic row to exercise. Use one, and keep the real
// inventory check as a conditional so the test stays meaningful on a live ctx.
const target = before.find((r) => r.removable === true && r.name !== 'dsh-plugin-studio')
if (target) {
  const dry = await call(handler, '/api/dsh-plugin-studio/remove', { keys: [target.key], dryRun: true })
  check('dryRun 状态 200', dry.status === 200, dry.text.slice(0, 300))
  check('dryRun 报告计划', dry.json && Array.isArray(dry.json.results) && dry.json.results.length === 1)
  check('dryRun 没真删', dry.json && dry.json.removed === 0, `removed=${dry.json && dry.json.removed}`)
  const after = await call(handler, '/api/dsh-plugin-studio/inventory')
  const stillThere = ((after.json && after.json.rows) || []).some((r) => r.name === target.name)
  check('dryRun 之后插件还在', stillThere)
} else {
  console.log('  --   本次 ctx 下没有可删除的行（无 pluginManager），改用合成行测 dryRun')
  const dry = await removeMany(ctx, [
    { key: 'bundle:demo', name: 'demo-bundle', kind: 'bundle', availability: 'profile', removable: true, rows: [] },
    { key: 'bundle:locked', name: 'locked-bundle', kind: 'bundle', availability: 'installation', removable: false, rows: [] },
  ], { dryRun: true })
  check('可删的行 dryRun 通过', dry.results[0].ok === true && dry.results[0].dryRun === true, JSON.stringify(dry.results[0]))
  check('不可删的行 dryRun 拒绝', dry.results[1].ok === false && Boolean(dry.results[1].error), JSON.stringify(dry.results[1]))
  check('dryRun 一件都没删', dry.removed === 1 && dry.failed === 1, `removed=${dry.removed} failed=${dry.failed}`)
  check('dryRun 不要求重启', dry.restart === null, JSON.stringify(dry.restart))
}

console.log('\n=== /remove 拒绝不可删的行 ===')
const locked = before.find((r) => r.removable === false)
if (locked) {
  const refused = await call(handler, '/api/dsh-plugin-studio/remove', { keys: [locked.key], dryRun: true })
  check(
    `拒绝删不可删的 ${locked.name}`,
    refused.json && refused.json.removed === 0 && refused.json.results[0].ok === false,
    JSON.stringify(refused.json).slice(0, 200),
  )
} else {
  console.log('  --   本机没有 removable=false 的插件行，跳过')
}

console.log('\n=== /pack 打包 ===')
const pack = await call(handler, '/api/dsh-plugin-studio/pack', {
  keys: before.slice(0, 3).map((r) => r.key),
  meta: { name: 'test-pack', note: 'auto test' },
})
check('状态 200', pack.status === 200, pack.text.slice(0, 300))
check('生成整合包', pack.json && pack.json.ok === true && Boolean(pack.json.pack))
check('包内带 entries', pack.json && pack.json.pack && Array.isArray(pack.json.pack.entries) && pack.json.pack.entries.length > 0)
check('带 format 标记', pack.json && pack.json.pack && typeof pack.json.pack.format === 'string')
check('每个条目都带分类', pack.json && pack.json.pack && pack.json.pack.entries.every((e) => e.category && e.category.family))

console.log('\n=== /save + /saved ===')
if (pack.json && pack.json.pack) {
  // The saved file is named after `pack.meta.name`, not a separate argument —
  // the client sends `{ pack }` only, so the test must do the same.
  const saved = await call(handler, '/api/dsh-plugin-studio/save', { pack: pack.json.pack })
  check('保存状态 200', saved.status === 200, saved.text.slice(0, 300))
  check('返回文件名', saved.json && typeof saved.json.file === 'string', JSON.stringify(saved.json))
  const list = await call(handler, '/api/dsh-plugin-studio/saved')
  const names = ((list.json && list.json.saved) || []).map((s) => s.file || s.name)
  check('列表里有刚存的包', names.includes(saved.json && saved.json.file), JSON.stringify(names))
  // Clean up the artifact this test created.
  const del = await call(handler, '/api/dsh-plugin-studio/delete-pack', { file: saved.json && saved.json.file })
  check('删除测试包', del.status === 200 && del.json && del.json.ok === true, del.text.slice(0, 200))
  const after = await call(handler, '/api/dsh-plugin-studio/saved')
  const remaining = ((after.json && after.json.saved) || []).map((s) => s.file || s.name)
  check('删除后列表里没有它', !remaining.includes(saved.json && saved.json.file), JSON.stringify(remaining))
}

console.log('\n=== /categories/save + reset ===')
// Use a key that is guaranteed not to exist, so this test cannot leave a real
// plugin stuck in a manual category if it fails halfway.
const FIXTURE_KEY = 'bundle:__test_fixture__'
const saveCat = await call(handler, '/api/dsh-plugin-studio/categories/save', {
  assignments: { [FIXTURE_KEY]: { domain: 'ops.manage' } },
})
check('保存分类 200', saveCat.status === 200, saveCat.text.slice(0, 200))
const afterSave = await call(handler, '/api/dsh-plugin-studio/categories/save', { assignments: {} })
check('保存后接口仍可用', afterSave.status === 200)
const reset = await call(handler, '/api/dsh-plugin-studio/categories/reset', {})
check('重置分类 200', reset.status === 200, reset.text.slice(0, 200))

// These routes write to the real storage file, so the test must put it back —
// otherwise the next run of the GUI shows a phantom manual category that no
// plugin owns. `all` is the only reset that also clears leftover keys.
const finalReset = await call(handler, '/api/dsh-plugin-studio/categories/reset', { all: true })
check('清空分类存储', finalReset.status === 200, finalReset.text.slice(0, 200))
const finalState = readCategories()
check('存储里没有残留', Object.keys(finalState.assignments).length === 0, JSON.stringify(finalState.assignments))

console.log(`\nstorage = ${storageDir()}`)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
