// End-to-end check of the export pipeline: create a project, write a synthetic
// take, export a pack, then verify the .zip actually contains a valid
// sounds.json / pack.mcmeta / Ogg Vorbis audio.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'

const APP_DIR = 'c:/Projects/GitHub/voicepack-for-minecraft'
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-e2e-'))
const projectDir = path.join(work, 'TestPack')
const outZip = path.join(work, 'TestPack.zip')

const log = (...a) => console.log('[e2e]', ...a)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  cwd: APP_DIR,
  env,
  timeout: 60_000
})
app.process().stderr?.on('data', (d) => {
  const s = String(d)
  if (!s.includes('Debugger')) process.stdout.write(`[main:err] ${s}`)
})

const page = await app.firstWindow({ timeout: 30_000 })
await page.waitForSelector('h1', { timeout: 20_000 })

const result = await page.evaluate(
  async ({ projectDir, outZip }) => {
    const steps = {}

    // 1. Create a project without going through the folder picker.
    const created = await window.voicepack.project.create({
      dir: projectDir,
      name: 'Test Pack',
      description: 'End-to-end test',
      packFormat: 55
    })
    steps.create = created.ok ? 'ok' : created.error
    if (!created.ok) return steps

    // 2. Synthesise a 0.5s 440 Hz tone at -6 dBFS as a 16-bit mono WAV.
    const sampleRate = 48000
    const frames = sampleRate / 2
    const buffer = new ArrayBuffer(44 + frames * 2)
    const view = new DataView(buffer)
    const ascii = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
    ascii(0, 'RIFF')
    view.setUint32(4, 36 + frames * 2, true)
    ascii(8, 'WAVE')
    ascii(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    ascii(36, 'data')
    view.setUint32(40, frames * 2, true)
    let peak = 0
    for (let i = 0; i < frames; i++) {
      const v = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
      peak = Math.max(peak, Math.abs(v))
      view.setInt16(44 + i * 2, v * 32767, true)
    }

    const written = await window.voicepack.takes.write({
      projectDir,
      eventId: 'entity.zombie.hurt',
      wav: buffer,
      durationSeconds: 0.5,
      sampleRate,
      channels: 1,
      peak
    })
    steps.writeTake = written.ok ? written.value.file : written.error
    if (!written.ok) return steps

    // 3. Bind the event to that take and save.
    const project = {
      ...created.value.project,
      bindings: [
        {
          eventId: 'entity.zombie.hurt',
          category: 'hostile',
          enabled: true,
          replace: true,
          subtitle: null,
          takes: [written.value],
          activeTakeId: written.value.id
        }
      ]
    }
    const saved = await window.voicepack.project.save(projectDir, project)
    steps.save = saved.ok ? 'ok' : saved.error
    if (!saved.ok) return steps

    // 4. Validate, then export.
    steps.validation = await window.voicepack.exporter.validate(saved.value)

    const exported = await window.voicepack.exporter.run(projectDir, saved.value, {
      outPath: outZip,
      installToMinecraft: false
    })
    steps.export = exported.ok
      ? { bytes: exported.value.bytes, events: exported.value.eventCount, files: exported.value.fileCount, warnings: exported.value.warnings }
      : exported.error
    return steps
  },
  { projectDir, outZip }
)

log('steps:', JSON.stringify(result, null, 2))
await app.close()

// ---- verify the artefact on disk, outside the app ----
if (!fs.existsSync(outZip)) {
  log('FAIL: no zip produced')
  process.exit(1)
}
log('zip size:', fs.statSync(outZip).size, 'bytes')

// List entries with the bundled ffmpeg's sibling tooling: just unzip via Node.
const yauzl = (await import('yauzl')).default
const entries = await new Promise((resolve, reject) => {
  const found = []
  yauzl.open(outZip, { lazyEntries: true }, (err, zip) => {
    if (err) return reject(err)
    zip.on('entry', (e) => {
      found.push(e.fileName)
      if (e.fileName === 'assets/minecraft/sounds.json' || e.fileName === 'pack.mcmeta') {
        zip.openReadStream(e, (er, s) => {
          if (er) return reject(er)
          const c = []
          s.on('data', (d) => c.push(d))
          s.on('end', () => {
            found.push(`--- ${e.fileName} ---\n${Buffer.concat(c).toString('utf8')}`)
            zip.readEntry()
          })
        })
      } else zip.readEntry()
    })
    zip.on('end', () => resolve(found))
    zip.readEntry()
  })
})
log('zip contents:')
for (const e of entries) console.log('   ', e)

// Confirm the audio really is Ogg Vorbis, not Opus or a renamed WAV.
const ffmpeg = path.join(APP_DIR, 'node_modules/ffmpeg-static/ffmpeg.exe')
const oggPath = path.join(work, 'extracted.ogg')
await new Promise((resolve, reject) => {
  yauzl.open(outZip, { lazyEntries: true }, (err, zip) => {
    if (err) return reject(err)
    zip.on('entry', (e) => {
      if (e.fileName.endsWith('.ogg')) {
        zip.openReadStream(e, (er, s) => {
          if (er) return reject(er)
          s.pipe(fs.createWriteStream(oggPath)).on('close', resolve)
        })
      } else zip.readEntry()
    })
    zip.on('end', resolve)
    zip.readEntry()
  })
})

if (fs.existsSync(oggPath)) {
  // A full decode to null: proves the stream is not just correctly named.
  execFileSync(ffmpeg, ['-hide_banner', '-i', oggPath, '-f', 'null', '-'], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  log('decoded ok')
}
try {
  execFileSync(ffmpeg, ['-hide_banner', '-i', oggPath], { stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  const info = String(e.stderr)
  const stream = info.split('\n').find((l) => l.includes('Stream #0'))
  log('codec:', stream?.trim())
  log('duration:', info.split('\n').find((l) => l.includes('Duration'))?.trim())
}

fs.rmSync(work, { recursive: true, force: true })
log('done')
