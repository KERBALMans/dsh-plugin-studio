/**
 * Capture screenshots of the real panel for the README and the GitHub release.
 *
 * `measure.mjs` replaces the page body with a measurement blob, so it cannot
 * also be the thing we photograph. This script shoots `preview.html` (the real
 * markup, real data) at several widths, because a plugin page is mostly read on
 * a laptop but must not fall apart on a wide monitor.
 *
 * Run: node scripts/shoot.mjs [--port=50329]
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = new URL('.', import.meta.url)
const ROOT = new URL('../', HERE)
const PREVIEW = new URL('../build/preview.html', HERE)
const SHOTS = new URL('../build/shots/', HERE)
const PORT = (() => {
  const flag = process.argv.find((a) => a.startsWith('--port='))
  return flag ? flag.slice('--port='.length) : (process.env.DSH_WEB_PORT || '53494')
})()

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

const browser = CANDIDATES.find((p) => fs.existsSync(p))
if (!browser) {
  console.log('FAIL: no headless browser found')
  process.exit(1)
}

// Render fresh markup from the live API first, so the screenshots show real
// rows rather than whatever was on disk from an earlier run.
// `new URL(...).pathname` is percent-encoded and keeps a leading slash, which
// this workspace path ("MY Base Text") turns into a broken argument; resolve
// through fileURLToPath instead.
console.log('=== rendering preview ===')
const node = process.execPath
const renderScript = fileURLToPath(new URL('../scripts/render.mjs', HERE))
const out = execFileSync(node, [renderScript, `--port=${PORT}`], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 32 * 1024 * 1024,
})
const dataLine = out.split('\n').find((l) => l.startsWith('data:'))
console.log('  ' + (dataLine || 'no data line'))

if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true })

/**
 * `--screenshot` writes a PNG of the viewport. `--window-size` sets that
 * viewport; `--hide-scrollbars` keeps the image clean. The page is a settings
 * panel, so the useful heights are "one screenful" and "everything".
 */
const SIZES = [
  { name: 'panel-980', w: 980, h: 1400 },
  { name: 'panel-1280', w: 1280, h: 1400 },
  { name: 'panel-720', w: 720, h: 1400 },
]

const url = 'file:///' + fileURLToPath(PREVIEW).replace(/\\/g, '/')
let failed = 0

for (const size of SIZES) {
  const target = fileURLToPath(new URL(`../build/shots/${size.name}.png`, HERE))
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--virtual-time-budget=5000',
    `--window-size=${size.w},${size.h}`,
    `--screenshot=${target}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  const exists = fs.existsSync(target)
  const bytes = exists ? fs.statSync(target).size : 0
  if (exists && bytes > 20000) {
    console.log(`  ok   ${size.name}  ${bytes} bytes`)
  } else {
    failed += 1
    console.log(`  FAIL ${size.name}  ${bytes} bytes`)
  }
}

// The 2x scale factor doubles pixel dimensions; report them so the README can
// state what the reader is looking at.
console.log('\n=== sizes ===')
for (const size of SIZES) {
  const p = new URL(`../build/shots/${size.name}.png`, HERE)
  if (!fs.existsSync(p)) continue
  const buf = fs.readFileSync(p)
  // PNG IHDR: width and height are big-endian uint32 at bytes 16..24.
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  console.log(`  ${size.name}: ${w}x${h}`)
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`)
process.exitCode = failed === 0 ? 0 : 1
