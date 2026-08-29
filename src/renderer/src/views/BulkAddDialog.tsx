import { useMemo, useState } from 'react'
import { SOUND_CATEGORIES, guessCategory } from '@shared/sound-categories'
import type { SoundCategory } from '@shared/types'
import { parseEventIdList } from '@shared/event-ids'
import { useApp } from '../store/app-store'
import Modal from '../components/Modal'
import { splitEventId } from '../lib/format'
import type { JSX } from 'react'

interface BulkAddDialogProps {
  onClose: () => void
  /** Fired after a successful add, so the list can show what landed. */
  onAdded?: (eventIds: string[]) => void
}

/** One id as the preview understands it, before anything is committed. */
interface Entry {
  id: string
  category: SoundCategory
  /** Already a binding in this pack — adding it again would do nothing. */
  already: boolean
  /** Not in the scanned catalog. Usually a typo, sometimes another version. */
  unknown: boolean
}

const PLACEHOLDER = `entity.zombie.hurt
entity.zombie.ambient
block.stone.break
minecraft:ui.button.click`

/**
 * Paste a list of event ids — one per line, however they came off the wiki or
 * out of someone's notes — and add them all to the pack at once, grouped by the
 * in-game volume category each one will obey.
 */
export default function BulkAddDialog({ onClose, onAdded }: BulkAddDialogProps): JSX.Element {
  const catalog = useApp((s) => s.catalog)
  const project = useApp((s) => s.project)
  const addEvents = useApp((s) => s.addEvents)
  const selectEvent = useApp((s) => s.selectEvent)

  const [text, setText] = useState('')

  const parsed = useMemo(() => parseEventIdList(text), [text])

  const { entries, invalid } = useMemo(() => {
    const known = new Map(catalog.events.map((e) => [e.id, e]))
    const inPack = new Set(project?.bindings.map((b) => b.eventId) ?? [])
    return {
      entries: parsed.ids.map<Entry>((id) => ({
        id,
        category: known.get(id)?.category ?? guessCategory(id),
        already: inPack.has(id),
        unknown: !known.has(id)
      })),
      invalid: parsed.invalid
    }
  }, [parsed, catalog.events, project])

  // Group in the fixed category order, so the same paste always reads the same
  // way and the groups line up with the sliders in Minecraft's audio settings.
  const groups = useMemo(
    () =>
      SOUND_CATEGORIES.map((category) => ({
        category,
        entries: entries.filter((e) => e.category === category)
      })).filter((g) => g.entries.length > 0),
    [entries]
  )

  const newCount = entries.filter((e) => !e.already).length
  const alreadyCount = entries.length - newCount
  const unknownCount = entries.filter((e) => e.unknown && !e.already).length

  const commit = (): void => {
    const result = addEvents(entries.map((e) => e.id))
    const first = result.added[0] ?? result.already[0]
    if (first) selectEvent(first)
    onAdded?.(result.added)
    onClose()
  }

  return (
    <Modal
      title="Add sounds from a list"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <span className="mr-auto text-xs text-ink-500">
            {entries.length === 0
              ? 'One sound event id per line.'
              : `${newCount} to add` +
                (alreadyCount > 0 ? ` · ${alreadyCount} already in the pack` : '') +
                (invalid.length > 0 ? ` · ${invalid.length} unreadable` : '')}
          </span>
          <button className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={commit} disabled={newCount === 0}>
            Add {newCount} sound{newCount === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs text-ink-400" htmlFor="bulk-add-ids">
            Paste your list
          </label>
          <textarea
            id="bulk-add-ids"
            className="field h-40 w-full resize-y font-mono text-xs"
            placeholder={PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <p className="text-xs text-ink-500">
            One id per line. A leading <code className="text-ink-400">minecraft:</code>, bullets,
            quotes and trailing commas are all fine — paste straight from a wiki page or a
            sounds.json.
          </p>
        </div>

        {invalid.length > 0 && (
          <div className="rounded border border-redstone-600 bg-redstone-600/10 p-3 text-xs text-redstone-400">
            <p className="mb-1">
              {invalid.length} line{invalid.length === 1 ? '' : 's'} could not be read as a sound id:
            </p>
            <ul className="selectable space-y-0.5 font-mono">
              {invalid.slice(0, 5).map((line, i) => (
                <li key={i} className="truncate">
                  {line}
                </li>
              ))}
              {invalid.length > 5 && <li className="text-ink-500">…and {invalid.length - 5} more</li>}
            </ul>
          </div>
        )}

        {unknownCount > 0 && (
          <p className="rounded border border-ink-700 bg-ink-800/50 p-3 text-xs text-ink-400">
            {unknownCount} of these {unknownCount === 1 ? 'is' : 'are'} not in
            {catalog.scannedVersion ? ` ${catalog.scannedVersion}'s` : ' the scanned'} sound list.
            They can still be added — but check for typos, because Minecraft silently ignores an
            event it doesn&apos;t have.
          </p>
        )}

        {groups.length > 0 && (
          <div className="space-y-3">
            {groups.map((group) => (
              <section key={group.category}>
                <h3 className="mb-1 flex items-baseline gap-2 text-xs font-medium text-ink-300">
                  <span>{group.category}</span>
                  <span className="text-ink-600">{group.entries.length}</span>
                </h3>
                <ul className="space-y-0.5">
                  {group.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className={`flex items-center gap-2 rounded px-2 py-1 font-mono text-xs ${
                        entry.already ? 'text-ink-600' : 'text-ink-200'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-ink-500">{splitEventId(entry.id).prefix}</span>
                        {splitEventId(entry.id).leaf}
                      </span>
                      {entry.already && <span className="shrink-0 text-[10px]">already added</span>}
                      {!entry.already && entry.unknown && (
                        <span
                          className="shrink-0 text-[10px] text-redstone-400"
                          title="Not found in the scanned sound list"
                        >
                          unknown
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
