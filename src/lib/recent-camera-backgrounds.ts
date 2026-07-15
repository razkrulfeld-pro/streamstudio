const STORAGE_KEY = 'streamstudio-recent-camera-backgrounds'
const MAX_RECENT = 8

export type RecentBackgroundKind = 'asset' | 'material'

export interface RecentBackground {
  kind: RecentBackgroundKind
  id: string
}

export function loadRecentCameraBackgrounds(): RecentBackground[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter(
        (item): item is RecentBackground =>
          typeof item === 'object' &&
          item !== null &&
          (item.kind === 'asset' || item.kind === 'material') &&
          typeof item.id === 'string',
      )
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function rememberRecentCameraBackground(entry: RecentBackground): void {
  if (typeof window === 'undefined') return

  const current = loadRecentCameraBackgrounds().filter(
    (item) => !(item.kind === entry.kind && item.id === entry.id),
  )

  const next = [entry, ...current].slice(0, MAX_RECENT)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}
