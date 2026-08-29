import { describe, expect, it } from 'vitest'
import { buildPackMcmeta, buildSoundsJson, validate } from '../src/main/services/pack-builder'
import { projectSchema, takeSchema, type Project, type Take } from '../src/shared/schema'
import { PROJECT_SCHEMA_VERSION } from '../src/shared/schema'

function take(overrides: Partial<Take> = {}): Take {
  return takeSchema.parse({
    id: overrides.id ?? 'take-1',
    file: 'takes/entity/zombie/hurt/take-01.wav',
    duration: 1.5,
    sampleRate: 48000,
    channels: 1,
    peak: 0.7,
    recordedAt: '2026-01-01T00:00:00.000Z',
    label: 'Take 1',
    ...overrides
  })
}

function project(overrides: Partial<Project> = {}): Project {
  return projectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: 'Test Pack',
    description: 'A pack',
    packFormat: 55,
    namespace: 'minecraft',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    bindings: [
      {
        eventId: 'entity.zombie.hurt',
        category: 'hostile',
        takes: [take()],
        activeTakeId: 'take-1'
      }
    ],
    ...overrides
  })
}

describe('buildSoundsJson', () => {
  it('maps an event id to a nested sound path', () => {
    const json = buildSoundsJson(project())
    expect(json['entity.zombie.hurt']).toEqual({
      replace: true,
      category: 'hostile',
      sounds: [{ name: 'voicepack/entity/zombie/hurt/1' }]
    })
  })

  it('omits default volume, pitch and weight so the file stays readable', () => {
    const json = buildSoundsJson(project())
    const sound = json['entity.zombie.hurt']?.sounds[0]
    expect(sound).not.toHaveProperty('volume')
    expect(sound).not.toHaveProperty('pitch')
    expect(sound).not.toHaveProperty('weight')
  })

  it('emits every take as a numbered pool when no take is pinned', () => {
    const json = buildSoundsJson(
      project({
        bindings: [
          {
            eventId: 'entity.zombie.hurt',
            category: 'hostile',
            enabled: true,
            replace: true,
            subtitle: null,
            takes: [take({ id: 'a' }), take({ id: 'b', weight: 3 })],
            activeTakeId: null
          }
        ]
      })
    )
    expect(json['entity.zombie.hurt']?.sounds).toEqual([
      { name: 'voicepack/entity/zombie/hurt/1' },
      { name: 'voicepack/entity/zombie/hurt/2', weight: 3 }
    ])
  })

  it('marks long sounds as streamed', () => {
    const json = buildSoundsJson(
      project({
        bindings: [
          {
            eventId: 'music.game',
            category: 'music',
            enabled: true,
            replace: true,
            subtitle: null,
            takes: [take({ duration: 90 })],
            activeTakeId: 'take-1'
          }
        ]
      })
    )
    expect(json['music.game']?.sounds[0]?.stream).toBe(true)
  })

  it('skips disabled bindings and bindings with no takes', () => {
    const json = buildSoundsJson(
      project({
        bindings: [
          {
            eventId: 'entity.zombie.hurt',
            category: 'hostile',
            enabled: false,
            replace: true,
            subtitle: null,
            takes: [take()],
            activeTakeId: 'take-1'
          },
          {
            eventId: 'entity.creeper.primed',
            category: 'hostile',
            enabled: true,
            replace: true,
            subtitle: null,
            takes: [],
            activeTakeId: null
          }
        ]
      })
    )
    expect(Object.keys(json)).toEqual([])
  })
})

describe('buildPackMcmeta', () => {
  it('writes the pack_format the project targets', () => {
    const parsed = JSON.parse(buildPackMcmeta(project({ packFormat: 34 })))
    expect(parsed.pack.pack_format).toBe(34)
    expect(parsed.pack.description).toBe('A pack')
  })

  it('falls back to the pack name when there is no description', () => {
    const parsed = JSON.parse(buildPackMcmeta(project({ description: '' })))
    expect(parsed.pack.description).toBe('Test Pack')
  })

  it('includes supported_formats only when set', () => {
    expect(JSON.parse(buildPackMcmeta(project())).pack).not.toHaveProperty('supported_formats')
    const ranged = JSON.parse(
      buildPackMcmeta(project({ supportedFormats: { min: 34, max: 55 } }))
    )
    expect(ranged.pack.supported_formats).toEqual([34, 55])
  })
})

describe('validate', () => {
  it('accepts a well-formed project', () => {
    expect(validate(project())).toEqual([])
  })

  it('rejects a project with nothing enabled', () => {
    const issues = validate(project({ bindings: [] }))
    expect(issues.some((i) => i.severity === 'error')).toBe(true)
  })

  it('warns, but does not fail, on an event that is not recorded yet', () => {
    const unrecorded = {
      eventId: 'entity.pig.ambient',
      category: 'neutral' as const,
      enabled: true,
      replace: true,
      subtitle: null,
      takes: [],
      activeTakeId: null
    }
    const issues = validate(
      project({ bindings: [unrecorded, { ...basicBinding(), takes: [take()] }] })
    )

    expect(issues).toContainEqual({
      severity: 'warning',
      eventId: 'entity.pig.ambient',
      message: 'Not recorded yet — it will be left out of the pack.'
    })
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
  })

  it('errors when nothing in the pack has been recorded', () => {
    const issues = validate(project({ bindings: [basicBinding()] }))
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('empty'))).toBe(true)
  })

  it('warns about clipping and about silence', () => {
    const clipping = validate(
      project({ bindings: [{ ...basicBinding(), takes: [take({ peak: 1 })] }] })
    )
    expect(clipping.some((i) => i.message.includes('clipping'))).toBe(true)

    const silent = validate(
      project({ bindings: [{ ...basicBinding(), takes: [take({ peak: 0 })] }] })
    )
    expect(silent.some((i) => i.message.includes('silent'))).toBe(true)
  })

  it('errors when trimming leaves nothing behind', () => {
    const issues = validate(
      project({
        bindings: [{ ...basicBinding(), takes: [take({ trimStart: 1.5, trimEnd: 1.5 })] }]
      })
    )
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('empty'))).toBe(true)
  })
})

function basicBinding(): Project['bindings'][number] {
  return {
    eventId: 'entity.zombie.hurt',
    category: 'hostile',
    enabled: true,
    replace: true,
    subtitle: null,
    takes: [],
    activeTakeId: 'take-1'
  }
}
