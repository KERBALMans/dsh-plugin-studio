/**
 * Cross-version compatibility.
 *
 * The requirement is "works on 0.2.1-rc.1, rc.2, rc.3 and future builds". Only
 * one of those is installed on this machine, so installing the others is not
 * available — and installing them would not prove much anyway, because the
 * thing that actually breaks a plugin across Harness versions is *which Service
 * methods exist*, not the version string.
 *
 * So this file tests the real risk directly: it builds a ctx for each release's
 * contract (plus two hostile future ones) and asserts the plugin still answers
 * its routes instead of throwing inside `apply`. A plugin that throws in `apply`
 * vanishes from the GUI with no error the user can act on, which is the failure
 * mode worth engineering against.
 *
 * Run: node scripts/compat.mjs
 */
import { setProfileDir } from '../lib/env.js'
import { resolveProfile } from './_profile.mjs'
import { capabilityReport } from '../lib/caps.js'
import { makeHandler } from '../index.js'

const PROFILE = resolveProfile()
setProfileDir(PROFILE)

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`)
}

/* ------------------------------------------------------------------ */
/* fake request/response                                               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* the release contracts                                               */
/* ------------------------------------------------------------------ */

/**
 * Each profile is the Service surface one release is known to expose. Where a
 * method is missing the plugin must degrade, not throw.
 *
 * `rc1` is the pessimistic reading of the oldest supported release: the manager
 * could list and enable, but not remove or inspect, and `skills` did not exist
 * yet. `rc2` adds removal. `rc3` is what is actually installed. `future-a`
 * models a release that renames nothing but adds surface; `future-b` models the
 * genuinely dangerous one — a release that drops `listBundles` in favour of
 * something else, leaving the file fallback as the only way to see anything.
 */
/**
 * Bundles every contract returns, so the classification assertions actually run
 * instead of passing over an empty list. These mirror the real shapes seen from
 * `pluginManager.listBundles()`: an official base, an official *optional* row
 * (which must not be mistaken for the core), and a third-party bundle with a
 * `rows` array of its own.
 */
const SAMPLE_BUNDLES = [
  {
    name: '@deepseek-ai/dsh-base',
    official: true,
    optional: false,
    availability: 'installation',
    installed: true,
    enabled: true,
    removable: false,
    version: '0.2.1-rc.3',
    description: 'Shared DSH core: patch layer and runtime glue',
    rows: [{ entryId: 'base', moduleName: '@deepseek-ai/dsh-base', enabled: true, meta: { title: 'DSH Base' } }],
  },
  {
    name: 'experimental-terminal-bundle',
    official: true,
    optional: true,
    availability: 'installation',
    installed: false,
    enabled: false,
    removable: true,
    version: '0.2.1-rc.3',
    description: 'A persistent terminal that keeps shell processes alive',
    rows: [],
  },
  {
    name: 'demo-wallpaper',
    official: false,
    optional: false,
    availability: 'profile',
    installed: true,
    enabled: true,
    removable: true,
    version: '1.0.0',
    description: '动态壁纸主题皮肤',
    rows: [{ entryId: 'include:demo-wallpaper', moduleName: 'demo-wallpaper', enabled: true, meta: { title: '壁纸' } }],
  },
  {
    name: 'demo-session-cleaner',
    official: false,
    optional: false,
    availability: 'profile',
    installed: true,
    enabled: true,
    removable: true,
    version: '1.0.0',
    description: '删除会话与清理会话记录',
    rows: [],
  },
]

const CONTRACTS = {
  '0.2.1-rc.1': {
    profileContext: { dir: PROFILE },
    pluginManager: {
      listBundles: async () => SAMPLE_BUNDLES,
      listPlugins: async () => [],
      setBundleEnabled: async () => ({ changed: true, application: 'applied' }),
      setPluginEnabled: async () => ({ changed: true, application: 'applied' }),
      installBundle: async () => ({ changed: true, application: 'applied' }),
    },
  },
  '0.2.1-rc.2': {
    profileContext: { dir: PROFILE },
    pluginManager: {
      listBundles: async () => SAMPLE_BUNDLES,
      listPlugins: async () => [],
      setBundleEnabled: async () => ({ changed: true, application: 'applied' }),
      setPluginEnabled: async () => ({ changed: true, application: 'applied' }),
      installBundle: async () => ({ changed: true, application: 'applied' }),
      removeBundle: async () => ({ changed: true, application: 'restart-required', restartReason: 'host-module' }),
    },
  },
  '0.2.1-rc.3': {
    profileContext: { dir: PROFILE },
    pluginManager: {
      listBundles: async () => SAMPLE_BUNDLES,
      listPlugins: async () => [],
      setBundleEnabled: async () => ({ changed: true, application: 'applied' }),
      setPluginEnabled: async () => ({ changed: true, application: 'applied' }),
      installBundle: async () => ({ changed: true, application: 'applied' }),
      removeBundle: async () => ({ changed: true, application: 'restart-required', restartReason: 'host-module' }),
      inspect: async () => ({}),
      registries: async () => [],
      listVersionExemptions: () => ({ exemptions: {}, warnings: [] }),
    },
    skills: {
      list: async () => [
        { name: 'demo-skill', description: 'a demo skill', source: 'user-dsh', provider: 'fs', invocation: { modelInvocable: true, userInvocable: true } },
      ],
    },
    sessionQuery: {
      listSessions: async () => [],
      readSession: async () => ({ session: {}, events: [] }),
    },
    llm: {
      listProviders: async () => [],
      prepareCall: async () => ({ stream: async function* () {} }),
    },
    web: { search: async () => ({ results: [] }) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'x', model: 'y' }) },
  },
  // A release that only adds surface must change nothing.
  'future-additive': {
    profileContext: { dir: PROFILE },
    pluginManager: {
      listBundles: async () => SAMPLE_BUNDLES,
      listPlugins: async () => [],
      setBundleEnabled: async () => ({ changed: true, application: 'applied' }),
      setPluginEnabled: async () => ({ changed: true, application: 'applied' }),
      installBundle: async () => ({ changed: true, application: 'applied' }),
      removeBundle: async () => ({ changed: true, application: 'applied' }),
      inspect: async () => ({}),
      registries: async () => [],
      listVersionExemptions: () => ({ exemptions: {}, warnings: [] }),
      // Something this plugin has never heard of. It must be ignored, not
      // mistaken for a method the plugin calls.
      somethingBrandNew: async () => ({ ok: true }),
    },
    skills: { list: async () => [], snapshot: async () => ({ skills: [], complete: true }) },
    sessionQuery: { listSessions: async () => [], readSession: async () => ({ events: [] }), traceSession: async () => ({}) },
    llm: { listProviders: async () => [], prepareCall: async () => ({ stream: async function* () {} }) },
    web: { search: async () => ({ results: [] }) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'x', model: 'y' }) },
  },
  // The dangerous one: the manager can no longer list bundles.
  'future-renamed': {
    profileContext: { dir: PROFILE },
    pluginManager: {
      // No listBundles at all. The plugin must fall back to reading the profile.
      setBundleEnabled: async () => ({ changed: true, application: 'applied' }),
      removeBundle: async () => ({ changed: true, application: 'applied' }),
    },
    skills: { list: async () => [] },
  },
}

function ctxFor(services) {
  return {
    get(name) {
      return services[name]
    },
    // Some builds expose services as ctx properties instead of through `get`.
    ...services,
  }
}

/* ------------------------------------------------------------------ */
/* checks                                                              */
/* ------------------------------------------------------------------ */

for (const [version, services] of Object.entries(CONTRACTS)) {
  section(version)
  const ctx = ctxFor(services)

  // 1. Probing must not throw, whatever shape the services are.
  let report = null
  try {
    report = capabilityReport(ctx)
  } catch (err) {
    check('能力探测不抛异常', false, err.message)
    continue
  }
  check('能力探测不抛异常', true)
  console.log(`    degraded=${report.degraded} missing=${JSON.stringify(report.missing)}`)

  // 2. Building the handler must not throw. This is the `apply`-time risk.
  let handler = null
  try {
    handler = makeHandler(ctx)
  } catch (err) {
    check('构建路由不抛异常', false, err.message)
    continue
  }
  check('构建路由不抛异常', true)

  // 3. The root route always answers and always reports the API version, so a
  //    mismatched client half can tell the user to restart instead of silently
  //    rendering an empty page.
  const root = await call(handler, '/api/dsh-plugin-studio/')
  check('根路由返回 200', root.status === 200, root.text.slice(0, 200))
  check('根路由带 apiVersion', root.json && typeof root.json.apiVersion === 'number', root.text.slice(0, 200))

  // 4. Inventory must answer with rows and a tree even when the manager cannot
  //    list anything, because the file fallback covers that case.
  const inv = await call(handler, '/api/dsh-plugin-studio/inventory')
  check('清单路由不崩', inv.status === 200, inv.text.slice(0, 300))
  check('清单有 rows 数组', inv.json && Array.isArray(inv.json.rows), inv.text.slice(0, 200))
  check('清单有 tree 数组', inv.json && Array.isArray(inv.json.tree), inv.text.slice(0, 200))
  // Not `if rows.length`: an empty list would make the classification
  // assertions below pass without ever running, which is the same class of
  // mistake as a test that only checks for absence of a crash.
  check('清单非空', inv.json && inv.json.rows.length > 0, inv.text.slice(0, 200))
  if (inv.json && Array.isArray(inv.json.rows) && inv.json.rows.length > 0) {
    const rows = inv.json.rows
    check('每行都有三级分类', rows.every((r) => r.family && r.domain && r.familyLabel && r.domainLabel))
    check('没有 other 家族', rows.every((r) => r.family !== 'other'), JSON.stringify(rows.filter((r) => r.family === 'other').map((r) => r.name)))
    // The sample set spans four different families; if everything collapses
    // into one, the classifier has regressed to "everything is a UI plugin".
    const families = new Set(rows.map((r) => r.family))
    check('分类有区分度', families.size >= 3, JSON.stringify([...families]))
    // An official *optional* bundle is not core — that misread once put 19 of
    // 28 rows into one family on the real profile.
    const terminal = rows.find((r) => r.name === 'experimental-terminal-bundle')
    check('官方可选包没被判成内核', !terminal || terminal.family !== 'core', terminal && terminal.family)
    const wallpaper = rows.find((r) => r.name === 'demo-wallpaper')
    check('壁纸插件判成界面', !wallpaper || wallpaper.family === 'ui', wallpaper && wallpaper.family)
    const cleaner = rows.find((r) => r.name === 'demo-session-cleaner')
    check('会话清理插件判成会话', !cleaner || cleaner.family === 'session', cleaner && cleaner.family)
    check('树叶覆盖全部行', inv.json.tree.reduce((n, f) => n + f.domains.reduce((m, d) => m + d.leaves.length, 0), 0) === rows.length)
  }

  // 5. Skills must answer even where the Service is absent.
  const sk = await call(handler, '/api/dsh-plugin-studio/skills')
  check('技能路由不崩', sk.status === 200, sk.text.slice(0, 300))
  check('技能有 rows 数组', sk.json && Array.isArray(sk.json.rows), sk.text.slice(0, 200))

  // 6. The AI route must report unavailability rather than throw when there is
  //    no model, which is the common case on a fresh install.
  const explain = await call(handler, '/api/dsh-plugin-studio/explain', { kind: 'plugin', keys: [], limit: 1 })
  check('讲解路由不崩', explain.status === 200 || explain.status === 400, explain.text.slice(0, 300))

  // 7. Removal must refuse rather than throw when the manager cannot remove.
  //    A key that does not resolve is reported, not acted on; the shape may be
  //    either a request-level error or an empty result, but it must never
  //    silently claim to have removed something.
  const remove = await call(handler, '/api/dsh-plugin-studio/remove', { keys: ['bundle:does-not-exist'], dryRun: true })
  check('删除路由不崩', remove.status === 200, remove.text.slice(0, 300))
  const refused = remove.json && (remove.json.ok === false || remove.json.removed === 0)
  check('删除不存在的行被拒绝', refused, JSON.stringify(remove.json).slice(0, 200))
  check('删除不存在的行没有产生删除记录', !remove.json || !remove.json.removed, JSON.stringify(remove.json).slice(0, 200))
}

/* ------------------------------------------------------------------ */
/* the version-independent guarantee                                   */
/* ------------------------------------------------------------------ */

section('contract independence')
// Every capability the plugin *uses* must be probed before use. This asserts
// the two halves of that rule: the probe list covers what the code touches, and
// an empty ctx produces a report instead of an exception.
const empty = capabilityReport({ get: () => undefined })
check('空 ctx 也能探测', empty && typeof empty.degraded === 'boolean')
check('空 ctx 报告全部缺失', empty.missing.length >= 4, JSON.stringify(empty.missing))
const emptyHandler = makeHandler({ get: () => undefined })
const emptyRoot = await call(emptyHandler, '/api/dsh-plugin-studio/')
check('空 ctx 下根路由仍返回 200', emptyRoot.status === 200, emptyRoot.text.slice(0, 200))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
