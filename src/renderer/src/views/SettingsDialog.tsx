import { PACK_FORMATS, describePackFormat } from '@shared/pack-formats'
import type { NoiseReduction } from '@shared/types'
import { useApp } from '../store/app-store'
import Modal from '../components/Modal'
import type { JSX } from 'react'

/**
 * Gain a take starts at. Named rather than free-numeric because the reason to
 * change it is always the microphone, not a number someone has in mind.
 */
const GAIN_PRESETS = [
  { db: -6, label: 'Hot mic — quieten by 6 dB' },
  { db: -3, label: 'Slightly hot — quieten by 3 dB' },
  { db: 0, label: 'None — record as-is' },
  { db: 3, label: 'Slightly quiet mic — boost 3 dB' },
  { db: 6, label: 'Quiet mic — boost 6 dB' },
  { db: 12, label: 'Very quiet mic — boost 12 dB' }
] as const

interface SettingsDialogProps {
  onClose: () => void
}

export default function SettingsDialog({ onClose }: SettingsDialogProps): JSX.Element {
  const settings = useApp((s) => s.settings)
  const install = useApp((s) => s.install)
  const installs = useApp((s) => s.installs)
  const encoder = useApp((s) => s.encoder)
  const catalog = useApp((s) => s.catalog)
  const project = useApp((s) => s.project)
  const busy = useApp((s) => s.busy)

  const updateSettings = useApp((s) => s.updateSettings)
  const detectMinecraft = useApp((s) => s.detectMinecraft)
  const chooseMinecraftDir = useApp((s) => s.chooseMinecraftDir)
  const scanVersion = useApp((s) => s.scanVersion)
  const updateProject = useApp((s) => s.updateProject)

  /** Switching install re-reads the event list from that install's newest version. */
  const selectInstall = async (root: string): Promise<void> => {
    const next = installs.find((i) => i.root === root)
    const version = next?.versions.find((v) => v.assetIndex !== null) ?? next?.versions[0]
    if (version) await scanVersion(version.jarPath)
  }

  if (!settings) {
    return (
      <Modal title="Settings" onClose={onClose}>
        <p className="text-sm text-ink-400">Loading...</p>
      </Modal>
    )
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="space-y-6 text-sm">
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
            Minecraft installation
          </h3>
          {installs.length > 0 ? (
            <label className="block">
              <span className="label">Detected installation</span>
              <select
                className="field"
                value={install?.root ?? ''}
                onChange={(e) => void selectInstall(e.target.value)}
              >
                {installs.map((entry) => (
                  <option key={entry.root} value={entry.root}>
                    {entry.label} — {entry.root}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-ink-500">
              No Minecraft installation found. We look for the official launcher, Prism Launcher,
              PolyMC and MultiMC; for anything else, point us at the folder yourself.
            </p>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button className="btn-outline whitespace-nowrap" onClick={() => void chooseMinecraftDir()}>
              Choose folder...
            </button>
            <button
              className="btn-ghost whitespace-nowrap"
              disabled={busy !== null}
              onClick={() => void detectMinecraft()}
            >
              Search again
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-500">
            Used to list every sound event for your version, preview original sounds, and install
            finished packs. Nothing is copied out of it into your pack. For Prism Launcher, pick the
            launcher&rsquo;s data folder (the one containing <code>instances</code>) or a single
            instance folder.
          </p>

          {install && install.versions.length > 0 && (
            <div className="mt-3 flex items-end gap-2">
              <label className="flex-1">
                <span className="label">
                  {install.kind === 'vanilla' ? 'Read sound events from version' : 'Instance'}
                </span>
                <select
                  className="field"
                  value={settings.minecraftJarPath ?? install.versions[0]?.jarPath ?? ''}
                  onChange={(e) => void scanVersion(e.target.value)}
                >
                  {install.versions.map((version) => (
                    <option key={version.jarPath} value={version.jarPath}>
                      {version.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn-outline"
                disabled={busy !== null}
                onClick={() => {
                  const current =
                    install.versions.find((v) => v.jarPath === settings.minecraftJarPath) ??
                    install.versions[0]
                  if (current) void scanVersion(current.jarPath)
                }}
              >
                {busy ? 'Scanning...' : 'Rescan'}
              </button>
            </div>
          )}
          {install && install.versions.length === 0 && (
            <p className="mt-2 text-xs text-redstone-400">
              No playable versions found there. Launch the game once so the launcher downloads the
              client jar, then search again.
            </p>
          )}
          <p className="mt-1 text-xs text-ink-500">
            {catalog.scannedVersion
              ? `${catalog.events.length} events loaded from ${catalog.scannedVersion}.`
              : 'No sound events loaded yet — they all come from your own installation.'}
          </p>
          {settings.minecraftGameDir && (
            <p className="mt-1 font-mono text-[11px] text-ink-600">
              Packs install into {settings.minecraftGameDir} / resourcepacks
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
            Audio encoder
          </h3>
          <div className="flex items-center gap-2">
            <input
              className="field flex-1 font-mono text-xs"
              value={settings.ffmpegPath ?? ''}
              placeholder={encoder?.path ?? 'Not found'}
              onChange={(e) => void updateSettings({ ffmpegPath: e.target.value || null })}
            />
          </div>
          <p className="mt-1 text-xs">
            {encoder?.available ? (
              <span className="text-grass-300">
                Using {encoder.source === 'bundled' ? 'the bundled' : `the ${encoder.source}`} ffmpeg
                &mdash; {encoder.version}
              </span>
            ) : (
              <span className="text-redstone-400">
                No ffmpeg found. Export needs it to write Ogg Vorbis, the only format Minecraft
                plays.
              </span>
            )}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="label">Ogg quality ({settings.oggQuality})</span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={settings.oggQuality}
                onChange={(e) => void updateSettings({ oggQuality: Number(e.target.value) })}
                className="w-full accent-grass-500"
              />
              <span className="mt-1 block text-xs text-ink-500">
                Higher is better and bigger. 5 is a good default for game audio.
              </span>
            </label>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-ink-300">
                <input
                  type="checkbox"
                  className="accent-grass-500"
                  checked={settings.forceMono}
                  onChange={(e) => void updateSettings({ forceMono: e.target.checked })}
                />
                Downmix to mono
              </label>
              <p className="text-xs text-ink-500">
                Minecraft only positions mono sounds in 3D space. Stereo sounds play flat, as if
                they were music.
              </p>

              <label className="flex items-center gap-2 text-xs text-ink-300">
                <input
                  type="checkbox"
                  className="accent-grass-500"
                  checked={settings.normalizeOnExport}
                  onChange={(e) => void updateSettings({ normalizeOnExport: e.target.checked })}
                />
                Normalise peaks to {settings.targetPeakDb} dBFS
              </label>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-ink-800 pt-4">
            <label className="col-span-2 block">
              <span className="label">Default gain for new recordings</span>
              <select
                className="field"
                value={GAIN_PRESETS.some((p) => p.db === settings.defaultGainDb)
                  ? String(settings.defaultGainDb)
                  : 'custom'}
                onChange={(e) => void updateSettings({ defaultGainDb: Number(e.target.value) })}
              >
                {!GAIN_PRESETS.some((p) => p.db === settings.defaultGainDb) && (
                  <option value="custom">Custom ({settings.defaultGainDb} dB)</option>
                )}
                {GAIN_PRESETS.map((preset) => (
                  <option key={preset.db} value={preset.db}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-500">
                Applied to every take you record from now on, so a mic that always comes in low
                doesn&apos;t have to be corrected one take at a time. Each take&apos;s own gain can
                still be changed afterwards.
              </span>
            </label>

            <div className="col-span-2 space-y-1">
              <label className="flex items-center gap-2 text-xs text-ink-300">
                <input
                  type="checkbox"
                  className="accent-grass-500"
                  checked={settings.autoTrimSilence}
                  onChange={(e) => void updateSettings({ autoTrimSilence: e.target.checked })}
                />
                Trim the silence around new recordings
              </label>
              <p className="text-xs text-ink-500">
                Moves the markers to just around your sound — 40 ms of lead-in before it, 120 ms
                of tail after it so the decay survives. It is an ordinary trim, so &ldquo;Reset
                edits&rdquo; puts it back, and &ldquo;Trim silence&rdquo; on a take applies it to an
                older recording.
              </p>
            </div>

            <label className="block">
              <span className="label">Noise filter</span>
              <select
                className="field"
                value={settings.noiseReduction}
                onChange={(e) =>
                  void updateSettings({ noiseReduction: e.target.value as NoiseReduction })
                }
              >
                <option value="off">Off</option>
                <option value="light">Light — room tone and hiss</option>
                <option value="strong">Strong — noisy room or fan</option>
              </select>
              <span className="mt-1 block text-xs text-ink-500">
                Rolls off rumble below 80 Hz and subtracts steady background noise. Strong can make
                a voice sound hollow, so use it only when you need it.
              </span>
            </label>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-ink-300">
                <input
                  type="checkbox"
                  className="accent-grass-500"
                  checked={settings.voiceEnhance}
                  onChange={(e) => void updateSettings({ voiceEnhance: e.target.checked })}
                />
                Voice enhancer
              </label>
              <p className="text-xs text-ink-500">
                Trims boxiness, lifts the consonants that carry over game audio, and evens out loud
                and quiet words. Peaks are limited afterwards so nothing clips.
              </p>
              <p className="text-xs text-ink-500">
                Both apply when you export — your recordings on disk are never altered. Use
                &ldquo;Play cleaned&rdquo; on a take to hear the result first.
              </p>
            </div>
          </div>
        </section>

        {project && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
              This pack
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="label">Name</span>
                <input
                  className="field"
                  value={project.name}
                  onChange={(e) => updateProject({ name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="label">pack_format</span>
                <input
                  type="number"
                  className="field font-mono"
                  min={1}
                  value={project.packFormat}
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    if (Number.isInteger(next) && next > 0) updateProject({ packFormat: next })
                  }}
                  list="pack-formats"
                />
                <datalist id="pack-formats">
                  {PACK_FORMATS.map((entry) => (
                    <option key={entry.format} value={entry.format}>
                      {entry.versions}
                    </option>
                  ))}
                </datalist>
                <span className="mt-1 block text-xs text-ink-500">
                  {describePackFormat(project.packFormat)}
                </span>
              </label>
              <label className="col-span-2 block">
                <span className="label">Description</span>
                <input
                  className="field"
                  value={project.description}
                  onChange={(e) => updateProject({ description: e.target.value })}
                />
              </label>
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
