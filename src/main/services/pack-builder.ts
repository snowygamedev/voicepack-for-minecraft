import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import type {
  AppSettings,
  ExportProgress,
  ExportResult,
  Project,
  SoundBinding,
  Take,
  ValidationIssue
} from '@shared/types'
import { eventIdToPath, resourcePacksDir, safeFileName } from '../util/paths'
import { writeZip, type ZipFileEntry } from '../util/zip'
import { encodeWavToOgg, normalizationGainDb, resolveFfmpeg } from './ffmpeg'
import { resolveInProject } from './project-store'

/** Directory under assets/<ns>/sounds/ that all our audio lives in. */
const SOUND_ROOT = 'voicepack'

/** A single sound entry as it appears in sounds.json. */
interface SoundsJsonSound {
  name: string
  volume?: number
  pitch?: number
  weight?: number
  stream?: boolean
}

interface SoundsJsonEvent {
  replace?: boolean
  category?: string
  subtitle?: string
  sounds: SoundsJsonSound[]
}

/** Takes that will actually be exported for a binding. */
function exportableTakes(binding: SoundBinding): Take[] {
  if (!binding.enabled || binding.takes.length === 0) return []
  if (binding.activeTakeId === null) return binding.takes
  const active = binding.takes.find((t) => t.id === binding.activeTakeId)
  return active ? [active] : []
}

/** Effective duration of a take after trim, in seconds. */
function trimmedDuration(take: Take): number {
  const end = take.trimEnd ?? take.duration
  return Math.max(0, end - take.trimStart)
}

/**
 * Checks worth surfacing before the user waits on an encode and then finds a
 * broken pack in-game. Errors block export, warnings do not.
 */
export function validate(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const enabled = project.bindings.filter((b) => b.enabled)
  if (enabled.length === 0) {
    issues.push({
      severity: 'error',
      eventId: null,
      message: 'No sound events are enabled, so the pack would be empty.'
    })
  } else if (!enabled.some((b) => exportableTakes(b).length > 0)) {
    issues.push({
      severity: 'error',
      eventId: null,
      message: 'Nothing has been recorded yet, so the pack would be empty.'
    })
  }
  if (!project.name.trim()) {
    issues.push({ severity: 'error', eventId: null, message: 'The pack needs a name.' })
  }

  for (const binding of enabled) {
    const takes = exportableTakes(binding)
    if (takes.length === 0) {
      // Not an error: a pack is often planned as a list of sounds to get
      // through, so an unrecorded event is a to-do, not a broken export. It is
      // simply left out of the zip.
      issues.push({
        severity: 'warning',
        eventId: binding.eventId,
        message: 'Not recorded yet — it will be left out of the pack.'
      })
      continue
    }
    for (const take of takes) {
      const duration = trimmedDuration(take)
      if (duration <= 0.01) {
        issues.push({
          severity: 'error',
          eventId: binding.eventId,
          message: `"${take.label}" is empty after trimming.`
        })
      }
      if (take.peak >= 0.999) {
        issues.push({
          severity: 'warning',
          eventId: binding.eventId,
          message: `"${take.label}" is clipping and will sound distorted in-game.`
        })
      } else if (take.peak === 0) {
        issues.push({
          severity: 'warning',
          eventId: binding.eventId,
          message: `"${take.label}" appears to be silent.`
        })
      } else if (take.peak < 0.05) {
        issues.push({
          severity: 'warning',
          eventId: binding.eventId,
          message: `"${take.label}" is very quiet; consider re-recording or normalising.`
        })
      }
      // Minecraft streams long sounds rather than loading them into memory.
      if (duration > 30 && binding.category !== 'music' && binding.category !== 'record') {
        issues.push({
          severity: 'warning',
          eventId: binding.eventId,
          message: `"${take.label}" is ${duration.toFixed(0)}s long; it will be streamed.`
        })
      }
    }
  }
  return issues
}

function round(n: number): number {
  return Number(n.toFixed(3))
}

/** Build the sounds.json object for a project. */
export function buildSoundsJson(project: Project): Record<string, SoundsJsonEvent> {
  const out: Record<string, SoundsJsonEvent> = {}

  for (const binding of project.bindings) {
    const takes = exportableTakes(binding)
    if (takes.length === 0) continue

    const base = posix.join(SOUND_ROOT, eventIdToPath(binding.eventId))
    const sounds: SoundsJsonSound[] = takes.map((take, index) => {
      const sound: SoundsJsonSound = { name: posix.join(base, String(index + 1)) }
      if (take.volume !== 1) sound.volume = round(take.volume)
      if (take.pitch !== 1) sound.pitch = round(take.pitch)
      // A weight only means anything when there is a pool to pick from.
      if (take.weight !== 1 && takes.length > 1) sound.weight = take.weight
      // Long audio is streamed from disk instead of held in memory.
      if (trimmedDuration(take) > 30) sound.stream = true
      return sound
    })

    const event: SoundsJsonEvent = {
      replace: binding.replace,
      category: binding.category,
      sounds
    }
    if (binding.subtitle) event.subtitle = binding.subtitle
    out[binding.eventId] = event
  }

  return out
}

/** Build the pack.mcmeta contents. */
export function buildPackMcmeta(project: Project): string {
  const pack: Record<string, unknown> = {
    pack_format: project.packFormat,
    description: project.description || project.name
  }
  // `supported_formats` lets one pack cover a version range on newer clients;
  // older clients ignore it and fall back to pack_format.
  if (project.supportedFormats) {
    pack.supported_formats = [project.supportedFormats.min, project.supportedFormats.max]
  }
  return `${JSON.stringify({ pack }, null, 2)}\n`
}

export interface BuildInput {
  projectDir: string
  project: Project
  settings: AppSettings
  outPath: string
  installToMinecraft: boolean
  onProgress: (p: ExportProgress) => void
}

export async function buildPack(input: BuildInput): Promise<ExportResult> {
  const { projectDir, project, settings, onProgress } = input

  const issues = validate(project)
  const blocking = issues.filter((i) => i.severity === 'error')
  if (blocking.length > 0) {
    throw new Error(`Cannot export:\n${blocking.map((i) => `- ${i.message}`).join('\n')}`)
  }
  const warnings = issues
    .filter((i) => i.severity === 'warning')
    .map((i) => (i.eventId ? `${i.eventId}: ${i.message}` : i.message))

  const encoder = await resolveFfmpeg(settings.ffmpegPath)
  if (!encoder.available || !encoder.path) {
    throw new Error(
      'No usable ffmpeg was found. Install ffmpeg, or set its path in Settings, to export Ogg Vorbis audio.'
    )
  }

  const staging = await mkdtemp(join(tmpdir(), 'voicepack-'))
  try {
    const entries: ZipFileEntry[] = []
    const assetRoot = posix.join('assets', project.namespace)

    // 1. Encode every exportable take to Ogg Vorbis.
    const jobs: Array<{ take: Take; zipPath: string }> = []
    for (const binding of project.bindings) {
      const base = posix.join(SOUND_ROOT, eventIdToPath(binding.eventId))
      exportableTakes(binding).forEach((take, index) => {
        jobs.push({ take, zipPath: posix.join(assetRoot, 'sounds', base, `${index + 1}.ogg`) })
      })
    }

    let done = 0
    for (const job of jobs) {
      onProgress({
        phase: 'encoding',
        progress: jobs.length ? done / jobs.length : null,
        message: `Encoding ${job.take.label || 'take'} (${done + 1}/${jobs.length})`
      })

      const wavPath = resolveInProject(projectDir, job.take.file)
      const oggPath = join(staging, `${done}.ogg`)
      const normalizeGain = settings.normalizeOnExport
        ? normalizationGainDb(job.take.peak, settings.targetPeakDb)
        : 0

      await encodeWavToOgg(encoder.path, wavPath, oggPath, {
        quality: settings.oggQuality,
        mono: settings.forceMono,
        trimStart: job.take.trimStart,
        trimEnd: job.take.trimEnd,
        gainDb: job.take.gainDb + normalizeGain,
        noiseReduction: settings.noiseReduction,
        voiceEnhance: settings.voiceEnhance
      })

      entries.push({ path: job.zipPath, content: await readFile(oggPath) })
      done += 1
    }

    // 2. Metadata.
    onProgress({ phase: 'writing', progress: null, message: 'Writing pack metadata' })
    const soundsJson = buildSoundsJson(project)
    entries.push({ path: 'pack.mcmeta', content: Buffer.from(buildPackMcmeta(project), 'utf8') })
    entries.push({
      path: posix.join(assetRoot, 'sounds.json'),
      content: Buffer.from(`${JSON.stringify(soundsJson, null, 2)}\n`, 'utf8')
    })

    const icon = await readOptional(join(projectDir, 'pack.png'))
    if (icon) entries.push({ path: 'pack.png', content: icon })

    // 3. Zip.
    onProgress({ phase: 'zipping', progress: null, message: 'Building the .zip' })
    const bytes = await writeZip(input.outPath, entries)

    // 4. Optionally drop a copy where Minecraft will find it.
    let installedTo: string | null = null
    // The game folder, not the install root: under Prism those are different
    // directories, and only the per-instance one has a `resourcepacks`.
    const gameDir = settings.minecraftGameDir ?? settings.minecraftDir
    if (input.installToMinecraft && gameDir) {
      onProgress({ phase: 'installing', progress: null, message: 'Installing into Minecraft' })
      const packsDir = resourcePacksDir(gameDir)
      await mkdir(packsDir, { recursive: true })
      const target = join(packsDir, `${safeFileName(project.name, 'voicepack')}.zip`)
      await writeZip(target, entries)
      installedTo = target
    }

    onProgress({ phase: 'done', progress: 1, message: 'Export complete' })
    return {
      outPath: input.outPath,
      installedTo,
      bytes,
      eventCount: Object.keys(soundsJson).length,
      fileCount: entries.length,
      warnings
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}
