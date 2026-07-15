export interface FloatingSticker {
  id: string
  imageUrl: string
  label: string
  durationS: number
  startedAtMs: number
  driftX: number
  wobble: number
  spin: number
  size: number
}

export interface StickerPose {
  progress: number
  centerX: number
  centerY: number
  width: number
  height: number
  scale: number
  rotateDeg: number
  opacity: number
}

const REM_PX = 16
const RISE_VH = 112

export function getStickerProgress(sticker: FloatingSticker, nowMs: number): number {
  if (sticker.durationS <= 0) return 1
  return Math.min(1, Math.max(0, (nowMs - sticker.startedAtMs) / (sticker.durationS * 1000)))
}

export function getStickerPose(
  sticker: FloatingSticker,
  canvasWidth: number,
  canvasHeight: number,
  imageAspect: number,
  nowMs: number,
): StickerPose {
  const progress = getStickerProgress(sticker, nowMs)
  const rise = 1 - (1 - progress) ** 2.6

  const drift =
    sticker.driftX * Math.sin(progress * Math.PI * 0.9) +
    Math.sin(progress * Math.PI * 2.35) * sticker.wobble * 0.4 +
    sticker.driftX * 0.12 * progress

  const grow = 1 - (1 - Math.min(progress / 0.16, 1)) ** 2
  const settle = progress > 0.72 ? 1 - 0.05 * ((progress - 0.72) / 0.28) : 1
  const scale = 0.48 + 0.58 * grow * settle

  const rotateDeg =
    sticker.spin * (0.08 + 0.32 * Math.sin(progress * Math.PI * 1.7) + 0.12 * (1 - progress))

  let opacity = 1
  if (progress < 0.05) opacity = progress / 0.05
  else if (progress > 0.82) opacity = (1 - progress) / 0.18

  const width = Math.max(1, sticker.size * REM_PX)
  const height = Math.max(1, width / Math.max(imageAspect, 0.01))
  const centerX = canvasWidth / 2 + drift
  const centerY = canvasHeight - height / 2 - (RISE_VH / 100) * canvasHeight * rise

  return {
    progress,
    centerX,
    centerY,
    width,
    height,
    scale,
    rotateDeg,
    opacity,
  }
}

const imageCache = new Map<string, HTMLImageElement>()

export function preloadStickerImage(imageUrl: string): void {
  if (imageCache.has(imageUrl)) return
  const image = new Image()
  image.decoding = 'async'
  image.src = imageUrl
  imageCache.set(imageUrl, image)
}

export function getStickerImage(imageUrl: string): HTMLImageElement | null {
  let image = imageCache.get(imageUrl)
  if (!image) {
    image = new Image()
    image.decoding = 'async'
    image.src = imageUrl
    imageCache.set(imageUrl, image)
  }

  if (!image.complete || image.naturalWidth <= 0) return null
  return image
}

export function drawFloatingStickers(
  context: CanvasRenderingContext2D,
  stickers: FloatingSticker[],
  canvasWidth: number,
  canvasHeight: number,
  nowMs = performance.now(),
) {
  if (stickers.length === 0) return

  for (const sticker of stickers) {
    const image = getStickerImage(sticker.imageUrl)
    if (!image) continue

    const aspect = image.naturalWidth / image.naturalHeight
    const pose = getStickerPose(sticker, canvasWidth, canvasHeight, aspect, nowMs)
    if (pose.opacity <= 0.01 || pose.progress >= 1) continue

    context.save()
    context.translate(pose.centerX, pose.centerY)
    context.rotate((pose.rotateDeg * Math.PI) / 180)
    context.scale(pose.scale, pose.scale)
    context.globalAlpha = pose.opacity
    context.shadowColor = 'rgba(0,0,0,0.32)'
    context.shadowBlur = 32
    context.shadowOffsetY = 12
    context.drawImage(image, -pose.width / 2, -pose.height / 2, pose.width, pose.height)
    context.restore()
  }
}
