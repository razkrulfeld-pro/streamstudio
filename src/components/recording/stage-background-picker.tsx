import { OrbPresetThumb } from '@/components/recording/orb-preset-thumb'
import { PanelSegmentedControl } from '@/components/recording/recording-side-panel'
import { backgroundMaterials } from '@/config/materials'
import { useAssetLibrary } from '@/context/asset-library-context'
import type { LibraryAssetView } from '@/context/asset-library-context'
import {
  mediaPageBackgroundErrorMessage,
  resolveBackgroundMediaUrl,
  youtubeBackgroundErrorMessage,
} from '@/lib/background-media-url'
import { getMaterialPreviewStyle } from '@/lib/material-style'
import {
  loadRecentCameraBackgrounds,
  rememberRecentCameraBackground,
} from '@/lib/recent-camera-backgrounds'
import { isAcceptedAssetFile, getAssetBlob } from '@/lib/asset-storage'
import { fetchMediaAsBlobUrl } from '@/lib/media-proxy'
import { ORB_PRESET_ORDER } from '@/lib/orb-background'
import { cn } from '@/lib/utils'
import type { BackgroundLayoutSettings } from '@/types/recording-layout'
import {
  gradientPresets,
  solidColorPresets,
  type BackgroundGradientPreset,
  type SolidColorPreset,
} from '@/types/recording-layout'
import { Link2, Upload } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'

type BackgroundMode = 'none' | 'blur' | 'color' | 'media' | 'orbs'

const ALL_BACKGROUND_MODES: BackgroundMode[] = ['none', 'blur', 'color', 'media', 'orbs']

function getBackgroundMode(layout: BackgroundLayoutSettings): BackgroundMode {
  if (layout.backgroundType === 'orb') return 'orbs'
  if (layout.backgroundType === 'solid' || layout.backgroundType === 'gradient') return 'color'
  if (layout.backgroundType === 'image' || layout.backgroundType === 'video') return 'media'
  return layout.backgroundType
}

function MediaThumb({
  selected,
  onClick,
  title,
  children,
}: {
  selected: boolean
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'aspect-square overflow-hidden rounded-lg ring-2 ring-offset-2 ring-offset-neutral-800 transition',
        selected ? 'ring-white' : 'ring-transparent hover:ring-neutral-500',
      )}
    >
      {children}
    </button>
  )
}

interface StageBackgroundPickerProps {
  layout: BackgroundLayoutSettings
  assets: LibraryAssetView[]
  onLayoutChange: (patch: Partial<BackgroundLayoutSettings>) => void
  allowedModes?: BackgroundMode[]
}

const MODE_LABELS: Record<BackgroundMode, string> = {
  none: 'None',
  blur: 'Blur',
  color: 'Color',
  media: 'Media',
  orbs: 'Orbs',
}

export function StageBackgroundPicker({
  layout,
  assets,
  onLayoutChange,
  allowedModes = ALL_BACKGROUND_MODES,
}: StageBackgroundPickerProps) {
  const { uploadAssets, importAssetFromUrl, isUploading } = useAssetLibrary()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [recent, setRecent] = useState(() => loadRecentCameraBackgrounds())

  const mode = allowedModes.includes(getBackgroundMode(layout))
    ? getBackgroundMode(layout)
    : allowedModes[0]

  const modeOptions = allowedModes.map((id) => ({ id, label: MODE_LABELS[id] }))

  const mediaAssets = useMemo(
    () => assets.filter((asset) => asset.type === 'image' || asset.type === 'gif' || asset.type === 'video'),
    [assets],
  )

  const stockMaterials = useMemo(
    () => backgroundMaterials.filter((item) => item.id !== 'bg-none' && item.id !== 'bg-blur'),
    [],
  )

  const selectMediaAsset = (asset: LibraryAssetView) => {
    rememberRecentCameraBackground({ kind: 'asset', id: asset.id })
    setRecent(loadRecentCameraBackgrounds())
    onLayoutChange({
      backgroundType: asset.type === 'video' ? 'video' : 'image',
      backgroundAssetId: asset.id,
      backgroundMaterialId: 'bg-none',
      backgroundSourceUrl: asset.previewUrl,
    })
  }

  const selectMaterial = (backgroundMaterialId: string) => {
    rememberRecentCameraBackground({ kind: 'material', id: backgroundMaterialId })
    setRecent(loadRecentCameraBackgrounds())
    onLayoutChange({
      backgroundType: 'image',
      backgroundMaterialId,
      backgroundAssetId: null,
      backgroundSourceUrl: null,
    })
  }

  const handleModeChange = (nextMode: BackgroundMode) => {
    if (nextMode === 'none') {
      onLayoutChange({ backgroundType: 'none', backgroundSourceUrl: null })
      return
    }
    if (nextMode === 'blur') {
      onLayoutChange({ backgroundType: 'blur', backgroundSourceUrl: null })
      return
    }
    if (nextMode === 'color') {
      onLayoutChange({
        backgroundType: layout.backgroundType === 'gradient' ? 'gradient' : 'solid',
        backgroundSourceUrl: null,
      })
      return
    }
    if (nextMode === 'orbs') {
      onLayoutChange({
        backgroundType: 'orb',
        backgroundSourceUrl: null,
        backgroundOrbPreset: layout.backgroundOrbPreset ?? 'brand',
      })
      return
    }
    onLayoutChange({ backgroundType: layout.backgroundType === 'video' ? 'video' : 'image' })
  }

  const handleLocalUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const accepted = Array.from(files).filter(isAcceptedAssetFile)
    if (accepted.length === 0) {
      setUploadError('Upload an image, GIF, or video only.')
      return
    }

    setUploadError(null)

    try {
      const created = await uploadAssets(accepted)
      if (created[0]) {
        rememberRecentCameraBackground({ kind: 'asset', id: created[0].id })
        setRecent(loadRecentCameraBackgrounds())

        const blob = await getAssetBlob(created[0].id)
        const blobUrl = blob ? URL.createObjectURL(blob) : null

        onLayoutChange({
          backgroundType: created[0].type === 'video' ? 'video' : 'image',
          backgroundAssetId: created[0].id,
          backgroundMaterialId: 'bg-none',
          backgroundSourceUrl: blobUrl,
        })
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleUrlImport = async () => {
    const trimmed = mediaUrl.trim()
    if (!trimmed) return

    setUrlError(null)

    const resolved = resolveBackgroundMediaUrl(trimmed)
    if (resolved?.kind === 'youtube') {
      setUrlError(youtubeBackgroundErrorMessage())
      return
    }
    if (resolved?.kind === 'page') {
      setUrlError(mediaPageBackgroundErrorMessage(resolved.site))
      return
    }

    if (!resolved) {
      setUrlError('Enter a valid media URL.')
      return
    }

    const directUrl = resolved.url
    const directMediaType = resolved.mediaType

    try {
      const asset = await importAssetFromUrl(directUrl)
      const blob = await getAssetBlob(asset.id)
      const blobUrl = blob ? URL.createObjectURL(blob) : await fetchMediaAsBlobUrl(directUrl)

      rememberRecentCameraBackground({ kind: 'asset', id: asset.id })
      setRecent(loadRecentCameraBackgrounds())
      onLayoutChange({
        backgroundType: asset.type === 'video' ? 'video' : 'image',
        backgroundAssetId: asset.id,
        backgroundMaterialId: 'bg-none',
        backgroundSourceUrl: blobUrl,
      })
      setMediaUrl('')
    } catch (error) {
      try {
        const blobUrl = await fetchMediaAsBlobUrl(directUrl)
        onLayoutChange({
          backgroundType: directMediaType === 'video' ? 'video' : 'image',
          backgroundSourceUrl: blobUrl,
          backgroundAssetId: null,
          backgroundMaterialId: 'bg-none',
        })
        setMediaUrl('')
        setUrlError(null)
      } catch {
        setUrlError(
          error instanceof Error
            ? error.message
            : 'Could not load media from that URL. Try uploading the file instead.',
        )
      }
    }
  }

  const recentItems = recent
    .map((entry) => {
      if (entry.kind === 'asset') {
        const asset = mediaAssets.find((item) => item.id === entry.id)
        return asset ? { kind: 'asset' as const, asset } : null
      }

      const material = stockMaterials.find((item) => item.id === entry.id)
      return material ? { kind: 'material' as const, material } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const visibleMediaItems = useMemo(() => {
    const seenAssetIds = new Set<string>()
    const items: typeof recentItems = []

    for (const item of recentItems) {
      if (item.kind === 'asset') {
        if (seenAssetIds.has(item.asset.id)) continue
        seenAssetIds.add(item.asset.id)
      }
      items.push(item)
    }

    for (const asset of mediaAssets) {
      if (seenAssetIds.has(asset.id)) continue
      seenAssetIds.add(asset.id)
      items.push({ kind: 'asset', asset })
    }

    return items
  }, [recentItems, mediaAssets])

  const isAssetSelected = (assetId: string) => layout.backgroundAssetId === assetId

  return (
    <div className="space-y-3">
      <PanelSegmentedControl value={mode} options={modeOptions} onChange={handleModeChange} />

      {mode === 'color' ? (
        <div className="space-y-3">
          <PanelSegmentedControl
            value={layout.backgroundType === 'gradient' ? 'gradient' : 'solid'}
            options={[
              { id: 'solid', label: 'Solid' },
              { id: 'gradient', label: 'Gradient' },
            ]}
            onChange={(fill) =>
              onLayoutChange({
                backgroundType: fill === 'gradient' ? 'gradient' : 'solid',
                backgroundSourceUrl: null,
              })
            }
          />

          {layout.backgroundType === 'solid' ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(solidColorPresets) as SolidColorPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    title={preset}
                    onClick={() =>
                      onLayoutChange({
                        backgroundColor: solidColorPresets[preset],
                        backgroundSourceUrl: null,
                      })
                    }
                    className={cn(
                      'aspect-square rounded-lg ring-2 ring-offset-2 ring-offset-neutral-800 transition',
                      layout.backgroundColor === solidColorPresets[preset]
                        ? 'ring-white'
                        : 'ring-transparent hover:ring-neutral-500',
                    )}
                    style={{ backgroundColor: solidColorPresets[preset] }}
                  />
                ))}
              </div>
              <input
                type="color"
                value={layout.backgroundColor}
                onChange={(event) =>
                  onLayoutChange({
                    backgroundColor: event.target.value,
                    backgroundSourceUrl: null,
                  })
                }
                className="h-9 w-full cursor-pointer rounded-lg border border-neutral-600 bg-neutral-700"
                aria-label="Custom color"
              />
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(gradientPresets) as BackgroundGradientPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    onLayoutChange({
                      backgroundGradient: preset,
                      backgroundSourceUrl: null,
                    })
                  }
                  className={cn(
                    'h-12 rounded-lg ring-2 ring-offset-2 ring-offset-neutral-800 transition',
                    layout.backgroundGradient === preset
                      ? 'ring-white'
                      : 'ring-transparent hover:ring-neutral-500',
                  )}
                  style={{ background: gradientPresets[preset] }}
                  title={preset}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {mode === 'media' ? (
        <div className="space-y-4">
          {visibleMediaItems.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {visibleMediaItems.map((item) =>
                item.kind === 'asset' ? (
                  <MediaThumb
                    key={`asset-${item.asset.id}`}
                    title={item.asset.name}
                    selected={isAssetSelected(item.asset.id)}
                    onClick={() => selectMediaAsset(item.asset)}
                  >
                    {item.asset.type === 'video' ? (
                      <video
                        src={item.asset.previewUrl}
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={item.asset.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </MediaThumb>
                ) : (
                  <MediaThumb
                    key={`material-${item.material.id}`}
                    title={item.material.label}
                    selected={
                      layout.backgroundMaterialId === item.material.id && !layout.backgroundAssetId
                    }
                    onClick={() => selectMaterial(item.material.id)}
                  >
                    <div
                      className="h-full w-full bg-cover bg-center"
                      style={getMaterialPreviewStyle(item.material.preview)}
                    />
                  </MediaThumb>
                ),
              )}
            </div>
          ) : null}

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(event) => void handleLocalUpload(event.target.files)}
            />
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-600 bg-neutral-700/60 px-3 py-2.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50 [&_svg]:text-neutral-400"
            >
              <Upload className="size-3.5" />
              {isUploading ? 'Uploading…' : 'Upload from device'}
            </button>
            {uploadError ? <p className="mt-1.5 text-xs text-red-400">{uploadError}</p> : null}
          </div>

          <div className="flex gap-2">
            <input
              type="url"
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              placeholder="Direct .gif, .mp4, or i.pinimg.com link"
              className="min-w-0 flex-1 rounded-lg border border-neutral-600 bg-neutral-700 px-2.5 py-2 text-xs text-neutral-100 outline-none focus:border-[#5234d2]"
            />
            <button
              type="button"
              disabled={isUploading || !mediaUrl.trim()}
              onClick={() => void handleUrlImport()}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#5234d2] px-2.5 py-2 text-xs font-medium text-white transition hover:bg-[#452cb8] disabled:opacity-50"
            >
              <Link2 className="size-3.5" />
              Add
            </button>
          </div>
          {urlError ? <p className="text-xs text-red-400">{urlError}</p> : null}
        </div>
      ) : null}

      {mode === 'orbs' ? (
        <div className="grid grid-cols-4 gap-2">
          {ORB_PRESET_ORDER.map((preset) => (
            <OrbPresetThumb
              key={preset}
              preset={preset}
              selected={layout.backgroundType === 'orb' && layout.backgroundOrbPreset === preset}
              onClick={() =>
                onLayoutChange({
                  backgroundType: 'orb',
                  backgroundSourceUrl: null,
                  backgroundOrbPreset: preset,
                })
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// Backwards-compatible export for camera panel
export { StageBackgroundPicker as CameraBackgroundPicker }
