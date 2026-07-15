import { exportEditedVideo } from '@/lib/export-edited-video'
import { usePublish } from '@/hooks/usePublish'
import type { UploadMetadata, UploadResult } from '@/lib/types/youtube'
import type { EditorProject } from '@/types/editor-project'
import type { YoutubeVisibility } from '@/types/settings'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

interface PublishButtonProps {
  videoBlob: Blob | null
  project: EditorProject
  /** IndexedDB overlay clip blob to bake into the exported video. */
  overlayAudioBlob?: Blob | null
  defaultTitle: string
  defaultDescription?: string
  defaultPrivacy?: YoutubeVisibility
  defaultCategoryId?: string
  disabled?: boolean
  disabledReason?: string
  className?: string
  onPublished?: (result: UploadResult) => void | Promise<void>
}

export function PublishButton({
  videoBlob,
  project,
  overlayAudioBlob = null,
  defaultTitle,
  defaultDescription = '',
  defaultPrivacy = 'unlisted',
  defaultCategoryId = '22',
  disabled = false,
  disabledReason,
  className,
  onPublished,
}: PublishButtonProps) {
  const { status, progress, result, error, publish, reset } = usePublish()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState(defaultDescription)
  const [privacy, setPrivacy] = useState<YoutubeVisibility>(defaultPrivacy)
  const [phase, setPhase] = useState<'idle' | 'exporting' | 'uploading'>('idle')
  const [exportProgress, setExportProgress] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle)
      setDescription(defaultDescription)
      setPrivacy(defaultPrivacy)
      setLocalError(null)
      setPhase('idle')
      setExportProgress(0)
    }
  }, [open, defaultTitle, defaultDescription, defaultPrivacy])

  const handleConfirm = async () => {
    if (!videoBlob) return
    setLocalError(null)

    try {
      setPhase('exporting')
      setExportProgress(0)
      const exportBlob = await exportEditedVideo(videoBlob, project, {
        overlayAudioBlob,
        onProgress: (percent) => setExportProgress(percent),
      })

      setPhase('uploading')
      const metadata: UploadMetadata = {
        title: title.trim() || 'Untitled recording',
        description,
        privacy_status: privacy,
        category_id: defaultCategoryId,
        mime_type: exportBlob.type || 'video/webm',
      }
      const uploadResult = await publish(exportBlob, metadata)
      await onPublished?.(uploadResult)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to publish.')
      setPhase('idle')
    }
  }

  const handleClose = () => {
    if (status === 'uploading' || phase === 'exporting') return
    setOpen(false)
    setPhase('idle')
    if (status === 'success' || status === 'error') reset()
  }

  const busy = phase === 'exporting' || status === 'uploading'
  const displayError = localError || error
  const displayProgress = phase === 'exporting' ? exportProgress : progress
  const progressLabel =
    phase === 'exporting'
      ? 'Rendering edit…'
      : status === 'uploading'
        ? 'Uploading…'
        : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || !videoBlob}
        title={disabled ? disabledReason : undefined}
        className={cn(
          'rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
      >
        Publish to YouTube
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-dialog-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id="publish-dialog-title" className="text-lg font-semibold text-neutral-900">
              Publish to YouTube
            </h2>

            {status === 'idle' || status === 'error' || phase === 'exporting' ? (
              <div className="mt-4 space-y-3">
                {phase === 'exporting' || status === 'uploading' ? (
                  <div className="space-y-2">
                    <p className="text-sm text-neutral-600">{progressLabel}</p>
                    <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-[#5234d2] transition-all"
                        style={{ width: `${Math.max(2, displayProgress)}%` }}
                      />
                    </div>
                    <p className="text-xs text-neutral-500">{Math.round(displayProgress)}%</p>
                  </div>
                ) : (
                  <>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-700">Title</span>
                      <input
                        type="text"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                        Description
                      </span>
                      <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        rows={3}
                        className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-700">Privacy</span>
                      <select
                        value={privacy}
                        onChange={(event) => setPrivacy(event.target.value as YoutubeVisibility)}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
                      >
                        <option value="private">Private</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                  </>
                )}

                {displayError ? <p className="text-sm text-red-600">{displayError}</p> : null}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={busy}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  {phase === 'idle' ? (
                    <button
                      type="button"
                      onClick={() => void handleConfirm()}
                      disabled={!videoBlob || busy}
                      className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
                    >
                      {status === 'error' ? 'Try Again' : 'Confirm upload'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {status === 'uploading' && phase === 'uploading' ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-neutral-600">Uploading…</p>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-[#5234d2] transition-all"
                    style={{ width: `${Math.max(2, progress)}%` }}
                  />
                </div>
                <p className="text-xs text-neutral-500">{Math.round(progress)}%</p>
              </div>
            ) : null}

            {status === 'success' && result ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-neutral-700">Published successfully.</p>
                <a
                  href={result.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm font-medium text-[#5234d2] hover:underline"
                >
                  Open on YouTube
                </a>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
