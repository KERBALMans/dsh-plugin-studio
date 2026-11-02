/**
 * Which tools does a package actually own?
 *
 * The "last used" column needs a row -> tool-name mapping, and the only honest
 * source is the running Harness. Three facts decided the design:
 *
 *  1. The tool registry is flat. `tools.register()` stores a name and a
 *     definition; it records nothing about which package called it, and
 *     Cordis's `internal/plugin` event carries the fiber but not the module
 *     name. So "ask the runtime which package registered what" is not
 *     available at any level.
 *  2. The registry *is* available, just not in-process on older builds:
 *     every `request/header` event in a session log contains the exact tool
 *     list the model was offered, `{ name, description, parameters }`.
 *  3. The row on the page is a *bundle*, not a package. `@deepseek-ai/dsh-base`
 *     is one row and ninety-six Loader rows; the tools the user actually calls
 *     (`read`, `grep`, `todo_write`) belong to its children such as
 *     `@deepseek-ai/dsh-tool-fs`. Attributing to the bundle name alone finds
 *     nothing, so the join runs tool -> package -> row.
 *
 * The join that works is the tool *description*. A tool's description is
 * authored inside the package that registers it, and the runtime hands it to
 * us verbatim. Looking for a run of that description inside a package's own
 * bytes is specific enough that unrelated packages do not match, and the tool
 * names it recovers are exact — `dsh_browser_*`, `ops_*`, `studio_*`,
 * `media_*`, `gitbash_*` all land on their real owner.
 *
 * Static code scanning alone cannot do this: `dsh-context` mentions `bash`
 * eleven times because it embeds the catalogue it prints, and `dsh-cost-meter`
 * mentions `web_fetch` in a comment. Matching every quoted literal made five
 * packages claim `bash` at once. The description fingerprint is what turns a
 * weak name match into proof, and an equal-strength tie is resolved only when
 * the Harness's own packages are involved — otherwise the tool stays
 * unattributed, which is the safe direction: an unattributed tool makes a row
 * look unused, whereas a wrongly attributed one makes an untouched plugin look
 * freshly used.
 *
 * Two fallbacks cover what fingerprints miss:
 *  - A tool whose description is too short to fingerprint falls back to its own
 *    name, but only when the name is distinctive enough to be unambiguous
 *    (`dsh_browser_list_tabs`, not `bash`).
 *  - MCP tools are named `mcp__<server>__<tool>` after the `serverName` the
 *    declaring bundle put in its `cordis.patch.yml`, so those map even when the
 *    upstream server ships no local source at all.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { extname, join } from 'node:path'
import { packageDir } from './classify.js'
import { packageNameOf, storageDir } from './env.js'

/** Files small enough to be worth reading, and a ceiling per package. */
const FILE_MAX = 8 * 1024 * 1024
const TOTAL_MAX = 16 * 1024 * 1024
const MAX_DEPTH = 3
const SKIP_DIRS = new Set(['node_modules', '.git'])
// Directories whose contents restate other people's tools: a vendored copy of
// the Harness, a doc that quotes an upstream tool definition, a fixture that
// mirrors a real payload. `dsh-ops` ships a doc quoting the built-in `skill`
// tool verbatim, which would otherwise make it look like the skill tool's
// owner and credit the whole plugin every time any skill is loaded.
const SKIP_PATH = /(^|\/)(docs?|fixtures?|__tests__|tests?|examples?|samples?|vendor|third_party)(\/|$)/i
const CODE_EXT_WEIGHT = new Map([
  ['.js', 3],
  ['.mjs', 3],
  ['.cjs', 3],
  ['.ts', 3],
  ['.mts', 3],
  ['.json', 2],
  ['.md', 1],
])
/** Root-level patch files, where a bundle declares the MCP servers it mounts. */
const PATCH_FILES = ['cordis.patch.yml', 'cordis.patch.yaml', 'cordis.yml', 'cordis.yaml']

/**
 * A description run has to be this long before it counts as a fingerprint.
 *
 * Chinese descriptions are far more information-dense than English ones — one
 * character carries what a word does — so the same specificity arrives in a
 * third of the length. Keeping the English floor for CJK text discarded real
 * descriptions that were only ever 20 characters long, and forcing the English
 * floor made sentences that a package had split across concatenated string
 * literals (`'...总开关。' + '默认关闭...'`) too short to match at all.
 */
const NEEDLE_MIN = 40
const NEEDLE_MIN_CJK = 18
const NEEDLE_MAX = 120
const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/
// Sentence ends. The CJK punctuation matters as much as the ASCII: a Chinese
// description is usually one long line with no spaces, so an ASCII-only split
// never cuts it and the whole thing has to match verbatim.
const SENTENCE_SPLIT = /(?<=[.!?;:])\s+|(?<=[。！？；：])/
/** A tool name that no other package would quote by accident. */
const DISTINCT_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+){2,}$/

/**
 * Attributions, memoised on disk.
 *
 * Scanning a profile's worth of package bytes costs seconds, and the answer
 * only changes when a package is installed, removed, or updated. So the cache
 * is kept per tool: the key is a hash of every candidate package's mtime and
 * top-level names (`generation`), and each entry records the tool's current
 * description hash next to the package that owns it. A new tool in the
 * registry therefore costs one tool's scan, not the whole corpus, and a
 * package change invalidates everything at once.
 */
const CACHE_VERSION = 5
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

function cachePath() {
  return join(storageDir(), 'attribution-cache.json')
}

function readCache() {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8'))
    if (raw && raw.version === CACHE_VERSION) return raw
  } catch {
    // no cache yet, or an older shape — both mean "start over"
  }
  return { version: CACHE_VERSION, generation: null, items: {}, servers: [] }
}

function writeCache(cache) {
  try {
    mkdirSync(storageDir(), { recursive: true })
    writeFileSync(cachePath(), JSON.stringify(cache), 'utf8')
  } catch {
    // An unwritable cache costs time, not correctness.
  }
}

/** A cheap token that changes when the package's files change. */
function stampOf(root) {
  let mtime = 0
  const names = []
  try {
    mtime = statSync(root).mtimeMs
    for (const entry of readdirSync(root)) names.push(entry)
  } catch {
    return null
  }
  names.sort()
  return createHash('sha1').update(`${mtime}:${names.join(',')}`).digest('hex')
}

/**
 * Read a package's own bytes.
 *
 * Deliberately not `codeEvidence`'s reader: that one caps at 8 MiB and 40
 * files, which is right for classification but truncates the largest browser
 * bundle before the file holding its tool descriptions. This walks the whole
 * shallow tree and only gives up at the total cap.
 *
 * Files come back ordered by how likely they are to be the definition rather
 * than a restatement of it, so the first hit is also the strongest one.
 */
function readPackageText(root) {
  const parts = []
  let total = 0
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || total >= TOTAL_MAX) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (total >= TOTAL_MAX) return
      if (SKIP_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const weight = CODE_EXT_WEIGHT.get(extname(entry.name))
      if (weight === undefined) continue
      if (SKIP_PATH.test(path.slice(root.length).replace(/\\/g, '/'))) continue
      let size = 0
      try {
        size = statSync(path).size
      } catch {
        continue
      }
      if (size === 0 || size > FILE_MAX) continue
      try {
        parts.push({ text: readFileSync(path, 'utf8'), weight })
        total += size
      } catch {
        // A package with an unreadable file still has the others.
      }
    }
  }
  walk(root, 0)
  parts.sort((a, b) => b.weight - a.weight)
  return parts
}

/** The MCP server names a bundle mounts, read from its root-level patch. */
function readServerNames(root) {
  const names = []
  for (const file of PATCH_FILES) {
    const path = join(root, file)
    let text = ''
    try {
      if (statSync(path).size > 512 * 1024) continue
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/serverName\s*:\s*['"]?([A-Za-z0-9][A-Za-z0-9_.-]*)/g)) {
      if (!names.includes(match[1])) names.push(match[1])
    }
  }
  return names
}

/** Collapse whitespace so a description spanning lines still matches. */
function normalize(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Turn a tool description into searchable fingerprints.
 *
 * Descriptions are authored prose, so the package's copy of them may be
 * wrapped, re-indented, or split across concatenated string literals. Cutting
 * at sentence boundaries and keeping the long clauses produces needles short
 * enough to survive line wrapping and long enough to stay specific.
 */
export function fingerprints(description) {
  const flat = normalize(String(description || ''))
  if (!flat) return []
  const min = CJK_RE.test(flat) ? NEEDLE_MIN_CJK : NEEDLE_MIN
  if (flat.length < min) return []
  const out = []
  for (const chunk of flat.split(SENTENCE_SPLIT)) {
    const piece = chunk.trim()
    if (piece.length >= min) out.push(piece.slice(0, NEEDLE_MAX))
  }
  if (out.length === 0) out.push(flat.slice(0, NEEDLE_MAX))
  return out.slice(0, 4)
}

/**
 * The needles used to find a tool's owner.
 *
 * Description first: it is the thing the owning package authored, so it is both
 * specific and independent of how the tool is named. When the description is
 * too short to fingerprint, fall back to the quoted tool name — but only for
 * names with two separators, because `bash` and `present` appear everywhere
 * while `dsh_browser_list_tabs` does not.
 */
function needlesFor(name, description) {
  return {
    // The description is what the owning package authored, so it is both
    // specific and independent of how the tool happens to be named.
    primary: fingerprints(description),
    // A distinctive name is the fallback for descriptions the package builds
    // at runtime (`dsh_browser_list_tabs` is 75 characters of prose that no
    // file contains verbatim, but the name is right there in the source).
    secondary: DISTINCT_NAME.test(String(name || '')) ? [`'${name}'`, `"${name}"`, `\`${name}\``] : [],
  }
}

function descriptionHash(description) {
  return createHash('sha1').update(String(description || '')).digest('hex').slice(0, 16)
}

/**
 * Read the tool registry out of the session logs' request headers.
 *
 * `collectUsage` already walks these events for `tool/call`; the header carries
 * the whole catalogue in one event, so it costs almost nothing to keep. Only
 * the newest description per name is kept — a tool that changed its blurb
 * mid-session should be matched by what it says now.
 *
 * @param events - Parsed session events, oldest or newest first; order does not matter.
 * @param into - Optional existing map to add to.
 * @returns Map(tool name -> { description, parameters }).
 */
export function foldToolRegistry(events, into = new Map()) {
  for (const event of events) {
    if (!event || event.type !== 'request/header') continue
    const header = event.data && event.data.header
    if (!header || !Array.isArray(header.tools)) continue
    for (const tool of header.tools) {
      if (!tool || typeof tool.name !== 'string') continue
      if (!into.has(tool.name)) {
        into.set(tool.name, {
          description: typeof tool.description === 'string' ? tool.description : '',
          parameters: tool.parameters || null,
        })
      }
    }
  }
  return into
}

/**
 * Does a package ever call a tool-registration API?
 *
 * This is deliberately a plain string test rather than a parse: the answer only
 * separates "this plugin has tools and never ran one" from "this plugin has no
 * tools at all", and being wrong would cost a label, not a timestamp. Packages
 * are keyed by their own mtime so a rebuilt plugin is re-read once.
 */
const TOOL_SURFACE_RE = /\btools\s*\.\s*register\s*\(|\bdefineTool\s*\(|\bregisterTool\s*\(|\btoolRegistry\s*\.\s*register\s*\(/

const surfaceMemo = new Map()

function registersTools(root) {
  let key = root
  try {
    key = `${root}:${statSync(root).mtimeMs}`
  } catch {
    /* keep the plain path as the key */
  }
  if (surfaceMemo.has(key)) return surfaceMemo.get(key)
  let found = false
  // An MCP server advertises its tools over the protocol rather than calling
  // the registry — `@local/rea-switch` is the local example — so the patch's
  // `serverName` counts as a tool surface too.
  if (readServerNames(root).length > 0) found = true
  for (const file of found ? [] : readPackageText(root)) {
    if (TOOL_SURFACE_RE.test(file.text)) {
      found = true
      break
    }
  }
  surfaceMemo.set(key, found)
  return found
}

/**
 * Which rows register no tools at all.
 *
 * Returns `Map(rowName -> boolean)` and only holds rows whose packages were
 * actually found on disk — a row we could not read stays absent, so the caller
 * keeps saying "never used" instead of claiming the plugin is passive.
 */
export function toolSurface(targets, dir, options = {}) {
  const resolve = typeof options.resolveDir === 'function' ? options.resolveDir : (name) => packageDir(name, dir)
  const { roots, rowsOf } = collectSources(targets, resolve)
  const out = new Map()
  for (const target of targets) {
    if (!target || typeof target.name !== 'string' || !target.name) continue
    let readable = false
    let registers = false
    for (const [pkg, owners] of rowsOf) {
      if (!owners.has(target.name)) continue
      const root = roots.get(pkg)
      if (!root) continue
      readable = true
      if (registersTools(root)) {
        registers = true
        break
      }
    }
    if (readable) out.set(target.name, registers)
  }
  return out
}

/**
 * Expand the page's rows into the packages that can own their tools.
 *
 * A bundle contributes its own package plus every Loader row it mounts. The
 * module name carries a subpath (`@scope/pkg/tools`) so it is normalised to a
 * package name first. Rows that cannot be resolved are simply skipped, which
 * is what keeps this bounded: the profile only names a couple of hundred
 * packages, not the several hundred in the Harness's own install.
 */
function collectSources(targets, resolve) {
  /** package name -> directory, or null when it cannot be found */
  const roots = new Map()
  /** package name -> the page rows that mount it */
  const rowsOf = new Map()
  for (const target of targets) {
    if (!target || typeof target.name !== 'string' || !target.name) continue
    const packages = new Set([target.name])
    for (const module of target.modules || []) {
      const name = packageNameOf(module)
      if (name) packages.add(name)
    }
    for (const name of packages) {
      if (!rowsOf.has(name)) rowsOf.set(name, new Set())
      rowsOf.get(name).add(target.name)
      if (roots.has(name)) continue
      let root = null
      try {
        root = resolve(name) || null
      } catch {
        root = null
      }
      roots.set(name, root && existsSync(root) ? root : null)
    }
  }
  return { roots, rowsOf }
}

/**
 * Attribute registry entries to the page rows that mount their owner.
 *
 * @param registry - Map(tool name -> { description }) from {@link foldToolRegistry}.
 * @param targets - `[{ name, modules }]`, one per row on the page.
 * @param dir - Profile directory, used by the default package lookup.
 * @param options.resolveDir - Package name -> directory. Lets the caller reach
 *   packages the profile does not contain (the Harness's own install).
 * @param options.only - Tool names worth resolving. Attribution is only ever
 *   consulted for tools that have actually been called, and each one costs a
 *   scan of every candidate package, so the caller passes the called set.
 * @returns Map(row name -> tool names) plus the tool names nothing claimed.
 */
export function attributeTools(registry, targets, dir, options = {}) {
  const list = Array.isArray(targets) ? targets : []
  const resolve = typeof options.resolveDir === 'function' ? options.resolveDir : (name) => packageDir(name, dir)
  const { roots, rowsOf } = collectSources(list, resolve)

  const only = options.only instanceof Set ? options.only : null
  const names = only ? [...only].filter((name) => registry.has(name)) : [...registry.keys()]
  const wanted = names.map((name) => ({
    name,
    hash: descriptionHash(registry.get(name) && registry.get(name).description),
  }))

  const stamps = []
  for (const [name, root] of roots) {
    if (!root) continue
    const stamp = stampOf(root)
    if (stamp) stamps.push(`${name}@${stamp}`)
  }
  const generation = createHash('sha1').update(stamps.sort().join('|')).digest('hex')

  const cache = readCache()
  const fresh = cache.generation === generation
  const items = fresh && cache.items ? cache.items : {}

  // Which tools still need a scan: never seen, or described differently than
  // when they were last resolved.
  const pending = wanted.filter((tool) => {
    const entry = items[tool.name]
    return !Array.isArray(entry) || entry[0] !== tool.hash
  })

  /** MCP server name -> the packages that mount it. */
  const servers = new Map()
  const cachedServers = fresh && Array.isArray(cache.servers) ? cache.servers : []
  if (cachedServers.length > 0) {
    // Stored as `[server, [package, ...]]`, the same direction `writeCache`
    // writes — reading it the other way round silently emptied the map and made
    // `mcp__rea__*` rows flicker between "used" and "never used" on every other
    // request.
    for (const [server, packages] of cachedServers) {
      for (const pkg of packages) addTo(servers, server, pkg)
    }
  } else {
    for (const [name, root] of roots) {
      if (!root) continue
      for (const server of readServerNames(root)) addTo(servers, server, name)
    }
  }

  if (pending.length > 0) {
    const tools = pending.map((tool) => {
      const description = registry.get(tool.name) && registry.get(tool.name).description
      return { ...tool, ...needlesFor(tool.name, description) }
    })

    // tool -> Map(needleKind -> { weight, owners }). A description hit always
    // outranks a name hit, and within one kind the strongest weight wins.
    const best = new Map()
    for (const [name, root] of roots) {
      if (!root) continue
      const files = readPackageText(root)
      if (files.length === 0) continue
      for (const tool of tools) {
        let entry = best.get(tool.name)
        for (const kind of ['primary', 'secondary']) {
          const needles = tool[kind]
          if (needles.length === 0) continue
          let weight = 0
          for (const file of files) {
            if (file.weight <= weight) break
            for (const needle of needles) {
              if (file.text.includes(needle)) {
                weight = file.weight
                break
              }
            }
          }
          if (weight === 0) continue
          if (!entry) {
            entry = new Map()
            best.set(tool.name, entry)
          }
          const previous = entry.get(kind)
          if (!previous || weight > previous.weight) entry.set(kind, { weight, owners: new Set([name]) })
          else if (weight === previous.weight) previous.owners.add(name)
          break
        }
      }
    }

    for (const tool of pending) {
      const entry = best.get(tool.name)
      const claim = entry && (entry.get('primary') || entry.get('secondary'))
      items[tool.name] = [tool.hash, claim ? chooseOwner(claim.owners, tool.name) : null]
    }
  }

  const owned = new Map()
  const unattributed = []
  for (const name of names) {
    const entry = items[name]
    const owner = entry ? entry[1] : null
    if (owner) {
      addTo(owned, owner, name)
      continue
    }
    // `mcp__rea__open_binary` names the server it came from. A bundle that
    // mounts that server owns the tool even when the server's own code is not
    // on this machine. Several bundles may mount the same server (one inserts
    // the row, another repoints it at a proxy); both are involved in making the
    // call work, so both are credited.
    const derived = /^mcp__([A-Za-z0-9_.-]+)__/.exec(name)
    const claimants = derived ? servers.get(derived[1]) : null
    if (claimants && claimants.size > 0) {
      for (const pkg of claimants) addTo(owned, pkg, name)
      continue
    }
    unattributed.push(name)
  }

  // Roll packages up to the rows the page shows. A package mounted by two rows
  // credits both — they genuinely share it.
  const byRow = new Map()
  for (const [name, ownedTools] of owned) {
    for (const row of rowsOf.get(name) || []) {
      for (const tool of ownedTools) addTo(byRow, row, tool)
    }
  }
  const out = new Map()
  for (const [row, ownedTools] of byRow) out.set(row, [...ownedTools].sort())

  writeCache({
    version: CACHE_VERSION,
    generation,
    items,
    servers: [...servers].map(([server, packages]) => [server, [...packages]]),
  })
  return { owned: out, unattributed }
}

function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(value)
}

/**
 * Pick one owner from an equal-strength tie.
 *
 * A tie means two packages contain the same description, which in practice is
 * one package that defines the tool and one that embeds the catalogue it
 * printed — `dsh-tool-pwsh` quotes the `bash` blurb, and `dsh-context` embeds
 * whole tool listings. Two tie-breaks, in order:
 *
 *  - The package named after the tool. `bash` belongs to `dsh-tool-bash`, not
 *    to `dsh-tool-pwsh` or `dsh-gitbash-shell`, and a name token is not
 *    something a restatement would accidentally produce.
 *  - The Harness's own packages, when exactly one of them is in the tie.
 *
 * Anything else stays unresolved: a wrong owner makes an untouched plugin look
 * freshly used, which is worse than leaving it out.
 */
function chooseOwner(owners, tool) {
  if (owners.size === 1) return [...owners][0]
  const token = String(tool || '').toLowerCase()
  const named = [...owners].filter((name) => name.split('/').pop().split(/[-_.]/).includes(token))
  if (named.length === 1) return named[0]
  const official = [...owners].filter((name) => name.startsWith('@deepseek-ai/'))
  return official.length === 1 ? official[0] : null
}

/** Keys shorter than this are too common to attribute safely, per kind. */
const KEY_MIN = { provider: 4, command: 4, projection: 13 }

function addSignal(map, row, signal) {
  if (!map.has(row)) map.set(row, [])
  map.get(row).push(signal)
}

/**
 * Attribute the evidence that is not a tool call.
 *
 * A provider id, a slash command or a session projection is declared the same
 * way a tool is: the owning package writes the literal somewhere in its own
 * bytes. There is no description to fingerprint, so the test is exact quoted
 * containment — and because short keys (`goal`, `title`) appear in half the
 * install, a key is only attributed when exactly one package claims it.
 *
 * @param evidence - `{ provider: {id: time}, command: {...}, projection: {...} }`
 * @param targets - `[{ name, modules }]`, one per row on the page.
 * @returns Map(row name -> `[{ via, time }]`)
 */
export function attributeKeys(evidence, targets, dir, options = {}) {
  const list = Array.isArray(targets) ? targets : []
  const resolve = typeof options.resolveDir === 'function' ? options.resolveDir : (name) => packageDir(name, dir)
  const { roots, rowsOf } = collectSources(list, resolve)

  const stamps = []
  for (const [name, root] of roots) {
    if (!root) continue
    const stamp = stampOf(root)
    if (stamp) stamps.push(`${name}@${stamp}`)
  }
  const generation = createHash('sha1').update(stamps.sort().join('|')).digest('hex')

  const cache = readCache()
  const marks = (cache.generation === generation && cache.marks) || {}
  let changed = cache.generation !== generation
  const byRow = new Map()

  // Read every package once and reuse the text for every key; a per-key walk
  // would re-read the whole install for each provider and projection.
  let sources = null
  const literalOwner = (kind, key) => {
    const min = KEY_MIN[kind] || 4
    if (String(key).length < min) return null
    if (!sources) {
      sources = []
      for (const [name, root] of roots) {
        if (!root) continue
        const files = readPackageText(root)
        if (files.length > 0) sources.push({ name, files })
      }
    }
    const quoted = [`'${key}'`, `"${key}"`, '`' + key + '`']
    // Weight matters here for the same reason it matters for tools: this very
    // plugin's CHANGELOG quotes `contextHeaders` while explaining the fix, and
    // a plain "does any file mention it" test then found two owners and gave up
    // on every projection `dsh-context` registers.
    let best = 0
    const owners = new Set()
    for (const source of sources) {
      let weight = 0
      for (const file of source.files) {
        if (quoted.some((needle) => file.text.includes(needle))) {
          if (file.weight > weight) weight = file.weight
        }
      }
      if (weight === 0) continue
      if (weight > best) {
        best = weight
        owners.clear()
        owners.add(source.name)
      } else if (weight === best) {
        owners.add(source.name)
      }
    }
    // Prose is not proof: a name that only appears in markdown is a mention,
    // not a declaration.
    if (owners.size === 1 && best >= 2) return [...owners][0]
    if (kind === 'projection') return null
    // Providers and commands are often assembled at runtime
    // (`workbuddy-global` is `workbuddy-` + the account), so the literal never
    // appears. The package name still names the thing it provides: a package
    // whose own short name carries `workbuddy` is the one serving
    // `workbuddy-*`. Only a unique match counts.
    const head = String(key).toLowerCase().split(/[-_.:]/)[0]
    if (head.length < 4) return null
    const named = [...roots.keys()].filter((pkg) =>
      pkg
        .split('/')
        .pop()
        .toLowerCase()
        .split(/[-_.]/)
        .includes(head),
    )
    return named.length === 1 ? named[0] : null
  }

  for (const [kind, table] of Object.entries(evidence || {})) {
    for (const [key, time] of Object.entries(table || {})) {
      if (!key || !time) continue
      const id = `${kind}:${key}`
      let owner = marks[id]
      if (owner === undefined) {
        owner = literalOwner(kind, key)
        marks[id] = owner
        changed = true
      }
      if (!owner) continue
      for (const row of rowsOf.get(owner) || []) {
        addSignal(byRow, row, { via: `${kind}:${key}`, time })
      }
    }
  }
  if (changed) writeCache({ ...cache, generation, marks })
  return byRow
}
