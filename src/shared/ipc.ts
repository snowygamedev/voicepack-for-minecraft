import type {
  AppSettings,
  Catalog,
  EncoderInfo,
  ExportOptions,
  ExportProgress,
  ExportResult,
  MergeMode,
  MergeResult,
  MinecraftInstall,
  OpenProject,
  Project,
  Result,
  Take,
  ValidationIssue
} from './types'

/**
 * Every IPC channel in the app, declared once. Main registers exactly these and
 * preload exposes exactly these — nothing else crosses the bridge.
 */
export const CH = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  projectCreate: 'project:create',
  projectOpen: 'project:open',
  projectOpenPath: 'project:open-path',
  projectPickNewDir: 'project:pick-new-dir',
  projectSave: 'project:save',
  projectPickMergeSource: 'project:pick-merge-source',
  projectMerge: 'project:merge',
  projectReveal: 'project:reveal',

  catalogGet: 'catalog:get',
  catalogScan: 'catalog:scan',

  minecraftDetect: 'minecraft:detect',
  minecraftPickDir: 'minecraft:pick-dir',
  minecraftOriginalAudio: 'minecraft:original-audio',

  takeWrite: 'take:write',
  takeRead: 'take:read',
  takeProcessed: 'take:processed',
  takeDelete: 'take:delete',

  encoderInfo: 'encoder:info',

  exportPickPath: 'export:pick-path',
  exportValidate: 'export:validate',
  exportRun: 'export:run',
  /** main → renderer, push. */
  exportProgress: 'export:progress'
} as const

export interface NewProjectRequest {
  /** Absolute path of the directory to create. */
  dir: string
  name: string
  description: string
  packFormat: number
}

/** The trim/gain of the take being previewed, which processing has to match. */
export interface TakeRange {
  trimStart: number
  trimEnd: number | null
  gainDb: number
}

export interface WriteTakeRequest {
  projectDir: string
  eventId: string
  /** 16-bit PCM WAV bytes produced by the renderer. */
  wav: ArrayBuffer
  durationSeconds: number
  sampleRate: number
  channels: number
  peak: number
}

/** The surface exposed on `window.voicepack`. */
export interface VoicePackApi {
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  project: {
    /** Choose where a new project directory should be created. null = cancelled. */
    pickNewDir(defaultName: string): Promise<string | null>
    create(req: NewProjectRequest): Promise<Result<OpenProject>>
    /** Opens a directory picker, then loads. Resolves null if cancelled. */
    open(): Promise<Result<OpenProject | null>>
    openPath(dir: string): Promise<Result<OpenProject>>
    save(dir: string, project: Project): Promise<Result<Project>>
    /** Pick another pack to merge in, and read it. null = cancelled. */
    pickMergeSource(): Promise<Result<OpenProject | null>>
    /** Copy another pack's recordings into this one. */
    merge(dir: string, sourceDir: string, mode: MergeMode): Promise<Result<MergeResult>>
    reveal(dir: string): Promise<void>
  }
  catalog: {
    get(): Promise<Catalog>
    /** Merge events out of an installed Minecraft version's jar. */
    scan(jarPath: string): Promise<Result<Catalog>>
  }
  minecraft: {
    /** Every install we can find, across the launchers we know about. */
    detect(): Promise<Result<MinecraftInstall[]>>
    pickDir(): Promise<Result<MinecraftInstall | null>>
    /** Resolve a vanilla sound to playable bytes from the user's own install. */
    originalAudio(eventId: string): Promise<Result<ArrayBuffer | null>>
  }
  takes: {
    write(req: WriteTakeRequest): Promise<Result<Take>>
    /** Read a take back for waveform rendering / playback. */
    read(projectDir: string, file: string): Promise<Result<ArrayBuffer>>
    /**
     * The same take run through the export's noise filter and voice enhancer,
     * as playable WAV bytes.
     */
    processed(projectDir: string, file: string, take: TakeRange): Promise<Result<ArrayBuffer>>
    delete(projectDir: string, file: string): Promise<Result<void>>
  }
  encoder: {
    info(): Promise<EncoderInfo>
  }
  exporter: {
    pickPath(defaultName: string): Promise<string | null>
    validate(project: Project): Promise<ValidationIssue[]>
    run(dir: string, project: Project, options: ExportOptions): Promise<Result<ExportResult>>
    onProgress(cb: (p: ExportProgress) => void): () => void
  }
}
