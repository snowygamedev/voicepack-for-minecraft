import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareVersions, identifyInstall, scanForEvents } from '../src/main/services/minecraft-scan'
import { invalidateAssetIndexCache } from '../src/main/services/original-audio'
import { writeZip } from '../src/main/util/zip'
import type { MinecraftVersion } from '../src/shared/types'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'voicepack-scan-'))
})

afterEach(async () => {
  // The sounds/asset caches are keyed by jar path, and temp dirs get reused.
  invalidateAssetIndexCache()
  await rm(root, { recursive: true, force: true })
})

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf8')
}

/**
 * A Prism data directory, laid out the way Prism actually lays one out: the
 * client jar in a shared Maven-style library tree, assets shared across every
 * instance, and the game folder inside the instance.
 */
async function makePrismInstall(
  dataDir: string,
  options: { instance: string; name: string; version: string; assetIndex?: string }
): Promise<void> {
  const instanceDir = join(dataDir, 'instances', options.instance)
  await mkdir(join(instanceDir, '.minecraft', 'resourcepacks'), { recursive: true })
  await write(join(instanceDir, 'instance.cfg'), `name=${options.name}\nJavaPath=java\n`)
  await write(
    join(instanceDir, 'mmc-pack.json'),
    JSON.stringify({
      formatVersion: 1,
      components: [
        { uid: 'net.minecraft', version: options.version },
        { uid: 'net.fabricmc.fabric-loader', version: '0.16.0' }
      ]
    })
  )
  await write(
    join(
      dataDir,
      'libraries',
      'com',
      'mojang',
      'minecraft',
      options.version,
      `minecraft-${options.version}-client.jar`
    ),
    'not a real jar'
  )
  if (options.assetIndex) {
    await write(
      join(dataDir, 'meta', 'net.minecraft', `${options.version}.json`),
      JSON.stringify({ assetIndex: { id: options.assetIndex } })
    )
  }
}

describe('identifyInstall', () => {
  it('reads a Prism data directory, one entry per instance', async () => {
    const dataDir = join(root, 'PrismLauncher')
    await makePrismInstall(dataDir, {
      instance: 'survival',
      name: 'Survival World',
      version: '1.21.4',
      assetIndex: '19'
    })
    await makePrismInstall(dataDir, {
      instance: 'old',
      name: 'Old Pack',
      version: '1.20.1',
      assetIndex: '8'
    })

    const install = await identifyInstall(dataDir)
    expect(install?.kind).toBe('prism')
    expect(install?.versions).toHaveLength(2)

    // Newest first, so the picker's default is the one they most likely play.
    const newest = install!.versions[0]!
    const older = install!.versions[1]!
    expect(newest.id).toBe('1.21.4')
    expect(newest.label).toBe('Survival World (1.21.4)')
    expect(newest.assetIndex).toBe('19')
    expect(newest.assetsDir).toBe(join(dataDir, 'assets'))
    // The game folder is per-instance — this is where a pack has to be installed.
    expect(newest.gameDir).toBe(join(dataDir, 'instances', 'survival', '.minecraft'))
    expect(older.id).toBe('1.20.1')
  })

  it('accepts a single Prism instance folder and finds the data dir above it', async () => {
    const dataDir = join(root, 'PrismLauncher')
    await makePrismInstall(dataDir, {
      instance: 'survival',
      name: 'Survival World',
      version: '1.21.4',
      assetIndex: '19'
    })

    const install = await identifyInstall(join(dataDir, 'instances', 'survival'))
    expect(install?.root).toBe(dataDir)
    expect(install?.versions.map((v) => v.id)).toEqual(['1.21.4'])
  })

  it('falls back to matching an asset index by version series', async () => {
    const dataDir = join(root, 'PrismLauncher')
    // No meta/ folder: Prism's metadata cache can be cleared, and indexes are
    // named after the series ("1.21") rather than the exact release.
    await makePrismInstall(dataDir, {
      instance: 'survival',
      name: 'Survival',
      version: '1.21.4'
    })
    await write(join(dataDir, 'assets', 'indexes', '1.21.json'), '{"objects":{}}')

    const install = await identifyInstall(dataDir)
    expect(install?.versions[0]?.assetIndex).toBe('1.21')
  })

  it('reads an old MultiMC instance that uses "minecraft" and IntendedVersion', async () => {
    const dataDir = join(root, 'MultiMC')
    const instanceDir = join(dataDir, 'instances', 'legacy')
    await mkdir(join(instanceDir, 'minecraft'), { recursive: true })
    await write(join(instanceDir, 'instance.cfg'), 'name=Legacy\nIntendedVersion=1.12.2\n')
    await write(
      join(dataDir, 'libraries', 'com', 'mojang', 'minecraft', '1.12.2', 'minecraft-1.12.2-client.jar'),
      'jar'
    )

    const install = await identifyInstall(dataDir)
    expect(install?.kind).toBe('multimc')
    expect(install?.versions[0]?.id).toBe('1.12.2')
    expect(install?.versions[0]?.gameDir).toBe(join(instanceDir, 'minecraft'))
  })

  it('still reads a vanilla .minecraft directory', async () => {
    const dir = join(root, '.minecraft')
    await write(join(dir, 'versions', '1.21.4', '1.21.4.jar'), 'jar')
    await write(
      join(dir, 'versions', '1.21.4', '1.21.4.json'),
      JSON.stringify({ assets: '19' })
    )

    const install = await identifyInstall(dir)
    expect(install?.kind).toBe('vanilla')
    expect(install?.versions).toEqual([
      {
        id: '1.21.4',
        label: '1.21.4',
        jarPath: join(dir, 'versions', '1.21.4', '1.21.4.jar'),
        assetIndex: '19',
        assetsDir: join(dir, 'assets'),
        gameDir: dir
      }
    ])
  })

  it('skips instances whose client jar has not been downloaded yet', async () => {
    const dataDir = join(root, 'PrismLauncher')
    const instanceDir = join(dataDir, 'instances', 'fresh')
    await mkdir(join(instanceDir, '.minecraft'), { recursive: true })
    await write(join(instanceDir, 'instance.cfg'), 'name=Fresh\n')
    await write(
      join(instanceDir, 'mmc-pack.json'),
      JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.21.4' }] })
    )

    const install = await identifyInstall(dataDir)
    expect(install).toBeNull()
  })

  it('returns null for a folder that is not a Minecraft install at all', async () => {
    const dir = join(root, 'Documents')
    await mkdir(dir, { recursive: true })
    expect(await identifyInstall(dir)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders releases numerically, not lexically', () => {
    expect(compareVersions('1.21.10', '1.21.9')).toBeGreaterThan(0)
  })

  it('ranks releases above snapshots above anything unrecognised', () => {
    expect(compareVersions('1.21.4', '24w14a')).toBeGreaterThan(0)
    expect(compareVersions('24w14a', 'fabric-loader-1.21.4')).toBeGreaterThan(0)
  })
})

/**
 * Put a sounds.json into a content-addressed asset store and index it, the way
 * the launcher does when it downloads assets.
 */
async function writeAsset(
  assetsDir: string,
  logicalPath: string,
  body: string,
  indexName: string
): Promise<void> {
  // Any 40-char hex string works: the index is what maps logical path to file.
  const hash = 'a'.repeat(38) + (logicalPath.length % 100).toString().padStart(2, '0')
  await write(join(assetsDir, 'objects', hash.slice(0, 2), hash), body)

  const indexPath = join(assetsDir, 'indexes', `${indexName}.json`)
  let objects: Record<string, { hash: string; size: number }> = {}
  try {
    objects = JSON.parse(await readFile(indexPath, 'utf8')).objects
  } catch {
    objects = {}
  }
  objects[logicalPath] = { hash, size: body.length }
  await write(indexPath, JSON.stringify({ objects }))
}

const SOUNDS = JSON.stringify({
  'entity.zombie.hurt': {
    category: 'hostile',
    subtitle: 'subtitles.entity.zombie.hurt',
    sounds: ['mob/zombie/hurt1', 'mob/zombie/hurt2']
  },
  'block.stone.break': { sounds: ['dig/stone1'] }
})

describe('scanForEvents', () => {
  function version(overrides: Partial<MinecraftVersion>): MinecraftVersion {
    return {
      id: '26.2',
      label: 'Test (26.2)',
      jarPath: join(root, 'client.jar'),
      assetIndex: '32',
      assetsDir: join(root, 'assets'),
      gameDir: join(root, 'minecraft'),
      ...overrides
    }
  }

  it('reads sounds.json from the asset store, where current versions keep it', async () => {
    // Modern client jars contain no sounds.json at all — it is a downloaded
    // asset — so this jar deliberately has none.
    await writeZip(join(root, 'client.jar'), [
      { path: 'assets/minecraft/gpu_warnlist.json', content: Buffer.from('{}') }
    ])
    await writeAsset(join(root, 'assets'), 'minecraft/sounds.json', SOUNDS, '32')

    const events = await scanForEvents(version({}))
    expect(events.map((e) => e.id)).toEqual(['block.stone.break', 'entity.zombie.hurt'])

    const zombie = events.find((e) => e.id === 'entity.zombie.hurt')!
    expect(zombie.category).toBe('hostile')
    expect(zombie.subtitle).toBe('subtitles.entity.zombie.hurt')
    expect(zombie.variantCount).toBe(2)

    // No declared category, so it is inferred from the event id.
    expect(events.find((e) => e.id === 'block.stone.break')?.category).toBe('block')
  })

  it('falls back to the jar for older versions that still ship sounds.json', async () => {
    await writeZip(join(root, 'client.jar'), [
      { path: 'assets/minecraft/sounds.json', content: Buffer.from(SOUNDS) }
    ])

    const events = await scanForEvents(version({ assetIndex: null }))
    expect(events).toHaveLength(2)
  })

  it('explains itself when the sound list cannot be found anywhere', async () => {
    await writeZip(join(root, 'client.jar'), [
      { path: 'assets/minecraft/gpu_warnlist.json', content: Buffer.from('{}') }
    ])

    await expect(scanForEvents(version({}))).rejects.toThrow(/finishes downloading its assets/)
  })
})
