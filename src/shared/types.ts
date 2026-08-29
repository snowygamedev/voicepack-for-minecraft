import type { Project, AppSettings, Take, SoundBinding } from './schema'
import type { SoundCategory } from './sound-categories'

export type { Project, AppSettings, Take, SoundBinding, SoundCategory }

/** A project as held in memory, plus where it lives. */
export interface OpenProject {
  /** Absolute path to the project directory. */
  dir: string
  project: Project
}

/** One entry in the sound-event catalog the user picks from. */
export interface CatalogEvent {
  id: string
  category: SoundCategory
  /** Vanilla subtitle key, when known — helps users recognise the sound. */
  subtitle?: string
  /**
   * How many variant files vanilla ships for this event. Useful context: an
   * event with 4 variants sounds repetitive if you only record one.
   */
  variantCount?: number
  /** Where this entry came from, so the UI can show provenance. */
  source: 'seed' | 'scan'
}

export interface Catalog {
  events: CatalogEvent[]
  /** Minecraft version the scanned portion came from, if any. */
  scannedVersion: string | null
}

/** Which launcher a detected install came from. Drives labels and layout. */
export type LauncherKind = 'vanilla' | 'prism' | 'multimc' | 'polymc' | 'custom'

/**
 * One playable target the user can build a pack for.
 *
 * For the vanilla launcher this is a version folder. For instance-based
 * launchers (Prism and its MultiMC ancestors) it is an *instance*: the jar and
 * assets are shared launcher-wide, but each instance has its own game folder,
 * which is where a finished pack has to be installed.
 */
export interface MinecraftVersion {
  /** Minecraft version id, e.g. "1.21.4". */
  id: string
  /** What the picker shows — the instance name, when there is one. */
  label: string
  jarPath: string
  /** Asset index name, e.g. "16" or "1.21" — needed to resolve original audio. */
  assetIndex: string | null
  /** Folder holding `indexes/` and `objects/` for this target. */
  assetsDir: string
  /** The `.minecraft`-equivalent folder — where `resourcepacks/` lives. */
  gameDir: string
}

export interface MinecraftInstall {
  /** The folder we detected: a `.minecraft`, or a launcher data directory. */
  root: string
  kind: LauncherKind
  /** Human name for the launcher, e.g. "Prism Launcher". */
  label: string
  versions: MinecraftVersion[]
}

/** How hard the noise filter pulls, or off. */
export type NoiseReduction = 'off' | 'light' | 'strong'

/** What to do with an event both packs have recorded. */
export type MergeMode = 'skip' | 'append' | 'replace'

/** One event's fate in a merge, worked out before anything is copied. */
export interface MergePlanEntry {
  eventId: string
  /**
   * add     - the target does not have this event at all
   * fill    - the target has it, but with nothing recorded
   * append  - keep both packs' takes
   * replace - the incoming takes win
   * skip    - leave the target's version alone
   */
  action: 'add' | 'fill' | 'append' | 'replace' | 'skip'
  /** How many takes the source pack has for it. */
  takes: number
}

/** What a finished merge did, for the "here's what happened" summary. */
export interface MergeSummary {
  sourceName: string
  added: string[]
  filled: string[]
  appended: string[]
  replaced: string[]
  skipped: string[]
  copiedFiles: number
  /** The packs target different Minecraft versions — worth a word to the user. */
  packFormatDiffers: boolean
}

export interface MergeResult {
  project: Project
  summary: MergeSummary
}

export interface RecordingResult {
  take: Take
}

export interface ExportOptions {
  /** Absolute path of the .zip to write. */
  outPath: string
  /** Also copy the finished pack into .minecraft/resourcepacks. */
  installToMinecraft: boolean
}

export interface ExportProgress {
  phase: 'encoding' | 'writing' | 'zipping' | 'installing' | 'done'
  /** 0..1, or null when indeterminate. */
  progress: number | null
  message: string
}

export interface ExportResult {
  outPath: string
  installedTo: string | null
  bytes: number
  eventCount: number
  fileCount: number
  warnings: string[]
}

/** A problem found by pre-export validation. */
export interface ValidationIssue {
  severity: 'error' | 'warning'
  eventId: string | null
  message: string
}

export interface EncoderInfo {
  available: boolean
  /** Resolved ffmpeg path, or null when nothing usable was found. */
  path: string | null
  source: 'setting' | 'bundled' | 'path' | 'none'
  version: string | null
}

/** Generic envelope so the renderer never has to catch across the bridge. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
