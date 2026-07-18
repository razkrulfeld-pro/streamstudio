import type { RecordingSessionState } from '@/types/session'
import { useSyncExternalStore } from 'react'

type StudioState = {
  session: RecordingSessionState | null
}

let state: StudioState = {
  session: null,
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

export const studioStore = {
  getState(): StudioState {
    return state
  },

  startSession(session: RecordingSessionState) {
    state = { session }
    emit()
  },

  clearSession() {
    state = { session: null }
    emit()
  },

  /** Update the pre-populated title as the user edits it in the editor. */
  updateSessionTitle(title: string) {
    if (!state.session) return
    state = {
      session: {
        ...state.session,
        youtubeMetadata: { ...state.session.youtubeMetadata, title },
      },
    }
    emit()
  },

  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useStudioStore(): StudioState {
  return useSyncExternalStore(studioStore.subscribe, studioStore.getState, studioStore.getState)
}
