import {
  clampExtractDurationSeconds,
  defaultPlacementForClip,
  OVERLAY_AUDIO_MAX_BYTES,
  OVERLAY_AUDIO_MAX_DURATION_S,
  overlayFormatFromMime,
} from '@/lib/overlay-audio'

export type ExtractProgressState = 'idle' | 'validating' | 'processing' | 'ready' | 'failed'

export interface ExtractSuccess {
  blob: Blob
  durationSeconds: number
  format: 'm4a' | 'mp3'
}

export class AudioExtractClientError extends Error {
  readonly code: string

  constructor(message: string, code = 'extract_failed') {
    super(message)
    this.name = 'AudioExtractClientError'
    this.code = code
  }
}

function apiBaseUrl(): string {
  const configured = (import.meta.env.VITE_AUDIO_API_URL as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  // Local Vite proxies /api and /media to the extract service (see vite.config.ts).
  if (import.meta.env.DEV) return ''
  return 'http://127.0.0.1:8080'
}

/** Strip accidental whitespace / trailing junk from pasted URLs. */
export function normalizeYoutubeUrl(url: string): string {
  return url
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    // Common paste glitches append a non-ASCII character after the video id.
    .replace(/[^A-Za-z0-9/_?=&.:%+-]+$/g, '')
}

function looksLikeYoutubeUrl(url: string): boolean {
  try {
    const parsed = new URL(normalizeYoutubeUrl(url))
    const host = parsed.hostname.toLowerCase()
    return (
      host === 'youtu.be' ||
      host === 'www.youtu.be' ||
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    )
  } catch {
    return false
  }
}

export function validateExtractInput(input: {
  url: string
  startTimeSeconds: number
  durationSeconds: number
}): string | null {
  if (!normalizeYoutubeUrl(input.url)) return 'Paste a YouTube URL.'
  if (!looksLikeYoutubeUrl(input.url)) return 'Enter a valid YouTube URL.'
  if (!Number.isFinite(input.startTimeSeconds) || input.startTimeSeconds < 0) {
    return 'Start time must be 0 or greater.'
  }
  const duration = clampExtractDurationSeconds(input.durationSeconds)
  if (duration < 1 || duration > OVERLAY_AUDIO_MAX_DURATION_S) {
    return `Duration must be between 1 and ${OVERLAY_AUDIO_MAX_DURATION_S} seconds.`
  }
  return null
}

function networkErrorMessage(): string {
  const base = apiBaseUrl() || 'this app (Vite proxy → http://127.0.0.1:8080)'
  return `Cannot reach the audio extract API (${base}). Start it with: cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8080`
}

export async function extractYoutubeAudio(input: {
  url: string
  startTimeSeconds: number
  durationSeconds: number
  signal?: AbortSignal
}): Promise<ExtractSuccess> {
  const durationSeconds = clampExtractDurationSeconds(input.durationSeconds)
  const url = normalizeYoutubeUrl(input.url)
  const validationError = validateExtractInput({
    url,
    startTimeSeconds: input.startTimeSeconds,
    durationSeconds,
  })
  if (validationError) {
    throw new AudioExtractClientError(validationError, 'invalid_input')
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        startTimeSeconds: input.startTimeSeconds,
        durationSeconds,
      }),
      signal: input.signal,
    })
  } catch (error) {
    if (input.signal?.aborted) throw error
    throw new AudioExtractClientError(networkErrorMessage(), 'network')
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        audioUrl?: string
        durationSeconds?: number
        format?: 'm4a' | 'mp3'
        error?: string
        code?: string
        detail?: { error?: string; code?: string } | string
      }
    | null

  if (!response.ok) {
    const detail =
      typeof payload?.detail === 'object'
        ? payload.detail
        : typeof payload?.detail === 'string'
          ? { error: payload.detail }
          : payload
    throw new AudioExtractClientError(
      detail?.error || payload?.error || 'Audio extraction failed.',
      detail?.code || payload?.code || 'extract_failed',
    )
  }

  if (!payload?.audioUrl) {
    throw new AudioExtractClientError('Extract response missing audio URL.', 'bad_response')
  }

  // Local storage returns absolute http://127.0.0.1:8080/media/... — fine same-machine.
  // If the URL is same-host /media/... relative after rewrite, fetch as-is.
  let audioUrl = payload.audioUrl
  if (import.meta.env.DEV && audioUrl.includes('://127.0.0.1:8080/')) {
    audioUrl = audioUrl.replace(/^https?:\/\/127\.0\.0\.1:8080/, '')
  }

  let audioResponse: Response
  try {
    audioResponse = await fetch(audioUrl, { signal: input.signal })
  } catch (error) {
    if (input.signal?.aborted) throw error
    throw new AudioExtractClientError(
      'Extract succeeded but the audio file could not be downloaded. Is the API still running?',
      'download_failed',
    )
  }
  if (!audioResponse.ok) {
    throw new AudioExtractClientError('Failed to download extracted audio.', 'download_failed')
  }

  const blob = await audioResponse.blob()
  if (blob.size <= 0) {
    throw new AudioExtractClientError('Extracted audio was empty.', 'empty_audio')
  }
  if (blob.size > OVERLAY_AUDIO_MAX_BYTES) {
    throw new AudioExtractClientError('Extracted audio exceeds the 20 MB limit.', 'too_large')
  }

  const format = payload.format === 'mp3' ? 'mp3' : 'm4a'
  return {
    blob,
    durationSeconds: Math.min(
      OVERLAY_AUDIO_MAX_DURATION_S,
      Math.max(1, payload.durationSeconds ?? durationSeconds),
    ),
    format,
  }
}

export { defaultPlacementForClip, overlayFormatFromMime, OVERLAY_AUDIO_MAX_DURATION_S }
