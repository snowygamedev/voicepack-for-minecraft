import { useCallback, useEffect, useRef, useState } from 'react'

export interface LoadedAudio {
  buffer: AudioBuffer
  /** First channel, kept separately so the waveform doesn't re-extract it. */
  samples: Float32Array
  duration: number
}

export interface UsePlayback {
  audio: LoadedAudio | null
  playing: boolean
  /** Playback position in seconds, or null when stopped. */
  playhead: number | null
  loading: boolean
  load: (bytes: ArrayBuffer | null) => Promise<void>
  play: (from?: number, to?: number, gainDb?: number) => void
  stop: () => void
}

/**
 * Decode and play a single clip. One instance per preview surface; the shared
 * AudioContext is created lazily because browsers only allow it after a gesture
 * and we don't want a suspended context sitting around from mount.
 */
export function usePlayback(): UsePlayback {
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const frameRef = useRef(0)
  const startInfo = useRef({ contextTime: 0, offset: 0 })

  const [audio, setAudio] = useState<LoadedAudio | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const context = useCallback((): AudioContext => {
    contextRef.current ??= new AudioContext()
    return contextRef.current
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    if (sourceRef.current) {
      sourceRef.current.onended = null
      try {
        sourceRef.current.stop()
      } catch {
        // Already stopped; the spec throws rather than no-oping.
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    setPlaying(false)
    setPlayhead(null)
  }, [])

  const load = useCallback(
    async (bytes: ArrayBuffer | null) => {
      stop()
      if (!bytes) {
        setAudio(null)
        return
      }
      setLoading(true)
      try {
        // decodeAudioData detaches the buffer it is given, so decode a copy —
        // otherwise re-loading the same take a second time throws.
        const buffer = await context().decodeAudioData(bytes.slice(0))
        setAudio({
          buffer,
          samples: buffer.getChannelData(0),
          duration: buffer.duration
        })
      } finally {
        setLoading(false)
      }
    },
    [context, stop]
  )

  const play = useCallback(
    (from = 0, to?: number, gainDb = 0) => {
      if (!audio) return
      stop()

      const ctx = context()
      void ctx.resume()

      const source = ctx.createBufferSource()
      source.buffer = audio.buffer

      const gain = ctx.createGain()
      gain.gain.value = Math.pow(10, gainDb / 20)
      source.connect(gain).connect(ctx.destination)

      const end = to ?? audio.duration
      const span = Math.max(0, end - from)
      source.start(0, from, span)
      sourceRef.current = source
      startInfo.current = { contextTime: ctx.currentTime, offset: from }
      setPlaying(true)

      const tick = (): void => {
        const elapsed = ctx.currentTime - startInfo.current.contextTime
        const position = startInfo.current.offset + elapsed
        setPlayhead(Math.min(end, position))
        frameRef.current = requestAnimationFrame(tick)
      }
      frameRef.current = requestAnimationFrame(tick)

      source.onended = () => stop()
    },
    [audio, context, stop]
  )

  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRef.current)
      void contextRef.current?.close()
      contextRef.current = null
    }
  }, [])

  return { audio, playing, playhead, loading, load, play, stop }
}
