// One-shot verification driver for VoicePack (Windows, real display).
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as fs from 'node:fs'

const APP_DIR = 'c:/Projects/GitHub/voicepack-for-minecraft'
const SHOTS = process.env.SHOT_DIR ?? path.resolve(import.meta.dirname, '../.shots')
fs.mkdirSync(SHOTS, { recursive: true })

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')

const log = (...a) => console.log('[drive]', ...a)

// This process may be running inside an Electron-based host (the VS Code
// extension host sets ELECTRON_RUN_AS_NODE=1). Inheriting that makes the child
// Electron start as plain Node, so `electron.app` is undefined and the app
// dies before it opens a window. Strip it.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// APP_EXE points the driver at a packaged build instead of the dev tree, which
// is the only way to catch problems that exist solely inside an asar (the
// ffmpeg path rewrite in particular).
const packaged = process.env.APP_EXE
const app = await electron.launch({
  executablePath: packaged ?? electronBin,
  args: packaged ? [] : [APP_DIR],
  cwd: packaged ? path.dirname(packaged) : APP_DIR,
  env,
  timeout: 60_000
})
log(packaged ? `driving PACKAGED build: ${packaged}` : 'driving dev tree')

// Surface main-process stdout/stderr — that's where an ESM/preload failure shows.
app.process().stdout?.on('data', (d) => process.stdout.write(`[main:out] ${d}`))
app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`))

const page = await app.firstWindow({ timeout: 30_000 })

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`)
})

await page.waitForLoadState('domcontentloaded')
log('window url:', page.url())

// 1. Is the preload bridge actually attached?
const bridge = await page.evaluate(() => ({
  hasBridge: typeof window.voicepack === 'object' && window.voicepack !== null,
  namespaces: window.voicepack ? Object.keys(window.voicepack) : [],
  hasNodeLeak: typeof window.require !== 'undefined' || typeof window.process !== 'undefined'
}))
log('bridge:', JSON.stringify(bridge))

// 2. Did the welcome screen actually render, or is it a blank frame?
await page.waitForSelector('h1', { timeout: 20_000 }).catch(() => {})
const ui = await page.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent ?? null,
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 8),
  bodyLen: document.body.innerText.length
}))
log('ui:', JSON.stringify(ui, null, 2))

// 3. Round-trip a real IPC call through the bridge into the main process.
const ipc = await page.evaluate(async () => {
  const out = {}
  try {
    const s = await window.voicepack.settings.get()
    out.settings = { oggQuality: s.oggQuality, forceMono: s.forceMono, recents: s.recentProjects.length }
  } catch (e) { out.settingsError = String(e) }
  try {
    const c = await window.voicepack.catalog.get()
    out.catalogEvents = c.events.length
    out.sampleEvent = c.events[0]?.id
  } catch (e) { out.catalogError = String(e) }
  try {
    const enc = await window.voicepack.encoder.info()
    out.encoder = { available: enc.available, source: enc.source, version: enc.version?.slice(0, 40) }
  } catch (e) { out.encoderError = String(e) }
  try {
    const mc = await window.voicepack.minecraft.detect()
    out.minecraft = mc.ok ? (mc.value ? `${mc.value.versions.length} versions` : 'not found') : mc.error
  } catch (e) { out.mcError = String(e) }
  return out
})
log('ipc round-trip:', JSON.stringify(ipc, null, 2))

// 4. Drive the UI: type a pack name, confirm React state updates.
await page.fill('input[value="My VoicePack"]', 'Zombie Voices').catch((e) => log('fill failed:', e.message))
const typed = await page.evaluate(() => document.querySelector('input')?.value)
log('typed name reads back as:', typed)

await page.screenshot({ path: path.join(SHOTS, '01-welcome.png') })
log('screenshot -> 01-welcome.png')

log('page errors:', pageErrors.length ? JSON.stringify(pageErrors, null, 2) : 'none')

await app.close()
log('closed cleanly')
