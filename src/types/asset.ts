export type AssetType = 'image' | 'gif' | 'video'

export interface LibraryAsset {
  id: string
  name: string
  type: AssetType
  mimeType: string
  size: number
  createdAt: string
}

export interface StoredAsset extends LibraryAsset {
  blob: Blob
}
