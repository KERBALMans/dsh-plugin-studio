/**
 * Resolve the profile directory the suites run against.
 *
 * The suites originally hard-coded one machine's desktop profile, which meant
 * they could only pass on that machine. CI has no such profile, and a fresh
 * clone should not need one either.
 *
 * Resolution order:
 *
 *  1. `DSH_TEST_PROFILE` — set this to point the suites at a real profile.
 *  2. The desktop profile, if it exists (the normal local case, so local runs
 *     still test against real data).
 *  3. `fixtures/profile/` — a small synthetic profile committed to the repo,
 *     with enough plugins to exercise every classification family.
 *
 * The synthetic profile is a real directory on disk with a real `package.json`
 * and real `node_modules/<name>/package.json` files, because the code path
 * under test is `fileInventory()` — a function that reads exactly those files.
 * A stubbed object would test nothing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = new URL('.', import.meta.url)

export const SYNTHETIC = fileURLToPath(new URL('../fixtures/profile', HERE))

function desktopProfile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidate = join(home, 'profiles', process.env.DSH_PROFILE || 'desktop')
  return existsSync(join(candidate, 'package.json')) ? candidate : null
}

/**
 * Every dependency the profile declares must have a `package.json` on disk.
 *
 * Without this the suites still "pass" on a fresh clone: `fileInventory()` falls
 * back to reading the declared names, finds no metadata, and the classifier
 * files those rows under `other`. That surfaced as three unrelated assertions
 * failing with a classification message, which pointed at the classifier
 * instead of at the missing test data. Fail here, where the cause is obvious.
 *
 * This is exactly what happened when `.gitignore`'s `node_modules/` rule
 * swallowed `fixtures/profile/node_modules/`: the suite passed locally (a real
 * profile existed) and failed in CI (a fresh clone had nothing).
 */
function assertComplete(profile) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  } catch {
    return
  }
  const declared = Object.keys(manifest.dependencies || {})
  const missing = declared.filter((name) => !existsSync(join(profile, 'node_modules', name, 'package.json')))
  if (missing.length > 0) {
    const lines = [
      `测试 profile 不完整：${profile}`,
      `  package.json 声明了 ${declared.length} 个依赖，其中 ${missing.length} 个在 node_modules/ 下不存在：`,
      ...missing.map((name) => `    - ${name}`),
      '  这通常意味着 fixtures/profile/node_modules/ 没被提交（检查 .gitignore）。',
      '  不修的话，分类器读不到描述，会把它们判进 other，让无关的断言先失败。',
    ]
    throw new Error(lines.join('\n'))
  }
}

export function resolveProfile() {
  const explicit = process.env.DSH_TEST_PROFILE
  if (explicit && existsSync(join(explicit, 'package.json'))) return explicit
  const profile = desktopProfile() || SYNTHETIC
  assertComplete(profile)
  return profile
}

/** True when the suites are running against the committed synthetic profile. */
export const USING_SYNTHETIC = resolveProfile() === SYNTHETIC
