import type { AssetType, LibraryAsset, StoredAsset } from '@/types/asset'
import { resolveBackgroundMediaUrl } from '@/lib/background-media-url'
import { getMediaProxyUrl } from '@/lib/media-proxy'

const DB_NAME = 'streamstudio-asset-library'
const DB_VERSION = 1
const STORE_NAME = 'assets'

const ACCEPTED_MIME_PREFIXES = ['image/', 'video/']

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open asset library.'))
  })
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode)
        const store = transaction.objectStore(STORE_NAME)
        const request = operation(store)

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Asset library operation failed.'))

        transaction.oncomplete = () => database.close()
        transaction.onerror = () => reject(transaction.error ?? new Error('Asset library transaction failed.'))
      }),
  )
}

export function detectAssetType(mimeType: string): AssetType | null {
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return null
}

export function isAcceptedAssetFile(file: File): boolean {
  return ACCEPTED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))
}

export function formatAssetSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function listAssets(): Promise<LibraryAsset[]> {
  const assets = await runTransaction<StoredAsset[]>('readonly', (store) => store.getAll())
  return assets
    .map(({ blob: _blob, ...metadata }) => metadata)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getAssetBlob(id: string): Promise<Blob | null> {
  const asset = await runTransaction<StoredAsset | undefined>('readonly', (store) => store.get(id))
  return asset?.blob ?? null
}

export async function addAsset(file: File): Promise<LibraryAsset> {
  const type = detectAssetType(file.type)
  if (!type) {
    throw new Error('Only images, GIFs, and videos are supported.')
  }

  const asset: StoredAsset = {
    id: crypto.randomUUID(),
    name: file.name,
    type,
    mimeType: file.type,
    size: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
  }

  await runTransaction('readwrite', (store) => store.put(asset))
  const { blob: _blob, ...metadata } = asset
  return metadata
}

export async function addAssetFromUrl(url: string, name?: string): Promise<LibraryAsset> {
  const resolved = resolveBackgroundMediaUrl(url)
  const fetchUrl = resolved?.kind === 'direct' ? resolved.url : url

  let response: Response
  try {
    response = await fetch(getMediaProxyUrl(fetchUrl))
  } catch {
    try {
      response = await fetch(fetchUrl)
    } catch {
      throw new Error('Could not fetch media from that URL. The host may block cross-origin requests.')
    }
  }

  if (!response.ok) {
    throw new Error('Could not fetch media from that URL.')
  }

  const blob = await response.blob()
  let mimeType = blob.type || ''

  if (!mimeType || mimeType === 'application/octet-stream') {
    const extension = fetchUrl.split('?')[0]?.split('.').pop()?.toLowerCase()
    if (extension === 'gif') mimeType = 'image/gif'
    else if (extension === 'webp') mimeType = 'image/webp'
    else if (extension === 'png') mimeType = 'image/png'
    else if (extension === 'jpg' || extension === 'jpeg') mimeType = 'image/jpeg'
    else if (extension === 'mp4') mimeType = 'video/mp4'
    else if (extension === 'webm') mimeType = 'video/webm'
    else if (extension === 'mov') mimeType = 'video/quicktime'
  }

  const type = detectAssetType(mimeType)

  if (!type) {
    throw new Error('URL must point to an image, GIF, or video file.')
  }

  const fileName = name ?? fetchUrl.split('/').pop()?.split('?')[0] ?? 'media-from-url'
  const file = new File([blob], fileName, { type: mimeType || 'application/octet-stream' })
  return addAsset(file)
}

export async function deleteAsset(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id))
}
