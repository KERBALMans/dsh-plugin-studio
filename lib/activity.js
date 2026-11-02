// Host-log activity.
//
// "Last used" answers *when did the user last call this plugin*. Some plugins
// never register a tool (wallpaper engine, coupon widgets) and some register
// tools that the user simply never called — for those, tool calls and session
// logs stay empty forever, and the panel has nothing to say.
//
// The host writes one JSONL file per day under `<DSH_HOME>/logs`, and every
// line carries `fields.pluginId` plus `fields.hostTime`. Reading the newest
// timestamp per plugin gives a much weaker but still useful signal: *when did
// this plugin last do something at all*. It is deliberately surfaced under a
// different label ("last active"), because a plugin logging an error at boot
// is not the same thing as the user using it.
//
// The one filter that matters: every line written during the boot window is
// noise — plugins log "registered <tool>", "config loaded", "will drive the
// installed edge" while starting up, and without a filter every row in the
// panel turns into "just now" after each restart. We therefore drop activity
// that happens within `BOOT_WINDOW_MS` of the earliest event of the same
// `runId`, which keeps genuine mid-run operations and drops the startup
// chatter.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './env.js'

const BOOT_WINDOW_MS = 120 * 1000
const MAX_FILES = 3
const MAX_FILE_BYTES = 8 * 1024 * 1024
const ENTRY_PREFIX = 'include:'

function logDir() {
  return join(dshHome(), 'logs')
}

function recentFiles(limit = MAX_FILES) {
  let names
  try {
    names = readdirSync(logDir())
  } catch {
    return []
  }
  return names
    .filter((name) => /^desktop-next-.*\.jsonl$/.test(name))
    .map((name) => {
      const path = join(logDir(), name)
      let mtime = 0
      try {
        mtime = statSync(path).mtimeMs
      } catch {
        /* ignore */
      }
      return { path, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
}

function eachEntry(file, visit) {
  let text
  try {
    if (statSync(file.path).size > MAX_FILE_BYTES) return
    text = readFileSync(file.path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    if (line.length < 2 || line.charCodeAt(0) !== 123 /* { */) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    visit(entry)
  }
}

/**
 * Latest post-boot activity per plugin id.
 *
 * Returns `Map(pluginId -> epoch ms)` with the `include:` prefix stripped, so
 * the caller can match it against inventory `entryId` / `rowId` values.
 */
export function scanActivity() {
  const files = recentFiles()
  const runStart = new Map()
  for (const file of files) {
    eachEntry(file, (entry) => {
      const time = entry.fields && entry.fields.hostTime
      if (!time || !entry.runId) return
      const seen = runStart.get(entry.runId)
      if (seen === undefined || time < seen) runStart.set(entry.runId, time)
    })
  }

  const latest = new Map()
  for (const file of files) {
    eachEntry(file, (entry) => {
      const fields = entry.fields
      if (!fields || !fields.pluginId || !fields.hostTime) return
      const start = runStart.get(entry.runId)
      if (start === undefined || fields.hostTime - start < BOOT_WINDOW_MS) return
      const id = String(fields.pluginId).split(ENTRY_PREFIX).join('')
      const seen = latest.get(id)
      if (seen === undefined || fields.hostTime > seen) latest.set(id, fields.hostTime)
    })
  }
  return latest
}

export const ACTIVITY_BOOT_WINDOW_MS = BOOT_WINDOW_MS
