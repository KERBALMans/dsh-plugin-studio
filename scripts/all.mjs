/**
 * Run every suite in order and report a single pass/fail.
 *
 * This is what CI calls, and what to run before a release. It exists because
 * the suites are separate files with their own output, and "did everything
 * pass" should be one command with one exit code, not a shell loop the reader
 * has to reconstruct.
 *
 * Run: node scripts/all.mjs [--offline]
 *
 * `--offline` renders from `fixtures/` instead of the live Host, which is what
 * CI does (there is no Host there). Without it, render/measure/shoot talk to a
 * running client on `--port` / DSH_WEB_PORT.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = new URL('.', import.meta.url)

// `render` and `measure` need a browser for the layout checks. A machine
// without one is not a failure — the structural checks still run — so the
// suite reports "skip" rather than "fail" when the browser is absent.
const SUITES = [
  { name: 'smoke', args: [] },
  { name: 'analyse', args: [] },
  { name: 'scores', args: [] },
  { name: 'routes', args: [] },
  { name: 'actions', args: [] },
  { name: 'ai', args: [] },
  { name: 'style', args: [] },
  { name: 'compat', args: [] },
  { name: 'render', args: ['--offline'] },
  { name: 'measure', args: [] },
]

const offline = process.argv.includes('--offline')
const results = []

for (const suite of SUITES) {
  const args = [fileURLToPath(new URL(`${suite.name}.mjs`, HERE)), ...suite.args]
  process.stdout.write(`\n${'='.repeat(60)}\n${suite.name}\n${'='.repeat(60)}\n`)

  const run = spawnSync(process.execPath, args, { stdio: 'inherit' })
  const skipped = run.status === 0 && /skipping|no browser found/i.test(String(run.stdout || ''))
  results.push({ name: suite.name, status: run.status, skipped })
}

const failed = results.filter((r) => r.status !== 0)
const skipped = results.filter((r) => r.skipped)

console.log(`\n${'='.repeat(60)}\nSUMMARY\n${'='.repeat(60)}`)
for (const r of results) {
  const mark = r.status === 0 ? (r.skipped ? 'SKIP' : 'PASS') : 'FAIL'
  console.log(`  ${r.name.padEnd(10)} ${mark}`)
}

console.log(
  `\n${results.length} suites, ${results.length - failed.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
)
if (offline) console.log('(offline: rendered from fixtures/)')

process.exitCode = failed.length === 0 ? 0 : 1
