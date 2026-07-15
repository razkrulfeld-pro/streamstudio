import { getRecorderMimeType, getRecorderOptions } from '@/lib/recording-output'
import {
  buildTimelineSegments,
  effectiveRecordingGain,
  getEditedDuration,
  type EditorProject,
  type OverlayAudioClip,
} from '@/types/editor-project'

type CanvasCaptureTrack = MediaStreamTrack & { requestFrame?: () => void }

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

async function waitUntilSource(
  video: HTMLVideoElement,
  sourceEnd: number,
  onTick?: (sourceTime: number) => void,
): Promise<void> {
  const deadline =
    performance.now() + Math.max(2, sourceEnd - video.currentTime + 2) * 1000 + 8_000

  await new Promise<void>((resolve) => {
    const tick = () => {
      onTick?.(video.currentTime)
      if (video.currentTime >= sourceEnd - 0.035 || video.ended || performance.now() > deadline) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
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
}

/**
 * Re-encode the recording so kept timeline segments are concatenated with hard cuts,
 * and optional overlay audio is mixed in at its edited-timeline start time.
 *
 * Uses MediaRecorder.pause/resume around seeks plus captureStream(0)+requestFrame so
 * cut gaps are never encoded as frozen frames.
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

  const segments = buildTimelineSegments(project)
  if (segments.length === 0) {
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

  try {
    await waitForEvent(video, 'loadedmetadata')

    let sourceDuration = video.duration
    if (!Number.isFinite(sourceDuration) || sourceDuration === Infinity || sourceDuration <= 0) {
      sourceDuration = Math.max(project.trimEnd, project.trimStart + getEditedDuration(project))
    }

    if (!editRequiresRemux(project, sourceDuration, overlayAudioBlob)) {
      onProgress?.(100)
      return sourceBlob
    }

    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
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

    // Prefer manual frames (captureStream(0)+requestFrame) so idle/seek time isn't encoded.
    // Fall back to 30fps capture when requestFrame is unavailable.
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
    const recorder = new MediaRecorder(combinedStream, getRecorderOptions(mimeType))
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

    const drawVideoFrame = () => {
      ctx.drawImage(video, 0, 0, width, height)
      pushFrame()
    }

    const drawBlackFrame = () => {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)
      pushFrame()
    }

    let drawing = false
    let drawRaf = 0

    const startDrawing = () => {
      drawing = true
      const tick = () => {
        if (!drawing) return
        drawVideoFrame()
        drawRaf = requestAnimationFrame(tick)
      }
      drawRaf = requestAnimationFrame(tick)
    }

    const stopDrawing = () => {
      drawing = false
      cancelAnimationFrame(drawRaf)
    }

    recorder.start(100)
    // Stay paused until the first kept frame is ready so startup seek isn't encoded.
    await setRecorderPaused(recorder, true)

    const editedDuration = Math.max(0.001, getEditedDuration(project))

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!

      // Pause encoding while seeking so cut gaps are not baked as frozen frames.
      await setRecorderPaused(recorder, true)
      syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, segment.timelineStart, false)

      if (segment.kind === 'video') {
        video.pause()
        await seekMedia(video, segment.sourceStart)
        drawVideoFrame()

        await setRecorderPaused(recorder, false)
        startDrawing()
        try {
          await video.play()
        } catch {
          stopDrawing()
          throw new Error('Could not play source video during export.')
        }

        await waitUntilSource(video, segment.sourceEnd, (sourceTime) => {
          const timelinePos = segment.timelineStart + Math.max(0, sourceTime - segment.sourceStart)
          syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, timelinePos, true)
          onProgress?.(Math.min(99, (timelinePos / editedDuration) * 100))
        })

        video.pause()
        stopDrawing()
        syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, segment.timelineEnd, false)
        // Stop encoding before any boundary work so seeks cannot bake freezes.
        await setRecorderPaused(recorder, true)
      } else {
        await setRecorderPaused(recorder, false)
        const startedAt = performance.now()
        const durationMs = Math.max(50, segment.durationS * 1000)

        while (performance.now() - startedAt < durationMs) {
          drawBlackFrame()
          const elapsed = (performance.now() - startedAt) / 1000
          const timelinePos = segment.timelineStart + elapsed
          syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, timelinePos, true)
          onProgress?.(Math.min(99, (timelinePos / editedDuration) * 100))
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }

        syncOverlayToEdited(overlayAudio, bakeOverlay ? clip : null, segment.timelineEnd, false)
        await setRecorderPaused(recorder, true)
      }
    }

    stopDrawing()
    if (overlayAudio && !overlayAudio.paused) overlayAudio.pause()
    if (recorder.state === 'paused') await setRecorderPaused(recorder, false)
    if (recorder.state !== 'inactive') recorder.stop()

    canvasStream.getTracks().forEach((track) => track.stop())
    audioDestination.stream.getTracks().forEach((track) => track.stop())

    const blob = await stopped
    onProgress?.(100)
    return blob
  } finally {
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
