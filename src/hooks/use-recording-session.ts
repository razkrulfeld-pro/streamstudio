import { useAssetLibrary } from '@/context/asset-library-context'
import { useRecordings } from '@/context/recordings-context'
import { useSettings } from '@/context/settings-context'
import { acquireMediaStream, stopMediaStream } from '@/lib/media-devices'
import { formatRecordedDate } from '@/lib/format'
import { resolveBackgroundVideoUrl, syncBackgroundGif, syncBackgroundImageElement, isAnimatedGifBackground } from '@/lib/background-assets'
import {
  startRecordingCaptureClock,
  supportsBackgroundCapture,
  type CapturePaintSources,
  type RecordingCaptureClock,
} from '@/lib/recording-capture-clock'
import { renderRecordingFrame } from '@/lib/recording-frame'
import {
  applySegmentationMask,
  composeBlurOnlyBackground,
  getCameraSegmenter,
  resetSegmentationSmoothing,
  segmentCameraFrame,
  type SegmentationMaskSnapshot,
} from '@/lib/camera-segmentation'
import {
  pickCameraBackground,
  saveLastCameraBackground,
} from '@/lib/recording-layout-storage'
import {
  beginRecordingAudioMix,
  endRecordingAudioMix,
  setMicCaptureEnabled,
  setScreenAudioCaptureEnabled,
} from '@/lib/effects-library'
import type { FloatingSticker } from '@/lib/floating-stickers'
import {
  getRecorderMimeType,
  getRecorderOptions,
  YOUTUBE_OUTPUT_HEIGHT,
  YOUTUBE_OUTPUT_WIDTH,
} from '@/lib/recording-output'
import { generateThumbnail } from '@/lib/recording-storage'
import { AnimatedGifPlayer } from '@/lib/animated-gif-player'
import {
  defaultCameraLayout,
  defaultScreenShareLayout,
  normalizeScreenShareLayout,
  type CameraLayoutSettings,
  type ScreenShareLayoutSettings,
} from '@/types/recording-layout'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useNavigate } from 'react-router-dom'

function createInitialCameraLayout(): CameraLayoutSettings {
  return { ...defaultCameraLayout }
}

export function useRecordingSession(options?: {
  stickersRef?: MutableRefObject<FloatingSticker[]>
}) {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const { addDraftRecording } = useRecordings()
  const { assets } = useAssetLibrary()

  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const cameraBgVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const compositorFrameRef = useRef(0)
  const captureClockRef = useRef<RecordingCaptureClock | null>(null)
  const canvasCaptureTrackRef = useRef<(MediaStreamTrack & { requestFrame?: () => void }) | null>(
    null,
  )
  const recordingVideoModeRef = useRef<'canvas' | 'direct-screen'>('canvas')
  const cameraBgImageRef = useRef<HTMLImageElement | null>(null)
  const screenBgImageRef = useRef<HTMLImageElement | null>(null)
  const cameraBgGifRef = useRef<AnimatedGifPlayer | null>(null)
  const screenBgGifRef = useRef<AnimatedGifPlayer | null>(null)
  const screenBgVideoRef = useRef<HTMLVideoElement | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const segmentedPersonCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const blurredBackgroundCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const segmentationMaskRef = useRef<SegmentationMaskSnapshot | null>(null)
  const visualStateRef = useRef({
    cameraEnabled: true,
    screenShareEnabled: false,
    effectId: 'fx-none',
    cameraLayout: createInitialCameraLayout(),
    screenShareLayout: normalizeScreenShareLayout(defaultScreenShareLayout),
    mirrorCamera: true,
  })
  const isRecordingRef = useRef(false)

  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)
  const [micAudioEnabled, setMicAudioEnabled] = useState(true)
  const [screenAudioEnabled, setScreenAudioEnabled] = useState(true)
  const [screenAudioAvailable, setScreenAudioAvailable] = useState(false)
  const micAudioEnabledRef = useRef(true)
  const screenAudioEnabledRef = useRef(true)
  const [cameraLayout, setCameraLayoutState] = useState<CameraLayoutSettings>(createInitialCameraLayout)
  const [screenShareLayout, setScreenShareLayoutState] = useState<ScreenShareLayoutSettings>(() =>
    normalizeScreenShareLayout(defaultScreenShareLayout),
  )
  const [effectId, setEffectId] = useState('fx-none')
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setCameraLayout = useCallback((patch: Partial<CameraLayoutSettings>) => {
    setCameraLayoutState((current) => {
      const next = { ...current, ...patch }
      if (
        'backgroundType' in patch ||
        'backgroundMaterialId' in patch ||
        'backgroundAssetId' in patch ||
        'backgroundColor' in patch ||
        'backgroundGradient' in patch
      ) {
        saveLastCameraBackground(pickCameraBackground(next))
      }
      return next
    })
  }, [])

  const setScreenShareLayout = useCallback((patch: Partial<ScreenShareLayoutSettings>) => {
    setScreenShareLayoutState((current) => normalizeScreenShareLayout({ ...current, ...patch }))
  }, [])

  const connectCamera = useCallback(async () => {
    setIsConnecting(true)
    setError(null)

    stopMediaStream(cameraStreamRef.current)
    cameraStreamRef.current = null

    try {
      const stream = await acquireMediaStream(settings.camera, { video: true, audio: true })
      cameraStreamRef.current = stream

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream
        await cameraVideoRef.current.play().catch(() => undefined)
      }

      stream.getAudioTracks().forEach((track) => {
        track.enabled = micAudioEnabledRef.current
      })
      setMicCaptureEnabled(micAudioEnabledRef.current)
      setCameraEnabled(true)
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Unable to connect camera.')
      setCameraEnabled(false)
    } finally {
      setIsConnecting(false)
    }
  }, [settings.camera])

  useEffect(() => {
    void connectCamera()

    return () => {
      stopMediaStream(cameraStreamRef.current)
      stopMediaStream(screenStreamRef.current)
      cancelAnimationFrame(compositorFrameRef.current)
    }
  }, [connectCamera])

  useEffect(() => {
    const image = cameraBgImageRef.current
    if (!image || cameraLayout.backgroundType !== 'image') {
      cameraBgGifRef.current?.dispose()
      cameraBgGifRef.current = null
      if (image) image.removeAttribute('src')
      return
    }

    if (isAnimatedGifBackground(cameraLayout, assets)) {
      image.removeAttribute('src')
      return syncBackgroundGif(cameraLayout, assets, (player) => {
        cameraBgGifRef.current?.dispose()
        cameraBgGifRef.current = player
      })
    }

    cameraBgGifRef.current?.dispose()
    cameraBgGifRef.current = null
    return syncBackgroundImageElement(image, cameraLayout, assets)
  }, [
    cameraLayout.backgroundType,
    cameraLayout.backgroundAssetId,
    cameraLayout.backgroundMaterialId,
    cameraLayout.backgroundSourceUrl,
    assets,
  ])

  useEffect(() => {
    const bgVideo = cameraBgVideoRef.current
    const videoUrl = resolveBackgroundVideoUrl(cameraLayout, assets)

    if (!bgVideo || !videoUrl) {
      if (bgVideo) {
        bgVideo.pause()
        bgVideo.removeAttribute('src')
      }
      return
    }

    bgVideo.crossOrigin = 'anonymous'
    bgVideo.src = videoUrl
    bgVideo.loop = true
    bgVideo.muted = true
    void bgVideo.play().catch(() => undefined)
  }, [
    cameraLayout.backgroundType,
    cameraLayout.backgroundAssetId,
    cameraLayout.backgroundSourceUrl,
    assets,
  ])

  useEffect(() => {
    const image = screenBgImageRef.current
    if (!image || screenShareLayout.backgroundType !== 'image') {
      screenBgGifRef.current?.dispose()
      screenBgGifRef.current = null
      if (image) image.removeAttribute('src')
      return
    }

    if (isAnimatedGifBackground(screenShareLayout, assets)) {
      image.removeAttribute('src')
      return syncBackgroundGif(screenShareLayout, assets, (player) => {
        screenBgGifRef.current?.dispose()
        screenBgGifRef.current = player
      })
    }

    screenBgGifRef.current?.dispose()
    screenBgGifRef.current = null
    return syncBackgroundImageElement(image, screenShareLayout, assets)
  }, [
    screenShareLayout.backgroundType,
    screenShareLayout.backgroundAssetId,
    screenShareLayout.backgroundMaterialId,
    screenShareLayout.backgroundSourceUrl,
    assets,
  ])

  useEffect(() => {
    const bgVideo = screenBgVideoRef.current
    const videoUrl = resolveBackgroundVideoUrl(screenShareLayout, assets)

    if (!bgVideo || !videoUrl) {
      if (bgVideo) {
        bgVideo.pause()
        bgVideo.removeAttribute('src')
      }
      return
    }

    bgVideo.crossOrigin = 'anonymous'
    bgVideo.src = videoUrl
    bgVideo.loop = true
    bgVideo.muted = true
    void bgVideo.play().catch(() => undefined)
  }, [
    screenShareLayout.backgroundType,
    screenShareLayout.backgroundAssetId,
    screenShareLayout.backgroundSourceUrl,
    assets,
  ])

  useEffect(() => {
    segmentedPersonCanvasRef.current = document.createElement('canvas')
    blurredBackgroundCanvasRef.current = document.createElement('canvas')
    void getCameraSegmenter().catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true

    const runSegmentation = async () => {
      if (!active) return

      const video = cameraVideoRef.current
      const needsSegmentation = cameraEnabled && cameraLayout.backgroundType !== 'none'

      if (needsSegmentation && video && video.readyState >= 2) {
        try {
          const mask = await segmentCameraFrame(video, performance.now())
          if (mask && active) {
            segmentationMaskRef.current = mask
          }
        } catch {
          // Model may still be loading on first use.
        }
      } else {
        segmentationMaskRef.current = null
        resetSegmentationSmoothing()
      }

      window.setTimeout(() => {
        void runSegmentation()
      }, 33)
    }

    void runSegmentation()

    return () => {
      active = false
      segmentationMaskRef.current = null
      resetSegmentationSmoothing()
    }
  }, [cameraEnabled, cameraLayout.backgroundType])

  useEffect(() => {
    visualStateRef.current = {
      cameraEnabled,
      screenShareEnabled,
      effectId,
      cameraLayout,
      screenShareLayout,
      mirrorCamera: settings.camera.mirrorVideo,
    }
  }, [
    cameraEnabled,
    screenShareEnabled,
    effectId,
    cameraLayout,
    screenShareLayout,
    settings.camera.mirrorVideo,
  ])

  const paintCompositorFrame = useCallback((sources: CapturePaintSources | null = null) => {
    const canvas = canvasRef.current
    const cameraVideo = cameraVideoRef.current
    const screenVideo = screenVideoRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    if (canvas.width !== YOUTUBE_OUTPUT_WIDTH || canvas.height !== YOUTUBE_OUTPUT_HEIGHT) {
      canvas.width = YOUTUBE_OUTPUT_WIDTH
      canvas.height = YOUTUBE_OUTPUT_HEIGHT
    }

    const {
      cameraEnabled: camOn,
      screenShareEnabled: screenOn,
      effectId: fx,
      cameraLayout: camLayout,
      screenShareLayout: screenLayout,
      mirrorCamera,
    } = visualStateRef.current

    // Prefer live track VideoFrames while recording — hidden <video> pixels often freeze.
    const cameraSource: CanvasImageSource | null = sources?.camera ?? cameraVideo
    const screenSource: CanvasImageSource | null = sources?.screen ?? screenVideo

    const { width, height } = canvas
    let segmentedPersonCanvas: HTMLCanvasElement | null = null
    let blurredBackgroundCanvas: HTMLCanvasElement | null = null

    if (
      cameraSource &&
      camLayout.backgroundType !== 'none' &&
      segmentationMaskRef.current &&
      segmentedPersonCanvasRef.current
    ) {
      const segmentedContext = segmentedPersonCanvasRef.current.getContext('2d')
      if (segmentedContext) {
        applySegmentationMask(segmentedContext, cameraSource, segmentationMaskRef.current)
        segmentedPersonCanvas = segmentedPersonCanvasRef.current

        if (camLayout.backgroundType === 'blur' && blurredBackgroundCanvasRef.current) {
          composeBlurOnlyBackground(
            blurredBackgroundCanvasRef.current,
            cameraSource,
            segmentationMaskRef.current,
          )
          blurredBackgroundCanvas = blurredBackgroundCanvasRef.current
        }
      }
    }

    renderRecordingFrame({
      context,
      width,
      height,
      effectId: fx,
      cameraEnabled: camOn,
      screenShareEnabled: screenOn,
      cameraSource,
      screenSource,
      cameraLayout: camLayout,
      screenShareLayout: screenLayout,
      cameraBackgroundAssets: {
        image: cameraBgImageRef.current,
        gif: cameraBgGifRef.current
          ? {
              canvas: cameraBgGifRef.current.canvas,
              render: (timeMs: number) => cameraBgGifRef.current?.render(timeMs),
              isReady: cameraBgGifRef.current.isReady,
            }
          : null,
        video: cameraBgVideoRef.current,
        blurredBackground: blurredBackgroundCanvas,
      },
      screenBackgroundAssets: {
        image: screenBgImageRef.current,
        gif: screenBgGifRef.current
          ? {
              canvas: screenBgGifRef.current.canvas,
              render: (timeMs: number) => screenBgGifRef.current?.render(timeMs),
              isReady: screenBgGifRef.current.isReady,
            }
          : null,
        video: screenBgVideoRef.current,
        blurredBackground: null,
      },
      mirrorCamera,
      segmentedPersonCanvas,
      floatingStickers: options?.stickersRef?.current ?? [],
    })
  }, [options?.stickersRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      if (canvas.width !== YOUTUBE_OUTPUT_WIDTH || canvas.height !== YOUTUBE_OUTPUT_HEIGHT) {
        canvas.width = YOUTUBE_OUTPUT_WIDTH
        canvas.height = YOUTUBE_OUTPUT_HEIGHT
      }
    }

    resize()

    const resizeObserver = new ResizeObserver(() => {
      resize()
    })

    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement)
    }

    window.addEventListener('resize', resize)

    const render = () => {
      // While recording, the capture clock owns painting so track frames stay live.
      if (!captureClockRef.current) {
        paintCompositorFrame(null)
      }
      compositorFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener('resize', resize)
      resizeObserver.disconnect()
      cancelAnimationFrame(compositorFrameRef.current)
    }
  }, [paintCompositorFrame])

  const stopCaptureClock = useCallback(() => {
    captureClockRef.current?.stop()
    captureClockRef.current = null
  }, [])

  const startCaptureClock = useCallback(() => {
    captureClockRef.current?.stop()
    captureClockRef.current = null

    const screenTrack =
      screenStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live') ?? null
    const cameraTrack =
      cameraStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live') ?? null

    captureClockRef.current = startRecordingCaptureClock({
      screenTrack,
      cameraTrack,
      paint: (sources) => paintCompositorFrame(sources),
      captureTrack: canvasCaptureTrackRef.current,
    })
  }, [paintCompositorFrame])

  useEffect(() => {
    if (!isRecording) return

    const interval = window.setInterval(() => {
      if (recordingStartedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [isRecording])

  const setCameraEnabledState = useCallback((enabled: boolean) => {
    const stream = cameraStreamRef.current
    if (!stream) return

    stream.getVideoTracks().forEach((track) => {
      track.enabled = enabled
    })
    setCameraEnabled(enabled)
  }, [])

  const toggleCamera = useCallback(() => {
    const stream = cameraStreamRef.current
    if (!stream) return

    const next = !cameraEnabled
    stream.getVideoTracks().forEach((track) => {
      track.enabled = next
    })
    setCameraEnabled(next)
  }, [cameraEnabled])

  const toggleMicAudio = useCallback(() => {
    setMicAudioEnabled((current) => {
      const next = !current
      micAudioEnabledRef.current = next
      setMicCaptureEnabled(next)
      cameraStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = next
      })
      return next
    })
  }, [])

  const toggleScreenAudio = useCallback(() => {
    setScreenAudioEnabled((current) => {
      const next = !current
      screenAudioEnabledRef.current = next
      setScreenAudioCaptureEnabled(next)
      screenStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = next
      })
      return next
    })
  }, [])

  const startScreenShare = useCallback(async () => {
    if (screenStreamRef.current) return

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      screenStreamRef.current = stream
      const hasScreenAudio = stream.getAudioTracks().length > 0
      setScreenAudioAvailable(hasScreenAudio)
      stream.getAudioTracks().forEach((track) => {
        track.enabled = screenAudioEnabledRef.current
      })
      setScreenAudioCaptureEnabled(screenAudioEnabledRef.current)

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream
        await screenVideoRef.current.play().catch(() => undefined)
      }

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopMediaStream(screenStreamRef.current)
        screenStreamRef.current = null
        if (screenVideoRef.current) screenVideoRef.current.srcObject = null
        setScreenShareEnabled(false)
        setScreenAudioAvailable(false)
      })

      setScreenShareEnabled(true)
    } catch {
      setError('Screen sharing was cancelled or blocked.')
    }
  }, [])

  const stopScreenShare = useCallback(() => {
    stopMediaStream(screenStreamRef.current)
    screenStreamRef.current = null
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null
    setScreenShareEnabled(false)
    setScreenAudioAvailable(false)
  }, [])

  const toggleScreenShare = useCallback(async () => {
    if (screenShareEnabled) {
      stopScreenShare()
      return
    }
    await startScreenShare()
  }, [screenShareEnabled, startScreenShare, stopScreenShare])

  const setScreenShareEnabledState = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        await startScreenShare()
      } else {
        stopScreenShare()
      }
    },
    [startScreenShare, stopScreenShare],
  )

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current
    const cameraStream = cameraStreamRef.current
    if (!canvas || !cameraStream) return

    void (async () => {
      const mimeType = getRecorderMimeType()
      const mixedAudioTrack = await beginRecordingAudioMix(cameraStream, screenStreamRef.current)
      const screenTrack =
        screenStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live') ??
        null

      // Prefer canvas composition so camera bubble / effects stay in the file.
      // Drive that canvas from the live screen (or camera) track so frames keep
      // arriving after the user switches to another tab/app.
      //
      // Fallback without MediaStreamTrackProcessor: record the screen track
      // directly so the shared display never freezes in the background.
      const useDirectScreen = Boolean(screenTrack && !supportsBackgroundCapture())
      recordingVideoModeRef.current = useDirectScreen ? 'direct-screen' : 'canvas'

      let videoTracks: MediaStreamTrack[] = []

      if (useDirectScreen && screenTrack) {
        stopCaptureClock()
        videoTracks = [screenTrack]
      } else {
        const probe = document.createElement('canvas').captureStream(0).getVideoTracks()[0] as
          | (MediaStreamTrack & { requestFrame?: () => void })
          | undefined
        const supportsManualFrames = typeof probe?.requestFrame === 'function'
        probe?.stop()

        const canvasStream = canvas.captureStream(supportsManualFrames ? 0 : 30)
        const captureTrack = canvasStream.getVideoTracks()[0] as
          | (MediaStreamTrack & { requestFrame?: () => void })
          | undefined
        canvasCaptureTrackRef.current = captureTrack ?? null
        videoTracks = canvasStream.getVideoTracks()
        startCaptureClock()
      }

      const tracks: MediaStreamTrack[] = [...videoTracks]
      if (mixedAudioTrack) {
        tracks.push(mixedAudioTrack)
      } else {
        const micTrack = cameraStream.getAudioTracks().find((track) => track.readyState === 'live')
        if (micTrack) tracks.push(micTrack)
      }

      const combinedStream = new MediaStream(tracks)
      if (combinedStream.getAudioTracks().length === 0) {
        setError('No microphone audio available. Check mic permissions and try again.')
        endRecordingAudioMix()
        stopCaptureClock()
        return
      }

      chunksRef.current = []
      const recorder = new MediaRecorder(combinedStream, getRecorderOptions(mimeType))

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.start(250)
      mediaRecorderRef.current = recorder
      recordingStartedAtRef.current = Date.now()
      isRecordingRef.current = true
      setElapsedSeconds(0)
      setIsRecording(true)
    })()
  }, [startCaptureClock, stopCaptureClock])

  // If screen share starts/stops mid-recording, retarget the capture clock driver.
  useEffect(() => {
    if (!isRecording) return
    if (recordingVideoModeRef.current !== 'canvas') return
    startCaptureClock()
  }, [isRecording, screenShareEnabled, startCaptureClock])

  const discardSession = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.stop()
    }

    stopCaptureClock()
    canvasCaptureTrackRef.current = null
    endRecordingAudioMix()
    chunksRef.current = []
    mediaRecorderRef.current = null
    recordingStartedAtRef.current = null
    isRecordingRef.current = false
    setIsRecording(false)
    setElapsedSeconds(0)

    stopMediaStream(cameraStreamRef.current)
    stopMediaStream(screenStreamRef.current)
    cameraStreamRef.current = null
    screenStreamRef.current = null

    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null

    cancelAnimationFrame(compositorFrameRef.current)
  }, [stopCaptureClock])

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return

    setIsSaving(true)

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    stopCaptureClock()
    canvasCaptureTrackRef.current = null
    endRecordingAudioMix()

    const mimeType = recorder.mimeType || getRecorderMimeType()
    const videoBlob = new Blob(chunksRef.current, { type: mimeType })
    const durationSeconds = recordingStartedAtRef.current
      ? Math.max(1, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
      : 1

    try {
      const thumbnailBlob = await generateThumbnail(videoBlob)
      const recording = await addDraftRecording({
        name: `Recording — ${formatRecordedDate(new Date().toISOString())}`,
        videoBlob,
        thumbnailBlob,
        mimeType,
        durationSeconds,
      })

      isRecordingRef.current = false
      setIsRecording(false)
      mediaRecorderRef.current = null
      recordingStartedAtRef.current = null
      navigate(`/editor-studio?recording=${recording.id}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save recording.')
      isRecordingRef.current = false
      setIsRecording(false)
    } finally {
      setIsSaving(false)
    }
  }, [addDraftRecording, navigate, stopCaptureClock])

  return {
    cameraVideoRef,
    screenVideoRef,
    cameraBgVideoRef,
    screenBgVideoRef,
    cameraBgImageRef,
    screenBgImageRef,
    canvasRef,
    cameraEnabled,
    screenShareEnabled,
    micAudioEnabled,
    screenAudioEnabled,
    screenAudioAvailable,
    cameraLayout,
    screenShareLayout,
    effectId,
    isRecording,
    elapsedSeconds,
    isSaving,
    isConnecting,
    error,
    assets,
    setCameraLayout,
    setScreenShareLayout,
    setCameraEnabled: setCameraEnabledState,
    setScreenShareEnabled: setScreenShareEnabledState,
    toggleCamera,
    toggleMicAudio,
    toggleScreenAudio,
    toggleScreenShare,
    setEffectId,
    startRecording,
    stopRecording,
    discardSession,
  }
}
