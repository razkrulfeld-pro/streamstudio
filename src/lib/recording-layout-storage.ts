import type { BackgroundGradientPreset, CameraLayoutSettings, OrbPreset } from '@/types/recording-layout'

const STORAGE_KEY = 'streamstudio-recording-camera-background'

export type PersistedCameraBackground = Pick<
  CameraLayoutSettings,
  | 'backgroundType'
  | 'backgroundMaterialId'
  | 'backgroundAssetId'
  | 'backgroundColor'
  | 'backgroundGradient'
  | 'backgroundOrbPreset'
>

export const defaultCameraBackground: PersistedCameraBackground = {
  backgroundType: 'blur',
  backgroundMaterialId: 'bg-none',
  backgroundAssetId: null,
  backgroundColor: '#5234d2',
  backgroundGradient: 'purple',
  backgroundOrbPreset: 'brand',
}

const VALID_BACKGROUND_TYPES = new Set<PersistedCameraBackground['backgroundType']>([
  'none',
  'blur',
  'solid',
  'gradient',
  'image',
  'video',
  'orb',
])

const VALID_GRADIENTS = new Set<BackgroundGradientPreset>([
  'purple',
  'blue',
  'sunset',
  'pink',
  'green',
  'slate',
  'ocean',
  'dusk',
])

const VALID_ORB_PRESETS = new Set<OrbPreset>([
  'brand',
  'aurora',
  'sunset',
  'ocean',
  'bloom',
  'midnight',
  'citrus',
  'frost',
])

function normalizeBackground(value: unknown): PersistedCameraBackground {
  if (typeof value !== 'object' || value === null) return defaultCameraBackground

  const raw = value as Partial<PersistedCameraBackground>

  return {
    backgroundType: VALID_BACKGROUND_TYPES.has(raw.backgroundType as PersistedCameraBackground['backgroundType'])
      ? (raw.backgroundType as PersistedCameraBackground['backgroundType'])
      : defaultCameraBackground.backgroundType,
    backgroundMaterialId:
      typeof raw.backgroundMaterialId === 'string'
        ? raw.backgroundMaterialId
        : defaultCameraBackground.backgroundMaterialId,
    backgroundAssetId:
      typeof raw.backgroundAssetId === 'string' || raw.backgroundAssetId === null
        ? raw.backgroundAssetId
        : defaultCameraBackground.backgroundAssetId,
    backgroundColor:
      typeof raw.backgroundColor === 'string'
        ? raw.backgroundColor
        : defaultCameraBackground.backgroundColor,
    backgroundGradient: VALID_GRADIENTS.has(
      raw.backgroundGradient as PersistedCameraBackground['backgroundGradient'],
    )
      ? (raw.backgroundGradient as PersistedCameraBackground['backgroundGradient'])
      : defaultCameraBackground.backgroundGradient,
    backgroundOrbPreset: VALID_ORB_PRESETS.has(raw.backgroundOrbPreset as OrbPreset)
      ? (raw.backgroundOrbPreset as OrbPreset)
      : defaultCameraBackground.backgroundOrbPreset,
  }
}

export function loadLastCameraBackground(): PersistedCameraBackground {
  if (typeof window === 'undefined') return defaultCameraBackground

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultCameraBackground
    return normalizeBackground(JSON.parse(raw))
  } catch {
    return defaultCameraBackground
  }
}

export function saveLastCameraBackground(background: PersistedCameraBackground): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(background))
}

export function pickCameraBackground(
  layout: CameraLayoutSettings,
): PersistedCameraBackground {
  return {
    backgroundType: layout.backgroundType,
    backgroundMaterialId: layout.backgroundMaterialId,
    backgroundAssetId: layout.backgroundAssetId,
    backgroundColor: layout.backgroundColor,
    backgroundGradient: layout.backgroundGradient,
    backgroundOrbPreset: layout.backgroundOrbPreset,
  }
}
