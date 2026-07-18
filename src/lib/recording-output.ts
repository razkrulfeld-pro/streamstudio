/** Standard YouTube landscape upload frame (16:9). */
export const YOUTUBE_OUTPUT_WIDTH = 1920
export const YOUTUBE_OUTPUT_HEIGHT = 1080
export const YOUTUBE_OUTPUT_ASPECT = YOUTUBE_OUTPUT_WIDTH / YOUTUBE_OUTPUT_HEIGHT

/**
 * Target encode settings for canvas capture / export.
 * Browser MediaRecorder defaults (~1–2.5 Mbps) look soft on YouTube.
 * Prefer VP9 when available; scale bitrate with pixel count.
 */
export const YOUTUBE_VIDEO_BITS_PER_SECOND = 12_000_000
export const YOUTUBE_AUDIO_BITS_PER_SECOND = 192_000

/** ~12 Mbps at 1080p (≈2.07M px); scales for Shorts 1080×1920 and larger canvases. */
export function videoBitsPerSecondForDimensions(width: number, height: number): number {
  const pixels = Math.max(1, width * height)
  const referencePixels = 1920 * 1080
  const scaled = Math.round(YOUTUBE_VIDEO_BITS_PER_SECOND * (pixels / referencePixels))
  return Math.min(25_000_000, Math.max(8_000_000, scaled))
}

const RECORDER_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
] as const

export function getRecorderMimeType(): string {
  return (
    RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm'
  )
}

export function getRecorderOptions(
  mimeType = getRecorderMimeType(),
  dimensions?: { width: number; height: number },
): MediaRecorderOptions {
  const videoBitsPerSecond = dimensions
    ? videoBitsPerSecondForDimensions(dimensions.width, dimensions.height)
    : YOUTUBE_VIDEO_BITS_PER_SECOND

  return {
    mimeType,
    videoBitsPerSecond,
    audioBitsPerSecond: YOUTUBE_AUDIO_BITS_PER_SECOND,
  }
}
