/**
 * Print the score table for each row, exactly as `classifyFacts` computes it.
 *
 * Guessing which signal won wastes a full test cycle per hypothesis; this shows
 * the numbers directly.
 *
 * Run: node scripts/scores.mjs [name-filter]
 */
import { setProfileDir, profileDir } from '../lib/env.js'
import { rowFacts, classifyFacts, FAMILIES } from '../lib/classify.js'
import { inventory } from '../lib/inventory.js'

const PROFILE = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'
setProfileDir(PROFILE)
const filter = process.argv[2] || ''

const ctx = { get: (name) => (name === 'profileContext' ? { dir: PROFILE } : undefined) }
const { bundles } = await inventory(ctx)

for (const row of bundles) {
  if (filter && !String(row.name).includes(filter)) continue
  const facts = rowFacts(row, { dir: profileDir() })
  const verdict = classifyFacts(facts)
  console.log(`\n${row.name}`)
  console.log(`  -> ${verdict.family}/${verdict.domain}  ${verdict.confidence}`)
  console.log(`  why: ${verdict.evidence.join(' | ')}`)
  console.log(`  purpose: ${String(facts.purpose).replace(/\s+/g, ' ').slice(0, 150)}`)
  console.log(`  touches: ${facts.touches.join(', ') || '-'}`)
  console.log(`  slots  : ${facts.slots.join(', ') || '-'}`)
  console.log(`  tools  : ${facts.toolNames.join(', ') || '-'}`)
}
