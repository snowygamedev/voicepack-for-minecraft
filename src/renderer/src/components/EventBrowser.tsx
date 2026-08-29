import { useMemo, useState } from 'react'
import { SOUND_CATEGORIES } from '@shared/sound-categories'
import type { CatalogEvent } from '@shared/types'
import { useApp } from '../store/app-store'
import { splitEventId } from '../lib/format'
import BulkAddDialog from '../views/BulkAddDialog'
import type { JSX } from 'react'

/**
 * Rows rendered per category before a "show all" is needed. Enough to browse,
 * few enough that ten categories at once stay cheap to render.
 */
const PER_CATEGORY_LIMIT = 60

/**
 * Left-hand pane: search the full catalog, or narrow to just the events already
 * in the pack. This is where most of a session's time is spent, so the search
 * has to stay responsive against ~1500 scanned events.
 */
export default function EventBrowser(): JSX.Element {
  const catalog = useApp((s) => s.catalog)
  const project = useApp((s) => s.project)
  const selectedEventId = useApp((s) => s.selectedEventId)
  const selectEvent = useApp((s) => s.selectEvent)
  const install = useApp((s) => s.install)
  const busy = useApp((s) => s.busy)
  const chooseMinecraftDir = useApp((s) => s.chooseMinecraftDir)

  const [query, setQuery] = useState('')
  /** Categories the user has asked to see in full. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [category, setCategory] = useState<string>('all')
  const [onlyInPack, setOnlyInPack] = useState(false)
  const [showBulkAdd, setShowBulkAdd] = useState(false)

  const boundIds = useMemo(
    () => new Set(project?.bindings.map((b) => b.eventId) ?? []),
    [project]
  )
  const recordedIds = useMemo(
    () => new Set(project?.bindings.filter((b) => b.takes.length > 0).map((b) => b.eventId) ?? []),
    [project]
  )

  /**
   * The catalog plus anything in the pack that isn't in it — a sound added from
   * a pasted list, or one for a version we haven't scanned. A binding the user
   * can't see in the list is a binding they can't record or remove.
   */
  const events = useMemo(() => {
    const known = new Set(catalog.events.map((e) => e.id))
    const extra = (project?.bindings ?? [])
      .filter((b) => !known.has(b.eventId))
      .map<CatalogEvent>((b) => ({ id: b.eventId, category: b.category, source: 'seed' }))
    return extra.length === 0 ? catalog.events : [...catalog.events, ...extra]
  }, [catalog.events, project])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = events.filter((event) => {
      if (category !== 'all' && event.category !== category) return false
      if (onlyInPack && !boundIds.has(event.id)) return false
      if (!needle) return true
      return event.id.includes(needle) || event.subtitle?.toLowerCase().includes(needle)
    })
    // Group in the fixed category order — the same order the categories have in
    // sounds.json, and one group per in-game volume slider. The row cap is per
    // category, not overall: a single cap across ~2000 alphabetical events only
    // ever reached the first couple of categories, hiding all the others.
    const groups = SOUND_CATEGORIES.map((name) => {
      const all = matches.filter((e) => e.category === name)
      return {
        category: name,
        total: all.length,
        events: expanded.has(name) ? all : all.slice(0, PER_CATEGORY_LIMIT),
        // How many of these are already in the pack — the quickest way to see
        // what a pasted list actually landed on.
        included: all.filter((e) => boundIds.has(e.id)).length
      }
    }).filter((group) => group.total > 0)
    const shown = groups.reduce((sum, group) => sum + group.events.length, 0)
    return { groups, shown, total: matches.length }
  }, [events, query, category, onlyInPack, boundIds, expanded])

  return (
    <div className="flex h-full flex-col border-r border-ink-800 bg-ink-900">
      <div className="space-y-2 border-b border-ink-800 p-3">
        <input
          className="field"
          placeholder="Search sound events..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <div className="flex gap-2">
          <select
            className="field flex-1"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {SOUND_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            className={onlyInPack ? 'btn-primary whitespace-nowrap' : 'btn-outline whitespace-nowrap'}
            onClick={() => setOnlyInPack((v) => !v)}
            title="Show only events already added to this pack"
          >
            In pack
          </button>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 text-xs text-ink-500">
            {results.total} event{results.total === 1 ? '' : 's'}
            {results.total > results.shown && ` (showing ${results.shown})`}
            {catalog.scannedVersion && ` · from ${catalog.scannedVersion}`}
          </p>
          <button
            className="btn-ghost shrink-0 whitespace-nowrap text-xs"
            onClick={() => setShowBulkAdd(true)}
            title="Paste a list of sound ids, one per line"
          >
            Add list...
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {results.groups.map((group) => (
          <section key={group.category}>
            <h3 className="sticky top-0 z-10 flex items-baseline gap-2 bg-ink-900 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
              <span>{group.category}</span>
              <span className="text-ink-600">{group.total}</span>
              {group.included > 0 && (
                <span className="ml-auto normal-case tracking-normal text-grass-400">
                  {group.included} in pack
                </span>
              )}
            </h3>
            <ul>
              {group.events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={event.id === selectedEventId}
                  inPack={boundIds.has(event.id)}
                  recorded={recordedIds.has(event.id)}
                  onSelect={() => selectEvent(event.id)}
                />
              ))}
            </ul>
            {group.total > group.events.length && (
              <button
                className="btn-ghost w-full px-2 py-1 text-left text-xs text-ink-500"
                onClick={() => setExpanded(new Set(expanded).add(group.category))}
              >
                Show all {group.total} in {group.category}...
              </button>
            )}
          </section>
        ))}
        {results.groups.length === 0 && (
          <div className="space-y-3 p-6 text-center text-sm text-ink-500">
            {events.length === 0 ? (
              <>
                <p>
                  {busy
                    ? 'Reading sound events...'
                    : install
                      ? 'No sound events could be read from that version.'
                      : 'No Minecraft installation found yet.'}
                </p>
                <p className="text-xs">
                  Every sound in this list comes from your own copy of the game, so there is nothing
                  to show until we can read it — or you can paste the ids you already know.
                </p>
                <div className="flex flex-col items-center gap-2">
                  <button className="btn-outline" onClick={() => void chooseMinecraftDir()}>
                    Choose your Minecraft folder...
                  </button>
                  <button className="btn-outline" onClick={() => setShowBulkAdd(true)}>
                    Add sounds from a list...
                  </button>
                </div>
              </>
            ) : (
              <p>Nothing matches that search.</p>
            )}
          </div>
        )}
      </div>

      {showBulkAdd && (
        <BulkAddDialog
          onClose={() => setShowBulkAdd(false)}
          // Jump straight to what the pack now contains, so a pasted list can be
          // checked off category by category.
          onAdded={() => setOnlyInPack(true)}
        />
      )}
    </div>
  )
}

interface EventRowProps {
  event: CatalogEvent
  selected: boolean
  inPack: boolean
  recorded: boolean
  onSelect: () => void
}

function EventRow({ event, selected, inPack, recorded, onSelect }: EventRowProps): JSX.Element {
  const { prefix, leaf } = splitEventId(event.id)
  return (
    <li>
      <button
        onClick={onSelect}
        className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
          selected ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-800'
        }`}
      >
        <span
          aria-hidden
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[10px] leading-none ${
            recorded
              ? 'border-grass-400 bg-grass-400 text-ink-900'
              : inPack
                ? 'border-grass-400 text-grass-400'
                : 'border-ink-700 text-transparent'
          }`}
          title={
            recorded
              ? 'In the pack, recorded'
              : inPack
                ? 'In the pack, not recorded yet'
                : 'Not in the pack'
          }
        >
          {inPack ? '✓' : ''}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-ink-500">{prefix}</span>
          <span>{leaf}</span>
        </span>
        {event.variantCount !== undefined && event.variantCount > 1 && (
          <span
            className="shrink-0 rounded bg-ink-800 px-1 text-[10px] text-ink-400"
            title={`Vanilla has ${event.variantCount} variants of this sound`}
          >
            ×{event.variantCount}
          </span>
        )}
      </button>
    </li>
  )
}
