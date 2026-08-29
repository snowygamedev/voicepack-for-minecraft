import { describe, expect, it } from 'vitest'
import { computePeaks, concatChunks, encodeWav, findSoundBounds, peakOf } from '../src/shared/wav'
import { buildFilterChain, normalizationGainDb } from '../src/main/services/ffmpeg'
import { eventIdToPath, safeFileName } from '../src/main/util/paths'
import { compareVersions } from '../src/main/services/minecraft-scan'

describe('encodeWav', () => {
  it('writes a RIFF/WAVE header describing the audio', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1])
    const view = new DataView(encodeWav({ sampleRate: 48000, channels: [samples] }))
    const ascii = (offset: number, length: number): string =>
      String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // channels
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(16) // bit depth
    expect(ascii(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
  })

  it('sizes the buffer as header plus interleaved 16-bit frames', () => {
    const left = new Float32Array(100)
    const right = new Float32Array(100)
    const buffer = encodeWav({ sampleRate: 44100, channels: [left, right] })
    expect(buffer.byteLength).toBe(44 + 100 * 2 * 2)
  })

  it('clamps out-of-range samples instead of wrapping them', () => {
    const view = new DataView(
      encodeWav({ sampleRate: 8000, channels: [new Float32Array([2, -2])] })
    )
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })

  it('refuses to encode with no channels', () => {
    expect(() => encodeWav({ sampleRate: 48000, channels: [] })).toThrow()
  })
})

describe('concatChunks', () => {
  it('joins chunks up to the frame count', () => {
    const out = concatChunks([new Float32Array([1, 2]), new Float32Array([3, 4])], 4)
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
  })

  it('stops at the frame count when chunks overrun it', () => {
    const out = concatChunks([new Float32Array([1, 2]), new Float32Array([3, 4])], 3)
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
})

describe('peakOf', () => {
  it('finds the largest magnitude regardless of sign', () => {
    expect(peakOf(new Float32Array([0.1, -0.8, 0.3]))).toBeCloseTo(0.8)
  })

  it('reports zero for silence', () => {
    expect(peakOf(new Float32Array(64))).toBe(0)
  })
})

describe('computePeaks', () => {
  it('reduces samples to the requested bucket count', () => {
    const samples = new Float32Array(1000).map((_, i) => Math.sin(i / 10))
    const { min, max } = computePeaks(samples, 50)
    expect(min).toHaveLength(50)
    expect(max).toHaveLength(50)
    expect(Math.max(...max)).toBeGreaterThan(0)
    expect(Math.min(...min)).toBeLessThan(0)
  })
})

describe('findSoundBounds', () => {
  const RATE = 48000

  /** `silence` seconds of near-nothing, then a loud tone to the end. */
  function withLeadIn(silenceSeconds: number, noise = 0.001): Float32Array {
    const total = RATE * 2
    const samples = new Float32Array(total)
    const speechAt = Math.round(silenceSeconds * RATE)
    for (let i = 0; i < total; i++) {
      samples[i] = i < speechAt ? noise * Math.sin(i) : 0.8 * Math.sin(i / 10)
    }
    return samples
  }

  /** Silence, then a tone, then silence again. */
  function withBothEnds(leadIn: number, soundFor: number, noise = 0.001): Float32Array {
    const total = RATE * 3
    const samples = new Float32Array(total)
    const from = Math.round(leadIn * RATE)
    const to = Math.round((leadIn + soundFor) * RATE)
    for (let i = 0; i < total; i++) {
      samples[i] = i >= from && i < to ? 0.8 * Math.sin(i / 10) : noise * Math.sin(i)
    }
    return samples
  }

  it('finds the moment the sound starts', () => {
    expect(findSoundBounds(withLeadIn(0.5), RATE).start).toBeCloseTo(0.46, 2)
  })

  it('keeps a little lead-in so the attack is not clipped', () => {
    const { start } = findSoundBounds(withLeadIn(0.5), RATE)
    expect(start).toBeLessThan(0.5)
    expect(start).toBeGreaterThan(0.4)
  })

  it('trims the silence after the sound too, keeping a tail', () => {
    const { start, end } = findSoundBounds(withBothEnds(0.5, 1), RATE)
    expect(start).toBeCloseTo(0.46, 2)
    // Sound ends at 1.5s; the tail pad keeps a little of the decay.
    expect(end).toBeCloseTo(1.62, 2)
  })

  it('leaves the end alone when the sound runs to the end of the take', () => {
    expect(findSoundBounds(withLeadIn(0.5), RATE).end).toBeNull()
  })

  it('never returns a negative start when the sound begins immediately', () => {
    expect(findSoundBounds(withLeadIn(0), RATE).start).toBe(0)
  })

  it('leaves a take alone when nothing crosses the threshold', () => {
    const hiss = new Float32Array(RATE)
    for (let i = 0; i < hiss.length; i++) hiss[i] = 0.001 * Math.sin(i)
    expect(findSoundBounds(hiss, RATE)).toEqual({ start: 0, end: null })
  })

  it('scales to the take: a quiet recording is trimmed like a loud one', () => {
    const quiet = withBothEnds(0.5, 1).map((v) => v * 0.1) as Float32Array
    expect(findSoundBounds(quiet, RATE).start).toBeCloseTo(0.46, 2)
    expect(findSoundBounds(quiet, RATE).end).toBeCloseTo(1.62, 2)
  })

  it('handles empty audio', () => {
    expect(findSoundBounds(new Float32Array(0), RATE)).toEqual({ start: 0, end: null })
  })

  it('ignores the click of the key that started the recording', () => {
    const samples = withLeadIn(0.5)
    // 2 ms of loud transient at 0.1s, the shape of a keyboard or mouse click.
    for (let i = Math.round(0.1 * RATE); i < Math.round(0.102 * RATE); i++) {
      samples[i] = 0.9
    }
    expect(findSoundBounds(samples, RATE).start).toBeCloseTo(0.46, 2)
  })

  it('ignores a click after the sound when trimming the end', () => {
    const samples = withBothEnds(0.5, 1)
    // The key being pressed again to stop, 0.4s after the voice stopped.
    for (let i = Math.round(1.9 * RATE); i < Math.round(1.902 * RATE); i++) {
      samples[i] = 0.9
    }
    expect(findSoundBounds(samples, RATE).end).toBeCloseTo(1.62, 2)
  })

  it('still trims when the room itself is noisy', () => {
    const { start, end } = findSoundBounds(withBothEnds(0.5, 1, 0.05), RATE)
    expect(start).toBeCloseTo(0.46, 2)
    expect(end).toBeCloseTo(1.62, 2)
  })

  it('leaves a take alone when the sound never sustains', () => {
    const blip = new Float32Array(RATE)
    for (let i = 1000; i < 1050; i++) blip[i] = 0.9
    expect(findSoundBounds(blip, RATE)).toEqual({ start: 0, end: null })
  })
})

describe('buildFilterChain', () => {
  const base = { noiseReduction: 'off' as const, voiceEnhance: false, gainDb: 0, mono: true }

  it('builds nothing when no processing is asked for', () => {
    expect(buildFilterChain(base)).toEqual([])
  })

  it('rolls off rumble before subtracting noise', () => {
    const chain = buildFilterChain({ ...base, noiseReduction: 'light' })
    expect(chain[0]).toBe('highpass=f=80')
    expect(chain[1]).toMatch(/^afftdn=/)
  })

  it('pulls harder on strong than on light', () => {
    const light = buildFilterChain({ ...base, noiseReduction: 'light' }).join(',')
    const strong = buildFilterChain({ ...base, noiseReduction: 'strong' }).join(',')
    expect(light).toContain('nr=10')
    expect(strong).toContain('nr=20')
  })

  it('limits after the enhancer, so makeup gain cannot clip', () => {
    const chain = buildFilterChain({ ...base, voiceEnhance: true })
    expect(chain.at(-1)).toMatch(/^alimiter=/)
    expect(chain.findIndex((f) => f.startsWith('acompressor'))).toBeLessThan(chain.length - 1)
  })

  it('applies gain after the enhancer but before the limiter', () => {
    const chain = buildFilterChain({ ...base, voiceEnhance: true, gainDb: -3 })
    const gain = chain.findIndex((f) => f.startsWith('volume='))
    const compressor = chain.findIndex((f) => f.startsWith('acompressor'))
    const limiter = chain.findIndex((f) => f.startsWith('alimiter'))
    expect(compressor).toBeLessThan(gain)
    expect(gain).toBeLessThan(limiter)
  })

  it('ignores a gain too small to hear', () => {
    expect(buildFilterChain({ ...base, gainDb: 0.001 })).toEqual([])
  })
})

describe('normalizationGainDb', () => {
  it('computes the boost needed to reach the target peak', () => {
    // 0.5 is -6.02 dBFS, so reaching -1 dBFS needs about +5 dB.
    expect(normalizationGainDb(0.5, -1)).toBeCloseTo(5.02, 1)
  })

  it('attenuates when the take is already louder than the target', () => {
    expect(normalizationGainDb(1, -3)).toBeCloseTo(-3, 5)
  })

  it('leaves silence alone rather than returning infinity', () => {
    expect(normalizationGainDb(0, -1)).toBe(0)
  })
})

describe('eventIdToPath', () => {
  it('turns dots into directories', () => {
    expect(eventIdToPath('entity.zombie.hurt')).toBe('entity/zombie/hurt')
  })

  it('drops a namespace prefix', () => {
    expect(eventIdToPath('minecraft:block.stone.break')).toBe('block/stone/break')
  })

  it('folds characters a resource pack path cannot contain', () => {
    expect(eventIdToPath('custom.My Sound!')).toBe('custom/my_sound_')
  })
})

describe('safeFileName', () => {
  it('strips path separators and reserved characters', () => {
    expect(safeFileName('my/pack:v2')).toBe('my_pack_v2')
  })

  it('strips Windows backslashes as well as forward slashes', () => {
    expect(safeFileName('sub\\dir\\pack')).toBe('sub_dir_pack')
  })

  it('drops trailing dots and spaces that Windows rejects', () => {
    expect(safeFileName('pack. ')).toBe('pack')
  })

  it('falls back when nothing usable is left', () => {
    expect(safeFileName('///', 'untitled')).toBe('untitled')
  })
})

describe('compareVersions', () => {
  it('orders by numeric component, not lexically', () => {
    expect(compareVersions('1.21.10', '1.21.9')).toBeGreaterThan(0)
  })

  it('treats a missing component as zero', () => {
    expect(compareVersions('1.21', '1.21.0')).toBe(0)
  })

  it('sorts snapshots below releases instead of throwing', () => {
    expect(compareVersions('24w14a', '1.21')).toBeLessThan(0)
  })
})
