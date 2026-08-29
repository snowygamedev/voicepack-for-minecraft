import { useRef } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent, KeyboardEvent } from 'react'

interface ResizeHandleProps {
  /** Current width of the pane to the left, in px. */
  width: number
  min: number
  max: number
  /** Called continuously while dragging. */
  onResize: (width: number) => void
  /** Called once the drag or key press is over, for persisting the result. */
  onCommit: (width: number) => void
}

/** How far one arrow-key press moves the divider. */
const KEY_STEP = 16

/** Width the list opens at, and returns to on a double-click. */
export const DEFAULT_BROWSER_WIDTH = 300

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * The draggable divider between the sound list and the recording pane. Pointer
 * capture means the drag keeps tracking when the cursor runs off the handle,
 * which at a few pixels wide it always does.
 */
export default function ResizeHandle({
  width,
  min,
  max,
  onResize,
  onCommit
}: ResizeHandleProps): JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: width, width }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state) return
    const next = clamp(state.startWidth + (event.clientX - state.startX), min, max)
    state.width = next
    onResize(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onCommit(state.width)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0
    if (delta === 0) return
    event.preventDefault()
    const next = clamp(width + delta, min, max)
    onResize(next)
    onCommit(next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sound list"
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onResize(DEFAULT_BROWSER_WIDTH)
        onCommit(DEFAULT_BROWSER_WIDTH)
      }}
      title="Drag to resize · double-click to reset"
      className="group relative z-20 cursor-col-resize bg-ink-800 outline-none transition-colors hover:bg-grass-400/60 focus-visible:bg-grass-400/60 active:bg-grass-400"
    >
      {/* A 4px target is hard to hit, so widen the grab area past the divider. */}
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  )
}
