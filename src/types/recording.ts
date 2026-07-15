export type RecordingStatus = 'published' | 'draft'

export interface Recording {
  id: string
  name: string
  thumbnailUrl: string
  recordedAt: string
  durationSeconds: number
  status: RecordingStatus
  /** Set after a successful YouTube publish so the lobby can deep-link back. */
  youtubeVideoId?: string
  youtubeVideoUrl?: string
}
