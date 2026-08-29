import { concatChunks, encodeWav, peakOf } from '@shared/wav'

/**
 * Microphone capture.
 *
 * We deliberately do NOT use MediaRecorder: it hands back Opus in a WebM/Ogg
 * container, and Minecraft's sound engine only decodes Ogg *Vorbis*. Instead we
 * tap raw Float32 PCM out of an AudioWorklet and keep a lossless WAV master,
 * converting to Vorbis once, at export time.
 */

/**
 * The worklet is defined as a source string and loaded from a blob URL. Bundlers
 * have no first-class story for AudioWorklet modules, and this keeps the
 * processor next to the code that uses it instead of in a magic asset file.
 */
const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    // Copy: the render quantum's buffers are reused by the audio thread.
    const channels = input.map((channel) => {
      const copy = new Float32Array(channel.length)
      copy.set(channel)
      return copy
    })

    // Peak of the first channel is enough to drive a level meter.
    let peak = 0
    const first = channels[0]
    for (let i = 0; i < first.length; i++) {
      const abs = Math.abs(first[i])
      if (abs > peak) peak = abs
    }

    this.port.postMessage({ channels, peak, frames: first.length })
    return true
  }
}
registerProcessor('capture-processor', CaptureProcessor)
`

export interface RecorderOptions {
  /** `deviceId` from enumerateDevices, or null for the system default. */
  deviceId: string | null
  /** Called ~every 3ms with the current input peak, 0..1. */
  onLevel?: (peak: number) => void
}

export interface RecordedAudio {
  wav: ArrayBuffer
  durationSeconds: number
  sampleRate: number
  channels: number
  peak: number
  /** First channel, kept so the caller can find where the sound starts. */
  samples: Float32Array
}

export class MicRecorder {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null

  private chunks: Float32Array[][] = []
  private frames = 0
  private channelCount = 1

  get isRecording(): boolean {
    return this.node !== null
  }

  async start(options: RecorderOptions): Promise<void> {
    if (this.isRecording) throw new Error('Already recording')

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        // All three colour the signal in ways that are wrong for sound design,
        // and echo cancellation in particular gates quiet tails.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })

    this.context = new AudioContext()
    try {
      await this.context.audioWorklet.addModule(workletUrl())
    } catch (err) {
      // addModule rejects with a bare AbortError whenever the module fails to
      // load — most often a CSP that does not allow `blob:` scripts. The raw
      // "user aborted a request" tells the user nothing, so say what broke.
      await this.teardown()
      throw new Error(
        `Could not start the audio capture worklet (${err instanceof Error ? err.message : String(err)}).`
      )
    }

    this.source = this.context.createMediaStreamSource(this.stream)
    this.channelCount = this.source.channelCount || 1
    this.node = new AudioWorkletNode(this.context, 'capture-processor')

    this.chunks = []
    this.frames = 0

    this.node.port.onmessage = (event: MessageEvent<WorkletMessage>): void => {
      const { channels, peak, frames } = event.data
      this.chunks.push(channels)
      this.frames += frames
      this.channelCount = channels.length
      options.onLevel?.(peak)
    }

    this.source.connect(this.node)
    // The worklet produces no output, but an unconnected node is not guaranteed
    // to be pulled by the graph — routing through a muted gain keeps it alive
    // without the user hearing themselves.
    const sink = this.context.createGain()
    sink.gain.value = 0
    this.node.connect(sink).connect(this.context.destination)
  }

  /** Stop capture and return the recorded audio as a WAV. */
  async stop(): Promise<RecordedAudio> {
    if (!this.context || !this.node) throw new Error('Not recording')

    const sampleRate = this.context.sampleRate
    const channelCount = this.channelCount
    const frames = this.frames

    await this.teardown()

    const channels: Float32Array[] = []
    for (let ch = 0; ch < channelCount; ch++) {
      channels.push(concatChunks(this.chunks.map((frame) => frame[ch] ?? new Float32Array(0)), frames))
    }
    this.chunks = []

    const peak = Math.max(...channels.map(peakOf), 0)
    return {
      wav: encodeWav({ sampleRate, channels }),
      durationSeconds: frames / sampleRate,
      sampleRate,
      channels: channelCount,
      peak,
      samples: channels[0] ?? new Float32Array(0)
    }
  }

  /** Abandon the take without producing audio. */
  async cancel(): Promise<void> {
    await this.teardown()
    this.chunks = []
    this.frames = 0
  }

  private async teardown(): Promise<void> {
    this.node?.port.close()
    this.node?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close()
    this.node = null
    this.source = null
    this.stream = null
    this.context = null
  }
}

interface WorkletMessage {
  channels: Float32Array[]
  peak: number
  frames: number
}

let cachedUrl: string | null = null

function workletUrl(): string {
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
  }
  return cachedUrl
}

/**
 * Input devices, with labels. Labels are empty until the user has granted mic
 * permission at least once, which is why this is worth re-running after a first
 * successful recording.
 */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}
