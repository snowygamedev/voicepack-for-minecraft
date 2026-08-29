import { z } from 'zod'
import { SOUND_CATEGORIES } from './sound-categories'

/**
 * Bump when a change to `projectSchema` can't be read by an older build.
 * `migrateProject` in main is responsible for lifting older files forward.
 */
export const PROJECT_SCHEMA_VERSION = 1

/** One recorded audio file on disk. Several takes can exist per event. */
export const takeSchema = z.object({
  id: z.string().min(1),
  /** Path relative to the project directory, POSIX separators. */
  file: z.string().min(1),
  /** Seconds. */
  duration: z.number().nonnegative(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().min(1).max(2),
  /** Peak amplitude 0..1, measured at record time; drives the clipping warning. */
  peak: z.number().min(0).max(1).default(0),
  recordedAt: z.string().datetime(),
  label: z.string().default(''),
  /** Non-destructive edits, applied at export. */
  trimStart: z.number().nonnegative().default(0),
  trimEnd: z.number().nonnegative().nullable().default(null),
  gainDb: z.number().default(0),
  /** Per-take fields that map onto sounds.json entries. */
  volume: z.number().min(0).max(1).default(1),
  pitch: z.number().min(0.5).max(2).default(1),
  weight: z.number().int().min(1).default(1)
})

/** A vanilla sound event the user has decided to replace. */
export const soundBindingSchema = z.object({
  eventId: z.string().min(1),
  category: z.enum(SOUND_CATEGORIES),
  /** When false the event is kept in the project but skipped on export. */
  enabled: z.boolean().default(true),
  /**
   * true  → our sounds replace vanilla's entirely.
   * false → ours are added to the vanilla pool and picked at random.
   */
  replace: z.boolean().default(true),
  /** Optional subtitle override; null keeps vanilla's. */
  subtitle: z.string().nullable().default(null),
  takes: z.array(takeSchema).default([]),
  /** Which take is exported. null = export every take as a weighted pool. */
  activeTakeId: z.string().nullable().default(null)
})

export const projectSchema = z.object({
  schemaVersion: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().default(''),
  packFormat: z.number().int().positive(),
  /** Optional pack.mcmeta `supported_formats` range for multi-version packs. */
  supportedFormats: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .nullable()
    .default(null),
  /** Namespace under assets/ — almost always "minecraft" for replacements. */
  namespace: z.string().min(1).default('minecraft'),
  createdAt: z.string().datetime(),
  modifiedAt: z.string().datetime(),
  bindings: z.array(soundBindingSchema).default([])
})

export const appSettingsSchema = z.object({
  recentProjects: z.array(z.string()).default([]),
  /** Explicit ffmpeg path; null means "resolve automatically". */
  ffmpegPath: z.string().nullable().default(null),
  /** The detected/chosen install root: a `.minecraft`, or a launcher data dir. */
  minecraftDir: z.string().nullable().default(null),
  /** Client jar of the version whose sounds we read and preview. */
  minecraftJarPath: z.string().nullable().default(null),
  /**
   * The `.minecraft`-equivalent folder of the chosen version, which is where
   * "install into Minecraft" drops the pack. Not always under `minecraftDir`:
   * Prism keeps one shared jar store and a game folder per instance.
   */
  minecraftGameDir: z.string().nullable().default(null),
  /** Ogg Vorbis quality, -1..10 (ffmpeg -q:a). 5 ≈ 160 kbps. */
  oggQuality: z.number().min(-1).max(10).default(5),
  inputDeviceId: z.string().nullable().default(null),
  /** Downmix to mono on export — required for 3D positional sounds. */
  forceMono: z.boolean().default(true),
  normalizeOnExport: z.boolean().default(false),
  /**
   * Gain every new take starts at. A mic that always records 6 dB low is a
   * property of the setup, not of one recording, so it belongs here rather than
   * being dialled in on every take.
   */
  defaultGainDb: z.number().min(-24).max(24).default(0),
  /** Trim the silence before the first sound off a new recording. */
  autoTrimSilence: z.boolean().default(true),
  /** Spectral noise reduction applied on export, and in the cleaned preview. */
  noiseReduction: z.enum(['off', 'light', 'strong']).default('light'),
  /** Presence EQ plus gentle compression, for spoken takes. */
  voiceEnhance: z.boolean().default(true),
  targetPeakDb: z.number().min(-30).max(0).default(-1),
  /** Width of the sound-list pane in px, so the layout survives a restart. */
  browserWidth: z.number().min(200).max(720).default(300)
})

export type Take = z.infer<typeof takeSchema>
export type SoundBinding = z.infer<typeof soundBindingSchema>
export type Project = z.infer<typeof projectSchema>
export type AppSettings = z.infer<typeof appSettingsSchema>
