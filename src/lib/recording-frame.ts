import { drawOrbBackground } from '@/lib/orb-background'
import { drawFloatingStickers, type FloatingSticker } from '@/lib/floating-stickers'
import { getEffectFilter } from '@/lib/recording-compositor'
import {
  computeBubbleRect,
  computeScreenShareFrameRect,
  drawBlurredCoverInRect,
  drawCoverSource,
  drawImageCoverInRect,
  drawScreenShareInFrame,
  drawVideoInStyledContainer,
  fillGradientBackground,
  fillRectBackground,
  type BubbleRect,
} from '@/lib/recording-layout'
import type {
  BackgroundLayoutSettings,
  CameraLayoutSettings,
  ScreenShareLayoutSettings,
} from '@/types/recording-layout'
import { gradientColorPairs, normalizeScreenShareLayout } from '@/types/recording-layout'

export interface StageBackgroundAssets {
  image: HTMLImageElement | null
  gif: { canvas: HTMLCanvasElement; render: (timeMs: number) => void; isReady: boolean } | null
  video: HTMLVideoElement | null
  blurredBackground: HTMLCanvasElement | null
}

function stageRect(width: number, height: number): BubbleRect {
  return { x: 0, y: 0, width, height }
}

function createStageBackgroundDrawer(
  layout: BackgroundLayoutSettings,
  assets: StageBackgroundAssets,
  timeMs: number,
  blurSource?: CanvasImageSource | null,
  mirrorBlur = false,
) {
  return (context: CanvasRenderingContext2D, rect: BubbleRect) => {
    switch (layout.backgroundType) {
      case 'orb':
        drawOrbBackground(context, rect, timeMs, layout.backgroundOrbPreset)
        break
      case 'blur': {
        if (assets.blurredBackground) {
          drawCoverSource(context, assets.blurredBackground, rect, mirrorBlur)
          break
        }
        if (!blurSource) {
          fillRectBackground(context, rect, '#171717')
          break
        }
        drawBlurredCoverInRect(context, blurSource, rect, mirrorBlur)
        break
      }
      case 'solid':
        fillRectBackground(context, rect, layout.backgroundColor)
        break
      case 'gradient': {
        const [colorA, colorB] = gradientColorPairs[layout.backgroundGradient]
        fillGradientBackground(context, rect, colorA, colorB)
        break
      }
      case 'image': {
        const gif = assets.gif
        if (gif?.isReady) {
          gif.render(timeMs)
          context.save()
          context.beginPath()
          context.rect(rect.x, rect.y, rect.width, rect.height)
          context.clip()
          drawImageCoverInRect(context, gif.canvas, rect)
          context.restore()
          break
        }

        const image = assets.image
        if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
          context.save()
          context.beginPath()
          context.rect(rect.x, rect.y, rect.width, rect.height)
          context.clip()
          drawImageCoverInRect(context, image, rect)
          context.restore()
        }
        break
      }
      case 'video': {
        if (assets.video && assets.video.readyState >= 2) {
          context.save()
          context.beginPath()
          context.rect(rect.x, rect.y, rect.width, rect.height)
          context.clip()
          drawImageCoverInRect(context, assets.video, rect)
          context.restore()
        }
        break
      }
      case 'none':
        fillRectBackground(context, rect, '#171717')
        break
    }
  }
}

function isDrawableSource(source: CanvasImageSource | null | undefined): source is CanvasImageSource {
  if (!source) return false
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return (source.displayWidth || source.codedWidth) > 0
  }
  if (source instanceof HTMLVideoElement) {
    return source.readyState >= 2 && source.videoWidth > 0
  }
  if (source instanceof HTMLCanvasElement) {
    return source.width > 0 && source.height > 0
  }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    return source.width > 0 && source.height > 0
  }
  if (source instanceof HTMLImageElement) {
    return source.complete && source.naturalWidth > 0
  }
  return true
}

function sourceAspect(source: CanvasImageSource): number | undefined {
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    const w = source.displayWidth || source.codedWidth
    const h = source.displayHeight || source.codedHeight
    return w > 0 && h > 0 ? w / h : undefined
  }
  if (source instanceof HTMLVideoElement && source.videoWidth > 0 && source.videoHeight > 0) {
    return source.videoWidth / source.videoHeight
  }
  return undefined
}

export function renderRecordingFrame({
  context,
  width,
  height,
  effectId,
  cameraEnabled,
  screenShareEnabled,
  cameraVideo,
  screenVideo,
  cameraSource,
  screenSource,
  cameraLayout,
  screenShareLayout,
  cameraBackgroundAssets,
  screenBackgroundAssets,
  mirrorCamera,
  segmentedPersonCanvas,
  floatingStickers = [],
}: {
  context: CanvasRenderingContext2D
  width: number
  height: number
  effectId: string
  cameraEnabled: boolean
  screenShareEnabled: boolean
  /** @deprecated Prefer cameraSource */
  cameraVideo?: HTMLVideoElement | null
  /** @deprecated Prefer screenSource */
  screenVideo?: HTMLVideoElement | null
  cameraSource?: CanvasImageSource | null
  screenSource?: CanvasImageSource | null
  cameraLayout: CameraLayoutSettings
  screenShareLayout: ScreenShareLayoutSettings
  cameraBackgroundAssets: StageBackgroundAssets
  screenBackgroundAssets: StageBackgroundAssets
  mirrorCamera: boolean
  segmentedPersonCanvas: HTMLCanvasElement | null
  floatingStickers?: FloatingSticker[]
}) {
  context.filter = getEffectFilter(effectId)
  const timeMs = performance.now()

  const layout = normalizeScreenShareLayout(screenShareLayout)
  const screen = screenSource ?? screenVideo ?? null
  const camera = cameraSource ?? cameraVideo ?? null
  const screenReady = Boolean(screenShareEnabled && isDrawableSource(screen))
  const cameraReady = Boolean(cameraEnabled && isDrawableSource(camera))
  const stage = stageRect(width, height)

  // Quiet stage until a screen is connected — no large share-frame / stage chrome.
  fillRectBackground(context, stage, '#0a0a0a')

  if (screenReady && screen) {
    const drawScreenBackground = createStageBackgroundDrawer(
      layout,
      screenBackgroundAssets,
      timeMs,
      screen,
      false,
    )
    drawScreenBackground(context, stage)

    const frameRect = computeScreenShareFrameRect(width, height, layout.margins, sourceAspect(screen))
    drawScreenShareInFrame(context, screen, frameRect, layout.cornerRadius)
  }

  const cameraWantsFullscreen = cameraEnabled && cameraLayout.displayType === 'fullscreen'
  const cameraFullscreen = cameraWantsFullscreen && !screenShareEnabled

  const cameraBackground =
    camera && cameraLayout.backgroundType !== 'none'
      ? createStageBackgroundDrawer(
          cameraLayout,
          cameraBackgroundAssets,
          timeMs,
          camera,
          mirrorCamera,
        )
      : undefined

  const segmentedPerson =
    cameraBackground && segmentedPersonCanvas ? segmentedPersonCanvas : null

  const cameraFraming = { zoom: cameraLayout.cameraZoom, panY: cameraLayout.cameraPanY }

  if (cameraFullscreen && cameraReady && camera) {
    drawVideoInStyledContainer(
      context,
      camera,
      stage,
      'none',
      mirrorCamera,
      cameraBackground,
      cameraFraming,
      segmentedPerson,
    )
  }

  if (cameraReady && camera) {
    const forceBubble = screenShareEnabled && cameraWantsFullscreen
    const drawAsBubble = cameraLayout.displayType === 'bubble' || forceBubble

    if (drawAsBubble) {
      const rect = computeBubbleRect(
        width,
        height,
        cameraLayout.bubbleSize,
        cameraLayout.bubbleRatio,
        cameraLayout.positionV,
        cameraLayout.positionH,
      )
      drawVideoInStyledContainer(
        context,
        camera,
        rect,
        cameraLayout.containerStyle,
        mirrorCamera,
        cameraBackground,
        cameraFraming,
        segmentedPerson,
      )
    }
  }

  context.filter = 'none'
  drawFloatingStickers(context, floatingStickers, width, height, timeMs)
}
