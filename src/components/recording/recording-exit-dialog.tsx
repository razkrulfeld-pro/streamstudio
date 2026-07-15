interface RecordingExitDialogProps {
  open: boolean
  isRecording: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function RecordingExitDialog({
  open,
  isRecording,
  onCancel,
  onConfirm,
}: RecordingExitDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recording-exit-title"
        className="relative w-full max-w-md rounded-2xl border border-white/50 bg-white/90 p-6 shadow-2xl backdrop-blur-xl"
      >
        <h2 id="recording-exit-title" className="text-lg font-semibold text-neutral-900">
          Leave recording session?
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          {isRecording
            ? 'You are currently recording. Leaving now will discard this recording entirely — nothing will be saved.'
            : 'Your camera setup and session settings will be discarded. You can start a new recording anytime from the lobby.'}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            {isRecording ? 'Discard recording' : 'Leave session'}
          </button>
        </div>
      </div>
    </div>
  )
}
