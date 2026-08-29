import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { appSettingsSchema, type AppSettings } from '@shared/schema'

let cache: AppSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * Settings are best-effort: a corrupt or missing file falls back to defaults
 * rather than blocking startup, since none of it is precious.
 */
export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    cache = appSettingsSchema.parse(JSON.parse(raw))
  } catch {
    cache = appSettingsSchema.parse({})
  }
  return cache
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const next = appSettingsSchema.parse({ ...current, ...patch })
  cache = next
  const file = settingsPath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** Push a project dir to the front of the recents list, capped at 10. */
export async function rememberProject(dir: string): Promise<void> {
  const { recentProjects } = await loadSettings()
  const next = [dir, ...recentProjects.filter((p) => p !== dir)].slice(0, 10)
  await updateSettings({ recentProjects: next })
}
