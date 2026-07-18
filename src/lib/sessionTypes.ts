import type { SessionType } from '@/types/session'

const THREE_MINUTES = 180

export const SESSION_TYPE_SHORT: SessionType = {
  id: 'short',
  label: 'Shorts',
  description: 'Vertical clips for the Shorts feed',
  constraint: 'Up to 3 minutes · 9:16',
  canvasWidth: 1080,
  canvasHeight: 1920,
  aspectRatio: '9:16',
  youtubeConfig: {
    appendToTitle: ' #Shorts',
    descriptionSuffix: '#Shorts',
    categoryId: '22',
    defaultVisibility: 'public',
    maxDurationSeconds: THREE_MINUTES,
    defaultTags: ['Shorts'],
    madeForKids: false,
    containsSyntheticMedia: false,
  },
}

export const SESSION_TYPE_STANDARD: SessionType = {
  id: 'standard',
  label: 'Videos',
  description: 'Landscape recordings for long-form uploads',
  constraint: 'No time limit · 16:9',
  canvasWidth: 1920,
  canvasHeight: 1080,
  aspectRatio: '16:9',
  youtubeConfig: {
    appendToTitle: '',
    descriptionSuffix: '',
    categoryId: '20',
    defaultVisibility: 'private',
    maxDurationSeconds: null,
    defaultTags: [],
    madeForKids: false,
    containsSyntheticMedia: false,
  },
}

/** @deprecated Kept so older drafts with square still load correctly. */
export const SESSION_TYPE_SQUARE: SessionType = {
  id: 'square',
  label: 'Square',
  description: 'Equal-width frame for social-style square posts',
  constraint: 'Up to 3 minutes · 1:1',
  canvasWidth: 1080,
  canvasHeight: 1080,
  aspectRatio: '1:1',
  youtubeConfig: {
    appendToTitle: '',
    descriptionSuffix: '',
    categoryId: '22',
    defaultVisibility: 'private',
    maxDurationSeconds: THREE_MINUTES,
    defaultTags: [],
    madeForKids: false,
    containsSyntheticMedia: false,
  },
}

/** Picker options — Shorts and Videos only. */
export const ALL_SESSION_TYPES = [SESSION_TYPE_SHORT, SESSION_TYPE_STANDARD]

const SESSION_TYPE_BY_ID: Record<SessionType['id'], SessionType> = {
  short: SESSION_TYPE_SHORT,
  standard: SESSION_TYPE_STANDARD,
  square: SESSION_TYPE_SQUARE,
}

export function getSessionType(id: SessionType['id'] | string | undefined): SessionType {
  if (id && id in SESSION_TYPE_BY_ID) {
    return SESSION_TYPE_BY_ID[id as SessionType['id']]
  }
  return SESSION_TYPE_STANDARD
}
