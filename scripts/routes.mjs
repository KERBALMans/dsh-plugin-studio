/**
 * Drive the real HTTP handler with a fake request/response.
 *
 * The plugin's routes are only reachable from the running Host, which caches
 * ES modules — so a source fix cannot be verified by curl until the client is
 * restarted. This calls `makeHandler` directly and asserts on what it writes,
 * which is the same code path the browser hits.
 *
 * Run: node scripts/routes.mjs
 */
import { setProfileDir } from '../lib/env.js'
import { resolveProfile } from './_profile.mjs'
import { makeHandler } from '../index.js'

const PROFILE = resolveProfile()
setProfileDir(PROFILE)

const ctx = {
  get: (name) => (name === 'profileContext' ? { dir: PROFILE } : undefined),
}

function fakeResponse() {
  const chunks = []
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    writeHead(code, headers) {
      this.statusCode = code
      Object.assign(this.headers, headers || {})
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8')
    },
  }
}

async function call(handler, path, method = 'GET', body = null) {
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:53494' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data' && body) listener(Buffer.from(JSON.stringify(body)))
      if (event === 'end') listener()
      return this
    },
  }
  const res = fakeResponse()
  await handler(req, res)
  return { status: res.statusCode, json: safeParse(res.body), text: res.body }
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const handler = makeHandler(ctx)

console.log('=== GET / ===')
const root = await call(handler, '/api/dsh-plugin-studio/')
check('状态 200', root.status === 200, `got ${root.status} ${root.text.slice(0, 200)}`)
check('带 apiVersion', root.json && root.json.apiVersion === 3)
check('列出 endpoints', root.json && Array.isArray(root.json.endpoints) && root.json.endpoints.length > 10)

console.log('\n=== GET /inventory ===')
const inv = await call(handler, '/api/dsh-plugin-studio/inventory')
check('状态 200', inv.status === 200, `got ${inv.status} ${inv.text.slice(0, 300)}`)
check('返回 rows', inv.json && Array.isArray(inv.json.rows) && inv.json.rows.length > 0)
check('返回 tree', inv.json && Array.isArray(inv.json.tree) && inv.json.tree.length > 0)
const rows = (inv.json && inv.json.rows) || []
check('每行都有 family/domain', rows.every((r) => r.family && r.domain))
check('每行都有中文标签', rows.every((r) => r.familyLabel && r.domainLabel))
check('没有 other 行', rows.every((r) => r.family !== 'other'), JSON.stringify(rows.filter((r) => r.family === 'other').map((r) => r.name)))
check('一级分类多于 2 个', (inv.json.tree || []).length > 2, `tree=${(inv.json.tree || []).length}`)
const leafCount = ((inv.json && inv.json.tree) || []).reduce(
  (sum, family) => sum + family.domains.reduce((n, domain) => n + domain.leaves.length, 0),
  0,
)
check('树叶数等于行数', leafCount === rows.length, `${leafCount} vs ${rows.length}`)
check('不泄漏内部 _code', inv.text.indexOf('"_code"') === -1)

console.log('\n=== GET /skills ===')
const skills = await call(handler, '/api/dsh-plugin-studio/skills')
check('状态 200', skills.status === 200, `got ${skills.status} ${skills.text.slice(0, 300)}`)
check('返回 rows 数组', skills.json && Array.isArray(skills.json.rows))

console.log('\n=== GET /diag ===')
const diag = await call(handler, '/api/dsh-plugin-studio/diag')
check('状态 200', diag.status === 200, `got ${diag.status}`)
check('报告 capabilities', diag.json && diag.json.caps)
check('报告 profileDir', diag.json && diag.json.profileDir)

console.log('\n=== GET /nope (404) ===')
const missing = await call(handler, '/api/dsh-plugin-studio/nope')
check('未知路径返回 404', missing.status === 404, `got ${missing.status}`)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
