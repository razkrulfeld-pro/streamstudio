import { backgroundMaterials, effectMaterials } from '@/config/materials'
import { getMaterialPreviewStyle } from '@/lib/material-style'
import { cn } from '@/lib/utils'
import type { LibraryAssetView } from '@/context/asset-library-context'

import type { ReactNode } from 'react'

interface RecordingOptionsPanelProps {
  title: string
  onClose?: () => void
  showCloseButton?: boolean
  children: ReactNode
  className?: string
}

export function RecordingOptionsPanel({
  title,
  onClose,
  showCloseButton = false,
  children,
  className,
}: RecordingOptionsPanelProps) {
  return (
    <div
      className={cn(
        'absolute bottom-full left-1/2 z-20 mb-4 w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-white/50 bg-white/80 p-4 shadow-2xl backdrop-blur-xl',
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {showCloseButton ? (
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-neutral-900">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-800"
          >
            Close
          </button>
        </div>
      ) : (
        <h4 className="mb-3 text-sm font-semibold text-neutral-900">{title}</h4>
      )}
      {children}
    </div>
  )
}

export function BackgroundOptions({
  backgroundMaterialId,
  backgroundAssetId,
  assets,
  onSelectMaterial,
  onSelectAsset,
}: {
  backgroundMaterialId: string
  backgroundAssetId: string | null
  assets: LibraryAssetView[]
  onSelectMaterial: (id: string) => void
  onSelectAsset: (id: string | null) => void
}) {
  const imageAssets = assets.filter((asset) => asset.type === 'image' || asset.type === 'gif')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {backgroundMaterials.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onSelectAsset(null)
              onSelectMaterial(item.id)
            }}
            className={cn(
              'aspect-video overflow-hidden rounded-lg ring-2 ring-offset-1',
              backgroundMaterialId === item.id && !backgroundAssetId
                ? 'ring-[#5234d2]'
                : 'ring-transparent',
            )}
            title={item.label}
          >
            <div className="h-full w-full bg-cover bg-center" style={getMaterialPreviewStyle(item.preview)} />
          </button>
        ))}
      </div>

      {imageAssets.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium text-neutral-500">From asset library</p>
          <div className="grid grid-cols-4 gap-2">
            {imageAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelectAsset(asset.id)}
                className={cn(
                  'aspect-video overflow-hidden rounded-lg ring-2 ring-offset-1',
                  backgroundAssetId === asset.id ? 'ring-[#5234d2]' : 'ring-transparent',
                )}
                title={asset.name}
              >
                <img src={asset.previewUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function EffectsOptions({
  effectId,
  onSelect,
}: {
  effectId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {effectMaterials.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={cn(
            'rounded-lg border px-2 py-2 text-left text-xs font-medium transition',
            effectId === item.id
              ? 'border-[#5234d2] bg-[#5234d2]/5 text-neutral-900'
              : 'border-neutral-200 text-neutral-600 hover:border-neutral-300',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
