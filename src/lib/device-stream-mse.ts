/**
 * Live fMP4 via Media Source Extensions — keeps a short buffer and stays on
 * the live edge. Progressive <video src> cannot do this: latency grows with
 * session age (play-from-zero).
 */

import { extractFmp4InitSegment, iterFmp4TopBoxes, parseAvc1CodecFromInit } from './device-stream-fmp4'

/** How much decoded media to retain in the SourceBuffer. */
export const DEVICE_MSE_BUFFER_WINDOW_S = 1.5

/** Seek target: this far behind buffered.end. */
export const DEVICE_MSE_LIVE_MARGIN_S = 0.05

export type DeviceMseLatencySample = {
  wallMs: number
  bufferedEnd: number | null
  currentTime: number
  bufferLagS: number
  bytesAppended: number
}

export type DeviceMseAttachResult = {
  stop: () => void
  mediaSource: MediaSource
}

function bufferedEndOf(video: HTMLVideoElement): number | null {
  try {
    const { buffered } = video
    if (!buffered || buffered.length === 0) return null
    return buffered.end(buffered.length - 1)
  } catch {
    return null
  }
}

function bufferedStartOf(video: HTMLVideoElement): number | null {
  try {
    const { buffered } = video
    if (!buffered || buffered.length === 0) return null
    return buffered.start(0)
  } catch {
    return null
  }
}

/** Evict media older than the live window; seek to the live edge. */
export function trimDeviceMseBuffer(
  video: HTMLVideoElement,
  sourceBuffer: SourceBuffer,
  {
    windowS = DEVICE_MSE_BUFFER_WINDOW_S,
    marginS = DEVICE_MSE_LIVE_MARGIN_S,
  }: { windowS?: number; marginS?: number } = {},
): number {
  const end = bufferedEndOf(video)
  if (end == null || !Number.isFinite(end)) return 0
  const start = bufferedStartOf(video)
  if (
    start != null &&
    end - start > windowS &&
    !sourceBuffer.updating &&
    video.readyState > 0
  ) {
    const removeEnd = Math.max(start, end - windowS)
    if (removeEnd > start + 0.05) {
      try {
        sourceBuffer.remove(start, removeEnd)
      } catch {
        // SourceBuffer may reject overlapping removes while appending.
      }
    }
  }
  const lag = end - video.currentTime
  const target = Math.max(0, end - marginS)
  if (lag > marginS + 0.02) {
    try {
      video.currentTime = target
    } catch {
      // Ignore seek races during SourceBuffer updates.
    }
  }
  return lag
}

/**
 * Fetch a live fMP4 URL into a MediaSource attached to `video`.
 * Only the latest ~1.5s of media is retained — latency cannot grow with session age.
 */
export async function attachDeviceStreamViaMse(
  video: HTMLVideoElement,
  url: string,
  {
    signal,
    onLatency,
  }: {
    signal?: AbortSignal
    onLatency?: (sample: DeviceMseLatencySample) => void
  } = {},
): Promise<DeviceMseAttachResult> {
  if (typeof MediaSource === 'undefined') {
    throw new Error('MediaSource is not available in this browser')
  }

  video.pause()
  video.removeAttribute('src')
  video.srcObject = null
  video.load()

  const mediaSource = new MediaSource()
  const objectUrl = URL.createObjectURL(mediaSource)
  video.src = objectUrl

  const waitOpen = new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      mediaSource.removeEventListener('sourceopen', onOpen)
      resolve()
    }
    const onErr = () => {
      mediaSource.removeEventListener('sourceopen', onOpen)
      reject(new Error('MediaSource failed to open'))
    }
    mediaSource.addEventListener('sourceopen', onOpen, { once: true })
    mediaSource.addEventListener('error', onErr, { once: true })
    signal?.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    )
  })

  await waitOpen

  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    headers: { Accept: 'video/mp4' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`Device stream HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  let pending = new Uint8Array(0)
  let init: Uint8Array | null = null
  let initBytes = 0
  let sourceBuffer: SourceBuffer | null = null
  let bytesAppended = 0
  let stopped = false
  let appendChain: Promise<void> = Promise.resolve()
  let lastLatencyLog = 0

  const stop = () => {
    stopped = true
    try {
      reader.cancel().catch(() => undefined)
    } catch {
      // ignore
    }
    try {
      if (mediaSource.readyState === 'open') {
        mediaSource.endOfStream()
      }
    } catch {
      // ignore
    }
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }

  signal?.addEventListener('abort', stop, { once: true })

  const enqueueAppend = (chunk: Uint8Array) => {
    const sb = sourceBuffer
    if (!sb || stopped) return
    appendChain = appendChain.then(async () => {
      if (!sourceBuffer || stopped) return
      const buf = sourceBuffer
      if (buf.updating) {
        await new Promise<void>((resolve) => {
          const done = () => {
            buf.removeEventListener('updateend', done)
            resolve()
          }
          buf.addEventListener('updateend', done)
        })
      }
      if (stopped || sourceBuffer !== buf) return
      try {
        const copy = new Uint8Array(chunk.byteLength)
        copy.set(chunk)
        buf.appendBuffer(copy)
        bytesAppended += chunk.byteLength
        await new Promise<void>((resolve) => {
          const done = () => {
            buf.removeEventListener('updateend', done)
            resolve()
          }
          buf.addEventListener('updateend', done)
        })
      } catch (err) {
        console.warn('[device-stream-mse] appendBuffer failed', err)
        return
      }
      if (stopped || sourceBuffer !== buf) return
      const lag = trimDeviceMseBuffer(video, buf)
      const end = bufferedEndOf(video)
      const now = performance.now()
      if (onLatency && now - lastLatencyLog > 1000) {
        lastLatencyLog = now
        onLatency({
          wallMs: now,
          bufferedEnd: end,
          currentTime: video.currentTime,
          bufferLagS: lag,
          bytesAppended,
        })
      }
      if (video.paused && end != null && end > 0) {
        await video.play().catch(() => undefined)
      }
    })
  }

  // Pump the HTTP body on a background task.
  void (async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.byteLength === 0) continue

        const merged = new Uint8Array(pending.byteLength + value.byteLength)
        merged.set(pending, 0)
        merged.set(value, pending.byteLength)
        pending = merged

        if (!init) {
          const split = extractFmp4InitSegment(pending)
          if (!split) continue
          init = split.init
          initBytes = init.byteLength
          pending = new Uint8Array(split.rest)
          const codec = parseAvc1CodecFromInit(init) ?? 'avc1.64001f'
          const mime = `video/mp4; codecs="${codec}"`
          if (!MediaSource.isTypeSupported(mime)) {
            throw new Error(`MSE does not support ${mime}`)
          }
          sourceBuffer = mediaSource.addSourceBuffer(mime)
          sourceBuffer.mode = 'segments'
          enqueueAppend(init)
          console.info('[device-stream-mse] init appended', {
            codec,
            initBytes,
            wallMs: Math.round(performance.now()),
          })
        }

        // Emit complete top-level boxes (moof/mdat pairs) as they arrive.
        while (true) {
          const boxes = iterFmp4TopBoxes(pending)
          if (boxes.length === 0) break
          const last = boxes[boxes.length - 1]
          if (last.offset + last.size > pending.byteLength) {
            // Incomplete trailing box — wait for more bytes.
            const completeUntil = last.offset
            if (completeUntil <= 0) break
            const ready = pending.subarray(0, completeUntil)
            pending = pending.subarray(completeUntil)
            if (ready.byteLength > 0) enqueueAppend(ready)
            break
          }
          // All boxes complete.
          enqueueAppend(pending)
          pending = new Uint8Array(0)
          break
        }
      }
    } catch (err) {
      if (!stopped && !(err instanceof DOMException && err.name === 'AbortError')) {
        console.warn('[device-stream-mse] stream pump failed', err)
      }
    }
  })()

  // Wait until we have appended init + some media (or abort).
  const readyDeadline = Date.now() + 20_000
  while (Date.now() < readyDeadline && !stopped) {
    if (init && bytesAppended > initBytes + 1000) {
      await video.play().catch(() => undefined)
      if (sourceBuffer) trimDeviceMseBuffer(video, sourceBuffer)
      return { stop, mediaSource }
    }
    await new Promise((r) => setTimeout(r, 50))
    if (signal?.aborted) {
      stop()
      throw new DOMException('Aborted', 'AbortError')
    }
  }

  // Init alone is enough to consider attached; media may still be priming.
  if (init) {
    await video.play().catch(() => undefined)
    return { stop, mediaSource }
  }

  stop()
  throw new Error('Timed out waiting for fMP4 init segment')
}
