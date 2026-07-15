import { effectMaterials, type MaterialItem } from '@/config/materials'
import type { CSSProperties } from 'react'

export interface CompositorBackground {
  style: CSSProperties
  image: HTMLImageElement | null
}

export function getEffectFilter(effectId: string): string {
  switch (effectId) {
    case 'fx-soft-glow':
      return 'brightness(1.08) saturate(1.1)'
    case 'fx-vignette':
      return 'brightness(0.92) contrast(1.05)'
    case 'fx-film':
      return 'contrast(1.1) saturate(0.85)'
    case 'fx-warm':
      return 'sepia(0.18) saturate(1.15)'
    case 'fx-cool':
      return 'hue-rotate(15deg) saturate(1.05)'
    default:
      return 'none'
  }
}

export function getMaterialBackground(material: MaterialItem): CompositorBackground {
  if (material.preview.startsWith('url(')) {
    const match = material.preview.match(/url\(([^)]+)\)/)
    const src = match?.[1]?.replace(/['"]/g, '')
    const image = new Image()
    image.crossOrigin = 'anonymous'
    if (src) image.src = src
    return { style: {}, image }
  }

  return {
    style: { background: material.preview },
    image: null,
  }
}

export function drawBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: CompositorBackground,
) {
  if (background.image?.complete && background.image.naturalWidth > 0) {
    context.drawImage(background.image, 0, 0, width, height)
    return
  }

  const gradient = background.style.background
  if (typeof gradient === 'string' && gradient.includes('gradient')) {
    context.fillStyle = '#171717'
    context.fillRect(0, 0, width, height)
    return
  }

  context.fillStyle = (background.style.backgroundColor as string) ?? '#171717'
  context.fillRect(0, 0, width, height)
}

export function drawCoverImageInRect(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  mirror = false,
) {
  const sourceWidth = Number(
    'videoWidth' in source ? source.videoWidth : 'width' in source ? source.width : width,
  )
  const sourceHeight = Number(
    'videoHeight' in source ? source.videoHeight : 'height' in source ? source.height : height,
  )

  if (!sourceWidth || !sourceHeight) return

  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = width / height

  let drawWidth = width
  let drawHeight = height
  let offsetX = x
  let offsetY = y

  if (sourceAspect > targetAspect) {
    drawWidth = height * sourceAspect
    offsetX = x + (width - drawWidth) / 2
  } else {
    drawHeight = width / sourceAspect
    offsetY = y + (height - drawHeight) / 2
  }

  context.save()
  context.beginPath()
  context.roundRect(x, y, width, height, 12)
  context.clip()

  if (mirror) {
    context.translate(x + width, y)
    context.scale(-1, 1)
    context.drawImage(source, x, offsetY, drawWidth, drawHeight)
  } else {
    context.drawImage(source, offsetX, offsetY, drawWidth, drawHeight)
  }

  context.restore()
}

export function drawCoverImage(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  mirror = false,
) {
  drawCoverImageInRect(context, source, 0, 0, width, height, mirror)
}

export function getEffectById(effectId: string) {
  return effectMaterials.find((item) => item.id === effectId) ?? effectMaterials[0]
}
