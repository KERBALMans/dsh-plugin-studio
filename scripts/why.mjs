/**
 * Why did a row land in `other`? Print the facts the classifier actually saw.
 *
 * Run: node scripts/why.mjs [nameFragment]
 */
import { rowFacts, classifyFacts } from '../lib/classify.js'
import { setProfileDir } from '../lib/env.js'

const PROFILE = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'
setProfileDir(PROFILE)

const needle = process.argv[2] || 'dsh-base'

const res = await fetch('http://127.0.0.1:53494/api/dsh-plugin-studio/inventory')
const data = await res.json()
const rows = (data.rows || []).filter((r) => String(r.name).includes(needle))
if (!rows.length) {
  console.log('no row matched', needle)
  process.exit(0)
}
for (const row of rows) {
  const facts = rowFacts(row, { dir: PROFILE })
  const verdict = classifyFacts(facts)
  console.log('---', row.name)
  console.log('  row.description :', JSON.stringify(row.description))
  console.log('  row.title       :', JSON.stringify(row.title))
  console.log('  facts.title     :', JSON.stringify(facts.title))
  console.log('  facts.descript  :', JSON.stringify(facts.description))
  console.log('  facts.purpose   :', JSON.stringify(facts.purpose))
  console.log('  facts.official  :', facts.official, ' installed:', row.installed, ' availability:', row.availability)
  console.log('  verdict         :', verdict.family, '/', verdict.domain, '/', verdict.confidence)
  console.log('  evidence        :', JSON.stringify(verdict.evidence))
}
