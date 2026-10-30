/**
 * Removal.
 *
 * Deleting a plugin is the one irreversible thing this page does, so it is
 * built to answer three questions before it acts, and to report the fourth
 * after:
 *
 *  1. *Can this be removed at all?* Official packages inside the app archive
 *     and `link:` installs whose bytes live elsewhere are refused here, with
 *     the reason attached, rather than failing halfway through.
 *  2. *What else does it take with it?* A bundle owns several Loader rows; the
 *     response lists them so the confirmation dialog can show the real blast
 *     radius instead of the package name alone.
 *  3. *Does the client need a restart?* `ChangeResult.application` answers it:
 *     `restart-required` with a `restartReason`. That is the only honest source
 *     for the "restart the client" notice — guessing from the plugin kind
 *     produces both false alarms and silent no-ops.
 *
 * Everything goes through `pluginManager`. This module never edits the
 * profile's `package.json`, `cordis.patch.yml`, or `node_modules` directly: the
 * manager owns those files and rewrites them transactionally.
 */
import { serviceOf, errorText } from './env.js'

const RESTART_TEXT = {
  'no-hmr': '这个插件没有热更新能力，需要手动重启客户端才会彻底消失。',
  'package-moved': '插件文件已被移动，重启客户端后才会重新加载插件列表。',
  'host-module': '插件运行在宿主进程里，重启客户端后才会释放。',
  'unmanaged-plugin': '这个插件不在管理器管辖范围内，重启客户端后生效。',
  'module-comparison': '模块比对结果需要重启客户端才能确认。',
}

export function restartNotice(result) {
  if (!result || result.application !== 'restart-required') return null
  const reason = result.restartReason || null
  return {
    required: true,
    reason,
    text: RESTART_TEXT[reason] || '改动已写入，需要手动重启客户端才会完全生效。',
  }
}

/** Why a row cannot be removed, or null when it can. */
export function removalBlocked(row) {
  if (!row) return '找不到这个插件'
  if (row.kind === 'skill') {
    if (!row.dir) return '这个技能由内置包提供，磁盘上没有可删除的目录'
    if (!row.removable) return '这个来源的技能不可删除'
    return null
  }
  if (row.readOnlyReason) return `管理器标记为只读：${row.readOnlyReason}`
  if (row.availability !== 'profile') {
    return row.availability === 'installation' ? '这是官方内置包，删不掉（也不该删）' : '这个包不在当前配置里'
  }
  if (row.removable === false) return '管理器不允许删除这个包'
  return null
}

/**
 * Remove one bundle. Returns a normalised result:
 * `{ name, ok, application, restart, rows, error, warnings }`.
 */
export async function removeBundle(ctx, bundle) {
  const blocked = removalBlocked(bundle)
  if (blocked) return { name: bundle && bundle.name, ok: false, error: blocked, restart: null }
  const pm = serviceOf(ctx, 'pluginManager')
  if (!pm || typeof pm.removeBundle !== 'function') {
    return { name: bundle.name, ok: false, error: '这个客户端版本不支持在界面里删除插件', restart: null }
  }
  try {
    const result = await pm.removeBundle(bundle.name)
    const restart = restartNotice(result)
    const ok = !!result && (result.application === 'applied' || result.application === 'restart-required' || result.application === 'overridden')
    return {
      name: bundle.name,
      ok,
      application: result ? result.application : 'failed',
      restart,
      rows: (bundle.rows || []).map((row) => row.rowId),
      warnings: result && Array.isArray(result.warnings) ? result.warnings : [],
      error: ok ? null : (result && result.error ? errorText(result.error) : '管理器没有说明原因'),
    }
  } catch (err) {
    return { name: bundle.name, ok: false, error: errorText(err), restart: null }
  }
}

/** Turn a bundle off without removing it — the reversible alternative. */
export async function disableBundle(ctx, bundle) {
  const pm = serviceOf(ctx, 'pluginManager')
  if (!pm || typeof pm.setBundleEnabled !== 'function') {
    return { name: bundle.name, ok: false, error: '这个客户端版本不支持在界面里停用插件' }
  }
  try {
    const result = await pm.setBundleEnabled(bundle.name, false)
    const restart = restartNotice(result)
    const ok = !!result && (result.application === 'applied' || result.application === 'restart-required' || result.application === 'overridden')
    return {
      name: bundle.name,
      ok,
      application: result ? result.application : 'failed',
      restart,
      warnings: result && Array.isArray(result.warnings) ? result.warnings : [],
      error: ok ? null : (result && result.error ? errorText(result.error) : '管理器没有说明原因'),
    }
  } catch (err) {
    return { name: bundle.name, ok: false, error: errorText(err) }
  }
}

/**
 * Remove several bundles.
 *
 * Sequential on purpose: each removal rewrites the profile's dependency list
 * and patch file, and two concurrent rewrites lose one of the two edits. The
 * loop also stops reporting success for rows the manager already removed in an
 * earlier iteration of the same request.
 */
export async function removeMany(ctx, bundles, options = {}) {
  const results = []
  const seen = new Set()
  for (const bundle of bundles) {
    if (!bundle || seen.has(bundle.name)) continue
    seen.add(bundle.name)
    if (options.dryRun) {
      const blocked = removalBlocked(bundle)
      results.push({ name: bundle.name, ok: !blocked, error: blocked, dryRun: true, restart: null })
      continue
    }
    results.push(await removeBundle(ctx, bundle))
  }
  const restarts = results.filter((result) => result.restart && result.restart.required)
  const failed = results.filter((result) => !result.ok)
  return {
    results,
    removed: results.filter((result) => result.ok).length,
    failed: failed.length,
    restart: restarts.length > 0
      ? {
        required: true,
        reasons: [...new Set(restarts.map((result) => result.restart.reason).filter(Boolean))],
        text: restarts[0].restart.text,
        names: restarts.map((result) => result.name),
      }
      : null,
  }
}
