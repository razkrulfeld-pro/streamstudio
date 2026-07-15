import { SettingsSection } from '@/components/settings/settings-section'
import { useAssetLibrary } from '@/context/asset-library-context'
import { formatAssetSize, isAcceptedAssetFile } from '@/lib/asset-storage'
import { cn } from '@/lib/utils'
import type { AssetType, LibraryAsset } from '@/types/asset'
import { FileImage, FileVideo, ImagePlay, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

type AssetFilter = 'all' | AssetType

const filterTabs: { id: AssetFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'gif', label: 'GIFs' },
  { id: 'video', label: 'Videos' },
]

function AssetTypeBadge({ type }: { type: AssetType }) {
  const labels = { image: 'Image', gif: 'GIF', video: 'Video' }
  return (
    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
      {labels[type]}
    </span>
  )
}

function AssetPreview({ asset }: { asset: LibraryAsset & { previewUrl: string } }) {
  if (asset.type === 'video') {
    return (
      <video
        src={asset.previewUrl}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    )
  }

  return <img src={asset.previewUrl} alt="" className="h-full w-full object-cover" />
}

function AssetCard({
  asset,
  onRemove,
}: {
  asset: LibraryAsset & { previewUrl: string }
  onRemove: (id: string) => void
}) {
  return (
    <article className="group overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="relative aspect-video bg-neutral-100">
        <AssetPreview asset={asset} />
        <div className="absolute left-2 top-2">
          <AssetTypeBadge type={asset.type} />
        </div>
        <button
          type="button"
          onClick={() => onRemove(asset.id)}
          className="absolute right-2 top-2 rounded-md bg-black/55 p-1.5 text-white opacity-0 transition hover:bg-black/75 group-hover:opacity-100"
          aria-label={`Delete ${asset.name}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="px-3 py-2.5">
        <p className="truncate text-sm font-medium text-neutral-900">{asset.name}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{formatAssetSize(asset.size)}</p>
      </div>
    </article>
  )
}

export function AssetLibrarySection() {
  const { assets, isLoading, isUploading, uploadAssets, removeAsset } = useAssetLibrary()
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<AssetFilter>('all')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const filteredAssets =
    filter === 'all' ? assets : assets.filter((asset) => asset.type === filter)

  async function handleFiles(files: FileList | File[] | null | undefined) {
    if (!files || files.length === 0) return

    const accepted = Array.from(files).filter(isAcceptedAssetFile)
    const rejectedCount = files.length - accepted.length

    if (accepted.length === 0) {
      setUploadError('Upload images, GIFs, or videos only.')
      return
    }

    setUploadError(null)

    try {
      await uploadAssets(accepted)
      if (rejectedCount > 0) {
        setUploadError(`${rejectedCount} file(s) skipped — unsupported format.`)
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.')
    }
  }

  return (
    <SettingsSection
      title="Asset library"
      description="Upload and manage images, GIFs, and videos for use as backgrounds in your recordings."
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          void handleFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium transition',
                filter === tab.id
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload className="size-4" />
          {isUploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {uploadError ? <p className="mt-3 text-sm text-red-600">{uploadError}</p> : null}

      {isLoading ? (
        <p className="mt-6 text-sm text-neutral-500">Loading your assets…</p>
      ) : filteredAssets.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 px-6 py-10 text-center">
          <div className="flex items-center gap-2 text-neutral-400">
            <FileImage className="size-5" />
            <ImagePlay className="size-5" />
            <FileVideo className="size-5" />
          </div>
          <p className="mt-3 text-sm font-medium text-neutral-700">No assets yet</p>
          <p className="mt-1 max-w-sm text-sm text-neutral-500">
            Use Upload to add images, GIFs, and videos for your recording backgrounds.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filteredAssets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} onRemove={(id) => void removeAsset(id)} />
          ))}
        </div>
      )}
    </SettingsSection>
  )
}
