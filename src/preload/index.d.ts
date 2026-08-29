import type { VoicePackApi } from '@shared/ipc'

declare global {
  interface Window {
    voicepack: VoicePackApi
  }
}

export {}
