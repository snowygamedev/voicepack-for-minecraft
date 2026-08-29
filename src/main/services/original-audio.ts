import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readZipEntry } from '../util/zip'
import type { MinecraftVersion } from '@shared/types'

/**
 * Read the vanilla sound data a user is about to replace.
 *
 * Everything here reads the user's own installed copy of Minecraft. Nothing is
 * copied into a project or into an exported pack, so no Mojang asset is ever
 * redistributed by this app.
 *
 * Vanilla audio is not stored in the jar. It lives content-addressed under
 * `<assets>/objects/<first two hex chars>/<sha1>`, and the mapping from a
 * logical path to that hash is in `<assets>/indexes/<index>.json`. Where that
 * assets folder sits depends on the launcher — vanilla keeps it inside
 * `.minecraft`, Prism shares one across every instance — so the version we were
 * handed carries its own path to it.
 */

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
}

/** The shape of the game's own sounds.json, wherever we read it from. */
export interface VanillaSoundsJson {
  [eventId: string]: {
    category?: string
    subtitle?: string
    sounds?: Array<string | { name?: string; type?: string }>
  }
}

let indexCache: { path: string; index: AssetIndex } | null = null
let soundsCache: { key: string; sounds: VanillaSoundsJson } | null = null

async function loadAssetIndex(assetsDir: string, indexName: string): Promise<AssetIndex | null> {
  const path = join(assetsDir, 'indexes', `${indexName}.json`)
  if (indexCache?.path === path) return indexCache.index
  try {
    const index = JSON.parse(await readFile(path, 'utf8')) as AssetIndex
    indexCache = { path, index }
    return index
  } catch {
    return null
  }
}

/** Assets are content-addressed: `<assets>/objects/<first two of hash>/<hash>`. */
function objectPath(assetsDir: string, hash: string): string {
  return join(assetsDir, 'objects', hash.slice(0, 2), hash)
}

/**
 * The game's sound-event definitions for a version.
 *
 * Where these live has moved. They used to ship inside the client jar; in
 * current versions sounds.json is a downloaded asset like any sound file,
 * listed in the asset index under `minecraft/sounds.json` and absent from the
 * jar entirely. We try the asset store first and fall back to the jar, so old
 * and new installs both work.
 */
export async function loadSoundsJson(version: MinecraftVersion): Promise<VanillaSoundsJson | null> {
  if (soundsCache?.key === version.jarPath) return soundsCache.sounds

  const sounds = (await soundsFromAssets(version)) ?? (await soundsFromJar(version.jarPath))
  if (sounds) soundsCache = { key: version.jarPath, sounds }
  return sounds
}

async function soundsFromAssets(version: MinecraftVersion): Promise<VanillaSoundsJson | null> {
  if (!version.assetIndex) return null
  const index = await loadAssetIndex(version.assetsDir, version.assetIndex)
  const object = index?.objects['minecraft/sounds.json']
  if (!object) return null
  try {
    return JSON.parse(
      await readFile(objectPath(version.assetsDir, object.hash), 'utf8')
    ) as VanillaSoundsJson
  } catch {
    // Listed in the index but not downloaded yet, or unreadable.
    return null
  }
}

async function soundsFromJar(jarPath: string): Promise<VanillaSoundsJson | null> {
  const buf = await readZipEntry(jarPath, 'assets/minecraft/sounds.json')
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8')) as VanillaSoundsJson
  } catch {
    return null
  }
}

/** The logical asset path of the first variant of an event, e.g. `mob/zombie/say1`. */
async function firstVariantPath(
  version: MinecraftVersion,
  eventId: string
): Promise<string | null> {
  const sounds = await loadSoundsJson(version)
  const first = sounds?.[eventId]?.sounds?.[0]
  if (first === undefined) return null

  // An entry is either a bare path string or an object. `type: "event"` means it
  // delegates to another event, which we do not chase (rare, and one hop deep
  // is enough of a rabbit hole for a preview button).
  if (typeof first === 'string') return first
  if (first.type === 'event') return null
  return first.name ?? null
}

/**
 * Resolve an event id to the bytes of its first vanilla variant, or null when
 * the sound is not downloaded (Minecraft fetches assets lazily) or unknown.
 */
export async function readOriginalAudio(
  version: MinecraftVersion,
  eventId: string
): Promise<Buffer | null> {
  if (!version.assetIndex) return null

  const variant = await firstVariantPath(version, eventId)
  if (!variant) return null

  const index = await loadAssetIndex(version.assetsDir, version.assetIndex)
  if (!index) return null

  const object = index.objects[`minecraft/sounds/${variant}.ogg`]
  if (!object) return null

  try {
    return await readFile(objectPath(version.assetsDir, object.hash))
  } catch {
    return null
  }
}

/** Drop cached index data, e.g. when the user points at a different install. */
export function invalidateAssetIndexCache(): void {
  indexCache = null
  soundsCache = null
}
