import { contextBridge, ipcRenderer } from 'electron'
import {
  CH,
  type NewProjectRequest,
  type TakeRange,
  type VoicePackApi,
  type WriteTakeRequest
} from '@shared/ipc'
import type {
  AppSettings,
  ExportOptions,
  ExportProgress,
  MergeMode,
  Project
} from '@shared/types'

/**
 * The whole renderer-visible surface. Every method here maps to exactly one
 * channel in `CH`; the renderer has no other way to reach Node.
 */
const api: VoicePackApi = {
  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(CH.settingsUpdate, patch)
  },
  project: {
    pickNewDir: (defaultName: string) => ipcRenderer.invoke(CH.projectPickNewDir, defaultName),
    create: (req: NewProjectRequest) => ipcRenderer.invoke(CH.projectCreate, req),
    open: () => ipcRenderer.invoke(CH.projectOpen),
    openPath: (dir: string) => ipcRenderer.invoke(CH.projectOpenPath, dir),
    save: (dir: string, project: Project) => ipcRenderer.invoke(CH.projectSave, dir, project),
    pickMergeSource: () => ipcRenderer.invoke(CH.projectPickMergeSource),
    merge: (dir: string, sourceDir: string, mode: MergeMode) =>
      ipcRenderer.invoke(CH.projectMerge, dir, sourceDir, mode),
    reveal: (dir: string) => ipcRenderer.invoke(CH.projectReveal, dir)
  },
  catalog: {
    get: () => ipcRenderer.invoke(CH.catalogGet),
    scan: (jarPath: string) => ipcRenderer.invoke(CH.catalogScan, jarPath)
  },
  minecraft: {
    detect: () => ipcRenderer.invoke(CH.minecraftDetect),
    pickDir: () => ipcRenderer.invoke(CH.minecraftPickDir),
    originalAudio: (eventId: string) => ipcRenderer.invoke(CH.minecraftOriginalAudio, eventId)
  },
  takes: {
    write: (req: WriteTakeRequest) => ipcRenderer.invoke(CH.takeWrite, req),
    read: (projectDir: string, file: string) => ipcRenderer.invoke(CH.takeRead, projectDir, file),
    processed: (projectDir: string, file: string, take: TakeRange) =>
      ipcRenderer.invoke(CH.takeProcessed, projectDir, file, take),
    delete: (projectDir: string, file: string) =>
      ipcRenderer.invoke(CH.takeDelete, projectDir, file)
  },
  encoder: {
    info: () => ipcRenderer.invoke(CH.encoderInfo)
  },
  exporter: {
    pickPath: (defaultName: string) => ipcRenderer.invoke(CH.exportPickPath, defaultName),
    validate: (project: Project) => ipcRenderer.invoke(CH.exportValidate, project),
    run: (dir: string, project: Project, options: ExportOptions) =>
      ipcRenderer.invoke(CH.exportRun, dir, project, options),
    onProgress: (cb: (p: ExportProgress) => void) => {
      // Only the payload is forwarded; the IpcRendererEvent must not leak into
      // the renderer, since it carries a live `sender` reference.
      const listener = (_event: unknown, payload: ExportProgress): void => cb(payload)
      ipcRenderer.on(CH.exportProgress, listener)
      return () => ipcRenderer.off(CH.exportProgress, listener)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('voicepack', api)
} else {
  // Only reachable if contextIsolation is ever turned off in dev.
  // @ts-expect-error -- augmenting window outside the bridge
  window.voicepack = api
}
