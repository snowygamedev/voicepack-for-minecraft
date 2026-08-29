import { useEffect, useState } from 'react'
import { useApp, useSelectedBinding, useSelectedInPack } from './store/app-store'
import EventBrowser from './components/EventBrowser'
import EventDetail from './views/EventDetail'
import Welcome from './views/Welcome'
import ResizeHandle, { DEFAULT_BROWSER_WIDTH } from './components/ResizeHandle'
import ExportDialog from './views/ExportDialog'
import MergeDialog from './views/MergeDialog'
import SettingsDialog from './views/SettingsDialog'
import type { JSX } from 'react'

/** How long after the last edit we write project.json. */
const AUTOSAVE_DELAY_MS = 1200

/** How far the sound list can be dragged. Narrower and ids stop being legible. */
const MIN_BROWSER_WIDTH = 220
const MAX_BROWSER_WIDTH = 720

export default function App(): JSX.Element {
  const bootstrap = useApp((s) => s.bootstrap)
  const project = useApp((s) => s.project)
  const projectDir = useApp((s) => s.projectDir)
  const dirty = useApp((s) => s.dirty)
  const saving = useApp((s) => s.saving)
  const error = useApp((s) => s.error)
  const busy = useApp((s) => s.busy)
  const setError = useApp((s) => s.setError)
  const save = useApp((s) => s.save)
  const closeProject = useApp((s) => s.closeProject)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const binding = useSelectedBinding()
  const inPack = useSelectedInPack()

  const [booted, setBooted] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  // Driven locally while dragging — writing to settings on every pointer move
  // would mean a disk write per frame.
  const [browserWidth, setBrowserWidth] = useState(DEFAULT_BROWSER_WIDTH)

  const savedBrowserWidth = settings?.browserWidth
  useEffect(() => {
    if (savedBrowserWidth !== undefined) setBrowserWidth(savedBrowserWidth)
  }, [savedBrowserWidth])

  useEffect(() => {
    void bootstrap()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBooted(true))
  }, [bootstrap, setError])

  // Debounced autosave. Recordings are already on disk by this point; this only
  // persists the metadata, so a lost tick costs a label, not audio.
  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dirty, save, project])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === 's') {
        event.preventDefault()
        void save()
      }
      if (event.key === 'e' && project) {
        event.preventDefault()
        setShowExport(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, project])

  if (!booted) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-500">Loading...</div>
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-800 bg-ink-900 px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-sm font-semibold">VoicePack</span>
          {project && (
            <>
              <span className="truncate text-sm text-ink-300">{project.name}</span>
              <span className="shrink-0 text-xs text-ink-600">
                {saving ? 'Saving...' : dirty ? 'Unsaved changes' : 'Saved'}
              </span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button className="btn-ghost" onClick={() => setShowSettings(true)}>
            Settings
          </button>
          {project && (
            <>
              <button
                className="btn-ghost"
                onClick={() => projectDir && void window.voicepack.project.reveal(projectDir)}
              >
                Open folder
              </button>
              <button className="btn-ghost" onClick={() => setShowMerge(true)}>
                Merge pack
              </button>
              <button className="btn-ghost" onClick={closeProject}>
                Close
              </button>
              <button className="btn-primary" onClick={() => setShowExport(true)}>
                Export pack
              </button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-redstone-600 bg-redstone-600/10 px-4 py-2 text-xs text-redstone-400">
          <span className="selectable">{error}</span>
          <button className="shrink-0 text-ink-400 hover:text-ink-200" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {busy && (
        <div className="shrink-0 border-b border-ink-800 bg-ink-900 px-4 py-1.5 text-xs text-ink-400">
          {busy}
        </div>
      )}

      <main className="min-h-0 flex-1">
        {!project ? (
          <Welcome />
        ) : (
          <div
            className="grid h-full min-h-0"
            style={{
              gridTemplateColumns: `${browserWidth}px 4px minmax(0, 1fr)`,
              // An auto row would grow to fit the whole event list, leaving the
              // pane taller than the window and nothing able to scroll.
              gridTemplateRows: 'minmax(0, 1fr)'
            }}
          >
            <EventBrowser />
            <ResizeHandle
              width={browserWidth}
              min={MIN_BROWSER_WIDTH}
              max={MAX_BROWSER_WIDTH}
              onResize={setBrowserWidth}
              onCommit={(width) => void updateSettings({ browserWidth: width })}
            />
            {binding ? (
              <EventDetail key={binding.eventId} binding={binding} inPack={inPack} />
            ) : (
              <EmptyDetail count={project.bindings.length} />
            )}
          </div>
        )}
      </main>

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showMerge && <MergeDialog onClose={() => setShowMerge(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function EmptyDetail({ count }: { count: number }): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-sm text-ink-300">
          {count === 0 ? 'This pack is empty.' : 'Pick an event to record.'}
        </p>
        <p className="text-xs text-ink-500">
          Search on the left and click a sound event to open it. Nothing joins your pack until you
          record a take for it.
        </p>
      </div>
    </div>
  )
}
