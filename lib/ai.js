/**
 * AI explanation and classification.
 *
 * Two jobs share one model call:
 *
 *  1. **Explain** — "this plugin does X for you, in plain words" — so the user
 *     can decide whether to keep it.
 *  2. **Refine the classification** — the rule pass is total but sometimes
 *     shallow; the model sees the same evidence plus anything the GitHub lookup
 *     found and can move a row into a better leaf.
 *
 * The prompt is built so the model cannot invent: it is handed a closed list of
 * category ids, told which fields are present for THIS row (so "no slot
 * evidence" is not read as "this plugin has no slot"), and asked for a strict
 * JSON array. Anything that fails validation is dropped, never repaired —
 * a wrong explanation is worse than a missing one.
 *
 * ## The prepareCall trap
 *
 * `llm.prepareCall(config, signal)` deep-freezes a structured clone of the
 * resolved config. An AbortSignal survives neither the clone nor the freeze:
 * passing one inside `config` makes the provider throw
 * `signals[0] is not of type AbortSignal`. So the signal goes in as the second
 * argument, and the resolved `prepared.config` must be handed back to
 * `stream()` or the call fails with INVALID_PREPARED_CALL.
 */
import { serviceOf, errorText } from './env.js'

const AI_MAX_ROWS = 24
const AI_MAX_TOKENS = 2600
const AI_TIMEOUT_MS = 120000

/** The model target this Host can actually call, or null. */
export function resolveCallTarget(ctx) {
  const agentDefaultModel = serviceOf(ctx, 'agentDefaultModel')
  if (agentDefaultModel && typeof agentDefaultModel.currentSelection === 'function') {
    try {
      const selection = agentDefaultModel.currentSelection()
      if (selection && selection.provider && selection.model) {
        return { provider: selection.provider, model: selection.model }
      }
    } catch {
      // fall through to the provider listing
    }
  }
  const llm = serviceOf(ctx, 'llm')
  if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return null
  let providers = []
  try {
    providers = llm.listProviders() || []
  } catch {
    return null
  }
  for (const provider of providers) {
    const id = provider && (provider.id || provider.provider)
    if (!id) continue
    let models = []
    try {
      models = llm.listModels(id) || []
    } catch {
      continue
    }
    const first = models.find((model) => model && model.id)
    if (first) return { provider: id, model: first.id }
  }
  return null
}

function configEquals(a, b) {
  if (!a || !b) return false
  const keysA = Object.keys(a).filter((key) => key !== 'messages' && key !== 'signal')
  const keysB = Object.keys(b).filter((key) => key !== 'messages' && key !== 'signal')
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/**
 * One non-streaming completion, assembled from the text deltas.
 * Returns `{ text, usage, failure }` and never throws for a model-side error.
 */
export async function callModel(ctx, target, prompt, signal) {
  const llm = serviceOf(ctx, 'llm')
  if (!llm || typeof llm.prepareCall !== 'function') return { text: '', failure: 'llm.prepareCall 不可用' }
  const base = {
    provider: target.provider,
    model: target.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: AI_MAX_TOKENS,
    temperature: 0,
  }
  let prepared
  try {
    prepared = await llm.prepareCall(base, signal)
  } catch (err) {
    return { text: '', failure: `prepareCall: ${errorText(err)}` }
  }
  if (!prepared || typeof prepared.stream !== 'function') {
    return { text: '', failure: 'prepareCall 没有返回 stream' }
  }
  const resolved = prepared && prepared.config && configEquals(prepared.config, base) === false
    ? { ...base, ...prepared.config }
    : base
  const options = { ...resolved }
  delete options.signal
  if (signal !== undefined) options.signal = signal

  let text = ''
  let usage = null
  let failure = null
  try {
    for await (const chunk of prepared.stream(options)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'usage') usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens }
      else if (chunk.type === 'finish' && chunk.reason && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        const reason = chunk.reason
        failure = (reason.failure && (reason.failure.message || reason.failure.code)) || reason.kind
      }
    }
  } catch (err) {
    failure = `stream: ${errorText(err)}`
  }
  return { text, usage, failure }
}

/* ------------------------------------------------------------------ */
/* prompt                                                              */
/* ------------------------------------------------------------------ */

/**
 * The closed category list the model may choose from. Handing the model free
 * rein over category names produces three spellings of the same idea and a
 * tree that grows a new branch per plugin.
 */
export function categoryChoices(families, domains) {
  const lines = []
  for (const family of families) {
    lines.push(`- ${family.id}  «${family.label}» — ${family.hint}`)
    for (const domain of domains.filter((d) => d.family === family.id)) {
      lines.push(`    · ${domain.id}  «${domain.label}»`)
    }
  }
  return lines.join('\n')
}

function evidenceBlock(entry, locale) {
  const lines = []
  lines.push(`key: ${entry.key}`)
  lines.push(`包名: ${entry.name}`)
  lines.push(`标题: ${entry.title}`)
  if (entry.description) lines.push(`作者写的简介: ${entry.description}`)
  lines.push(`类别: ${entry.kind}`)
  lines.push(`官方内置: ${entry.official ? '是' : '否'}`)
  lines.push(`可删除: ${entry.removable ? '是' : '否'}`)
  if (entry.halves && entry.halves.length) lines.push(`代码两半: ${entry.halves.join(' + ')}`)
  if (entry.slots && entry.slots.length) lines.push(`注册的界面插槽: ${entry.slots.join(', ')}`)
  if (entry.touches && entry.touches.length) lines.push(`代码里触碰的系统: ${entry.touches.join(', ')}`)
  if (entry.toolNames && entry.toolNames.length) lines.push(`它注册的工具名: ${entry.toolNames.join(', ')}`)
  if (entry.ruleVerdict) lines.push(`规则初判: ${entry.ruleVerdict.familyLabel} / ${entry.ruleVerdict.domainLabel}（依据：${entry.ruleVerdict.evidence.join('；')}）`)
  if (entry.readmeHead) lines.push(`README 开头:\n${entry.readmeHead}`)
  if (entry.remote && entry.remote.summary) {
    lines.push(`GitHub 检索到的说明（来自 ${entry.remote.source || 'GitHub'}）:\n${entry.remote.summary}`)
  }
  if (entry.usage) lines.push(`最后一次被用到: ${entry.usage.text || '没有记录'}`)
  return lines.join('\n')
}

export function buildAiPrompt(entries, locale = 'zh') {
  const anyRemote = entries.some((entry) => entry.remote && entry.remote.summary)
  const anyCode = entries.some((entry) => (entry.slots && entry.slots.length) || (entry.touches && entry.touches.length))
  const anyUsage = entries.some((entry) => entry.usage)
  const chinese = String(locale).toLowerCase().startsWith('zh')

  const intro = chinese
    ? `你是 DeepSeek Harness 客户端的插件管家。用户看不懂插件名，也不知道删掉会不会出问题。你的任务是：逐条说明这个插件到底在客户端里做什么，并把它归到一个三级分类里。

写作要求：
1. 用大白话，像跟完全不懂技术的朋友解释。不要出现「模块」「注册」「插槽」「API」这类词；必须提到时用括号补一句人话解释。
2. 每条解释 1-2 句，先说「它帮你做什么」，再说「删了会怎样」。如果删了没影响，就直说「删了没影响」；如果删了某个界面会消失或某个功能会失灵，必须说清楚是哪一个。
3. 不要复述包名，不要写「这是一个插件」。直接说人话。
4. 只能根据给你的证据推理，证据不足时就说「看不出来它具体做什么，但……」并给出你唯一的猜测依据。不要编造功能。`
    : `You are the plugin steward of the DeepSeek Harness desktop client. The user cannot tell what a plugin does or whether deleting it is safe. For every row: say what it does for the user, in plain words, and place it in a three-level classification.

Rules:
1. Plain language, as if explaining to a friend who does not write code. Avoid "module", "register", "slot", "API"; if unavoidable, gloss it.
2. One or two sentences each: first what it does for you, then what breaks if it is removed. If nothing breaks, say "removing it changes nothing".
3. Do not restate the package name or say "this is a plugin".
4. Reason only from the evidence given. When it is thin, say so and name the single clue you used. Never invent features.`

  const schema = chinese
    ? `只输出一个 JSON 数组，不要解释文字，不要代码围栏。数组每一项形如：
{"key":"<原样返回的 key>","category":"<二级分类 id，必须来自下面的列表>","what":"<它帮你做什么，1 句大白话>","remove":"<删了会怎样，1 句大白话>","why":"<你为什么这么判断，20 字以内>"}`
    : `Output only a JSON array, no prose, no code fences. Each item:
{"key":"<the key, verbatim>","category":"<level-2 id from the list below>","what":"<what it does for the user, one plain sentence>","remove":"<what breaks if removed, one plain sentence>","why":"<your reason, under 20 words>"}`

  const evidenceNote = chinese
    ? `注意：字段只在有证据时才会出现。某个字段没出现，表示「没查到」，不代表「这个插件没有这项」。`
    : `Note: a field appears only when evidence exists. A missing field means "not found", not "this plugin has none".`

  return [
    intro,
    '',
    evidenceNote,
    '',
    chinese ? '可选的一级/二级分类（category 只能填二级 id）:' : 'Allowed level-1/level-2 categories (category must be a level-2 id):',
    buildCategoryLines(entries),
    '',
    chinese ? '待分析的插件：' : 'Rows to analyse:',
    '',
    entries.map((entry, index) => `### ${index + 1}\n${evidenceBlock(entry, locale)}`).join('\n\n'),
    '',
    schema,
  ].join('\n')
}

function buildCategoryLines(entries) {
  const first = entries.find((entry) => entry.catalog) || entries[0]
  const catalog = first && first.catalog ? first.catalog : null
  if (!catalog) return '- (no catalog)'
  const lines = []
  for (const family of catalog.families || []) {
    lines.push(`- ${family.id}  «${family.label}» — ${family.hint}`)
    for (const domain of (catalog.domains || []).filter((d) => d.family === family.id)) {
      lines.push(`    · ${domain.id}  «${domain.label}»`)
    }
  }
  return lines.join('\n')
}

/**
 * Parse the model's JSON array.
 *
 * Fence markers are stripped, the outermost brackets are sliced out, and every
 * item is validated against the keys and categories that were actually offered.
 * An item that fails is dropped: a half-trusted verdict is worse than the rule
 * pass's own answer, which is still there.
 */
export function parseAiVerdicts(text, allowedKeys, allowedCategories) {
  if (!text || typeof text !== 'string') return []
  const cleaned = text.replace(/```[a-zA-Z]*/g, '')
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let parsed
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const key = typeof item.key === 'string' ? item.key : null
    if (!key || !allowedKeys.has(key)) continue
    const category = typeof item.category === 'string' ? item.category.trim() : null
    if (!category || !allowedCategories.has(category)) continue
    out.push({
      key,
      category,
      what: clip(item.what, 240),
      remove: clip(item.remove, 240),
      why: clip(item.why, 120),
    })
  }
  return out
}

function clip(value, max) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Run the model over the given rows. Chunked so one huge profile does not
 * produce a prompt the provider rejects, and so a partial failure still
 * returns the rows that worked.
 */
export async function aiAnalyse(ctx, entries, options = {}) {
  const stats = {
    available: false,
    provider: null,
    model: null,
    reason: null,
    candidates: entries.length,
    asked: 0,
    found: 0,
    failed: 0,
    withCode: entries.filter((entry) => (entry.slots && entry.slots.length) || (entry.touches && entry.touches.length)).length,
    withRemote: entries.filter((entry) => entry.remote && entry.remote.summary).length,
    inputTokens: 0,
    outputTokens: 0,
  }
  const llm = serviceOf(ctx, 'llm')
  if (!llm || typeof llm.prepareCall !== 'function') {
    stats.reason = '这个客户端版本没有可用的模型服务'
    return { verdicts: [], stats }
  }
  const target = resolveCallTarget(ctx)
  if (!target) {
    stats.reason = '没有找到可调用的模型，请先在设置里选一个模型'
    return { verdicts: [], stats }
  }
  stats.available = true
  stats.provider = target.provider
  stats.model = target.model

  const locale = options.locale || 'zh'
  const allowedCategories = new Set((options.categories || []).map((d) => d.id))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

  const results = []
  try {
    for (let offset = 0; offset < entries.length; offset += AI_MAX_ROWS) {
      const batch = entries.slice(offset, offset + AI_MAX_ROWS)
      if (batch.length === 0) continue
      const allowedKeys = new Set(batch.map((entry) => entry.key))
      const prompt = buildAiPrompt(batch, locale)
      stats.asked += batch.length
      const reply = await callModel(ctx, target, prompt, controller.signal)
      if (reply.usage) {
        stats.inputTokens += reply.usage.inputTokens || 0
        stats.outputTokens += reply.usage.outputTokens || 0
      }
      if (reply.failure) {
        stats.failed += batch.length
        stats.reason = reply.failure
        continue
      }
      const verdicts = parseAiVerdicts(reply.text, allowedKeys, allowedCategories)
      if (verdicts.length === 0) {
        stats.failed += batch.length
        stats.reason = stats.reason || '模型返回的内容不是约定的 JSON，已丢弃'
        continue
      }
      stats.found += verdicts.length
      results.push(...verdicts)
    }
  } finally {
    clearTimeout(timer)
  }
  return { verdicts: results, stats }
}
