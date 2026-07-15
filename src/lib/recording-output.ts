/** Standard YouTube landscape upload frame (16:9). */
export const YOUTUBE_OUTPUT_WIDTH = 1920
export const YOUTUBE_OUTPUT_HEIGHT = 1080
export const YOUTUBE_OUTPUT_ASPECT = YOUTUBE_OUTPUT_WIDTH / YOUTUBE_OUTPUT_HEIGHT

/**
 * Target encode settings for 1080p canvas capture / export.
 * Browser MediaRecorder defaults (~1–2.5 Mbps) look soft on YouTube at this size.
 * Prefer VP9 when available; YouTube’s recommended 1080p30 ballpark is ~8 Mbps —
 * we aim a bit higher for sharp screen content.
 */
export const YOUTUBE_VIDEO_BITS_PER_SECOND = 12_000_000
export const YOUTUBE_AUDIO_BITS_PER_SECOND = 192_000

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

export function getRecorderOptions(mimeType = getRecorderMimeType()): MediaRecorderOptions {
  return {
    mimeType,
    videoBitsPerSecond: YOUTUBE_VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: YOUTUBE_AUDIO_BITS_PER_SECOND,
  }
}
