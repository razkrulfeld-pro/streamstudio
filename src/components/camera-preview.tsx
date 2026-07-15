import {
  acquireMediaStream,
  getMediaErrorMessage,
  normalizeDeviceId,
  stopMediaStream,
} from '@/lib/media-devices'
import { cn } from '@/lib/utils'
import type { CameraSettings } from '@/types/settings'
import { useEffect, useRef, useState } from 'react'

interface CameraPreviewProps {
  camera: CameraSettings
  className?: string
}

export function CameraPreview({ camera, className }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    async function startPreview() {
      setPreviewError(null)

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }

      try {
        stream = await acquireMediaStream(
          {
            ...camera,
            cameraId: normalizeDeviceId(camera.cameraId),
            microphoneId: normalizeDeviceId(camera.microphoneId),
          },
          { video: true, audio: false },
        )

        if (cancelled) return

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }

        setPreviewError(stream.getVideoTracks()[0] ? null : 'No camera track available.')
      } catch (error) {
        if (cancelled) return
        setPreviewError(getMediaErrorMessage(error))
      }
    }

    void startPreview()

    return () => {
      cancelled = true
      stopMediaStream(stream)
    }
  }, [camera.cameraId, camera.microphoneId, camera.resolution])

  return (
    <div
      className={cn(
        'relative aspect-video overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-200',
        className,
      )}
    >
      {previewError ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-neutral-300">
          {previewError}
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={cn(
            'h-full w-full object-cover',
            camera.mirrorVideo && 'scale-x-[-1]',
          )}
        />
      )}
    </div>
  )
}
