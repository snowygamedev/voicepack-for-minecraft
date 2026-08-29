import { useCallback, useEffect, useRef, useState } from 'react'
import { MicRecorder, listInputDevices, type RecordedAudio } from './recorder'

export interface UseRecorder {
  recording: boolean
  /** Live input peak, 0..1, while recording. */
  level: number
  /** Seconds elapsed in the current take. */
  elapsed: number
  devices: MediaDeviceInfo[]
  error: string | null
  start: (deviceId: string | null) => Promise<void>
  stop: () => Promise<RecordedAudio | null>
  cancel: () => Promise<void>
  refreshDevices: () => Promise<void>
}

export function useRecorder(): UseRecorder {
  const recorder = useRef<MicRecorder>(new MicRecorder())
  const startedAt = useRef(0)
  const timer = useRef<number | null>(null)

  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listInputDevices())
    } catch {
      // Enumeration fails before any permission grant on some platforms; the
      // default device still works, so this isn't worth surfacing.
      setDevices([])
    }
  }, [])

  useEffect(() => {
    void refreshDevices()
    // Devices come and go while the app is open — USB mics especially.
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const start = useCallback(
    async (deviceId: string | null) => {
      setError(null)
      try {
        await recorder.current.start({ deviceId, onLevel: setLevel })
        startedAt.current = performance.now()
        setElapsed(0)
        setRecording(true)
        timer.current = window.setInterval(() => {
          setElapsed((performance.now() - startedAt.current) / 1000)
        }, 100)
      } catch (err) {
        setError(explainMicError(err))
        setRecording(false)
      }
    },
    []
  )

  const stop = useCallback(async (): Promise<RecordedAudio | null> => {
    stopTimer()
    if (!recorder.current.isRecording) {
      setRecording(false)
      return null
    }
    try {
      const audio = await recorder.current.stop()
      // Labels are only populated once permission has been granted, so the
      // device list is worth re-reading after the first successful take.
      void refreshDevices()
      return audio
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setRecording(false)
      setLevel(0)
    }
  }, [refreshDevices, stopTimer])

  const cancel = useCallback(async () => {
    stopTimer()
    await recorder.current.cancel()
    setRecording(false)
    setLevel(0)
    setElapsed(0)
  }, [stopTimer])

  // Releasing the mic on unmount matters: a held stream keeps the OS recording
  // indicator lit and can block other apps from the device.
  useEffect(() => {
    const instance = recorder.current
    return () => {
      void instance.cancel()
    }
  }, [])

  return { recording, level, elapsed, devices, error, start, stop, cancel, refreshDevices }
}

function explainMicError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  switch (err.name) {
    case 'NotAllowedError':
      return 'Microphone access was denied. Allow it in your system privacy settings, then try again.'
    case 'NotFoundError':
      return 'No microphone was found. Plug one in and refresh the device list.'
    case 'NotReadableError':
      return 'The microphone is in use by another application.'
    case 'OverconstrainedError':
      return 'That input device is no longer available. Pick a different one.'
    case 'AbortError':
      return 'The microphone could not be started. Close anything else using it and try again.'
    default:
      return err.message
  }
}
