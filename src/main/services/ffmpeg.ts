import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, constants } from 'node:fs/promises'
import type { EncoderInfo, NoiseReduction } from '@shared/types'

const run = promisify(execFile)

async function isExecutable(p: string | null | undefined): Promise<boolean> {
  if (!p) return false
  try {
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * ffmpeg-static resolves to a path inside app.asar once packaged, but a binary
 * cannot be executed from inside an asar. electron-builder is configured to
 * unpack it, so we rewrite the path to match.
 */
async function bundledFfmpeg(): Promise<string | null> {
  try {
    const mod = (await import('ffmpeg-static')) as unknown as { default: string | null }
    const raw = mod.default
    if (!raw) return null
    const unpacked = raw.replace('app.asar', 'app.asar.unpacked')
    if (await isExecutable(unpacked)) return unpacked
    return (await isExecutable(raw)) ? raw : null
  } catch {
    return null
  }
}

async function ffmpegOnPath(): Promise<string | null> {
  try {
    await run('ffmpeg', ['-version'], { timeout: 5000 })
    return 'ffmpeg'
  } catch {
    return null
  }
}

let cached: EncoderInfo | null = null

/**
 * Find a usable ffmpeg, preferring an explicitly configured one so a user can
 * always override a broken bundled binary.
 */
export async function resolveFfmpeg(configuredPath: string | null): Promise<EncoderInfo> {
  if (cached && cached.source !== 'none') return cached

  const candidates: Array<[EncoderInfo['source'], string | null]> = [
    ['setting', (await isExecutable(configuredPath)) ? configuredPath : null],
    ['bundled', await bundledFfmpeg()],
    ['path', await ffmpegOnPath()]
  ]

  for (const [source, path] of candidates) {
    if (!path) continue
    const version = await probeVersion(path)
    if (!version) continue
    cached = { available: true, path, source, version }
    return cached
  }

  cached = { available: false, path: null, source: 'none', version: null }
  return cached
}

/** Forget the cached resolution, e.g. after the user edits the ffmpeg setting. */
export function invalidateFfmpegCache(): void {
  cached = null
}

async function probeVersion(path: string): Promise<string | null> {
  try {
    const { stdout } = await run(path, ['-version'], { timeout: 10_000 })
    return stdout.split('\n', 1)[0]?.trim() ?? 'unknown'
  } catch {
    return null
  }
}

export interface ProcessingOptions {
  /** Spectral noise reduction strength. */
  noiseReduction: NoiseReduction
  /** Presence EQ plus gentle compression, to even out a spoken take. */
  voiceEnhance: boolean
  /** Total gain to apply, already including any normalisation offset. */
  gainDb: number
  /** Downmix to a single channel. Required for 3D positional sounds. */
  mono: boolean
}

/**
 * The ffmpeg `-af` chain for a take, in the order the stages have to run:
 * clean up the signal, then shape it, then set the level, then catch anything
 * the shaping pushed over full scale.
 *
 * Kept separate from the ffmpeg call so the chain itself can be unit tested —
 * a wrong filter here is silently audible rather than loud, and a typo'd filter
 * name fails the whole export.
 */
export function buildFilterChain(options: ProcessingOptions): string[] {
  const filters: string[] = []

  if (options.noiseReduction !== 'off') {
    // Rumble, handling noise and mains hum all live below a speaking voice.
    filters.push('highpass=f=80')
    // afftdn subtracts a noise profile in the frequency domain. `nr` is how
    // hard it pulls; past ~24 dB speech starts sounding underwater.
    filters.push(
      options.noiseReduction === 'strong' ? 'afftdn=nr=20:nf=-20' : 'afftdn=nr=10:nf=-30'
    )
  }

  if (options.voiceEnhance) {
    // Cut the boxiness a close mic adds, lift the consonant range that carries
    // intelligibility over game audio, then even out the loud and quiet words.
    filters.push('equalizer=f=200:t=q:w=1:g=-2')
    filters.push('equalizer=f=3000:t=q:w=1.5:g=3')
    filters.push('acompressor=threshold=-18dB:ratio=3:attack=10:release=120:makeup=2')
  }

  // Rounded because ffmpeg parses this as a literal and long floats add noise
  // to the command line without changing the result audibly.
  if (Math.abs(options.gainDb) > 0.01) {
    filters.push(`volume=${options.gainDb.toFixed(2)}dB`)
  }

  // Makeup gain and a presence boost can both push peaks past 0 dBFS, which
  // clips on the way into Vorbis. The limiter only engages when they do.
  if (options.voiceEnhance) filters.push('alimiter=limit=0.95')

  return filters
}

export interface EncodeOptions extends ProcessingOptions {
  /** Ogg Vorbis VBR quality, -1 (worst) to 10 (best). 5 is roughly 160 kbps. */
  quality: number
  /** Seconds to drop from the start. */
  trimStart: number
  /** Absolute end position in seconds, or null to keep to the end. */
  trimEnd: number | null
}

/**
 * Gain needed to bring a known peak up (or down) to `targetPeakDb`.
 *
 * We measure the true peak while recording and store it on the take, so peak
 * normalisation is exact arithmetic here rather than an ffmpeg analysis pass.
 * A silent take has no peak to normalise against, so it is left alone.
 */
export function normalizationGainDb(peak: number, targetPeakDb: number): number {
  if (peak <= 0) return 0
  const currentDb = 20 * Math.log10(peak)
  return targetPeakDb - currentDb
}

/**
 * Encode a WAV master to Ogg Vorbis, which is the only codec Minecraft's sound
 * engine accepts. Opus in an .ogg container will silently fail to load in-game,
 * so `-c:a libvorbis` is not negotiable here.
 */
export async function encodeWavToOgg(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  options: EncodeOptions
): Promise<void> {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y']

  if (options.trimStart > 0) args.push('-ss', options.trimStart.toFixed(4))
  args.push('-i', inputPath)
  if (options.trimEnd !== null && options.trimEnd > options.trimStart) {
    args.push('-t', (options.trimEnd - options.trimStart).toFixed(4))
  }

  const filters = buildFilterChain(options)
  if (filters.length > 0) args.push('-af', filters.join(','))
  // `-ac 1` downmixes correctly whatever the input channel count is; an
  // explicit pan filter would fail outright on already-mono input.
  if (options.mono) args.push('-ac', '1')

  args.push('-c:a', 'libvorbis', '-q:a', String(options.quality), outputPath)

  try {
    await run(ffmpegPath, args, { timeout: 120_000, maxBuffer: 1024 * 1024 })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`ffmpeg failed encoding ${inputPath}: ${detail}`)
  }
}

/**
 * Render a take through the same processing the export will apply, as a WAV the
 * renderer can play. Cleanup you cannot hear until after you export is cleanup
 * nobody will trust.
 */
export async function renderProcessedWav(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  options: ProcessingOptions & { trimStart: number; trimEnd: number | null }
): Promise<void> {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y']

  if (options.trimStart > 0) args.push('-ss', options.trimStart.toFixed(4))
  args.push('-i', inputPath)
  if (options.trimEnd !== null && options.trimEnd > options.trimStart) {
    args.push('-t', (options.trimEnd - options.trimStart).toFixed(4))
  }

  const filters = buildFilterChain(options)
  if (filters.length > 0) args.push('-af', filters.join(','))
  if (options.mono) args.push('-ac', '1')

  args.push('-c:a', 'pcm_s16le', '-f', 'wav', outputPath)

  try {
    await run(ffmpegPath, args, { timeout: 60_000, maxBuffer: 1024 * 1024 })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`ffmpeg failed processing ${inputPath}: ${detail}`)
  }
}
