import { useEffect, useRef, useState } from 'react'
import { toDb } from '../lib/format'
import type { JSX } from 'react'

interface LevelMeterProps {
  /** Current input peak, 0..1. */
  level: number
  active: boolean
}

/** How fast the meter falls back, in dB per second. Slow enough to read. */
const DECAY_DB_PER_SECOND = 40
/** How long the peak-hold marker stays put before it starts falling. */
const HOLD_MS = 900

/**
 * A meter that only ever jumps up instantly and falls smoothly gives a usable
 * read on level; one that tracks the raw signal both ways is unreadable noise.
 */
export default function LevelMeter({ level, active }: LevelMeterProps): JSX.Element {
  const [displayDb, setDisplayDb] = useState(-60)
  const [peakHoldDb, setPeakHoldDb] = useState(-60)

  const targetDb = useRef(-60)
  const peakAt = useRef(0)
  const frame = useRef(0)
  const lastTime = useRef(performance.now())

  targetDb.current = toDb(level)

  useEffect(() => {
    if (!active) {
      setDisplayDb(-60)
      setPeakHoldDb(-60)
      return
    }

    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - lastTime.current) / 1000)
      lastTime.current = now

      setDisplayDb((current) => {
        const decayed = current - DECAY_DB_PER_SECOND * dt
        return Math.max(-60, Math.max(decayed, targetDb.current))
      })

      setPeakHoldDb((current) => {
        if (targetDb.current >= current) {
          peakAt.current = now
          return targetDb.current
        }
        if (now - peakAt.current < HOLD_MS) return current
        return Math.max(-60, current - DECAY_DB_PER_SECOND * dt)
      })

      frame.current = requestAnimationFrame(tick)
    }

    lastTime.current = performance.now()
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [active])

  const toPercent = (db: number): number => ((db + 60) / 60) * 100
  const width = Math.max(0, toPercent(displayDb))
  const clipping = displayDb > -0.5

  return (
    <div className="space-y-1">
      <div className="relative h-3 overflow-hidden rounded-full bg-ink-950">
        <div
          className={`h-full transition-none ${clipping ? 'bg-redstone-500' : 'bg-grass-400'}`}
          style={{ width: `${width}%` }}
        />
        {/* -6 dBFS: aim here and a shout still has headroom. */}
        <div className="absolute inset-y-0 w-px bg-ink-600" style={{ left: `${toPercent(-6)}%` }} />
        {peakHoldDb > -60 && (
          <div
            className="absolute inset-y-0 w-0.5 bg-ink-100"
            style={{ left: `${Math.min(99.5, toPercent(peakHoldDb))}%` }}
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-ink-500">
        <span>-60</span>
        <span className={clipping ? 'text-redstone-400' : 'text-ink-400'}>
          {active ? `${displayDb.toFixed(1)} dBFS` : 'idle'}
        </span>
        <span>0</span>
      </div>
    </div>
  )
}
