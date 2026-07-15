import { user } from '@/config/user'
import type { AppSettings } from '@/types/settings'

export const defaultSettings: AppSettings = {
  account: {
    fullName: user.fullName,
    email: user.email,
    avatarUrl: user.avatarUrl,
  },
  camera: {
    cameraId: '',
    microphoneId: '',
    resolution: '1080p',
    mirrorVideo: true,
  },
  youtube: {
    isConnected: false,
    channelName: '',
    channelId: '',
    defaultVisibility: 'unlisted',
    defaultCategory: '28',
    defaultTags: 'streamstudio, tutorial, product',
    defaultDescription: 'Recorded with StreamStudio. Subscribe for more updates.',
    autoUpload: false,
    madeForKids: false,
    allowComments: true,
    notifySubscribers: true,
  },
}
