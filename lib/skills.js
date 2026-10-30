/**
 * Skill inventory and operations.
 *
 * Skills are directories with a `SKILL.md`, discovered by the Harness from a
 * handful of roots (project, user, bundled, custom providers). The `skills`
 * Service lists them but cannot delete or pack them — those are filesystem
 * operations on directories the Service only reads — so this module pairs the
 * Service's authoritative list with the directories it points at.
 *
 * The pairing rule: `skills.list()` is the truth about what the Agent can
 * *use*; a directory scan is the truth about what is on *disk*. A skill the
 * Service lists without a directory (a bundled one inside the app archive) is
 * shown but not removable, and a directory the Service does not list is shown
 * as "未注册" so the user can see a broken skill instead of silently losing it.
 */
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { dshHome, serviceOf, errorText, sanitizeFileName } from './env.js'

const SKILL_FILE = 'SKILL.md'
const MAX_SKILL_BYTES = 512 * 1024

/**
 * Roots the Harness scans, in the order the Agent sees them. `custom` entries
 * are provider-specific and cannot be guessed; the scan reports what it found
 * rather than what it expected.
 */
export function skillRoots(cwd) {
  const home = dshHome()
  const roots = [
    { path: join(home, 'skills'), scope: 'user-dsh', label: '用户级（~/.dsh/skills）', removable: true },
    { path: join(home, 'agents', 'skills'), scope: 'user-agents', label: '用户级（~/.dsh/agents/skills）', removable: true },
  ]
  if (cwd) {
    roots.push(
      { path: join(cwd, '.dsh', 'skills'), scope: 'project-dsh', label: '项目级（.dsh/skills）', removable: true },
      { path: join(cwd, '.agents', 'skills'), scope: 'project-agents', label: '项目级（.agents/skills）', removable: true },
    )
  }
  return roots
}

function readSkillDoc(dir) {
  const path = join(dir, SKILL_FILE)
  if (!existsSync(path)) return null
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  if (text.length > MAX_SKILL_BYTES) text = text.slice(0, MAX_SKILL_BYTES)
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const fields = {}
  if (front) {
    for (const line of front[1].split(/\r?\n/)) {
      const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
      if (!match) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      fields[match[1]] = value
    }
  }
  const body = front ? text.slice(front[0].length).trim() : text.trim()
  return { fields, body, text }
}

function dirSize(dir, budget = 4 * 1024 * 1024) {
  let total = 0
  let files = 0
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (total > budget) return
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        files += 1
        try {
          total += statSync(path).size
        } catch {
          // ignore
        }
      }
    }
  }
  walk(dir)
  return { bytes: total, files }
}

/** Every skill directory on disk, keyed by skill name. */
export function scanSkillDirs(cwd) {
  const found = new Map()
  for (const root of skillRoots(cwd)) {
    if (!existsSync(root.path)) continue
    let entries
    try {
      entries = readdirSync(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const dir = join(root.path, entry.name)
      const doc = readSkillDoc(dir)
      if (!doc) continue
      const size = dirSize(dir)
      found.set(entry.name, {
        key: `skill:${root.scope}:${entry.name}`,
        kind: 'skill',
        name: entry.name,
        dir,
        root: root.path,
        rootLabel: root.label,
        scope: root.scope,
        removable: root.removable !== false,
        title: doc.fields.name || entry.name,
        description: doc.fields.description || null,
        whenToUse: doc.fields.when_to_use || doc.fields.whenToUse || null,
        bodyHead: doc.body.slice(0, 600),
        bytes: size.bytes,
        files: size.files,
      })
    }
  }
  return found
}

/**
 * The merged view: Service list first (authoritative for what the Agent can
 * use), then any on-disk directory the Service did not report.
 */
export async function skillInventory(ctx, options = {}) {
  const warnings = []
  const cwd = options.cwd || null
  const dirs = scanSkillDirs(cwd)
  const rows = []
  const seen = new Set()
  const skills = serviceOf(ctx, 'skills')

  if (skills && typeof skills.list === 'function') {
    try {
      const listed = await skills.list(cwd ? { cwd } : {})
      for (const skill of Array.isArray(listed) ? listed : []) {
        const name = String(skill.name || '')
        if (!name) continue
        seen.add(name)
        const dir = dirs.get(name)
        const base = skill.resourceBase
        const directory = base && base.kind === 'directory' ? base.path : dir ? dir.dir : null
        rows.push({
          key: `skill:${skill.source || 'service'}:${name}`,
          kind: 'skill',
          name,
          title: name,
          description: skill.description || null,
          whenToUse: skill.whenToUse || null,
          source: skill.source || 'custom',
          provider: skill.provider || null,
          invocation: skill.invocation || { modelInvocable: true, userInvocable: true },
          path: skill.path || directory || null,
          dir: directory,
          root: dir ? dir.root : directory ? dirname(directory) : null,
          rootLabel: dir ? dir.rootLabel : '由服务提供',
          scope: skill.source || 'custom',
          removable: !!(dir && dir.removable),
          registered: true,
          bytes: dir ? dir.bytes : null,
          files: dir ? dir.files : null,
          bodyHead: dir ? dir.bodyHead : null,
          enabled: true,
        })
      }
    } catch (err) {
      warnings.push(`skills.list 失败，改用目录扫描：${errorText(err)}`)
    }
  } else {
    warnings.push('skills 服务不可用，已改用目录扫描')
  }

  for (const [name, dir] of dirs) {
    if (seen.has(name)) continue
    rows.push({
      key: dir.key,
      kind: 'skill',
      name,
      title: dir.title,
      description: dir.description,
      whenToUse: dir.whenToUse,
      source: dir.scope,
      provider: 'filesystem',
      invocation: { modelInvocable: true, userInvocable: true },
      path: dir.dir,
      dir: dir.dir,
      root: dir.root,
      rootLabel: dir.rootLabel,
      scope: dir.scope,
      removable: dir.removable,
      registered: false,
      bytes: dir.bytes,
      files: dir.files,
      bodyHead: dir.bodyHead,
      enabled: true,
    })
  }

  rows.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'))
  return { rows, warnings, roots: skillRoots(cwd) }
}

/* ------------------------------------------------------------------ */
/* mutations                                                           */
/* ------------------------------------------------------------------ */

/**
 * Delete skill directories. A skill the Service lists but cannot point at a
 * directory for is reported as `not-removable` rather than silently skipped,
 * because the user pressed a button and deserves to know why nothing happened.
 *
 * The `SKILL.md` guard is not paranoia: a mis-registered skill whose directory
 * points at, say, a workspace root would otherwise take the whole workspace
 * with it. Nothing is deleted unless it still looks like a skill.
 */
export function removeSkills(rows, options = {}) {
  const results = []
  for (const row of rows) {
    const dir = row.dir
    if (!dir || !existsSync(dir)) {
      results.push({ name: row.name, ok: false, reason: '目录不存在或由内置包提供' })
      continue
    }
    if (!row.removable) {
      results.push({ name: row.name, ok: false, reason: '这个来源的技能不可删除' })
      continue
    }
    if (!existsSync(join(dir, SKILL_FILE))) {
      results.push({ name: row.name, ok: false, reason: '目录里没有 SKILL.md，已拒绝删除' })
      continue
    }
    if (options.dryRun) {
      results.push({ name: row.name, ok: true, dryRun: true, dir })
      continue
    }
    try {
      rmSync(dir, { recursive: true, force: true })
      results.push({ name: row.name, ok: true, dir })
    } catch (err) {
      results.push({ name: row.name, ok: false, reason: errorText(err) })
    }
  }
  const failed = results.filter((result) => !result.ok)
  return {
    results,
    removed: results.filter((result) => result.ok).length,
    failed: failed.length,
    // A skill directory is re-read on the next request, so nothing here needs a
    // client restart the way a plugin module does.
    restart: null,
  }
}

export function setSkillEnabled(row, enabled) {
  const dir = row.dir
  if (!dir || !existsSync(dir)) return { ok: false, reason: '目录不存在' }
  const off = join(dir, '.disabled')
  try {
    if (enabled) {
      if (existsSync(off)) rmSync(off, { force: true })
    } else {
      writeFileSync(off, new Date().toISOString(), 'utf8')
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: errorText(err) }
  }
}

/**
 * Pack selected skills into one directory of copies plus a manifest, so the
 * result is a plain folder the user can zip or commit. Copying rather than
 * referencing is deliberate: a pack that points at the original directories
 * breaks the moment the originals are edited or deleted.
 */
export function packSkills(rows, options = {}) {
  const name = sanitizeFileName(options.name || `skills-${new Date().toISOString().slice(0, 10)}`)
  const outDir = join(options.outDir || join(dshHome(), 'storages', 'dsh-plugin-studio', 'packs'), name)
  mkdirSync(outDir, { recursive: true })
  const entries = []
  for (const row of rows) {
    if (!row.dir || !existsSync(row.dir)) {
      entries.push({ name: row.name, ok: false, reason: '目录不存在' })
      continue
    }
    const target = join(outDir, 'skills', sanitizeFileName(basename(row.dir)))
    try {
      mkdirSync(dirname(target), { recursive: true })
      cpSync(row.dir, target, { recursive: true, force: true })
      entries.push({ name: row.name, ok: true, path: target })
    } catch (err) {
      entries.push({ name: row.name, ok: false, reason: errorText(err) })
    }
  }
  const manifest = {
    format: 'dsh-skill-pack',
    version: 1,
    createdAt: new Date().toISOString(),
    skills: entries.filter((entry) => entry.ok).map((entry) => ({ name: entry.name })),
  }
  try {
    writeFileSync(join(outDir, 'skills.json'), JSON.stringify(manifest, null, 2), 'utf8')
  } catch {
    // The copies are the deliverable; a missing manifest is not fatal.
  }
  return { ok: true, dir: outDir, name, entries }
}
