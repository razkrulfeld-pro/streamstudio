/**
 * Keep a progressive live fMP4 <video> near the live edge and react to
 * mid-stream dimension changes (phone rotation).
 */

export type VideoDimensions = { width: number; height: number }

/** How far behind buffered.end we park currentTime (seconds). */
export const DEVICE_LIVE_EDGE_MARGIN_S = 0.1

/**
 * Seek whenever lag exceeds this. Keep tiny so we chase the live edge every
 * tick instead of drifting tens of seconds behind a growing buffer.
 */
export const DEVICE_LIVE_EDGE_SEEK_THRESHOLD_S = 0.05

export function getDeviceStreamBufferedEnd(video: HTMLVideoElement): number | null {
  try {
    const { buffered } = video
    if (!buffered || buffered.length === 0) return null
    return buffered.end(buffered.length - 1)
  } catch {
    return null
  }
}

/**
 * Seek toward the live edge when the element has fallen behind.
 * Returns the lag in seconds before seeking (0 if no seek / unknown).
 */
export function seekDeviceStreamToLiveEdge(
  video: HTMLVideoElement,
  {
    marginS = DEVICE_LIVE_EDGE_MARGIN_S,
    thresholdS = DEVICE_LIVE_EDGE_SEEK_THRESHOLD_S,
  }: { marginS?: number; thresholdS?: number } = {},
): number {
  const end = getDeviceStreamBufferedEnd(video)
  if (end == null || !Number.isFinite(end) || end <= 0) return 0
  const lag = end - video.currentTime
  if (lag < thresholdS) return lag
  const target = Math.max(0, end - marginS)
  try {
    video.currentTime = target
  } catch {
    // Ignore seek errors while the media pipeline is reconfiguring.
  }
  return lag
}

export function readVideoDimensions(video: HTMLVideoElement): VideoDimensions | null {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return null
  return { width, height }
}

export function dimensionsChanged(
  prev: VideoDimensions | null,
  next: VideoDimensions | null,
): boolean {
  if (!prev || !next) return false
  return prev.width !== next.width || prev.height !== next.height
}

/** Prefer phone aspect for the stage when mirroring; fall back to session. */
export function resolveDeviceStageDimensions(
  video: VideoDimensions,
  session: { width: number; height: number },
): { width: number; height: number } {
  const aspect = video.width / video.height
  if (!Number.isFinite(aspect) || aspect <= 0) return session
  const sessionLong = Math.max(session.width, session.height)
  if (aspect >= 1) {
    const width = sessionLong
    const height = Math.max(1, Math.round(width / aspect))
    return { width, height }
  }
  const height = sessionLong
  const width = Math.max(1, Math.round(height * aspect))
  return { width, height }
}

export function dimensionsToAspectLabel(dims: VideoDimensions): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(dims.width, dims.height) || 1
  const w = Math.round(dims.width / g)
  const h = Math.round(dims.height / g)
  // Keep labels readable for near-phone ratios.
  if (Math.abs(w / h - 9 / 16) < 0.05) return '9:16'
  if (Math.abs(w / h - 16 / 9) < 0.05) return '16:9'
  if (Math.abs(w / h - 1) < 0.05) return '1:1'
  return `${w}:${h}`
}

/**
 * Poll + listen for videoWidth/videoHeight changes (rotation).
 * Calls onChange when dimensions change after an initial baseline is set.
 */
export function watchDeviceVideoDimensions(
  video: HTMLVideoElement,
  onChange: (next: VideoDimensions, prev: VideoDimensions) => void,
  { pollMs = 100 }: { pollMs?: number } = {},
): () => void {
  let prev = readVideoDimensions(video)
  let stopped = false

  const check = (source: string) => {
    if (stopped) return
    const next = readVideoDimensions(video)
    if (!next) return
    if (!prev) {
      prev = next
      console.info('[device-stream] dimensions baseline', {
        ...next,
        source,
        wallMs: Math.round(performance.now()),
      })
      return
    }
    if (dimensionsChanged(prev, next)) {
      console.info('[device-stream] dimensions changed', {
        from: prev,
        to: next,
        source,
        wallMs: Math.round(performance.now()),
      })
      const old = prev
      prev = next
      onChange(next, old)
    }
  }

  const onResize = () => check('resize')
  const onLoadedMeta = () => check('loadedmetadata')
  video.addEventListener('resize', onResize)
  video.addEventListener('loadedmetadata', onLoadedMeta)
  const timer = window.setInterval(() => check('poll'), pollMs)
  check('start')

  return () => {
    stopped = true
    video.removeEventListener('resize', onResize)
    video.removeEventListener('loadedmetadata', onLoadedMeta)
    window.clearInterval(timer)
  }
}

export type DeviceLiveEdgeTickResult = {
  lagS: number
  currentTime: number
  bufferedEnd: number | null
  wallMs: number
}

/**
 * One live-edge chase + latency sample. Call from the compositor rAF so we
 * seek every painted frame (not on a slow interval).
 */
export function tickDeviceLiveEdge(
  video: HTMLVideoElement,
  {
    marginS = DEVICE_LIVE_EDGE_MARGIN_S,
    thresholdS = DEVICE_LIVE_EDGE_SEEK_THRESHOLD_S,
  }: { marginS?: number; thresholdS?: number } = {},
): DeviceLiveEdgeTickResult {
  const lagS = seekDeviceStreamToLiveEdge(video, { marginS, thresholdS })
  const bufferedEnd = getDeviceStreamBufferedEnd(video)
  return {
    lagS,
    currentTime: video.currentTime,
    bufferedEnd,
    wallMs: performance.now(),
  }
}

/**
 * Periodically seek a live progressive <video> to the buffered live edge.
 * Prefer {@link tickDeviceLiveEdge} from rAF; this interval is a fallback.
 * Also invokes onStall when playback is waiting with a non-empty buffer.
 */
export function startDeviceLiveEdgeLoop(
  video: HTMLVideoElement,
  {
    intervalMs = 50,
    onStall,
  }: { intervalMs?: number; onStall?: () => void } = {},
): () => void {
  let lastLogAt = 0
  let lastTime = video.currentTime
  let stalledTicks = 0
  const tick = () => {
    const sample = tickDeviceLiveEdge(video)
    const now = sample.wallMs
    if (sample.lagS >= 0.5 || now - lastLogAt > 1000) {
      console.info('[device-stream] live-edge', {
        lagS: Number(sample.lagS.toFixed(3)),
        currentTime: Number(sample.currentTime.toFixed(3)),
        bufferedEnd:
          sample.bufferedEnd == null ? null : Number(sample.bufferedEnd.toFixed(3)),
        wallMs: Math.round(sample.wallMs),
        paused: video.paused,
        readyState: video.readyState,
      })
      lastLogAt = now
    }

    if (onStall && !video.paused) {
      const end = sample.bufferedEnd
      const advanced = video.currentTime > lastTime + 0.01
      lastTime = video.currentTime
      if (end != null && end - video.currentTime > 0.5 && !advanced) {
        stalledTicks += 1
        if (stalledTicks >= 10) {
          stalledTicks = 0
          console.info('[device-stream] playback stall detected; requesting refresh')
          onStall()
        }
      } else {
        stalledTicks = 0
      }
    }
  }
  const timer = window.setInterval(tick, intervalMs)
  tick()
  return () => window.clearInterval(timer)
}
