/**
 * Drive canvas painting while recording even when the tab is backgrounded.
 *
 * requestAnimationFrame / hidden <video> decode freeze in hidden tabs (and often
 * while recording). Display / camera MediaStreamTracks keep producing frames;
 * MediaStreamTrackProcessor delivers them so we can composite and push into
 * canvas.captureStream(0).
 */

type CanvasCaptureTrack = MediaStreamTrack & { requestFrame?: () => void }

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>
}

export interface CapturePaintSources {
  screen: VideoFrame | null
  camera: VideoFrame | null
}

export function selectCaptureSources(options: {
  latestCamera: VideoFrame | null
  latestCameraAt: number
  latestScreen: VideoFrame | null
  latestScreenAt: number
  now: number
  staleAfterMs?: number
}): CapturePaintSources {
  const staleAfterMs = options.staleAfterMs ?? 500
  return {
    camera:
      options.latestCamera && options.now - options.latestCameraAt <= staleAfterMs
        ? options.latestCamera
        : null,
    screen:
      options.latestScreen && options.now - options.latestScreenAt <= staleAfterMs
        ? options.latestScreen
        : null,
  }
}

function getTrackProcessorCtor(): TrackProcessorCtor | null {
  const ctor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor
  return typeof ctor === 'function' ? ctor : null
}

export function supportsBackgroundCapture(): boolean {
  return Boolean(getTrackProcessorCtor()) && typeof VideoFrame !== 'undefined'
}

export interface RecordingCaptureClock {
  stop: () => void
}

async function pumpTrack(
  reader: ReadableStreamDefaultReader<VideoFrame>,
  onFrame: (frame: VideoFrame) => void,
  isStopped: () => boolean,
): Promise<void> {
  while (!isStopped()) {
    let result: ReadableStreamReadResult<VideoFrame>
    try {
      result = await reader.read()
    } catch {
      break
    }
    if (result.done || isStopped()) {
      result.value?.close()
      break
    }
    onFrame(result.value)
  }
}

/**
 * Paint from live screen and/or camera tracks (not HTMLVideoElement pixels).
 * Prefers the screen track as the cadence driver when both are present.
 */
export function startRecordingCaptureClock(options: {
  screenTrack?: MediaStreamTrack | null
  cameraTrack?: MediaStreamTrack | null
  /** @deprecated use screenTrack / cameraTrack */
  driverTrack?: MediaStreamTrack | null
  paint: (sources: CapturePaintSources) => void
  captureTrack?: CanvasCaptureTrack | null
}): RecordingCaptureClock {
  let stopped = false
  const clonedTracks: MediaStreamTrack[] = []
  const readers: ReadableStreamDefaultReader<VideoFrame>[] = []
  let worker: Worker | null = null
  let latestCamera: VideoFrame | null = null
  let latestScreen: VideoFrame | null = null
  let latestCameraAt = 0
  let latestScreenAt = 0

  const isStopped = () => stopped

  const pushCaptureFrame = () => {
    const track = options.captureTrack
    if (track && typeof track.requestFrame === 'function') {
      track.requestFrame()
    }
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    for (const reader of readers) {
      void reader.cancel().catch(() => undefined)
    }
    readers.length = 0
    worker?.terminate()
    worker = null
    latestCamera?.close()
    latestScreen?.close()
    latestCamera = null
    latestScreen = null
    clonedTracks.forEach((track) => {
      try {
        track.stop()
      } catch {
        // ignore
      }
    })
    clonedTracks.length = 0
  }

  const screenTrack = options.screenTrack ?? null
  const cameraTrack =
    options.cameraTrack ??
    (!screenTrack && options.driverTrack ? options.driverTrack : null) ??
    null
  // If only driverTrack was passed and it was the screen, honor that.
  const resolvedScreen =
    screenTrack ??
    (options.driverTrack && options.driverTrack !== cameraTrack ? options.driverTrack : null)

  const TrackProcessor = getTrackProcessorCtor()
  if (TrackProcessor && typeof VideoFrame !== 'undefined' && (resolvedScreen || cameraTrack)) {
    if (cameraTrack) {
      const processTrack = cameraTrack.clone()
      clonedTracks.push(processTrack)
      const processor = new TrackProcessor({ track: processTrack })
      const reader = processor.readable.getReader()
      readers.push(reader)

      void pumpTrack(
        reader,
        (frame) => {
          latestCamera?.close()
          latestCamera = frame
          latestCameraAt = performance.now()
        },
        isStopped,
      )
    }

    if (resolvedScreen) {
      const processTrack = resolvedScreen.clone()
      clonedTracks.push(processTrack)
      const processor = new TrackProcessor({ track: processTrack })
      const reader = processor.readable.getReader()
      readers.push(reader)

      void pumpTrack(
        reader,
        (frame) => {
          latestScreen?.close()
          latestScreen = frame
          latestScreenAt = performance.now()
        },
        isStopped,
      )
    }
  }

  // An independent cadence keeps stickers/effects moving even if a track
  // processor stalls. Fresh VideoFrames remain background-safe; stale ones
  // fall back to the live HTMLVideoElement sources in the compositor.
  const workerSource = `
    let id = 0;
    self.onmessage = (event) => {
      if (event.data === 'start') {
        clearInterval(id);
        id = setInterval(() => self.postMessage('tick'), 33);
      } else if (event.data === 'stop') {
        clearInterval(id);
      }
    };
  `
  const blob = new Blob([workerSource], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  worker = new Worker(url)
  URL.revokeObjectURL(url)
  worker.onmessage = () => {
    if (stopped) return
    options.paint(
      selectCaptureSources({
        latestCamera,
        latestCameraAt,
        latestScreen,
        latestScreenAt,
        now: performance.now(),
      }),
    )
    pushCaptureFrame()
  }
  worker.postMessage('start')

  return { stop }
}
