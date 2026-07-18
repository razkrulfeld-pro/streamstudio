import { isQuotaExceededError, OVERLAY_AUDIO_MAX_BYTES } from '@/lib/overlay-audio'
import type { EditorProject } from '@/types/editor-project'
import { getEditedDuration, normalizeEditorProject } from '@/types/editor-project'
import type { Recording, RecordingStatus } from '@/types/recording'
import type { ContentTypeId } from '@/types/session'
import type { SessionYouTubeMetadata } from '@/types/session'

const DB_NAME = 'streamstudio-recordings'
/** v2: optional `overlayAudioBlob` on recording records (no new object store). */
const DB_VERSION = 2
const STORE_NAME = 'recordings'

export interface StoredRecording extends Recording {
  videoBlob: Blob
  thumbnailBlob: Blob
  thumbnailDataUrl: string
  mimeType: string
  /** CapCut-style edit project; optional for older drafts. */
  editorProject?: EditorProject
  /** Inserted audio clip bytes; optional. Never stores YouTube video. */
  overlayAudioBlob?: Blob
}

export class RecordingStorageError extends Error {
  readonly code: 'quota' | 'generic'

  constructor(message: string, code: 'quota' | 'generic' = 'generic') {
    super(message)
    this.name = 'RecordingStorageError'
    this.code = code
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read thumbnail.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read thumbnail.'))
    reader.readAsDataURL(blob)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      // v1 → v2: overlayAudioBlob is an optional field on existing records; no schema DDL.
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open recordings store.'))
  })
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode)
        const store = transaction.objectStore(STORE_NAME)
        const request = operation(store)

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => {
          const error = request.error ?? new Error('Recording operation failed.')
          if (isQuotaExceededError(error)) {
            reject(
              new RecordingStorageError(
                'Storage is full. Remove inserted audio or free browser space and try again.',
                'quota',
              ),
            )
            return
          }
          reject(error)
        }

        transaction.oncomplete = () => database.close()
        transaction.onerror = () => {
          const error = transaction.error ?? new Error('Recording transaction failed.')
          if (isQuotaExceededError(error)) {
            reject(
              new RecordingStorageError(
                'Storage is full. Remove inserted audio or free browser space and try again.',
                'quota',
              ),
            )
            return
          }
          reject(error)
        }
      }),
  )
}

/** Lobby / card duration = edited timeline (cuts, trims, black frames), not raw capture length. */
function displayDurationSeconds(recording: StoredRecording): number {
  const sourceSeconds = Math.max(0, recording.durationSeconds || 0)
  if (!recording.editorProject) {
    return Math.max(0, Math.round(sourceSeconds))
  }

  const project = normalizeEditorProject(recording.editorProject, sourceSeconds || 0.1)
  const edited = getEditedDuration(project)
  if (!Number.isFinite(edited) || edited <= 0) {
    return Math.max(0, Math.round(sourceSeconds))
  }
  return Math.max(0, Math.round(edited))
}

function toRecordingMetadata(recording: StoredRecording): Recording {
  return {
    id: recording.id,
    name: recording.name,
    recordedAt: recording.recordedAt,
    durationSeconds: displayDurationSeconds(recording),
    status: recording.status,
    contentTypeId: recording.contentTypeId,
    aspectRatio: recording.aspectRatio,
    youtubeMetadata: recording.youtubeMetadata,
    thumbnailUrl: recording.thumbnailDataUrl,
    youtubeVideoId: recording.youtubeVideoId,
    youtubeVideoUrl: recording.youtubeVideoUrl,
  }
}

/** All locally saved recordings (drafts + published) for the lobby. */
export async function listStoredRecordings(): Promise<Recording[]> {
  const recordings = await runTransaction<StoredRecording[]>('readonly', (store) => store.getAll())

  return recordings
    .map(toRecordingMetadata)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
}

/** @deprecated Prefer listStoredRecordings — lobby shows drafts and published. */
export async function listDraftRecordings(): Promise<Recording[]> {
  const recordings = await listStoredRecordings()
  return recordings.filter((recording) => recording.status === 'draft')
}

export async function getStoredRecording(id: string): Promise<StoredRecording | null> {
  const recording = await runTransaction<StoredRecording | undefined>('readonly', (store) =>
    store.get(id),
  )
  return recording ?? null
}

/**
 * Load a draft and normalize editor project vs overlay blob consistency.
 * If metadata references overlay audio but the blob is missing, clears overlayAudio.
 */
export async function loadStoredRecordingForEditor(id: string): Promise<{
  recording: StoredRecording
  project: EditorProject
  overlayMissing: boolean
} | null> {
  const recording = await getStoredRecording(id)
  if (!recording) return null

  let project = normalizeEditorProject(recording.editorProject, recording.durationSeconds)
  const overlayMissing = Boolean(project.overlayAudio) && !recording.overlayAudioBlob

  if (overlayMissing) {
    project = { ...project, overlayAudio: null }
  }

  return { recording, project, overlayMissing }
}

export async function saveDraftRecording(input: {
  name: string
  videoBlob: Blob
  thumbnailBlob: Blob
  mimeType: string
  durationSeconds: number
  contentTypeId?: ContentTypeId
  aspectRatio?: string
  youtubeMetadata?: SessionYouTubeMetadata
}): Promise<Recording> {
  const thumbnailDataUrl = await blobToDataUrl(input.thumbnailBlob)

  const recording: StoredRecording = {
    id: crypto.randomUUID(),
    name: input.name,
    recordedAt: new Date().toISOString(),
    durationSeconds: input.durationSeconds,
    status: 'draft' satisfies RecordingStatus,
    contentTypeId: input.contentTypeId,
    aspectRatio: input.aspectRatio,
    youtubeMetadata: input.youtubeMetadata,
    thumbnailUrl: thumbnailDataUrl,
    videoBlob: input.videoBlob,
    thumbnailBlob: input.thumbnailBlob,
    thumbnailDataUrl,
    mimeType: input.mimeType,
  }

  await runTransaction('readwrite', (store) => store.put(recording))

  return toRecordingMetadata(recording)
}

export type UpdateStoredRecordingPatch = {
  name?: string
  status?: RecordingStatus
  editorProject?: EditorProject
  youtubeMetadata?: SessionYouTubeMetadata
  youtubeVideoId?: string
  youtubeVideoUrl?: string
  /**
   * `Blob` replaces overlay audio; `null` clears it; `undefined` leaves unchanged.
   */
  overlayAudioBlob?: Blob | null
}

export async function updateStoredRecording(
  id: string,
  patch: UpdateStoredRecordingPatch,
): Promise<Recording | null> {
  const existing = await getStoredRecording(id)
  if (!existing) return null

  if (patch.overlayAudioBlob instanceof Blob && patch.overlayAudioBlob.size > OVERLAY_AUDIO_MAX_BYTES) {
    throw new RecordingStorageError(
      'Inserted audio is too large (max 20 MB). Choose a shorter clip.',
      'generic',
    )
  }

  const next: StoredRecording = {
    ...existing,
    name: patch.name ?? existing.name,
    status: patch.status ?? existing.status,
    editorProject: patch.editorProject ?? existing.editorProject,
    youtubeMetadata: patch.youtubeMetadata ?? existing.youtubeMetadata,
    youtubeVideoId: patch.youtubeVideoId ?? existing.youtubeVideoId,
    youtubeVideoUrl: patch.youtubeVideoUrl ?? existing.youtubeVideoUrl,
  }

  if (patch.overlayAudioBlob === null) {
    delete next.overlayAudioBlob
  } else if (patch.overlayAudioBlob instanceof Blob) {
    next.overlayAudioBlob = patch.overlayAudioBlob
  }

  await runTransaction('readwrite', (store) => store.put(next))

  return toRecordingMetadata(next)
}

export async function deleteStoredRecording(id: string): Promise<boolean> {
  const existing = await getStoredRecording(id)
  if (!existing) return false
  await runTransaction('readwrite', (store) => store.delete(id))
  return true
}

export async function createRecordingObjectUrls(
  recording: StoredRecording,
): Promise<{ videoUrl: string; thumbnailUrl: string; overlayAudioUrl: string | null }> {
  return {
    videoUrl: URL.createObjectURL(recording.videoBlob),
    thumbnailUrl: URL.createObjectURL(recording.thumbnailBlob),
    overlayAudioUrl: recording.overlayAudioBlob
      ? URL.createObjectURL(recording.overlayAudioBlob)
      : null,
  }
}

export async function generateThumbnail(
  videoBlob: Blob,
  dimensions?: { width: number; height: number },
): Promise<Blob> {
  const url = URL.createObjectURL(videoBlob)

  try {
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.playsInline = true

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Failed to load recording for thumbnail.'))
    })

    video.currentTime = Math.min(0.25, video.duration || 0.25)

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })

    const canvas = document.createElement('canvas')
    const thumbWidth = dimensions?.width ?? 640
    const thumbHeight = dimensions?.height ?? 360
    canvas.width = thumbWidth
    canvas.height = thumbHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Failed to create thumbnail.')

    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode thumbnail.'))),
        'image/jpeg',
        0.85,
      )
    })

    return thumbnail
  } finally {
    URL.revokeObjectURL(url)
  }
}
