import { extractWaveformPeaks, slicePeaksForSourceRange } from '@/lib/audio-waveform'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  assemblyToEdited,
  assemblyToSource,
  buildAssemblyPieces,
  editedToAssembly,
  getAssemblyDuration,
  type AssemblyPiece,
  type EditorBlackFrame,
  type EditorCutRange,
  type EditorProject,
  type OverlayAudioClip,
} from '@/types/editor-project'
import { AudioLines, Plus, Scissors, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** Half of the previous single-track height (`h-14` → `h-7`). */
const LANE_HEIGHT_CLASS = 'h-7'

interface CapCutTimelineProps {
  project: EditorProject
  sourceDuration: number
  timelineTime: number
  editedDuration: number
  /** When true, hover shows the scrub line but does not seek/pause. */
  isPlaying?: boolean
  /** Preferred source for waveform decode. */
  videoBlob?: Blob | null
  /** Fallback media URL when blob is unavailable. */
  videoUrl?: string | null
  onSeekTimeline: (timelineTime: number) => void
  /** Fast-forward preview while drafting a cut from start → current end. */
  onPreviewSource?: (cutStart: number, cutEnd: number) => void
  onChangeTrim: (trimStart: number, trimEnd: number) => void
  onAddCut: (cut: EditorCutRange) => void
  onUpdateCut: (cut: EditorCutRange) => void
  onAddBlackFrame: (frame: EditorBlackFrame) => void
  onUpdateBlackFrame: (frame: EditorBlackFrame) => void
  onRemoveCut: (id: string) => void
  onRemoveBlackFrame: (id: string) => void
  onDragChange?: (dragging: boolean) => void
  /** Click (no drag) on the timeline — seek and play from that edited time. */
  onPlayFromTimeline?: (editedTimeSeconds: number) => void
  /**
   * Place (or queue) inserted audio to start at this edited timeline time.
   * Fired from the + menu “Add audio” action.
   */
  onPlaceAudio?: (editedTimeSeconds: number) => void
  /** Edited-time cue when the user chose Add audio before a clip exists. */
  pendingAudioAtEditedS?: number | null
}

type DragMode =
  | 'playhead'
  | 'trimStart'
  | 'trimEnd'
  | 'cutEnd'
  | 'pieceStart'
  | 'pieceEnd'
  | null
type PlusMenuMode = 'pick' | 'cut' | 'frame' | null

const EDGE_HIT_RATIO = 0.02
const MIN_TRIM_SPAN = 0.2
const MIN_CUT_SPAN = 0.1
const MIN_FRAME_DURATION = 0.2

/**
 * CapCut-style trim bar:
 * - Outer track = full source recording
 * - Progress container = kept trim window (shrinks/grows with handles)
 * - Cuts / frames / playhead live inside that container
 */
export function CapCutTimeline({
  project,
  sourceDuration,
  timelineTime,
  editedDuration,
  isPlaying = false,
  videoBlob = null,
  videoUrl = null,
  onSeekTimeline,
  onPreviewSource,
  onChangeTrim,
  onAddCut,
  onUpdateCut,
  onAddBlackFrame,
  onUpdateBlackFrame,
  onRemoveCut,
  onRemoveBlackFrame,
  onDragChange,
  onPlayFromTimeline,
  onPlaceAudio,
  pendingAudioAtEditedS = null,
}: CapCutTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef(project)
  const cutDraftRef = useRef<{ start: number; end: number } | null>(null)
  const playheadGestureRef = useRef<{
    startX: number
    moved: boolean
    assembly: number
  } | null>(null)
  const trimGestureRef = useRef<{
    edge: 'start' | 'end'
    startX: number
    moved: boolean
    initialTrimStart: number
    initialTrimEnd: number
  } | null>(null)
  const cutGestureRef = useRef<{
    originX: number
    moved: boolean
    /** arming = Cut out still pressed; tracking = follow cursor until release. */
    phase: 'arming' | 'tracking'
  } | null>(null)
  const pieceEdgeGestureRef = useRef<{
    kind: 'cut' | 'black'
    id: string
    edge: 'start' | 'end'
    initialCutStart: number
    initialCutEnd: number
    initialAfterSourceTime: number
    initialDuration: number
    initialAssemblyStart: number
    initialAssemblyEnd: number
  } | null>(null)
  const cutSessionCleanupRef = useRef<(() => void) | null>(null)
  const sourceDurationRef = useRef(sourceDuration)
  const isPlayingRef = useRef(isPlaying)
  const hoverScrubRafRef = useRef<number | null>(null)
  const hoverScrubbingRef = useRef(false)
  const [hoverLocalRatio, setHoverLocalRatio] = useState<number | null>(null)
  const [dragMode, setDragMode] = useState<DragMode>(null)
  const [plusMenu, setPlusMenu] = useState<PlusMenuMode>(null)
  const [plusAtAssembly, setPlusAtAssembly] = useState(0)
  const [plusAtSource, setPlusAtSource] = useState(0)
  const [cutDraft, setCutDraft] = useState<{ start: number; end: number } | null>(null)
  const [frameDuration, setFrameDuration] = useState(1.5)
  const [activePieceEdge, setActivePieceEdge] = useState<{
    id: string
    edge: 'start' | 'end'
  } | null>(null)
  const [waveformPeaks, setWaveformPeaks] = useState<number[] | null>(null)

  projectRef.current = project
  cutDraftRef.current = cutDraft
  sourceDurationRef.current = sourceDuration
  isPlayingRef.current = isPlaying

  useEffect(() => {
    let cancelled = false
    const source = videoBlob ?? videoUrl
    if (!source) {
      setWaveformPeaks(null)
      return
    }

    setWaveformPeaks(null)
    void extractWaveformPeaks(source)
      .then((peaks) => {
        if (!cancelled) setWaveformPeaks(peaks)
      })
      .catch(() => {
        if (!cancelled) setWaveformPeaks(null)
      })

    return () => {
      cancelled = true
    }
  }, [videoBlob, videoUrl])

  useEffect(
    () => () => {
      cutSessionCleanupRef.current?.()
      cutSessionCleanupRef.current = null
      if (hoverScrubRafRef.current != null) {
        cancelAnimationFrame(hoverScrubRafRef.current)
        hoverScrubRafRef.current = null
      }
    },
    [],
  )

  const pieces = useMemo(() => buildAssemblyPieces(project), [project])
  const piecesRef = useRef(pieces)
  piecesRef.current = pieces
  const assemblyDuration = useMemo(() => getAssemblyDuration(project), [project])
  const span = Math.max(assemblyDuration, 0.01)
  const spanRef = useRef(span)
  spanRef.current = span

  const sourceSpan = Math.max(sourceDuration, 0.01)
  const trimStart = Math.max(0, Math.min(project.trimStart, sourceSpan))
  const trimEnd = Math.max(trimStart + MIN_TRIM_SPAN, Math.min(project.trimEnd, sourceSpan))
  const trimSpan = Math.max(trimEnd - trimStart, MIN_TRIM_SPAN)

  const clipLeftPct = (trimStart / sourceSpan) * 100
  const clipWidthPct = (trimSpan / sourceSpan) * 100

  const assemblyToTrackPct = useCallback(
    (assemblyTime: number) => {
      const local = Math.min(1, Math.max(0, assemblyTime / span))
      return clipLeftPct + local * clipWidthPct
    },
    [clipLeftPct, clipWidthPct, span],
  )

  const dismissPlusMenu = useCallback(() => {
    cutSessionCleanupRef.current?.()
    cutSessionCleanupRef.current = null
    setCutDraft(null)
    setPlusMenu(null)
    setDragMode(null)
    trimGestureRef.current = null
    cutGestureRef.current = null
    cutDraftRef.current = null
    pieceEdgeGestureRef.current = null
    setActivePieceEdge(null)
    hoverScrubbingRef.current = false
    onDragChange?.(false)
  }, [onDragChange])

  useEffect(() => {
    if (!plusMenu) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (plusMenuRef.current?.contains(target)) return
      if ((target as HTMLElement).closest?.('[data-plus-anchor]')) return
      if (plusMenu === 'cut' || dragMode === 'cutEnd') return
      dismissPlusMenu()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissPlusMenu()
    }

    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown, true)
    }, 0)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [plusMenu, dragMode, dismissPlusMenu])

  const clientXToTrackRatio = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(rect.width, 1)))
  }, [])

  const sourceFromClientX = useCallback(
    (clientX: number) => clientXToTrackRatio(clientX) * sourceDurationRef.current,
    [clientXToTrackRatio],
  )

  /** Map a track X into assembly time inside the trim window. */
  const assemblyFromClientX = useCallback(
    (clientX: number) => {
      const source = sourceFromClientX(clientX)
      const { trimStart: start, trimEnd: end } = projectRef.current
      const windowSpan = Math.max(MIN_TRIM_SPAN, end - start)
      const clamped = Math.min(end, Math.max(start, source))
      return ((clamped - start) / windowSpan) * spanRef.current
    },
    [sourceFromClientX],
  )

  const seekFromAssembly = useCallback(
    (assemblyTime: number) => {
      onSeekTimeline(assemblyToEdited(projectRef.current, assemblyTime))
    },
    [onSeekTimeline],
  )

  const stopHoverScrub = useCallback(() => {
    if (hoverScrubRafRef.current != null) {
      cancelAnimationFrame(hoverScrubRafRef.current)
      hoverScrubRafRef.current = null
    }
    if (hoverScrubbingRef.current) {
      hoverScrubbingRef.current = false
      onDragChange?.(false)
    }
  }, [onDragChange])

  useEffect(() => {
    if (isPlaying) stopHoverScrub()
  }, [isPlaying, stopHoverScrub])

  /** Live-render the frame under the hover/plus line (skips cuts + black frames). */
  const previewHoverAssembly = useCallback(
    (assemblyTime: number) => {
      // Playing: keep the scrub line UI, but never seek/pause from hover alone.
      if (isPlayingRef.current) {
        stopHoverScrub()
        return
      }

      const overCutOrFrame = piecesRef.current.some(
        (piece) =>
          piece.kind !== 'video' &&
          assemblyTime >= piece.assemblyStart &&
          assemblyTime < piece.assemblyEnd,
      )
      if (overCutOrFrame) {
        stopHoverScrub()
        return
      }

      if (!hoverScrubbingRef.current) {
        hoverScrubbingRef.current = true
        onDragChange?.(true)
      }

      if (hoverScrubRafRef.current != null) cancelAnimationFrame(hoverScrubRafRef.current)
      hoverScrubRafRef.current = requestAnimationFrame(() => {
        hoverScrubRafRef.current = null
        seekFromAssembly(assemblyTime)
      })
    },
    [onDragChange, seekFromAssembly, stopHoverScrub],
  )

  const finishCutSession = useCallback(
    (commit: boolean) => {
      cutSessionCleanupRef.current?.()
      cutSessionCleanupRef.current = null

      if (commit) {
        const draft = cutDraftRef.current
        if (draft) {
          const start = Math.min(draft.start, draft.end)
          const end = Math.max(draft.start, draft.end)
          if (end - start >= 0.1) {
            onAddCut({ id: crypto.randomUUID(), start, end })
          }
        }
      }

      cutGestureRef.current = null
      cutDraftRef.current = null
      setCutDraft(null)
      setPlusMenu(null)
      setDragMode(null)
      onDragChange?.(false)
    },
    [onAddCut, onDragChange],
  )

  const beginCutGesture = useCallback(
    (startSource: number, clientX: number) => {
      cutSessionCleanupRef.current?.()
      cutSessionCleanupRef.current = null

      const end = Math.min(sourceDuration, Math.max(0, sourceFromClientX(clientX)))
      const draft = { start: startSource, end }
      cutDraftRef.current = draft
      cutGestureRef.current = { originX: clientX, moved: false, phase: 'arming' }
      setCutDraft(draft)
      setPlusMenu('cut')
      setDragMode('cutEnd')
      onDragChange?.(true)
      onPreviewSource?.(startSource, end)

      // Attach immediately so the Cut out press’s pointerup is never missed.
      const onMove = (event: PointerEvent) => {
        const gesture = cutGestureRef.current
        const current = cutDraftRef.current
        if (!gesture || !current) return
        if (Math.abs(event.clientX - gesture.originX) > 3) gesture.moved = true
        const nextEnd = Math.min(
          sourceDurationRef.current,
          Math.max(0, sourceFromClientX(event.clientX)),
        )
        const next = { start: current.start, end: nextEnd }
        cutDraftRef.current = next
        setCutDraft(next)
        onPreviewSource?.(current.start, nextEnd)
      }

      const onUp = () => {
        const gesture = cutGestureRef.current
        if (!gesture) return

        if (gesture.phase === 'arming') {
          // Press released on the menu (or after a tiny tap): keep tracking as
          // if the cursor is still held — move extends the cut, next up commits.
          // If they already dragged while holding Cut out, finalize now.
          if (gesture.moved) {
            const current = cutDraftRef.current
            const span = current ? Math.abs(current.end - current.start) : 0
            if (span >= 0.1) {
              finishCutSession(true)
              return
            }
          }
          gesture.phase = 'tracking'
          return
        }

        finishCutSession(true)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      cutSessionCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    },
    [
      finishCutSession,
      onDragChange,
      onPreviewSource,
      sourceDuration,
      sourceFromClientX,
    ],
  )

  const beginTrimGesture = useCallback(
    (edge: 'start' | 'end', clientX: number, pointerId?: number, target?: HTMLElement) => {
      trimGestureRef.current = {
        edge,
        startX: clientX,
        moved: false,
        initialTrimStart: projectRef.current.trimStart,
        initialTrimEnd: projectRef.current.trimEnd,
      }
      cutGestureRef.current = null
      pieceEdgeGestureRef.current = null
      setActivePieceEdge(null)
      if (pointerId != null && target?.setPointerCapture) {
        try {
          target.setPointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      setPlusMenu(null)
      setCutDraft(null)
      setDragMode(edge === 'start' ? 'trimStart' : 'trimEnd')
      onDragChange?.(true)
    },
    [onDragChange],
  )

  const beginPieceEdgeGesture = useCallback(
    (
      piece: Extract<AssemblyPiece, { kind: 'cut' | 'black' }>,
      edge: 'start' | 'end',
      pointerId?: number,
      target?: HTMLElement,
    ) => {
      stopHoverScrub()
      cutGestureRef.current = null
      trimGestureRef.current = null
      pieceEdgeGestureRef.current = {
        kind: piece.kind,
        id: piece.id,
        edge,
        initialCutStart: piece.kind === 'cut' ? piece.sourceStart : 0,
        initialCutEnd: piece.kind === 'cut' ? piece.sourceEnd : 0,
        initialAfterSourceTime: piece.kind === 'black' ? piece.holdSourceTime : 0,
        initialDuration: piece.duration,
        initialAssemblyStart: piece.assemblyStart,
        initialAssemblyEnd: piece.assemblyEnd,
      }
      setActivePieceEdge({ id: piece.id, edge })
      if (pointerId != null && target?.setPointerCapture) {
        try {
          target.setPointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      setPlusMenu(null)
      setCutDraft(null)
      setHoverLocalRatio(null)
      setDragMode(edge === 'start' ? 'pieceStart' : 'pieceEnd')
      onDragChange?.(true)

      // Show the frame under this edge immediately (frames are a single hold).
      if (piece.kind === 'cut') {
        const at = edge === 'start' ? piece.sourceStart : piece.sourceEnd
        onPreviewSource?.(at, at)
      } else {
        onPreviewSource?.(piece.holdSourceTime, piece.holdSourceTime)
      }
    },
    [onDragChange, onPreviewSource, stopHoverScrub],
  )

  const beginPlayheadGesture = useCallback(
    (clientX: number) => {
      stopHoverScrub()
      const assembly = assemblyFromClientX(clientX)
      playheadGestureRef.current = { startX: clientX, moved: false, assembly }
      seekFromAssembly(assembly)
      setDragMode('playhead')
      // Delay onDragChange until the pointer actually moves — a click should play, not pause.
    },
    [assemblyFromClientX, seekFromAssembly, stopHoverScrub],
  )

  useEffect(() => {
    // Cut sessions attach their own listeners in beginCutGesture.
    if (!dragMode || dragMode === 'cutEnd') return

    const TRIM_CLICK_SLOP_PX = 4
    const mode = dragMode

    const onMove = (event: PointerEvent) => {
      if (mode === 'playhead') {
        const gesture = playheadGestureRef.current
        const assembly = assemblyFromClientX(event.clientX)
        if (gesture) {
          if (!gesture.moved && Math.abs(event.clientX - gesture.startX) > TRIM_CLICK_SLOP_PX) {
            gesture.moved = true
            onDragChange?.(true)
          }
          gesture.assembly = assembly
        }
        seekFromAssembly(assembly)
        return
      }

      if (mode === 'trimStart' || mode === 'trimEnd') {
        const gesture = trimGestureRef.current
        if (!gesture) return
        const deltaX = event.clientX - gesture.startX
        if (!gesture.moved) {
          if (Math.abs(deltaX) <= TRIM_CLICK_SLOP_PX) return
          gesture.moved = true
        }

        // Absolute source mapping on the full-recording track so the progress
        // container shrinks/grows under the handle (CapCut-style).
        const source = sourceFromClientX(event.clientX)
        if (mode === 'trimStart') {
          const nextStart = Math.min(
            gesture.initialTrimEnd - MIN_TRIM_SPAN,
            Math.max(0, source),
          )
          onChangeTrim(nextStart, gesture.initialTrimEnd)
          onPreviewSource?.(nextStart, nextStart)
        } else {
          const nextEnd = Math.max(
            gesture.initialTrimStart + MIN_TRIM_SPAN,
            Math.min(sourceDurationRef.current, source),
          )
          onChangeTrim(gesture.initialTrimStart, nextEnd)
          onPreviewSource?.(nextEnd, nextEnd)
        }
        return
      }

      if (mode === 'pieceStart' || mode === 'pieceEnd') {
        const gesture = pieceEdgeGestureRef.current
        if (!gesture) return

        const { trimStart: tStart, trimEnd: tEnd } = projectRef.current
        const source = sourceFromClientX(event.clientX)
        const assembly = assemblyFromClientX(event.clientX)

        if (gesture.kind === 'cut') {
          if (gesture.edge === 'start') {
            const nextStart = Math.min(
              gesture.initialCutEnd - MIN_CUT_SPAN,
              Math.max(tStart, source),
            )
            onUpdateCut({
              id: gesture.id,
              start: nextStart,
              end: gesture.initialCutEnd,
            })
            onPreviewSource?.(nextStart, nextStart)
          } else {
            const nextEnd = Math.max(
              gesture.initialCutStart + MIN_CUT_SPAN,
              Math.min(tEnd, source),
            )
            onUpdateCut({
              id: gesture.id,
              start: gesture.initialCutStart,
              end: nextEnd,
            })
            onPreviewSource?.(nextEnd, nextEnd)
          }
          return
        }

        // Black frame: length from either edge; insert point follows start.
        // Preview is always the hold frame (start == end for frames).
        if (gesture.edge === 'end') {
          const nextDuration = Math.max(
            MIN_FRAME_DURATION,
            assembly - gesture.initialAssemblyStart,
          )
          onUpdateBlackFrame({
            id: gesture.id,
            afterSourceTime: gesture.initialAfterSourceTime,
            durationS: nextDuration,
          })
          onPreviewSource?.(gesture.initialAfterSourceTime, gesture.initialAfterSourceTime)
        } else {
          const nextDuration = Math.max(
            MIN_FRAME_DURATION,
            gesture.initialAssemblyEnd - assembly,
          )
          const nextAfter = Math.min(tEnd, Math.max(tStart, source))
          onUpdateBlackFrame({
            id: gesture.id,
            afterSourceTime: nextAfter,
            durationS: nextDuration,
          })
          onPreviewSource?.(nextAfter, nextAfter)
        }
      }
    }

    const onUp = () => {
      if (
        (mode === 'trimStart' || mode === 'trimEnd') &&
        trimGestureRef.current &&
        !trimGestureRef.current.moved
      ) {
        seekFromAssembly(mode === 'trimStart' ? 0 : spanRef.current)
      }

      if (mode === 'playhead') {
        const gesture = playheadGestureRef.current
        playheadGestureRef.current = null
        setDragMode(null)
        if (gesture && !gesture.moved) {
          onPlayFromTimeline?.(assemblyToEdited(projectRef.current, gesture.assembly))
        } else {
          onDragChange?.(false)
        }
        return
      }

      trimGestureRef.current = null
      pieceEdgeGestureRef.current = null
      setActivePieceEdge(null)
      setDragMode(null)
      onDragChange?.(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [
    dragMode,
    assemblyFromClientX,
    seekFromAssembly,
    sourceFromClientX,
    onChangeTrim,
    onPreviewSource,
    onDragChange,
    onPlayFromTimeline,
    onUpdateCut,
    onUpdateBlackFrame,
  ])

  const playheadTrackPct = assemblyToTrackPct(editedToAssembly(project, timelineTime))
  const plusLocalRatio =
    plusMenu != null ? Math.min(1, Math.max(0, plusAtAssembly / span)) : hoverLocalRatio
  const nearClipEdge =
    plusLocalRatio != null &&
    (plusLocalRatio <= EDGE_HIT_RATIO || plusLocalRatio >= 1 - EDGE_HIT_RATIO)
  const hoverAssembly = plusLocalRatio != null ? plusLocalRatio * span : null
  const hoveringCutOrFrame =
    plusMenu == null &&
    hoverAssembly != null &&
    pieces.some(
      (piece) =>
        piece.kind !== 'video' &&
        hoverAssembly >= piece.assemblyStart &&
        hoverAssembly < piece.assemblyEnd,
    )
  const showPlus =
    plusLocalRatio != null &&
    (plusMenu != null || (!dragMode && !nearClipEdge && !hoveringCutOrFrame))
  const plusTrackPct =
    plusLocalRatio != null ? clipLeftPct + plusLocalRatio * clipWidthPct : null
  const showHoverPlayLine =
    showPlus && plusTrackPct != null && dragMode !== 'playhead'
  /** Hide the solid playhead while the + scrub line is up, or over cut/frame edges. */
  const showPlayhead =
    !showHoverPlayLine &&
    !hoveringCutOrFrame &&
    dragMode !== 'pieceStart' &&
    dragMode !== 'pieceEnd'

  const cutDraftStyle = useMemo(() => {
    if (!cutDraft) return null

    const toAssembly = (source: number) => {
      const hit = pieces.find(
        (piece) =>
          (piece.kind === 'video' || piece.kind === 'cut') &&
          source >= piece.sourceStart &&
          source <= piece.sourceEnd,
      )
      if (!hit || hit.kind === 'black') return editedToAssembly(project, timelineTime)
      return hit.assemblyStart + (source - hit.sourceStart)
    }

    const startA = Math.min(toAssembly(cutDraft.start), toAssembly(cutDraft.end))
    const endA = Math.max(toAssembly(cutDraft.start), toAssembly(cutDraft.end))
    return {
      left: `${assemblyToTrackPct(startA)}%`,
      width: `${Math.max(0, assemblyToTrackPct(endA) - assemblyToTrackPct(startA))}%`,
    }
  }, [assemblyToTrackPct, cutDraft, pieces, project, timelineTime])

  const showInsertedAudioLane = project.overlayAudio != null || pendingAudioAtEditedS != null
  const resizeCursor =
    dragMode === 'trimStart' ||
    dragMode === 'trimEnd' ||
    dragMode === 'cutEnd' ||
    dragMode === 'pieceStart' ||
    dragMode === 'pieceEnd'
      ? 'cursor-ew-resize'
      : 'cursor-pointer'

  return (
    <div className="relative z-30 w-full select-none overflow-visible">
      <div
        ref={trackRef}
        className={cn('relative flex w-full flex-col gap-1 overflow-visible', resizeCursor)}
        onPointerMove={(event) => {
          if (dragMode || plusMenu) return
          const source = sourceFromClientX(event.clientX)
          if (source < trimStart || source > trimEnd) {
            setHoverLocalRatio(null)
            stopHoverScrub()
            return
          }
          const ratio = (source - trimStart) / trimSpan
          setHoverLocalRatio(ratio)
          previewHoverAssembly(ratio * span)
        }}
        onPointerLeave={() => {
          if (!plusMenu && !dragMode) {
            setHoverLocalRatio(null)
            stopHoverScrub()
          }
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('[data-timeline-chrome]')) return
          if (plusMenu || dragMode === 'cutEnd') return

          const source = sourceFromClientX(event.clientX)
          const edgeTolerance = sourceSpan * EDGE_HIT_RATIO

          if (Math.abs(source - trimStart) <= edgeTolerance) {
            beginTrimGesture('start', event.clientX, event.pointerId, event.currentTarget)
            return
          }
          if (Math.abs(source - trimEnd) <= edgeTolerance) {
            beginTrimGesture('end', event.clientX, event.pointerId, event.currentTarget)
            return
          }

          if (source < trimStart || source > trimEnd) return

          beginPlayheadGesture(event.clientX)
        }}
      >
        {/* Video lane */}
        <TimelineLane>
          <DiscardedRegions
            trimStart={trimStart}
            trimEnd={trimEnd}
            sourceSpan={sourceSpan}
            clipLeftPct={clipLeftPct}
            clipWidthPct={clipWidthPct}
          />
          <div
            className="absolute inset-y-1 z-[1] overflow-hidden rounded-md ring-1 ring-[#5234d2]/35"
            style={{ left: `${clipLeftPct}%`, width: `${clipWidthPct}%` }}
          >
            <div className="pointer-events-none absolute inset-0 flex">
              {pieces.length === 0 ? (
                <div className="h-full w-full bg-[#5234d2]/35" />
              ) : (
                pieces.map((piece) => (
                  <AssemblySegment key={pieceKey(piece)} piece={piece} span={span} />
                ))
              )}
            </div>
          </div>
          {cutDraft && cutDraftStyle ? (
            <div
              className="pointer-events-none absolute inset-y-1 z-[2] rounded-md bg-red-500/45 ring-1 ring-red-600"
              style={cutDraftStyle}
            />
          ) : null}
        </TimelineLane>

        {/* Video audio (waveform) lane */}
        <TimelineLane>
          <DiscardedRegions
            trimStart={trimStart}
            trimEnd={trimEnd}
            sourceSpan={sourceSpan}
            clipLeftPct={clipLeftPct}
            clipWidthPct={clipWidthPct}
          />
          <div
            className="absolute inset-y-1 z-[1] overflow-hidden rounded-md bg-[#5234d2]/10 ring-1 ring-[#5234d2]/20"
            style={{ left: `${clipLeftPct}%`, width: `${clipWidthPct}%` }}
          >
            <div className="pointer-events-none absolute inset-0 flex items-center">
              {pieces.length === 0 ? (
                <WaveformFallback className="w-full" />
              ) : (
                pieces.map((piece) => (
                  <AudioAssemblySegment
                    key={`audio-${pieceKey(piece)}`}
                    piece={piece}
                    span={span}
                    peaks={waveformPeaks}
                    sourceDuration={sourceDuration}
                  />
                ))
              )}
            </div>
          </div>
        </TimelineLane>

        {/* Inserted audio lane */}
        {showInsertedAudioLane ? (
          <TimelineLane>
            {project.overlayAudio ? (
              <InsertedAudioBed
                project={project}
                clip={project.overlayAudio}
                assemblyToTrackPct={assemblyToTrackPct}
              />
            ) : pendingAudioAtEditedS != null ? (
              <PendingAudioCue
                project={project}
                editedTime={pendingAudioAtEditedS}
                assemblyToTrackPct={assemblyToTrackPct}
              />
            ) : null}
          </TimelineLane>
        ) : null}

        {/* Shared chrome spanning all lanes */}
        {pieces.map((piece) => {
          if (piece.kind === 'video') return null
          const left = assemblyToTrackPct(piece.assemblyStart)
          const right = assemblyToTrackPct(piece.assemblyEnd)
          const handleColor =
            piece.kind === 'cut' ? 'bg-red-500 ring-red-500/25' : 'bg-neutral-900 ring-neutral-900/25'
          const startActive =
            activePieceEdge?.id === piece.id && activePieceEdge.edge === 'start'
          const endActive = activePieceEdge?.id === piece.id && activePieceEdge.edge === 'end'
          return (
            <div
              key={`hit-${pieceKey(piece)}`}
              className="group absolute inset-y-0 z-[18]"
              style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
            >
              <button
                type="button"
                data-timeline-chrome
                aria-label={piece.kind === 'cut' ? 'Remove cut and restore footage' : 'Remove frame'}
                className="absolute left-1/2 top-1/2 z-[1] flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-white text-neutral-800 opacity-0 shadow-sm ring-1 ring-neutral-200 transition group-hover:opacity-100 hover:bg-neutral-50"
                onClick={(event) => {
                  event.stopPropagation()
                  if (piece.kind === 'cut') onRemoveCut(piece.id)
                  else onRemoveBlackFrame(piece.id)
                }}
              >
                <Trash2
                  className={cn('size-3', piece.kind === 'cut' && 'text-red-600')}
                  strokeWidth={2.25}
                />
              </button>

              <div
                data-timeline-chrome
                role="slider"
                aria-label={piece.kind === 'cut' ? 'Resize cut start' : 'Resize frame start'}
                className="absolute inset-y-0 left-0 z-[2] w-8 -translate-x-1/2 cursor-ew-resize touch-none"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  beginPieceEdgeGesture(piece, 'start', event.pointerId, event.currentTarget)
                }}
              >
                <div
                  className={cn(
                    'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-all',
                    handleColor,
                    startActive ? 'h-8 w-2 ring-4' : 'h-6 w-1',
                  )}
                />
              </div>

              <div
                data-timeline-chrome
                role="slider"
                aria-label={piece.kind === 'cut' ? 'Resize cut end' : 'Resize frame end'}
                className="absolute inset-y-0 right-0 z-[2] w-8 translate-x-1/2 cursor-ew-resize touch-none"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  beginPieceEdgeGesture(piece, 'end', event.pointerId, event.currentTarget)
                }}
              >
                <div
                  className={cn(
                    'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-all',
                    handleColor,
                    endActive ? 'h-8 w-2 ring-4' : 'h-6 w-1',
                  )}
                />
              </div>
            </div>
          )
        })}

        <div
          data-timeline-chrome
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={trimEnd - MIN_TRIM_SPAN}
          aria-valuenow={trimStart}
          className="absolute inset-y-0 z-20 w-8 -translate-x-1/2 cursor-ew-resize touch-none"
          style={{ left: `${clipLeftPct}%` }}
          onPointerDown={(event) => {
            event.stopPropagation()
            event.preventDefault()
            beginTrimGesture('start', event.clientX, event.pointerId, event.currentTarget)
          }}
        >
          <div
            className={cn(
              'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5234d2] shadow transition-all',
              dragMode === 'trimStart' ? 'h-8 w-2 ring-4 ring-[#5234d2]/25' : 'h-6 w-1',
            )}
          />
        </div>

        <div
          data-timeline-chrome
          role="slider"
          aria-label="Trim end"
          aria-valuemin={trimStart + MIN_TRIM_SPAN}
          aria-valuemax={sourceSpan}
          aria-valuenow={trimEnd}
          className="absolute inset-y-0 z-20 w-8 -translate-x-1/2 cursor-ew-resize touch-none"
          style={{ left: `${clipLeftPct + clipWidthPct}%` }}
          onPointerDown={(event) => {
            event.stopPropagation()
            event.preventDefault()
            beginTrimGesture('end', event.clientX, event.pointerId, event.currentTarget)
          }}
        >
          <div
            className={cn(
              'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5234d2] shadow transition-all',
              dragMode === 'trimEnd' ? 'h-8 w-2 ring-4 ring-[#5234d2]/25' : 'h-6 w-1',
            )}
          />
        </div>

        {showPlayhead ? (
          <div
            data-timeline-chrome
            role="slider"
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={editedDuration}
            aria-valuenow={timelineTime}
            className="absolute inset-y-0 z-[8] -translate-x-1/2 cursor-ew-resize touch-none"
            style={{ left: `${playheadTrackPct}%`, width: 20 }}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              beginPlayheadGesture(event.clientX)
            }}
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-neutral-900" />
          </div>
        ) : null}

        {showHoverPlayLine ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-[9]"
            style={{ left: `${plusTrackPct}%` }}
          >
            <div className="absolute left-1/2 top-2 bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-[#5234d2]" />
            <div
              data-timeline-chrome
              data-plus-anchor
              className="pointer-events-auto absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2"
            >
              <button
                type="button"
                className="flex size-5 items-center justify-center rounded-md bg-white text-[#5234d2] shadow-sm ring-1 ring-neutral-200 transition hover:bg-[#5234d2] hover:text-white"
                aria-label="Add cut, frame, or audio"
                aria-expanded={plusMenu != null}
                aria-haspopup="menu"
                onClick={(event) => {
                  event.stopPropagation()
                  if (plusMenu) {
                    dismissPlusMenu()
                    return
                  }
                  const atAssembly = plusLocalRatio! * span
                  const atSource = assemblyToSource(project, atAssembly)
                  setPlusAtAssembly(atAssembly)
                  setPlusAtSource(atSource)
                  setPlusMenu('pick')
                  seekFromAssembly(atAssembly)
                }}
              >
                <Plus className="size-3" strokeWidth={2.5} />
              </button>

              {plusMenu ? (
                <div
                  ref={plusMenuRef}
                  role="menu"
                  aria-label="Insert action"
                  className={cn(
                    'absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg',
                    plusMenu === 'frame' || plusMenu === 'cut' ? 'w-40' : 'w-max',
                  )}
                >
                  {plusMenu === 'pick' ? (
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                        onPointerDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          beginCutGesture(plusAtSource, event.clientX)
                        }}
                      >
                        <Scissors className="size-3.5 shrink-0 text-neutral-500" strokeWidth={2} />
                        Cut out
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                        onClick={() => setPlusMenu('frame')}
                      >
                        <Square className="size-3.5 shrink-0 text-neutral-500" strokeWidth={2} />
                        Add frame
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                        onClick={() => {
                          const editedTime = assemblyToEdited(project, plusAtAssembly)
                          onPlaceAudio?.(Math.max(0, Math.min(editedTime, editedDuration)))
                          dismissPlusMenu()
                        }}
                      >
                        <AudioLines className="size-3.5 shrink-0 text-neutral-500" strokeWidth={2} />
                        Add audio
                      </button>
                    </div>
                  ) : null}

                  {plusMenu === 'cut' ? (
                    <div className="space-y-1 px-2.5 py-2 text-xs text-neutral-700">
                      <p className="font-medium">Cutting out…</p>
                      <p className="text-[10px] text-neutral-500">
                        Move to set the end, release to apply.
                      </p>
                    </div>
                  ) : null}

                  {plusMenu === 'frame' ? (
                    <div className="space-y-2.5 px-2.5 py-2">
                      <p className="text-xs font-medium text-neutral-900">Frame length</p>
                      <label className="block text-[10px] text-neutral-500">
                        {frameDuration.toFixed(1)}s
                        <input
                          type="range"
                          min={0.5}
                          max={8}
                          step={0.1}
                          value={frameDuration}
                          onChange={(event) => setFrameDuration(Number(event.target.value))}
                          className="mt-1.5 w-full accent-[#5234d2]"
                        />
                      </label>
                      <button
                        type="button"
                        className="w-full rounded-lg bg-[#5234d2] px-2.5 py-2 text-[11px] font-semibold text-white"
                        onClick={() => {
                          onAddBlackFrame({
                            id: crypto.randomUUID(),
                            afterSourceTime: plusAtSource,
                            durationS: frameDuration,
                          })
                          setPlusMenu(null)
                        }}
                      >
                        Add
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-neutral-500">
        <span>{formatDuration(Math.floor(timelineTime))}</span>
        <span>{formatDuration(Math.floor(editedDuration))}</span>
      </div>
    </div>
  )
}

function pieceKey(piece: AssemblyPiece): string {
  if (piece.kind === 'video') return `video-${piece.sourceStart}-${piece.sourceEnd}`
  return `${piece.kind}-${piece.id}`
}

function TimelineLane({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'relative w-full overflow-visible rounded-lg bg-neutral-100 ring-1 ring-neutral-200',
        LANE_HEIGHT_CLASS,
      )}
    >
      {children}
    </div>
  )
}

function DiscardedRegions({
  trimStart,
  trimEnd,
  sourceSpan,
  clipLeftPct,
  clipWidthPct,
}: {
  trimStart: number
  trimEnd: number
  sourceSpan: number
  clipLeftPct: number
  clipWidthPct: number
}) {
  return (
    <>
      {trimStart > 0.01 ? (
        <div
          className="pointer-events-none absolute inset-y-1 left-0 rounded-l-md bg-neutral-200/80"
          style={{ width: `${clipLeftPct}%` }}
        />
      ) : null}
      {trimEnd < sourceSpan - 0.01 ? (
        <div
          className="pointer-events-none absolute inset-y-1 right-0 rounded-r-md bg-neutral-200/80"
          style={{ width: `${100 - clipLeftPct - clipWidthPct}%` }}
        />
      ) : null}
    </>
  )
}

function WaveformFallback({ className }: { className?: string }) {
  return <div className={cn('h-1/2 rounded-sm bg-[#5234d2]/40', className)} />
}

function AudioAssemblySegment({
  piece,
  span,
  peaks,
  sourceDuration,
}: {
  piece: AssemblyPiece
  span: number
  peaks: number[] | null
  sourceDuration: number
}) {
  const widthPct = (piece.duration / span) * 100

  if (piece.kind === 'cut') {
    return (
      <div
        className="h-full shrink-0 bg-red-400/25"
        style={{ width: `${widthPct}%` }}
        title={`Cut out ${formatDuration(Math.floor(piece.sourceStart))}–${formatDuration(Math.floor(piece.sourceEnd))}`}
      />
    )
  }

  if (piece.kind === 'black') {
    return (
      <div
        className="h-full shrink-0 bg-neutral-900/40"
        style={{ width: `${widthPct}%` }}
        title={`Frame ${piece.duration.toFixed(1)}s`}
      />
    )
  }

  const slice =
    peaks && peaks.length > 0
      ? slicePeaksForSourceRange(peaks, piece.sourceStart, piece.sourceEnd, sourceDuration)
      : null

  if (!slice || slice.length === 0) {
    return (
      <div className="flex h-full shrink-0 items-center px-0.5" style={{ width: `${widthPct}%` }}>
        <WaveformFallback className="w-full" />
      </div>
    )
  }

  return (
    <div
      className="flex h-full shrink-0 items-center gap-px px-0.5"
      style={{ width: `${widthPct}%` }}
      title={`Audio ${formatDuration(Math.floor(piece.sourceStart))}–${formatDuration(Math.floor(piece.sourceEnd))}`}
    >
      {slice.map((peak, index) => (
        <div
          key={index}
          className="min-w-px flex-1 rounded-[1px] bg-[#5234d2]/75"
          style={{ height: `${Math.max(12, peak * 100)}%` }}
        />
      ))}
    </div>
  )
}

function InsertedAudioBed({
  project,
  clip,
  assemblyToTrackPct,
}: {
  project: EditorProject
  clip: OverlayAudioClip
  assemblyToTrackPct: (assemblyTime: number) => number
}) {
  const startA = editedToAssembly(project, clip.startAtEditedS)
  const endA = editedToAssembly(project, clip.startAtEditedS + clip.durationS)
  const left = assemblyToTrackPct(Math.min(startA, endA))
  const right = assemblyToTrackPct(Math.max(startA, endA))
  const width = Math.max(0.6, right - left)

  return (
    <div
      className="pointer-events-none absolute inset-y-1 z-[3] overflow-hidden rounded-md"
      style={{ left: `${left}%`, width: `${width}%` }}
      title={`Inserted audio · starts ${clip.startAtEditedS.toFixed(1)}s · ${clip.durationS.toFixed(1)}s`}
    >
      <div className="absolute inset-0 bg-emerald-400/35" />
      <div className="absolute inset-y-0 left-0 w-0.5 bg-emerald-600" />
      <div className="absolute inset-x-0 bottom-0 top-1/3 rounded-sm bg-emerald-500/85" />
    </div>
  )
}

function PendingAudioCue({
  project,
  editedTime,
  assemblyToTrackPct,
}: {
  project: EditorProject
  editedTime: number
  assemblyToTrackPct: (assemblyTime: number) => number
}) {
  const left = assemblyToTrackPct(editedToAssembly(project, editedTime))
  return (
    <div
      className="pointer-events-none absolute inset-y-1 z-[3] -translate-x-1/2"
      style={{ left: `${left}%` }}
      title={`Audio cue at ${editedTime.toFixed(1)}s — assign a clip in the Audio panel`}
    >
      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-emerald-600" />
      <div className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600 ring-2 ring-white" />
    </div>
  )
}

function AssemblySegment({ piece, span }: { piece: AssemblyPiece; span: number }) {
  const widthPct = (piece.duration / span) * 100

  if (piece.kind === 'cut') {
    return (
      <div
        className="h-full shrink-0 bg-red-400/70"
        style={{ width: `${widthPct}%` }}
        title={`Cut out ${formatDuration(Math.floor(piece.sourceStart))}–${formatDuration(Math.floor(piece.sourceEnd))}`}
      />
    )
  }

  if (piece.kind === 'black') {
    return (
      <div
        className="relative h-full shrink-0 bg-neutral-900"
        style={{ width: `${widthPct}%` }}
        title={`Frame ${piece.duration.toFixed(1)}s`}
      >
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 truncate px-0.5 text-center text-[9px] font-medium text-white/90">
          {piece.duration.toFixed(1)}s
        </span>
      </div>
    )
  }

  return (
    <div
      className="h-full shrink-0 bg-[#5234d2]/35"
      style={{ width: `${widthPct}%` }}
      title={`Clip ${formatDuration(Math.floor(piece.sourceStart))}–${formatDuration(Math.floor(piece.sourceEnd))}`}
    />
  )
}
