import { useState } from 'react'
import { DEFAULT_PACK_FORMAT, PACK_FORMATS } from '@shared/pack-formats'
import { useApp } from '../store/app-store'
import type { JSX } from 'react'

export default function Welcome(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const newProject = useApp((s) => s.newProject)
  const openProject = useApp((s) => s.openProject)
  const openProjectPath = useApp((s) => s.openProjectPath)

  const [name, setName] = useState('My VoicePack')
  const [description, setDescription] = useState('Sounds recorded by me')
  const [packFormat, setPackFormat] = useState(DEFAULT_PACK_FORMAT)
  const [creating, setCreating] = useState(false)

  const create = async (): Promise<void> => {
    setCreating(true)
    await newProject(name.trim(), description.trim(), packFormat)
    setCreating(false)
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-4xl">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">VoicePack for Minecraft</h1>
          <p className="mt-1 text-sm text-ink-400">
            Record every sound in the game with your own voice.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <section className="panel p-5">
            <h2 className="mb-4 text-sm font-medium text-ink-200">New pack</h2>
            <div className="space-y-3">
              <label className="block">
                <span className="label">Pack name</span>
                <input
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="label">Description</span>
                <input
                  className="field"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Shown in the in-game resource pack list"
                />
              </label>
              <label className="block">
                <span className="label">Minecraft version</span>
                <select
                  className="field"
                  value={packFormat}
                  onChange={(e) => setPackFormat(Number(e.target.value))}
                >
                  {[...PACK_FORMATS].reverse().map((entry) => (
                    <option key={entry.format} value={entry.format}>
                      {entry.versions} (pack_format {entry.format})
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-500">
                  You can change this later, and set a custom number for newer releases.
                </span>
              </label>

              <button
                className="btn-primary w-full"
                disabled={!name.trim() || creating}
                onClick={() => void create()}
              >
                {creating ? 'Creating...' : 'Choose a folder and create'}
              </button>
            </div>
          </section>

          <section className="panel flex flex-col p-5">
            <h2 className="mb-4 text-sm font-medium text-ink-200">Open</h2>
            <button className="btn-outline mb-4 w-full" onClick={() => void openProject()}>
              Open an existing pack...
            </button>

            {settings && settings.recentProjects.length > 0 && (
              <>
                <p className="label">Recent</p>
                <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {settings.recentProjects.map((dir) => (
                    <li key={dir}>
                      <button
                        className="w-full truncate rounded px-2 py-1.5 text-left text-xs text-ink-300 hover:bg-ink-800"
                        title={dir}
                        onClick={() => void openProjectPath(dir)}
                      >
                        {dir.split(/[\\/]/).pop()}
                        <span className="ml-2 text-ink-600">{dir}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <p className="mt-8 text-center text-xs text-ink-600">
          Not affiliated with Mojang or Microsoft. No official Minecraft files are included.
        </p>
      </div>
    </div>
  )
}
