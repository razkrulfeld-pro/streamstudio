import { formatDuration, formatRecordedDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRecordings } from '@/context/recordings-context'
import type { Recording, RecordingStatus } from '@/types/recording'
import { ExternalLink, MoreVertical, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const statusLabels: Record<RecordingStatus, string> = {
  published: 'Published',
  draft: 'Draft',
}

const statusStyles: Record<RecordingStatus, string> = {
  published: 'bg-black/55 text-white',
  draft: 'bg-white/85 text-neutral-700 ring-1 ring-black/5',
}

export function RecordingCard({ recording }: { recording: Recording }) {
  const { removeRecording } = useRecordings()
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!menuOpen) return

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const handleConfirmRemove = async () => {
    if (isRemoving) return
    setIsRemoving(true)
    setError(null)
    try {
      const removed = await removeRecording(recording.id)
      if (!removed) throw new Error('Recording not found.')
      setConfirmOpen(false)
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to remove recording.')
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="group relative block">
      <Link to={`/editor-studio?recording=${recording.id}`} className="block">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-neutral-100">
          <img
            src={recording.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
          <span
            className={cn(
              'absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide backdrop-blur-sm',
              statusStyles[recording.status],
            )}
          >
            {statusLabels[recording.status]}
          </span>
          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(recording.durationSeconds)}
          </span>
        </div>
      </Link>

      <div className="mt-3 flex items-start gap-2">
        <Link to={`/editor-studio?recording=${recording.id}`} className="min-w-0 flex-1 pr-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-neutral-900 group-hover:text-neutral-700">
            {recording.name}
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            {formatRecordedDate(recording.recordedAt)} · {formatDuration(recording.durationSeconds)}
          </p>
        </Link>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            aria-label={`Actions for ${recording.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreVertical className="size-4" />
          </button>

          {menuOpen ? (
            <div
              id={menuId}
              role="menu"
              className="absolute right-0 z-20 mt-1 min-w-[10.5rem] rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
            >
              {recording.status === 'published' && recording.youtubeVideoUrl ? (
                <a
                  role="menuitem"
                  href={recording.youtubeVideoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 transition hover:bg-neutral-50"
                  onClick={() => setMenuOpen(false)}
                >
                  <ExternalLink className="size-3.5" />
                  Open on YouTube
                </a>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
                onClick={() => {
                  setMenuOpen(false)
                  setError(null)
                  setConfirmOpen(true)
                }}
              >
                <Trash2 className="size-3.5" />
                Remove
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              if (!isRemoving) setConfirmOpen(false)
            }}
            aria-label="Close dialog"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`remove-recording-title-${recording.id}`}
            className="relative w-full max-w-md rounded-2xl border border-white/50 bg-white/90 p-6 shadow-2xl backdrop-blur-xl"
          >
            <h2
              id={`remove-recording-title-${recording.id}`}
              className="text-lg font-semibold text-neutral-900"
            >
              Remove this recording?
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              “{recording.name}” will be deleted from this device. This can’t be undone.
              {recording.status === 'published'
                ? ' The YouTube upload is not removed.'
                : ''}
            </p>
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={isRemoving}
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRemoving}
                onClick={() => void handleConfirmRemove()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {isRemoving ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
