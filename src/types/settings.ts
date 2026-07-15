export type VideoResolution = '720p' | '1080p' | '4k'
export type YoutubeVisibility = 'public' | 'unlisted' | 'private'

export interface AccountSettings {
  fullName: string
  email: string
  avatarUrl: string | null
}

export interface CameraSettings {
  cameraId: string
  microphoneId: string
  resolution: VideoResolution
  mirrorVideo: boolean
}

export interface YoutubeSettings {
  isConnected: boolean
  channelName: string
  channelId: string
  defaultVisibility: YoutubeVisibility
  defaultCategory: string
  defaultTags: string
  defaultDescription: string
  autoUpload: boolean
  madeForKids: boolean
  allowComments: boolean
  notifySubscribers: boolean
}

export interface AppSettings {
  account: AccountSettings
  camera: CameraSettings
  youtube: YoutubeSettings
}
