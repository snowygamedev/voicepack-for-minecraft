import { homedir, platform } from 'node:os'
import { join, sep } from 'node:path'

/** Where the vanilla launcher keeps its data, per platform. */
export function defaultMinecraftDir(): string {
  const home = homedir()
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), '.minecraft')
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'minecraft')
    default:
      return join(home, '.minecraft')
  }
}

export function resourcePacksDir(gameDir: string): string {
  return join(gameDir, 'resourcepacks')
}

/** Per-platform data directory for a launcher that stores one, by folder name. */
function appDataDir(name: string): string {
  const home = homedir()
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), name)
    case 'darwin':
      return join(home, 'Library', 'Application Support', name)
    default:
      // Prism and MultiMC follow the XDG spec on Linux; the lowercase folder
      // name is what they actually create there.
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), name)
  }
}

export interface LauncherCandidate {
  dir: string
  kind: 'vanilla' | 'prism' | 'multimc' | 'polymc'
  label: string
}

/**
 * Everywhere we know to look for a Minecraft install, in preference order.
 *
 * Prism (and the MultiMC/PolyMC line it descends from) does not lay itself out
 * like `.minecraft` at all: one data directory holds every instance, the client
 * jars live in a shared Maven-style `libraries` tree, and assets are shared
 * launcher-wide. Detection has to know both shapes.
 */
export function launcherCandidates(): LauncherCandidate[] {
  const home = homedir()
  const candidates: LauncherCandidate[] = [
    { dir: defaultMinecraftDir(), kind: 'vanilla', label: 'Minecraft Launcher' },
    { dir: appDataDir('PrismLauncher'), kind: 'prism', label: 'Prism Launcher' },
    { dir: appDataDir('PolyMC'), kind: 'polymc', label: 'PolyMC' },
    { dir: appDataDir('MultiMC'), kind: 'multimc', label: 'MultiMC' }
  ]

  if (platform() === 'win32') {
    for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) {
      if (base) {
        candidates.push({ dir: join(base, 'PrismLauncher'), kind: 'prism', label: 'Prism Launcher' })
      }
    }
  } else {
    candidates.push({
      dir: join(home, '.local', 'share', 'multimc'),
      kind: 'multimc',
      label: 'MultiMC'
    })
  }

  const seen = new Set<string>()
  return candidates.filter((c) => !seen.has(c.dir) && seen.add(c.dir))
}

/**
 * Folder names that mean "a launcher lives here".
 *
 * Portable builds keep the version in the folder name, so this matches on a
 * prefix — a real-world one is `PrismLauncher-Windows-MinGW-w64-Portable-11.0.3`.
 */
export const LAUNCHER_DIR_NAME = /^(prism[ _-]?launcher|multimc|polymc)/i

/** Which launcher a matched folder name belongs to. */
export function kindFromName(name: string): 'prism' | 'multimc' | 'polymc' {
  const lower = name.toLowerCase()
  if (lower.startsWith('multimc')) return 'multimc'
  if (lower.startsWith('polymc')) return 'polymc'
  return 'prism'
}

/**
 * Where to go looking for a *portable* launcher.
 *
 * Prism is very often run portable: unzipped wherever the user keeps games,
 * with no installer, no registry entry, and nothing in the per-user data
 * directory. There is no system to ask where it went, so we sweep a bounded set
 * of likely places two levels deep, which finds the common `C:\Games\Prism...`
 * shape without ever walking the whole disk.
 */
export function portableScanRoots(): string[] {
  const home = homedir()
  const roots = [home, join(home, 'Desktop'), join(home, 'Downloads'), join(home, 'Documents')]

  if (platform() === 'win32') {
    // Stopping at H keeps this quick: stat'ing a disconnected network drive is
    // slow, and a games drive past that letter is rare enough to pick by hand.
    for (const letter of 'CDEFGH') roots.push(join(`${letter}:`, sep))
  } else {
    roots.push('/opt', '/srv', join(home, 'Games'), join(home, '.local', 'share'))
  }
  return roots
}

/** Directories never worth descending into while hunting for a launcher. */
export const SKIP_SCAN_DIRS = new Set([
  'windows',
  '$recycle.bin',
  'system volume information',
  'appdata',
  'node_modules',
  'onedrive',
  'perflogs',
  'recovery',
  'msocache'
])

/**
 * `entity.zombie.hurt` becomes `entity/zombie/hurt`.
 *
 * Resource pack paths only accept [a-z0-9_.-] and `/`, so anything else in an
 * event id (there shouldn't be, but modded packs get creative) is folded to `_`.
 */
export function eventIdToPath(eventId: string): string {
  return eventId
    .toLowerCase()
    .replace(/^[a-z0-9_.-]+:/, '')
    .split('.')
    .map((segment) => segment.replace(/[^a-z0-9_-]/g, '_'))
    .filter(Boolean)
    .join('/')
}

/** Make a string safe to use as a single file or directory name. */
export function safeFileName(input: string, fallback = 'untitled'): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows rejects trailing dots and spaces.
    .replace(/[. ]+$/, '')

  // A name that survives substitution but carries no actual characters (say
  // "///" becoming "___") is not a usable file name, so fall back instead.
  return /[a-z0-9]/i.test(cleaned) ? cleaned : fallback
}
