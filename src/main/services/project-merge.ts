import { resolve } from 'node:path'
import type { MergeMode, MergeSummary } from '@shared/types'
import { planMerge } from '@shared/merge'
import type { Project, SoundBinding } from '@shared/schema'
import {
  importTakeFile,
  loadProject,
  resolveInProject,
  saveProject
} from './project-store'

/**
 * Merging two packs. The common case is two people (or one person on two
 * machines) recording different halves of the same list: nothing overlaps, and
 * the merge is a straight union. Overlaps are the interesting part, so what
 * happens to them is the user's choice, not ours.
 */

/**
 * Copy every take the plan calls for out of `sourceDir` and into `targetDir`,
 * then write the merged project.json. Audio already in the target is never
 * deleted — a "replace" drops the old takes from the event, but their files
 * stay on disk, because losing a recording to a mis-click is unrecoverable.
 */
export async function mergeProjects(
  targetDir: string,
  sourceDir: string,
  mode: MergeMode
): Promise<{ project: Project; summary: MergeSummary }> {
  if (resolve(targetDir) === resolve(sourceDir)) {
    throw new Error('That is the pack you already have open.')
  }

  const target = await loadProject(targetDir)
  const source = await loadProject(sourceDir)
  const plan = planMerge(target, source, mode)
  const sourceBindings = new Map(source.bindings.map((b) => [b.eventId, b]))

  const bindings = [...target.bindings]
  const summary: MergeSummary = {
    sourceName: source.name,
    added: [],
    filled: [],
    appended: [],
    replaced: [],
    skipped: [],
    copiedFiles: 0,
    packFormatDiffers: source.packFormat !== target.packFormat
  }

  for (const entry of plan) {
    const incoming = sourceBindings.get(entry.eventId)
    if (!incoming) continue
    if (entry.action === 'skip') {
      summary.skipped.push(entry.eventId)
      continue
    }

    // Copy first: if a file is missing we want to fail before the project.json
    // starts pointing at takes that were never written.
    const copied: SoundBinding['takes'] = []
    for (const take of incoming.takes) {
      const from = resolveInProject(sourceDir, take.file)
      const file = await importTakeFile(targetDir, entry.eventId, from)
      copied.push({ ...take, file })
      summary.copiedFiles += 1
    }

    const index = bindings.findIndex((b) => b.eventId === entry.eventId)
    if (index === -1) {
      bindings.push({ ...incoming, takes: copied, activeTakeId: activeIdFor(incoming, copied) })
      summary.added.push(entry.eventId)
      continue
    }

    const current = bindings[index]
    if (!current) continue

    if (entry.action === 'replace') {
      bindings[index] = { ...current, takes: copied, activeTakeId: activeIdFor(incoming, copied) }
      summary.replaced.push(entry.eventId)
      continue
    }

    // 'append' and 'fill' differ only in how they read to the user: both keep
    // whatever the target had and add the source's takes after it.
    const takes = [...current.takes, ...copied]
    bindings[index] = {
      ...current,
      takes,
      activeTakeId: current.activeTakeId ?? activeIdFor(incoming, copied)
    }
    if (entry.action === 'fill') summary.filled.push(entry.eventId)
    else summary.appended.push(entry.eventId)
  }

  const project = await saveProject(targetDir, { ...target, bindings })
  return { project, summary }
}

/**
 * Which take the merged binding should export. The source's pinned take if it
 * came across, otherwise null — which means "export all of them as a pool",
 * the same thing the source was doing.
 */
function activeIdFor(source: SoundBinding, copied: SoundBinding['takes']): string | null {
  if (!source.activeTakeId) return null
  return copied.some((t) => t.id === source.activeTakeId) ? source.activeTakeId : null
}
