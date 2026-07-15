import { backgroundMaterials } from '@/config/materials'
import { AnimatedGifPlayer } from '@/lib/animated-gif-player'
import { getMediaProxyUrl } from '@/lib/media-proxy'
import type { BackgroundLayoutSettings } from '@/types/recording-layout'

function resolveImageSource(
  layout: BackgroundLayoutSettings,
  assets: { id: string; previewUrl: string; type?: string }[],
): string | null {
  if (layout.backgroundType !== 'image') return null

  if (layout.backgroundSourceUrl) return layout.backgroundSourceUrl

  if (layout.backgroundAssetId) {
    const asset = assets.find((item) => item.id === layout.backgroundAssetId)
    if (asset) return asset.previewUrl
  }

  if (layout.backgroundMaterialId !== 'bg-none') {
    const material =
      backgroundMaterials.find((item) => item.id === layout.backgroundMaterialId) ??
      backgroundMaterials[0]
    if (material.preview.startsWith('url(')) {
      const match = material.preview.match(/url\(([^)]+)\)/)
      return match?.[1]?.replace(/['"]/g, '') ?? null
    }
  }

  return null
}

function toPlayableImageUrl(source: string): string {
  if (source.startsWith('blob:') || source.startsWith('/media-proxy?')) {
    return source
  }

  return getMediaProxyUrl(source)
}

export function resolveBackgroundImageUrl(
  layout: BackgroundLayoutSettings,
  assets: { id: string; previewUrl: string; type?: string }[],
): string | null {
  const source = resolveImageSource(layout, assets)
  return source ? toPlayableImageUrl(source) : null
}

export function isAnimatedGifBackground(
  layout: BackgroundLayoutSettings,
  assets: { id: string; previewUrl: string; type?: string }[],
): boolean {
  if (layout.backgroundType !== 'image') return false

  if (layout.backgroundAssetId) {
    const asset = assets.find((item) => item.id === layout.backgroundAssetId)
    if (asset?.type === 'gif') return true
  }

  const source = resolveImageSource(layout, assets)
  if (!source) return false

  if (layout.backgroundSourceUrl && !layout.backgroundAssetId) {
    const linkedAsset = assets.find((item) => item.previewUrl === layout.backgroundSourceUrl)
    if (linkedAsset?.type === 'gif') return true
  }

  const path = source.split('?')[0]?.toLowerCase() ?? ''
  if (path.endsWith('.gif')) return true

  if (source.includes('/media-proxy?')) {
    try {
      const parsed = new URL(source, 'http://localhost')
      const remoteUrl = parsed.searchParams.get('url')?.toLowerCase() ?? ''
      if (remoteUrl.includes('.gif')) return true
    } catch {
      // Ignore malformed proxy URLs.
    }
  }

  return false
}

/** Keeps a mounted <img> in sync with layout image backgrounds (including animated GIFs). */
export function syncBackgroundImageElement(
  image: HTMLImageElement,
  layout: BackgroundLayoutSettings,
  assets: { id: string; previewUrl: string }[],
  onError?: (message: string) => void,
): () => void {
  const source = resolveImageSource(layout, assets)

  if (!source) {
    image.removeAttribute('src')
    return () => {
      image.removeAttribute('src')
    }
  }

  let cancelled = false
  let attempt = 0
  const attempts = [toPlayableImageUrl(source), source]

  const loadAttempt = () => {
    if (cancelled || attempt >= attempts.length) {
      onError?.('Background image could not be loaded.')
      image.removeAttribute('src')
      return
    }

    const nextSource = attempts[attempt]
    attempt += 1

    if (nextSource.startsWith('blob:') || nextSource.startsWith('/media-proxy?')) {
      image.removeAttribute('crossorigin')
    } else {
      image.crossOrigin = 'anonymous'
    }

    if (image.getAttribute('src') !== nextSource) {
      image.src = nextSource
    }
  }

  image.onload = null
  image.onerror = () => {
    if (!cancelled) loadAttempt()
  }

  loadAttempt()

  return () => {
    cancelled = true
    image.onload = null
    image.onerror = null
    image.removeAttribute('src')
  }
}

/** Decodes and plays animated GIF backgrounds frame-by-frame for canvas compositing. */
export function syncBackgroundGif(
  layout: BackgroundLayoutSettings,
  assets: { id: string; previewUrl: string; type?: string }[],
  onReady: (player: AnimatedGifPlayer | null) => void,
  onError?: (message: string) => void,
): () => void {
  const source = resolveImageSource(layout, assets)

  if (!source) {
    onReady(null)
    return () => undefined
  }

  let cancelled = false
  let attempt = 0
  const attempts = [toPlayableImageUrl(source), source]
  let activePlayer: AnimatedGifPlayer | null = null

  const loadAttempt = async () => {
    if (cancelled || attempt >= attempts.length) {
      onError?.('Background GIF could not be loaded.')
      onReady(null)
      return
    }

    const nextSource = attempts[attempt]
    attempt += 1

    try {
      const player = await AnimatedGifPlayer.fromUrl(nextSource)
      if (cancelled) {
        player.dispose()
        return
      }

      activePlayer?.dispose()
      activePlayer = player
      onReady(player)
    } catch {
      await loadAttempt()
    }
  }

  void loadAttempt()

  return () => {
    cancelled = true
    activePlayer?.dispose()
    activePlayer = null
    onReady(null)
  }
}

export function resolveBackgroundVideoUrl(
  layout: BackgroundLayoutSettings,
  assets: { id: string; previewUrl: string; type: string }[],
): string | null {
  if (layout.backgroundType !== 'video') return null

  if (layout.backgroundSourceUrl) {
    return layout.backgroundSourceUrl.startsWith('blob:')
      ? layout.backgroundSourceUrl
      : getMediaProxyUrl(layout.backgroundSourceUrl)
  }

  if (layout.backgroundAssetId) {
    const asset = assets.find((item) => item.id === layout.backgroundAssetId)
    if (asset?.type === 'video') return asset.previewUrl
  }

  return null
}
