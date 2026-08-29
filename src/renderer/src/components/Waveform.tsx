import { useEffect, useRef } from 'react'
import { computePeaks } from '@shared/wav'
import type { JSX } from 'react'

interface WaveformProps {
  samples: Float32Array | null
  /** Seconds; used to place the trim handles and playhead. */
  duration: number
  trimStart: number
  trimEnd: number | null
  /** Current playback position in seconds, or null when not playing. */
  playhead: number | null
  height?: number
  onScrub?: (seconds: number) => void
}

const COLORS = {
  wave: '#6fa84c',
  waveMuted: '#3a4a30',
  centerline: '#262b2e',
  playhead: '#e6ebed',
  trimShade: 'rgba(11, 13, 14, 0.72)'
}

/**
 * Canvas rather than SVG: a few thousand min/max pairs as DOM nodes makes
 * scrubbing visibly janky, and we redraw on every playhead frame.
 */
export default function Waveform({
  samples,
  duration,
  trimStart,
  trimEnd,
  playhead,
  height = 96,
  onScrub
}: WaveformProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Match the backing store to the device pixel ratio, or the waveform is
    // blurry on every laptop made in the last decade.
    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = height
    canvas.width = Math.floor(cssWidth * dpr)
    canvas.height = Math.floor(cssHeight * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    const mid = cssHeight / 2

    ctx.strokeStyle = COLORS.centerline
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(cssWidth, mid)
    ctx.stroke()

    if (!samples || samples.length === 0) return

    const buckets = Math.max(1, Math.floor(cssWidth))
    const { min, max } = computePeaks(samples, buckets)

    ctx.fillStyle = COLORS.wave
    for (let x = 0; x < buckets; x++) {
      const top = mid - (max[x] as number) * mid
      const bottom = mid - (min[x] as number) * mid
      // Always at least a pixel tall so quiet passages stay visible.
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
    }

    // Shade the regions the trim will discard.
    if (duration > 0) {
      const toX = (seconds: number): number => (seconds / duration) * cssWidth
      ctx.fillStyle = COLORS.trimShade
      if (trimStart > 0) ctx.fillRect(0, 0, toX(trimStart), cssHeight)
      if (trimEnd !== null && trimEnd < duration) {
        ctx.fillRect(toX(trimEnd), 0, cssWidth - toX(trimEnd), cssHeight)
      }

      if (playhead !== null) {
        ctx.strokeStyle = COLORS.playhead
        ctx.beginPath()
        ctx.moveTo(toX(playhead), 0)
        ctx.lineTo(toX(playhead), cssHeight)
        ctx.stroke()
      }
    }
  }, [samples, duration, trimStart, trimEnd, playhead, height])

  return (
    <canvas
      ref={canvasRef}
      style={{ height }}
      className="w-full cursor-text rounded bg-ink-950"
      onClick={(event) => {
        if (!onScrub || duration <= 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const ratio = (event.clientX - rect.left) / rect.width
        onScrub(Math.max(0, Math.min(duration, ratio * duration)))
      }}
    />
  )
}
