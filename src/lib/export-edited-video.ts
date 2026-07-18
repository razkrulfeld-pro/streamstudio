import { getRecorderMimeType, getRecorderOptions } from '@/lib/recording-output'
import { needsSourceSeek, resolveExportCanvasSize } from '@/lib/export-cutout-helpers'
import {
  buildExportPlan,
  effectiveRecordingGain,
  getEditedDuration,
  type EditorProject,
  type OverlayAudioClip,
} from '@/types/editor-project'

type CanvasCaptureTrack = MediaStreamTrack & { requestFrame?: () => void }

export { resolveExportCanvasSize } from '@/lib/export-cutout-helpers'

function waitForEvent(target: EventTarget, event: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      target.removeEventListener(event, onEvent)
      reject(new Error(`Timed out waiting for ${event}`))
    }, timeoutMs)

    const onEvent = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      target.removeEventListener(event, onEvent)
      resolve()
    }

    target.addEventListener(event, onEvent)
  })
}

async function seekMedia(media: HTMLMediaElement, time: number): Promise<void> {
  const target = Math.max(0, time)
  if (Math.abs(media.currentTime - target) < 0.035) {
    media.currentTime = target
    return
  }
  media.currentTime = target
  try {
    await waitForEvent(media, 'seeked', 20_000)
  } catch {
    // Some WebM/audio files never fire seeked reliably; continue with best effort.
  }
}

/** Wait until the video has a decoded frame near the seek target. */
async function waitForDecodedFrame(
  video: HTMLVideoElement,
  targetTime: number,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs

  // Nudge decode by briefly playing if we are paused after a seek.
  const wasPaused = video.paused
  if (wasPaused) {
    try {
      await video.play()
    } catch {
      // ignore autoplay restrictions during export helpers
    }
  }

  while (performance.now() < deadline) {
    if (video.readyState >= 2 && Math.abs(video.currentTime - targetTime) < 0.35) {
      if (wasPaused) video.pause()
      return
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 16)
    })
  }

  if (wasPaused) video.pause()
}

function createExportClock(onTick: () => void): { start: () => void; stop: () => void } {
  let worker: Worker | null = null
  let stopped = true

  return {
    start() {
      stopped = false
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
        if (!stopped) onTick()
      }
      worker.postMessage('start')
    },
    stop() {
      stopped = true
      worker?.postMessage('stop')
      worker?.terminate()
      worker = null
    },
  }
}

async function waitUntilSource(
  video: HTMLVideoElement,
  sourceEnd: number,
  onTick?: (sourceTime: number) => void,
): Promise<void> {
  const deadline =
    performance.now() + Math.max(2, sourceEnd - video.currentTime + 2) * 1000 + 8_000

  await new Promise<void>((resolve) => {
    const check = () => {
      onTick?.(video.currentTime)
      if (video.currentTime >= sourceEnd - 0.035 || video.ended || performance.now() > deadline) {
        resolve()
        return
      }
      window.setTimeout(check, 16)
    }
    check()
  })
}

async function setRecorderPaused(recorder: MediaRecorder, paused: boolean): Promise<void> {
  const supportsPause = typeof recorder.pause === 'function' && typeof recorder.resume === 'function'
  if (!supportsPause) return

  if (paused) {
    if (recorder.state === 'recording') {
      recorder.pause()
      await waitForEvent(recorder, 'pause', 5_000).catch(() => undefined)
    }
    return
  }

  if (recorder.state === 'paused') {
    recorder.resume()
    await waitForEvent(recorder, 'resume', 5_000).catch(() => undefined)
  }
}

function hasOverlayToBake(
  project: EditorProject,
  overlayAudioBlob?: Blob | null,
): overlayAudioBlob is Blob {
  const clip = project.overlayAudio
  return Boolean(
    overlayAudioBlob &&
      overlayAudioBlob.size > 0 &&
      clip &&
      !clip.muted &&
      clip.durationS > 0.05 &&
      clip.volume > 0,
  )
}

/** True when publish must re-encode so trim/cuts/black frames/overlay audio appear in the file. */
export function editRequiresRemux(
  project: EditorProject,
  sourceDuration: number,
  overlayAudioBlob?: Blob | null,
): boolean {
  if (project.cuts.length > 0) return true
  if (project.blackFrames.length > 0) return true
  if (project.trimStart > 0.05) return true
  if (Number.isFinite(sourceDuration) && sourceDuration > 0 && project.trimEnd < sourceDuration - 0.05) {
    return true
  }
  if (hasOverlayToBake(project, overlayAudioBlob)) return true
  return false
}

function syncOverlayToEdited(
  audio: HTMLAudioElement | null,
  clip: OverlayAudioClip | null,
  editedTime: number,
  playing: boolean,
): void {
  if (!audio || !clip) return

  const start = Number(clip.startAtEditedS) || 0
  const end = start + Math.max(0.05, Number(clip.durationS) || 0)

  if (editedTime < start - 0.01 || editedTime >= end || clip.muted) {
    if (!audio.paused) audio.pause()
    return
  }

  const offset = Math.min(
    Math.max(0, editedTime - start),
    Math.max(0, clip.sourceDurationS || clip.durationS || 0),
  )
  if (Math.abs(audio.currentTime - offset) > 0.12) {
    try {
      audio.currentTime = offset
    } catch {
      // ignore seek errors on short buffers
    }
  }

  audio.volume = 1
  if (playing) {
    if (audio.paused) void audio.play().catch(() => undefined)
  } else if (!audio.paused) {
    audio.pause()
  }
}

export interface ExportEditedVideoOptions {
  overlayAudioBlob?: Blob | null
  onProgress?: (percent: number) => void
  /** Session aspect (e.g. 9:16) used when the browser hasn't decoded video size yet. */
  aspectRatio?: string
}

/**
 * Re-encode the recording so kept timeline segments are concatenated with hard cuts,
 * and optional overlay audio is mixed in at its edited-timeline start time.
 *
 * Cut-outs are applied by pausing the encoder while source playback continues through
 * the removed range (no WebM seek across the gap). That prevents freeze frames and
 * accidentally baking cut footage into the upload.
 */
export async function exportEditedVideo(
  sourceBlob: Blob,
  project: EditorProject,
  onProgressOrOptions?: ((percent: number) => void) | ExportEditedVideoOptions,
  maybeOptions?: ExportEditedVideoOptions,
): Promise<Blob> {
  const options: ExportEditedVideoOptions =
    typeof onProgressOrOptions === 'function'
      ? { onProgress: onProgressOrOptions, ...maybeOptions }
      : { ...onProgressOrOptions }
  const onProgress = options.onProgress
  const overlayAudioBlob = options.overlayAudioBlob ?? null

  const plan = buildExportPlan(project)
  if (plan.length === 0) {
    throw new Error('Nothing to export after cuts and trims.')
  }

  const objectUrl = URL.createObjectURL(sourceBlob)
  const video = document.createElement('video')
  video.playsInline = true
  video.preload = 'auto'
  video.muted = false
  video.src = objectUrl

  let audioContext: AudioContext | null = null
  let overlayUrl: string | null = null
  let overlayAudio: HTMLAudioElement | null = null
  const exportClockRef: { current: { start: () => void; stop: () => void } | null } = {
    current: null,
  }

  try {
    await waitForEvent(video, 'loadedmetadata')

    // Some WebM Shorts report 0×0 until a frame is decoded.
    if (!video.videoWidth || !video.videoHeight) {
      try {
        await video.play()
        await waitForDecodedFrame(video, 0)
        video.pause()
      } catch {
        // Fall through to aspect-ratio sized canvas.
      }
    }

    let sourceDuration = video.duration
    if (!Number.isFinite(sourceDuration) || sourceDuration === Infinity || sourceDuration <= 0) {
      sourceDuration = Math.max(project.trimEnd, project.trimStart + getEditedDuration(project))
    }

    if (!editRequiresRemux(project, sourceDuration, overlayAudioBlob)) {
      onProgress?.(100)
      return sourceBlob
    }

    const { width, height } = resolveExportCanvasSize(
      video.videoWidth,
      video.videoHeight,
      options.aspectRatio,
    )
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create export canvas.')

    audioContext = new AudioContext()
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => undefined)
    }

    const audioDestination = audioContext.createMediaStreamDestination()
    const recordingGain = audioContext.createGain()
    recordingGain.gain.value = effectiveRecordingGain(project)
    const elementSource = audioContext.createMediaElementSource(video)
    elementSource.connect(recordingGain)
    recordingGain.connect(audioDestination)

    const clip = project.overlayAudio
    const bakeOverlay = hasOverlayToBake(project, overlayAudioBlob)
    let overlayGain: GainNode | null = null

    if (bakeOverlay && clip) {
      overlayUrl = URL.createObjectURL(overlayAudioBlob)
      overlayAudio = document.createElement('audio')
      overlayAudio.preload = 'auto'
      overlayAudio.src = overlayUrl
      await waitForEvent(overlayAudio, 'loadedmetadata').catch(() => undefined)

      overlayGain = audioContext.createGain()
      overlayGain.gain.value = Math.min(1, Math.max(0, clip.volume))
      const overlaySource = audioContext.createMediaElementSource(overlayAudio)
      overlaySource.connect(overlayGain)
      overlayGain.connect(audioDestination)
    }

    const probeTrack = document.createElement('canvas').captureStream(0).getVideoTracks()[0] as
      | CanvasCaptureTrack
      | undefined
    const supportsManualFrames = typeof probeTrack?.requestFrame === 'function'
    probeTrack?.stop()

    const canvasStream = canvas.captureStream(supportsManualFrames ? 0 : 30)
    const videoTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureTrack | undefined
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ])

    const mimeType = getRecorderMimeType()
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(
      combinedStream,
      getRecorderOptions(mimeType, { width: canvas.width, height: canvas.height }),
    )
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Export recorder failed.'))
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }))
    })

    const pushFrame = () => {
      if (videoTrack && typeof videoTrack.requestFrame === 'function') {
        videoTrack.requestFrame()
      }
    }

    let paintMode: 'video' | 'black' | 'idle' = 'idle'

    const drawVideoFrame = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, width, height)
      }
      pushFrame()
    }

    const drawBlackFrame = () => {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)
      pushFrame()
    }

    const stopExportClock = () => {
      exportClockRef.current?.stop()
      exportClockRef.current = null
      paintMode = 'idle'
    }

    const startExportClock = (mode: 'video' | 'black') => {
      stopExportClock()
      paintMode = mode
      // Worker clock (not RAF) so background-tab throttling cannot freeze encodes.
      exportClockRef.current = createExportClock(() => {
        if (paintMode === 'video') drawVideoFrame()
        else if (paintMode === 'black') drawBlackFrame()
      })
      exportClockRef.current.start()
    }

    recorder.start(100)
    await setRecorderPaused(recorder, true)

    const editedDuration = Math.max(0.001, getEditedDuration(project))
    const firstSource =
      plan.find((step) => step.kind === 'video' || step.kind === 'cut')?.sourceStart ??
      project.trimStart

    if (needsSourceSeek(video.currentTime, firstSource)) {
      video.pause()
      await seekMedia(video, firstSource)
      await waitForDecodedFrame(video, firstSource)
    }

    for (const step of plan) {
      if (step.kind === 'video') {
        await setRecorderPaused(recorder, true)
        stopExportClock()
        syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, step.timelineStart, false)

        if (needsSourceSeek(video.currentTime, step.sourceStart)) {
          video.pause()
          await seekMedia(video, step.sourceStart)
          await waitForDecodedFrame(video, step.sourceStart)
        }

        drawVideoFrame()
        await setRecorderPaused(recorder, false)
        startExportClock('video')

        try {
          await video.play()
        } catch {
          stopExportClock()
          throw new Error('Could not play source video during export.')
        }

        await waitUntilSource(video, step.sourceEnd, (sourceTime) => {
          const timelinePos = step.timelineStart + Math.max(0, sourceTime - step.sourceStart)
          syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, timelinePos, true)
          onProgress?.(Math.min(99, (timelinePos / editedDuration) * 100))
        })

        // Pause encoder before any cut/black/next seek so the last kept frame is not held.
        await setRecorderPaused(recorder, true)
        stopExportClock()
        syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, step.timelineEnd, false)
        continue
      }

      if (step.kind === 'cut') {
        // Critical: keep encoder paused and play through the removed range.
        // Seeking across WebM cut gaps is what produced freezes + kept cut footage.
        await setRecorderPaused(recorder, true)
        stopExportClock()
        recordingGain.gain.value = 0

        if (needsSourceSeek(video.currentTime, step.sourceStart)) {
          video.pause()
          await seekMedia(video, step.sourceStart)
          await waitForDecodedFrame(video, step.sourceStart)
        }

        try {
          await video.play()
        } catch {
          recordingGain.gain.value = effectiveRecordingGain(project)
          throw new Error('Could not play source video while skipping a cut-out.')
        }

        await waitUntilSource(video, step.sourceEnd)
        video.pause()
        recordingGain.gain.value = effectiveRecordingGain(project)
        continue
      }

      // Black frame insert — encoder runs, source is held.
      await setRecorderPaused(recorder, true)
      stopExportClock()
      video.pause()
      syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, step.timelineStart, false)

      if (needsSourceSeek(video.currentTime, step.holdSourceTime)) {
        await seekMedia(video, step.holdSourceTime)
        await waitForDecodedFrame(video, step.holdSourceTime)
      }

      await setRecorderPaused(recorder, false)
      const startedAt = performance.now()
      const durationMs = Math.max(50, step.durationS * 1000)
      startExportClock('black')

      while (performance.now() - startedAt < durationMs) {
        const elapsed = (performance.now() - startedAt) / 1000
        const timelinePos = step.timelineStart + elapsed
        syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, timelinePos, true)
        onProgress?.(Math.min(99, (timelinePos / editedDuration) * 100))
        await new Promise<void>((resolve) => window.setTimeout(resolve, 16))
      }

      stopExportClock()
      syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, step.timelineEnd, false)
      await setRecorderPaused(recorder, true)
    }

    stopExportClock()
    video.pause()
    if (overlayAudio && !overlayAudio.paused) overlayAudio.pause()
    if (recorder.state === 'paused') await setRecorderPaused(recorder, false)
    if (recorder.state !== 'inactive') recorder.stop()

    canvasStream.getTracks().forEach((track) => track.stop())
    audioDestination.stream.getTracks().forEach((track) => track.stop())

    const blob = await stopped
    onProgress?.(100)
    return blob
  } finally {
    exportClockRef.current?.stop()
    exportClockRef.current = null
    if (overlayAudio) {
      overlayAudio.pause()
      overlayAudio.removeAttribute('src')
      overlayAudio.load()
    }
    if (overlayUrl) URL.revokeObjectURL(overlayUrl)
    if (audioContext) {
      await audioContext.close().catch(() => undefined)
    }
    URL.revokeObjectURL(objectUrl)
    video.removeAttribute('src')
    video.load()
  }
}
