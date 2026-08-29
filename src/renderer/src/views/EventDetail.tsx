import { useCallback, useEffect, useState } from 'react'
import { SOUND_CATEGORIES } from '@shared/sound-categories'
import type { SoundBinding, Take } from '@shared/types'
import { useApp } from '../store/app-store'
import { useRecorder } from '../audio/useRecorder'
import { usePlayback } from '../audio/usePlayback'
import LevelMeter from '../components/LevelMeter'
import Waveform from '../components/Waveform'
import { findSoundBounds } from '@shared/wav'
import { formatDuration, splitEventId } from '../lib/format'
import type { JSX } from 'react'

interface EventDetailProps {
  binding: SoundBinding
  /**
   * false while this is a draft: the event is being looked at but is not part
   * of the pack yet. Recording the first take is what commits it.
   */
  inPack: boolean
}

export default function EventDetail({ binding, inPack }: EventDetailProps): JSX.Element {
  const projectDir = useApp((s) => s.projectDir)
  const settings = useApp((s) => s.settings)
  const updateBinding = useApp((s) => s.updateBinding)
  const updateTake = useApp((s) => s.updateTake)
  const addTake = useApp((s) => s.addTake)
  const removeTake = useApp((s) => s.removeTake)
  const removeEvent = useApp((s) => s.removeEvent)
  const updateSettings = useApp((s) => s.updateSettings)
  const setError = useApp((s) => s.setError)

  const recorder = useRecorder()
  const preview = usePlayback()
  const original = usePlayback()
  /** The selected take run through the export's noise filter and enhancer. */
  const cleaned = usePlayback()

  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(binding.activeTakeId)
  const [originalMissing, setOriginalMissing] = useState(false)
  const [cleaning, setCleaning] = useState(false)

  const selectedTake =
    binding.takes.find((t) => t.id === selectedTakeId) ?? binding.takes.at(-1) ?? null

  // Load the selected take's audio for the waveform and the preview button.
  useEffect(() => {
    if (!projectDir || !selectedTake) {
      void preview.load(null)
      return
    }
    let cancelled = false
    void (async () => {
      const result = await window.voicepack.takes.read(projectDir, selectedTake.file)
      if (cancelled) return
      if (result.ok) await preview.load(result.value)
      else setError(result.error)
    })()
    return () => {
      cancelled = true
    }
    // `preview` identity is stable enough here; keying on the file is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir, selectedTake?.file])

  // Processing is rendered on demand, so anything that would change the result
  // has to throw the rendered copy away.
  useEffect(() => {
    cleaned.stop()
    void cleaned.load(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedTake?.file,
    selectedTake?.trimStart,
    selectedTake?.trimEnd,
    selectedTake?.gainDb,
    settings?.noiseReduction,
    settings?.voiceEnhance,
    settings?.forceMono
  ])

  // Fetch the vanilla sound so the user can A/B against what they're replacing.
  useEffect(() => {
    let cancelled = false
    setOriginalMissing(false)
    void (async () => {
      const result = await window.voicepack.minecraft.originalAudio(binding.eventId)
      if (cancelled) return
      if (result.ok && result.value) await original.load(result.value)
      else {
        await original.load(null)
        setOriginalMissing(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding.eventId])

  const handleRecord = useCallback(async () => {
    if (recorder.recording) {
      const audio = await recorder.stop()
      if (!audio || !projectDir) return

      const written = await window.voicepack.takes.write({
        projectDir,
        eventId: binding.eventId,
        wav: audio.wav,
        durationSeconds: audio.durationSeconds,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        peak: audio.peak
      })
      if (!written.ok) {
        setError(written.error)
        return
      }
      addTake(binding.eventId, written.value)
      setSelectedTakeId(written.value.id)

      // Everything here is a non-destructive edit on top of the untouched WAV,
      // so it can all be undone with "Reset edits".
      const patch: Partial<Take> = {}

      // Drop the gaps either side of the sound — the wait before you speak and
      // the wait before you reach for the key again.
      if (settings?.autoTrimSilence) {
        const bounds = findSoundBounds(audio.samples, audio.sampleRate)
        if (bounds.start > 0 || bounds.end !== null) {
          patch.trimStart = bounds.start
          patch.trimEnd = bounds.end
        }
      }
      if (settings?.defaultGainDb) patch.gainDb = settings.defaultGainDb

      if (Object.keys(patch).length > 0) {
        updateTake(binding.eventId, written.value.id, patch)
      }
    } else {
      preview.stop()
      original.stop()
      cleaned.stop()
      await recorder.start(settings?.inputDeviceId ?? null)
    }
  }, [
    recorder,
    projectDir,
    binding.eventId,
    addTake,
    updateTake,
    setError,
    preview,
    original,
    cleaned,
    settings
  ])

  // Space bar is the record toggle; it's the single most repeated action here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'
      if (typing) return

      if (event.code === 'Space') {
        event.preventDefault()
        void handleRecord()
      }
      if (event.code === 'Escape' && recorder.recording) {
        event.preventDefault()
        void recorder.cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleRecord, recorder])

  /**
   * Render (once) and play the processed version. Cheap enough on a few seconds
   * of audio that a spinner would flash rather than inform.
   */
  const playCleaned = useCallback(async () => {
    if (cleaned.playing) {
      cleaned.stop()
      return
    }
    if (cleaned.audio) {
      cleaned.play()
      return
    }
    if (!projectDir || !selectedTake) return

    setCleaning(true)
    const result = await window.voicepack.takes.processed(projectDir, selectedTake.file, {
      trimStart: selectedTake.trimStart,
      trimEnd: selectedTake.trimEnd,
      gainDb: selectedTake.gainDb
    })
    setCleaning(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await cleaned.load(result.value)
    cleaned.play()
  }, [cleaned, projectDir, selectedTake, setError])

  const processingOn =
    (settings?.noiseReduction ?? 'off') !== 'off' || (settings?.voiceEnhance ?? false)

  const { prefix, leaf } = splitEventId(binding.eventId)

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-lg selectable">
            <span className="text-ink-500">{prefix}</span>
            <span className="text-ink-100">{leaf}</span>
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            {inPack
              ? `${binding.takes.length} take${binding.takes.length === 1 ? '' : 's'} recorded`
              : 'Not in your pack yet — record a take to add it'}
          </p>
        </div>
        {inPack && (
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={binding.enabled}
                onChange={(e) => updateBinding(binding.eventId, { enabled: e.target.checked })}
                className="accent-grass-500"
              />
              Include in pack
            </label>
            <button
              className="btn-ghost text-redstone-400"
              onClick={() => removeEvent(binding.eventId)}
              title="Remove this event from the pack"
            >
              Remove
            </button>
          </div>
        )}
      </header>

      <section className="space-y-4 border-b border-ink-800 px-6 py-5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => void handleRecord()}
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full transition-colors ${
              recorder.recording
                ? 'animate-pulse bg-redstone-600 hover:bg-redstone-500'
                : 'bg-redstone-600 hover:bg-redstone-500'
            }`}
            title={recorder.recording ? 'Stop (Space)' : 'Record (Space)'}
          >
            {recorder.recording ? (
              <span className="h-5 w-5 rounded-sm bg-white" />
            ) : (
              <span className="h-6 w-6 rounded-full bg-white" />
            )}
          </button>

          <div className="min-w-0 flex-1 space-y-2">
            <LevelMeter level={recorder.level} active={recorder.recording} />
            <div className="flex items-center gap-3 text-xs text-ink-400">
              <span className="font-mono tabular-nums">
                {formatDuration(recorder.recording ? recorder.elapsed : 0)}
              </span>
              <select
                className="field flex-1 py-1 text-xs"
                value={settings?.inputDeviceId ?? ''}
                disabled={recorder.recording}
                onChange={(e) => void updateSettings({ inputDeviceId: e.target.value || null })}
              >
                <option value="">System default input</option>
                {recorder.devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Input ${device.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
              {recorder.recording && (
                <button className="btn-ghost py-0.5 text-xs" onClick={() => void recorder.cancel()}>
                  Discard (Esc)
                </button>
              )}
            </div>
          </div>
        </div>

        {recorder.error && (
          <p className="rounded border border-redstone-600 bg-redstone-600/10 px-3 py-2 text-xs text-redstone-400">
            {recorder.error}
          </p>
        )}

        <div className="flex items-center gap-2 text-xs">
          <button
            className="btn-outline py-1 text-xs"
            disabled={!original.audio}
            onClick={() => (original.playing ? original.stop() : original.play())}
            title={
              originalMissing
                ? 'Not downloaded in your Minecraft install, or not a simple sound'
                : 'Play the vanilla sound you are replacing'
            }
          >
            {original.playing ? 'Stop' : 'Play original'}
          </button>
          {selectedTake && (
            <button
              className="btn-outline py-1 text-xs"
              disabled={cleaning || !processingOn}
              onClick={() => void playCleaned()}
              title={
                processingOn
                  ? 'Hear this take with the noise filter and voice enhancer applied'
                  : 'Turn on the noise filter or voice enhancer in Settings first'
              }
            >
              {cleaning ? 'Cleaning...' : cleaned.playing ? 'Stop' : 'Play cleaned'}
            </button>
          )}
          {originalMissing && (
            <span className="text-ink-500">Original not available locally</span>
          )}
        </div>
      </section>

      {selectedTake ? (
        <TakeEditor
          take={selectedTake}
          samples={preview.audio?.samples ?? null}
          sampleRate={preview.audio?.buffer.sampleRate ?? selectedTake.sampleRate}
          duration={preview.audio?.duration ?? selectedTake.duration}
          playhead={preview.playhead}
          playing={preview.playing}
          onPlay={() =>
            preview.playing
              ? preview.stop()
              : preview.play(
                  selectedTake.trimStart,
                  selectedTake.trimEnd ?? undefined,
                  selectedTake.gainDb
                )
          }
          onChange={(patch) => updateTake(binding.eventId, selectedTake.id, patch)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 py-16 text-center text-sm text-ink-500">
          Press <kbd className="mx-1.5 rounded bg-ink-800 px-1.5 py-0.5 font-mono">Space</kbd> or
          the red button to record. The event joins your pack as soon as you do.
        </div>
      )}

      <TakeList
        binding={binding}
        selectedTakeId={selectedTake?.id ?? null}
        onSelect={setSelectedTakeId}
        onDelete={(takeId) => void removeTake(binding.eventId, takeId)}
        onSetActive={(takeId) => updateBinding(binding.eventId, { activeTakeId: takeId })}
      />

      <EventSettings binding={binding} onChange={(patch) => updateBinding(binding.eventId, patch)} />
    </div>
  )
}

interface TakeEditorProps {
  take: Take
  samples: Float32Array | null
  sampleRate: number
  duration: number
  playhead: number | null
  playing: boolean
  onPlay: () => void
  onChange: (patch: Partial<Take>) => void
}

function TakeEditor({
  take,
  samples,
  sampleRate,
  duration,
  playhead,
  playing,
  onPlay,
  onChange
}: TakeEditorProps): JSX.Element {
  const trimEnd = take.trimEnd ?? duration

  return (
    <section className="space-y-3 border-b border-ink-800 px-6 py-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-200">{take.label}</h3>
        <div className="flex items-center gap-3 text-xs text-ink-500">
          <span className="font-mono">{formatDuration(trimEnd - take.trimStart)}</span>
          <span className="font-mono">{take.sampleRate / 1000} kHz</span>
          <span className="font-mono">{take.channels === 1 ? 'mono' : 'stereo'}</span>
          {take.peak >= 0.999 && <span className="text-redstone-400">clipping</span>}
        </div>
      </div>

      <Waveform
        samples={samples}
        duration={duration}
        trimStart={take.trimStart}
        trimEnd={take.trimEnd}
        playhead={playhead}
      />

      <div className="flex flex-wrap items-end gap-4">
        <button className="btn-outline" onClick={onPlay}>
          {playing ? 'Stop' : 'Play take'}
        </button>

        <NumberField
          label="Trim start"
          value={take.trimStart}
          min={0}
          max={Math.max(0, trimEnd - 0.01)}
          step={0.01}
          suffix="s"
          onChange={(trimStart) => onChange({ trimStart })}
        />
        <NumberField
          label="Trim end"
          value={trimEnd}
          min={take.trimStart + 0.01}
          max={duration}
          step={0.01}
          suffix="s"
          onChange={(value) => onChange({ trimEnd: value >= duration ? null : value })}
        />
        <NumberField
          label="Gain"
          value={take.gainDb}
          min={-24}
          max={24}
          step={0.5}
          suffix="dB"
          onChange={(gainDb) => onChange({ gainDb })}
        />
        <button
          className="btn-ghost"
          disabled={!samples}
          title="Trim the silence before and after the sound"
          onClick={() => {
            if (!samples) return
            const bounds = findSoundBounds(samples, sampleRate)
            onChange({ trimStart: bounds.start, trimEnd: bounds.end })
          }}
        >
          Trim silence
        </button>
        <button
          className="btn-ghost"
          onClick={() => onChange({ trimStart: 0, trimEnd: null, gainDb: 0 })}
        >
          Reset edits
        </button>
      </div>
    </section>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: NumberFieldProps): JSX.Element {
  return (
    <label className="block">
      <span className="label">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <input
        type="number"
        className="field w-28 font-mono tabular-nums"
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)))
        }}
      />
    </label>
  )
}

interface TakeListProps {
  binding: SoundBinding
  selectedTakeId: string | null
  onSelect: (takeId: string) => void
  onDelete: (takeId: string) => void
  onSetActive: (takeId: string | null) => void
}

function TakeList({
  binding,
  selectedTakeId,
  onSelect,
  onDelete,
  onSetActive
}: TakeListProps): JSX.Element | null {
  if (binding.takes.length === 0) return null

  const poolMode = binding.activeTakeId === null

  return (
    <section className="border-b border-ink-800 px-6 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-200">Takes</h3>
        <label className="flex items-center gap-2 text-xs text-ink-400">
          <input
            type="checkbox"
            checked={poolMode}
            onChange={(e) => onSetActive(e.target.checked ? null : (binding.takes[0]?.id ?? null))}
            className="accent-grass-500"
          />
          Export all takes as a random pool
        </label>
      </div>

      <ul className="space-y-1">
        {binding.takes.map((take) => {
          const isActive = poolMode || take.id === binding.activeTakeId
          return (
            <li
              key={take.id}
              className={`flex items-center gap-3 rounded px-2 py-1.5 text-sm ${
                take.id === selectedTakeId ? 'bg-ink-800' : 'hover:bg-ink-900'
              }`}
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(take.id)}>
                <span className={isActive ? 'text-ink-100' : 'text-ink-500'}>{take.label}</span>
                <span className="ml-2 font-mono text-xs text-ink-500">
                  {formatDuration((take.trimEnd ?? take.duration) - take.trimStart)}
                </span>
              </button>
              {!poolMode && (
                <button
                  className={`btn py-0.5 text-xs ${
                    isActive ? 'text-grass-300' : 'text-ink-500 hover:text-ink-300'
                  }`}
                  onClick={() => onSetActive(take.id)}
                  title="Export this take"
                >
                  {isActive ? 'Exporting' : 'Use this'}
                </button>
              )}
              <button
                className="btn py-0.5 text-xs text-ink-500 hover:text-redstone-400"
                onClick={() => onDelete(take.id)}
                title="Delete this take"
              >
                Delete
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface EventSettingsProps {
  binding: SoundBinding
  onChange: (patch: Partial<SoundBinding>) => void
}

function EventSettings({ binding, onChange }: EventSettingsProps): JSX.Element {
  return (
    <section className="grid grid-cols-2 gap-4 px-6 py-5 lg:grid-cols-3">
      <label className="block">
        <span className="label">Volume category</span>
        <select
          className="field"
          value={binding.category}
          onChange={(e) => onChange({ category: e.target.value as SoundBinding['category'] })}
        >
          {SOUND_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-ink-500">
          Which in-game volume slider controls this sound.
        </span>
      </label>

      <label className="block">
        <span className="label">Subtitle</span>
        <input
          className="field"
          placeholder="Keep vanilla subtitle"
          value={binding.subtitle ?? ''}
          onChange={(e) => onChange({ subtitle: e.target.value || null })}
        />
        <span className="mt-1 block text-xs text-ink-500">
          Shown when subtitles are enabled in-game.
        </span>
      </label>

      <label className="block">
        <span className="label">Replacement mode</span>
        <select
          className="field"
          value={binding.replace ? 'replace' : 'add'}
          onChange={(e) => onChange({ replace: e.target.value === 'replace' })}
        >
          <option value="replace">Replace the vanilla sound</option>
          <option value="add">Add alongside vanilla</option>
        </select>
        <span className="mt-1 block text-xs text-ink-500">
          &ldquo;Add&rdquo; leaves the original in the random pool.
        </span>
      </label>
    </section>
  )
}
