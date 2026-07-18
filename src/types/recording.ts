import type { ContentTypeId } from '@/types/session'
import type { SessionYouTubeMetadata } from '@/types/session'

export type RecordingStatus = 'published' | 'draft'

export interface Recording {
  id: string
  name: string
  thumbnailUrl: string
  recordedAt: string
  durationSeconds: number
  status: RecordingStatus
  contentTypeId?: ContentTypeId
  aspectRatio?: string
  /** Pre-populated YouTube upload fields from the content type picker. */
  youtubeMetadata?: SessionYouTubeMetadata
  /** Set after a successful YouTube publish so the lobby can deep-link back. */
  youtubeVideoId?: string
  youtubeVideoUrl?: string
}
