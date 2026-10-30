/**
 * Headless smoke test for the Host half.
 *
 * The Host route is behind `connection.admit`, so it cannot be curled from a
 * shell — 401 is the expected answer. That leaves two options: click around in
 * the GUI, or drive the modules directly with a fake ctx. This is the second
 * one, and it is the faster loop: it exercises the same functions the routes
 * call, against the real profile on this machine.
 *
 * Run: node scripts/smoke.mjs
 */
import { setProfileDir, profileDir, storageDir } from '../lib/env.js'
import { capabilityReport } from '../lib/caps.js'
import { inventory } from '../lib/inventory.js'
import { FAMILIES, DOMAINS, classifyAll, buildTree, codeEvidence } from '../lib/classify.js'
import { collectUsage, lastUsedFor, relativeAge } from '../lib/usage.js'
import { skillInventory, skillRoots } from '../lib/skills.js'

const PROFILE = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'
setProfileDir(PROFILE)

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`)
}

/* ------------------------------------------------------------------ */

section('environment')
check('profileDir 指向 desktop profile', profileDir() === PROFILE, profileDir())
check('storageDir 在 storages 下', storageDir().includes('dsh-plugin-studio'), storageDir())

const fakeCtx = {
  get(name) {
    if (name === 'profileContext') return { dir: PROFILE }
    return undefined
  },
}

section('capabilities')
const report = capabilityReport(fakeCtx)
console.log(`  degraded=${report.degraded}`)
console.log(`  missing=${JSON.stringify(report.missing)}`)
check('capabilityReport 返回 caps 对象', !!report.caps && typeof report.caps === 'object')
check('profileContext 被探测到', report.caps.profileContext === true)

section('plugin inventory (file fallback, no pluginManager in this ctx)')
const inv = await inventory(fakeCtx)
console.log(`  source=${inv.source} bundles=${inv.bundles.length} warnings=${inv.warnings.length}`)
for (const warning of inv.warnings) console.log(`    warn: ${warning}`)
check('至少读到一个插件', inv.bundles.length > 0, String(inv.bundles.length))
check('每个 bundle 都有 name', inv.bundles.every((bundle) => typeof bundle.name === 'string' && bundle.name.length > 0))
check('每个 bundle 都有 key', inv.bundles.every((bundle) => typeof bundle.key === 'string' && bundle.key.startsWith('bundle:')))

section('classification')
const usage = await collectUsage(fakeCtx, {})
console.log(`  usage source=${usage.source} sessions=${usage.sessions} tools=${Object.keys(usage.tools).length} mentions=${Object.keys(usage.mentions).length}`)
for (const error of (usage.errors || []).slice(0, 4)) console.log(`    note: ${error}`)
check('使用记录有内容', usage.sessions > 0 || Object.keys(usage.tools).length > 0)

const rows = inv.bundles
const verdicts = classifyAll(rows, { profileDir: PROFILE, usage })
let classified = 0
let unclear = 0
const familyCount = new Map()
const domainCount = new Map()
for (const row of rows) {
  const verdict = verdicts.get(row.key)
  if (verdict && verdict.family && verdict.domain) classified += 1
  if (verdict && verdict.family === 'other') unclear += 1
  if (verdict) {
    familyCount.set(verdict.familyLabel, (familyCount.get(verdict.familyLabel) || 0) + 1)
    domainCount.set(verdict.domainLabel, (domainCount.get(verdict.domainLabel) || 0) + 1)
  }
}
console.log(`  classified=${classified}/${rows.length} unclear=${unclear}`)
console.log('  families:')
for (const [label, count] of [...familyCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${label}: ${count}`)
}
console.log('  domains:')
for (const [label, count] of [...domainCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${label}: ${count}`)
}
check('每一行都拿到了一级+二级分类', classified === rows.length, `${classified}/${rows.length}`)
check('没有落到「其它与待确认」的行', unclear === 0, `${unclear} 行落在 other`)

section('tree')
const finalVerdicts = new Map()
for (const row of rows) {
  const verdict = verdicts.get(row.key)
  finalVerdicts.set(row.key, { ...verdict, leafLabel: row.title || row.name })
}
const tree = buildTree(rows, finalVerdicts)
const treeCount = tree.reduce((sum, family) => sum + family.domains.reduce((inner, domain) => inner + domain.leaves.length, 0), 0)
check('树的叶子数等于行数', treeCount === rows.length, `${treeCount} vs ${rows.length}`)
check('树的每个一级节点都有二级节点', tree.every((family) => family.domains.length > 0))
console.log(`  families=${tree.length} domains=${tree.reduce((sum, family) => sum + family.domains.length, 0)}`)

section('usage attribution')
// Whether any real plugin happens to have been used recently is the user's
// business, not a property of the code. Test the rule against a synthetic
// record instead: a tool call is proof of use, a bare name mention is not.
const NOW = Date.now()
const synthetic = {
  tools: { 'demo_tool': NOW - 60_000 },
  mentions: { 'demo-plugin': NOW - 1_000 },
}
const strong = lastUsedFor({ name: 'demo-plugin', short: 'demo-plugin', toolNames: ['demo_tool'] }, synthetic)
check('工具调用命中算真实使用', strong.time === NOW - 60_000 && strong.strong === true, JSON.stringify(strong))
check('真实使用带 via 说明', typeof strong.via === 'string' && strong.via.includes('demo_tool'), String(strong.via))
const weak = lastUsedFor({ name: 'demo-plugin', short: 'demo-plugin', toolNames: [] }, synthetic)
check('只有名字被提到不算使用', weak.time === null, JSON.stringify(weak))
check('被提到的时间单独给出', weak.weak === NOW - 1_000, String(weak.weak))
const never = lastUsedFor({ name: 'nothing-here', short: 'nothing-here', toolNames: [] }, synthetic)
check('完全没出现过的返回空', never.time === null && !never.weak, JSON.stringify(never))

let attributed = 0
const samples = []
for (const row of rows) {
  const code = codeEvidence(row.name, PROFILE)
  const used = lastUsedFor({ name: row.name, short: row.name, toolNames: code.toolNames }, usage)
  if (used.time) {
    attributed += 1
    if (samples.length < 6) samples.push(`${row.name} -> ${relativeAge(used.time)} (${used.via})`)
  }
}
console.log(`  本机真实归属 attributed=${attributed}/${rows.length}`)
for (const sample of samples) console.log(`    ${sample}`)

section('skills')
const skills = await skillInventory(fakeCtx, { cwd: process.cwd() })
console.log(`  rows=${skills.rows.length}`)
console.log(`  roots=${skillRoots(process.cwd()).map((root) => root.path).join(' | ')}`)
for (const warning of skills.warnings) console.log(`    warn: ${warning}`)
for (const row of skills.rows.slice(0, 6)) {
  console.log(`    ${row.name} | removable=${row.removable} | dir=${row.dir}`)
}
check('技能清单返回数组', Array.isArray(skills.rows))

section('taxonomy sanity')
check('一级分类有 8 个', FAMILIES.length === 8, String(FAMILIES.length))
for (const family of FAMILIES) {
  const domains = DOMAINS.filter((domain) => domain.family === family.id)
  check(`  ${family.label} 至少有一个二级分类`, domains.length > 0, String(domains.length))
  const catchAll = domains[domains.length - 1]
  let total = true
  try {
    total = catchAll.match({ slots: [], touches: [], text: '', kind: 'plugin', toolNames: [] }) === true
  } catch (err) {
    total = `throw: ${err.message}`
  }
  check(`  ${family.label} 的兜底项总是匹配`, total === true, String(total))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
