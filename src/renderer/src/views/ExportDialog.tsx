import { useEffect, useState } from 'react'
import type { ExportProgress, ExportResult, ValidationIssue } from '@shared/types'
import { useApp } from '../store/app-store'
import Modal from '../components/Modal'
import { formatBytes } from '../lib/format'
import type { JSX } from 'react'

interface ExportDialogProps {
  onClose: () => void
}

export default function ExportDialog({ onClose }: ExportDialogProps): JSX.Element {
  const project = useApp((s) => s.project)
  const projectDir = useApp((s) => s.projectDir)
  const settings = useApp((s) => s.settings)
  const encoder = useApp((s) => s.encoder)
  const save = useApp((s) => s.save)

  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)
  // The per-instance game folder, which is the only place Minecraft looks.
  const gameDir = settings?.minecraftGameDir ?? null
  const [installToMinecraft, setInstallToMinecraft] = useState(Boolean(gameDir))
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    void window.voicepack.exporter.validate(project).then(setIssues)
  }, [project])

  useEffect(() => window.voicepack.exporter.onProgress(setProgress), [])

  if (!project || !projectDir) {
    return (
      <Modal title="Export" onClose={onClose}>
        <p className="text-sm text-ink-400">No project is open.</p>
      </Modal>
    )
  }

  const errors = issues?.filter((i) => i.severity === 'error') ?? []
  const warnings = issues?.filter((i) => i.severity === 'warning') ?? []
  const blocked = errors.length > 0 || !encoder?.available
  const running = progress !== null && progress.phase !== 'done' && !result

  const run = async (): Promise<void> => {
    setFailure(null)
    const outPath = await window.voicepack.exporter.pickPath(project.name)
    if (!outPath) return

    // Flush pending edits first so what ships matches what's on screen.
    await save()

    setProgress({ phase: 'encoding', progress: 0, message: 'Starting...' })
    const exported = await window.voicepack.exporter.run(projectDir, project, {
      outPath,
      installToMinecraft
    })
    if (exported.ok) setResult(exported.value)
    else {
      setFailure(exported.error)
      setProgress(null)
    }
  }

  return (
    <Modal
      title="Export resource pack"
      onClose={onClose}
      footer={
        result ? (
          <>
            <button className="btn-outline" onClick={() => void window.voicepack.project.reveal(result.outPath)}>
              Show file
            </button>
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost" onClick={onClose} disabled={running}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => void run()} disabled={blocked || running}>
              {running ? 'Exporting...' : 'Choose location and export'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="text-grass-300">Pack exported.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ink-300">
            <dt className="text-ink-500">File</dt>
            <dd className="selectable break-all font-mono text-xs">{result.outPath}</dd>
            <dt className="text-ink-500">Size</dt>
            <dd>{formatBytes(result.bytes)}</dd>
            <dt className="text-ink-500">Events</dt>
            <dd>{result.eventCount}</dd>
            {result.installedTo && (
              <>
                <dt className="text-ink-500">Installed</dt>
                <dd className="selectable break-all font-mono text-xs">{result.installedTo}</dd>
              </>
            )}
          </dl>
          {result.warnings.length > 0 && (
            <IssueList title="Exported with warnings" items={result.warnings} tone="warning" />
          )}
          <p className="text-xs text-ink-500">
            In Minecraft, open Options &rarr; Resource Packs and move it to the active column.
          </p>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {!encoder?.available && (
            <div className="rounded border border-redstone-600 bg-redstone-600/10 p-3 text-xs text-redstone-400">
              <p className="font-medium">No audio encoder available.</p>
              <p className="mt-1">
                Minecraft only plays Ogg Vorbis, which needs ffmpeg. Install ffmpeg, or set its path
                in Settings.
              </p>
            </div>
          )}

          {issues === null ? (
            <p className="text-ink-500">Checking the pack...</p>
          ) : (
            <>
              {errors.length > 0 && (
                <IssueList
                  title={`${errors.length} problem${errors.length === 1 ? '' : 's'} to fix first`}
                  items={errors.map(describe)}
                  tone="error"
                />
              )}
              {warnings.length > 0 && (
                <IssueList
                  title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
                  items={warnings.map(describe)}
                  tone="warning"
                />
              )}
              {errors.length === 0 && warnings.length === 0 && (
                <p className="text-grass-300">Everything checks out.</p>
              )}
            </>
          )}

          <label className="flex items-center gap-2 text-xs text-ink-300">
            <input
              type="checkbox"
              className="accent-grass-500"
              checked={installToMinecraft}
              disabled={!gameDir}
              onChange={(e) => setInstallToMinecraft(e.target.checked)}
            />
            Also copy into my resourcepacks folder
            {!settings?.minecraftDir && (
              <span className="text-ink-500">(set your Minecraft folder in Settings)</span>
            )}
          </label>

          {progress && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full bg-grass-500 transition-all"
                  style={{ width: `${(progress.progress ?? 0.5) * 100}%` }}
                />
              </div>
              <p className="text-xs text-ink-400">{progress.message}</p>
            </div>
          )}

          {failure && (
            <pre className="selectable whitespace-pre-wrap rounded border border-redstone-600 bg-redstone-600/10 p-3 text-xs text-redstone-400">
              {failure}
            </pre>
          )}
        </div>
      )}
    </Modal>
  )
}

function describe(issue: ValidationIssue): string {
  return issue.eventId ? `${issue.eventId} — ${issue.message}` : issue.message
}

interface IssueListProps {
  title: string
  items: string[]
  tone: 'error' | 'warning'
}

function IssueList({ title, items, tone }: IssueListProps): JSX.Element {
  const color = tone === 'error' ? 'text-redstone-400' : 'text-amber-400'
  return (
    <div>
      <p className={`text-xs font-medium ${color}`}>{title}</p>
      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-ink-400">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="font-mono">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
