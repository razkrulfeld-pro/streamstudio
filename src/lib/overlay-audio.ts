import type { OverlayAudioClip } from '@/types/editor-project'

/** Max duration of an inserted audio clip (seconds). */
export const OVERLAY_AUDIO_MAX_DURATION_S = 60

/** Max upload / stored overlay blob size (bytes). */
export const OVERLAY_AUDIO_MAX_BYTES = 20 * 1024 * 1024

export function clampExtractDurationSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds)) return 1
  return Math.min(OVERLAY_AUDIO_MAX_DURATION_S, Math.max(1, Math.round(durationSeconds)))
}

export function clampPlacement(
  clip: Pick<OverlayAudioClip, 'sourceDurationS'>,
  startAtEditedS: number,
  durationS: number,
  editedDurationS: number,
): { startAtEditedS: number; durationS: number } {
  const maxDuration = Math.min(
    Math.max(0.05, clip.sourceDurationS || durationS || 0.05),
    OVERLAY_AUDIO_MAX_DURATION_S,
  )
  const edited = Math.max(0, editedDurationS)
  // Keep the requested start even if edited duration is not ready yet.
  if (edited <= 0) {
    return {
      startAtEditedS: Math.max(0, startAtEditedS),
      durationS: Math.max(0.05, Math.min(durationS, maxDuration)),
    }
  }
  const start = Math.max(0, Math.min(startAtEditedS, Math.max(0, edited - 0.05)))
  const duration = Math.max(
    0.05,
    Math.min(durationS, maxDuration, Math.max(0.05, edited - start)),
  )
  return { startAtEditedS: start, durationS: duration }
}

export function defaultPlacementForClip(sourceDurationS: number): {
  startAtEditedS: number
  durationS: number
} {
  return {
    startAtEditedS: 0,
    durationS: Math.min(Math.max(0, sourceDurationS), OVERLAY_AUDIO_MAX_DURATION_S),
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  if ('code' in error && (error.code === 22 || error.code === 1014)) return true
  return false
}

export function overlayFormatFromMime(mimeType: string): 'm4a' | 'mp3' | 'other' {
  const mime = mimeType.toLowerCase()
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'other'
}
