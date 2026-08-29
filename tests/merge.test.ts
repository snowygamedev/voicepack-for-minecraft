import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planMerge } from '../src/shared/merge'
import { mergeProjects } from '../src/main/services/project-merge'
import { projectSchema, takeSchema, type Project, type Take } from '../src/shared/schema'
import { PROJECT_SCHEMA_VERSION } from '../src/shared/schema'

function take(overrides: Partial<Take> = {}): Take {
  return takeSchema.parse({
    id: overrides.id ?? 'take-1',
    file: overrides.file ?? 'takes/entity/zombie/hurt/take-01.wav',
    duration: 1.5,
    sampleRate: 48000,
    channels: 1,
    peak: 0.7,
    recordedAt: '2026-01-01T00:00:00.000Z',
    label: 'Take 1',
    ...overrides
  })
}

function binding(eventId: string, takes: Take[] = []): Project['bindings'][number] {
  return {
    eventId,
    category: 'hostile',
    enabled: true,
    replace: true,
    subtitle: null,
    takes,
    activeTakeId: takes[0]?.id ?? null
  }
}

function project(name: string, bindings: Project['bindings']): Project {
  return projectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    description: '',
    packFormat: 55,
    namespace: 'minecraft',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    bindings
  })
}

describe('planMerge', () => {
  it('adds everything when the two packs cover different sounds', () => {
    const mine = project('Mine', [binding('a.one', [take()]), binding('a.two', [take()])])
    const theirs = project('Theirs', [binding('a.three', [take()]), binding('a.four', [take()])])

    expect(planMerge(mine, theirs, 'append').map((e) => e.action)).toEqual(['add', 'add'])
  })

  it('fills in an event I listed but never recorded, whatever the mode', () => {
    const mine = project('Mine', [binding('a.one')])
    const theirs = project('Theirs', [binding('a.one', [take()])])

    for (const mode of ['skip', 'append', 'replace'] as const) {
      expect(planMerge(mine, theirs, mode)[0]?.action).toBe('fill')
    }
  })

  it('follows the chosen mode only where both packs recorded the same event', () => {
    const mine = project('Mine', [binding('a.one', [take()])])
    const theirs = project('Theirs', [binding('a.one', [take({ id: 'take-2' })])])

    expect(planMerge(mine, theirs, 'skip')[0]?.action).toBe('skip')
    expect(planMerge(mine, theirs, 'append')[0]?.action).toBe('append')
    expect(planMerge(mine, theirs, 'replace')[0]?.action).toBe('replace')
  })

  it('never brings across an empty binding that would overwrite a recording', () => {
    const mine = project('Mine', [binding('a.one', [take()])])
    const theirs = project('Theirs', [binding('a.one')])

    expect(planMerge(mine, theirs, 'replace')[0]?.action).toBe('skip')
  })
})

const madeDirs: string[] = []

async function writeProject(name: string, bindings: Project['bindings']): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'voicepack-merge-'))
  madeDirs.push(dir)
  for (const b of bindings) {
    for (const t of b.takes) {
      await mkdir(join(dir, t.file, '..'), { recursive: true })
      await writeFile(join(dir, t.file), `audio for ${b.eventId}`)
    }
  }
  await writeFile(join(dir, 'project.json'), JSON.stringify(project(name, bindings)), 'utf8')
  return dir
}

afterEach(() => {
  madeDirs.length = 0
})

describe('mergeProjects', () => {
  it('copies the other pack’s audio in and points the project at the copies', async () => {
    const mineDir = await writeProject('Mine', [
      binding('entity.zombie.hurt', [take({ file: 'takes/entity/zombie/hurt/take-01.wav' })])
    ])
    const theirsDir = await writeProject('Theirs', [
      binding('entity.pig.ambient', [
        take({ id: 'take-9', file: 'takes/entity/pig/ambient/take-01.wav' })
      ])
    ])

    const { project: merged, summary } = await mergeProjects(mineDir, theirsDir, 'append')

    expect(summary.added).toEqual(['entity.pig.ambient'])
    expect(summary.copiedFiles).toBe(1)
    expect(merged.bindings.map((b) => b.eventId)).toEqual([
      'entity.zombie.hurt',
      'entity.pig.ambient'
    ])

    const copied = merged.bindings[1]?.takes[0]?.file
    expect(copied).toBe('takes/entity/pig/ambient/take-01.wav')
    expect(await readFile(join(mineDir, copied ?? ''), 'utf8')).toBe('audio for entity.pig.ambient')
  })

  it('keeps both packs’ takes on a shared event without overwriting a file', async () => {
    const shared = 'entity.zombie.hurt'
    const mineDir = await writeProject('Mine', [
      binding(shared, [take({ file: 'takes/entity/zombie/hurt/take-01.wav' })])
    ])
    const theirsDir = await writeProject('Theirs', [
      binding(shared, [take({ id: 'take-2', file: 'takes/entity/zombie/hurt/take-01.wav' })])
    ])

    const { project: merged } = await mergeProjects(mineDir, theirsDir, 'append')

    const files = merged.bindings[0]?.takes.map((t) => t.file)
    expect(files).toEqual([
      'takes/entity/zombie/hurt/take-01.wav',
      'takes/entity/zombie/hurt/take-02.wav'
    ])
    // The take that was already there must survive byte for byte.
    expect(await readFile(join(mineDir, 'takes/entity/zombie/hurt/take-01.wav'), 'utf8')).toBe(
      'audio for entity.zombie.hurt'
    )
  })

  it('refuses to merge a pack into itself', async () => {
    const dir = await writeProject('Mine', [binding('a.one', [])])
    await expect(mergeProjects(dir, dir, 'append')).rejects.toThrow(/already have open/)
  })
})
