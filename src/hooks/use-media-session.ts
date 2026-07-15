import {
  acquireMediaStream,
  enumerateMediaDevices,
  getMediaErrorMessage,
  normalizeDeviceId,
  stopMediaStream,
  type MediaDeviceOption,
} from '@/lib/media-devices'
import type { CameraSettings } from '@/types/settings'
import { useCallback, useEffect, useRef, useState } from 'react'

export type MediaSessionStatus = 'idle' | 'connecting' | 'connected' | 'denied' | 'error'

export function useMediaSession(camera: CameraSettings) {
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  const streamRef = useRef<MediaStream | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<MediaSessionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([])
  const [microphones, setMicrophones] = useState<MediaDeviceOption[]>([])
  const [audioLevel, setAudioLevel] = useState(0)

  const refreshDevices = useCallback(async () => {
    const devices = await enumerateMediaDevices()
    setCameras(devices.cameras)
    setMicrophones(devices.microphones)
  }, [])

  const connect = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError('Media devices are not supported in this browser.')
      return
    }

    const currentCamera = cameraRef.current
    setStatus('connecting')
    setError(null)
    setAudioLevel(0)

    stopMediaStream(streamRef.current)
    streamRef.current = null
    setStream(null)

    try {
      const nextStream = await acquireMediaStream({
        ...currentCamera,
        cameraId: normalizeDeviceId(currentCamera.cameraId),
        microphoneId: normalizeDeviceId(currentCamera.microphoneId),
      })

      streamRef.current = nextStream
      setStream(nextStream)
      setStatus('connected')
      setError(null)

      await refreshDevices()
    } catch (connectError) {
      const message = getMediaErrorMessage(connectError)
      setStatus(
        connectError instanceof DOMException && connectError.name === 'NotAllowedError'
          ? 'denied'
          : 'error',
      )
      setError(message)
    }
  }, [refreshDevices])

  useEffect(() => {
    void connect()

    return () => {
      stopMediaStream(streamRef.current)
      streamRef.current = null
    }
  }, [camera.cameraId, camera.microphoneId, camera.resolution, connect])

  useEffect(() => {
    if (!stream) {
      setAudioLevel(0)
      return
    }

    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) {
      setAudioLevel(0)
      return
    }

    let audioContext: AudioContext | null = null
    let animationFrame = 0
    let cancelled = false

    async function monitorAudio() {
      audioContext = new AudioContext()
      await audioContext.resume()

      const source = audioContext.createMediaStreamSource(stream!)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.65
      source.connect(analyser)

      const data = new Uint8Array(analyser.frequencyBinCount)

      const tick = () => {
        if (cancelled) return
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let index = 0; index < data.length; index += 1) {
          const value = (data[index] - 128) / 128
          sum += value * value
        }
        const rms = Math.sqrt(sum / data.length)
        setAudioLevel(Math.min(100, Math.round(rms * 420)))
        animationFrame = window.requestAnimationFrame(tick)
      }

      tick()
    }

    void monitorAudio()

    const handleDeviceChange = () => {
      void refreshDevices()
    }

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(animationFrame)
      void audioContext?.close()
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [stream, refreshDevices])

  return {
    stream,
    status,
    error,
    cameras,
    microphones,
    audioLevel,
    connect,
  }
}
