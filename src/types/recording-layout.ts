export type CameraDisplayType = 'bubble' | 'fullscreen'
export type ScreenShareBackgroundType = CameraBackgroundType
export type BubbleSize = 'S' | 'L' | 'XL'
export type BubbleRatio = '1:1' | '4:3' | '16:9' | '9:16'
export type BubbleAnchorV = 'top' | 'center' | 'bottom'
export type BubbleAnchorH = 'left' | 'center' | 'right'
export type CameraBackgroundType = 'none' | 'blur' | 'solid' | 'gradient' | 'image' | 'video' | 'orb'
export type ContainerStyle = 'square' | 'circle' | 'rounded' | 'none'
export type BackgroundGradientPreset =
  | 'purple'
  | 'blue'
  | 'sunset'
  | 'pink'
  | 'green'
  | 'slate'
  | 'ocean'
  | 'dusk'

export type SolidColorPreset =
  | 'brand'
  | 'blue'
  | 'black'
  | 'white'
  | 'orange'
  | 'rose'
  | 'teal'
  | 'slate'

export type OrbPreset =
  | 'brand'
  | 'aurora'
  | 'sunset'
  | 'ocean'
  | 'bloom'
  | 'midnight'
  | 'citrus'
  | 'frost'

export interface BackgroundLayoutSettings {
  backgroundType: CameraBackgroundType
  backgroundMaterialId: string
  backgroundAssetId: string | null
  backgroundSourceUrl: string | null
  backgroundColor: string
  backgroundGradient: BackgroundGradientPreset
  backgroundOrbPreset: OrbPreset
}

export interface CameraLayoutSettings extends BackgroundLayoutSettings {
  displayType: CameraDisplayType
  bubbleSize: BubbleSize
  bubbleRatio: BubbleRatio
  positionV: BubbleAnchorV
  positionH: BubbleAnchorH
  containerStyle: ContainerStyle
  cameraZoom: number
  cameraPanY: number
}

export interface ScreenShareLayoutSettings extends BackgroundLayoutSettings {
  margins: number
  cornerRadius: number
}

export const defaultScreenShareLayout: ScreenShareLayoutSettings = {
  backgroundType: 'orb',
  backgroundMaterialId: 'bg-none',
  backgroundAssetId: null,
  backgroundSourceUrl: null,
  backgroundColor: '#f8f9fb',
  backgroundGradient: 'slate',
  backgroundOrbPreset: 'brand',
  /** Inset from stage edges so the share isn't full-bleed. */
  margins: 64,
  cornerRadius: 16,
}

const VALID_SCREEN_BACKGROUND_TYPES = new Set<CameraBackgroundType>([
  'solid',
  'gradient',
  'image',
  'video',
  'orb',
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

function normalizeScreenBackgroundType(
  backgroundType: CameraBackgroundType | undefined,
): CameraBackgroundType {
  if (backgroundType && VALID_SCREEN_BACKGROUND_TYPES.has(backgroundType)) {
    return backgroundType
  }

  return defaultScreenShareLayout.backgroundType
}

export function normalizeScreenShareLayout(
  layout: Partial<ScreenShareLayoutSettings> | ScreenShareLayoutSettings,
): ScreenShareLayoutSettings {
  return {
    backgroundType: normalizeScreenBackgroundType(layout.backgroundType as CameraBackgroundType | undefined),
    backgroundMaterialId:
      typeof layout.backgroundMaterialId === 'string'
        ? layout.backgroundMaterialId
        : defaultScreenShareLayout.backgroundMaterialId,
    backgroundAssetId:
      typeof layout.backgroundAssetId === 'string' || layout.backgroundAssetId === null
        ? layout.backgroundAssetId
        : defaultScreenShareLayout.backgroundAssetId,
    backgroundSourceUrl:
      typeof layout.backgroundSourceUrl === 'string' || layout.backgroundSourceUrl === null
        ? layout.backgroundSourceUrl
        : defaultScreenShareLayout.backgroundSourceUrl,
    backgroundColor:
      typeof layout.backgroundColor === 'string'
        ? layout.backgroundColor
        : defaultScreenShareLayout.backgroundColor,
    backgroundGradient:
      layout.backgroundGradient ?? defaultScreenShareLayout.backgroundGradient,
    backgroundOrbPreset: VALID_ORB_PRESETS.has(layout.backgroundOrbPreset as OrbPreset)
      ? (layout.backgroundOrbPreset as OrbPreset)
      : defaultScreenShareLayout.backgroundOrbPreset,
    margins:
      typeof layout.margins === 'number' && Number.isFinite(layout.margins)
        ? layout.margins
        : defaultScreenShareLayout.margins,
    cornerRadius:
      typeof layout.cornerRadius === 'number' && Number.isFinite(layout.cornerRadius)
        ? layout.cornerRadius
        : defaultScreenShareLayout.cornerRadius,
  }
}

export const defaultCameraLayout: CameraLayoutSettings = {
  displayType: 'bubble',
  bubbleSize: 'L',
  bubbleRatio: '1:1',
  positionV: 'bottom',
  positionH: 'left',
  backgroundType: 'blur',
  backgroundMaterialId: 'bg-none',
  backgroundAssetId: null,
  backgroundSourceUrl: null,
  backgroundColor: '#5234d2',
  backgroundGradient: 'purple',
  backgroundOrbPreset: 'brand',
  containerStyle: 'circle',
  cameraZoom: 1,
  cameraPanY: 0,
}

export const bubbleSizeScale: Record<BubbleSize, number> = {
  S: 0.16,
  L: 0.24,
  XL: 0.32,
}

export const bubbleRatioValue: Record<BubbleRatio, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}

export const solidColorPresets: Record<SolidColorPreset, string> = {
  brand: '#5234d2',
  blue: '#2563eb',
  black: '#0f172a',
  white: '#f8fafc',
  orange: '#f97316',
  rose: '#f43f5e',
  teal: '#14b8a6',
  slate: '#475569',
}

export const gradientPresets: Record<BackgroundGradientPreset, string> = {
  purple: 'linear-gradient(135deg, #5234d2 0%, #8b5cf6 100%)',
  blue: 'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)',
  sunset: 'linear-gradient(135deg, #f97316 0%, #fb7185 100%)',
  pink: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
  green: 'linear-gradient(135deg, #059669 0%, #34d399 100%)',
  slate: 'linear-gradient(135deg, #334155 0%, #64748b 100%)',
  ocean: 'linear-gradient(135deg, #0369a1 0%, #22d3ee 100%)',
  dusk: 'linear-gradient(135deg, #7c3aed 0%, #f59e0b 100%)',
}

export const gradientColorPairs: Record<BackgroundGradientPreset, [string, string]> = {
  purple: ['#5234d2', '#8b5cf6'],
  blue: ['#2563eb', '#60a5fa'],
  sunset: ['#f97316', '#fb7185'],
  pink: ['#ec4899', '#f472b6'],
  green: ['#059669', '#34d399'],
  slate: ['#334155', '#64748b'],
  ocean: ['#0369a1', '#22d3ee'],
  dusk: ['#7c3aed', '#f59e0b'],
}
