/**
 * Capability probing.
 *
 * Every build of the Harness exposes a slightly different set of Service
 * methods, and a plugin that calls a missing one throws inside `apply` and
 * disappears without a word. Probing by *method existence* rather than by
 * version number is what makes one package work across 0.2.0-rc.1 through the
 * current build and whatever ships next: a version string tells you what the
 * publisher intended, a missing function tells you what this process can
 * actually do.
 */
import { serviceOf } from './env.js'

function has(target, name) {
  return !!target && typeof target[name] === 'function'
}

export function capabilities(ctx) {
  const pluginManager = serviceOf(ctx, 'pluginManager')
  const skills = serviceOf(ctx, 'skills')
  const sessionQuery = serviceOf(ctx, 'sessionQuery')
  const llm = serviceOf(ctx, 'llm')
  const webServer = serviceOf(ctx, 'webServer')
  const tools = serviceOf(ctx, 'tools')
  const web = serviceOf(ctx, 'web')
  const agentDefaultModel = serviceOf(ctx, 'agentDefaultModel')
  const profileContext = serviceOf(ctx, 'profileContext')

  return {
    pluginManager: !!pluginManager,
    listBundles: has(pluginManager, 'listBundles'),
    listPlugins: has(pluginManager, 'listPlugins'),
    installBundle: has(pluginManager, 'installBundle'),
    removeBundle: has(pluginManager, 'removeBundle'),
    setBundleEnabled: has(pluginManager, 'setBundleEnabled'),
    setPluginEnabled: has(pluginManager, 'setPluginEnabled'),
    inspect: has(pluginManager, 'inspect'),
    registries: has(pluginManager, 'registries'),
    versionExemptions: has(pluginManager, 'listVersionExemptions'),
    skills: !!skills,
    listSkills: has(skills, 'list'),
    sessionQuery: !!sessionQuery,
    listSessions: has(sessionQuery, 'listSessions'),
    readSession: has(sessionQuery, 'readSession'),
    llm: !!llm,
    prepareCall: has(llm, 'prepareCall'),
    listProviders: has(llm, 'listProviders'),
    webServer: !!webServer,
    tools: !!tools,
    web: !!web,
    searchWeb: has(web, 'search'),
    agentDefaultModel: !!agentDefaultModel,
    profileContext: !!profileContext,
  }
}

/**
 * A short human-readable summary of what this process supports, so the UI can
 * grey out a button instead of offering one that will fail.
 */
export function capabilityReport(ctx) {
  const caps = capabilities(ctx)
  const missing = []
  if (!caps.pluginManager) missing.push('pluginManager')
  else {
    if (!caps.listBundles) missing.push('pluginManager.listBundles')
    if (!caps.removeBundle) missing.push('pluginManager.removeBundle')
    if (!caps.setBundleEnabled) missing.push('pluginManager.setBundleEnabled')
  }
  if (!caps.listSkills) missing.push('skills.list')
  if (!caps.listSessions) missing.push('sessionQuery.listSessions')
  if (!caps.prepareCall) missing.push('llm.prepareCall')
  return { caps, missing, degraded: missing.length > 0 }
}
