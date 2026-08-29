/**
 * WAV read/write.
 *
 * Projects keep lossless 16-bit PCM WAV masters. Encoding to Ogg Vorbis happens
 * only at export, so a user can re-export at a different quality, or re-trim,
 * without ever re-recording or stacking lossy generations.
 */

export interface AudioBufferLike {
  sampleRate: number
  channels: Float32Array[]
}

const BYTES_PER_SAMPLE = 2

/** Encode planar Float32 channels to a 16-bit PCM WAV file. */
export function encodeWav(input: AudioBufferLike): ArrayBuffer {
  const channelCount = input.channels.length
  if (channelCount === 0) throw new Error('Cannot encode WAV with no channels')

  const frameCount = input.channels[0]?.length ?? 0
  const dataBytes = frameCount * channelCount * BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  const byteRate = input.sampleRate * channelCount * BYTES_PER_SAMPLE
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // format = PCM
  view.setUint16(22, channelCount, true)
  view.setUint32(24, input.sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, channelCount * BYTES_PER_SAMPLE, true) // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const sample = input.channels[ch]?.[frame] ?? 0
      view.setInt16(offset, floatToInt16(sample), true)
      offset += BYTES_PER_SAMPLE
    }
  }
  return buffer
}

/**
 * Asymmetric on purpose: int16 spans -32768..32767, so scaling positive and
 * negative by the same factor would clip one side early.
 */
function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
}

/** Concatenate the Float32 chunks an AudioWorklet produced into one channel. */
export function concatChunks(chunks: Float32Array[], totalFrames: number): Float32Array {
  const out = new Float32Array(totalFrames)
  let offset = 0
  for (const chunk of chunks) {
    if (offset + chunk.length > totalFrames) {
      out.set(chunk.subarray(0, totalFrames - offset), offset)
      break
    }
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Largest absolute sample value, 0..1. Drives clipping and silence warnings. */
export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i] as number)
    if (abs > peak) peak = abs
  }
  return Math.min(1, peak)
}

/**
 * Downsample to a fixed number of min/max pairs for drawing.
 *
 * A waveform canvas is a few hundred pixels wide but a take is hundreds of
 * thousands of samples, so we reduce once here rather than in the paint loop.
 */
export interface WaveformPeaks {
  min: Float32Array
  max: Float32Array
}

export function computePeaks(samples: Float32Array, buckets: number): WaveformPeaks {
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  if (samples.length === 0) return { min, max }

  const perBucket = samples.length / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * perBucket)
    const end = Math.min(samples.length, Math.floor((b + 1) * perBucket))
    let lo = 0
    let hi = 0
    for (let i = start; i < end; i++) {
      const v = samples[i] as number
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo
    max[b] = hi
  }
  return { min, max }
}

export interface SoundBoundsOptions {
  /** How far below the take's own loudest moment still counts as silence. */
  belowPeakDb?: number
  /** Absolute floor, so a take that is nothing but hiss is left alone. */
  minAmplitude?: number
  /** Seconds of lead-in kept before the first sound, so attacks survive. */
  padSeconds?: number
  /**
   * Seconds kept after the last sound. Longer than the lead-in on purpose:
   * chopping a voice the instant it drops below the threshold cuts the natural
   * decay and sounds abrupt in game.
   */
  tailPadSeconds?: number
  /** Resolution of the scan. */
  windowSeconds?: number
  /** How long the signal must stay up to count as sound rather than a click. */
  holdSeconds?: number
}

export interface SoundBounds {
  /** Seconds of silence to trim off the front. */
  start: number
  /** Absolute end position in seconds, or null to keep the take's own end. */
  end: number | null
}

/**
 * Where the sound actually starts and stops, in seconds.
 *
 * Every recording begins with the moment between pressing the key and starting
 * to speak — and usually with the click of that keypress, which is exactly as
 * loud as speech and a hundred times shorter. So this works on the energy of
 * short windows rather than single samples, and only calls it sound once the
 * signal *stays* up: a transient never survives `holdSeconds`.
 *
 * The threshold is relative to two things at once. To the take's own loudest
 * moment, because an absolute one would trim a whisper to nothing and never
 * trigger on a shout; and to the room noise measured from the quietest fifth of
 * the take, because a noisy room otherwise crosses any fixed threshold on the
 * first window and nothing gets trimmed at all.
 *
 * Returns the take unchanged when nothing qualifies: doing nothing is always
 * the safe answer, since the user can still trim by hand.
 */
export function findSoundBounds(
  samples: Float32Array,
  sampleRate: number,
  options: SoundBoundsOptions = {}
): SoundBounds {
  const {
    belowPeakDb = -26,
    minAmplitude = 0.004,
    padSeconds = 0.04,
    tailPadSeconds = 0.12,
    windowSeconds = 0.01,
    holdSeconds = 0.03
  } = options
  const untouched: SoundBounds = { start: 0, end: null }
  if (samples.length === 0 || sampleRate <= 0) return untouched

  const duration = samples.length / sampleRate
  const windowSize = Math.max(1, Math.round(sampleRate * windowSeconds))
  const windowCount = Math.ceil(samples.length / windowSize)
  if (windowCount === 0) return untouched

  const energy = new Float64Array(windowCount)
  for (let w = 0; w < windowCount; w++) {
    const from = w * windowSize
    const to = Math.min(from + windowSize, samples.length)
    let sum = 0
    for (let i = from; i < to; i++) {
      const sample = samples[i] ?? 0
      sum += sample * sample
    }
    energy[w] = Math.sqrt(sum / Math.max(1, to - from))
  }

  const loudest = Math.max(...energy)
  if (loudest <= 0) return untouched

  // The quietest fifth of the take is the room, near enough. Speech has to
  // clear it by 12 dB before we believe it.
  const sorted = Float64Array.from(energy).sort()
  const roomTone = sorted[Math.floor(windowCount * 0.2)] ?? 0
  const threshold = Math.max(loudest * 10 ** (belowPeakDb / 20), roomTone * 4, minAmplitude)
  if (loudest < threshold) return untouched

  const hold = Math.max(1, Math.round(holdSeconds / windowSeconds))

  const firstWindow = sustainedWindow(energy, threshold, hold, 'forward')
  if (firstWindow === null) return untouched
  const lastWindow = sustainedWindow(energy, threshold, hold, 'backward')

  const start = Math.max(0, (firstWindow * windowSize - padSeconds * sampleRate) / sampleRate)

  let end: number | null = null
  if (lastWindow !== null) {
    const soundEnds = Math.min(samples.length, (lastWindow + 1) * windowSize) / sampleRate
    const padded = Math.min(duration, soundEnds + tailPadSeconds)
    // Only worth recording as an edit if there is real silence to drop.
    if (padded < duration - windowSeconds && padded > start + windowSeconds) end = padded
  }

  return { start, end }
}

/**
 * Index of the first (or last) window belonging to a run of `hold` consecutive
 * windows at or above `threshold`, or null if the signal never sustains.
 */
function sustainedWindow(
  energy: Float64Array,
  threshold: number,
  hold: number,
  direction: 'forward' | 'backward'
): number | null {
  const count = energy.length
  let run = 0
  for (let step = 0; step < count; step++) {
    const w = direction === 'forward' ? step : count - 1 - step
    if ((energy[w] ?? 0) < threshold) {
      run = 0
      continue
    }
    run += 1
    if (run >= hold) return direction === 'forward' ? w - run + 1 : w + run - 1
  }
  return null
}
