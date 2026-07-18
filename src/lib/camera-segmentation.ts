import { FilesetResolver, ImageSegmenter, type MPMask } from '@mediapipe/tasks-vision'

export interface SegmentationMaskSnapshot {
  data: Float32Array
  width: number
  height: number
}

const MASK_EDGE_LOW = 0.2
const MASK_EDGE_HIGH = 0.82
const MASK_FEATHER_BLUR_PX = 2.5
const MASK_TEMPORAL_BLEND = 0.42

let segmenter: ImageSegmenter | null = null
let segmenterInit: Promise<ImageSegmenter> | null = null
let maskRasterCanvas: HTMLCanvasElement | null = null
let maskScaledCanvas: HTMLCanvasElement | null = null
let maskRasterImageData: ImageData | null = null
let smoothedMaskData: Float32Array | null = null
let smoothedMaskWidth = 0
let smoothedMaskHeight = 0

async function createSegmenter(delegate: 'GPU' | 'CPU'): Promise<ImageSegmenter> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
  )

  return ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      // General selfie model — landscape-only variant degrades portrait Shorts masks.
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
      delegate,
    },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  })
}

export function getCameraSegmenter(): Promise<ImageSegmenter> {
  if (segmenter) return Promise.resolve(segmenter)

  if (!segmenterInit) {
    segmenterInit = (async () => {
      try {
        segmenter = await createSegmenter('GPU')
      } catch {
        segmenter = await createSegmenter('CPU')
      }
      return segmenter
    })()
  }

  return segmenterInit
}

export function snapshotMask(mask: MPMask): SegmentationMaskSnapshot {
  return {
    data: mask.getAsFloat32Array(),
    width: mask.width,
    height: mask.height,
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function ensureCanvas(
  ref: { current: HTMLCanvasElement | null },
  width: number,
  height: number,
): HTMLCanvasElement {
  if (!ref.current) {
    ref.current = document.createElement('canvas')
  }

  if (ref.current.width !== width) ref.current.width = width
  if (ref.current.height !== height) ref.current.height = height

  return ref.current
}

function smoothMaskOverTime(mask: SegmentationMaskSnapshot): SegmentationMaskSnapshot {
  const pixelCount = mask.data.length

  if (
    !smoothedMaskData ||
    smoothedMaskWidth !== mask.width ||
    smoothedMaskHeight !== mask.height ||
    smoothedMaskData.length !== pixelCount
  ) {
    smoothedMaskData = new Float32Array(mask.data)
    smoothedMaskWidth = mask.width
    smoothedMaskHeight = mask.height
    return {
      data: smoothedMaskData,
      width: mask.width,
      height: mask.height,
    }
  }

  const blend = MASK_TEMPORAL_BLEND
  const keep = 1 - blend

  for (let index = 0; index < pixelCount; index += 1) {
    smoothedMaskData[index] = smoothedMaskData[index] * keep + mask.data[index] * blend
  }

  return {
    data: smoothedMaskData,
    width: mask.width,
    height: mask.height,
  }
}

export function resetSegmentationSmoothing() {
  smoothedMaskData = null
  smoothedMaskWidth = 0
  smoothedMaskHeight = 0
}

/** Max age for a segmentation mask before we treat cutout as stale. */
export const SEGMENTATION_MASK_STALE_MS = 250

export function isSegmentationMaskFresh(
  capturedAtMs: number | null,
  nowMs: number,
  staleAfterMs = SEGMENTATION_MASK_STALE_MS,
): boolean {
  if (capturedAtMs == null) return false
  return nowMs - capturedAtMs <= staleAfterMs
}

export async function segmentCameraFrame(
  video: HTMLVideoElement,
  timestampMs: number,
): Promise<SegmentationMaskSnapshot | null> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null

  const imageSegmenter = await getCameraSegmenter()
  const result = imageSegmenter.segmentForVideo(video, timestampMs)
  const mask = result.confidenceMasks?.[0]
  if (!mask) return null

  const snapshot = smoothMaskOverTime(snapshotMask(mask))
  mask.close()
  return snapshot
}

function rasterizeSoftMask(mask: SegmentationMaskSnapshot): HTMLCanvasElement {
  const canvas = ensureCanvas({ current: maskRasterCanvas }, mask.width, mask.height)
  maskRasterCanvas = canvas

  const context = canvas.getContext('2d')
  if (!context) return canvas

  if (
    !maskRasterImageData ||
    maskRasterImageData.width !== mask.width ||
    maskRasterImageData.height !== mask.height
  ) {
    maskRasterImageData = context.createImageData(mask.width, mask.height)
  }

  const pixels = maskRasterImageData.data

  for (let index = 0; index < mask.data.length; index += 1) {
    const alpha = Math.round(smoothstep(MASK_EDGE_LOW, MASK_EDGE_HIGH, mask.data[index]) * 255)
    const pixelIndex = index * 4
    pixels[pixelIndex] = 255
    pixels[pixelIndex + 1] = 255
    pixels[pixelIndex + 2] = 255
    pixels[pixelIndex + 3] = alpha
  }

  context.putImageData(maskRasterImageData, 0, 0)
  return canvas
}

function getFeatheredMaskCanvas(
  mask: SegmentationMaskSnapshot,
  width: number,
  height: number,
): HTMLCanvasElement {
  const rasterMask = rasterizeSoftMask(mask)
  const scaledMaskCanvas = ensureCanvas({ current: maskScaledCanvas }, width, height)
  maskScaledCanvas = scaledMaskCanvas

  const scaledMaskContext = scaledMaskCanvas.getContext('2d')
  if (!scaledMaskContext) return scaledMaskCanvas

  scaledMaskContext.clearRect(0, 0, width, height)
  scaledMaskContext.imageSmoothingEnabled = true
  scaledMaskContext.imageSmoothingQuality = 'high'
  scaledMaskContext.filter = `blur(${MASK_FEATHER_BLUR_PX}px)`
  scaledMaskContext.drawImage(rasterMask, 0, 0, width, height)
  scaledMaskContext.filter = 'none'

  return scaledMaskCanvas
}

let blurSourceCanvas: HTMLCanvasElement | null = null

/** Blurred camera feed with the person region removed so only the background stays blurred. */
export function composeBlurOnlyBackground(
  output: HTMLCanvasElement,
  source: CanvasImageSource,
  mask: SegmentationMaskSnapshot,
) {
  const size = getMaskSourceSize(source)
  if (!size) return
  const { width, height } = size

  if (output.width !== width || output.height !== height) {
    output.width = width
    output.height = height
  }

  blurSourceCanvas = ensureCanvas({ current: blurSourceCanvas }, width, height)
  const blurContext = blurSourceCanvas.getContext('2d')
  const outputContext = output.getContext('2d')
  if (!blurContext || !outputContext) return

  blurContext.clearRect(0, 0, width, height)
  blurContext.fillStyle = '#000000'
  blurContext.fillRect(0, 0, width, height)

  const overscan = 1.12
  const drawWidth = width * overscan
  const drawHeight = height * overscan

  blurContext.filter = 'blur(36px) saturate(1.12)'
  blurContext.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  blurContext.filter = 'none'

  outputContext.clearRect(0, 0, width, height)
  outputContext.drawImage(blurSourceCanvas, 0, 0)

  const featheredMask = getFeatheredMaskCanvas(mask, width, height)
  outputContext.save()
  outputContext.globalCompositeOperation = 'destination-out'
  outputContext.drawImage(featheredMask, 0, 0, width, height)
  outputContext.restore()
}

function getMaskSourceSize(
  source: CanvasImageSource,
): { width: number; height: number } | null {
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    const width = source.displayWidth || source.codedWidth
    const height = source.displayHeight || source.codedHeight
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (source instanceof HTMLVideoElement) {
    return source.videoWidth > 0 && source.videoHeight > 0
      ? { width: source.videoWidth, height: source.videoHeight }
      : null
  }
  if (source instanceof HTMLCanvasElement) {
    return source.width > 0 && source.height > 0
      ? { width: source.width, height: source.height }
      : null
  }
  return null
}

/** Applies a selfie mask to raw (unmirrored) camera pixels. Mirror happens at composite time. */
export function applySegmentationMask(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  mask: SegmentationMaskSnapshot,
) {
  const size = getMaskSourceSize(source)
  if (!size) return
  const { width, height } = size

  if (context.canvas.width !== width || context.canvas.height !== height) {
    context.canvas.width = width
    context.canvas.height = height
  }

  const featheredMask = getFeatheredMaskCanvas(mask, width, height)

  context.clearRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  context.save()
  context.globalCompositeOperation = 'destination-in'
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(featheredMask, 0, 0, width, height)
  context.restore()
}
