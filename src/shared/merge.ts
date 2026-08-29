import type { Project } from './schema'
import type { MergeMode, MergePlanEntry } from './types'

/**
 * Working out what a merge would do, shared so the dialog can show the user the
 * plan before they commit to it and main can execute exactly that plan.
 */

/** Decide what happens to every event in the source pack. Pure — easy to test. */
export function planMerge(
  target: Project,
  source: Project,
  mode: MergeMode
): MergePlanEntry[] {
  const existing = new Map(target.bindings.map((b) => [b.eventId, b]))

  return source.bindings.map((binding) => {
    const current = existing.get(binding.eventId)
    if (!current) return { eventId: binding.eventId, action: 'add', takes: binding.takes.length }
    // An event that exists in the target but was never recorded there is not a
    // real conflict — the source's audio simply fills the gap.
    if (current.takes.length === 0 && binding.takes.length > 0) {
      return { eventId: binding.eventId, action: 'fill', takes: binding.takes.length }
    }
    if (binding.takes.length === 0) {
      return { eventId: binding.eventId, action: 'skip', takes: 0 }
    }
    return {
      eventId: binding.eventId,
      action: mode === 'skip' ? 'skip' : mode === 'replace' ? 'replace' : 'append',
      takes: binding.takes.length
    }
  })
}
