import {
  addAsset,
  addAssetFromUrl,
  deleteAsset,
  getAssetBlob,
  listAssets,
} from '@/lib/asset-storage'
import type { LibraryAsset } from '@/types/asset'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface LibraryAssetView extends LibraryAsset {
  previewUrl: string
}

interface AssetLibraryContextValue {
  assets: LibraryAssetView[]
  isLoading: boolean
  isUploading: boolean
  uploadAssets: (files: FileList | File[]) => Promise<LibraryAsset[]>
  importAssetFromUrl: (url: string) => Promise<LibraryAsset>
  removeAsset: (id: string) => Promise<void>
  getAssetPreviewUrl: (id: string) => string | undefined
}

const AssetLibraryContext = createContext<AssetLibraryContextValue | undefined>(undefined)

async function createPreviewUrl(asset: LibraryAsset): Promise<string | null> {
  const blob = await getAssetBlob(asset.id)
  if (!blob) return null
  return URL.createObjectURL(blob)
}

export function AssetLibraryProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<LibraryAssetView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})

  const loadAssets = useCallback(async () => {
    setIsLoading(true)

    try {
      const metadata = await listAssets()
      const views = await Promise.all(
        metadata.map(async (asset) => {
          const previewUrl = await createPreviewUrl(asset)
          return previewUrl ? { ...asset, previewUrl } : null
        }),
      )

      setPreviewUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url))
        const next: Record<string, string> = {}
        for (const asset of views) {
          if (asset) next[asset.id] = asset.previewUrl
        }
        return next
      })

      setAssets(views.filter((asset): asset is LibraryAssetView => asset !== null))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAssets()

    return () => {
      setPreviewUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url))
        return {}
      })
    }
  }, [loadAssets])

  const uploadAssets = useCallback(
    async (files: FileList | File[]) => {
      const fileList = Array.from(files)
      if (fileList.length === 0) return []

      setIsUploading(true)
      const created: LibraryAsset[] = []

      try {
        for (const file of fileList) {
          const metadata = await addAsset(file)
          const previewUrl = await createPreviewUrl(metadata)
          if (!previewUrl) continue

          created.push(metadata)
          setPreviewUrls((current) => ({ ...current, [metadata.id]: previewUrl }))
          setAssets((current) => [{ ...metadata, previewUrl }, ...current])
        }

        return created
      } finally {
        setIsUploading(false)
      }
    },
    [],
  )

  const importAssetFromUrl = useCallback(async (url: string) => {
    setIsUploading(true)

    try {
      const metadata = await addAssetFromUrl(url)
      const previewUrl = await createPreviewUrl(metadata)
      if (!previewUrl) {
        throw new Error('Imported image could not be previewed.')
      }

      setPreviewUrls((current) => ({ ...current, [metadata.id]: previewUrl }))
      setAssets((current) => [{ ...metadata, previewUrl }, ...current])
      return metadata
    } finally {
      setIsUploading(false)
    }
  }, [])

  const removeAsset = useCallback(async (id: string) => {
    await deleteAsset(id)

    setPreviewUrls((current) => {
      const next = { ...current }
      if (next[id]) {
        URL.revokeObjectURL(next[id])
        delete next[id]
      }
      return next
    })

    setAssets((current) => current.filter((asset) => asset.id !== id))
  }, [])

  const getAssetPreviewUrl = useCallback(
    (id: string) => previewUrls[id],
    [previewUrls],
  )

  const value = useMemo(
    () => ({
      assets,
      isLoading,
      isUploading,
      uploadAssets,
      importAssetFromUrl,
      removeAsset,
      getAssetPreviewUrl,
    }),
    [assets, isLoading, isUploading, uploadAssets, importAssetFromUrl, removeAsset, getAssetPreviewUrl],
  )

  return <AssetLibraryContext.Provider value={value}>{children}</AssetLibraryContext.Provider>
}

export function useAssetLibrary() {
  const context = useContext(AssetLibraryContext)
  if (!context) {
    throw new Error('useAssetLibrary must be used within an AssetLibraryProvider')
  }
  return context
}

// Re-export for convenience in UI
export type { LibraryAsset }
