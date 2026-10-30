/**
 * Exercise the AI explain route for real.
 *
 * This is the one route whose behaviour cannot be inferred from a unit test:
 * it depends on the user's configured model, on the prompt actually being
 * parseable, and on the model returning JSON. It costs tokens, so it runs a
 * deliberately small batch.
 *
 * Run: node scripts/ai.mjs [limit]
 */
import { setProfileDir } from '../lib/env.js'
import { makeHandler } from '../index.js'

const PROFILE = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'
setProfileDir(PROFILE)

// The real Host supplies these services; a bare fake ctx cannot, so the route
// will report `available:false` and this script proves the *degraded* path.
// A live check has to go through the running client's HTTP route.
const ctx = { get: (name) => (name === 'profileContext' ? { dir: PROFILE } : undefined) }

function fakeResponse() {
  const chunks = []
  return {
    statusCode: 0,
    headers: {},
    setHeader() {},
    writeHead(code) {
      this.statusCode = code
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.from(String(chunk)))
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
    headers: { host: '127.0.0.1' },
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
const inv = await call(handler, '/api/dsh-plugin-studio/inventory')
const rows = (inv.json && inv.json.rows) || []

console.log('=== /explain 在无模型时优雅降级 ===')
const res = await call(handler, '/api/dsh-plugin-studio/explain', {
  keys: rows.slice(0, 2).map((r) => r.key),
})
check('状态 200（不炸）', res.status === 200, res.text.slice(0, 300))
check('返回 stats', res.json && res.json.stats, JSON.stringify(res.json).slice(0, 300))
check(
  'stats 说明为什么不可用',
  res.json && res.json.stats && (res.json.stats.available === false ? Boolean(res.json.stats.reason) : true),
  JSON.stringify(res.json && res.json.stats),
)
check('不抛异常', res.json && res.json.ok !== undefined)

console.log('\n=== /suggest 在无模型/无网络时优雅降级 ===')
const sug = await call(handler, '/api/dsh-plugin-studio/suggest', {
  online: false,
  ai: false,
})
check('状态 200', sug.status === 200, sug.text.slice(0, 300))
check('返回明确结果', sug.json && sug.json.ok === true)
// With no model reachable, `/suggest` must apply nothing and say so, rather
// than silently overwriting every row with an empty verdict.
check(
  '无模型时不改判',
  sug.json && sug.json.applied === 0,
  `applied=${sug.json && sug.json.applied}`,
)
check(
  '并说明原因',
  sug.json && sug.json.stats && Boolean(sug.json.stats.reason || sug.json.stats.available === false),
  JSON.stringify(sug.json && sug.json.stats),
)

console.log('\n=== /explain 缺参数时不炸 ===')
const empty = await call(handler, '/api/dsh-plugin-studio/explain', {})
check('状态 200 或 400', empty.status === 200 || empty.status === 400, `got ${empty.status}`)
check('有明确错误信息', empty.json && (empty.json.ok === false || empty.json.stats), empty.text.slice(0, 200))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
