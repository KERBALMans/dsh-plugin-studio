/**
 * A durable memory of "last used".
 *
 * Session logs are not an archive. `dsh-session-clean` deletes whole sessions
 * on request, and the Host may prune old ones; a deleted session takes every
 * `tool/call` inside it with it. Recomputing usage from whatever logs survive
 * therefore made rows fall back to "never used" overnight — the plugin looked
 * broken when it was only forgetful.
 *
 * This ledger records the newest time ever observed for a row, so the column
 * only ever moves forward. It stores row names, not tool names: attribution can
 * change between versions, but a row that was used yesterday was used
 * yesterday.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { storageDir } from './env.js'

const LEDGER_VERSION = 1

export function ledgerPath() {
  return join(storageDir(), 'usage-ledger.json')
}

export function readLedger() {
  const empty = { version: LEDGER_VERSION, rows: {}, runs: {} }
  try {
    const raw = JSON.parse(readFileSync(ledgerPath(), 'utf8'))
    if (!raw || raw.version !== LEDGER_VERSION || !raw.rows || typeof raw.rows !== 'object') return empty
    return {
      version: LEDGER_VERSION,
      rows: raw.rows,
      runs: raw.runs && typeof raw.runs === 'object' ? raw.runs : {},
    }
  } catch {
    return empty
  }
}

/**
 * Keep the newest observation per row.
 *
 * @param ledger - value from `readLedger()`, mutated in place
 * @param entries - `[{ name, time, via }]`
 * @returns true when something changed and the file should be rewritten
 */
export function mergeLedger(ledger, entries) {
  let changed = false
  for (const entry of entries || []) {
    if (!entry || !entry.name || !entry.time) continue
    const prev = ledger.rows[entry.name]
    if (prev && prev.time >= entry.time) continue
    ledger.rows[entry.name] = {
      time: entry.time,
      via: entry.via || (prev && prev.via) || null,
    }
    changed = true
  }
  return changed
}

/**
 * Keep the newest "last active" observation per row.
 *
 * Kept apart from `rows` on purpose: being active is weaker evidence than
 * being used, and a run observed at 10:00 must never overwrite a real tool call
 * from 09:00. Host logs also rotate, so without this the column would forget.
 */
export function mergeRuns(ledger, entries) {
  let changed = false
  for (const entry of entries || []) {
    if (!entry || !entry.name || !entry.time) continue
    const prev = ledger.runs[entry.name]
    if (prev && prev.time >= entry.time) continue
    ledger.runs[entry.name] = { time: entry.time }
    changed = true
  }
  return changed
}

export function writeLedger(ledger) {
  try {
    const file = ledgerPath()
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(ledger))
  } catch {
    // A read-only profile must not break the page; the next run retries.
  }
}
