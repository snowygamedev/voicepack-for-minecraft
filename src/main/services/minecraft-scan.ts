import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CatalogEvent, LauncherKind, MinecraftInstall, MinecraftVersion } from '@shared/types'
import { SOUND_CATEGORIES, guessCategory, type SoundCategory } from '@shared/sound-categories'
import {
  LAUNCHER_DIR_NAME,
  SKIP_SCAN_DIRS,
  kindFromName,
  launcherCandidates,
  portableScanRoots,
  type LauncherCandidate
} from '../util/paths'
import { loadSoundsJson } from './original-audio'

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    // A missing or launcher-mangled json is never fatal here — it only costs us
    // one detail (an asset index, a version id) about one install.
    return null
  }
}

/**
 * Find every Minecraft install we can, across the launchers we know about.
 *
 * Returns all of them rather than the first hit: plenty of people have the
 * vanilla launcher installed and never use it, and picking that one over the
 * Prism instance they actually play would be the wrong guess.
 */
export async function detectInstalls(): Promise<MinecraftInstall[]> {
  const candidates = [...launcherCandidates(), ...(await findPortableLaunchers())]
  const found: MinecraftInstall[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (seen.has(candidate.dir)) continue
    seen.add(candidate.dir)
    const install = await inspectCandidate(candidate)
    if (install && install.versions.length > 0) found.push(install)
  }
  return found
}

/** How many directories a portable sweep may list before giving up. */
const SCAN_BUDGET = 400

/**
 * Hunt for portable launcher folders in the likely places.
 *
 * Two levels deep from each scan root, which covers both `D:\PrismLauncher`
 * and the far more common `C:\Games\PrismLauncher-...-Portable-11.0.3`. The
 * budget keeps a pathological folder (a drive root with thousands of entries)
 * from turning startup into a disk crawl.
 */
async function findPortableLaunchers(): Promise<LauncherCandidate[]> {
  const found: LauncherCandidate[] = []
  let budget = SCAN_BUDGET

  const sweep = async (dir: string, depth: number): Promise<void> => {
    if (depth > 2 || budget <= 0) return
    budget -= 1

    let entries: string[]
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      // Unreadable, missing, or a drive letter with nothing in it.
      return
    }

    for (const name of entries) {
      if (LAUNCHER_DIR_NAME.test(name)) {
        const kind = kindFromName(name)
        found.push({ dir: join(dir, name), kind, label: labelForKind(kind) })
        continue
      }
      // Only descend through plausible container folders, never system ones.
      if (depth < 2 && !name.startsWith('.') && !SKIP_SCAN_DIRS.has(name.toLowerCase())) {
        await sweep(join(dir, name), depth + 1)
      }
    }
  }

  for (const root of portableScanRoots()) await sweep(root, 1)
  return found
}

function labelForKind(kind: 'prism' | 'multimc' | 'polymc'): string {
  return kind === 'prism' ? 'Prism Launcher' : kind === 'polymc' ? 'PolyMC' : 'MultiMC'
}

async function inspectCandidate(candidate: LauncherCandidate): Promise<MinecraftInstall | null> {
  if (!(await isDir(candidate.dir))) return null
  return candidate.kind === 'vanilla'
    ? inspectVanilla(candidate.dir)
    : inspectInstanceLauncher(candidate.dir, candidate.kind, candidate.label)
}

/**
 * Work out what kind of install a folder the user picked by hand is.
 *
 * People point this at whatever felt like "the Minecraft folder", so we accept
 * a `.minecraft`, a launcher data directory, or a single Prism instance folder
 * (in which case we walk up to the data directory that owns it).
 */
export async function identifyInstall(dir: string): Promise<MinecraftInstall | null> {
  if (!(await isDir(dir))) return null

  const vanilla = await inspectVanilla(dir)
  if (vanilla && vanilla.versions.length > 0) return vanilla

  const asLauncher = await inspectInstanceLauncher(dir, guessKind(dir), launcherLabel(dir))
  if (asLauncher && asLauncher.versions.length > 0) return asLauncher

  // A single instance folder. Normally that is `<data>/instances/<name>`, but
  // people also copy instances out on their own, so we accept any folder that
  // looks like one and guess the data directory from where it sits.
  if (await isFile(join(dir, 'instance.cfg'))) {
    const parent = dirname(dir)
    const dataDir = basename(parent).toLowerCase() === 'instances' ? dirname(parent) : parent
    const version = await inspectInstance(dataDir, dir)
    if (version) {
      return {
        root: dataDir,
        kind: guessKind(dataDir),
        label: launcherLabel(dataDir),
        versions: [version]
      }
    }
  }

  // Last resort: a bare game folder with no versions of its own is still a
  // valid install *target*, even though we cannot read sound events from it.
  // An instance copied away from its launcher lands here too, so check the
  // instance-shaped subfolders as well as the folder itself.
  for (const gameDir of [dir, join(dir, '.minecraft'), join(dir, 'minecraft')]) {
    if (await isDir(join(gameDir, 'resourcepacks'))) {
      return { root: gameDir, kind: 'custom', label: 'Minecraft folder', versions: [] }
    }
  }
  return null
}

function guessKind(dir: string): LauncherKind {
  const name = basename(dir).toLowerCase()
  if (name.includes('prism')) return 'prism'
  if (name.includes('polymc')) return 'polymc'
  if (name.includes('multimc')) return 'multimc'
  return 'custom'
}

function launcherLabel(dir: string): string {
  switch (guessKind(dir)) {
    case 'prism':
      return 'Prism Launcher'
    case 'polymc':
      return 'PolyMC'
    case 'multimc':
      return 'MultiMC'
    default:
      return basename(dir)
  }
}

// ---------------------------------------------------------------------------
// Vanilla launcher: `<root>/versions/<id>/<id>.jar`, assets shared under
// `<root>/assets`, packs installed into `<root>/resourcepacks`.
// ---------------------------------------------------------------------------

async function inspectVanilla(root: string): Promise<MinecraftInstall | null> {
  const versionsDir = join(root, 'versions')
  if (!(await isDir(versionsDir))) return null

  const entries = await readdir(versionsDir, { withFileTypes: true })
  const versions: MinecraftVersion[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const jarPath = join(versionsDir, entry.name, `${entry.name}.jar`)
    if (!(await isFile(jarPath))) continue

    versions.push({
      id: entry.name,
      label: entry.name,
      jarPath,
      assetIndex: await readAssetIndexName(join(versionsDir, entry.name, `${entry.name}.json`)),
      assetsDir: join(root, 'assets'),
      gameDir: root
    })
  }

  versions.sort((a, b) => compareVersions(b.id, a.id))
  return { root, kind: 'vanilla', label: 'Minecraft Launcher', versions }
}

async function readAssetIndexName(versionJson: string): Promise<string | null> {
  const parsed = await readJson<{ assets?: unknown; assetIndex?: { id?: unknown } }>(versionJson)
  if (typeof parsed?.assets === 'string') return parsed.assets
  if (typeof parsed?.assetIndex?.id === 'string') return parsed.assetIndex.id
  return null
}

// ---------------------------------------------------------------------------
// Prism / PolyMC / MultiMC. One data directory holds:
//   instances/<name>/.minecraft      the game folder (resourcepacks live here)
//   instances/<name>/mmc-pack.json   which Minecraft version the instance runs
//   libraries/com/mojang/minecraft/<v>/minecraft-<v>-client.jar
//   meta/net.minecraft/<v>.json      version metadata, incl. the asset index
//   assets/{indexes,objects}         shared asset store
// Each *instance* is a separate target: same jar, different game folder.
// ---------------------------------------------------------------------------

async function inspectInstanceLauncher(
  dataDir: string,
  kind: LauncherKind,
  label: string
): Promise<MinecraftInstall | null> {
  const instancesDir = join(dataDir, 'instances')
  if (!(await isDir(instancesDir))) return null

  const entries = await readdir(instancesDir, { withFileTypes: true })
  const versions: MinecraftVersion[] = []

  for (const entry of entries) {
    // `_LAUNCHER_TMP` and the trash folder are bookkeeping, not instances.
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const version = await inspectInstance(dataDir, join(instancesDir, entry.name))
    if (version) versions.push(version)
  }

  versions.sort((a, b) => compareVersions(b.id, a.id) || a.label.localeCompare(b.label))
  return { root: dataDir, kind, label, versions }
}

async function inspectInstance(
  dataDir: string,
  instanceDir: string
): Promise<MinecraftVersion | null> {
  // Prism uses `.minecraft`; older MultiMC instances use `minecraft`.
  const gameDir = (await isDir(join(instanceDir, '.minecraft')))
    ? join(instanceDir, '.minecraft')
    : (await isDir(join(instanceDir, 'minecraft')))
      ? join(instanceDir, 'minecraft')
      : null
  if (!gameDir) return null

  const id = await readInstanceVersion(instanceDir)
  if (!id) return null

  const jarPath = await findClientJar(dataDir, gameDir, id)
  if (!jarPath) return null

  return {
    id,
    label: `${await readInstanceName(instanceDir)} (${id})`,
    jarPath,
    assetIndex: await resolveAssetIndex(dataDir, id),
    assetsDir: join(dataDir, 'assets'),
    gameDir
  }
}

interface MmcPack {
  components?: Array<{ uid?: string; version?: string }>
}

async function readInstanceVersion(instanceDir: string): Promise<string | null> {
  const pack = await readJson<MmcPack>(join(instanceDir, 'mmc-pack.json'))
  const component = pack?.components?.find((c) => c.uid === 'net.minecraft')
  if (typeof component?.version === 'string') return component.version

  // Pre-mmc-pack instances kept the version in instance.cfg instead.
  return (await readCfg(instanceDir))?.IntendedVersion ?? null
}

async function readInstanceName(instanceDir: string): Promise<string> {
  const name = (await readCfg(instanceDir))?.name
  return name && name.trim() ? name.trim() : basename(instanceDir)
}

/** instance.cfg is a flat `key=value` INI without sections. */
async function readCfg(instanceDir: string): Promise<Record<string, string> | null> {
  try {
    const text = await readFile(join(instanceDir, 'instance.cfg'), 'utf8')
    const out: Record<string, string> = {}
    for (const line of text.split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq > 0 && !line.startsWith('#')) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    return out
  } catch {
    return null
  }
}

/**
 * The client jar for a version. Normally it is in the launcher-wide library
 * store; instances that were imported or hand-modified sometimes carry a
 * vanilla-shaped `versions/` folder of their own instead.
 */
async function findClientJar(
  dataDir: string,
  gameDir: string,
  id: string
): Promise<string | null> {
  const libraryDir = join(dataDir, 'libraries', 'com', 'mojang', 'minecraft', id)
  const candidates = [
    join(libraryDir, `minecraft-${id}-client.jar`),
    join(dataDir, 'versions', id, `${id}.jar`),
    join(gameDir, 'versions', id, `${id}.jar`),
    join(gameDir, 'bin', 'minecraft.jar')
  ]
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }

  // Nothing at the expected name — take any client jar sitting in the version's
  // library folder, since the naming has shifted between launcher releases.
  try {
    const jars = (await readdir(libraryDir)).filter((n) => n.endsWith('.jar'))
    const jar = jars.find((n) => n.includes('client')) ?? jars[0]
    if (jar) return join(libraryDir, jar)
  } catch {
    // No library folder for this version at all.
  }
  return null
}

/**
 * Which asset index a version uses. Prism records it in its metadata cache; if
 * that has been cleared we fall back to matching an index file by name, since
 * indexes are named after the version series ("1.21", "26") rather than the
 * exact release.
 */
async function resolveAssetIndex(dataDir: string, id: string): Promise<string | null> {
  const meta = await readJson<{ assetIndex?: { id?: unknown } }>(
    join(dataDir, 'meta', 'net.minecraft', `${id}.json`)
  )
  if (typeof meta?.assetIndex?.id === 'string') return meta.assetIndex.id

  const indexesDir = join(dataDir, 'assets', 'indexes')
  let names: string[]
  try {
    names = (await readdir(indexesDir)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5))
  } catch {
    return null
  }
  if (names.includes(id)) return id

  // "1.21.4" → try "1.21", then "1".
  const parts = id.split('.')
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('.')
    if (names.includes(prefix)) return prefix
  }
  return null
}

/** Snapshots look like `24w14a`; modded/launcher ids look like anything at all. */
const SNAPSHOT = /^\d{2}w\d{2}[a-z]$/i
const RELEASE = /^\d+(\.\d+)*$/

function rank(version: string): number {
  if (RELEASE.test(version)) return 2
  if (SNAPSHOT.test(version)) return 1
  return 0
}

/**
 * Order versions so the newest release is first in the picker.
 *
 * Comparison is numeric per component, so "1.21.10" beats "1.21.9" where a
 * plain string sort would not. Releases outrank snapshots, which outrank
 * anything unrecognised (modloader profiles, custom launcher entries) — those
 * have no meaningful numeric order, so they fall back to a stable name sort.
 */
export function compareVersions(a: string, b: string): number {
  const rankDiff = rank(a) - rank(b)
  if (rankDiff !== 0) return rankDiff
  if (rank(a) !== 2) return a.localeCompare(b)

  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * The full sound-event list for a version, read from the user's own install.
 *
 * We read only the *identifiers* and metadata — no Mojang audio or asset file
 * is copied or redistributed.
 */
export async function scanForEvents(version: MinecraftVersion): Promise<CatalogEvent[]> {
  const sounds = await loadSoundsJson(version)
  if (!sounds) {
    throw new Error(
      `Could not read the sound list for ${version.label}. Launch that version once so the ` +
        `launcher finishes downloading its assets, then scan again.`
    )
  }

  const events: CatalogEvent[] = []
  for (const [id, value] of Object.entries(sounds)) {
    const declared = value?.category
    const category: SoundCategory =
      typeof declared === 'string' && (SOUND_CATEGORIES as readonly string[]).includes(declared)
        ? (declared as SoundCategory)
        : guessCategory(id)

    events.push({
      id,
      category,
      subtitle: typeof value?.subtitle === 'string' ? value.subtitle : undefined,
      variantCount: Array.isArray(value?.sounds) ? value.sounds.length : undefined,
      source: 'scan'
    })
  }
  events.sort((a, b) => a.id.localeCompare(b.id))
  return events
}
