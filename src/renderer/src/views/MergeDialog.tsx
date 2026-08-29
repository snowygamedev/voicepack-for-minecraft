import { useMemo, useState } from 'react'
import { planMerge } from '@shared/merge'
import type { MergeMode, MergePlanEntry, MergeSummary, OpenProject } from '@shared/types'
import { useApp } from '../store/app-store'
import Modal from '../components/Modal'
import type { JSX } from 'react'

interface MergeDialogProps {
  onClose: () => void
}

const MODES: ReadonlyArray<{ value: MergeMode; label: string; hint: string }> = [
  { value: 'skip', label: 'Keep mine', hint: 'Leave my recording alone and ignore theirs.' },
  { value: 'append', label: 'Keep both', hint: 'Add their takes alongside mine.' },
  { value: 'replace', label: 'Use theirs', hint: 'Their takes replace mine on that event.' }
]

/**
 * Merge another pack's recordings into the open one. Built for the usual case:
 * two packs covering different sounds, where the merge is a straight union and
 * the only decision to make is what to do with the handful that overlap.
 */
export default function MergeDialog({ onClose }: MergeDialogProps): JSX.Element {
  const project = useApp((s) => s.project)
  const projectDir = useApp((s) => s.projectDir)
  const mergeFrom = useApp((s) => s.mergeFrom)
  const setError = useApp((s) => s.setError)

  const [source, setSource] = useState<OpenProject | null>(null)
  const [mode, setMode] = useState<MergeMode>('append')
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<MergeSummary | null>(null)

  const plan = useMemo<MergePlanEntry[]>(
    () => (project && source ? planMerge(project, source.project, mode) : []),
    [project, source, mode]
  )

  const counts = useMemo(() => {
    const by = (action: MergePlanEntry['action']): MergePlanEntry[] =>
      plan.filter((entry) => entry.action === action)
    return {
      add: by('add'),
      fill: by('fill'),
      conflicts: [...by('append'), ...by('replace'), ...by('skip')]
    }
  }, [plan])

  const pick = async (): Promise<void> => {
    const result = await window.voicepack.project.pickMergeSource()
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!result.value) return
    if (projectDir && result.value.dir === projectDir) {
      setError('That is the pack you already have open.')
      return
    }
    setSummary(null)
    setSource(result.value)
  }

  const run = async (): Promise<void> => {
    if (!source) return
    setRunning(true)
    const result = await mergeFrom(source.dir, mode)
    setRunning(false)
    if (result) setSummary(result)
  }

  if (summary) {
    return (
      <Modal
        title="Merged"
        onClose={onClose}
        footer={
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-300">
            Merged <span className="text-ink-100">{summary.sourceName}</span> in, copying{' '}
            {summary.copiedFiles} recording{summary.copiedFiles === 1 ? '' : 's'}.
          </p>
          <ul className="space-y-1 text-xs text-ink-400">
            <Line count={summary.added.length} text="new sound events added" />
            <Line count={summary.filled.length} text="sounds I had listed but not recorded" />
            <Line count={summary.appended.length} text="events now holding both packs' takes" />
            <Line count={summary.replaced.length} text="events replaced with theirs" />
            <Line count={summary.skipped.length} text="events left as they were" />
          </ul>
          {summary.replaced.length > 0 && (
            <p className="text-xs text-ink-500">
              The takes you replaced are still in your project folder — only the pack stopped
              pointing at them.
            </p>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Merge another pack"
      onClose={onClose}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => void run()}
            disabled={!source || running || plan.length === 0}
          >
            {running ? 'Merging...' : 'Merge in'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-xs text-ink-500">
          Pick another VoicePack project folder — the one with its <code>project.json</code> in it.
          Its recordings are copied into this pack; the other pack is never modified.
        </p>

        <div className="flex items-center gap-3">
          <button className="btn-outline" onClick={() => void pick()}>
            {source ? 'Choose a different pack...' : 'Choose pack...'}
          </button>
          {source && (
            <span className="min-w-0 truncate text-xs text-ink-400">
              <span className="text-ink-200">{source.project.name}</span> ·{' '}
              {source.project.bindings.length} event
              {source.project.bindings.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {source && (
          <>
            <ul className="space-y-1 text-xs text-ink-400">
              <Line count={counts.add.length} text="sounds this pack doesn't have yet" />
              <Line count={counts.fill.length} text="sounds I listed but never recorded" />
              <Line count={counts.conflicts.length} text="sounds we both recorded" />
            </ul>

            {counts.conflicts.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-xs text-ink-400">
                  For the {counts.conflicts.length} we both recorded:
                </legend>
                {MODES.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 hover:bg-ink-800"
                  >
                    <input
                      type="radio"
                      name="merge-mode"
                      checked={mode === option.value}
                      onChange={() => setMode(option.value)}
                    />
                    <span className="text-sm text-ink-200">{option.label}</span>
                    <span className="text-xs text-ink-500">{option.hint}</span>
                  </label>
                ))}
                <ul className="max-h-32 overflow-y-auto pl-2 font-mono text-[11px] text-ink-500">
                  {counts.conflicts.map((entry) => (
                    <li key={entry.eventId}>{entry.eventId}</li>
                  ))}
                </ul>
              </fieldset>
            )}

            {source.project.packFormat !== project?.packFormat && (
              <p className="rounded border border-ink-700 bg-ink-800/50 p-3 text-xs text-ink-400">
                That pack targets a different Minecraft version (pack format{' '}
                {source.project.packFormat} vs yours, {project?.packFormat}). The recordings still
                merge fine — but check that the sound ids exist in the version you are building for.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** One "N things happened" line, hidden entirely when N is zero. */
function Line({ count, text }: { count: number; text: string }): JSX.Element | null {
  if (count === 0) return null
  return (
    <li>
      <span className="text-ink-100">{count}</span> {text}
    </li>
  )
}
