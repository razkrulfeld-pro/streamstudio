import type { CameraSettings, VideoResolution } from '@/types/settings'

export const DEFAULT_DEVICE_ID = ''

const LEGACY_DEVICE_IDS = new Set(['default', 'facetime', 'external', 'built-in'])

export interface MediaDeviceOption {
  deviceId: string
  label: string
}

const resolutionDimensions: Record<VideoResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
}

export function isLegacyDeviceId(deviceId: string): boolean {
  return LEGACY_DEVICE_IDS.has(deviceId)
}

export function normalizeDeviceId(deviceId: string): string {
  if (!deviceId || isLegacyDeviceId(deviceId)) {
    return DEFAULT_DEVICE_ID
  }
  return deviceId
}

function videoDeviceConstraint(deviceId: string): Pick<MediaTrackConstraints, 'deviceId'> | undefined {
  if (!deviceId) return undefined
  return { deviceId: { ideal: deviceId } }
}

function audioDeviceConstraint(deviceId: string): Pick<MediaTrackConstraints, 'deviceId'> | undefined {
  if (!deviceId) return undefined
  return { deviceId: { ideal: deviceId } }
}

export function buildMediaConstraintAttempts(
  camera: CameraSettings,
  options: { video?: boolean; audio?: boolean } = { video: true, audio: true },
): MediaStreamConstraints[] {
  const cameraId = normalizeDeviceId(camera.cameraId)
  const microphoneId = normalizeDeviceId(camera.microphoneId)
  const { width, height } = resolutionDimensions[camera.resolution]
  const attempts: MediaStreamConstraints[] = []

  const videoWithResolution = (
    resolution: { width: number; height: number },
  ): MediaTrackConstraints => ({
    ...videoDeviceConstraint(cameraId),
    width: { ideal: resolution.width, min: Math.min(640, resolution.width) },
    height: { ideal: resolution.height, min: Math.min(480, resolution.height) },
    frameRate: { ideal: 30, min: 24 },
  })

  if (options.video !== false && options.audio !== false) {
    // Prefer the configured resolution first, then step down so we still get HD when 4K fails.
    attempts.push({
      video: videoWithResolution({ width, height }),
      audio: audioDeviceConstraint(microphoneId) ?? true,
    })
    if (camera.resolution === '4k') {
      attempts.push({
        video: videoWithResolution(resolutionDimensions['1080p']),
        audio: audioDeviceConstraint(microphoneId) ?? true,
      })
    }
    if (camera.resolution === '4k' || camera.resolution === '1080p') {
      attempts.push({
        video: videoWithResolution(resolutionDimensions['720p']),
        audio: audioDeviceConstraint(microphoneId) ?? true,
      })
    }
    attempts.push({
      video: videoDeviceConstraint(cameraId) ?? true,
      audio: audioDeviceConstraint(microphoneId) ?? true,
    })
  } else if (options.video !== false) {
    attempts.push({ video: videoWithResolution({ width, height }) })
    if (camera.resolution === '4k') {
      attempts.push({ video: videoWithResolution(resolutionDimensions['1080p']) })
    }
    if (camera.resolution === '4k' || camera.resolution === '1080p') {
      attempts.push({ video: videoWithResolution(resolutionDimensions['720p']) })
    }
    attempts.push({
      video: videoDeviceConstraint(cameraId) ?? true,
    })
  } else if (options.audio !== false) {
    attempts.push({
      audio: audioDeviceConstraint(microphoneId) ?? true,
    })
  }

  attempts.push({
    video: options.video === false ? false : true,
    audio: options.audio === false ? false : true,
  })

  return attempts.filter((constraints) => constraints.video !== false || constraints.audio !== false)
}

export async function acquireMediaStream(
  camera: CameraSettings,
  options: { video?: boolean; audio?: boolean } = { video: true, audio: true },
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Media devices are not supported in this browser.')
  }

  const attempts = buildMediaConstraintAttempts(camera, options)
  let lastError: unknown

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('Unable to access media devices.')
}

export async function enumerateMediaDevices(): Promise<{
  cameras: MediaDeviceOption[]
  microphones: MediaDeviceOption[]
}> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { cameras: [], microphones: [] }
  }

  const devices = await navigator.mediaDevices.enumerateDevices()

  const cameras = devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }))

  const microphones = devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }))

  return { cameras, microphones }
}

export function deviceExists(deviceId: string, devices: MediaDeviceOption[]): boolean {
  if (!deviceId) return true
  return devices.some((device) => device.deviceId === deviceId)
}

export function getMediaErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Camera and microphone access is blocked.'
    }
    if (error.name === 'NotFoundError') {
      return 'No camera or microphone was found.'
    }
    if (error.name === 'NotReadableError') {
      return 'Your camera or microphone is already in use.'
    }
    if (error.name === 'OverconstrainedError') {
      return 'The selected device could not be used with these settings.'
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Unable to connect to your camera or microphone.'
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}
