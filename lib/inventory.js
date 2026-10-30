/**
 * Plugin inventory.
 *
 * Two sources, in this order:
 *
 *  1. `pluginManager.listBundles()` — the authoritative live view. A bundle is
 *     the installable unit (a package plus its patch rows); its `rows` are the
 *     Loader entries the bundle contributes.
 *  2. `fileInventory()` — a read of the profile's own `package.json` and
 *     `cordis.patch.yml`. This runs when the service is missing (an old build)
 *     or throws (a profile mid-install). Without it the page shows an empty
 *     list and the user concludes the plugin is broken.
 *
 * The two views are merged by bundle name, and every row keeps the *bundle* it
 * came from, because removal is a bundle operation while enablement is a row
 * operation — conflating them is how a UI ends up offering "delete" on a row
 * that cannot be deleted.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { profileDir, describeMeta, packageNameOf, isLocalSpec, errorText, serviceOf } from './env.js'

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function manager(ctx) {
  const pm = serviceOf(ctx, 'pluginManager')
  if (!pm || typeof pm.listBundles !== 'function') return null
  return pm
}

/**
 * Rows the profile patch disables. `cordis.patch.yml` is YAML, but the only
 * shape this plugin needs is `- id: x` followed by `disabled: true`, so a line
 * scan avoids a YAML dependency while staying correct for the files the
 * Loader actually writes.
 */
export function disabledRowIds(dir = profileDir()) {
  const path = join(dir, 'cordis.patch.yml')
  const ids = new Set()
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return ids
  }
  const lines = text.split(/\r?\n/)
  let current = null
  for (const line of lines) {
    const idMatch = /^\s*-\s+id:\s*['"]?([^'"#\s]+)['"]?/.exec(line)
    if (idMatch) {
      current = idMatch[1]
      continue
    }
    if (!current) continue
    if (/^\s*-\s+\S/.test(line)) current = null
    else if (/^\s*disabled:\s*true\b/.test(line) || /^\s*enabled:\s*false\b/.test(line)) ids.add(current)
  }
  return ids
}

/** Package metadata for a profile-installed package, or null. */
export function readPackageMeta(name, dir = profileDir()) {
  if (!name) return null
  const path = join(dir, 'node_modules', ...name.split('/'), 'package.json')
  return readJson(path)
}

/**
 * The fallback inventory. Reads the profile's dependency list and its patch
 * rows; a dependency that has no patch row is still listed (it is installed,
 * it just is not mounted), which is what "整理" needs to see.
 */
export function fileInventory(dir = profileDir()) {
  const warnings = []
  const rows = []
  const pkg = readJson(join(dir, 'package.json'))
  if (!pkg) {
    warnings.push('profile package.json 不可读')
    return { bundles: [], plugins: [], warnings, source: 'files' }
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const disabled = disabledRowIds(dir)
  const bundles = []
  for (const [name, spec] of Object.entries(deps)) {
    const meta = readPackageMeta(name, dir)
    if (!meta) {
      // An official package resolved out of the app archive has no copy here.
      bundles.push({
        name,
        version: null,
        description: null,
        title: name,
        spec: String(spec),
        enabled: true,
        installed: true,
        official: /^@deepseek-ai\//.test(name),
        optional: false,
        removable: true,
        availability: 'profile',
        source: String(spec),
        local: isLocalSpec(spec),
        rowCount: 0,
        readOnlyReason: null,
        error: null,
        overrides: [],
        rows: [],
      })
      continue
    }
    const dsh = meta.dsh && typeof meta.dsh === 'object' ? meta.dsh : {}
    const rowNames = []
    if (dsh.bundle && dsh.bundle.patch) rowNames.push(name)
    const described = describeMeta(meta.dsh && meta.dsh.meta ? meta.dsh.meta : null)
    bundles.push({
      name,
      version: typeof meta.version === 'string' ? meta.version : null,
      description: typeof meta.description === 'string' ? meta.description : null,
      title: (described && described.title) || name,
      spec: String(spec),
      enabled: true,
      installed: true,
      official: /^@deepseek-ai\//.test(name),
      optional: false,
      removable: true,
      availability: 'profile',
      source: String(spec),
      local: isLocalSpec(spec),
      rowCount: rowNames.length,
      readOnlyReason: null,
      error: null,
      overrides: [],
      rows: rowNames.map((rowName) => ({
        rowId: rowName,
        moduleName: rowName,
        entryId: `include:${rowName}`,
        enabled: !disabled.has(rowName),
      })),
    })
  }
  for (const bundle of bundles) {
    for (const row of bundle.rows) {
      if (disabled.has(row.rowId)) row.enabled = false
    }
  }
  return { bundles, plugins: pluginsFromBundles(bundles), warnings, source: 'files' }
}

export function pluginsFromBundles(bundles) {
  const plugins = []
  for (const bundle of bundles) {
    for (const row of bundle.rows || []) {
      plugins.push({
        key: `plugin:${row.entryId}`,
        kind: 'plugin',
        entryId: row.entryId,
        rowId: row.rowId,
        moduleName: row.moduleName,
        name: packageNameOf(row.moduleName) || row.moduleName,
        bundle: bundle.name,
        enabled: row.enabled !== false,
        fiberPhase: row.fiberPhase || null,
        title: bundle.title || bundle.name,
        description: bundle.description || null,
      })
    }
  }
  return plugins
}

/**
 * The live inventory, with every bundle annotated by what this process can do
 * to it. `removable` comes from the manager when it says so, and is downgraded
 * here for the two cases the manager cannot know about: an official package
 * resolved from the archive, and a package installed by a `link:` spec (whose
 * bytes live outside the profile, so "delete" would only orphan the link).
 */
export async function inventory(ctx) {
  const pm = manager(ctx)
  const warnings = []
  let bundles = []
  let source = 'pluginManager'

  if (pm) {
    try {
      const listed = await pm.listBundles()
      bundles = (Array.isArray(listed) ? listed : []).map((bundle) => {
        const meta = describeMeta(bundle.meta)
        return {
          name: String(bundle.name || ''),
          version: bundle.version || null,
          description: bundle.description || (meta && meta.description) || null,
          title: (meta && meta.title) || String(bundle.name || ''),
          spec: bundle.installTarget && bundle.installTarget.spec ? bundle.installTarget.spec : bundle.source || null,
          enabled: bundle.enabled !== false,
          installed: bundle.installed !== false,
          official: bundle.official === true,
          optional: bundle.optional === true,
          removable: bundle.removable !== false,
          availability: bundle.availability || 'profile',
          source: bundle.source || null,
          local: isLocalSpec(bundle.source || ''),
          rowCount: Array.isArray(bundle.rows) ? bundle.rows.length : 0,
          readOnlyReason: bundle.readOnlyReason || null,
          error: bundle.error ? errorText(bundle.error) : null,
          overrides: Array.isArray(bundle.overrides) ? bundle.overrides : [],
          rows: (Array.isArray(bundle.rows) ? bundle.rows : []).map((row) => ({
            rowId: row.rowId,
            moduleName: row.moduleName,
            entryId: row.entryId,
            enabled: row.enabled !== false,
            fiberPhase: row.fiberPhase || null,
          })),
        }
      })
    } catch (err) {
      warnings.push(`pluginManager.listBundles 失败，改用文件清单：${errorText(err)}`)
      const fallback = fileInventory()
      bundles = fallback.bundles
      warnings.push(...fallback.warnings)
      source = 'files'
    }
  } else {
    const fallback = fileInventory()
    bundles = fallback.bundles
    warnings.push(...fallback.warnings)
    warnings.push('pluginManager 服务不可用，已改用文件清单（只读）')
    source = 'files'
  }

  for (const bundle of bundles) {
    if (bundle.availability !== 'profile' && bundle.availability !== 'installation') bundle.removable = false
    if (bundle.installed === false) bundle.removable = false
    if (source === 'files') bundle.removable = false
    bundle.kind = 'bundle'
    bundle.key = `bundle:${bundle.name}`
  }

  const plugins = pluginsFromBundles(bundles)
  return { bundles, plugins, warnings, source, profileDir: profileDir() }
}

/** Cheap existence probe used by the "整理" pass. */
export function hasLocalPackage(name, dir = profileDir()) {
  return existsSync(join(dir, 'node_modules', ...String(name).split('/')))
}

export function listProfilePackages(dir = profileDir()) {
  const root = join(dir, 'node_modules')
  const out = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      let inner
      try {
        inner = readdirSync(join(root, entry.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of inner) {
        if (child.isDirectory()) out.push(`${entry.name}/${child.name}`)
      }
    } else {
      out.push(entry.name)
    }
  }
  return out
}
