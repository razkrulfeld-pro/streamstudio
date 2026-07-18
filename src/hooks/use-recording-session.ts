import {
  connectDevice,
  deviceStreamUrl,
  disconnectDevice,
  getDeviceStatus,
  type DeviceMirrorState,
} from '@/lib/api'
import { createDeviceConnectGuard } from '@/lib/device-connect-guard'
import { useAssetLibrary } from '@/context/asset-library-context'
import { useRecordings } from '@/context/recordings-context'
import { useSettings } from '@/context/settings-context'
import { acquireMediaStream, getMediaErrorMessage, stopMediaStream } from '@/lib/media-devices'
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
  isSegmentationMaskFresh,
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
} from '@/lib/recording-output'
import { generateThumbnail } from '@/lib/recording-storage'
import { studioStore, useStudioStore } from '@/stores/studio-store'
import { AnimatedGifPlayer } from '@/lib/animated-gif-player'
import {
  defaultCameraLayout,
  defaultScreenShareLayout,
  normalizeScreenShareLayout,
  type CameraLayoutSettings,
  type ScreenShareLayoutSettings,
} from '@/types/recording-layout'
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useNavigate } from 'react-router-dom'

function createInitialCameraLayout(): CameraLayoutSettings {
  return { ...defaultCameraLayout }
}

export function useRecordingSession(options?: {
  stickersRef?: MutableRefObject<FloatingSticker[]>
}) {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const { session } = useStudioStore()
  const { addDraftRecording } = useRecordings()
  const { assets } = useAssetLibrary()

  const outputWidth = session?.contentType.canvasWidth ?? 1920
  const outputHeight = session?.contentType.canvasHeight ?? 1080
  const outputDimensions = useMemo(
    () => ({ width: outputWidth, height: outputHeight }),
    [outputWidth, outputHeight],
  )
  const maxDurationSeconds = session?.youtubeMetadata.maxDurationSeconds ?? null
  const outputDimensionsRef = useRef(outputDimensions)
  outputDimensionsRef.current = outputDimensions
  const sessionRef = useRef(session)
  sessionRef.current = session

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
  const segmentationMaskAtRef = useRef<number | null>(null)
  const visualStateRef = useRef({
    cameraEnabled: true,
    screenShareEnabled: false,
    effectId: 'fx-none',
    cameraLayout: createInitialCameraLayout(),
    screenShareLayout: normalizeScreenShareLayout(defaultScreenShareLayout),
    mirrorCamera: true,
  })
  const isRecordingRef = useRef(false)
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null)

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
  const handingOffToEditorRef = useRef(false)
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deviceState, setDeviceState] = useState<DeviceMirrorState>('idle')
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const screenSourceRef = useRef<'none' | 'display' | 'device'>('none')
  const devicePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const deviceConnectGuardRef = useRef(createDeviceConnectGuard())

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
      const message = getMediaErrorMessage(connectError)
      const isBusySource =
        (connectError instanceof DOMException && connectError.name === 'NotReadableError') ||
        /could not start video source/i.test(
          connectError instanceof Error ? connectError.message : message,
        )
      // Device briefly busy / already open — don't block the studio with a banner.
      if (!isBusySource) {
        setError(message)
      }
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
            segmentationMaskAtRef.current = performance.now()
          }
        } catch {
          // Model may still be loading on first use.
        }
      } else {
        segmentationMaskRef.current = null
        segmentationMaskAtRef.current = null
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
      segmentationMaskAtRef.current = null
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

    const { width: outW, height: outH } = outputDimensionsRef.current
    if (canvas.width !== outW || canvas.height !== outH) {
      canvas.width = outW
      canvas.height = outH
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

    if (cameraSource && camLayout.backgroundType !== 'none' && segmentedPersonCanvasRef.current) {
      const mask = segmentationMaskRef.current
      const maskFresh = isSegmentationMaskFresh(segmentationMaskAtRef.current, performance.now())

      if (mask && maskFresh) {
        const segmentedContext = segmentedPersonCanvasRef.current.getContext('2d')
        if (segmentedContext) {
          applySegmentationMask(segmentedContext, cameraSource, mask)
          segmentedPersonCanvas = segmentedPersonCanvasRef.current

          if (camLayout.backgroundType === 'blur' && blurredBackgroundCanvasRef.current) {
            composeBlurOnlyBackground(
              blurredBackgroundCanvasRef.current,
              cameraSource,
              mask,
            )
            blurredBackgroundCanvas = blurredBackgroundCanvasRef.current
          }
        }
      } else if (segmentedPersonCanvasRef.current.width > 0) {
        // Keep the last good cutout briefly so Shorts don't flash opaque camera / empty stage.
        segmentedPersonCanvas = segmentedPersonCanvasRef.current
        if (camLayout.backgroundType === 'blur' && blurredBackgroundCanvasRef.current?.width) {
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

  const paintCompositorFrameRef = useRef(paintCompositorFrame)
  paintCompositorFrameRef.current = paintCompositorFrame

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const { width, height } = outputDimensionsRef.current
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
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
        paintCompositorFrameRef.current(null)
      }
      compositorFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener('resize', resize)
      resizeObserver.disconnect()
      cancelAnimationFrame(compositorFrameRef.current)
    }
  }, [outputWidth, outputHeight])

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
      paint: (sources) => paintCompositorFrameRef.current(sources),
      captureTrack: canvasCaptureTrackRef.current,
    })
  }, [])

  useEffect(() => {
    if (!isRecording) return

    const interval = window.setInterval(() => {
      if (!recordingStartedAtRef.current) return
      const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
      setElapsedSeconds(elapsed)

      if (maxDurationSeconds != null && elapsed >= maxDurationSeconds) {
        void stopRecordingRef.current?.()
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [isRecording, maxDurationSeconds])

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

  const clearDevicePoll = useCallback(() => {
    if (devicePollRef.current != null) {
      clearInterval(devicePollRef.current)
      devicePollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearDevicePoll()
      if (screenSourceRef.current === 'device') {
        void disconnectDevice().catch(() => undefined)
      }
    }
  }, [clearDevicePoll])

  const clearScreenVideoElement = useCallback(() => {
    const video = screenVideoRef.current
    if (!video) return
    video.srcObject = null
    video.removeAttribute('src')
    video.load()
  }, [])

  const stopDeviceMirror = useCallback(async () => {
    clearDevicePoll()
    deviceConnectGuardRef.current.release()
    try {
      await disconnectDevice()
    } catch {
      // Best-effort teardown — local UI still resets.
    }
    if (screenSourceRef.current === 'device') {
      stopMediaStream(screenStreamRef.current)
      screenStreamRef.current = null
      clearScreenVideoElement()
      screenSourceRef.current = 'none'
      setScreenShareEnabled(false)
      setScreenAudioAvailable(false)
    }
    setDeviceState('idle')
    setDeviceMessage(null)
    setDeviceError(null)
  }, [clearDevicePoll, clearScreenVideoElement])

  const attachDeviceStream = useCallback(async () => {
    const video = screenVideoRef.current
    if (!video) return

    video.srcObject = null
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.src = deviceStreamUrl()

    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('loadeddata', done)
        video.removeEventListener('error', done)
        resolve()
      }
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve()
        return
      }
      video.addEventListener('loadeddata', done)
      video.addEventListener('error', done)
    })

    await video.play().catch(() => undefined)

    const media = video as HTMLVideoElement & { captureStream(): MediaStream }
    const captured = media.captureStream()
    screenStreamRef.current = captured
    screenSourceRef.current = 'device'
    const hasAudio = captured.getAudioTracks().length > 0
    setScreenAudioAvailable(hasAudio)
    captured.getAudioTracks().forEach((track: MediaStreamTrack) => {
      track.enabled = screenAudioEnabledRef.current
    })
    setScreenAudioCaptureEnabled(screenAudioEnabledRef.current)
    setScreenShareEnabled(true)
  }, [])

  const startDeviceMirror = useCallback(async () => {
    // Sync guard — React state updates are too slow to prevent double-clicks.
    if (!deviceConnectGuardRef.current.tryAcquire()) return

    if (screenSourceRef.current === 'display') {
      stopMediaStream(screenStreamRef.current)
      screenStreamRef.current = null
      clearScreenVideoElement()
      screenSourceRef.current = 'none'
      setScreenShareEnabled(false)
      setScreenAudioAvailable(false)
    }

    clearDevicePoll()
    setDeviceError(null)
    setDeviceMessage(null)
    setDeviceState('searching')

    try {
      await connectDevice()
    } catch {
      deviceConnectGuardRef.current.release()
      setDeviceState('error')
      setDeviceError("Couldn't connect to your phone. Check that it's unlocked and on the same Wi‑Fi, then retry.")
      return
    }

    let attachStarted = false
    devicePollRef.current = setInterval(() => {
      void (async () => {
        try {
          const status = await getDeviceStatus()
          setDeviceState(status.state)
          setDeviceMessage(status.message)
          setDeviceError(status.error)

          if (status.state === 'connected') {
            clearDevicePoll()
            deviceConnectGuardRef.current.release()
            if (attachStarted) return
            attachStarted = true
            await attachDeviceStream()
          } else if (status.state === 'error' || status.state === 'idle') {
            clearDevicePoll()
            deviceConnectGuardRef.current.release()
            if (status.state === 'error') {
              setScreenShareEnabled(false)
            }
          }
        } catch {
          clearDevicePoll()
          deviceConnectGuardRef.current.release()
          setDeviceState('error')
          setDeviceError('Connection lost. Retry to reconnect.')
        }
      })()
    }, 500)
  }, [attachDeviceStream, clearDevicePoll, clearScreenVideoElement])

  const retryDeviceMirror = useCallback(async () => {
    await stopDeviceMirror()
    await startDeviceMirror()
  }, [startDeviceMirror, stopDeviceMirror])

  const startScreenShare = useCallback(async () => {
    if (screenStreamRef.current && screenSourceRef.current === 'display') return

    if (screenSourceRef.current === 'device' || deviceState !== 'idle') {
      await stopDeviceMirror()
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      screenStreamRef.current = stream
      screenSourceRef.current = 'display'
      const hasScreenAudio = stream.getAudioTracks().length > 0
      setScreenAudioAvailable(hasScreenAudio)
      stream.getAudioTracks().forEach((track) => {
        track.enabled = screenAudioEnabledRef.current
      })
      setScreenAudioCaptureEnabled(screenAudioEnabledRef.current)

      if (screenVideoRef.current) {
        screenVideoRef.current.removeAttribute('src')
        screenVideoRef.current.srcObject = stream
        await screenVideoRef.current.play().catch(() => undefined)
      }

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopMediaStream(screenStreamRef.current)
        screenStreamRef.current = null
        screenSourceRef.current = 'none'
        if (screenVideoRef.current) screenVideoRef.current.srcObject = null
        setScreenShareEnabled(false)
        setScreenAudioAvailable(false)
      })

      setScreenShareEnabled(true)
    } catch {
      // User cancelled the picker or the browser blocked share — stay quiet.
    }
  }, [deviceState, stopDeviceMirror])

  const stopScreenShare = useCallback(() => {
    if (screenSourceRef.current === 'device') {
      void stopDeviceMirror()
      return
    }
    stopMediaStream(screenStreamRef.current)
    screenStreamRef.current = null
    screenSourceRef.current = 'none'
    clearScreenVideoElement()
    setScreenShareEnabled(false)
    setScreenAudioAvailable(false)
  }, [clearScreenVideoElement, stopDeviceMirror])

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
      const recorder = new MediaRecorder(
        combinedStream,
        getRecorderOptions(mimeType, outputDimensionsRef.current),
      )

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
    studioStore.clearSession()

    clearDevicePoll()
    if (screenSourceRef.current === 'device') {
      void disconnectDevice().catch(() => undefined)
    }

    stopMediaStream(cameraStreamRef.current)
    stopMediaStream(screenStreamRef.current)
    cameraStreamRef.current = null
    screenStreamRef.current = null
    screenSourceRef.current = 'none'

    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    clearScreenVideoElement()

    setDeviceState('idle')
    setDeviceMessage(null)
    setDeviceError(null)

    cancelAnimationFrame(compositorFrameRef.current)
  }, [clearDevicePoll, clearScreenVideoElement, stopCaptureClock])

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
      const dims = outputDimensionsRef.current
      const activeSession = sessionRef.current
      const thumbScale = 320 / Math.max(dims.width, dims.height)
      const thumbnailBlob = await generateThumbnail(videoBlob, {
        width: Math.round(dims.width * thumbScale),
        height: Math.round(dims.height * thumbScale),
      })
      const draftName = `Recording — ${formatRecordedDate(new Date().toISOString())}`
      const youtubeMetadata = activeSession
        ? { ...activeSession.youtubeMetadata, title: draftName }
        : undefined

      const recording = await addDraftRecording({
        name: draftName,
        videoBlob,
        thumbnailBlob,
        mimeType,
        durationSeconds,
        contentTypeId: activeSession?.contentType.id,
        aspectRatio: activeSession?.contentType.aspectRatio,
        youtubeMetadata,
      })

      isRecordingRef.current = false
      setIsRecording(false)
      mediaRecorderRef.current = null
      recordingStartedAtRef.current = null

      // Ref must flip before clearSession — store updates are sync and would
      // otherwise bounce RecordingSessionPage to the lobby mid-handoff.
      handingOffToEditorRef.current = true
      navigate(`/editor-studio?recording=${recording.id}`, { replace: true })
      studioStore.clearSession()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save recording.')
      isRecordingRef.current = false
      setIsRecording(false)
      handingOffToEditorRef.current = false
    } finally {
      setIsSaving(false)
    }
  }, [addDraftRecording, navigate, stopCaptureClock])

  stopRecordingRef.current = stopRecording

  return {
    session,
    aspectRatio: session?.contentType.aspectRatio ?? '16:9',
    maxDurationSeconds,
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
    deviceState,
    deviceMessage,
    deviceError,
    cameraLayout,
    screenShareLayout,
    effectId,
    isRecording,
    elapsedSeconds,
    isSaving,
    handingOffToEditorRef,
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
    startDeviceMirror,
    stopDeviceMirror,
    retryDeviceMirror,
    setEffectId,
    startRecording,
    stopRecording,
    discardSession,
  }
}
