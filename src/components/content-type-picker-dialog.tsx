import { createRecordingSessionState } from '@/lib/recording-session-state'
import { ALL_SESSION_TYPES } from '@/lib/sessionTypes'
import { cn } from '@/lib/utils'
import { useSettings } from '@/context/settings-context'
import { studioStore } from '@/stores/studio-store'
import type { ContentTypeId, SessionType } from '@/types/session'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

const ACCENT = '#C4B5FD'
const INK = '#111111'

function ShortsIllustration() {
  return (
    <svg viewBox="0 0 120 120" className="size-24" aria-hidden fill="none">
      <rect
        x="38"
        y="12"
        width="44"
        height="96"
        rx="10"
        stroke={INK}
        strokeWidth="2.5"
        fill="white"
      />
      <rect x="44" y="24" width="32" height="78" rx="3" fill={ACCENT} />
      <rect x="52" y="17" width="16" height="3" rx="1.5" fill={INK} />
    </svg>
  )
}

function VideosIllustration() {
  return (
    <svg viewBox="0 0 120 120" className="size-24" aria-hidden fill="none">
      <rect
        x="14"
        y="28"
        width="92"
        height="58"
        rx="8"
        stroke={INK}
        strokeWidth="2.5"
        fill="white"
      />
      <rect x="22" y="36" width="76" height="42" rx="3" fill={ACCENT} />
      <path d="M48 92 H72" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M36 100 H84" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

const ILLUSTRATIONS: Record<Exclude<ContentTypeId, 'square'>, () => ReactNode> = {
  short: ShortsIllustration,
  standard: VideosIllustration,
}

function maxDurationLabel(sessionType: SessionType): string {
  const max = sessionType.youtubeConfig.maxDurationSeconds
  if (max == null) return 'No time limit'
  if (max < 60) return `Up to ${max} seconds`
  const minutes = Math.round(max / 60)
  return minutes === 1 ? 'Up to 1 minute' : `Up to ${minutes} minutes`
}

function SessionTypeOption({
  sessionType,
  onSelect,
}: {
  sessionType: SessionType
  onSelect: () => void
}) {
  const Illustration =
    sessionType.id === 'square' ? VideosIllustration : ILLUSTRATIONS[sessionType.id]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex aspect-[2/3] w-full max-w-[12rem] flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white px-5 py-8 text-center transition sm:max-w-none sm:flex-1',
        'hover:border-neutral-300 hover:bg-neutral-50/80 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20',
      )}
    >
      <Illustration />
      <h3 className="mt-5 text-xl font-bold tracking-tight text-neutral-900">
        {sessionType.label}
      </h3>
      <p className="mt-1.5 text-sm text-neutral-500">{maxDurationLabel(sessionType)}</p>
    </button>
  )
}

interface ContentTypePickerDialogProps {
  open: boolean
  onClose: () => void
}

export function ContentTypePickerDialog({ open, onClose }: ContentTypePickerDialogProps) {
  const navigate = useNavigate()
  const { settings } = useSettings()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleSelect = (sessionType: SessionType) => {
    const session = createRecordingSessionState(sessionType, settings.youtube)
    studioStore.startSession(session)
    onClose()
    navigate('/studio')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-type-picker-title"
        className="relative z-10 w-full max-w-lg rounded-2xl bg-white px-10 pb-12 pt-10 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Close dialog"
        >
          <X className="size-5" />
        </button>

        <h2
          id="content-type-picker-title"
          className="pr-8 text-center text-xl font-semibold tracking-tight text-neutral-900"
        >
          What are you making?
        </h2>

        <div className="mt-10 flex flex-col items-center justify-center gap-5 sm:flex-row sm:items-stretch">
          {ALL_SESSION_TYPES.map((sessionType) => (
            <SessionTypeOption
              key={sessionType.id}
              sessionType={sessionType}
              onSelect={() => handleSelect(sessionType)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
