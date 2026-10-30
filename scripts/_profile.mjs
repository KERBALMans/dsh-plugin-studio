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
import { existsSync } from 'node:fs'
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

export function resolveProfile() {
  const explicit = process.env.DSH_TEST_PROFILE
  if (explicit && existsSync(join(explicit, 'package.json'))) return explicit
  return desktopProfile() || SYNTHETIC
}

/** True when the suites are running against the committed synthetic profile. */
export const USING_SYNTHETIC = resolveProfile() === SYNTHETIC
