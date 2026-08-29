import { create } from 'zustand'
import type {
  AppSettings,
  Catalog,
  EncoderInfo,
  MergeMode,
  MergeSummary,
  MinecraftInstall,
  MinecraftVersion,
  Project,
  SoundBinding,
  Take
} from '@shared/types'
import { guessCategory } from '@shared/sound-categories'

interface AppState {
  // ---- loaded context ----
  settings: AppSettings | null
  catalog: Catalog
  /** Every Minecraft install we found, across launchers. */
  installs: MinecraftInstall[]
  /** The one we are reading sound events from. */
  install: MinecraftInstall | null
  encoder: EncoderInfo | null

  // ---- the open project ----
  projectDir: string | null
  project: Project | null
  dirty: boolean
  saving: boolean

  // ---- ui ----
  selectedEventId: string | null
  /**
   * The event the user is looking at while it is *not* yet part of the pack.
   * Nothing is added to the project by browsing or by tweaking settings here —
   * recording a take is what commits it.
   */
  draft: SoundBinding | null
  error: string | null
  busy: string | null

  bootstrap: () => Promise<void>
  setError: (message: string | null) => void
  setBusy: (message: string | null) => void

  newProject: (name: string, description: string, packFormat: number) => Promise<boolean>
  openProject: () => Promise<void>
  openProjectPath: (dir: string) => Promise<void>
  closeProject: () => void
  save: () => Promise<void>
  /** Copy another pack's recordings into this one. null when it failed. */
  mergeFrom: (sourceDir: string, mode: MergeMode) => Promise<MergeSummary | null>

  updateProject: (patch: Partial<Project>) => void
  selectEvent: (eventId: string | null) => void
  addEvent: (eventId: string) => void
  /** Add many at once, from a pasted list. Returns what actually happened. */
  addEvents: (eventIds: string[]) => { added: string[]; already: string[] }
  removeEvent: (eventId: string) => void
  updateBinding: (eventId: string, patch: Partial<SoundBinding>) => void
  addTake: (eventId: string, take: Take) => void
  updateTake: (eventId: string, takeId: string, patch: Partial<Take>) => void
  removeTake: (eventId: string, takeId: string) => Promise<void>

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  detectMinecraft: () => Promise<void>
  chooseMinecraftDir: () => Promise<void>
  scanVersion: (jarPath: string) => Promise<void>
}

/** A binding as it looks before anything has been recorded into it. */
function blankBinding(eventId: string, category?: SoundBinding['category']): SoundBinding {
  return {
    eventId,
    category: category ?? guessCategory(eventId),
    enabled: true,
    replace: true,
    subtitle: null,
    takes: [],
    activeTakeId: null
  }
}

/** Newest version first, preferring one whose assets we can actually read. */
function preferredVersion(installs: MinecraftInstall[]): MinecraftVersion | null {
  const versions = installs.flatMap((i) => i.versions)
  return versions.find((v) => v.assetIndex !== null) ?? versions[0] ?? null
}

/** Replace one binding, leaving the rest of the project untouched. */
function patchBinding(
  project: Project,
  eventId: string,
  patch: (binding: SoundBinding) => SoundBinding
): Project {
  return {
    ...project,
    bindings: project.bindings.map((b) => (b.eventId === eventId ? patch(b) : b))
  }
}

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  catalog: { events: [], scannedVersion: null },
  installs: [],
  install: null,
  encoder: null,

  projectDir: null,
  project: null,
  dirty: false,
  saving: false,

  selectedEventId: null,
  draft: null,
  error: null,
  busy: null,

  async bootstrap() {
    const [settings, catalog, encoder] = await Promise.all([
      window.voicepack.settings.get(),
      window.voicepack.catalog.get(),
      window.voicepack.encoder.info()
    ])
    set({ settings, catalog, encoder })

    // The event list only ever comes from the user's own install, so finding one
    // and reading it is part of starting up — not a nice-to-have.
    await get().detectMinecraft()

    // Reopen the most recent project so launching the app lands you back at work.
    const recent = settings.recentProjects[0]
    if (recent) {
      const reopened = await window.voicepack.project.openPath(recent)
      if (reopened.ok) {
        set({ projectDir: reopened.value.dir, project: reopened.value.project, dirty: false })
      }
    }
  },

  setError: (error) => set({ error }),
  setBusy: (busy) => set({ busy }),

  async newProject(name, description, packFormat) {
    const dir = await window.voicepack.project.pickNewDir(name)
    if (!dir) return false

    const result = await window.voicepack.project.create({ dir, name, description, packFormat })
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    set({
      projectDir: result.value.dir,
      project: result.value.project,
      dirty: false,
      selectedEventId: null
    })
    return true
  },

  async openProject() {
    const result = await window.voicepack.project.open()
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    if (!result.value) return
    set({
      projectDir: result.value.dir,
      project: result.value.project,
      dirty: false,
      selectedEventId: null
    })
  },

  async openProjectPath(dir) {
    const result = await window.voicepack.project.openPath(dir)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set({
      projectDir: result.value.dir,
      project: result.value.project,
      dirty: false,
      selectedEventId: null
    })
  },

  closeProject: () =>
    set({ projectDir: null, project: null, dirty: false, selectedEventId: null }),

  async save() {
    const { projectDir, project, saving } = get()
    if (!projectDir || !project || saving) return
    set({ saving: true })
    const result = await window.voicepack.project.save(projectDir, project)
    if (result.ok) set({ project: result.value, dirty: false, saving: false })
    else set({ error: result.error, saving: false })
  },

  /**
   * Merge runs against project.json on disk, so anything unsaved has to land
   * first — otherwise the merge would be written on top of a stale file and the
   * user's last few edits would vanish.
   */
  async mergeFrom(sourceDir, mode) {
    const { projectDir, project } = get()
    if (!projectDir || !project) return null

    if (get().dirty) await get().save()
    set({ busy: 'Merging packs...' })
    const result = await window.voicepack.project.merge(projectDir, sourceDir, mode)
    set({ busy: null })

    if (!result.ok) {
      set({ error: result.error })
      return null
    }
    set({ project: result.value.project, dirty: false })
    return result.value.summary
  },

  updateProject: (patch) => {
    const { project } = get()
    if (!project) return
    set({ project: { ...project, ...patch }, dirty: true })
  },

  /**
   * Look at an event. Browsing never touches the project: if the event is not
   * already in the pack we hold an unsaved draft binding instead, so the pack
   * stays a list of sounds the user has actually recorded.
   */
  selectEvent: (eventId) => {
    if (eventId === null) {
      set({ selectedEventId: null, draft: null })
      return
    }
    const { project, catalog, draft } = get()
    if (project?.bindings.some((b) => b.eventId === eventId)) {
      set({ selectedEventId: eventId, draft: null })
      return
    }
    // Keep the existing draft when re-selecting the same event, so edits made
    // before the first take survive a trip through the list.
    const known = catalog.events.find((e) => e.id === eventId)
    set({
      selectedEventId: eventId,
      draft: draft?.eventId === eventId ? draft : blankBinding(eventId, known?.category)
    })
  },

  addEvent: (eventId) => {
    const { project, catalog, draft } = get()
    if (!project) return
    if (project.bindings.some((b) => b.eventId === eventId)) {
      set({ selectedEventId: eventId, draft: null })
      return
    }
    const known = catalog.events.find((e) => e.id === eventId)
    const binding =
      draft?.eventId === eventId ? draft : blankBinding(eventId, known?.category)
    set({
      project: { ...project, bindings: [...project.bindings, binding] },
      selectedEventId: eventId,
      draft: null,
      dirty: true
    })
  },

  /**
   * Bulk add, for a list pasted in from somewhere else. Unlike recording, this
   * commits bindings with no takes — that is the point: the pack becomes the
   * to-do list, and export leaves the unrecorded ones out with a warning.
   */
  addEvents: (eventIds) => {
    const { project, catalog } = get()
    if (!project) return { added: [], already: [] }

    const existing = new Set(project.bindings.map((b) => b.eventId))
    const added: string[] = []
    const already: string[] = []
    const bindings: SoundBinding[] = []

    for (const eventId of eventIds) {
      if (existing.has(eventId)) {
        already.push(eventId)
        continue
      }
      existing.add(eventId)
      added.push(eventId)
      bindings.push(blankBinding(eventId, catalog.events.find((e) => e.id === eventId)?.category))
    }

    if (bindings.length > 0) {
      set({ project: { ...project, bindings: [...project.bindings, ...bindings] }, dirty: true })
    }
    return { added, already }
  },

  removeEvent: (eventId) => {
    const { project, selectedEventId, catalog } = get()
    if (!project) return
    const known = catalog.events.find((e) => e.id === eventId)
    set({
      project: { ...project, bindings: project.bindings.filter((b) => b.eventId !== eventId) },
      // Stay on the event, now as a draft, rather than throwing the user back
      // to an empty pane for what is usually an undo-able mis-click.
      draft: selectedEventId === eventId ? blankBinding(eventId, known?.category) : get().draft,
      dirty: true
    })
  },

  updateBinding: (eventId, patch) => {
    const { project, draft } = get()
    if (draft?.eventId === eventId) {
      // Editing a draft must not mark the event as being in the pack.
      set({ draft: { ...draft, ...patch } })
      return
    }
    if (!project) return
    set({ project: patchBinding(project, eventId, (b) => ({ ...b, ...patch })), dirty: true })
  },

  /**
   * Recording is what puts an event in the pack. If this is the first take, the
   * draft binding (with whatever the user set up on it) is committed here.
   */
  addTake: (eventId, take) => {
    const { project, draft, catalog } = get()
    if (!project) return

    const withTake = (b: SoundBinding): SoundBinding => ({
      ...b,
      takes: [...b.takes, take],
      // A fresh recording becomes the one that exports, which is almost
      // always what someone wants right after hitting stop.
      activeTakeId: take.id
    })

    if (!project.bindings.some((b) => b.eventId === eventId)) {
      const known = catalog.events.find((e) => e.id === eventId)
      const base = draft?.eventId === eventId ? draft : blankBinding(eventId, known?.category)
      set({
        project: { ...project, bindings: [...project.bindings, withTake(base)] },
        selectedEventId: eventId,
        draft: null,
        dirty: true
      })
      return
    }

    set({ project: patchBinding(project, eventId, withTake), dirty: true })
  },

  updateTake: (eventId, takeId, patch) => {
    const { project } = get()
    if (!project) return
    set({
      project: patchBinding(project, eventId, (b) => ({
        ...b,
        takes: b.takes.map((t) => (t.id === takeId ? { ...t, ...patch } : t))
      })),
      dirty: true
    })
  },

  async removeTake(eventId, takeId) {
    const { project, projectDir } = get()
    if (!project || !projectDir) return

    const binding = project.bindings.find((b) => b.eventId === eventId)
    const take = binding?.takes.find((t) => t.id === takeId)
    if (!take) return

    const deleted = await window.voicepack.takes.delete(projectDir, take.file)
    if (!deleted.ok) {
      set({ error: deleted.error })
      return
    }

    set({
      project: patchBinding(project, eventId, (b) => {
        const takes = b.takes.filter((t) => t.id !== takeId)
        return {
          ...b,
          takes,
          activeTakeId: b.activeTakeId === takeId ? (takes[0]?.id ?? null) : b.activeTakeId
        }
      }),
      dirty: true
    })
  },

  async updateSettings(patch) {
    const settings = await window.voicepack.settings.update(patch)
    set({ settings })
    if ('ffmpegPath' in patch) set({ encoder: await window.voicepack.encoder.info() })
  },

  /**
   * Look for Minecraft everywhere we know to look, then read the event list out
   * of the most likely version. Silent on failure — the UI shows an empty
   * catalog and a "choose your folder" prompt, which is more useful than an
   * error banner on every launch for someone who has not installed the game.
   */
  async detectMinecraft() {
    const result = await window.voicepack.minecraft.detect()
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    const installs = result.value
    const settings = get().settings
    const chosen =
      installs.find((i) => i.root === settings?.minecraftDir) ?? installs[0] ?? null
    set({ installs, install: chosen })

    // Prefer the version the user last used; otherwise the newest we found.
    const remembered = installs
      .flatMap((i) => i.versions)
      .find((v) => v.jarPath === settings?.minecraftJarPath)
    const version = remembered ?? preferredVersion(chosen ? [chosen] : installs)
    if (version) await get().scanVersion(version.jarPath)
  },

  /** Point the app at a folder by hand, for installs we could not find. */
  async chooseMinecraftDir() {
    const result = await window.voicepack.minecraft.pickDir()
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    if (!result.value) return

    const install = result.value
    set({
      install,
      installs: [install, ...get().installs.filter((i) => i.root !== install.root)],
      settings: await window.voicepack.settings.get()
    })
    const version = preferredVersion([install])
    if (version) await get().scanVersion(version.jarPath)
  },

  async scanVersion(jarPath) {
    set({ busy: 'Reading sound events from your Minecraft install...' })
    const result = await window.voicepack.catalog.scan(jarPath)
    set({ busy: null })
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set({ catalog: result.value, settings: await window.voicepack.settings.get() })
  }
}))

/**
 * The binding for the currently selected event — the real one if it is in the
 * pack, otherwise the uncommitted draft so the detail view can still record.
 */
export function useSelectedBinding(): SoundBinding | null {
  return useApp((s) => {
    if (!s.project || !s.selectedEventId) return null
    return (
      s.project.bindings.find((b) => b.eventId === s.selectedEventId) ??
      (s.draft?.eventId === s.selectedEventId ? s.draft : null)
    )
  })
}

/** Whether the selected event has been committed to the pack (i.e. recorded). */
export function useSelectedInPack(): boolean {
  return useApp(
    (s) => !!s.selectedEventId && !!s.project?.bindings.some((b) => b.eventId === s.selectedEventId)
  )
}
