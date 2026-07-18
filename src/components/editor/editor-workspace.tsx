import { CapCutTimeline } from '@/components/editor/capcut-timeline'
import { IntroOverlay, OutroOverlay, TransitionOverlay } from '@/components/editor/editor-overlays'
import { InsertAudioPanel } from '@/components/editor/insert-audio-panel'
import { PublishButton } from '@/components/PublishButton'
import type { LibraryAssetView } from '@/context/asset-library-context'
import { parseAspectRatio } from '@/lib/recording-session-state'
import { clampPlacement } from '@/lib/overlay-audio'
import type { UploadResult } from '@/lib/types/youtube'
import { cn } from '@/lib/utils'
import type { SessionYouTubeMetadata } from '@/types/session'
import {
  clampSourceToKept,
  EDITOR_TRANSITIONS,
  findSegmentAtTimeline,
  getEditedDuration,
  mergeCuts,
  normalizeEditorProject,
  resolvePlayableTimeline,
  sourceToTimeline,
  transitionProgressAt,
  effectiveRecordingGain,
  type EditorBlackFrame,
  type EditorCutRange,
  type EditorProject,
  type EditorTransitionType,
  type OverlayAudioClip,
} from '@/types/editor-project'
import {
  ArrowLeft,
  AudioLines,
  Link2,
  Pause,
  Play,
  Scissors,
  Sticker,
  Type,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

type EditorToolId = 'cut' | 'audio' | 'stickers' | 'text' | 'export'

const PANEL_WIDTH = 320

const TOOLS: { id: EditorToolId; label: string; icon: ReactNode }[] = [
  { id: 'cut', label: 'Cut', icon: <Scissors className="size-5" /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines className="size-5" /> },
  { id: 'stickers', label: 'Stickers', icon: <Sticker className="size-5" /> },
  { id: 'text', label: 'Text', icon: <Type className="size-5" /> },
  { id: 'export', label: 'Export', icon: <Link2 className="size-5" /> },
]

interface EditorWorkspaceProps {
  videoUrl: string
  videoBlob: Blob | null
  sourceDuration: number
  assets: LibraryAssetView[]
  recordingName: string
  onRecordingNameChange: (name: string) => void
  youtubeConnected: boolean
  youtubeHint: string
  aspectRatio?: string
  contentTypeLabel?: string
  publishMetadata: SessionYouTubeMetadata
  onPublishMetadataChange?: (metadata: SessionYouTubeMetadata) => void
  onSaveDraft: (project: EditorProject, options?: { overlayAudioBlob?: Blob | null }) => Promise<void>
  onPublish: (project: EditorProject, result: UploadResult) => Promise<void>
  initialProject?: EditorProject | null
  /** Object URL for restored overlay audio; never a YouTube video URL. */
  overlayAudioUrl?: string | null
  /** Blob for the inserted clip (baked into publish export). */
  overlayAudioBlob?: Blob | null
  /** Fired when the inserted clip blob changes (set, replace, or clear). */
  onOverlayAudioBlobChange?: (blob: Blob | null) => void
}

export function EditorWorkspace({
  videoUrl,
  videoBlob,
  sourceDuration,
  assets,
  recordingName,
  onRecordingNameChange,
  youtubeConnected,
  youtubeHint,
  aspectRatio = '16:9',
  contentTypeLabel,
  publishMetadata,
  onPublishMetadataChange,
  onSaveDraft,
  onPublish,
  initialProject = null,
  overlayAudioUrl = null,
  overlayAudioBlob = null,
  onOverlayAudioBlobChange,
}: EditorWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageColumnRef = useRef<HTMLDivElement>(null)
  const blackUntilRef = useRef<number | null>(null)
  const lastPlaySourceRef = useRef(0)
  const timelineTimeRef = useRef(0)
  const isPlayingRef = useRef(false)
  const isSeekingRef = useRef(false)

  const [project, setProject] = useState<EditorProject>(() =>
    normalizeEditorProject(initialProject, sourceDuration),
  )
  const [timelineTime, setTimelineTime] = useState(0)
  const [sourceTime, setSourceTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
  const [activeTool, setActiveTool] = useState<EditorToolId | null>('cut')
  const [inBlackFrame, setInBlackFrame] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [pendingAudioAtEditedS, setPendingAudioAtEditedS] = useState<number | null>(null)
  const [stageWidth, setStageWidth] = useState<number | null>(null)
  const pendingAudioAtEditedSRef = useRef<number | null>(null)
  const overlayAudioRef = useRef<HTMLAudioElement>(null)
  const overlaySyncGenRef = useRef(0)
  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => {
    const el = stageColumnRef.current
    if (!el) return
    const sync = () => setStageWidth(el.getBoundingClientRect().width)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const imageAssets = useMemo(
    () => assets.filter((asset) => asset.type === 'image' || asset.type === 'gif'),
    [assets],
  )

  const editedDuration = useMemo(() => getEditedDuration(project), [project])
  const videoAspect = useMemo(() => parseAspectRatio(aspectRatio), [aspectRatio])
  const isPortraitPreview = videoAspect.width < videoAspect.height
  /** Preview stage always matches Videos (16:9) so Shorts don't shrink the layout. */
  const stageAspect = { width: 16, height: 9 }

  const introAssetUrl = imageAssets.find((asset) => asset.id === project.intro.assetId)?.previewUrl ?? null
  const outroAssetUrl = imageAssets.find((asset) => asset.id === project.outro.assetId)?.previewUrl ?? null

  const syncOverlayToEdited = useCallback(
    (editedTime: number, playing: boolean) => {
      const audio = overlayAudioRef.current
      const clip = projectRef.current.overlayAudio
      if (!audio || !clip || !overlayAudioUrl) {
        if (audio && !audio.paused) audio.pause()
        return
      }

      audio.volume = clip.muted ? 0 : Math.min(1, Math.max(0, clip.volume))
      const start = Number(clip.startAtEditedS) || 0
      const end = start + Math.max(0.05, Number(clip.durationS) || 0)
      const gen = ++overlaySyncGenRef.current

      if (editedTime < start - 0.01 || editedTime >= end) {
        if (!audio.paused) audio.pause()
        return
      }

      const offset = Math.min(
        Math.max(0, editedTime - start),
        Math.max(0, clip.sourceDurationS || clip.durationS || 0),
      )

      const applyPlay = () => {
        if (gen !== overlaySyncGenRef.current) return
        if (playing) {
          if (audio.paused) void audio.play().catch(() => undefined)
        } else if (!audio.paused) {
          audio.pause()
        }
      }

      if (Math.abs(audio.currentTime - offset) > 0.12) {
        const onSeeked = () => {
          audio.removeEventListener('seeked', onSeeked)
          applyPlay()
        }
        audio.addEventListener('seeked', onSeeked)
        try {
          audio.currentTime = offset
        } catch {
          audio.removeEventListener('seeked', onSeeked)
          applyPlay()
          return
        }
        window.setTimeout(() => {
          audio.removeEventListener('seeked', onSeeked)
          applyPlay()
        }, 220)
        return
      }

      applyPlay()
    },
    [overlayAudioUrl],
  )

  useEffect(() => {
    setProject(normalizeEditorProject(initialProject, sourceDuration))
    setTimelineTime(0)
    setSourceTime(0)
    lastPlaySourceRef.current = 0
    timelineTimeRef.current = 0
    setIsPlaying(false)
    setInBlackFrame(false)
    setActiveTool('cut')
    setPendingAudioAtEditedS(null)
    pendingAudioAtEditedSRef.current = null
    // Remount via key={recordingId}; only re-sync when the loaded media changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialProject is seed for this media
  }, [videoUrl, sourceDuration])

  useEffect(() => {
    timelineTimeRef.current = timelineTime
  }, [timelineTime])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    isSeekingRef.current = isSeeking
  }, [isSeeking])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // Mute unless the user hit Play — hover/scrub seeks must stay silent.
    video.muted = !isPlaying
    video.volume = effectiveRecordingGain(project)
  }, [
    isPlaying,
    project.cameraMuted,
    project.cameraVolume,
    project.screenMuted,
    project.screenVolume,
    project.recordingMuted,
    project.recordingVolume,
    videoUrl,
  ])

  useEffect(() => {
    if (!isPlaying) syncOverlayToEdited(timelineTimeRef.current, false)
  }, [isPlaying, syncOverlayToEdited, project.overlayAudio?.muted, project.overlayAudio?.volume])

  // Re-apply gate whenever placement or playhead moves (not only inside the RAF play loop).
  useEffect(() => {
    syncOverlayToEdited(timelineTime, isPlaying)
  }, [
    timelineTime,
    isPlaying,
    syncOverlayToEdited,
    project.overlayAudio?.startAtEditedS,
    project.overlayAudio?.durationS,
    project.overlayAudio?.id,
  ])

  const handleSaveDraft = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await onSaveDraft(project)
    } finally {
      setIsSaving(false)
    }
  }

  // Autosave project edits so returning from the lobby restores the latest cut/audio work.
  const autosaveReadyRef = useRef(false)
  useEffect(() => {
    autosaveReadyRef.current = false
  }, [videoUrl, sourceDuration])

  useEffect(() => {
    if (!autosaveReadyRef.current) {
      autosaveReadyRef.current = true
      return
    }

    const timer = window.setTimeout(() => {
      void onSaveDraft(project)
    }, 1600)

    return () => window.clearTimeout(timer)
  }, [project, onSaveDraft])

  const handlePublished = async (result: UploadResult) => {
    await onPublish(project, result)
  }
  const seekEdited = useCallback(
    (nextTimeline: number) => {
      const video = videoRef.current
      if (!video) return
      const clamped = Math.min(Math.max(0, nextTimeline), editedDuration)
      const segment = findSegmentAtTimeline(project, clamped)
      setTimelineTime(clamped)
      timelineTimeRef.current = clamped

      if (!segment) return

      if (segment.kind === 'black') {
        video.pause()
        video.currentTime = segment.holdSourceTime
        setSourceTime(segment.holdSourceTime)
        lastPlaySourceRef.current = segment.holdSourceTime
        setInBlackFrame(true)
        blackUntilRef.current = performance.now() + (segment.timelineEnd - clamped) * 1000
        syncOverlayToEdited(clamped, isPlayingRef.current)
        return
      }

      setInBlackFrame(false)
      blackUntilRef.current = null
      const nextSource = segment.sourceStart + (clamped - segment.timelineStart)
      video.currentTime = nextSource
      setSourceTime(nextSource)
      lastPlaySourceRef.current = nextSource
      syncOverlayToEdited(clamped, isPlayingRef.current)
    },
    [editedDuration, project, syncOverlayToEdited],
  )

  const seekSource = useCallback(
    (nextSource: number) => {
      const video = videoRef.current
      if (!video) return
      const kept = clampSourceToKept(project, Math.min(Math.max(0, nextSource), sourceDuration))
      video.currentTime = kept
      setSourceTime(kept)
      lastPlaySourceRef.current = kept
      const mapped = sourceToTimeline(project, kept)
      if (mapped != null) {
        setTimelineTime(mapped)
        timelineTimeRef.current = mapped
      }
      setInBlackFrame(false)
      blackUntilRef.current = null
    },
    [project, sourceDuration],
  )

  const cutPreviewTargetRef = useRef<number | null>(null)
  const cutPreviewListenerRef = useRef<(() => void) | null>(null)
  const pendingScrubRef = useRef<number | null>(null)
  const scrubSeekingRef = useRef(false)

  const stopCutPreview = useCallback(() => {
    const video = videoRef.current
    cutPreviewTargetRef.current = null
    pendingScrubRef.current = null
    scrubSeekingRef.current = false
    if (video && cutPreviewListenerRef.current) {
      video.removeEventListener('timeupdate', cutPreviewListenerRef.current)
      cutPreviewListenerRef.current = null
    }
    if (video) {
      video.pause()
      video.playbackRate = 1
    }
  }, [])

  /** Snap the preview to a source frame (including inside cut-outs) while scrubbing. */
  const previewSourceFrame = useCallback(
    (source: number) => {
      const video = videoRef.current
      if (!video) return
      const clamped = Math.min(Math.max(0, source), sourceDuration)

      // Scrub mode must win over playback/black-frame ticks immediately.
      isPlayingRef.current = false
      isSeekingRef.current = true
      setIsPlaying(false)
      setInBlackFrame(false)
      blackUntilRef.current = null

      setSourceTime(clamped)
      lastPlaySourceRef.current = clamped

      const mapped = sourceToTimeline(project, clamped)
      if (mapped != null) {
        setTimelineTime(mapped)
        timelineTimeRef.current = mapped
      }

      // Coalesce seeks so rapid edge-drags don't flash black between seeks.
      pendingScrubRef.current = clamped
      if (scrubSeekingRef.current) return

      const flush = () => {
        const target = pendingScrubRef.current
        const el = videoRef.current
        if (el == null || target == null) {
          scrubSeekingRef.current = false
          return
        }
        if (Math.abs(el.currentTime - target) < 0.02) {
          pendingScrubRef.current = null
          scrubSeekingRef.current = false
          return
        }

        scrubSeekingRef.current = true
        const onSeeked = () => {
          el.removeEventListener('seeked', onSeeked)
          scrubSeekingRef.current = false
          if (
            pendingScrubRef.current != null &&
            Math.abs(pendingScrubRef.current - el.currentTime) >= 0.02
          ) {
            flush()
          } else {
            pendingScrubRef.current = null
          }
        }
        el.addEventListener('seeked', onSeeked)
        el.pause()
        el.playbackRate = 1
        try {
          el.currentTime = target
        } catch {
          scrubSeekingRef.current = false
        }
      }

      flush()
    },
    [project, sourceDuration],
  )

  /** Play the drafting cut range at high speed so the user sees up to the cut end. */
  const previewCutRange = useCallback(
    (cutStart: number, cutEnd: number) => {
      const video = videoRef.current
      if (!video) return

      const from = Math.min(cutStart, cutEnd)
      const to = Math.max(cutStart, cutEnd)

      // Single-frame scrub (trim / piece edges / frame insert): show that exact moment.
      if (to - from < 0.08) {
        previewSourceFrame(from)
        return
      }

      cutPreviewTargetRef.current = to

      setIsPlaying(false)
      isPlayingRef.current = false
      setInBlackFrame(false)
      blackUntilRef.current = null

      if (!cutPreviewListenerRef.current) {
        const onTimeUpdate = () => {
          const target = cutPreviewTargetRef.current
          if (target == null || !videoRef.current) return
          const current = videoRef.current.currentTime
          setSourceTime(current)
          lastPlaySourceRef.current = current
          if (current >= target - 0.05) {
            videoRef.current.pause()
            videoRef.current.playbackRate = 1
            videoRef.current.currentTime = target
            setSourceTime(target)
            lastPlaySourceRef.current = target
          }
        }
        cutPreviewListenerRef.current = onTimeUpdate
        video.addEventListener('timeupdate', onTimeUpdate)
      }

      // Dragging back: snap to the new end instead of playing backwards.
      if (to < video.currentTime - 0.05) {
        video.pause()
        video.playbackRate = 1
        video.currentTime = to
        setSourceTime(to)
        lastPlaySourceRef.current = to
        return
      }

      // Restart from cut start when outside the draft window.
      if (video.currentTime < from - 0.05 || video.currentTime > to + 0.2) {
        video.pause()
        video.playbackRate = 1
        video.currentTime = from
      }

      // Visual-only scrub of the cut range — stay muted (Play button owns audio).
      if (video.currentTime < to - 0.05) {
        video.muted = true
        video.playbackRate = 8
        void video.play().catch(() => {
          video.playbackRate = 1
          video.currentTime = to
          setSourceTime(to)
          lastPlaySourceRef.current = to
        })
      }
    },
    [previewSourceFrame],
  )

  // Keep the playhead on active media when trim/cuts change — but not while
  // the user is scrubbing/resizing (e.g. cutting out interiors must stay visible).
  useEffect(() => {
    if (isSeekingRef.current) return
    const mapped = sourceToTimeline(project, sourceTime)
    if (mapped == null) {
      const resolved = resolvePlayableTimeline(project, sourceTime)
      seekSource(resolved.sourceTime)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to edit bounds
  }, [project.trimStart, project.trimEnd, project.cuts, seekSource])

  const waitForSeek = useCallback((video: HTMLVideoElement, target: number) => {
    return new Promise<void>((resolve) => {
      if (Math.abs(video.currentTime - target) < 0.04) {
        resolve()
        return
      }
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        video.removeEventListener('seeked', finish)
        resolve()
      }
      video.addEventListener('seeked', finish)
      video.currentTime = target
      window.setTimeout(finish, 400)
    })
  }, [])

  /**
   * Drive playback along the edited timeline so cuts, black frames, and the
   * full duration run continuously until the end (unless the user pauses).
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let raf = 0
    let jumping = false

    const stopAtEnd = () => {
      video.pause()
      setIsPlaying(false)
      isPlayingRef.current = false
      setInBlackFrame(false)
      blackUntilRef.current = null
      setTimelineTime(editedDuration)
      timelineTimeRef.current = editedDuration
      syncOverlayToEdited(editedDuration, false)
    }

    const continueAfterSegment = async (segmentEnd: number) => {
      const nextTime = segmentEnd + 0.001
      if (nextTime >= editedDuration - 0.001) {
        stopAtEnd()
        return
      }

      const next = findSegmentAtTimeline(project, nextTime)
      if (!next) {
        stopAtEnd()
        return
      }

      if (next.kind === 'black') {
        seekEdited(nextTime)
        return
      }

      // Hard cut: pause, seek to the next kept source, wait, then resume.
      // Avoids freezing on the last frame of the removed section.
      jumping = true
      video.pause()
      const nextSource = next.sourceStart + (nextTime - next.timelineStart)
      setTimelineTime(nextTime)
      timelineTimeRef.current = nextTime
      setInBlackFrame(false)
      blackUntilRef.current = null

      try {
        await waitForSeek(video, nextSource)
        setSourceTime(nextSource)
        lastPlaySourceRef.current = nextSource
        if (isPlayingRef.current && !isSeekingRef.current) {
          await video.play().catch(() => undefined)
        }
      } finally {
        jumping = false
      }
    }

    const tick = () => {
      if (isPlayingRef.current && !isSeekingRef.current && !jumping && editedDuration > 0) {
        const t = Math.min(timelineTimeRef.current, Math.max(0, editedDuration - 0.0001))
        const segment = findSegmentAtTimeline(project, t)

        if (!segment) {
          stopAtEnd()
        } else if (segment.kind === 'black') {
          if (blackUntilRef.current == null) {
            video.pause()
            video.currentTime = segment.holdSourceTime
            setSourceTime(segment.holdSourceTime)
            lastPlaySourceRef.current = segment.holdSourceTime
            setInBlackFrame(true)
            blackUntilRef.current =
              performance.now() + Math.max(0.05, segment.timelineEnd - t) * 1000
          }

          if (blackUntilRef.current != null && performance.now() >= blackUntilRef.current) {
            blackUntilRef.current = null
            setInBlackFrame(false)
            void continueAfterSegment(segment.timelineEnd)
          } else if (blackUntilRef.current != null) {
            const remainingMs = blackUntilRef.current - performance.now()
            const remaining = Math.max(0, remainingMs / 1000)
            const segLen = segment.timelineEnd - segment.timelineStart
            const elapsed = Math.min(segLen, Math.max(0, segLen - remaining))
            const nextTimeline = segment.timelineStart + elapsed
            setTimelineTime(nextTimeline)
            timelineTimeRef.current = nextTimeline
          }
        } else {
          setInBlackFrame(false)

          if (video.paused) {
            void video.play().catch(() => undefined)
          }

          const sourcePos = video.currentTime
          const nearSegmentEnd = sourcePos >= segment.sourceEnd - 0.04 || video.ended

          if (nearSegmentEnd) {
            void continueAfterSegment(segment.timelineEnd)
          } else if (sourcePos < segment.sourceStart - 0.05) {
            video.currentTime = segment.sourceStart
            lastPlaySourceRef.current = segment.sourceStart
          } else {
            const timelinePos = segment.timelineStart + (sourcePos - segment.sourceStart)
            setSourceTime(sourcePos)
            lastPlaySourceRef.current = sourcePos
            setTimelineTime(timelinePos)
            timelineTimeRef.current = timelinePos
          }
        }

        syncOverlayToEdited(timelineTimeRef.current, isPlayingRef.current)
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [project, editedDuration, seekEdited, syncOverlayToEdited, waitForSeek])

  const playFromTimeline = useCallback(
    async (startTimeline: number) => {
      const video = videoRef.current
      if (!video || editedDuration <= 0) return

      const clamped = Math.min(Math.max(0, startTimeline), Math.max(0, editedDuration - 0.0001))
      isSeekingRef.current = false
      setIsSeeking(false)
      stopCutPreview()
      seekEdited(clamped)

      const segment = findSegmentAtTimeline(project, clamped)
      setIsPlaying(true)
      isPlayingRef.current = true

      if (segment?.kind === 'black') {
        setInBlackFrame(true)
        blackUntilRef.current =
          performance.now() + Math.max(0.05, segment.timelineEnd - clamped) * 1000
        return
      }

      const playSource = segment
        ? segment.sourceStart + (clamped - segment.timelineStart)
        : clampSourceToKept(project, sourceTime)

      await waitForSeek(video, playSource)
      lastPlaySourceRef.current = playSource
      try {
        video.muted = false
        await video.play()
      } catch {
        video.muted = true
        setIsPlaying(false)
        isPlayingRef.current = false
      }
    },
    [editedDuration, project, seekEdited, sourceTime, stopCutPreview, waitForSeek],
  )

  const togglePlayback = async () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
      video.muted = true
      setIsPlaying(false)
      isPlayingRef.current = false
      blackUntilRef.current = null
      setInBlackFrame(false)
      return
    }

    const atEnd = timelineTime >= editedDuration - 0.05
    const resolved = resolvePlayableTimeline(
      project,
      atEnd ? project.trimStart : sourceTime,
    )
    const startTimeline = atEnd ? 0 : resolved.timelineTime
    await playFromTimeline(startTimeline)
  }

  const patchProject = (patch: Partial<EditorProject>) => {
    setProject((current) => ({ ...current, ...patch }))
    if (patch.overlayAudio) {
      pendingAudioAtEditedSRef.current = null
      setPendingAudioAtEditedS(null)
    }
  }

  const attachOverlayClip = useCallback(
    (clip: OverlayAudioClip, blob: Blob) => {
      const preferred =
        pendingAudioAtEditedSRef.current ??
        (Number.isFinite(clip.startAtEditedS) ? clip.startAtEditedS : 0)
      const placed = clampPlacement(clip, preferred, clip.durationS || clip.sourceDurationS, editedDuration)
      const nextClip = { ...clip, ...placed }
      onOverlayAudioBlobChange?.(blob)
      setProject((current) => ({ ...current, overlayAudio: nextClip }))
      pendingAudioAtEditedSRef.current = null
      setPendingAudioAtEditedS(null)
    },
    [editedDuration, onOverlayAudioBlobChange],
  )

  const handlePlaceAudio = useCallback(
    (editedTimeSeconds: number) => {
      const at = Math.max(0, Math.min(editedTimeSeconds, Math.max(editedDuration, editedTimeSeconds)))
      setActiveTool('audio')

      setProject((current) => {
        if (!current.overlayAudio) {
          pendingAudioAtEditedSRef.current = at
          setPendingAudioAtEditedS(at)
          return current
        }
        const next = clampPlacement(
          current.overlayAudio,
          at,
          current.overlayAudio.durationS,
          editedDuration,
        )
        pendingAudioAtEditedSRef.current = null
        setPendingAudioAtEditedS(null)
        return {
          ...current,
          overlayAudio: { ...current.overlayAudio, ...next },
        }
      })
    },
    [editedDuration],
  )

  const transition = transitionProgressAt(project, timelineTime)
  const introActive =
    project.intro.enabled && !!introAssetUrl && timelineTime <= project.intro.durationS
  const introProgress = project.intro.durationS > 0 ? timelineTime / project.intro.durationS : 1
  const outroActive =
    project.outro.enabled && editedDuration > 0 && timelineTime >= editedDuration - project.outro.durationS
  const outroProgress =
    project.outro.durationS > 0
      ? (timelineTime - (editedDuration - project.outro.durationS)) / project.outro.durationS
      : 1

  const panelOpen = activeTool !== null
  const selectTool = (id: EditorToolId) => {
    setActiveTool((current) => (current === id ? null : id))
  }

  const panelTitle =
    activeTool === 'cut'
      ? 'Transitions'
      : activeTool === 'audio'
        ? 'Audio'
        : activeTool === 'stickers'
          ? 'Stickers'
          : activeTool === 'text'
            ? 'Text & end card'
            : activeTool === 'export'
              ? 'Export'
              : ''

  return (
    /* Top/side padding match AppShell pages. Bottom pb-3 matches the in-card
       timeline→tools gap so leftover height goes into the preview. */
    <div className="flex h-full min-h-0 w-full gap-2 overflow-hidden md:gap-3">
      <div
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-visible pt-10 pb-3 pl-10 md:pt-14 md:pl-14 lg:pt-16 lg:pl-16',
          panelOpen ? 'pr-0' : 'pr-10 md:pr-14 lg:pr-16',
        )}
      >
        <header
          className="mx-auto flex w-full shrink-0 flex-col gap-2"
          style={stageWidth != null ? { width: stageWidth, maxWidth: '100%' } : undefined}
        >
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" />
            Back to Lobby
          </Link>
          <div className="flex w-full items-center justify-between gap-4">
            <input
              type="text"
              value={recordingName}
              onChange={(event) => onRecordingNameChange(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight text-neutral-900 outline-none placeholder:text-neutral-400 md:text-4xl"
              placeholder="Untitled recording"
              aria-label="Recording title"
            />
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={isSaving}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
              <PublishButton
                videoBlob={videoBlob}
                project={project}
                overlayAudioBlob={overlayAudioBlob}
                publishMetadata={{ ...publishMetadata, title: recordingName.trim() || publishMetadata.title }}
                aspectRatio={aspectRatio}
                contentTypeLabel={contentTypeLabel}
                disabled={!youtubeConnected || isSaving}
                disabledReason={
                  youtubeConnected ? youtubeHint : 'Connect YouTube in Settings before publishing.'
                }
                onPublishMetadataChange={onPublishMetadataChange}
                onPublished={handlePublished}
              />
            </div>
          </div>
        </header>

        {/* Stage is always 16:9 (same as Videos). Shorts letterbox inside with no frame chrome. */}
        <section className="relative mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 items-center justify-center px-12 [container-type:size]">
            <div
              ref={stageColumnRef}
              className="flex max-h-full min-h-0 flex-col"
              style={{
                width: `min(100%, calc((100cqh - 5rem) * ${stageAspect.width} / ${stageAspect.height}))`,
              }}
            >
              <div
                className={cn(
                  'relative w-full overflow-hidden',
                  isPortraitPreview ? 'bg-transparent' : 'rounded-2xl bg-black',
                )}
                style={{ aspectRatio: `${stageAspect.width} / ${stageAspect.height}` }}
              >
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className={cn(
                    'absolute inset-0 size-full transition-opacity',
                    isPortraitPreview ? 'object-contain' : 'object-cover',
                    inBlackFrame && 'opacity-0',
                  )}
                  muted={!isPlaying}
                  playsInline
                  preload="auto"
                  onClick={() => void togglePlayback()}
                />
                {overlayAudioUrl ? (
                  <audio ref={overlayAudioRef} src={overlayAudioUrl} preload="auto" className="hidden" />
                ) : null}
                {inBlackFrame ? <div className="absolute inset-0 z-10 bg-black" /> : null}
                <TransitionOverlay
                  type={transition.type}
                  progress={transition.progress}
                  active={transition.isJoin}
                />
                <IntroOverlay imageUrl={introAssetUrl} progress={introProgress} active={introActive} />
                <OutroOverlay
                  active={outroActive}
                  mode={project.outro.mode}
                  text={project.outro.text}
                  subscribeLabel={project.outro.subscribeLabel}
                  imageUrl={outroAssetUrl}
                  progress={outroProgress}
                />
              </div>

              <div className="relative z-20 w-full shrink-0 pt-3">
                <button
                  type="button"
                  onClick={() => void togglePlayback()}
                  className="absolute top-5 right-full mr-3 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="size-4 fill-current" />
                  ) : (
                    <Play className="size-4 fill-current" />
                  )}
                </button>
                <CapCutTimeline
                  project={project}
                  sourceDuration={sourceDuration}
                  timelineTime={timelineTime}
                  editedDuration={editedDuration}
                  isPlaying={isPlaying}
                  videoBlob={videoBlob}
                  videoUrl={videoUrl}
                  onSeekTimeline={seekEdited}
                  onPreviewSource={previewCutRange}
                  onPlaceAudio={handlePlaceAudio}
                  pendingAudioAtEditedS={pendingAudioAtEditedS}
                  onChangeTrim={(trimStart, trimEnd) => patchProject({ trimStart, trimEnd })}
                  onAddCut={(cut: EditorCutRange) =>
                    patchProject({ cuts: mergeCuts([...project.cuts, cut]) })
                  }
                  onUpdateCut={(cut: EditorCutRange) =>
                    patchProject({
                      cuts: mergeCuts(
                        project.cuts.map((item) => (item.id === cut.id ? cut : item)),
                      ),
                    })
                  }
                  onAddBlackFrame={(frame: EditorBlackFrame) =>
                    patchProject({ blackFrames: [...project.blackFrames, frame] })
                  }
                  onUpdateBlackFrame={(frame: EditorBlackFrame) =>
                    patchProject({
                      blackFrames: project.blackFrames.map((item) =>
                        item.id === frame.id ? frame : item,
                      ),
                    })
                  }
                  onRemoveCut={(id) =>
                    patchProject({ cuts: project.cuts.filter((cut) => cut.id !== id) })
                  }
                  onRemoveBlackFrame={(id) =>
                    patchProject({
                      blackFrames: project.blackFrames.filter((frame) => frame.id !== id),
                    })
                  }
                  onPlayFromTimeline={(editedTime) => {
                    void playFromTimeline(editedTime)
                  }}
                  onDragChange={(dragging) => {
                    // Sync refs immediately — waiting for useEffect lets one RAF tick
                    // paint the black-frame overlay while resizing cuts/frames.
                    isSeekingRef.current = dragging
                    if (dragging) {
                      isPlayingRef.current = false
                      setIsPlaying(false)
                      setInBlackFrame(false)
                      blackUntilRef.current = null
                    }
                    setIsSeeking(dragging)
                    if (!dragging) stopCutPreview()
                  }}
                />
              </div>
            </div>
          </div>

          <nav
            className="relative z-20 mt-3 flex w-full shrink-0 items-stretch justify-center gap-2 px-3 pb-3"
            style={stageWidth != null ? { width: stageWidth, maxWidth: '100%', marginInline: 'auto' } : undefined}
          >
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => selectTool(tool.id)}
                className={cn(
                  'flex aspect-square w-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl border transition',
                  activeTool === tool.id
                    ? 'border-[#5234d2] bg-[#5234d2]/10 text-neutral-900'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50',
                )}
              >
                {tool.icon}
                <span className="text-[10px] font-medium leading-none">{tool.label}</span>
              </button>
            ))}
          </nav>
        </section>
      </div>

      <AnimatePresence initial={false}>
        {panelOpen ? (
          <motion.div
            key="editor-side-panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: PANEL_WIDTH, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="my-2 mr-2 h-[calc(100%-1rem)] shrink-0 self-center overflow-hidden md:my-3 md:mr-3 md:h-[calc(100%-1.5rem)]"
          >
            <aside className="flex h-full w-[320px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <div className="flex shrink-0 items-center justify-between px-4 py-3">
                <h2 className="text-sm font-semibold text-neutral-900">{panelTitle}</h2>
                <button
                  type="button"
                  onClick={() => setActiveTool(null)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Close panel"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 text-neutral-800">
                {activeTool === 'cut' ? (
                  <CutPanel project={project} onPatch={patchProject} />
                ) : null}
                {activeTool === 'audio' ? (
                  <InsertAudioPanel
                    project={project}
                    editedDuration={editedDuration}
                    overlayAudioUrl={overlayAudioUrl}
                    preferredStartAtEditedS={pendingAudioAtEditedS}
                    timelinePlaying={isPlaying}
                    onPatch={patchProject}
                    onAttachClip={attachOverlayClip}
                    onOverlayAudioBlobChange={onOverlayAudioBlobChange ?? (() => undefined)}
                  />
                ) : null}
                {activeTool === 'stickers' ? (
                  <StickersPanel
                    project={project}
                    imageAssets={imageAssets}
                    onPatch={patchProject}
                  />
                ) : null}
                {activeTool === 'text' ? (
                  <TextPanel project={project} onPatch={patchProject} />
                ) : null}
                {activeTool === 'export' ? (
                  <ExportPanel
                    videoBlob={videoBlob}
                    project={project}
                    overlayAudioBlob={overlayAudioBlob}
                    publishMetadata={{ ...publishMetadata, title: recordingName.trim() || publishMetadata.title }}
                    aspectRatio={aspectRatio}
                    contentTypeLabel={contentTypeLabel}
                    youtubeConnected={youtubeConnected}
                    youtubeHint={youtubeHint}
                    disabled={isSaving}
                    onPublishMetadataChange={onPublishMetadataChange}
                    onPublished={handlePublished}
                  />
                ) : null}
              </div>
            </aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function PanelHint({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs leading-relaxed text-neutral-500">{children}</p>
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

const TRANSITION_LENGTH_OPTIONS = [
  { id: 'none', label: 'None', seconds: 0 },
  { id: '500', label: '500ms', seconds: 0.5 },
  { id: '1000', label: '1000ms', seconds: 1 },
  { id: '1500', label: '1500ms', seconds: 1.5 },
  { id: '2000', label: '2000ms', seconds: 2 },
] as const

function normalizeTransitionDurationS(value: number | undefined): number {
  const seconds = value ?? 0.5
  let best: number = TRANSITION_LENGTH_OPTIONS[0]!.seconds
  let bestDist = Number.POSITIVE_INFINITY
  for (const option of TRANSITION_LENGTH_OPTIONS) {
    const dist = Math.abs(option.seconds - seconds)
    if (dist < bestDist) {
      best = option.seconds
      bestDist = dist
    }
  }
  return best
}

function CutPanel({
  project,
  onPatch,
}: {
  project: EditorProject
  onPatch: (patch: Partial<EditorProject>) => void
}) {
  const transitionDuration = normalizeTransitionDurationS(project.transitionDurationS)

  return (
    <div className="space-y-4">
      <PanelHint>
        Choose how clip joins animate after a trim or cut-out. Transition length applies at each join.
      </PanelHint>

      <div>
        <PanelFieldHeading>Transition</PanelFieldHeading>
        <div className="grid grid-cols-2 gap-1.5">
          {EDITOR_TRANSITIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPatch({ transition: item.id as EditorTransitionType })}
              className={cn(
                'rounded-lg border px-2 py-2 text-left',
                project.transition === item.id
                  ? 'border-[#5234d2] bg-[#5234d2]/10'
                  : 'border-neutral-200 hover:border-neutral-300',
              )}
            >
              <span className="block text-[11px] font-medium">{item.label}</span>
              <span className="mt-0.5 block text-[10px] text-neutral-500">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <PanelFieldHeading>Transition length</PanelFieldHeading>
        <div className="flex flex-wrap gap-1.5">
          {TRANSITION_LENGTH_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onPatch({ transitionDurationS: option.seconds })}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition',
                transitionDuration === option.seconds
                  ? 'border-[#5234d2] bg-[#5234d2]/10 text-neutral-900'
                  : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function StickersPanel({
  project,
  imageAssets,
  onPatch,
}: {
  project: EditorProject
  imageAssets: LibraryAssetView[]
  onPatch: (patch: Partial<EditorProject>) => void
}) {
  return (
    <div className="space-y-4">
      <PanelHint>Opening and ending stickers from your asset library.</PanelHint>
      <div>
        <PanelFieldHeading
          trailing={
            <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                checked={project.intro.enabled}
                onChange={(event) =>
                  onPatch({ intro: { ...project.intro, enabled: event.target.checked } })
                }
              />
              On
            </label>
          }
        >
          Opening sticker
        </PanelFieldHeading>
        <select
          value={project.intro.assetId ?? ''}
          onChange={(event) =>
            onPatch({ intro: { ...project.intro, assetId: event.target.value || null } })
          }
          className="mb-3 w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
        >
          <option value="">Select sticker…</option>
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
        <PanelFieldHeading
          trailing={
            <span className="text-[11px] tabular-nums text-neutral-500">
              {project.intro.durationS.toFixed(1)}s
            </span>
          }
        >
          Duration
        </PanelFieldHeading>
        <input
          type="range"
          min={0.8}
          max={6}
          step={0.1}
          value={project.intro.durationS}
          onChange={(event) =>
            onPatch({ intro: { ...project.intro, durationS: Number(event.target.value) } })
          }
          className="w-full accent-[#5234d2]"
          aria-label="Opening sticker duration"
        />
      </div>

      <div>
        <PanelFieldHeading
          trailing={
            <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                checked={project.outro.enabled && project.outro.mode === 'sticker'}
                onChange={(event) => {
                  if (event.target.checked) {
                    onPatch({ outro: { ...project.outro, enabled: true, mode: 'sticker' } })
                  } else if (project.outro.mode === 'sticker') {
                    onPatch({ outro: { ...project.outro, enabled: false } })
                  }
                }}
              />
              On
            </label>
          }
        >
          Ending sticker
        </PanelFieldHeading>
        <select
          value={project.outro.assetId ?? ''}
          onChange={(event) =>
            onPatch({
              outro: {
                ...project.outro,
                assetId: event.target.value || null,
                mode: 'sticker',
                enabled: true,
              },
            })
          }
          className="w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
        >
          <option value="">Select sticker…</option>
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function TextPanel({
  project,
  onPatch,
}: {
  project: EditorProject
  onPatch: (patch: Partial<EditorProject>) => void
}) {
  return (
    <div className="space-y-4">
      <PanelHint>End-card copy and subscribe CTA.</PanelHint>

      <div>
        <PanelFieldHeading
          trailing={
            <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                checked={project.outro.enabled}
                onChange={(event) =>
                  onPatch({ outro: { ...project.outro, enabled: event.target.checked } })
                }
              />
              On
            </label>
          }
        >
          Ending overlay
        </PanelFieldHeading>
      </div>

      <div>
        <PanelFieldHeading>Mode</PanelFieldHeading>
        <div className="flex flex-wrap gap-1.5">
          {(['subscribe', 'text'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onPatch({ outro: { ...project.outro, mode, enabled: true } })}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[11px] font-medium capitalize transition',
                project.outro.mode === mode
                  ? 'border-[#5234d2] bg-[#5234d2]/10 text-neutral-900'
                  : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div>
        <PanelFieldHeading>Text</PanelFieldHeading>
        <input
          type="text"
          value={project.outro.text}
          onChange={(event) => onPatch({ outro: { ...project.outro, text: event.target.value } })}
          className="w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
        />
      </div>

      {project.outro.mode === 'subscribe' ? (
        <div>
          <PanelFieldHeading>Button label</PanelFieldHeading>
          <input
            type="text"
            value={project.outro.subscribeLabel}
            onChange={(event) =>
              onPatch({ outro: { ...project.outro, subscribeLabel: event.target.value } })
            }
            className="w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
          />
        </div>
      ) : null}

      <div>
        <PanelFieldHeading
          trailing={
            <span className="text-[11px] tabular-nums text-neutral-500">
              {project.outro.durationS.toFixed(1)}s
            </span>
          }
        >
          Duration
        </PanelFieldHeading>
        <input
          type="range"
          min={1}
          max={8}
          step={0.1}
          value={project.outro.durationS}
          onChange={(event) =>
            onPatch({ outro: { ...project.outro, durationS: Number(event.target.value) } })
          }
          className="w-full accent-[#5234d2]"
          aria-label="Ending overlay duration"
        />
      </div>
    </div>
  )
}

function ExportPanel({
  videoBlob,
  project,
  overlayAudioBlob,
  publishMetadata,
  aspectRatio,
  contentTypeLabel,
  youtubeConnected,
  youtubeHint,
  disabled,
  onPublishMetadataChange,
  onPublished,
}: {
  videoBlob: Blob | null
  project: EditorProject
  overlayAudioBlob: Blob | null
  publishMetadata: SessionYouTubeMetadata
  aspectRatio: string
  contentTypeLabel?: string
  youtubeConnected: boolean
  youtubeHint: string
  disabled: boolean
  onPublishMetadataChange?: (metadata: SessionYouTubeMetadata) => void
  onPublished: (result: UploadResult) => void | Promise<void>
}) {
  return (
    <div className="space-y-3">
      <PanelHint>{youtubeHint}</PanelHint>
      <PanelHint>
        Publish re-encodes your edit so cuts, trims, black frames, and inserted audio are baked into
        the uploaded file.
      </PanelHint>
      <PublishButton
        videoBlob={videoBlob}
        project={project}
        overlayAudioBlob={overlayAudioBlob}
        publishMetadata={publishMetadata}
        aspectRatio={aspectRatio}
        contentTypeLabel={contentTypeLabel}
        disabled={!youtubeConnected || disabled}
        disabledReason={
          youtubeConnected ? youtubeHint : 'Connect YouTube in Settings before publishing.'
        }
        onPublishMetadataChange={onPublishMetadataChange}
        className="w-full bg-[#5234d2] text-xs font-semibold hover:bg-[#4529b8]"
        onPublished={onPublished}
      />
    </div>
  )
}
