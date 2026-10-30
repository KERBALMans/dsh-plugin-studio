/**
 * Environment, path and HTTP helpers shared by every Host-side module.
 *
 * Nothing here talks to the Harness except `serviceOf` / `whenService`, which
 * exist because the same Service is spelled two ways across builds (`ctx.get`
 * and a plain property) and because several services (webServer, tools,
 * skills) mount *after* this plugin's `apply` runs.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PLUGIN_ID = 'dsh-plugin-studio'
export const PLUGIN_VERSION = '1.0.0'
export const API_PREFIX = '/api/dsh-plugin-studio'
export const API_VERSION = 3
export const BODY_LIMIT = 16 * 1024 * 1024

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Where the running profile lives.
 *
 * The environment fallback is a guess, and on the desktop client it guesses
 * wrong: the host is launched with the profile directory as an *argument*, so
 * `DSH_PROFILE_DIR` is unset in the host process. `ctx.profileContext.dir` is
 * authoritative, so `apply` records it through `setProfileDir` on the way in.
 */
let profileDirOverride = null

export function setProfileDir(dir) {
  if (typeof dir === 'string' && dir.trim()) profileDirOverride = dir.trim()
}

export function profileDir() {
  if (profileDirOverride) return profileDirOverride
  return process.env.DSH_PROFILE_DIR || join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'default')
}

export function storageDir() {
  return join(dshHome(), 'storages', PLUGIN_ID)
}

export function runtimeVersion() {
  const env = process.env.DSH_VERSION || process.env.DSH_CLIENT_VERSION
  if (env) return String(env)
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(profileDir(), 'package.json'), 'utf8'))
  } catch {
    return null
  }
  if (pkg.dsh && typeof pkg.dsh.version === 'string') return pkg.dsh.version
  const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
  for (const [name, spec] of Object.entries(deps)) {
    if (/^@deepseek-ai\/dsh-/.test(name) && /^\d+\.\d+\.\d+/.test(String(spec))) return String(spec)
  }
  return null
}

/** A spec that only resolves on the machine that wrote it. */
export function isLocalSpec(spec) {
  const value = String(spec || '')
  if (value.startsWith('link:') || value.startsWith('file:')) return true
  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('.\\') || value.startsWith('..\\')) return true
  if (value.startsWith('/') || value.startsWith('\\')) return true
  return /^[A-Za-z]:[\\/]/.test(value)
}

/**
 * The package a Loader entry belongs to: `@scope/pkg/sub` -> `@scope/pkg`.
 * Returns null for entries that are not packages at all (`cordis:include`).
 */
export function packageNameOf(moduleName) {
  const value = String(moduleName || '').trim()
  if (!value || value.includes(':')) return null
  const parts = value.split('/').filter(Boolean)
  if (parts.length === 0) return null
  return value.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** `@scope/pkg` -> `pkg`; also splits `-`/`_` into words for the classifier. */
export function shortName(name) {
  const value = String(name || '')
  const at = value.lastIndexOf('/')
  return at >= 0 ? value.slice(at + 1) : value
}

export function sanitizeFileName(name) {
  const base = String(name || 'pack').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80)
  return base || 'pack'
}

export function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求内容过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Accepts either the cordis accessor or a plain property. */
export function serviceOf(ctx, name) {
  if (!ctx) return undefined
  let value
  try {
    if (typeof ctx.get === 'function') value = ctx.get(name)
  } catch {
    value = undefined
  }
  if (value === undefined || value === null) {
    try {
      value = ctx[name]
    } catch {
      value = undefined
    }
  }
  return value === null ? undefined : value
}

/**
 * Run `cb` once `name` is available. `ctx.inject` keeps the plugin dormant
 * instead of throwing when a profile does not ship the service at all, which
 * is exactly what an older Harness build looks like.
 */
export function whenService(ctx, name, cb) {
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject([name], (childCtx) => cb(serviceOf(childCtx, name), childCtx))
      return
    } catch {
      // fall through to the direct read below
    }
  }
  const direct = serviceOf(ctx, name)
  if (direct) cb(direct, ctx)
}

export function textOf(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.zh || value.en || Object.values(value)[0] || null
  return null
}

export function describeMeta(meta) {
  if (!meta || typeof meta !== 'object') return null
  return { title: textOf(meta.title), description: textOf(meta.description), icon: meta.icon || null }
}

export function errorText(err) {
  if (!err) return 'unknown error'
  if (typeof err === 'string') return err
  return err.message || err.code || String(err)
}
