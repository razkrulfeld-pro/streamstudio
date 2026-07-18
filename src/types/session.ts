import type { YoutubeVisibility } from '@/types/settings'

export type ContentTypeId = 'short' | 'standard' | 'square'

export type YouTubeUploadConfig = {
  /** Appended to the title on upload when not already present (e.g. " #Shorts"). */
  appendToTitle: string
  /** Extra line appended to description (e.g. "#Shorts"). */
  descriptionSuffix: string
  categoryId: string
  defaultVisibility: YoutubeVisibility
  maxDurationSeconds: number | null
  /** Default tags merged with user settings tags. */
  defaultTags: string[]
  madeForKids: boolean
  containsSyntheticMedia: boolean
}

export type SessionType = {
  id: ContentTypeId
  label: string
  description: string
  /** Human-readable constraint shown in the picker. */
  constraint: string
  canvasWidth: number
  canvasHeight: number
  aspectRatio: string
  youtubeConfig: YouTubeUploadConfig
}

/** Pre-populated YouTube fields carried picker → recorder → editor → upload. */
export type SessionYouTubeMetadata = {
  title: string
  description: string
  tags: string[]
  categoryId: string
  privacy: YoutubeVisibility
  madeForKids: boolean
  containsSyntheticMedia: boolean
  /** Appended to title at upload time when set. */
  titleSuffix: string
  maxDurationSeconds: number | null
}

/** Single session object threaded through the entire recording flow. */
export type RecordingSessionState = {
  contentType: SessionType
  youtubeMetadata: SessionYouTubeMetadata
  startedAt: string
}
