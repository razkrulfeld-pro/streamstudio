/**
 * Retry policy for live device fMP4 when /api/device/stream ends too early
 * (init-only / ffmpeg not ready yet).
 */

export const DEVICE_STREAM_MIN_DURATION_MS = 10_000
export const DEVICE_STREAM_MIN_BYTES = 100_000
export const DEVICE_STREAM_MAX_ATTEMPTS = 8

export function shouldRetryDeviceStream(stats: {
  elapsedMs: number
  bytesReceived: number
}): boolean {
  return (
    stats.elapsedMs < DEVICE_STREAM_MIN_DURATION_MS ||
    stats.bytesReceived < DEVICE_STREAM_MIN_BYTES
  )
}

/** Exponential backoff: 250ms, 500ms, 1s, 2s, … capped at 8s. */
export function deviceStreamBackoffMs(attempt: number): number {
  const exp = Math.max(0, Math.floor(attempt))
  return Math.min(8_000, 250 * 2 ** exp)
}

export function deviceStreamAttemptUrl(baseUrl: string, attempt: number): string {
  const url = new URL(baseUrl, 'http://localhost')
  url.searchParams.set('reconnect', String(attempt))
  url.searchParams.set('t', String(Date.now()))
  // Keep path+query only when base was relative.
  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    return url.toString()
  }
  return `${url.pathname}${url.search}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Read /api/device/stream until it ends or looks healthy enough to keep.
 * Used to detect init-only early closes (under 10s or under 100KB).
 */
export async function monitorDeviceStream(
  url: string,
  signal?: AbortSignal,
): Promise<{ elapsedMs: number; bytesReceived: number; completed: boolean }> {
  const t0 =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const elapsed = () =>
    (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()) - t0

  let bytesReceived = 0
  try {
    const response = await fetch(url, { signal, cache: 'no-store' })
    if (!response.ok || !response.body) {
      return { elapsedMs: elapsed(), bytesReceived: 0, completed: true }
    }
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        return { elapsedMs: elapsed(), bytesReceived, completed: true }
      }
      bytesReceived += value.byteLength
      const elapsedMs = elapsed()
      if (
        elapsedMs >= DEVICE_STREAM_MIN_DURATION_MS &&
        bytesReceived >= DEVICE_STREAM_MIN_BYTES
      ) {
        // Live stream is healthy — cancel further monitoring reads.
        try {
          await reader.cancel()
        } catch {
          // ignore
        }
        return { elapsedMs, bytesReceived, completed: false }
      }
    }
  } catch {
    return { elapsedMs: elapsed(), bytesReceived, completed: true }
  }
}
