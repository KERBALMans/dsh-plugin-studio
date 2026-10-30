/**
 * Host half of 插件工坊 (dsh-plugin-studio).
 *
 * One HTTP surface, mounted under `/api/dsh-plugin-studio`, plus three Agent
 * tools so the same inventory is reachable from a conversation.
 *
 * The route table is deliberately a flat dispatch over a parsed URL rather than
 * a router: the whole surface is a dozen endpoints, and a flat table makes it
 * obvious that every branch authorises first, reads a bounded body, and returns
 * JSON on every path including the 404.
 */
import {
  PLUGIN_ID,
  API_PREFIX,
  API_VERSION,
  BODY_LIMIT,
  PLUGIN_VERSION,
  setProfileDir,
  profileDir,
  storageDir,
  readBody,
  sendJson,
  serviceOf,
  whenService,
  errorText,
  sanitizeFileName,
} from './lib/env.js'
import { capabilityReport } from './lib/caps.js'
import { inventory } from './lib/inventory.js'
import { FAMILIES, DOMAINS, classifyAll, buildTree, codeEvidence } from './lib/classify.js'
import { collectUsage, lastUsedFor, relativeAge } from './lib/usage.js'
import { skillInventory, removeSkills, setSkillEnabled, packSkills, skillRoots } from './lib/skills.js'
import { aiAnalyse, resolveCallTarget } from './lib/ai.js'
import { enrichRemote, needsRemote, remoteCacheExists } from './lib/remote.js'
import { removeMany, restartNotice } from './lib/remove.js'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const SUFFIX = '.dshpack.json'

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function ensureStorage() {
  try {
    mkdirSync(storageDir(), { recursive: true })
  } catch {
    // storage is a convenience, not a requirement
  }
}

function categoriesPath() {
  return join(storageDir(), 'categories.json')
}

function readCategories() {
  try {
    const raw = JSON.parse(readFileSync(categoriesPath(), 'utf8'))
    if (raw && typeof raw === 'object') {
      return {
        version: 1,
        assignments: raw.assignments && typeof raw.assignments === 'object' ? raw.assignments : {},
        notes: raw.notes && typeof raw.notes === 'object' ? raw.notes : {},
      }
    }
  } catch {
    // no saved classification yet
  }
  return { version: 1, assignments: {}, notes: {} }
}

function writeCategories(doc) {
  ensureStorage()
  writeFileSync(categoriesPath(), JSON.stringify(doc, null, 2), 'utf8')
}

function listSaved() {
  ensureStorage()
  const dir = storageDir()
  let files = []
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const file of files) {
    if (!file.endsWith(SUFFIX)) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      out.push({
        file,
        name: raw && raw.meta && raw.meta.name ? raw.meta.name : file.slice(0, -SUFFIX.length),
        createdAt: raw && raw.meta ? raw.meta.createdAt || null : null,
        count: raw && Array.isArray(raw.entries) ? raw.entries.length : 0,
        kind: raw && raw.meta ? raw.meta.kind || 'plugin' : 'plugin',
      })
    } catch {
      out.push({ file, name: file.slice(0, -SUFFIX.length), createdAt: null, count: 0, kind: 'plugin' })
    }
  }
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

/* ------------------------------------------------------------------ */
/* the shared analysis pipeline                                        */
/* ------------------------------------------------------------------ */

/**
 * Build the full view: rows + rule classification + usage + saved overrides.
 *
 * Both the plugin and skill pages run through here with `kind` selecting the
 * inventory, so the two pages cannot drift apart in behaviour. Code evidence is
 * read once per row and stashed on the row, because the AI pass wants the same
 * slots/touches and re-reading every package twice would double the page cost.
 */
async function analyse(ctx, options = {}) {
  const kind = options.kind === 'skill' ? 'skill' : 'plugin'
  const warnings = []
  let rows = []
  // Where each kind was read from. The page shows these so a user whose skills
  // live somewhere unexpected can see that the plugin looked in the right
  // places rather than assuming nothing is installed.
  let roots = []
  if (kind === 'skill') {
    const result = await skillInventory(ctx, { cwd: options.cwd })
    rows = result.rows
    roots = result.roots || []
    warnings.push(...(result.warnings || []))
  } else {
    const result = await inventory(ctx)
    // The bundle is the unit the manager installs and removes, so it is the
    // unit the page lists. A bundle's Loader rows travel with it in `rowCount`.
    rows = result.bundles
    roots = result.profileDir ? [{ path: result.profileDir, scope: 'profile', label: '当前 Profile' }] : []
    warnings.push(...(result.warnings || []))
  }

  const saved = readCategories()
  const usage = await collectUsage(ctx, { cwd: options.cwd })
  if (usage.errors && usage.errors.length) warnings.push(...usage.errors.slice(0, 3))

  const verdicts = classifyAll(rows, { profileDir: profileDir(), usage })
  for (const row of rows) {
    // `classifyAll` returns a Map keyed by row.key — indexing it like an object
    // silently yields undefined for every row.
    const verdict = verdicts.get(row.key)
    const code = row.kind === 'skill' ? null : codeEvidence(row.name, profileDir())
    const used = lastUsedFor(
      { name: row.name, short: row.name, toolNames: code ? code.toolNames : [] },
      usage,
    )
    row.family = verdict.family
    row.domain = verdict.domain
    row.familyLabel = verdict.familyLabel
    row.domainLabel = verdict.domainLabel
    row.confidence = verdict.confidence
    row.evidence = verdict.evidence
    row.usedAt = used ? used.time : null
    row.usedText = used && used.time ? relativeAge(used.time) : null
    row.usedVia = used ? used.via : null
    // A name mention only proves the plugin was discussed, not that it ran, so
    // it is surfaced as a hint rather than a timestamp.
    row.mentionedAt = used && used.weak ? used.weak : null
    row.mentionedText = used && used.weak ? relativeAge(used.weak) : null
    // Kept for the AI pass only; not serialised to the client.
    Object.defineProperty(row, '_code', { value: code, enumerable: false, configurable: true })
    const note = saved.notes[row.key]
    if (note && note.what) {
      row.ai = { what: note.what, remove: note.remove || null, why: note.why || null, at: note.at || null }
    }
    const manual = saved.assignments[row.key]
    if (manual && manual.domain) {
      row.domain = manual.domain
      row.family = manual.family || row.family
      row.familyLabel = (FAMILIES.find((f) => f.id === row.family) || {}).label || row.familyLabel
      row.domainLabel = (DOMAINS.find((d) => d.id === row.domain) || {}).label || row.domainLabel
      row.confidence = 'manual'
      row.evidence = ['你手动指定过分类']
    }
  }

  // Rebuild the verdict map from the rows so a manual or AI override moves the
  // leaf in the tree too, instead of only changing the detail pane.
  const finalVerdicts = new Map()
  for (const row of rows) {
    finalVerdicts.set(row.key, {
      family: row.family,
      familyLabel: row.familyLabel,
      domain: row.domain,
      domainLabel: row.domainLabel,
      leaf: row.name,
      leafLabel: row.title || row.name,
      confidence: row.confidence,
      evidence: row.evidence,
    })
  }
  const tree = buildTree(rows, finalVerdicts)
  return {
    kind,
    rows,
    tree,
    roots,
    warnings,
    usage: {
      source: usage.source,
      sessions: usage.sessions,
      files: usage.files,
      newest: usage.newest,
    },
    catalog: { families: FAMILIES, domains: DOMAINS },
    saved: { count: Object.keys(saved.assignments).length, notes: Object.keys(saved.notes).length },
  }
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

/**
 * `output.render` must return a ContentBlock[] — NOT a full tool-result shape
 * ({ content: [...] }). Wrapping it makes the host reject every call with
 * INVALID_TOOL_OUTPUT ("output.render returned ... it must return an ARRAY of
 * content blocks"), which is why every studio_* tool failed in the UI.
 */
function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

function registerTools(toolsCtx, ctx) {
  const tools = serviceOf(toolsCtx, 'tools')
  if (!tools || typeof tools.register !== 'function') return

  const list = {
    name: 'studio_list',
    description: 'List installed plugins or skills with their automatic three-level classification, last-used time, and whether they can be removed.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['plugin', 'skill'], description: 'Which inventory to read. Default plugin.' },
        filter: { type: 'string', description: 'Optional case-insensitive substring to keep only matching rows.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => text(value) },
    async execute(args) {
      const view = await analyse(ctx, { kind: args && args.kind })
      const filter = args && args.filter ? String(args.filter).toLowerCase() : null
      const rows = filter
        ? view.rows.filter((row) => `${row.name} ${row.title || ''} ${row.description || ''}`.toLowerCase().includes(filter))
        : view.rows
      return {
        kind: view.kind,
        count: rows.length,
        rows: rows.map((row) => ({
          key: row.key,
          name: row.name,
          title: row.title,
          family: row.familyLabel,
          domain: row.domainLabel,
          enabled: row.enabled,
          removable: row.removable,
          lastUsed: row.usedText || 'no record',
          what: row.ai ? row.ai.what : null,
        })),
      }
    },
  }

  const explain = {
    name: 'studio_explain',
    description: 'Explain in plain language what a plugin or skill does, using its code, its description, and a GitHub lookup, so the user can decide whether to remove it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['plugin', 'skill'], description: 'Which inventory the key belongs to.' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Row keys from studio_list. Omit to explain the least-documented rows.' },
        limit: { type: 'number', description: 'How many rows to explain, 1-24. Default 8.' },
        online: { type: 'boolean', description: 'Allow a GitHub lookup for rows with no local description. Default true.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => text(value) },
    async execute(args) {
      const view = await analyse(ctx, { kind: args && args.kind })
      const limit = Math.max(1, Math.min(24, Number(args && args.limit) || 8))
      const wanted = Array.isArray(args && args.keys) ? new Set(args.keys) : null
      let rows = wanted ? view.rows.filter((row) => wanted.has(row.key)) : view.rows
      if (!wanted) rows = rows.filter((row) => !row.ai).slice(0, limit)
      const entries = await buildAiEntries(ctx, rows, { online: !(args && args.online === false) })
      const result = await aiAnalyse(ctx, entries, {
        locale: 'zh',
        categories: DOMAINS,
      })
      const byKey = new Map(result.verdicts.map((verdict) => [verdict.key, verdict]))
      const merged = {}
      const saved = readCategories()
      for (const [key, verdict] of byKey) {
        saved.notes[key] = { what: verdict.what, remove: verdict.remove, why: verdict.why, at: Date.now() }
      }
      writeCategories(saved)
      for (const row of rows) {
        const verdict = byKey.get(row.key)
        merged[row.key] = verdict ? { what: verdict.what, remove: verdict.remove, why: verdict.why } : { what: null, remove: null, why: null }
      }
      return { stats: result.stats, explanations: merged }
    },
  }

  const removeTool = {
    name: 'studio_remove',
    description: 'Remove plugins or skills by key. Refuses built-in and unremovable entries, and reports whether the client must be restarted.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['plugin', 'skill'], description: 'Which inventory the keys belong to.' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Row keys to remove.' },
        dryRun: { type: 'boolean', description: 'Only report what would happen. Default false.' },
      },
      required: ['keys'],
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => text(value) },
    async execute(args) {
      const view = await analyse(ctx, { kind: args && args.kind })
      const keys = new Set(Array.isArray(args && args.keys) ? args.keys : [])
      const rows = view.rows.filter((row) => keys.has(row.key))
      if (rows.length === 0) return { ok: false, error: '没有匹配的行' }
      if (view.kind === 'skill') {
        const result = await removeSkills(rows, { dryRun: !!(args && args.dryRun) })
        return result
      }
      const result = await removeMany(ctx, rows, { dryRun: !!(args && args.dryRun) })
      return result
    },
  }

  for (const tool of [list, explain, removeTool]) {
    try {
      toolsCtx.effect(() => tools.register(tool), `dsh-plugin-studio: ${tool.name}`)
    } catch {
      // a tools service that refuses one definition should not break the page
    }
  }
}

/* ------------------------------------------------------------------ */
/* AI entry assembly                                                   */
/* ------------------------------------------------------------------ */

async function buildAiEntries(ctx, rows, options = {}) {
  const online = options.online !== false
  const wanted = rows.filter((row) => needsRemote(row)).map((row) => row.name)
  let evidence = {}
  let remoteStats = null
  if (online && wanted.length > 0) {
    const result = await enrichRemote(wanted, {})
    evidence = result.evidence
    remoteStats = result.stats
  }
  const entries = []
  for (const row of rows) {
    const code = row._code || null
    const remote = evidence[row.name]
    entries.push({
      key: row.key,
      name: row.name,
      title: row.title || row.name,
      description: row.description || null,
      kind: row.kind,
      official: !!row.official,
      removable: !!row.removable,
      halves: code ? code.halves : (row.kind === 'skill' ? ['skill'] : []),
      slots: code ? code.slots : [],
      touches: code ? code.touches : [],
      toolNames: code ? code.toolNames : [],
      readmeHead: code && code.readme ? code.readme : (row.readme || null),
      ruleVerdict: {
        familyLabel: row.familyLabel,
        domainLabel: row.domainLabel,
        evidence: row.evidence || [],
      },
      remote: remote && remote.found ? { summary: remote.summary, source: `github.com/${remote.repo}` } : null,
      usage: row.usedAt ? { text: row.usedText } : null,
      catalog: { families: FAMILIES, domains: DOMAINS },
    })
  }
  entries.remoteStats = remoteStats
  return entries
}

/* ------------------------------------------------------------------ */
/* pack / apply                                                        */
/* ------------------------------------------------------------------ */

function normaliseEntry(row) {
  return {
    key: row.key,
    kind: row.kind,
    name: row.name,
    title: row.title || null,
    version: row.version || null,
    spec: row.spec || null,
    category: { family: row.family, domain: row.domain, familyLabel: row.familyLabel, domainLabel: row.domainLabel },
    enabled: !!row.enabled,
    official: !!row.official,
    description: row.description || null,
    what: row.ai ? row.ai.what : null,
  }
}

function buildPack(meta, rows) {
  const now = new Date().toISOString()
  return {
    format: 'dsh-plugin-studio-pack',
    formatVersion: 1,
    meta: {
      name: meta && meta.name ? String(meta.name) : '未命名整合包',
      description: meta && meta.description ? String(meta.description) : '',
      createdAt: now,
      plugin: PLUGIN_ID,
      pluginVersion: PLUGIN_VERSION,
      kind: rows.length > 0 ? rows[0].kind : 'plugin',
      count: rows.length,
    },
    entries: rows.map(normaliseEntry),
  }
}

async function planApply(ctx, doc, options = {}) {
  const warnings = []
  const entries = doc && Array.isArray(doc.entries) ? doc.entries : []
  if (doc && doc.format !== 'dsh-plugin-studio-pack') {
    warnings.push('这个文件的格式不是插件工坊导出的整合包，仍然尝试解析。')
  }
  if (doc && doc.formatVersion && doc.formatVersion > 1) {
    warnings.push(`整合包版本 ${doc.formatVersion} 比当前插件新，部分内容可能被忽略。`)
  }
  const pm = serviceOf(ctx, 'pluginManager')
  if (!pm || typeof pm.listBundles !== 'function') {
    return { ok: false, error: '这个客户端版本不支持安装插件', warnings }
  }
  const current = await inventory(ctx)
  const installed = new Map(current.rows.map((row) => [row.name, row]))
  const actions = []
  for (const entry of entries) {
    if (!entry || !entry.name) continue
    if (entry.kind === 'skill') {
      actions.push({ name: entry.name, action: 'skip', reason: '技能需要手动放入技能目录，整合包只做记录' })
      continue
    }
    const existing = installed.get(entry.name)
    if (existing && existing.enabled) {
      actions.push({ name: entry.name, action: 'keep', reason: '已经装好并启用' })
      continue
    }
    if (existing && !existing.enabled) {
      actions.push({ name: entry.name, action: 'enable', spec: entry.spec, reason: '已安装但被关闭' })
      continue
    }
    if (!entry.spec) {
      actions.push({ name: entry.name, action: 'skip', reason: '没有记录可安装的版本' })
      continue
    }
    actions.push({ name: entry.name, action: 'install', spec: entry.spec, reason: '未安装' })
  }
  const summary = {
    install: actions.filter((action) => action.action === 'install').length,
    enable: actions.filter((action) => action.action === 'enable').length,
    keep: actions.filter((action) => action.action === 'keep').length,
    skip: actions.filter((action) => action.action === 'skip').length,
  }
  return { ok: true, actions, summary, warnings, meta: doc && doc.meta ? doc.meta : null }
}

async function applyPlan(ctx, actions, options = {}) {
  const pm = serviceOf(ctx, 'pluginManager')
  const results = []
  const warnings = []
  for (const action of actions || []) {
    if (!action || action.action === 'skip' || action.action === 'keep') continue
    if (options.dryRun) {
      results.push({ ...action, ok: true, dryRun: true })
      continue
    }
    try {
      if (action.action === 'enable') {
        if (typeof pm.setBundleEnabled === 'function') {
          const result = await pm.setBundleEnabled(action.name, true)
          const restart = restartNotice(result)
          if (restart) warnings.push(`${action.name}：${restart.text}`)
          results.push({ ...action, ok: true, application: result ? result.application : 'unknown' })
        } else {
          results.push({ ...action, ok: false, error: '这个客户端版本不支持启用插件' })
        }
        continue
      }
      if (typeof pm.installBundle !== 'function') {
        results.push({ ...action, ok: false, error: '这个客户端版本不支持安装插件' })
        continue
      }
      const result = await pm.installBundle(action.spec)
      const ok = !!result && (result.application === 'applied' || result.application === 'restart-required' || result.application === 'overridden')
      const restart = restartNotice(result)
      if (restart) warnings.push(`${action.name}：${restart.text}`)
      results.push({
        ...action,
        ok,
        application: result ? result.application : 'failed',
        error: ok ? null : (result && result.error ? errorText(result.error) : '安装没有说明原因'),
      })
    } catch (err) {
      results.push({ ...action, ok: false, error: errorText(err) })
    }
  }
  return {
    results,
    installed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    warnings,
  }
}

/* ------------------------------------------------------------------ */
/* route handler                                                       */
/* ------------------------------------------------------------------ */

function authorize(ctx, req) {
  const connection = serviceOf(ctx, 'connection')
  if (!connection || typeof connection.admit !== 'function') return { ok: true, mode: 'legacy' }
  try {
    const admission = connection.admit(req)
    if (admission && admission.ok === false) {
      return { ok: false, status: admission.status || 403, error: (admission.reason && admission.reason.message) || '拒绝访问' }
    }
    return { ok: true, mode: 'admit' }
  } catch (err) {
    return { ok: false, status: 401, error: errorText(err) }
  }
}

function makeHandler(ctx) {
  return async function handler(req, res) {
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad url' })
      return
    }
    const path = url.pathname.replace(/\/+$/, '') || API_PREFIX
    const tail = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) || '/' : path
    const query = url.searchParams

    const auth = authorize(ctx, req)
    if (!auth.ok) {
      sendJson(res, auth.status || 403, { ok: false, error: auth.error })
      return
    }

    let body = null
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const raw = await readBody(req, BODY_LIMIT)
        body = raw && raw.length > 0 ? JSON.parse(raw) : {}
      } catch (err) {
        sendJson(res, 400, { ok: false, error: `请求内容解析失败：${errorText(err)}` })
        return
      }
    }

    try {
      if (tail === '/' || tail === '') {
        sendJson(res, 200, {
          ok: true,
          plugin: PLUGIN_ID,
          version: PLUGIN_VERSION,
          apiVersion: API_VERSION,
          endpoints: [
            'GET /inventory', 'GET /skills', 'GET /saved', 'GET /diag',
            'POST /pack', 'POST /save', 'POST /delete-pack',
            'POST /categories/save', 'POST /categories/reset',
            'POST /suggest', 'POST /explain', 'POST /remove',
            'POST /skills/remove', 'POST /skills/enable', 'POST /skills/pack',
            'POST /plan', 'POST /apply',
          ],
        })
        return
      }

      if (tail === '/diag') {
        const report = capabilityReport(ctx)
        sendJson(res, 200, {
          ok: true,
          plugin: PLUGIN_ID,
          version: PLUGIN_VERSION,
          apiVersion: API_VERSION,
          profileDir: profileDir(),
          storageDir: storageDir(),
          remoteCache: remoteCacheExists(),
          skillRoots: skillRoots(process.cwd()),
          model: resolveCallTarget(ctx),
          ...report,
        })
        return
      }

      if (tail === '/inventory') {
        const view = await analyse(ctx, { kind: 'plugin', cwd: query.get('cwd') || undefined })
        sendJson(res, 200, { ok: true, apiVersion: API_VERSION, ...view })
        return
      }

      if (tail === '/skills') {
        const view = await analyse(ctx, { kind: 'skill', cwd: query.get('cwd') || undefined })
        sendJson(res, 200, { ok: true, apiVersion: API_VERSION, ...view })
        return
      }

      if (tail === '/saved') {
        sendJson(res, 200, { ok: true, saved: listSaved() })
        return
      }

      if (tail === '/categories/save' && body) {
        const saved = readCategories()
        const assignments = body.assignments && typeof body.assignments === 'object' ? body.assignments : null
        if (assignments) {
          for (const [key, value] of Object.entries(assignments)) {
            if (!value || typeof value !== 'object') continue
            const domain = typeof value.domain === 'string' ? value.domain : null
            if (!domain) continue
            const known = DOMAINS.find((item) => item.id === domain)
            if (!known) continue
            saved.assignments[key] = { domain, family: known.family, at: Date.now() }
          }
        }
        if (body.forget && Array.isArray(body.forget)) {
          for (const key of body.forget) delete saved.assignments[key]
        }
        writeCategories(saved)
        sendJson(res, 200, { ok: true, count: Object.keys(saved.assignments).length })
        return
      }

      if (tail === '/categories/reset' && body) {
        const saved = readCategories()
        if (body.all) {
          saved.assignments = {}
          saved.notes = {}
        } else if (Array.isArray(body.keys)) {
          for (const key of body.keys) {
            delete saved.assignments[key]
            delete saved.notes[key]
          }
        }
        writeCategories(saved)
        sendJson(res, 200, { ok: true })
        return
      }

      if (tail === '/suggest' && body) {
        const kind = body.kind === 'skill' ? 'skill' : 'plugin'
        const view = await analyse(ctx, { kind, cwd: body.cwd })
        const keys = Array.isArray(body.keys) ? new Set(body.keys) : null
        let rows = keys ? view.rows.filter((row) => keys.has(row.key)) : view.rows
        if (body.onlyUnused) {
          rows = rows.filter((row) => !row.usedAt)
        }
        const limit = Math.max(1, Math.min(60, Number(body.limit) || 40))
        rows = rows.slice(0, limit)
        const entries = await buildAiEntries(ctx, rows, { online: body.online !== false })
        const result = await aiAnalyse(ctx, entries, { locale: body.locale || 'zh', categories: DOMAINS })
        const saved = readCategories()
        for (const verdict of result.verdicts) {
          const domain = DOMAINS.find((item) => item.id === verdict.category)
          if (!domain) continue
          saved.assignments[verdict.key] = { domain: verdict.category, family: domain.family, at: Date.now(), by: 'ai' }
          saved.notes[verdict.key] = { what: verdict.what, remove: verdict.remove, why: verdict.why, at: Date.now() }
        }
        writeCategories(saved)
        sendJson(res, 200, { ok: true, stats: result.stats, applied: result.verdicts.length })
        return
      }

      if (tail === '/explain' && body) {
        const kind = body.kind === 'skill' ? 'skill' : 'plugin'
        const view = await analyse(ctx, { kind, cwd: body.cwd })
        // A malformed `keys` used to mean "no filter", which silently explained
        // the whole backlog. Treat anything that is not an array as an error.
        if (body.keys !== undefined && body.keys !== null && !Array.isArray(body.keys)) {
          sendJson(res, 400, { ok: false, error: 'keys 必须是数组' })
          return
        }
        const keys = Array.isArray(body.keys) ? new Set(body.keys) : null
        let rows = keys ? view.rows.filter((row) => keys.has(row.key)) : view.rows.filter((row) => !row.ai)
        const limit = Math.max(1, Math.min(24, Number(body.limit) || 8))
        rows = rows.slice(0, limit)
        const entries = await buildAiEntries(ctx, rows, { online: body.online !== false })
        const result = await aiAnalyse(ctx, entries, { locale: body.locale || 'zh', categories: DOMAINS })
        const saved = readCategories()
        for (const verdict of result.verdicts) {
          saved.notes[verdict.key] = { what: verdict.what, remove: verdict.remove, why: verdict.why, at: Date.now() }
        }
        writeCategories(saved)
        sendJson(res, 200, { ok: true, stats: result.stats, notes: result.verdicts })
        return
      }

      if (tail === '/remove' && body) {
        const view = await analyse(ctx, { kind: 'plugin', cwd: body.cwd })
        const keys = new Set(Array.isArray(body.keys) ? body.keys : [])
        const rows = view.rows.filter((row) => keys.has(row.key))
        if (rows.length === 0) {
          sendJson(res, 200, { ok: false, error: '没有选中任何可以删除的插件' })
          return
        }
        const result = await removeMany(ctx, rows, { dryRun: !!body.dryRun })
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (tail === '/skills/remove' && body) {
        const view = await analyse(ctx, { kind: 'skill', cwd: body.cwd })
        const keys = new Set(Array.isArray(body.keys) ? body.keys : [])
        const rows = view.rows.filter((row) => keys.has(row.key))
        if (rows.length === 0) {
          sendJson(res, 200, { ok: false, error: '没有选中任何可以删除的技能' })
          return
        }
        const result = await removeSkills(rows, { dryRun: !!body.dryRun })
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (tail === '/skills/enable' && body) {
        const view = await analyse(ctx, { kind: 'skill', cwd: body.cwd })
        const keys = new Set(Array.isArray(body.keys) ? body.keys : [])
        const rows = view.rows.filter((row) => keys.has(row.key))
        const enabled = body.enabled !== false
        const results = []
        for (const row of rows) {
          results.push(await setSkillEnabled(row, enabled))
        }
        sendJson(res, 200, { ok: true, results })
        return
      }

      if (tail === '/skills/pack' && body) {
        const view = await analyse(ctx, { kind: 'skill', cwd: body.cwd })
        const keys = Array.isArray(body.keys) ? new Set(body.keys) : null
        const rows = keys ? view.rows.filter((row) => keys.has(row.key)) : view.rows
        const result = await packSkills(rows, { name: body.name || '技能整合包' })
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (tail === '/pack' && body) {
        const kind = body.kind === 'skill' ? 'skill' : 'plugin'
        const view = await analyse(ctx, { kind, cwd: body.cwd })
        const keys = new Set(Array.isArray(body.keys) ? body.keys : [])
        const rows = view.rows.filter((row) => keys.has(row.key))
        if (rows.length === 0) {
          sendJson(res, 200, { ok: false, error: '没有选中任何条目' })
          return
        }
        const doc = buildPack(body.meta, rows)
        sendJson(res, 200, { ok: true, pack: doc, notPortable: rows.filter((row) => row.local).map((row) => row.name) })
        return
      }

      if (tail === '/save' && body) {
        const doc = body.pack
        if (!doc || !Array.isArray(doc.entries)) {
          sendJson(res, 400, { ok: false, error: '整合包内容不完整' })
          return
        }
        ensureStorage()
        const name = sanitizeFileName((doc.meta && doc.meta.name) || '整合包')
        const file = `${name}${SUFFIX}`
        writeFileSync(join(storageDir(), file), JSON.stringify(doc, null, 2), 'utf8')
        sendJson(res, 200, { ok: true, file })
        return
      }

      if (tail === '/delete-pack' && body) {
        const file = typeof body.file === 'string' ? body.file : ''
        if (!file || !file.endsWith(SUFFIX) || /[/\\]|\.\./.test(file)) {
          sendJson(res, 400, { ok: false, error: '文件名不合法' })
          return
        }
        const full = join(storageDir(), file)
        if (!existsSync(full)) {
          sendJson(res, 404, { ok: false, error: '找不到这个整合包' })
          return
        }
        rmSync(full, { force: true })
        sendJson(res, 200, { ok: true })
        return
      }

      if (tail === '/plan' && body) {
        const plan = await planApply(ctx, body.pack, {})
        sendJson(res, 200, plan)
        return
      }

      if (tail === '/apply' && body) {
        const plan = await planApply(ctx, body.pack, {})
        if (!plan.ok) {
          sendJson(res, 200, plan)
          return
        }
        const result = await applyPlan(ctx, plan.actions, { dryRun: !!body.dryRun })
        sendJson(res, 200, { ok: true, plan: { summary: plan.summary, actions: plan.actions }, ...result })
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      sendJson(res, 500, { ok: false, error: errorText(err) })
    }
  }
}

/* ------------------------------------------------------------------ */
/* plugin entry                                                        */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
  try {
    const profileContext = serviceOf(ctx, 'profileContext')
    if (profileContext && typeof profileContext.dir === 'string' && profileContext.dir) {
      setProfileDir(profileContext.dir)
    }
  } catch {
    // fall back to the environment variable
  }

  whenService(ctx, 'webServer', (webServer, webCtx) => {
    if (!webServer || typeof webServer.register !== 'function') return
    webCtx.effect(() => webServer.register({ kind: 'prefix', path: API_PREFIX, handler: makeHandler(ctx) }), 'dsh-plugin-studio: routes')
  })

  whenService(ctx, 'tools', (_tools, toolsCtx) => {
    registerTools(toolsCtx, ctx)
  })

  try {
    ensureStorage()
    const marker = join(storageDir(), 'plugin.json')
    if (!existsSync(marker)) {
      writeFileSync(marker, JSON.stringify({ plugin: PLUGIN_ID, version: PLUGIN_VERSION, apiVersion: API_VERSION, installedAt: new Date().toISOString() }, null, 2), 'utf8')
    }
  } catch {
    // storage marker is informational only
  }
}

export const name = PLUGIN_ID
export { PLUGIN_VERSION, API_VERSION, analyse, makeHandler, readCategories, writeCategories }
export default apply
