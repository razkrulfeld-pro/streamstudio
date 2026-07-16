import type { YoutubeVisibility } from '@/types/settings'

export const visibilityOptions: { id: YoutubeVisibility; label: string }[] = [
  { id: 'public', label: 'Public' },
  { id: 'unlisted', label: 'Unlisted' },
  { id: 'private', label: 'Private' },
]

export const categoryOptions = [
  { id: '22', label: 'People & Blogs' },
  { id: '27', label: 'Education' },
  { id: '28', label: 'Science & Technology' },
  { id: '24', label: 'Entertainment' },
]

export type PublishPhase = 'idle' | 'exporting' | 'uploading'

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function getVisibilityLabel(value: YoutubeVisibility): string {
  return visibilityOptions.find((option) => option.id === value)?.label ?? value
}

export function getCategoryLabel(categoryId: string): string {
  return categoryOptions.find((option) => option.id === categoryId)?.label ?? `Category ${categoryId}`
}

export function parseTagsInput(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const rawTag of value.split(',')) {
    const tag = rawTag.trim()
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }

  return tags
}

export function formatTagsInput(tags: string[]): string {
  return tags.join(', ')
}

export function getCombinedPublishProgress(
  phase: PublishPhase,
  exportProgress: number,
  uploadProgress: number,
): number {
  if (phase === 'exporting') {
    return Math.round(clampProgress(exportProgress) * 0.35)
  }

  if (phase === 'uploading') {
    return Math.round(35 + clampProgress(uploadProgress) * 0.65)
  }

  return 0
}
