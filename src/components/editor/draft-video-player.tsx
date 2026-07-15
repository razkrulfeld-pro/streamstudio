import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface DraftVideoPlayerProps {
  src: string
  className?: string
  /** Fallback duration from stored metadata when the media reports Infinity (common for WebM). */
  fallbackDurationSeconds?: number
}

function resolveDuration(video: HTMLVideoElement, fallback?: number): number {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  if (fallback && fallback > 0) return fallback
  return 0
}

export function DraftVideoPlayer({
  src,
  className,
  fallbackDurationSeconds,
}: DraftVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(fallbackDurationSeconds ?? 0)
  const [isSeeking, setIsSeeking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(fallbackDurationSeconds ?? 0)
    setError(null)
  }, [src, fallbackDurationSeconds])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let cancelled = false

    const syncTime = () => {
      if (!isSeeking) setCurrentTime(video.currentTime)
    }

    const syncMeta = () => {
      const next = resolveDuration(video, fallbackDurationSeconds)
      if (next > 0) setDuration(next)
    }

    /** MediaRecorder WebM often reports duration as Infinity until a seek forces metadata. */
    const reconcileWebmDuration = () => {
      if (!Number.isFinite(video.duration) || video.duration === Infinity) {
        const onTimeUpdate = () => {
          video.removeEventListener('timeupdate', onTimeUpdate)
          if (cancelled) return
          const next = resolveDuration(video, fallbackDurationSeconds)
          if (next > 0) setDuration(next)
          video.currentTime = 0
        }
        video.addEventListener('timeupdate', onTimeUpdate)
        try {
          video.currentTime = 1e101
        } catch {
          syncMeta()
        }
        return
      }
      syncMeta()
    }

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)
    const onError = () => setError('Could not load this recording. Try opening it again from the lobby.')

    video.addEventListener('timeupdate', syncTime)
    video.addEventListener('loadedmetadata', reconcileWebmDuration)
    video.addEventListener('durationchange', syncMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)

    if (video.readyState >= 1) reconcileWebmDuration()

    return () => {
      cancelled = true
      video.removeEventListener('timeupdate', syncTime)
      video.removeEventListener('loadedmetadata', reconcileWebmDuration)
      video.removeEventListener('durationchange', syncMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
    }
  }, [src, isSeeking, fallbackDurationSeconds])

  const togglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [])

  const seekTo = useCallback(
    (next: number) => {
      const video = videoRef.current
      if (!video || !Number.isFinite(next)) return
      const max = duration || resolveDuration(video, fallbackDurationSeconds) || 0
      const clamped = Math.min(Math.max(0, next), max)
      video.currentTime = clamped
      setCurrentTime(clamped)
    },
    [duration, fallbackDurationSeconds],
  )

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <div className={cn('flex w-full flex-col', className)}>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-neutral-100 [container-type:size]">
        <div
          className="relative aspect-video max-h-full overflow-hidden bg-black"
          style={{ width: 'min(100%, calc(100cqh * 16 / 9))' }}
        >
          <video
            key={src}
            ref={videoRef}
            src={src}
            className="absolute inset-0 size-full object-cover"
            playsInline
            preload="auto"
            onClick={togglePlayback}
          />
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center text-sm text-white">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 bg-white px-1 py-3">
        <button
          type="button"
          onClick={togglePlayback}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-800"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </button>

        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-neutral-600">
          {formatDuration(Math.floor(currentTime))}
        </span>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Number.isFinite(currentTime) ? Math.min(currentTime, duration || currentTime) : 0}
          aria-label="Seek"
          disabled={duration <= 0}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-200 accent-[#5234d2] disabled:cursor-not-allowed [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#5234d2]"
          style={{
            background: `linear-gradient(to right, #5234d2 ${progress}%, #e5e5e5 ${progress}%)`,
          }}
          onPointerDown={() => setIsSeeking(true)}
          onPointerUp={() => setIsSeeking(false)}
          onChange={(event) => {
            const next = Number(event.target.value)
            setCurrentTime(next)
            seekTo(next)
          }}
        />

        <span className="w-12 shrink-0 text-xs tabular-nums text-neutral-600">
          {formatDuration(Math.floor(duration))}
        </span>
      </div>
    </div>
  )
}
