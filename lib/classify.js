/**
 * Three-level classification.
 *
 *   L1  a functional family      (界面与交互 / 工具与执行 / 网络与数据 ...)
 *   L2  a capability inside it   (设置页 / 侧栏面板 / 工具注册 / HTTP 路由 ...)
 *   L3  the plugin itself        (one leaf per package, with evidence attached)
 *
 * ## Why scoring instead of a rule ladder
 *
 * The first version picked a family from the *first* rule that fired, with
 * "declares a UI slot" near the top. That is wrong for this ecosystem: almost
 * every DSH plugin registers a slot, so nearly everything landed in 界面与交互
 * and the level-1 tree collapsed into one branch — which defeats the point of
 * having three levels.
 *
 * Registering a slot answers "does this draw something", not "what is it for".
 * A coupon-balance plugin, a session cleaner and a plugin manager all draw
 * something, and they belong in three different families. So every family now
 * accumulates a weighted score from independent signals and the highest wins.
 * Drawing is deliberately the *weakest* signal (1-3 points) while calling
 * `pluginManager` or `tools.register` is strong (7-10), because the strong
 * signals are the ones that state the plugin's actual job.
 *
 * The tie-break order is also meaningful: when two families score equally the
 * more specific one wins and `ui` loses, since `ui` is the ambient property of
 * the ecosystem rather than a distinguishing one.
 *
 * ## The no-`other` guarantee
 *
 * A row is never emitted without a level-1 and a level-2 node. When every
 * signal scores zero, the structural rules still produce an answer (official
 * bundle → 系统与内核; host-only bundle → 系统与内核; anything else → 其它与待确认)
 * **with the reason attached**, so the UI can always render a bucket and the
 * user can always see why.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { profileDir, shortName } from './env.js'

/* ------------------------------------------------------------------ */
/* the taxonomy                                                        */
/* ------------------------------------------------------------------ */

/**
 * Level 1 families. `order` is the display order; `hint` is what the UI shows
 * when the user asks why a family exists.
 */
export const FAMILIES = [
  { id: 'ui', label: '界面与交互', hint: '主要给用户看和点的：设置页、侧栏、面板、装饰、主题', order: 10 },
  { id: 'tools', label: '工具与执行', hint: '主要给模型加能力的：新工具、斜杠命令、MCP 服务', order: 20 },
  { id: 'net', label: '网络与数据', hint: '主要联网或读写外部数据的：抓取、同步、接口、账号', order: 30 },
  { id: 'model', label: '模型与推理', hint: '主要接模型或改推理过程的：模型接入、提示词、上下文压缩', order: 40 },
  { id: 'session', label: '会话与工作区', hint: '主要管会话和文件的：会话增删、工作区、终端、磁盘数据', order: 50 },
  { id: 'ops', label: '运维与诊断', hint: '主要管插件本身的：插件/技能管理、诊断、打包备份', order: 60 },
  { id: 'core', label: '系统与内核', hint: 'Harness 自带的底座服务，通常不该删', order: 70 },
  { id: 'other', label: '其它与待确认', hint: '证据不足但已归档，附原因，可人工改判', order: 80 },
]

export const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]))

/**
 * Level 2 nodes. `match` is a predicate over the row's evidence; the first
 * match wins within a family, and every family ends with a catch-all so a
 * family can never return nothing.
 */
export const DOMAINS = [
  // ui
  { id: 'ui.theme', family: 'ui', label: '主题与外观', order: 5, match: (r) => r.touches.includes('theme') || /wallpaper|theme|壁纸|主题|外观|字体|头像|美化/i.test(r.text) },
  { id: 'ui.settings', family: 'ui', label: '设置页面', order: 10, match: (r) => r.slots.some((s) => s.startsWith('settings.')) },
  { id: 'ui.sidebar', family: 'ui', label: '侧栏与导航', order: 20, match: (r) => r.slots.some((s) => s.startsWith('sidebar.')) },
  { id: 'ui.conversation', family: 'ui', label: '对话区扩展', order: 30, match: (r) => r.slots.some((s) => s.startsWith('conversation.')) },
  { id: 'ui.overlay', family: 'ui', label: '浮层与装饰', order: 40, match: (r) => r.slots.some((s) => s.startsWith('shell.') || s.startsWith('main') || s.includes('toolview') || s.includes('chat.node')) },
  { id: 'ui.page', family: 'ui', label: '界面插件', order: 90, match: () => true },

  // tools
  // Skills are split by what they are *for* before the generic skill bucket:
  // a machine with eight office skills otherwise shows one level-2 node holding
  // eight leaves, which is a flat list wearing a tree's clothes.
  { id: 'tools.skill.doc', family: 'tools', label: '文档处理技能', order: 4, match: (r) => r.kind === 'skill' && /docx|xlsx|pptx|pdf|office|word|excel|slides?|文档|表格|演示|幻灯片|排版/i.test(r.text) },
  { id: 'tools.skill.dev', family: 'tools', label: '开发与诊断技能', order: 5, match: (r) => r.kind === 'skill' && /code|build|lint|test|debug|diag|git|sandbox|acl|调试|诊断|构建|测试|权限/i.test(r.text) },
  { id: 'tools.skill', family: 'tools', label: '技能工具', order: 6, match: (r) => r.kind === 'skill' },
  { id: 'tools.mcp', family: 'tools', label: 'MCP 服务', order: 8, match: (r) => r.isMcp || r.touches.includes('mcp') || /\bMCP\b/i.test(r.purpose) },
  { id: 'tools.command', family: 'tools', label: '斜杠命令', order: 20, match: (r) => r.touches.includes('commands') },
  { id: 'tools.register', family: 'tools', label: '工具注册', order: 10, match: (r) => r.touches.includes('tools') || r.hasToolFile },
  { id: 'tools.other', family: 'tools', label: '执行能力', order: 90, match: () => true },

  // net
  { id: 'net.scrape', family: 'net', label: '抓取与同步', order: 5, match: (r) => /scrap|crawl|spider|sync|coupon|balance|余额|代金券|优惠券|抓取|爬取|同步/i.test(r.text) },
  { id: 'net.search', family: 'net', label: '搜索与联网', order: 10, match: (r) => /search|github|web_search|搜索|联网/i.test(r.text) },
  { id: 'net.http', family: 'net', label: 'HTTP 接口', order: 20, match: (r) => r.touches.includes('http') },
  { id: 'net.account', family: 'net', label: '账号与鉴权', order: 30, match: (r) => /account|login|auth|账号|登录|鉴权/i.test(r.text) },
  { id: 'net.other', family: 'net', label: '网络能力', order: 90, match: () => true },

  // model
  { id: 'model.compact', family: 'model', label: '上下文压缩', order: 5, match: (r) => /context[\s-]*compress|compress\w*[\s-]*context|上下文压缩|压缩上下文/i.test(r.text) },
  { id: 'model.provider', family: 'model', label: '模型接入', order: 10, match: (r) => r.touches.includes('llm') || /provider|接入|倍率|积分/i.test(r.text) },
  { id: 'model.prompt', family: 'model', label: '提示词与推理', order: 20, match: (r) => /prompt|reasoning|思考|提示词|推理/i.test(r.text) },
  { id: 'model.other', family: 'model', label: '推理能力', order: 90, match: () => true },

  // session
  { id: 'session.manage', family: 'session', label: '会话管理', order: 10, match: (r) => r.touches.includes('sessions') || /session|会话/i.test(r.text) },
  { id: 'session.workspace', family: 'session', label: '工作区与文件', order: 20, match: (r) => r.touches.includes('workspace') || r.touches.includes('files') },
  { id: 'session.terminal', family: 'session', label: '终端与进程', order: 30, match: (r) => r.touches.includes('terminal') || r.touches.includes('process') },
  { id: 'session.other', family: 'session', label: '会话能力', order: 90, match: () => true },

  // ops
  { id: 'ops.manage', family: 'ops', label: '插件与技能管理', order: 10, match: (r) => r.touches.includes('pluginManager') || /整合包|插件管理|管理插件|plugin manager|manage\w*[\s-]*plugin/i.test(r.text) },
  { id: 'ops.skills', family: 'ops', label: '技能管理', order: 20, match: (r) => r.touches.includes('skills') || /skill|技能/i.test(r.text) },
  { id: 'ops.backup', family: 'ops', label: '打包与备份', order: 30, match: (r) => /\bmodpack\b|dshmodpack|backup|snapshot|备份|打包成|导出成/i.test(r.text) },
  { id: 'ops.diag', family: 'ops', label: '诊断与日志', order: 40, match: (r) => /log|diag|inspect|trace|日志|诊断|检查/i.test(r.text) },
  { id: 'ops.other', family: 'ops', label: '运维能力', order: 90, match: () => true },

  // core
  { id: 'core.service', family: 'core', label: '宿主服务', order: 10, match: () => true },

  // other
  { id: 'other.unclear', family: 'other', label: '证据不足', order: 10, match: () => true },
]

export const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]))

export function domainsOf(familyId) {
  return DOMAINS.filter((d) => d.family === familyId).sort((a, b) => a.order - b.order)
}

/* ------------------------------------------------------------------ */
/* evidence extraction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Host services, matched as either member access (`.tools`) or as a quoted
 * string (`get('tools')`, `serviceOf(ctx, 'tools')`).
 *
 * Both spellings matter: a plugin that resolves services through a helper only
 * ever mentions the name as a string, and matching only member access made
 * such plugins look like they touch nothing at all.
 */
const SERVICES = {
  pluginManager: 'pluginManager',
  tools: 'tools',
  http: 'webServer',
  llm: 'llm',
  sessions: 'sessionQuery',
  skills: 'skills',
  commands: 'commands',
  workspace: 'workspaceFiles',
  theme: 'theme',
  storage: 'storage',
  agents: 'agents',
}

/** Behaviours that are not a single service name. */
const BEHAVIOURS = {
  compact: /compact|compressContext|contextWindow|tokenBudget/i,
  terminal: /child_process|spawnSync|\bspawn\s*\(|\bexecFile\b|\bpty\b/i,
  process: /child_process|spawnSync|\bspawn\s*\(|\bexecFile\b/i,
  files: /node:fs|readFileSync|writeFileSync|readdirSync|createReadStream|readdir\s*\(/,
  fetch: /\bfetch\s*\(|node:https?|axios|XMLHttpRequest/,
  // Only real MCP construction. A bare `mcp` matches prose and comments, and
  // the patterns below must never match a regex *literal* — this file contains
  // its own pattern text, so a loose alternation makes the classifier detect
  // itself as an MCP server.
  mcp: /@modelcontextprotocol\/sdk|new\s+McpServer\s*\(|mcpServers\s*[:=]\s*\{|["'`]mcp__[a-z]/,
  theme: /overrideTokens\s*\(|theme\s*\.\s*register\s*\(|setTheme\s*\(|registerTheme/,
}

const SLOT_RE = /slots\s*\.\s*register\s*\(\s*\{[^}]*?name\s*:\s*['"`]([\w.$-]+)['"`]/g
const STRING_LITERAL_RE = /['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/g

/**
 * Slot names the shell actually declares.
 *
 * Slot registration is frequently indirect — `seat('settings.section', 18, …)`
 * passes the name as an argument to a local helper — so anchoring a regex on
 * `register({ name: '…' })` misses most real plugins. Instead every string
 * literal in the file is collected and intersected with this vocabulary, which
 * catches literal, aliased and parameterised registrations alike while still
 * refusing to invent slot names out of arbitrary strings.
 */
const KNOWN_SLOTS = new Set([
  'settings.section', 'settings.plugins.tab', 'settings.general.item', 'settings.models.footer',
  'settings.models.provider-card', 'settings.action', 'settings.header', 'settings.onboarding',
  'settings.trigger', 'settings.close', 'settings.launcher',
  'sidebar.footer.action', 'sidebar.panellist', 'sidebar.panellist.actions', 'sidebar.brand.mark',
  'sidebar.brand.name', 'sidebar.toggle.badge', 'sidebar.settings', 'sidebar.workspaces',
  'sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action',
  'sidebar.session.row.leading', 'sidebar.session.row.hover',
  'shell.overlay', 'shell.quota-notice', 'workspace.toast', 'onboarding.desktop.before',
  'main', 'conversation', 'conversation.view', 'conversation.session', 'conversation.chat.flow',
  'conversation.chat.node', 'conversation.chat.turnTail', 'conversation.chat.assistant-actions',
  'conversation.chat.commandview', 'conversation.chat.message.images', 'conversation.chat.reasoning.body',
  'conversation.composer', 'conversation.composer.bar', 'conversation.composer.dock',
  'conversation.input.dock', 'conversation.input.left', 'conversation.input.right',
  'conversation.input.overlay', 'conversation.input.attachments', 'conversation.input.model',
  'conversation.input.permission', 'conversation.input.plan', 'conversation.input.activity',
  'conversation.hero.options', 'conversation.hero.brand.mark', 'conversation.hero.agentPreset',
  'conversation.hero.workspace', 'conversation.approval.detail', 'conversation.plan-review.actions',
  'conversation.user.text', 'conversation.user.text.node', 'conversation.content',
  'tool.call.toolview', 'tool.call.images', 'tool.view.cordis',
  'plugins.bundle.config', 'plugins.row.config', 'plugins.detail.actions', 'plugins.header.leading',
  'deliverables.file.actions',
])

/**
 * Read budget per package.
 *
 * `dsh-modpack` keeps its slot registration on line 2535 of a 127 KiB file; a
 * 96 KiB cap cut the file off before the one line that identified it, and the
 * plugin fell through to the wrong family. Real plugins ship single files of
 * several hundred KiB, so the cap has to clear that comfortably.
 */
const FILE_MAX = 2 * 1024 * 1024
const TOTAL_MAX = 8 * 1024 * 1024
const MAX_FILES = 40
const README_MAX = 4000

const TOOL_NAME_RES = [
  /tools\s*\.\s*register\s*\(\s*\{\s*name\s*:\s*['"`]([a-z][a-z0-9_-]{2,40})['"`]/g,
  /\bname\s*:\s*['"`]([a-z][a-z0-9]*(?:_[a-z0-9]+){1,4})['"`][\s\S]{0,240}?\bdescription\s*:\s*['"`]/g,
]

const SKIP_DIRS = new Set(['node_modules', '.git', 'assets', 'screenshots', 'locale', 'docs', 'test', 'tests', '__tests__', 'coverage'])
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts'])

function readTextFile(path, limit = FILE_MAX) {
  try {
    const text = readFileSync(path, 'utf8')
    return text.length > limit ? text.slice(0, limit) : text
  } catch {
    return null
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function packageDir(name, dir = profileDir()) {
  if (!name) return null
  const candidate = join(dir, 'node_modules', ...String(name).split('/'))
  return existsSync(candidate) ? candidate : null
}

/**
 * The files worth reading, derived from what the package itself declares.
 *
 * Reading a fixed list of names (`client.js`, `index.js`) misses every package
 * whose entry lives elsewhere — `billion-context` ships `dist/agent/dsh-native.js`
 * and read as zero bytes of code, so it had no evidence at all. `main`,
 * `exports` and `dsh.client` are the package telling us where its code is; use
 * that first, then fall back to conventions.
 */
function sourceFiles(root, pkg) {
  const picked = new Set()
  const add = (value) => {
    if (typeof value !== 'string') return
    const clean = value.replace(/^\.\//, '').split('#')[0].split('?')[0]
    if (!CODE_EXT.has(extname(clean))) return
    if (clean.startsWith('../') || clean.includes('/../')) return
    picked.add(clean)
  }
  const walkExports = (value, depth = 0) => {
    if (depth > 4 || value == null) return
    if (typeof value === 'string') return add(value)
    if (typeof value === 'object') for (const key of Object.keys(value)) walkExports(value[key], depth + 1)
  }
  if (pkg) {
    add(pkg.main)
    add(pkg.module)
    walkExports(pkg.exports)
    if (pkg.dsh && pkg.dsh.client) add(pkg.dsh.client.entry)
  }
  for (const conventional of ['client.js', 'index.js', 'index.mjs', 'lib/client.js', 'lib/index.js']) add(conventional)

  // Anything still missing but present on disk under a shallow source dir.
  for (const dirName of ['', 'lib', 'dist', 'src']) {
    const dir = dirName ? join(root, dirName) : root
    if (!existsSync(dir)) continue
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!CODE_EXT.has(extname(entry.name))) continue
      picked.add(dirName ? `${dirName}/${entry.name}` : entry.name)
      if (picked.size >= MAX_FILES) break
    }
    if (picked.size >= MAX_FILES) break
  }
  return [...picked].slice(0, MAX_FILES)
}

/**
 * Read the package's own bytes to see what it actually reaches for.
 *
 * A package's `package.json` says what it *claims*; its code says what it
 * *does*. Both matter, but only the code can tell you whether a bundle with no
 * description is a settings page or a background daemon, which is the
 * difference between "safe to delete" and "your UI stops loading".
 */
export function codeEvidence(name, dir = profileDir()) {
  const root = packageDir(name, dir)
  const evidence = {
    slots: [],
    touches: [],
    toolNames: [],
    hasToolFile: false,
    isMcp: false,
    halves: [],
    readme: null,
    codeChars: 0,
    files: [],
  }
  if (!root) return evidence
  const pkg = readJson(join(root, 'package.json'))
  const dsh = pkg && pkg.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : {}
  if (dsh.client) evidence.halves.push('client')
  if (dsh.bundle) evidence.halves.push('host')
  if (!dsh.client && !dsh.bundle) evidence.halves.push('plain')
  if (/mcp/i.test(String(pkg && pkg.name))) evidence.isMcp = true

  const sources = []
  let total = 0
  for (const file of sourceFiles(root, pkg)) {
    if (total >= TOTAL_MAX) break
    const path = join(root, ...file.split('/'))
    if (!existsSync(path)) continue
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      continue
    }
    if (size === 0) continue
    const text = readTextFile(path)
    if (!text) continue
    sources.push(text)
    total += text.length
    evidence.files.push(file)
  }
  evidence.codeChars = total
  const code = sources.join('\n')

  const slots = new Set()
  // Direct registrations: `slots.register({ name: 'settings.section' })`.
  SLOT_RE.lastIndex = 0
  let match
  while ((match = SLOT_RE.exec(code))) slots.add(match[1])
  // Indirect ones: the name is an argument, a variable, or a constant. Collect
  // every dotted string literal and keep the ones the shell actually declares.
  STRING_LITERAL_RE.lastIndex = 0
  while ((match = STRING_LITERAL_RE.exec(code))) {
    if (KNOWN_SLOTS.has(match[1])) slots.add(match[1])
  }
  evidence.slots = [...slots].slice(0, 24)

  const touches = new Set()
  for (const [key, service] of Object.entries(SERVICES)) {
    // `.service` (member access) or `'service'` (resolved through a helper).
    const re = new RegExp(`\\.${service}\\b|['"\`]${service}['"\`]`)
    if (re.test(code)) touches.add(key)
  }
  for (const [key, re] of Object.entries(BEHAVIOURS)) {
    if (re.test(code)) touches.add(key)
  }
  if (evidence.slots.length > 0) touches.add('ui')
  if (/\.css['"`]|className\s*:|createElement\s*\(/.test(code)) touches.add('css')
  evidence.touches = [...touches]

  const toolNames = new Set()
  for (const re of TOOL_NAME_RES) {
    re.lastIndex = 0
    while ((match = re.exec(code))) toolNames.add(match[1])
  }
  evidence.toolNames = [...toolNames].slice(0, 24)

  for (const file of ['README.md', 'readme.md', 'README.zh.md', 'README.zh-CN.md', 'README.zh-CN.MD']) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    const text = readTextFile(path, README_MAX)
    if (text) {
      evidence.readme = text
      break
    }
  }
  return evidence
}

/* ------------------------------------------------------------------ */
/* classification                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build the classification input for one row. Everything the rules and the AI
 * see comes through here, so both passes reason over identical evidence.
 */
export function rowFacts(row, options = {}) {
  const dir = options.dir || profileDir()
  const name = row.name || row.entryId || ''
  const root = packageDir(name, dir)
  const meta = root ? readJson(join(root, 'package.json')) : null
  const code = options.withCode === false
    ? { slots: [], touches: [], toolNames: [], halves: [], readme: null, isMcp: false, codeChars: 0, files: [] }
    : codeEvidence(name, dir)
  const dshMeta = meta && meta.dsh && meta.dsh.meta && typeof meta.dsh.meta === 'object' ? meta.dsh.meta : null
  const metaTitle = dshMeta ? dshMeta.title : null
  const metaDesc = dshMeta ? dshMeta.description : null
  const title = pickText(metaTitle) || row.title || shortName(name)
  const description = pickText(metaDesc) || row.description || (meta && typeof meta.description === 'string' ? meta.description : null)
  const readme = code.readme ? code.readme.slice(0, 1200) : ''
  // Skills carry their evidence in the SKILL.md frontmatter rather than in a
  // package.json + code, so their `whenToUse` and body head are the equivalent
  // of a README. Without them a skill is classified from its name alone.
  const skillText = row.kind === 'skill'
    ? [row.whenToUse, row.bodyHead].filter(Boolean).join('\n')
    : ''
  const text = [name, shortName(name), title, description, readme, skillText].filter(Boolean).join('\n')
  // What the author says the thing is for. Deliberately excludes the package
  // name: `dsh-plugin-studio` contains "plugin", and letting the name score as
  // purpose makes every plugin whose name mentions plugins look like a manager.
  const purpose = [title, description].filter(Boolean).join(' ')

  return {
    key: row.key,
    kind: row.kind,
    name,
    short: shortName(name),
    title,
    description,
    purpose,
    official: row.official === true,
    optional: row.optional === true,
    enabled: row.enabled !== false,
    removable: row.removable !== false,
    installed: row.installed !== false,
    availability: row.availability || 'profile',
    source: row.source || null,
    version: row.version || null,
    rowCount: row.rowCount || (row.rows ? row.rows.length : 0),
    slots: code.slots,
    touches: code.touches,
    toolNames: code.toolNames,
    halves: code.halves,
    isMcp: code.isMcp === true,
    hasToolFile: code.touches.includes('tools'),
    text,
    readme: code.readme,
    codeChars: code.codeChars || 0,
    files: code.files || [],
  }
}

function pickText(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    for (const key of ['zh', 'zh-CN', 'en', 'ja']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
    }
    for (const item of Object.values(value)) {
      if (typeof item === 'string' && item.trim()) return item.trim()
    }
  }
  return null
}

/**
 * Purpose rules, most specific first.
 *
 * Only the **first** matching rule awards purpose points. Summing them was the
 * second real bug: `dsh-plugin-studio` describes itself as managing "plugins
 * and skills … tools", which handed 10 points each to 运维 and 工具, and the
 * plugin then won a family it does not belong to. A description is one
 * statement of purpose, so it must vote once — for its most specific claim.
 *
 * Ordering is by how narrow the claim is. "Renders Wallpaper Engine
 * backgrounds" can only mean one thing; "plugin" appears in the blurbs of half
 * the ecosystem, including plugins that merely ship as one.
 */
const PURPOSE_RULES = [
  /* --- the base layer, which really is the kernel ------------------- */
  { family: 'core', why: '说明里写明它是 Harness 底座/内核层', re: /shared dsh core|\bdsh[- ]?base\b|patch layer|browser-surface|runtime glue|内核|底座|核心层/i },

  /* --- narrow, unambiguous claims ----------------------------------- */
  { family: 'ui', why: '说明里写明它是壁纸/主题类外观插件', re: /wallpaper|壁纸|动态壁纸|主题皮肤/i },
  { family: 'ui', why: '说明里写明它改外观/字体/头像', re: /theme|\bavatar\b|\bfonts?\b|外观|头像|字体|美化/i },
  { family: 'model', why: '说明里写明它压缩上下文', re: /context[\s-]*compress|compress\w*[\s-]*context|上下文压缩|压缩上下文/i },
  { family: 'model', why: '说明里写明它翻译或改写模型输出', re: /translat|翻译/i },
  { family: 'net', why: '说明里写明它联网抓取/查询外部数据', re: /coupon|balance|scrap|crawl|spider|代金券|优惠券|余额|抓取|爬取/i },

  /* --- session, before the generic "search"/"files" rules ----------- */
  { family: 'session', why: '说明里写明它管会话（增删/分组/清理）', re: /delete\w*\s+session|session\w*\s+(delete|clean|manage|group)|删除会话|清理会话|会话分组|清空会话|会话管理/i },
  { family: 'session', why: '说明里写明它检索历史会话', re: /search\w*\s+(earlier\s+)?sessions?|sessions?\w*\s+search|read\w*\s+earlier\s+sessions?|会话搜索|搜索会话|历史会话/i },
  { family: 'session', why: '说明里写明它改会话标题', re: /session\w*\s+titles?|titles?\w*\s+(as|for)\s+.*prompts?|会话标题|对话标题/i },
  { family: 'session', why: '说明里写明它管终端/常驻进程', re: /terminal|\bpty\b|shell processes?|keep\w*\s+.*process\w*\s+alive|持久终端|常驻终端|终端/i },

  /* --- model ------------------------------------------------------- */
  { family: 'model', why: '说明里写明它接模型或改推理', re: /\bLLM\b|\bprovider\b|\bprompt\b|reasoning|推理|模型接入|积分倍率|上下文/i },

  /* --- tools: before the generic "UI"/"API" rules ------------------- */
  // "Agent Teams collaboration, tools, and Web UI" must read as a tool bundle,
  // not as a UI panel, so the agent rule outranks the generic `UI` rule below.
  // Deliberately narrow: bare "agents" appears in half the ecosystem ("let
  // agents do X") and would swallow every skill bundle as a tool. The extra
  // alternatives cover the phrasings the official bundles actually use —
  // "delegate a single task", "repeated work with fresh agents" — which are
  // about driving other models, not about being one.
  { family: 'tools', why: '说明里写明它编排子智能体/委派任务', re: /\bagent\s*teams?\b|\bsubagents?\b|\bdelegat\w+|fresh agents?|repeated work|子代理|智能体团队|智能体协作|委派/i },
  { family: 'tools', why: '说明里写明它创建 Git 工作树', re: /worktree|工作树/i },
  { family: 'tools', why: '说明里写明它提供工具或 MCP 服务', re: /\bMCP\b|\btools?\b|工具集|注册.*工具|一体包/i },

  /* --- ops --------------------------------------------------------- */
  // Before the generic "search" rule: a plugin *market* mentions browsing and
  // searching, but its job is installing plugins, not querying the web.
  { family: 'ops', why: '说明里写明它是插件市场/安装器', re: /\bmarket\b|插件市场|应用市场|安装器|一键安装/i },
  { family: 'ops', why: '说明里写明它是开发者调试/检查工具', re: /inspect|diagnos|devtools|debug|\btrace\b|调试|检查器|开发者工具/i },
  { family: 'ops', why: '说明里写明它管理插件/技能/整合包', re: /\bmodpack\b|\bplugin\s*manager\b|插件管理|整合包|插件工坊|技能管理|\bplugins?\b|插件|技能/i },

  /* --- net --------------------------------------------------------- */
  { family: 'net', why: '说明里写明它联网或对接接口', re: /\bAPI\b|\bsearch\b|\bsync\b|\baccount\b|联网|搜索|同步|账号|登录|鉴权/i },

  /* --- session, generic -------------------------------------------- */
  { family: 'session', why: '说明里写明它管工作区/文件', re: /workspace|\bfiles?\b|工作区|文件/i },

  /* --- ui, generic (must stay near the end) ------------------------ */
  { family: 'ui', why: '说明里写明它是界面/面板类', re: /\bpanel\b|\bwidget\b|\bUI\b|\bstyle\b|界面|面板|窗口/i },
  { family: 'ui', why: '说明里写明它处理语音/音频输入', re: /\bvoice\b|\baudio\b|\bspeech\b|语音|音频|麦克风|输入法/i },
]

/**
 * The scoring table.
 *
 * Two tiers, and the tiers are the whole design:
 *
 *   PURPOSE (10)   the plugin's own title/description, cast as a single vote.
 *   CAPABILITY (1-10) what the code actually does. A distinctive service call
 *                  (`pluginManager`, `llm`) scores high; ambient facts nearly
 *                  every DSH plugin shares (`http`, `files`, `css`, a slot
 *                  registration) score 1-2 and only break ties.
 *
 * The first version treated every touch equally, and the measurement showed
 * why that fails: eight of nine installed plugins touch `http`, `files`,
 * `process` and `css`, so those signals cancelled out and whichever family
 * happened to be listed first won. Ambient evidence has to be worth less than
 * the sentence the author wrote.
 *
 * `why` is surfaced to the user as the reason, so each one must read as a
 * plain-language statement about the plugin, not about a regex.
 */
const SIGNALS = [
  /* --- CAPABILITY: a distinctive service call ----------------------- */
  { family: 'ops', points: 10, why: '代码里直接调用插件管理服务', when: (f) => f.touches.includes('pluginManager') },
  { family: 'model', points: 8, why: '代码里调用模型接口', when: (f) => f.touches.includes('llm') },
  { family: 'model', points: 8, why: '代码里压缩或改写上下文', when: (f) => f.touches.includes('compact') },
  { family: 'tools', points: 7, why: '代码里注册了工具', when: (f) => f.touches.includes('tools') },
  {
    family: 'tools',
    points: (f) => Math.min(6, f.toolNames.length * 2),
    why: (f) => `注册了 ${f.toolNames.length} 个工具：${f.toolNames.slice(0, 4).join(', ')}`,
    when: (f) => f.toolNames.length > 0,
  },
  { family: 'tools', points: 5, why: '注册了斜杠命令', when: (f) => f.touches.includes('commands') },
  { family: 'tools', points: 8, why: '是一个 MCP 服务', when: (f) => f.isMcp || f.touches.includes('mcp') },
  { family: 'session', points: 6, why: '代码里读写会话数据', when: (f) => f.touches.includes('sessions') },
  { family: 'ops', points: 4, why: '代码里调用技能服务', when: (f) => f.touches.includes('skills') },
  { family: 'session', points: 3, why: '代码里操作工作区文件', when: (f) => f.touches.includes('workspace') },

  /* --- AMBIENT: true of most plugins, so worth little --------------- */
  { family: 'ui', points: 6, why: '修改主题或外观 token', when: (f) => f.touches.includes('theme') },
  {
    family: 'ui',
    points: (f) => Math.min(2, f.slots.length),
    why: (f) => `注册了界面插槽 ${f.slots.slice(0, 3).join(', ')}`,
    when: (f) => f.slots.length > 0,
  },
  { family: 'ui', points: 1, why: '声明了 dsh.client（会往界面里画东西）', when: (f) => f.halves.includes('client') },
  { family: 'net', points: 2, why: '注册了 HTTP 路由', when: (f) => f.touches.includes('http') },
  { family: 'net', points: 2, why: '会发起网络请求', when: (f) => f.touches.includes('fetch') },
  { family: 'session', points: 2, why: '会读写本地文件', when: (f) => f.touches.includes('files') },
  { family: 'session', points: 2, why: '会启动子进程', when: (f) => f.touches.includes('terminal') },

  /* --- CORE: shipped with the app ----------------------------------- */
  {
    family: 'core',
    points: 12,
    why: '官方内置包，源码在应用归档内不可读',
    // Only the *unremovable* base layer is core. Every optional official
    // bundle is also `official` and also lives under `installation`, so
    // matching on those two alone dumped 19 rows — plugin markets, voice
    // input, worktrees — into 系统与内核 and flattened level 1 into a single
    // branch. `optional` is the flag that separates the two.
    when: (f) => f.official && f.availability === 'installation' && f.optional !== true,
  },
]

/** Families ordered most-specific-first, used to break ties. `ui` is last. */
const TIE_ORDER = ['tools', 'net', 'model', 'session', 'ops', 'core', 'ui', 'other']

function scoreFamilies(facts) {
  const scores = new Map()
  const reasons = new Map()
  for (const family of FAMILIES) {
    scores.set(family.id, 0)
    reasons.set(family.id, [])
  }
  const add = (family, points, why) => {
    if (!points) return
    scores.set(family, (scores.get(family) || 0) + points)
    if (why) reasons.get(family).push(why)
  }

  // Purpose votes once, for the narrowest claim the description makes.
  for (const rule of PURPOSE_RULES) {
    if (!rule.re.test(facts.purpose)) continue
    add(rule.family, 10, rule.why)
    break
  }

  for (const signal of SIGNALS) {
    let hit = false
    try {
      hit = signal.when(facts)
    } catch {
      hit = false
    }
    if (!hit) continue
    const points = typeof signal.points === 'function' ? signal.points(facts) : signal.points
    add(signal.family, points, typeof signal.why === 'function' ? signal.why(facts) : signal.why)
  }
  return { scores, reasons }
}

/**
 * Classify one row. Always returns a family and a domain.
 */
export function classifyFacts(facts) {
  // A skill is never ambiguous about its *family*: it is a SKILL.md directory
  // the model loads. Filing it under `other` because it has no code to grep is
  // exactly the failure this taxonomy was built to remove.
  //
  // Its *domain* still varies — office skills, diagnostics skills and plain
  // prompt skills are different things — so the domain is resolved through the
  // same ordered matcher as everything else rather than pinned to one bucket.
  if (facts.kind === 'skill') {
    const skillDomains = DOMAINS.filter((d) => d.family === 'tools')
    const picked = skillDomains.find((d) => {
      try {
        return d.match(facts)
      } catch {
        return false
      }
    }) || DOMAIN_BY_ID.get('tools.skill')
    return {
      family: 'tools',
      familyLabel: FAMILY_BY_ID.get('tools').label,
      domain: picked.id,
      domainLabel: picked.label,
      leaf: facts.name,
      leafLabel: facts.title || facts.short || facts.name,
      confidence: 'high',
      evidence: [facts.source ? `技能目录（来源 ${facts.source}）` : '技能目录（含 SKILL.md）'],
    }
  }

  const { scores, reasons } = scoreFamilies(facts)

  // Pick the highest score; ties go to the more specific family.
  let best = null
  let bestScore = 0
  for (const family of FAMILIES) {
    const score = scores.get(family.id) || 0
    if (score <= 0) continue
    if (score > bestScore) {
      best = family.id
      bestScore = score
      continue
    }
    if (score === bestScore && best) {
      const current = TIE_ORDER.indexOf(family.id)
      const incumbent = TIE_ORDER.indexOf(best)
      if (current !== -1 && (incumbent === -1 || current < incumbent)) best = family.id
    }
  }

  const evidence = []
  if (best) {
    evidence.push(...reasons.get(best))
    // Mention what else the plugin does — it is often the deciding factor for
    // "can I delete this", so it must not be hidden just because it lost.
    const secondary = FAMILIES
      .filter((family) => family.id !== best && (scores.get(family.id) || 0) > 0)
      .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
      .slice(0, 2)
      .map((family) => `${family.label}（${(scores.get(family.id) || 0)} 分）`)
    if (secondary.length > 0) evidence.push(`同时涉及 ${secondary.join('、')}`)
  }

  // Structural fallback: no signal fired at all.
  if (!best) {
    if (facts.official) {
      best = 'core'
      evidence.push('官方行且无其它证据，按内核服务归档')
    } else if (facts.halves.includes('host')) {
      best = 'core'
      evidence.push('只声明 dsh.bundle（宿主插件），没有界面也没有工具证据')
    } else {
      best = 'other'
      evidence.push(facts.codeChars === 0 ? '读不到这个包的源码与说明' : '源码里没有可识别的注册行为')
    }
  }

  const family = FAMILY_BY_ID.get(best) || FAMILY_BY_ID.get('other')
  const domain = DOMAINS.filter((d) => d.family === family.id).find((d) => {
    try {
      return d.match(facts)
    } catch {
      return false
    }
  }) || DOMAINS.filter((d) => d.family === family.id).slice(-1)[0]

  return {
    family: family.id,
    familyLabel: family.label,
    domain: domain.id,
    domainLabel: domain.label,
    leaf: facts.name,
    leafLabel: facts.title || facts.short || facts.name,
    confidence: confidenceOf(facts, family.id, bestScore, scores),
    evidence,
  }
}

function confidenceOf(facts, familyId, topScore, scores) {
  if (familyId === 'other') return 'low'
  // The runner-up matters as much as the winner: a plugin scoring 8 against 7
  // is a coin flip, and the UI should say so rather than assert a bucket.
  let runnerUp = 0
  for (const [id, score] of scores) {
    if (id === familyId) continue
    if (score > runnerUp) runnerUp = score
  }
  const margin = topScore - runnerUp
  if (topScore >= 8 && margin >= 4) return 'high'
  if (topScore >= 4 && margin >= 2) return 'medium'
  return 'low'
}

/**
 * The whole tree, built from rows. Leaves are grouped by family then domain;
 * the UI renders this directly, so an empty family simply does not appear.
 */
export function buildTree(rows, verdicts) {
  const byFamily = new Map()
  for (const row of rows) {
    const verdict = verdicts.get(row.key) || classifyFacts(rowFacts(row))
    const family = FAMILY_BY_ID.get(verdict.family) || FAMILY_BY_ID.get('other')
    if (!byFamily.has(family.id)) byFamily.set(family.id, { family, domains: new Map() })
    const bucket = byFamily.get(family.id)
    if (!bucket.domains.has(verdict.domain)) {
      const domain = DOMAIN_BY_ID.get(verdict.domain)
      bucket.domains.set(verdict.domain, { domain, leaves: [] })
    }
    bucket.domains.get(verdict.domain).leaves.push({
      key: row.key,
      name: row.name,
      title: verdict.leafLabel,
      enabled: row.enabled !== false,
      removable: row.removable !== false,
      official: row.official === true,
      confidence: verdict.confidence,
      evidence: verdict.evidence,
    })
  }
  const out = []
  for (const family of FAMILIES) {
    const bucket = byFamily.get(family.id)
    if (!bucket) continue
    const domains = [...bucket.domains.values()]
      .sort((a, b) => (a.domain ? a.domain.order : 999) - (b.domain ? b.domain.order : 999))
      .map((entry) => ({
        id: entry.domain ? entry.domain.id : 'other.unclear',
        label: entry.domain ? entry.domain.label : '其它',
        leaves: entry.leaves.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh')),
      }))
    out.push({
      id: family.id,
      label: family.label,
      hint: family.hint,
      count: domains.reduce((sum, d) => sum + d.leaves.length, 0),
      domains,
    })
  }
  return out
}

export function classifyAll(rows, options = {}) {
  const verdicts = new Map()
  for (const row of rows) {
    const facts = rowFacts(row, options)
    verdicts.set(row.key, classifyFacts(facts))
  }
  return verdicts
}
