/**
 * Last-used tracking.
 *
 * "Which of these can I delete?" is usually answered by "which of these have I
 * not touched in months", and nothing in the Harness UI answers that. The
 * evidence exists, but it is spread across session logs.
 *
 * Two sources, in order of directness:
 *
 *  1. `sessionQuery` — the Host service that already reads session logs. Ask it
 *     for the recent sessions, read each one, and fold `tool/call` events into
 *     a `tool name -> last time` map. This is the sanctioned path and needs no
 *     knowledge of the on-disk format.
 *  2. The session directory itself — when `sessionQuery` is absent (older
 *     build), the `.jsonl.zstd` files under `<DSH_HOME>/sessions` are read
 *     directly. Those files are a concatenation of zstd frames, not one frame,
 *     so they are decoded frame by frame from the magic number.
 *
 * A plugin's "last used" is the newest of: any tool it registers, any slot it
 * draws into being shown, and — the weakest but most universal signal — the
 * newest session that mentions its package name in a message.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome, serviceOf, errorText, profileDir } from './env.js'
import { packageDir } from './classify.js'
import { foldToolRegistry } from './attribution.js'

/**
 * `zstdDecompressSync` is a static import in most places, but it only exists
 * from Node 22.15. A named ESM import of a missing export is a *link-time*
 * SyntaxError, so on Node 20 it took down every suite — including the ones that
 * never touch session logs. Import it lazily so an older Node simply reports
 * "cannot read zstd logs" instead of failing to load the plugin at all.
 */
let zstdDecompressSync
try {
  ({ zstdDecompressSync } = await import('node:zlib'))
} catch {
  zstdDecompressSync = null
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const MAX_SESSIONS = 60
const MAX_FILE_BYTES = 24 * 1024 * 1024
const MAX_EVENTS_PER_SESSION = 40000

/* ------------------------------------------------------------------ */
/* zstd frame splitting                                                */
/* ------------------------------------------------------------------ */

/**
 * Split a concatenated-zstd buffer into decompressed chunks.
 *
 * `zstdDecompressSync(wholeFile)` returns only the FIRST frame — it does not
 * keep going — so a 650-frame session log looks like a 200-byte file. Walking
 * the magic numbers and decompressing each frame is what makes the fallback
 * path actually see the conversation.
 */
export function decompressFrames(buffer) {
  const offsets = []
  let index = buffer.indexOf(ZSTD_MAGIC, 0)
  while (index >= 0) {
    offsets.push(index)
    index = buffer.indexOf(ZSTD_MAGIC, index + 4)
  }
  if (offsets.length === 0) return null
  if (typeof zstdDecompressSync !== 'function') return null
  const chunks = []
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length
    try {
      chunks.push(zstdDecompressSync(buffer.subarray(start, end)))
    } catch {
      // A truncated tail frame is normal while a session is live.
    }
  }
  if (chunks.length === 0) return null
  return Buffer.concat(chunks).toString('utf8')
}

function parseLines(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '{') continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // A partially written last line is expected.
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* on-disk fallback                                                    */
/* ------------------------------------------------------------------ */

export function sessionRoots() {
  const home = dshHome()
  const roots = [join(home, 'sessions')]
  return roots.filter((path) => existsSync(path))
}

/**
 * Session logs live at `<sessions>/<workspace-slug>/<session-id>/session.v4.jsonl.zstd`.
 *
 * The depth is not fixed by contract — a build may write `<slug>/<id>.jsonl`
 * directly — so this walks a bounded number of levels instead of hard-coding
 * two, and stops as soon as it has enough files.
 */
export function listSessionFiles() {
  const files = []
  const MAX_DEPTH = 4

  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.jsonl(\.zstd)?$/.test(entry.name)) continue
      let stat
      try {
        stat = statSync(path)
      } catch {
        continue
      }
      files.push({ path, size: stat.size, mtime: stat.mtimeMs, session: dir })
    }
  }

  for (const root of sessionRoots()) walk(root, 0)
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_SESSIONS)
}

/**
 * Fold one session file into the running usage maps.
 *
 * `tool/call` events carry `data.name`, which is the exact Tool name the model
 * invoked. That is the strongest signal available: it proves the code behind
 * that tool actually ran, rather than merely being loaded.
 */
function foldEvents(events, usage) {
  let tools = 0
  for (const event of events) {
    const time = typeof event.time === 'number' ? event.time : null
    if (!time) continue
    if (event.type === 'tool/call' && event.data && typeof event.data.name === 'string') {
      const name = event.data.name
      const prev = usage.tools.get(name)
      if (!prev || prev < time) usage.tools.set(name, time)
      noteSkillCall(event, time, usage)
      tools += 1
    } else if (event.type === 'model/selection' || event.type === 'request/context' || event.type === 'llm/retry') {
      noteProvider(event, time, usage)
    } else if (event.type === 'user/message' || event.type === 'assistant/message') {
      // Message text is the fallback signal for a package that registers no
      // tools of its own but is still talked about by name.
      const flat = JSON.stringify(event.data || '')
      if (flat.length < 20000) {
        for (const token of packageTokens(flat)) {
          const prev = usage.mentions.get(token)
          if (!prev || prev < time) usage.mentions.set(token, time)
        }
      }
      if (event.type === 'user/message') noteCommand(event, time, usage)
    }
    if (usage.newest === null || time > usage.newest) usage.newest = time
  }
  return tools
}

export function foldSessionFile(file, usage) {
  if (file.size > MAX_FILE_BYTES) return { skipped: true, reason: 'too-large' }
  let buffer
  try {
    buffer = readFileSync(file.path)
  } catch (err) {
    return { skipped: true, reason: errorText(err) }
  }
  let text = null
  if (file.path.endsWith('.zstd')) {
    text = decompressFrames(buffer)
    if (text === null) return { skipped: true, reason: 'zstd' }
  } else {
    text = buffer.toString('utf8')
  }
  const events = parseLines(text).slice(-MAX_EVENTS_PER_SESSION)
  foldToolRegistry(events, usage.registry)
  return { events: events.length, tools: foldEvents(events, usage) }
}

/**
 * Record which skill a `skill` call asked for.
 *
 * The `skill` tool is a dispatcher: `{ name: "animate" }` is the whole of its
 * arguments, and the tool name alone would credit every installed skill at
 * once. Session logs store the arguments as a JSON string, so a parse failure
 * has to be survivable — a malformed call is not worth losing the session over.
 */
function noteSkillCall(event, time, usage) {
  if (!event.data || event.data.name !== 'skill') return
  let args = event.data.arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return
    }
  }
  if (!args || typeof args !== 'object') return
  const name = typeof args.name === 'string' ? args.name : null
  if (!name) return
  const key = name.trim().toLowerCase()
  if (!key) return
  const prev = usage.skillCalls.get(key)
  if (!prev || prev < time) usage.skillCalls.set(key, time)
}

/**
 * Record the model provider each turn actually talked to.
 *
 * A provider plugin (`dsh-connect-workbuddy` is the one that prompted this)
 * registers no tool at all: it plugs a remote model in as a provider, so the
 * *only* trace of it doing its job is the provider id on the request. Every
 * `tool/call`-based rule misses it completely, and the row says "never used"
 * while the user has been routing every turn through it.
 */
function noteProvider(event, time, usage) {
  const data = event.data
  if (!data || typeof data !== 'object') return
  const id = typeof data.provider === 'string' ? data.provider.trim() : ''
  if (!id) return
  const key = id.toLowerCase()
  const prev = usage.providers.get(key)
  if (!prev || prev < time) usage.providers.set(key, time)
}

/**
 * Record slash commands typed by the user.
 *
 * `/context` and friends are expanded client-side, so most never reach the
 * session log; when one does arrive as text it is exact proof the command's
 * package ran, and costs nothing to keep.
 */
function noteCommand(event, time, usage) {
  const data = event.data
  if (!data || typeof data !== 'object') return
  const content = data.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    text = content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }
  const match = /^\/([a-z][a-z0-9_-]{1,40})/i.exec(text.trim())
  if (!match) return
  const key = match[1].toLowerCase()
  const prev = usage.commands.get(key)
  if (!prev || prev < time) usage.commands.set(key, time)
}

/**
 * Read the per-session projection cache and remember when each projection was
 * last written.
 *
 * A UI plugin such as `dsh-context` registers no tool and no provider: it
 * attaches computed projections (`contextTimeline`, `contextActivity`, …) to
 * every session, and the Host persists them next to the session. The keys of
 * `record.rows` are exactly the projections a package registered, so a cache
 * file mentioning `contextTimeline` is proof that `dsh-context` ran against
 * that session — and the file's mtime dates it.
 */
export function projectionDir() {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions')
}

function scanProjections(usage) {
  const dir = projectionDir()
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  let seen = 0
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    if (seen >= MAX_SESSIONS) break
    const path = join(dir, entry)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue
    seen += 1
    let record
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      record = parsed && parsed.record
    } catch {
      continue
    }
    const rows = record && record.rows
    if (!rows || typeof rows !== 'object') continue
    for (const key of Object.keys(rows)) {
      const prev = usage.projections.get(key)
      if (!prev || prev < stat.mtimeMs) usage.projections.set(key, stat.mtimeMs)
    }
  }
  usage.projectionFiles = seen
}

/** Package-ish tokens worth remembering from a message body. */
function packageTokens(text) {
  const out = new Set()
  const re = /(?:@[a-z0-9-]+\/)?(?:dsh|ds|bili)[a-z0-9-]*[a-z0-9]/gi
  let match
  while ((match = re.exec(text))) {
    const value = match[0].toLowerCase()
    if (value.length >= 4) out.add(value)
  }
  return out
}

/** @internal Exported so `scripts/` probes can fold one session at a time. */
export function emptyUsage() {
  return {
    tools: new Map(),
    mentions: new Map(),
    // Tools the model was offered, with their descriptions. This is the only
    // in-band record of the real registry, and `attribution.js` needs it to
    // work out which package each tool belongs to.
    registry: new Map(),
    // `skill` is one tool that dispatches to every skill by name, so the tool
    // name proves nothing about *which* skill ran. Its arguments do.
    skillCalls: new Map(),
    // Evidence that is not a tool call: a plugin can be the model provider for
    // every turn, own a slash command, or compute a per-session projection,
    // and none of those leave a `tool/call` behind.
    providers: new Map(),
    commands: new Map(),
    projections: new Map(),
    projectionFiles: 0,
    newest: null,
    sessions: 0,
    files: 0,
    errors: [],
  }
}

/**
 * Collect usage evidence from every source we can reach.
 *
 * The `sessionQuery` service is asked first because it is the Host's own view
 * of the session log, but its snapshot is *not* the same thing as the log on
 * disk: it only carries the tail of a session, so tool calls made earlier in a
 * long session are simply absent. Trusting it alone made `media_read_*`,
 * `dsh_browser_*` and `gitbash_native` disappear from the report. Both sources
 * are therefore folded together — the maps keep the newest time per key, so a
 * second pass can only add evidence, never contradict it.
 */
export async function collectUsage(ctx, options = {}) {
  const usage = emptyUsage()
  const sessionQuery = serviceOf(ctx, 'sessionQuery')
  const limit = Math.min(options.limit || MAX_SESSIONS, MAX_SESSIONS)
  let serviceSessions = 0

  if (sessionQuery && typeof sessionQuery.listSessions === 'function' && typeof sessionQuery.readSession === 'function') {
    try {
      const records = await sessionQuery.listSessions()
      const list = (Array.isArray(records) ? records : []).slice(0, limit)
      for (const record of list) {
        const id = record && record.header && record.header.id ? record.header.id : record && record.id
        if (!id) continue
        let snapshot
        try {
          snapshot = await sessionQuery.readSession(id)
        } catch (err) {
          usage.errors.push(`readSession(${id}): ${errorText(err)}`)
          continue
        }
        const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
        serviceSessions += 1
        foldToolRegistry(events, usage.registry)
        foldEvents(events, usage)
      }
      if (serviceSessions === 0) usage.errors.push('sessionQuery 返回空列表，改用磁盘扫描')
    } catch (err) {
      usage.errors.push(`sessionQuery: ${errorText(err)}`)
    }
  }

  let fileSessions = 0
  for (const file of listSessionFiles()) {
    const result = foldSessionFile(file, usage)
    if (!result.skipped) {
      usage.files += 1
      fileSessions += 1
    } else if (result.reason && result.reason !== 'too-large') {
      usage.errors.push(`${file.path}: ${result.reason}`)
    }
  }

  // The two sources describe the same sessions; counting them twice would make
  // the "n sessions" caption lie.
  usage.sessions = Math.max(serviceSessions, fileSessions)
  scanProjections(usage)
  const source = serviceSessions > 0 ? (fileSessions > 0 ? 'sessionQuery+files' : 'sessionQuery') : 'files'
  return { ...summarize(usage), source, errors: usage.errors.slice(0, 8) }
}

function summarize(usage) {
  const tools = {}
  for (const [name, time] of usage.tools) tools[name] = time
  const mentions = {}
  for (const [name, time] of usage.mentions) mentions[name] = time
  const skillCalls = {}
  for (const [name, time] of usage.skillCalls) skillCalls[name] = time
  const providers = {}
  for (const [name, time] of usage.providers) providers[name] = time
  const commands = {}
  for (const [name, time] of usage.commands) commands[name] = time
  const projections = {}
  for (const [name, time] of usage.projections) projections[name] = time
  return {
    tools,
    mentions,
    skillCalls,
    providers,
    commands,
    projections,
    projectionFiles: usage.projectionFiles,
    // Kept as a Map, not flattened: `attribution.js` needs each tool's
    // description, and only `index.js` reads this — nothing serialises it.
    registry: usage.registry,
    newest: usage.newest,
    sessions: usage.sessions,
    files: usage.files,
  }
}

/**
 * Turn the raw maps into a per-row timestamp.
 *
 * Evidence is graded, because the two kinds are not equally good:
 *
 * - a `tool/call` naming a Tool this package registers is *proof* the plugin
 *   ran, so it counts as real use;
 * - a package name appearing in message text only proves somebody *talked
 *   about* it — an agent explaining what a plugin does, or a user asking to
 *   remove one, produces the same signal as actually using it. Treating that
 *   as "last used just now" would make every row look freshly used and defeat
 *   the whole point of the column, so it is returned separately as `weak`.
 *
 * The caller decides how to present the weak signal; it must never be mixed
 * into the "last used" timestamp.
 */
export function lastUsedFor(facts, usage) {
  let best = null
  let via = null
  for (const tool of facts.toolNames || []) {
    const time = usage.tools[tool]
    if (time && (best === null || time > best)) {
      best = time
      via = `tool:${tool}`
    }
  }
  // A skill is reached through the one `skill` tool, so its own name is the
  // key: `{ name: "animate" }` is proof that skill ran, and no other skill's
  // timestamp leaks into it.
  if (facts.skillCalls) {
    const key = String(facts.name || '').trim().toLowerCase()
    const time = key ? facts.skillCalls[key] : null
    if (time && (best === null || time > best)) {
      best = time
      via = 'skill'
    }
  }
  // Evidence that is not a tool call at all: this package was the model
  // provider for a turn, owned a slash command, or computed a session
  // projection. `index.js` resolves each of those to a row and passes them in.
  for (const item of facts.extra || []) {
    if (!item || !item.time) continue
    if (best === null || item.time > best) {
      best = item.time
      via = item.via
    }
  }
  if (best !== null) return { time: best, via, strong: true }

  let weak = null
  const keys = [facts.name, facts.short].filter(Boolean).map((v) => String(v).toLowerCase())
  for (const key of keys) {
    const time = usage.mentions[key]
    if (time && (weak === null || time > weak)) weak = time
  }
  return { time: null, via: weak ? 'mention' : null, strong: false, weak }
}

/** Tool names a package declares, read from its code. */
export function toolNamesOf(name, dir = profileDir()) {
  const root = packageDir(name, dir)
  if (!root) return []
  const out = new Set()
  for (const file of ['index.js', 'lib/index.js', 'tools.js']) {
    const path = join(root, ...file.split('/'))
    if (!existsSync(path)) continue
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const re = /name\s*:\s*['"`]([a-z][a-z0-9_]{2,40})['"`][\s\S]{0,200}?description\s*:/g
    let match
    while ((match = re.exec(text))) out.add(match[1])
    const re2 = /tools\s*\.\s*register\s*\(\s*\{\s*name\s*:\s*['"`]([a-z][a-z0-9_]{2,40})['"`]/g
    while ((match = re2.exec(text))) out.add(match[1])
  }
  return [...out].slice(0, 24)
}

export function relativeAge(time, now = Date.now()) {
  if (!time) return null
  const delta = Math.max(0, now - time)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 30 * day) return `${Math.floor(delta / day)} 天前`
  if (delta < 365 * day) return `${Math.floor(delta / (30 * day))} 个月前`
  return `${Math.floor(delta / (365 * day))} 年前`
}
