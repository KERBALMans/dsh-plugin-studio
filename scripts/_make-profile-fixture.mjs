/**
 * Build `fixtures/profile/` — a synthetic DSH profile the suites can run
 * against when no real one exists (CI, a fresh clone, another machine).
 *
 * The suites exercise `fileInventory()`, which reads exactly three things:
 * `<profile>/package.json` (the dependency list) and
 * `<profile>/node_modules/<name>/package.json` (the metadata). So the fixture
 * is those files and nothing else. It is committed, because a generated-at-test
 * -time profile would drift from what the real code reads without anyone
 * noticing.
 *
 * The packages are chosen to cover every classification family, so the
 * "every row is classified, no `other`" assertion still means something:
 *
 *   ui       wallpaper engine          settings.section + theme
 *   tools    a tool server             tools.register
 *   model    a context compactor       message pipeline
 *   session  a session cleaner         session list
 *   net      an HTTP fetcher           fetch + http service
 *   ops      a packer                  storage + pack
 *   core     a base patch              core rows
 *
 * Run: node scripts/_make-profile-fixture.mjs
 */
import fs from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = new URL('.', import.meta.url)
const ROOT = fileURLToPath(new URL('../fixtures/profile', HERE))

const PACKAGES = [
  {
    name: 'demo-wallpaper-engine',
    version: '1.4.0',
    description: 'Wallpaper Engine backgrounds for the DSH web GUI: pick a video or image and it plays behind the conversation panel.',
    deps: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, meta: { title: '动态壁纸' } },
  },
  {
    name: 'demo-tool-runner',
    version: '2.1.0',
    description: 'MCP server exposing reverse-engineering tools to the agent. Registers 229 tools behind a single on/off switch.',
    deps: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, meta: { title: '逆向工具集' } },
  },
  {
    name: 'demo-context-compact',
    version: '0.1.9',
    description: 'Compresses long conversations by summarising older turns, so the context window does not overflow.',
    deps: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, meta: { title: '上下文压缩' } },
  },
  {
    name: 'demo-session-clean',
    version: '1.6.2',
    description: 'Lists old conversations and deletes the ones you pick. Frees disk space and keeps the sidebar short.',
    deps: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, meta: { title: '会话清理' } },
  },
  {
    name: 'demo-web-fetch',
    version: '1.0.3',
    description: 'Adds an HTTP fetch tool so the agent can read a URL and search the web.',
    deps: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, meta: { title: '网页抓取' } },
  },
  {
    name: 'demo-modpack',
    version: '0.9.1',
    description: 'Packs the current plugin selection into a portable bundle you can restore on another machine.',
    deps: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, meta: { title: '插件整合包' } },
  },
  {
    name: '@deepseek-ai/dsh-base',
    version: '0.2.1-rc.3',
    description: 'The shared dsh core as a profile bundle: the first patch layer of base-backed profiles.',
    deps: {},
    dsh: { bundle: { patch: './cordis.patch.yml' }, meta: { title: 'DSH 内核' } },
  },
]

fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true })

const dependencies = {}
for (const pkg of PACKAGES) {
  dependencies[pkg.name] = pkg.version
  const dir = join(ROOT, 'node_modules', ...pkg.name.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        dependencies: pkg.deps,
        dsh: pkg.dsh,
      },
      null,
      2,
    ) + '\n',
  )
  // `fileInventory` looks for a patch file to decide whether a package mounts
  // rows; the file only needs to exist and be parseable by the line scanner.
  fs.writeFileSync(join(dir, 'cordis.patch.yml'), `- id: ${pkg.name.split('/').pop()}\n  disabled: false\n`)
}

fs.writeFileSync(
  join(ROOT, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-profile-fixture',
      private: true,
      dsh: { version: '0.2.1-rc.3' },
      dependencies,
    },
    null,
    2,
  ) + '\n',
)

// A patch file at the profile root, so the "which rows are disabled" path has
// something to read.
fs.writeFileSync(join(ROOT, 'cordis.patch.yml'), '- id: demo-context-compact\n  disabled: false\n')

console.log(`wrote ${PACKAGES.length} packages to fixtures/profile/`)
