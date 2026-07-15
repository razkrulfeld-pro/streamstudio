import {
  AudioExtractClientError,
  extractYoutubeAudio,
  type ExtractProgressState,
} from '@/lib/audio-extract-client'
import {
  formatExtractDurationSecs,
  formatSourceStartTimestamp,
  normalizeSourceStartInput,
  parseExtractDurationInput,
  parseTimestampToSeconds,
} from '@/lib/format'
import {
  clampExtractDurationSeconds,
  clampPlacement,
  defaultPlacementForClip,
  OVERLAY_AUDIO_MAX_BYTES,
  OVERLAY_AUDIO_MAX_DURATION_S,
  overlayFormatFromMime,
} from '@/lib/overlay-audio'
import { cn } from '@/lib/utils'
import type { EditorProject, OverlayAudioClip } from '@/types/editor-project'
import { effectiveRecordingGain } from '@/types/editor-project'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

type InsertTab = 'youtube' | 'upload'

export function InsertAudioPanel({
  project,
  editedDuration,
  overlayAudioUrl,
  preferredStartAtEditedS = null,
  timelinePlaying = false,
  onPatch,
  onAttachClip,
  onOverlayAudioBlobChange,
}: {
  project: EditorProject
  editedDuration: number
  overlayAudioUrl: string | null
  /** Timeline cue from + → Add audio before a clip is attached. */
  preferredStartAtEditedS?: number | null
  timelinePlaying?: boolean
  onPatch: (patch: Partial<EditorProject>) => void
  onAttachClip: (clip: OverlayAudioClip, blob: Blob) => void
  onOverlayAudioBlobChange: (blob: Blob | null) => void
}) {
  const clip = project.overlayAudio
  const [tab, setTab] = useState<InsertTab>('youtube')
  const [replacing, setReplacing] = useState(false)

  const showForm = !clip || replacing

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Recording audio
        </p>

        <ChannelControl
          label="Camera audio"
          volume={project.cameraVolume}
          muted={project.cameraMuted}
          onVolume={(cameraVolume) =>
            onPatch({
              cameraVolume,
              recordingVolume: effectiveRecordingGain({
                ...project,
                cameraVolume,
              }),
              recordingMuted: project.cameraMuted && project.screenMuted,
            })
          }
          onMuted={(cameraMuted) =>
            onPatch({
              cameraMuted,
              recordingVolume: effectiveRecordingGain({
                ...project,
                cameraMuted,
              }),
              recordingMuted: cameraMuted && project.screenMuted,
            })
          }
        />

        <ChannelControl
          label="Screen audio"
          volume={project.screenVolume}
          muted={project.screenMuted}
          onVolume={(screenVolume) =>
            onPatch({
              screenVolume,
              recordingVolume: effectiveRecordingGain({
                ...project,
                screenVolume,
              }),
              recordingMuted: project.cameraMuted && project.screenMuted,
            })
          }
          onMuted={(screenMuted) =>
            onPatch({
              screenMuted,
              recordingVolume: effectiveRecordingGain({
                ...project,
                screenMuted,
              }),
              recordingMuted: project.cameraMuted && screenMuted,
            })
          }
        />
      </section>

      <section className="space-y-3 border-t border-neutral-100 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Inserted audio
        </p>

      {clip && !replacing ? (
        <ReadyClipControls
          clip={clip}
          overlayAudioUrl={overlayAudioUrl}
          editedDuration={editedDuration}
          timelinePlaying={timelinePlaying}
          onPatch={onPatch}
          onReplace={() => setReplacing(true)}
          onRemove={() => {
            onOverlayAudioBlobChange(null)
            onPatch({ overlayAudio: null })
            setReplacing(false)
          }}
        />
      ) : null}

      {showForm ? (
        <div className={cn('space-y-3', clip && replacing ? 'border-t border-neutral-100 pt-3' : null)}>
          <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
            {([
              ['youtube', 'YouTube'],
              ['upload', 'Upload'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition',
                  tab === id ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'youtube' ? (
            <YoutubeExtractForm
              preferredStartAtEditedS={preferredStartAtEditedS}
              editedDuration={editedDuration}
              onSuccess={(nextClip, blob) => {
                onAttachClip(nextClip, blob)
                setReplacing(false)
              }}
              onCancelReplace={clip ? () => setReplacing(false) : undefined}
            />
          ) : (
            <UploadAudioForm
              editedDuration={editedDuration}
              preferredStartAtEditedS={preferredStartAtEditedS}
              onSuccess={(nextClip, blob) => {
                onAttachClip(nextClip, blob)
                setReplacing(false)
              }}
              onCancelReplace={clip ? () => setReplacing(false) : undefined}
            />
          )}
        </div>
      ) : null}
      </section>
    </div>
  )
}

function ChannelControl({
  label,
  volume,
  muted,
  onVolume,
  onMuted,
}: {
  label: string
  volume: number
  muted: boolean
  onVolume: (volume: number) => void
  onMuted: (muted: boolean) => void
}) {
  return (
    <div>
      <PanelFieldHeading
        trailing={
          <span className="text-[11px] tabular-nums text-neutral-500">
            {muted ? 'Muted' : `${Math.round(volume * 100)}%`}
          </span>
        }
      >
        {label}
      </PanelFieldHeading>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          disabled={muted}
          onChange={(event) => onVolume(Number(event.target.value))}
          className="w-full accent-[#5234d2] disabled:opacity-40"
          aria-label={`${label} volume`}
        />
        <button
          type="button"
          onClick={() => onMuted(!muted)}
          className={cn(
            'shrink-0 rounded-lg border px-2 py-1 text-[11px] font-medium transition',
            muted
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-200 text-neutral-600 hover:border-neutral-300',
          )}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
    </div>
  )
}

function YoutubeExtractForm({
  preferredStartAtEditedS,
  editedDuration,
  onSuccess,
  onCancelReplace,
}: {
  preferredStartAtEditedS?: number | null
  editedDuration: number
  onSuccess: (clip: OverlayAudioClip, blob: Blob) => void
  onCancelReplace?: () => void
}) {
  const [url, setUrl] = useState('')
  const [startInput, setStartInput] = useState('')
  const [durationInput, setDurationInput] = useState('')
  const [state, setState] = useState<ExtractProgressState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [buttonProgress, setButtonProgress] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const progressRafRef = useRef(0)
  const progressStartedRef = useRef(0)

  const busy = state === 'processing' || state === 'validating'

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!busy) {
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current)
      progressRafRef.current = 0
      return
    }

    progressStartedRef.current = performance.now()
    setButtonProgress(2)

    const tick = () => {
      const elapsedSec = (performance.now() - progressStartedRef.current) / 1000
      // Soft wait indicator for the sync extract request — caps below 100 until done.
      // Does not claim backend stages; only shows how long we've been waiting.
      const eased = 1 - Math.exp(-elapsedSec / 16)
      const next = Math.min(92, Math.max(2, Math.round(eased * 92)))
      setButtonProgress(next)
      progressRafRef.current = requestAnimationFrame(tick)
    }
    progressRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current)
      progressRafRef.current = 0
    }
  }, [busy])

  const handleExtract = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setError(null)
    setState('validating')
    setButtonProgress(2)

    const startTimeSeconds = parseTimestampToSeconds(startInput.trim() || '0')
    const durationParsed = parseExtractDurationInput(durationInput.trim() || '30')
    if (startTimeSeconds == null) {
      setState('failed')
      setButtonProgress(0)
      setError('Source start must be seconds or mm:ss / h:mm:ss.')
      return
    }
    if (durationParsed == null) {
      setState('failed')
      setButtonProgress(0)
      setError('Duration must be 1–60 seconds (e.g. 30 or 30secs).')
      return
    }
    const durationSeconds = clampExtractDurationSeconds(durationParsed)
    setStartInput(formatSourceStartTimestamp(startTimeSeconds))
    setDurationInput(formatExtractDurationSecs(durationSeconds))

    setState('processing')
    try {
      const result = await extractYoutubeAudio({
        url,
        startTimeSeconds,
        durationSeconds,
        signal: controller.signal,
      })
      const placement = defaultPlacementForClip(result.durationSeconds)
      const placed = clampPlacement(
        { sourceDurationS: result.durationSeconds },
        preferredStartAtEditedS ?? placement.startAtEditedS,
        placement.durationS,
        editedDuration,
      )
      const clip: OverlayAudioClip = {
        id: crypto.randomUUID(),
        sourceType: 'youtube',
        sourceUrl: url.trim(),
        sourceDurationS: result.durationSeconds,
        extractStartSeconds: startTimeSeconds,
        format: result.format,
        startAtEditedS: placed.startAtEditedS,
        durationS: placed.durationS,
        volume: 1,
        muted: false,
        createdAt: new Date().toISOString(),
      }
      setButtonProgress(100)
      onSuccess(clip, result.blob)
      setState('ready')
      window.setTimeout(() => setButtonProgress(0), 450)
    } catch (err) {
      if (controller.signal.aborted) return
      setButtonProgress(0)
      setState('failed')
      setError(
        err instanceof AudioExtractClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Extraction failed.',
      )
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-neutral-700">YouTube URL</span>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#5234d2]"
          disabled={busy}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-neutral-700">Source start</span>
          <input
            value={startInput}
            onChange={(event) => setStartInput(event.target.value)}
            onBlur={() => {
              const raw = startInput.trim()
              if (!raw) {
                setStartInput('')
                return
              }
              const normalized = normalizeSourceStartInput(raw)
              if (normalized) setStartInput(normalized)
            }}
            placeholder="mm:ss or h:mm:ss"
            inputMode="decimal"
            className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs outline-none placeholder:text-neutral-400 focus:border-[#5234d2] disabled:opacity-50"
            disabled={busy}
            aria-description="Enter seconds (30 → 00:30), mm:ss (30:00), or h:mm:ss (1:12:00)"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-neutral-700">
            Duration (1–{OVERLAY_AUDIO_MAX_DURATION_S}s)
          </span>
          <input
            value={durationInput}
            onChange={(event) => setDurationInput(event.target.value)}
            onBlur={() => {
              const raw = durationInput.trim()
              if (!raw) {
                setDurationInput('')
                return
              }
              const parsed = parseExtractDurationInput(raw)
              if (parsed == null) return
              const clamped = clampExtractDurationSeconds(parsed)
              setDurationInput(formatExtractDurationSecs(clamped))
            }}
            placeholder="secs"
            inputMode="numeric"
            className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs outline-none placeholder:text-neutral-400 focus:border-[#5234d2] disabled:opacity-50"
            disabled={busy}
            aria-description="Enter a duration in seconds (3 → 3secs), max 60"
          />
        </label>
      </div>

      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      {state === 'failed' && !error ? (
        <p className="text-[11px] text-neutral-500" aria-live="polite">
          Failed
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleExtract()}
          aria-busy={busy}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={busy || buttonProgress > 0 ? buttonProgress : undefined}
          className={cn(
            'relative flex-1 overflow-hidden rounded-lg px-3 py-2.5 text-xs font-semibold transition',
            busy || buttonProgress === 100
              ? 'bg-neutral-900 text-white'
              : 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40',
          )}
        >
          {(busy || buttonProgress === 100) && (
            <span
              className="pointer-events-none absolute inset-y-0 left-0 bg-[#5234d2] transition-[width] duration-150 ease-out"
              style={{ width: `${buttonProgress}%` }}
              aria-hidden
            />
          )}
          <span className="relative z-10 tabular-nums">
            {busy
              ? `Processing audio · ${buttonProgress}%`
              : buttonProgress === 100
                ? 'Done · 100%'
                : 'Extract audio'}
          </span>
        </button>
        {onCancelReplace ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancelReplace}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 disabled:opacity-40"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  )
}

function UploadAudioForm({
  editedDuration,
  preferredStartAtEditedS,
  onSuccess,
  onCancelReplace,
}: {
  editedDuration: number
  preferredStartAtEditedS?: number | null
  onSuccess: (clip: OverlayAudioClip, blob: Blob) => void
  onCancelReplace?: () => void
}) {
  const inputId = useId()
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<ExtractProgressState>('idle')

  const handleFile = async (file: File | null) => {
    setError(null)
    if (!file) return
    setState('validating')

    if (!file.type.startsWith('audio/') && !/\.(m4a|mp3|wav|ogg|aac)$/i.test(file.name)) {
      setState('failed')
      setError('Choose an audio file (m4a, mp3, wav, ogg).')
      return
    }
    if (file.size > OVERLAY_AUDIO_MAX_BYTES) {
      setState('failed')
      setError('File exceeds the 20 MB limit.')
      return
    }

    setState('processing')
    try {
      const durationSeconds = await readAudioDurationSeconds(file)
      const clamped = Math.min(OVERLAY_AUDIO_MAX_DURATION_S, Math.max(1, durationSeconds || 1))
      if (durationSeconds > OVERLAY_AUDIO_MAX_DURATION_S + 0.25) {
        setState('failed')
        setError(
          `Clip is longer than ${OVERLAY_AUDIO_MAX_DURATION_S}s. Trim the file first, or use YouTube extract with a duration.`,
        )
        return
      }
      const placement = defaultPlacementForClip(clamped)
      const clippedPlacement = clampPlacement(
        { sourceDurationS: clamped },
        preferredStartAtEditedS ?? placement.startAtEditedS,
        placement.durationS,
        editedDuration,
      )
      const clip: OverlayAudioClip = {
        id: crypto.randomUUID(),
        sourceType: 'upload',
        fileName: file.name,
        sourceDurationS: clamped,
        extractStartSeconds: 0,
        format: overlayFormatFromMime(file.type || 'audio/mpeg'),
        startAtEditedS: clippedPlacement.startAtEditedS,
        durationS: clippedPlacement.durationS,
        volume: 1,
        muted: false,
        createdAt: new Date().toISOString(),
      }
      onSuccess(clip, file)
      setState('ready')
    } catch (err) {
      setState('failed')
      setError(err instanceof Error ? err.message : 'Could not read that audio file.')
    }
  }

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-6 text-center"
      >
        <span className="text-xs font-medium text-neutral-700">Choose audio file</span>
        <span className="mt-1 text-[11px] text-neutral-500">m4a, mp3, wav, ogg</span>
        <input
          id={inputId}
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            void handleFile(file)
            event.target.value = ''
          }}
        />
      </label>
      {state === 'processing' || state === 'validating' ? (
        <p className="text-[11px] text-neutral-500" aria-live="polite">
          {state === 'validating' ? 'Validating' : 'Processing audio'}
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      {onCancelReplace ? (
        <button
          type="button"
          onClick={onCancelReplace}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600"
        >
          Cancel
        </button>
      ) : null}
    </div>
  )
}

function ReadyClipControls({
  clip,
  overlayAudioUrl,
  editedDuration,
  timelinePlaying,
  onPatch,
  onReplace,
  onRemove,
}: {
  clip: OverlayAudioClip
  overlayAudioUrl: string | null
  editedDuration: number
  timelinePlaying: boolean
  onPatch: (patch: Partial<EditorProject>) => void
  onReplace: () => void
  onRemove: () => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    // Panel preview is audition-only; mute it while the timeline drives the bed.
    if (timelinePlaying) {
      audio.pause()
      return
    }
    audio.volume = clip.muted ? 0 : clip.volume
  }, [clip.muted, clip.volume, timelinePlaying])

  const patchClip = (partial: Partial<OverlayAudioClip>) => {
    onPatch({ overlayAudio: { ...clip, ...partial } })
  }

  return (
    <div className="space-y-3">
      <PanelFieldHeading>Inserted audio</PanelFieldHeading>
      <p className="text-[11px] text-neutral-500">
        {clip.sourceType === 'youtube' ? 'From YouTube' : clip.fileName || 'Uploaded file'}
        {typeof clip.extractStartSeconds === 'number'
          ? ` · source @ ${Math.floor(clip.extractStartSeconds)}s`
          : null}
        {` · ${Math.round(clip.sourceDurationS)}s clip`}
      </p>

      {overlayAudioUrl ? (
        <audio
          ref={audioRef}
          src={overlayAudioUrl}
          controls
          className="w-full"
          preload="metadata"
        />
      ) : (
        <p className="text-[11px] text-amber-700">Audio blob missing — replace the clip.</p>
      )}

      <div>
        <PanelFieldHeading
          trailing={
            <span className="text-[11px] tabular-nums text-neutral-500">
              {clip.muted ? 'Muted' : `${Math.round(clip.volume * 100)}%`}
            </span>
          }
        >
          Clip volume
        </PanelFieldHeading>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clip.volume}
            disabled={clip.muted}
            onChange={(event) => patchClip({ volume: Number(event.target.value) })}
            className="w-full accent-[#5234d2] disabled:opacity-40"
            aria-label="Inserted audio volume"
          />
          <button
            type="button"
            onClick={() => patchClip({ muted: !clip.muted })}
            className={cn(
              'shrink-0 rounded-lg border px-2 py-1 text-[11px] font-medium transition',
              clip.muted
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-200 text-neutral-600 hover:border-neutral-300',
            )}
          >
            {clip.muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-neutral-700">Timeline start (s)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={Number(clip.startAtEditedS.toFixed(2))}
            onChange={(event) => {
              const startAtEditedS = Math.max(0, Number(event.target.value) || 0)
              const next = clampPlacement(clip, startAtEditedS, clip.durationS, editedDuration)
              patchClip(next)
            }}
            className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#5234d2]"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-neutral-700">Play length (s)</span>
          <input
            type="number"
            min={0.1}
            max={OVERLAY_AUDIO_MAX_DURATION_S}
            step={0.1}
            value={Number(clip.durationS.toFixed(2))}
            onChange={(event) => {
              const durationS = Math.max(0.1, Number(event.target.value) || 0.1)
              const next = clampPlacement(clip, clip.startAtEditedS, durationS, editedDuration)
              patchClip(next)
            }}
            className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#5234d2]"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReplace}
          className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

async function readAudioDurationSeconds(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  try {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = url
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve()
      audio.onerror = () => reject(new Error('Could not read audio duration.'))
    })
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      throw new Error('Could not read audio duration.')
    }
    return audio.duration
  } finally {
    URL.revokeObjectURL(url)
  }
}

function PanelFieldHeading({
  children,
  trailing,
}: {
  children: ReactNode
  trailing?: ReactNode
}) {
  if (trailing) {
    return (
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-neutral-800">{children}</p>
        {trailing}
      </div>
    )
  }
  return <p className="mb-2 text-xs font-medium text-neutral-800">{children}</p>
}
