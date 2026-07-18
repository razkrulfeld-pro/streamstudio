import type { UploadMetadata } from '@/lib/types/youtube'
import type { YoutubeSettings } from '@/types/settings'
import type {
  RecordingSessionState,
  SessionType,
  SessionYouTubeMetadata,
} from '@/types/session'

export function parseAspectRatio(aspectRatio: string): { width: number; height: number } {
  const [rawW, rawH] = aspectRatio.split(':').map(Number)
  const width = Number.isFinite(rawW) && rawW > 0 ? rawW : 16
  const height = Number.isFinite(rawH) && rawH > 0 ? rawH : 9
  return { width, height }
}

export function getOutputDimensions(sessionType: SessionType): { width: number; height: number } {
  return { width: sessionType.canvasWidth, height: sessionType.canvasHeight }
}

function mergeTags(settingsTags: string, typeTags: string[]): string[] {
  const fromSettings = settingsTags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  const merged = [...typeTags, ...fromSettings]
  return [...new Set(merged)]
}

function buildDescription(
  settingsDescription: string,
  descriptionSuffix: string,
): string {
  const base = settingsDescription.trim()
  if (!descriptionSuffix) return base
  if (!base) return descriptionSuffix
  if (base.includes(descriptionSuffix)) return base
  return `${base}\n\n${descriptionSuffix}`
}

export function buildYouTubeMetadata(
  contentType: SessionType,
  youtubeSettings: YoutubeSettings,
  title = '',
): SessionYouTubeMetadata {
  const config = contentType.youtubeConfig
  return {
    title: title.trim(),
    description: buildDescription(youtubeSettings.defaultDescription, config.descriptionSuffix),
    tags: mergeTags(youtubeSettings.defaultTags, config.defaultTags),
    categoryId: config.categoryId || youtubeSettings.defaultCategory,
    privacy: config.defaultVisibility ?? youtubeSettings.defaultVisibility,
    madeForKids: youtubeSettings.madeForKids,
    containsSyntheticMedia: config.containsSyntheticMedia,
    titleSuffix: config.appendToTitle,
    maxDurationSeconds: config.maxDurationSeconds,
  }
}

export function createRecordingSessionState(
  contentType: SessionType,
  youtubeSettings: YoutubeSettings,
  title = '',
): RecordingSessionState {
  return {
    contentType,
    youtubeMetadata: buildYouTubeMetadata(contentType, youtubeSettings, title),
    startedAt: new Date().toISOString(),
  }
}

export function formatUploadTitle(metadata: SessionYouTubeMetadata): string {
  const base = metadata.title.trim() || 'Untitled recording'
  const suffix = metadata.titleSuffix.trim()
  if (!suffix || base.endsWith(suffix.trim())) return base
  return `${base}${suffix}`
}

export function toUploadMetadata(
  metadata: SessionYouTubeMetadata,
  mimeType: string,
): UploadMetadata {
  return {
    title: formatUploadTitle(metadata),
    description: metadata.description,
    privacy_status: metadata.privacy,
    category_id: metadata.categoryId,
    tags: metadata.tags,
    made_for_kids: metadata.madeForKids,
    contains_synthetic_media: metadata.containsSyntheticMedia,
    mime_type: mimeType,
  }
}

export function aspectRatioStyle(aspectRatio: string): {
  className: string
  style: { aspectRatio: string; width: string }
} {
  const { width, height } = parseAspectRatio(aspectRatio)
  return {
    className: 'relative max-h-full overflow-hidden',
    style: {
      aspectRatio: `${width} / ${height}`,
      width: `min(100%, calc(100cqh * ${width} / ${height}))`,
    },
  }
}
