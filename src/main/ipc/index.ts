import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { z } from 'zod'
import { CH, type NewProjectRequest, type WriteTakeRequest } from '@shared/ipc'
import { appSettingsSchema, projectSchema } from '@shared/schema'
import type {
  AppSettings,
  Catalog,
  ExportProgress,
  MergeResult,
  MinecraftInstall,
  MinecraftVersion,
  OpenProject,
  Result
} from '@shared/types'
import { loadSettings, rememberProject, updateSettings } from '../services/settings'
import {
  createProject,
  deleteTake,
  isProjectDir,
  loadProject,
  readTake,
  resolveInProject,
  saveProject,
  writeTake
} from '../services/project-store'
import { mergeProjects } from '../services/project-merge'
import { detectInstalls, identifyInstall, scanForEvents } from '../services/minecraft-scan'
import { invalidateAssetIndexCache, readOriginalAudio } from '../services/original-audio'
import { invalidateFfmpegCache, renderProcessedWav, resolveFfmpeg } from '../services/ffmpeg'
import { buildPack, validate } from '../services/pack-builder'
import { safeFileName } from '../util/paths'

/**
 * Wrap a handler so anything thrown becomes a typed failure the renderer can
 * render, instead of an opaque "Error invoking remote method" string.
 */
function handle<A extends unknown[], T>(
  channel: string,
  fn: (...args: A) => Promise<T>
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error: message }
    }
  })
}

/** For channels whose failure mode is genuinely not interesting to the UI. */
function handleRaw<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T>): void {
  ipcMain.handle(channel, (_event, ...args: unknown[]) => fn(...(args as A)))
}

const newProjectSchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  packFormat: z.number().int().positive()
})

const mergeModeSchema = z.enum(['skip', 'append', 'replace'])

const takeRangeSchema = z.object({
  trimStart: z.number().nonnegative(),
  trimEnd: z.number().nonnegative().nullable(),
  gainDb: z.number()
})

const writeTakeSchema = z.object({
  projectDir: z.string().min(1),
  eventId: z.string().min(1),
  wav: z.instanceof(ArrayBuffer),
  durationSeconds: z.number().nonnegative(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().min(1).max(2),
  peak: z.number().min(0).max(1)
})

/**
 * Cached scan results so switching views doesn't re-open the jar every time.
 * The catalog starts empty on purpose: every event the user sees comes from
 * their own installed Minecraft, never from a list we shipped.
 */
let catalogCache: Catalog = { events: [], scannedVersion: null }
let installsCache: MinecraftInstall[] = []
/** The version whose sounds the catalog was read from, and we preview against. */
let currentVersion: MinecraftVersion | null = null

/** Every version across every detected install, for looking a jar path up. */
function allVersions(): MinecraftVersion[] {
  return installsCache.flatMap((install) => install.versions)
}

/**
 * Adopt a version as the active one: it supplies the event list, the original
 * audio previews, and the `resourcepacks` folder an export installs into.
 */
async function useVersion(version: MinecraftVersion): Promise<void> {
  currentVersion = version
  invalidateAssetIndexCache()
  await updateSettings({
    minecraftJarPath: version.jarPath,
    minecraftGameDir: version.gameDir
  })
}

/** The version to read original audio from, re-detecting if we have to. */
async function resolveCurrentVersion(): Promise<MinecraftVersion | null> {
  if (currentVersion) return currentVersion
  const settings = await loadSettings()
  if (!settings.minecraftJarPath) return null
  if (installsCache.length === 0) installsCache = await detectInstalls()
  currentVersion = allVersions().find((v) => v.jarPath === settings.minecraftJarPath) ?? null
  return currentVersion
}

/** Where a "New project" dialog should start: next to the last one they made. */
async function suggestProjectDir(name: string): Promise<string> {
  const { recentProjects } = await loadSettings()
  const previous = recentProjects[0]
  const parent = previous ? resolve(previous, '..') : app.getPath('documents')
  return join(parent, safeFileName(name, 'My VoicePack'))
}

/**
 * Drop recent projects whose directory is gone — moved, renamed, or on an
 * unmounted drive. Without this a dead entry sits in the list forever, fails
 * every time it is clicked, and makes startup log an error when the app tries
 * to reopen it.
 */
async function pruneRecents(): Promise<AppSettings> {
  const settings = await loadSettings()
  const alive: string[] = []
  for (const dir of settings.recentProjects) {
    if (await isProjectDir(dir)) alive.push(dir)
  }
  if (alive.length === settings.recentProjects.length) return settings
  return updateSettings({ recentProjects: alive })
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // ---- settings ----------------------------------------------------------
  handleRaw(CH.settingsGet, async () => pruneRecents())
  handleRaw(CH.settingsUpdate, async (patch: unknown) => {
    const parsed = appSettingsSchema.partial().parse(patch)
    if ('ffmpegPath' in parsed) invalidateFfmpegCache()
    if ('minecraftDir' in parsed) invalidateAssetIndexCache()
    return updateSettings(parsed)
  })

  // ---- projects ----------------------------------------------------------
  handleRaw(CH.projectPickNewDir, async (defaultName: unknown): Promise<string | null> => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Create a new VoicePack project',
      // A save dialog rather than an open dialog: the user is naming a folder
      // that does not exist yet, which "select directory" cannot express.
      defaultPath: await suggestProjectDir(z.string().parse(defaultName)),
      buttonLabel: 'Create',
      properties: ['createDirectory']
    })
    return canceled || !filePath ? null : filePath
  })

  handle(CH.projectCreate, async (raw: unknown): Promise<OpenProject> => {
    const req: NewProjectRequest = newProjectSchema.parse(raw)
    const project = await createProject(req.dir, req.name, req.description, req.packFormat)
    await rememberProject(req.dir)
    return { dir: req.dir, project }
  })

  handle(CH.projectOpen, async (): Promise<OpenProject | null> => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open a VoicePack project',
      properties: ['openDirectory']
    })
    const dir = filePaths[0]
    if (canceled || !dir) return null
    if (!(await isProjectDir(dir))) {
      throw new Error(`${basename(dir)} does not contain a project.json.`)
    }
    const project = await loadProject(dir)
    await rememberProject(dir)
    return { dir, project }
  })

  handle(CH.projectOpenPath, async (dir: unknown): Promise<OpenProject> => {
    const path = z.string().min(1).parse(dir)
    const project = await loadProject(path)
    await rememberProject(path)
    return { dir: path, project }
  })

  handle(CH.projectSave, async (dir: unknown, project: unknown) => {
    return saveProject(z.string().min(1).parse(dir), projectSchema.parse(project))
  })

  handle(CH.projectPickMergeSource, async (): Promise<OpenProject | null> => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose the pack to merge in',
      buttonLabel: 'Choose pack',
      properties: ['openDirectory']
    })
    const dir = filePaths[0]
    if (canceled || !dir) return null
    if (!(await isProjectDir(dir))) {
      throw new Error(`${basename(dir)} does not contain a project.json.`)
    }
    // Deliberately not remembered as a recent project: it was read from, not
    // opened, and the user is still working in the pack they had open.
    return { dir, project: await loadProject(dir) }
  })

  handle(
    CH.projectMerge,
    async (dir: unknown, sourceDir: unknown, mode: unknown): Promise<MergeResult> =>
      mergeProjects(
        z.string().min(1).parse(dir),
        z.string().min(1).parse(sourceDir),
        mergeModeSchema.parse(mode)
      )
  )

  handleRaw(CH.projectReveal, async (dir: unknown) => {
    await shell.openPath(z.string().min(1).parse(dir))
  })

  // ---- catalog -----------------------------------------------------------
  handleRaw(CH.catalogGet, async () => catalogCache)

  handle(CH.catalogScan, async (jarPath: unknown): Promise<Catalog> => {
    const path = z.string().min(1).parse(jarPath)
    if (installsCache.length === 0) installsCache = await detectInstalls()

    const version = allVersions().find((v) => v.jarPath === path)
    if (!version) throw new Error(`That Minecraft version is no longer available: ${path}`)

    // Scanning a version is also how a version gets chosen, so previews and
    // pack installation follow the list the user is looking at.
    await useVersion(version)

    catalogCache = { events: await scanForEvents(version), scannedVersion: version.label }
    return catalogCache
  })

  // ---- minecraft ---------------------------------------------------------
  handle(CH.minecraftDetect, async (): Promise<MinecraftInstall[]> => {
    const settings = await loadSettings()
    const found = await detectInstalls()

    // A folder the user chose by hand outranks anything we sniffed out, and is
    // often somewhere we would never have looked (a portable launcher, a
    // second drive), so it is merged in rather than replaced.
    if (settings.minecraftDir && !found.some((i) => i.root === settings.minecraftDir)) {
      const chosen = await identifyInstall(settings.minecraftDir)
      if (chosen) found.unshift(chosen)
    }

    installsCache = found
    currentVersion = settings.minecraftJarPath
      ? (allVersions().find((v) => v.jarPath === settings.minecraftJarPath) ?? null)
      : null
    return found
  })

  handle(CH.minecraftPickDir, async (): Promise<MinecraftInstall | null> => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select your Minecraft or launcher folder',
      properties: ['openDirectory']
    })
    const dir = filePaths[0]
    if (canceled || !dir) return null

    const install = await identifyInstall(dir)
    if (!install) {
      throw new Error(
        `${basename(dir)} doesn't look like a Minecraft install. Pick a ".minecraft" folder, or a launcher data folder such as Prism Launcher's (the one containing "instances").`
      )
    }
    await updateSettings({ minecraftDir: install.root })
    invalidateAssetIndexCache()
    installsCache = [install, ...installsCache.filter((i) => i.root !== install.root)]
    return install
  })

  handle(CH.minecraftOriginalAudio, async (eventId: unknown): Promise<ArrayBuffer | null> => {
    const id = z.string().min(1).parse(eventId)
    const version = await resolveCurrentVersion()
    if (!version) return null

    const buf = await readOriginalAudio(version, id)
    if (!buf) return null
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })

  // ---- takes -------------------------------------------------------------
  handle(CH.takeWrite, async (raw: unknown) => {
    const req: WriteTakeRequest = writeTakeSchema.parse(raw)
    return writeTake({ ...req, wav: Buffer.from(req.wav) })
  })

  handle(CH.takeRead, async (dir: unknown, file: unknown): Promise<ArrayBuffer> => {
    const buf = await readTake(z.string().parse(dir), z.string().parse(file))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })

  handle(
    CH.takeProcessed,
    async (dir: unknown, file: unknown, range: unknown): Promise<ArrayBuffer> => {
      const projectDir = z.string().parse(dir)
      const take = takeRangeSchema.parse(range)
      const settings = await loadSettings()
      const encoder = await resolveFfmpeg(settings.ffmpegPath)
      if (!encoder.available || !encoder.path) {
        throw new Error('No usable ffmpeg was found, so the cleaned preview cannot be rendered.')
      }

      const staging = await mkdtemp(join(tmpdir(), 'voicepack-preview-'))
      const outPath = join(staging, 'processed.wav')
      try {
        await renderProcessedWav(
          encoder.path,
          resolveInProject(projectDir, z.string().parse(file)),
          outPath,
          {
            ...take,
            mono: settings.forceMono,
            noiseReduction: settings.noiseReduction,
            voiceEnhance: settings.voiceEnhance
          }
        )
        const buf = await readFile(outPath)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    }
  )

  handle(CH.takeDelete, async (dir: unknown, file: unknown) => {
    await deleteTake(z.string().parse(dir), z.string().parse(file))
  })

  // ---- encoder -----------------------------------------------------------
  handleRaw(CH.encoderInfo, async () => {
    const settings = await loadSettings()
    return resolveFfmpeg(settings.ffmpegPath)
  })

  // ---- export ------------------------------------------------------------
  handleRaw(CH.exportPickPath, async (defaultName: unknown): Promise<string | null> => {
    const win = getWindow()
    if (!win) return null
    const suggested = `${safeFileName(z.string().parse(defaultName), 'voicepack')}.zip`
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export resource pack',
      defaultPath: suggested,
      filters: [{ name: 'Resource pack', extensions: ['zip'] }]
    })
    return canceled || !filePath ? null : filePath
  })

  handleRaw(CH.exportValidate, async (project: unknown) => validate(projectSchema.parse(project)))

  handle(CH.exportRun, async (dir: unknown, project: unknown, options: unknown) => {
    const parsedOptions = z
      .object({ outPath: z.string().min(1), installToMinecraft: z.boolean() })
      .parse(options)

    const win = getWindow()
    return buildPack({
      projectDir: z.string().min(1).parse(dir),
      project: projectSchema.parse(project),
      settings: await loadSettings(),
      outPath: parsedOptions.outPath,
      installToMinecraft: parsedOptions.installToMinecraft,
      onProgress: (p: ExportProgress) => win?.webContents.send(CH.exportProgress, p)
    })
  })
}

