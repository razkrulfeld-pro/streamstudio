import type { EditorTransitionType } from '@/types/editor-project'
import { cn } from '@/lib/utils'

interface TransitionOverlayProps {
  type: EditorTransitionType
  progress: number
  active: boolean
}

export function TransitionOverlay({ type, progress, active }: TransitionOverlayProps) {
  if (!active || type === 'none' || progress >= 1) return null

  const opacity = 1 - progress

  if (type === 'fade') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-20 bg-black"
        style={{ opacity }}
      />
    )
  }

  if (type === 'dissolve') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-20 bg-white"
        style={{ opacity: opacity * 0.55 }}
      />
    )
  }

  if (type === 'wipe-left') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-20 bg-black"
        style={{ clipPath: `inset(0 ${progress * 100}% 0 0)` }}
      />
    )
  }

  if (type === 'wipe-up') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-20 bg-black"
        style={{ clipPath: `inset(0 0 ${progress * 100}% 0)` }}
      />
    )
  }

  return null
}

interface IntroOverlayProps {
  imageUrl: string | null
  progress: number
  active: boolean
}

export function IntroOverlay({ imageUrl, progress, active }: IntroOverlayProps) {
  if (!active || !imageUrl) return null

  const scale = 0.55 + 0.45 * Math.min(1, progress / 0.35)
  const opacity =
    progress < 0.12 ? progress / 0.12 : progress > 0.75 ? Math.max(0, (1 - progress) / 0.25) : 1
  const y = (1 - Math.min(1, progress / 0.4)) * 48

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <img
        src={imageUrl}
        alt=""
        className="max-h-[55%] max-w-[55%] object-contain drop-shadow-2xl"
        style={{
          opacity,
          transform: `translateY(${y}px) scale(${scale})`,
        }}
      />
    </div>
  )
}

interface OutroOverlayProps {
  active: boolean
  mode: 'subscribe' | 'sticker' | 'text'
  text: string
  subscribeLabel: string
  imageUrl: string | null
  progress: number
}

export function OutroOverlay({
  active,
  mode,
  text,
  subscribeLabel,
  imageUrl,
  progress,
}: OutroOverlayProps) {
  if (!active) return null

  const opacity = Math.min(1, progress / 0.2)

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/55 px-6 text-center',
      )}
      style={{ opacity }}
    >
      {mode === 'sticker' && imageUrl ? (
        <img src={imageUrl} alt="" className="max-h-[40%] max-w-[40%] object-contain drop-shadow-2xl" />
      ) : null}

      {mode === 'text' || mode === 'subscribe' ? (
        <p className="max-w-xl text-2xl font-semibold tracking-tight text-white md:text-4xl">{text}</p>
      ) : null}

      {mode === 'subscribe' ? (
        <div className="inline-flex items-center gap-2 rounded-full bg-[#ff0033] px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
          <span className="size-2 rounded-full bg-white" />
          {subscribeLabel}
        </div>
      ) : null}

      {mode === 'sticker' && text ? (
        <p className="max-w-lg text-lg font-medium text-white/95">{text}</p>
      ) : null}
    </div>
  )
}
