export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const mins = Math.floor(whole / 60)
  const secs = whole % 60
  const tenths = Math.floor((seconds - whole) * 10)
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** 0..1 amplitude to dBFS, floored so silence doesn't render as -Infinity. */
export function toDb(amplitude: number): number {
  if (amplitude <= 0) return -60
  return Math.max(-60, 20 * Math.log10(amplitude))
}

/** `entity.zombie.hurt` renders as `entity.zombie.` + a bolded `hurt`. */
export function splitEventId(eventId: string): { prefix: string; leaf: string } {
  const index = eventId.lastIndexOf('.')
  if (index === -1) return { prefix: '', leaf: eventId }
  return { prefix: eventId.slice(0, index + 1), leaf: eventId.slice(index + 1) }
}
