import {
  deleteStoredRecording,
  listStoredRecordings,
  saveDraftRecording,
  updateStoredRecording,
  type UpdateStoredRecordingPatch,
} from '@/lib/recording-storage'
import type { Recording } from '@/types/recording'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface RecordingsContextValue {
  /** Local IndexedDB recordings (drafts + published), newest first. */
  recordings: Recording[]
  /** Drafts only — kept for callers that still want unpublished items. */
  draftRecordings: Recording[]
  isLoading: boolean
  refreshRecordings: () => Promise<void>
  addDraftRecording: (input: {
    name: string
    videoBlob: Blob
    thumbnailBlob: Blob
    mimeType: string
    durationSeconds: number
  }) => Promise<Recording>
  updateRecording: (id: string, patch: UpdateStoredRecordingPatch) => Promise<Recording | null>
  removeRecording: (id: string) => Promise<boolean>
}

const RecordingsContext = createContext<RecordingsContextValue | undefined>(undefined)

function upsertRecording(list: Recording[], recording: Recording): Recording[] {
  const without = list.filter((item) => item.id !== recording.id)
  return [recording, ...without].sort((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt),
  )
}

export function RecordingsProvider({ children }: { children: ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refreshRecordings = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = await listStoredRecordings()
      setRecordings(stored)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshRecordings()
  }, [refreshRecordings])

  const addDraftRecording = useCallback(
    async (input: {
      name: string
      videoBlob: Blob
      thumbnailBlob: Blob
      mimeType: string
      durationSeconds: number
    }) => {
      const recording = await saveDraftRecording(input)
      setRecordings((current) => upsertRecording(current, recording))
      return recording
    },
    [],
  )

  const updateRecording = useCallback(async (id: string, patch: UpdateStoredRecordingPatch) => {
    const recording = await updateStoredRecording(id, patch)
    if (!recording) return null
    // Keep both drafts and published in the lobby so users can return to them.
    setRecordings((current) => upsertRecording(current, recording))
    return recording
  }, [])

  const removeRecording = useCallback(async (id: string) => {
    const removed = await deleteStoredRecording(id)
    if (removed) {
      setRecordings((current) => current.filter((item) => item.id !== id))
    }
    return removed
  }, [])

  const draftRecordings = useMemo(
    () => recordings.filter((recording) => recording.status === 'draft'),
    [recordings],
  )

  const value = useMemo(
    () => ({
      recordings,
      draftRecordings,
      isLoading,
      refreshRecordings,
      addDraftRecording,
      updateRecording,
      removeRecording,
    }),
    [
      recordings,
      draftRecordings,
      isLoading,
      refreshRecordings,
      addDraftRecording,
      updateRecording,
      removeRecording,
    ],
  )

  return <RecordingsContext.Provider value={value}>{children}</RecordingsContext.Provider>
}

export function useRecordings() {
  const context = useContext(RecordingsContext)
  if (!context) {
    throw new Error('useRecordings must be used within a RecordingsProvider')
  }
  return context
}
