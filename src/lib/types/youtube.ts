export interface UploadMetadata {
  title: string
  description?: string
  privacy_status: 'public' | 'private' | 'unlisted'
  category_id?: string
  mime_type?: string
}

export interface UploadResult {
  videoId: string
  videoUrl: string
  subscribeUrl: string
}

export interface ChannelInfo {
  channel_id: string
  channel_title: string
  subscriber_count: string
  video_count: string
  thumbnail_url: string
  subscribe_url: string
}

export interface DraftMetadata {
  id: string
  title: string
  durationSeconds: number
  lastModified: number
  sizeBytes: number
}
