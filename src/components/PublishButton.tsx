import { PublishReviewForm } from '@/components/publish/PublishReviewForm'
import { exportEditedVideo } from '@/lib/export-edited-video'
import { usePublish } from '@/hooks/usePublish'
import { toUploadMetadata } from '@/lib/recording-session-state'
import type { UploadResult } from '@/lib/types/youtube'
import { getEditedDuration } from '@/types/editor-project'
import type { EditorProject } from '@/types/editor-project'
import type { SessionYouTubeMetadata } from '@/types/session'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

interface PublishButtonProps {
  videoBlob: Blob | null
  project: EditorProject
  /** IndexedDB overlay clip blob to bake into the exported video. */
  overlayAudioBlob?: Blob | null
  publishMetadata: SessionYouTubeMetadata
  /** Session aspect (e.g. 9:16) so Shorts exports keep portrait dimensions. */
  aspectRatio?: string
  disabled?: boolean
  disabledReason?: string
  className?: string
  contentTypeLabel?: string
  onPublished?: (result: UploadResult) => void | Promise<void>
  onPublishMetadataChange?: (metadata: SessionYouTubeMetadata) => void
}

export function PublishButton({
  videoBlob,
  project,
  overlayAudioBlob = null,
  publishMetadata,
  aspectRatio,
  disabled = false,
  disabledReason,
  className,
  contentTypeLabel,
  onPublished,
  onPublishMetadataChange,
}: PublishButtonProps) {
  const { status, progress, result, error, publish, reset } = usePublish()
  const [open, setOpen] = useState(false)
  const [draftMetadata, setDraftMetadata] = useState(publishMetadata)
  const [phase, setPhase] = useState<'idle' | 'exporting' | 'uploading'>('idle')
  const [exportProgress, setExportProgress] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraftMetadata(publishMetadata)
      setLocalError(null)
      setPhase('idle')
      setExportProgress(0)
    }
  }, [open, publishMetadata])

  const handleMetadataChange = (metadata: SessionYouTubeMetadata) => {
    setDraftMetadata(metadata)
    onPublishMetadataChange?.(metadata)
  }

  const handleConfirm = async () => {
    if (!videoBlob) return
    setLocalError(null)

    const editedDuration = getEditedDuration(project)
    const maxDuration = draftMetadata.maxDurationSeconds
    if (maxDuration != null && editedDuration > maxDuration) {
      setLocalError(
        `This edit is ${Math.ceil(editedDuration)}s — the ${maxDuration}s limit for this format was exceeded. Trim the timeline before uploading.`,
      )
      return
    }

    try {
      setPhase('exporting')
      setExportProgress(0)
      const exportBlob = await exportEditedVideo(videoBlob, project, {
        overlayAudioBlob,
        aspectRatio,
        onProgress: (percent) => setExportProgress(percent),
      })

      setPhase('uploading')
      const metadata = toUploadMetadata(
        { ...draftMetadata, title: draftMetadata.title.trim() || 'Untitled recording' },
        exportBlob.type || 'video/webm',
      )
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
              Ready to upload
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Everything else is pre-filled from your content type. Confirm the title to publish.
            </p>

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
                  <PublishReviewForm
                    metadata={draftMetadata}
                    contentTypeLabel={contentTypeLabel}
                    onChange={handleMetadataChange}
                    disabled={busy}
                  />
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
                      {status === 'error' ? 'Try Again' : 'Upload'}
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
