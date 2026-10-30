/**
 * Remote evidence: what does this package do, according to the internet?
 *
 * The local code tells you what a plugin *registers*; it does not tell you why
 * a user would want it. For a package with a one-line description and no
 * README on disk (the usual case for a scoped package inside an app archive),
 * the project's GitHub README is the only real source.
 *
 * Three rules keep this from being slow or rude:
 *
 *  - a disk cache with a TTL, so opening the page twice does not re-hit GitHub;
 *  - a global time budget and a concurrency cap, so a 200-row profile cannot
 *    turn into 200 requests;
 *  - a hard cap on how many rows get looked up at all, with the rest reported
 *    as "not looked up" rather than silently missing.
 *
 * Everything returned is *evidence*, labelled with where it came from, and the
 * UI shows that label. A README from a different project with a similar name
 * is a real failure mode, so the package-name check happens before the README
 * is trusted.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { storageDir, errorText, shortName } from './env.js'

const REMOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REMOTE_TIMEOUT_MS = 6000
const REMOTE_BUDGET_MS = 22000
const REMOTE_CONCURRENCY = 4
const REMOTE_MAX_LOOKUPS = 32
const REMOTE_README_CHARS = 4000

function cachePath() {
  return join(storageDir(), 'remote-cache.json')
}

export function readRemoteCache() {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8'))
    if (raw && typeof raw === 'object' && raw.entries) return raw
  } catch {
    // no cache yet
  }
  return { version: 1, entries: {} }
}

export function writeRemoteCache(cache) {
  try {
    mkdirSync(storageDir(), { recursive: true })
    writeFileSync(cachePath(), JSON.stringify(cache, null, 2), 'utf8')
  } catch {
    // A cache that cannot be written is not a failure; the page still works.
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REMOTE_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'dsh-plugin-studio',
        accept: options.accept || 'application/vnd.github+json',
        ...(options.headers || {}),
      },
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function tryJson(url, timeoutMs) {
  try {
    const response = await fetchWithTimeout(url, {}, timeoutMs)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function tryText(url, timeoutMs) {
  try {
    const response = await fetchWithTimeout(url, { accept: 'text/plain' }, timeoutMs)
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

/** `@scope/name` -> `scope/name` is not a repo; search by the bare name. */
function searchTerms(name) {
  const base = shortName(name).replace(/^dsh-/, '')
  const terms = [shortName(name)]
  if (base && base !== shortName(name)) terms.push(base)
  return terms.filter(Boolean)
}

/**
 * Find the repository for a package by searching GitHub for its name and then
 * confirming the hit mentions the exact package name. Without that check a
 * package called `dsh-plugin-rea` happily matches an unrelated `rea` repo.
 */
export async function searchGithubByName(name, signal) {
  const terms = searchTerms(name)
  for (const term of terms) {
    const query = encodeURIComponent(`${term} in:name,description,readme`)
    const result = await tryJson(`https://api.github.com/search/repositories?q=${query}&per_page=5`)
    if (!result || !Array.isArray(result.items)) continue
    for (const item of result.items) {
      if (!item || !item.full_name) continue
      const haystack = `${item.full_name} ${item.description || ''}`.toLowerCase()
      if (haystack.includes(shortName(name).toLowerCase())) {
        return {
          repo: item.full_name,
          url: item.html_url,
          description: item.description || null,
          stars: item.stargazers_count || 0,
          source: 'github-search',
        }
      }
    }
  }
  return null
}

/** Try the usual README filenames on the default branch. */
export async function fetchRepoReadme(repo, signal) {
  const candidates = ['README.md', 'readme.md', 'README.zh-CN.md', 'README.zh.md']
  for (const file of candidates) {
    const text = await tryText(`https://raw.githubusercontent.com/${repo}/HEAD/${file}`)
    if (text && text.trim()) return text
  }
  return null
}

/** Keep the part of a README a human would read: the opening, minus badges. */
export function readmeLede(text, max = REMOTE_README_CHARS) {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  const kept = []
  let seenTitle = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (kept.length > 0) kept.push('')
      continue
    }
    if (/^\[!\[/.test(trimmed) || /^!\[/.test(trimmed) || /^<img/i.test(trimmed) || /^<p align/i.test(trimmed)) continue
    if (/^<\/?[a-z]/i.test(trimmed)) continue
    if (!seenTitle && /^#\s+/.test(trimmed)) {
      seenTitle = true
      kept.push(trimmed)
      continue
    }
    kept.push(trimmed)
    if (kept.join('\n').length > max) break
  }
  const out = kept.join('\n').trim()
  return out.length > max ? `${out.slice(0, max)}…` : out || null
}

/**
 * Look one package up: cache first, then a name search plus README fetch.
 * The returned object always says where it came from, including "nothing
 * found", so the UI can distinguish "no README exists" from "we never asked".
 */
export async function lookupRemote(name, cache, options = {}) {
  const now = Date.now()
  const cached = cache.entries[name]
  if (cached && now - (cached.at || 0) < REMOTE_TTL_MS) {
    return { ...cached.value, cached: true }
  }
  const found = await searchGithubByName(name, options.signal)
  if (!found) {
    const value = { found: false, reason: 'GitHub 上没有找到同名的项目' }
    cache.entries[name] = { at: now, value }
    return value
  }
  const readme = await fetchRepoReadme(found.repo, options.signal)
  const value = {
    found: true,
    repo: found.repo,
    url: found.url,
    stars: found.stars,
    description: found.description,
    summary: readmeLede(readme),
    source: found.source,
  }
  cache.entries[name] = { at: now, value }
  return value
}

/**
 * Enrich a set of rows. `wanted` is the list of package names to look up; the
 * caller decides the order (least-documented first is the useful order).
 */
export async function enrichRemote(names, options = {}) {
  const cache = readRemoteCache()
  const stats = { asked: 0, found: 0, missing: 0, cached: 0, skipped: 0, errors: [] }
  const unique = [...new Set(names.filter(Boolean))].slice(0, REMOTE_MAX_LOOKUPS)
  stats.skipped = Math.max(0, names.length - unique.length)
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REMOTE_BUDGET_MS)
  const out = {}

  const queue = [...unique]
  const workers = new Array(Math.min(REMOTE_CONCURRENCY, queue.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      if (Date.now() - started > REMOTE_BUDGET_MS) return
      const name = queue.shift()
      if (!name) return
      stats.asked += 1
      try {
        const value = await lookupRemote(name, cache, { signal: controller.signal })
        out[name] = value
        if (value.cached) stats.cached += 1
        if (value.found) stats.found += 1
        else stats.missing += 1
      } catch (err) {
        stats.errors.push(`${name}: ${errorText(err)}`)
        out[name] = { found: false, reason: errorText(err) }
      }
    }
  })
  try {
    await Promise.all(workers)
  } finally {
    clearTimeout(timer)
  }
  writeRemoteCache(cache)
  return { evidence: out, stats }
}

/** Which rows are worth a lookup: no description, or a very thin one. */
export function needsRemote(row) {
  if (!row || row.official) return false
  const description = String(row.description || '').trim()
  return description.length < 40
}

export function remoteCacheExists() {
  return existsSync(cachePath())
}
