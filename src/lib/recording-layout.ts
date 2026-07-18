import type {
  BubbleAnchorH,
  BubbleAnchorV,
  BubbleRatio,
  BubbleSize,
  ContainerStyle,
} from '@/types/recording-layout'
import { bubbleRatioValue, bubbleSizeScale } from '@/types/recording-layout'
import { shouldDrawSegmentedPersonOnly } from '@/lib/export-cutout-helpers'

export interface BubbleRect {
  x: number
  y: number
  width: number
  height: number
}

const STAGE_PADDING = 24

const DEFAULT_SCREEN_SHARE_ASPECT = 16 / 9

export function computeScreenShareFrameRect(
  stageWidth: number,
  stageHeight: number,
  margins: number,
  contentAspect = DEFAULT_SCREEN_SHARE_ASPECT,
): BubbleRect {
  const inset = Math.max(0, margins)
  const maxInsetX = Math.max(0, (stageWidth - 96) / 2)
  const maxInsetY = Math.max(0, (stageHeight - 96) / 2)
  const marginX = Math.min(inset, maxInsetX)
  const marginY = Math.min(inset, maxInsetY)

  const availW = Math.max(1, stageWidth - marginX * 2)
  const availH = Math.max(1, stageHeight - marginY * 2)
  const aspect =
    Number.isFinite(contentAspect) && contentAspect > 0
      ? contentAspect
      : DEFAULT_SCREEN_SHARE_ASPECT

  // Size the screen/device frame to the stage (session) aspect within margins.
  // Source video letterboxes inside the frame — rotation must not change frame aspect.
  let width = availW
  let height = availW / aspect
  if (height > availH) {
    height = availH
    width = availH * aspect
  }

  return {
    x: marginX + (availW - width) / 2,
    y: marginY + (availH - height) / 2,
    width: Math.max(1, width),
    height: Math.max(1, height),
  }
}

function computeContainLayout(
  sourceWidth: number,
  sourceHeight: number,
  rectWidth: number,
  rectHeight: number,
): CoverLayout | null {
  if (!sourceWidth || !sourceHeight) return null

  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = rectWidth / rectHeight

  let drawWidth = rectWidth
  let drawHeight = rectHeight
  let offsetX = 0
  let offsetY = 0

  if (sourceAspect > targetAspect) {
    drawHeight = rectWidth / sourceAspect
    offsetY = (rectHeight - drawHeight) / 2
  } else {
    drawWidth = rectHeight * sourceAspect
    offsetX = (rectWidth - drawWidth) / 2
  }

  return { offsetX, offsetY, drawWidth, drawHeight }
}

export function drawContainSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: BubbleRect,
  mirror: boolean,
) {
  const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(source, rect)
  const layout = computeContainLayout(sourceWidth, sourceHeight, rect.width, rect.height)
  if (!layout) return

  context.save()
  context.translate(rect.x, rect.y)
  if (mirror) {
    context.translate(rect.width, 0)
    context.scale(-1, 1)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    source,
    layout.offsetX,
    layout.offsetY,
    layout.drawWidth,
    layout.drawHeight,
  )
  context.restore()
}

function computeContainContentRect(
  frameRect: BubbleRect,
  sourceWidth: number,
  sourceHeight: number,
): BubbleRect | null {
  const layout = computeContainLayout(sourceWidth, sourceHeight, frameRect.width, frameRect.height)
  if (!layout) return null

  return {
    x: frameRect.x + layout.offsetX,
    y: frameRect.y + layout.offsetY,
    width: layout.drawWidth,
    height: layout.drawHeight,
  }
}

export function drawScreenShareInFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  frameRect: BubbleRect,
  cornerRadius: number,
) {
  const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(source, frameRect)
  const contentRect = computeContainContentRect(frameRect, sourceWidth, sourceHeight) ?? frameRect
  const radius = Math.max(
    0,
    Math.min(cornerRadius, Math.min(contentRect.width, contentRect.height) / 2),
  )

  context.save()
  context.beginPath()
  context.roundRect(contentRect.x, contentRect.y, contentRect.width, contentRect.height, radius)
  context.clip()
  // Fit the entire shared screen inside the container (no crop), centered.
  drawContainSource(context, source, contentRect, false)
  context.restore()
}

export function computeBubbleRect(
  stageWidth: number,
  stageHeight: number,
  size: BubbleSize,
  ratio: BubbleRatio,
  positionV: BubbleAnchorV,
  positionH: BubbleAnchorH,
): BubbleRect {
  const aspect = bubbleRatioValue[ratio]
  const base = stageHeight * bubbleSizeScale[size]
  let width = base
  let height = base

  if (aspect >= 1) {
    width = base * aspect
    height = base
  } else {
    width = base
    height = base / aspect
  }

  width = Math.min(width, stageWidth - STAGE_PADDING * 2)
  height = Math.min(height, stageHeight - STAGE_PADDING * 2)

  let x = STAGE_PADDING
  let y = STAGE_PADDING

  if (positionH === 'center') x = (stageWidth - width) / 2
  if (positionH === 'right') x = stageWidth - width - STAGE_PADDING

  if (positionV === 'center') y = (stageHeight - height) / 2
  if (positionV === 'bottom') y = stageHeight - height - STAGE_PADDING

  return { x, y, width, height }
}

export function getContainerRadius(style: ContainerStyle, width: number, height: number): number {
  if (style === 'circle') return Math.min(width, height) / 2
  if (style === 'square' || style === 'none') return 0
  if (style === 'rounded') return Math.min(Math.min(width, height) * 0.44, 64)
  return Math.min(Math.min(width, height) * 0.14, 20)
}

export function clipContainer(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  style: ContainerStyle,
) {
  const radius = getContainerRadius(style, width, height)
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
  context.clip()
}

export function strokeContainer(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  style: ContainerStyle,
) {
  const radius = getContainerRadius(style, width, height)
  context.strokeStyle = 'rgba(255,255,255,0.85)'
  context.lineWidth = 2
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
  context.stroke()
}

export interface CameraFraming {
  zoom: number
  panY: number
}

interface CoverLayout {
  offsetX: number
  offsetY: number
  drawWidth: number
  drawHeight: number
}

function getSourceDimensions(
  source: CanvasImageSource,
  fallback: Pick<BubbleRect, 'width' | 'height'>,
): { width: number; height: number } {
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return {
      width: source.displayWidth || source.codedWidth || fallback.width,
      height: source.displayHeight || source.codedHeight || fallback.height,
    }
  }

  const width = Number(
    'videoWidth' in source ? source.videoWidth : 'width' in source ? source.width : fallback.width,
  )
  const height = Number(
    'videoHeight' in source
      ? source.videoHeight
      : 'height' in source
        ? source.height
        : fallback.height,
  )
  return { width, height }
}

function computeCoverLayout(
  sourceWidth: number,
  sourceHeight: number,
  rectWidth: number,
  rectHeight: number,
  framing: CameraFraming = { zoom: 1, panY: 0 },
): CoverLayout | null {
  if (!sourceWidth || !sourceHeight) return null

  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = rectWidth / rectHeight

  let drawWidth = rectWidth
  let drawHeight = rectHeight
  let offsetX = 0
  let offsetY = 0

  if (sourceAspect > targetAspect) {
    drawWidth = rectHeight * sourceAspect
    offsetX = (rectWidth - drawWidth) / 2
  } else {
    drawHeight = rectWidth / sourceAspect
    offsetY = (rectHeight - drawHeight) / 2
  }

  if (framing.zoom > 1 || framing.panY !== 0) {
    const centerX = offsetX + drawWidth / 2
    const centerY = offsetY + drawHeight / 2
    drawWidth *= framing.zoom
    drawHeight *= framing.zoom
    offsetX = centerX - drawWidth / 2
    offsetY = centerY - drawHeight / 2 + framing.panY * rectHeight * 0.35
  }

  return { offsetX, offsetY, drawWidth, drawHeight }
}

export function drawCoverSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: BubbleRect,
  mirror: boolean,
  framing: CameraFraming = { zoom: 1, panY: 0 },
) {
  const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(source, rect)
  const layout = computeCoverLayout(sourceWidth, sourceHeight, rect.width, rect.height, framing)
  if (!layout) return

  context.save()
  context.translate(rect.x, rect.y)
  if (mirror) {
    context.translate(rect.width, 0)
    context.scale(-1, 1)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    source,
    layout.offsetX,
    layout.offsetY,
    layout.drawWidth,
    layout.drawHeight,
  )
  context.restore()
}

let blurredVideoBuffer: HTMLCanvasElement | null = null

function ensureBufferCanvas(width: number, height: number): HTMLCanvasElement {
  if (!blurredVideoBuffer) {
    blurredVideoBuffer = document.createElement('canvas')
  }

  if (blurredVideoBuffer.width !== width || blurredVideoBuffer.height !== height) {
    blurredVideoBuffer.width = width
    blurredVideoBuffer.height = height
  }

  return blurredVideoBuffer
}

/** Draws a blurred camera frame reliably via an offscreen buffer (works with video sources). */
export function drawBlurredCoverInRect(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: BubbleRect,
  mirror = false,
  framing: CameraFraming = { zoom: 1, panY: 0 },
) {
  const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(source, rect)
  const layout = computeCoverLayout(sourceWidth, sourceHeight, rect.width, rect.height, framing)
  if (!layout) return

  const buffer = ensureBufferCanvas(rect.width, rect.height)
  const bufferContext = buffer.getContext('2d')
  if (!bufferContext) return

  bufferContext.clearRect(0, 0, rect.width, rect.height)
  bufferContext.fillStyle = '#000000'
  bufferContext.fillRect(0, 0, rect.width, rect.height)

  const overscan = 1.14
  const scaledWidth = layout.drawWidth * overscan
  const scaledHeight = layout.drawHeight * overscan
  const scaledOffsetX = layout.offsetX - (scaledWidth - layout.drawWidth) / 2
  const scaledOffsetY = layout.offsetY - (scaledHeight - layout.drawHeight) / 2

  bufferContext.save()
  if (mirror) {
    bufferContext.translate(rect.width, 0)
    bufferContext.scale(-1, 1)
  }
  bufferContext.imageSmoothingEnabled = true
  bufferContext.imageSmoothingQuality = 'high'
  bufferContext.drawImage(
    source,
    scaledOffsetX,
    scaledOffsetY,
    scaledWidth,
    scaledHeight,
  )
  bufferContext.restore()

  const edgePad = 40
  context.save()
  context.filter = 'blur(36px) saturate(1.12)'
  context.drawImage(
    buffer,
    rect.x - edgePad,
    rect.y - edgePad,
    rect.width + edgePad * 2,
    rect.height + edgePad * 2,
  )
  context.filter = 'none'
  context.restore()
}

export function drawBlurredVideoBackground(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: BubbleRect,
  containerStyle: ContainerStyle = 'none',
) {
  context.save()
  clipContainer(context, rect.x, rect.y, rect.width, rect.height, containerStyle)
  context.filter = 'blur(28px) saturate(1.15)'
  drawCoverSource(context, source, rect, false)
  context.filter = 'none'
  context.restore()
}

export function drawVideoInStyledContainer(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: BubbleRect,
  containerStyle: ContainerStyle,
  mirror: boolean,
  drawBackground?: (context: CanvasRenderingContext2D, rect: BubbleRect) => void,
  framing: CameraFraming = { zoom: 1, panY: 0 },
  segmentedPerson?: CanvasImageSource | null,
) {
  context.save()
  clipContainer(context, rect.x, rect.y, rect.width, rect.height, containerStyle)

  if (drawBackground) {
    drawBackground(context, rect)
  }

  const hasFreshSegmentedPerson = Boolean(
    segmentedPerson && getSourceDimensions(segmentedPerson, rect).width,
  )

  if (
    shouldDrawSegmentedPersonOnly({
      hasBackground: Boolean(drawBackground),
      hasFreshSegmentedPerson,
    })
  ) {
    drawCoverSource(context, segmentedPerson!, rect, mirror, framing)
  } else if (!drawBackground && getSourceDimensions(source, rect).width) {
    // No cutout background — draw the full camera as usual.
    drawCoverSource(context, source, rect, mirror, framing)
  }
  // When a cutout background is active but the mask isn't ready yet, keep the
  // background only. Drawing the opaque camera here would bake a full-frame
  // flash into Shorts and look like cutout "failed".

  context.restore()
}

export function fillRectBackground(
  context: CanvasRenderingContext2D,
  rect: BubbleRect,
  fill: string,
) {
  context.fillStyle = fill
  context.fillRect(rect.x, rect.y, rect.width, rect.height)
}

export function fillGradientBackground(
  context: CanvasRenderingContext2D,
  rect: BubbleRect,
  colorA: string,
  colorB: string,
) {
  const gradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)
  gradient.addColorStop(0, colorA)
  gradient.addColorStop(1, colorB)
  context.fillStyle = gradient
  context.fillRect(rect.x, rect.y, rect.width, rect.height)
}

export function drawImageCoverInRect(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: BubbleRect,
) {
  drawCoverSource(context, source, rect, false)
}
