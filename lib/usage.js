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
import { zstdDecompressSync } from 'node:zlib'
import { dshHome, serviceOf, errorText, profileDir } from './env.js'
import { packageDir } from './classify.js'

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
  let tools = 0
  for (const event of events) {
    const time = typeof event.time === 'number' ? event.time : null
    if (!time) continue
    if (event.type === 'tool/call' && event.data && typeof event.data.name === 'string') {
      const name = event.data.name
      const prev = usage.tools.get(name)
      if (!prev || prev < time) usage.tools.set(name, time)
      tools += 1
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
    }
    if (usage.newest === null || time > usage.newest) usage.newest = time
  }
  return { events: events.length, tools }
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

function emptyUsage() {
  return { tools: new Map(), mentions: new Map(), newest: null, sessions: 0, files: 0, errors: [] }
}

/**
 * The Host service path: ask `sessionQuery` for the sessions and read them.
 * Falls back to the disk walk whenever the service is absent or returns
 * nothing usable, because an empty "last used" column is worse than a slow
 * one — it looks like every plugin is unused.
 */
export async function collectUsage(ctx, options = {}) {
  const usage = emptyUsage()
  const sessionQuery = serviceOf(ctx, 'sessionQuery')
  const limit = Math.min(options.limit || MAX_SESSIONS, MAX_SESSIONS)

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
        usage.sessions += 1
        for (const event of events) {
          const time = typeof event.time === 'number' ? event.time : null
          if (!time) continue
          if (event.type === 'tool/call' && event.data && typeof event.data.name === 'string') {
            const name = event.data.name
            const prev = usage.tools.get(name)
            if (!prev || prev < time) usage.tools.set(name, time)
          } else if (event.type === 'user/message' || event.type === 'assistant/message') {
            const flat = JSON.stringify(event.data || '')
            if (flat.length < 20000) {
              for (const token of packageTokens(flat)) {
                const prev = usage.mentions.get(token)
                if (!prev || prev < time) usage.mentions.set(token, time)
              }
            }
          }
          if (usage.newest === null || time > usage.newest) usage.newest = time
        }
      }
      if (usage.sessions > 0) {
        return { ...summarize(usage), source: 'sessionQuery', errors: usage.errors }
      }
      usage.errors.push('sessionQuery 返回空列表，改用磁盘扫描')
    } catch (err) {
      usage.errors.push(`sessionQuery: ${errorText(err)}`)
    }
  }

  for (const file of listSessionFiles()) {
    const result = foldSessionFile(file, usage)
    if (!result.skipped) {
      usage.files += 1
      usage.sessions += 1
    } else if (result.reason && result.reason !== 'too-large') {
      usage.errors.push(`${file.path}: ${result.reason}`)
    }
  }
  return { ...summarize(usage), source: 'files', errors: usage.errors.slice(0, 8) }
}

function summarize(usage) {
  const tools = {}
  for (const [name, time] of usage.tools) tools[name] = time
  const mentions = {}
  for (const [name, time] of usage.mentions) mentions[name] = time
  return { tools, mentions, newest: usage.newest, sessions: usage.sessions, files: usage.files }
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
