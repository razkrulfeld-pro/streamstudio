import { cn } from '@/lib/utils'
import type { MediaSessionStatus } from '@/hooks/use-media-session'
import type { CameraSettings } from '@/types/settings'
import { Mic } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface CameraMediaPreviewProps {
  stream: MediaStream | null
  status: MediaSessionStatus
  error: string | null
  audioLevel: number
  camera: CameraSettings
  onConnect: () => void
}

export function CameraMediaPreview({
  stream,
  status,
  error,
  audioLevel,
  camera,
  onConnect,
}: CameraMediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.srcObject = stream
    if (stream) {
      void video.play().catch(() => undefined)
    }
  }, [stream])

  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-200">
        {status === 'connected' && stream ? (
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
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {status === 'connecting' ? (
              <p className="text-sm text-neutral-300">Connecting camera and microphone…</p>
            ) : (
              <>
                <p className="text-sm text-neutral-300">
                  {error ?? 'Enable camera and microphone to test your setup.'}
                </p>
                {status === 'denied' || status === 'error' ? (
                  <button
                    type="button"
                    onClick={onConnect}
                    className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100"
                  >
                    Allow camera & microphone
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      {status === 'connected' ? (
        <div className="flex items-center gap-3">
          <Mic className="size-3.5 flex-shrink-0 text-neutral-400" />
          <div className="flex min-w-0 flex-1 items-end gap-1">
            {Array.from({ length: 20 }, (_, index) => {
              const segmentLevel = ((index + 1) / 20) * 100
              const isActive = audioLevel >= segmentLevel - 3

              return (
                <div
                  key={index}
                  className={cn(
                    'flex-1 rounded-sm transition-colors duration-75',
                    index < 13 ? 'h-2' : index < 17 ? 'h-2.5' : 'h-3',
                    isActive
                      ? index < 13
                        ? 'bg-emerald-400'
                        : index < 17
                          ? 'bg-amber-400'
                          : 'bg-orange-500'
                      : 'bg-neutral-200',
                  )}
                />
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
