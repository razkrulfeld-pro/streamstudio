export type EditorTransitionType = 'none' | 'fade' | 'dissolve' | 'wipe-left' | 'wipe-up'

export interface EditorCutRange {
  id: string
  /** Source time inclusive start */
  start: number
  /** Source time exclusive end */
  end: number
}

/** Black frame inserted into the edit after a source moment. */
export interface EditorBlackFrame {
  id: string
  /** Source time after which the black frame plays */
  afterSourceTime: number
  durationS: number
}

export interface EditorIntroSettings {
  enabled: boolean
  assetId: string | null
  durationS: number
}

export interface EditorOutroSettings {
  enabled: boolean
  mode: 'subscribe' | 'sticker' | 'text'
  assetId: string | null
  text: string
  durationS: number
  subscribeLabel: string
}

export type OverlayAudioSourceType = 'youtube' | 'upload'

export type OverlayAudioFormat = 'm4a' | 'mp3' | 'other'

/** One inserted audio clip (v1). Blob lives separately in IndexedDB. */
export interface OverlayAudioClip {
  id: string
  sourceType: OverlayAudioSourceType
  sourceUrl?: string
  fileName?: string
  /** Length of stored audio blob (≤ 60). */
  sourceDurationS: number
  /** Extract/trim start inside the YouTube or upload source. */
  extractStartSeconds?: number
  format: OverlayAudioFormat
  /** Placement start on the edited recording timeline. */
  startAtEditedS: number
  /** How long the bed plays on the edited timeline. */
  durationS: number
  volume: number
  muted: boolean
  createdAt: string
}

export interface EditorProject {
  trimStart: number
  trimEnd: number
  cuts: EditorCutRange[]
  blackFrames: EditorBlackFrame[]
  /** Transition applied when entering the segment that follows a cut/trim join. */
  transition: EditorTransitionType
  /** Duration of the join transition in seconds. */
  transitionDurationS: number
  cameraVolume: number
  screenVolume: number
  cameraMuted: boolean
  screenMuted: boolean
  /**
   * Derived gain for the mixed recording track in preview.
   * Prefer camera / screen controls; kept for older drafts.
   */
  recordingVolume: number
  recordingMuted: boolean
  /** At most one inserted audio clip in v1. */
  overlayAudio: OverlayAudioClip | null
  intro: EditorIntroSettings
  outro: EditorOutroSettings
}

export const defaultEditorProject = (duration: number): EditorProject => ({
  trimStart: 0,
  trimEnd: Math.max(0, duration),
  cuts: [],
  blackFrames: [],
  transition: 'fade',
  transitionDurationS: 0.5,
  cameraVolume: 1,
  screenVolume: 1,
  cameraMuted: false,
  screenMuted: false,
  recordingVolume: 1,
  recordingMuted: false,
  overlayAudio: null,
  intro: {
    enabled: false,
    assetId: null,
    durationS: 2.5,
  },
  outro: {
    enabled: false,
    mode: 'subscribe',
    assetId: null,
    text: 'Thanks for watching',
    durationS: 3,
    subscribeLabel: 'Subscribe',
  },
})

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Preview gain for the draft video's embedded (already-mixed) audio track. */
export function effectiveRecordingGain(project: Pick<
  EditorProject,
  'cameraVolume' | 'screenVolume' | 'cameraMuted' | 'screenMuted'
>): number {
  const camera = project.cameraMuted ? 0 : clamp01(project.cameraVolume)
  const screen = project.screenMuted ? 0 : clamp01(project.screenVolume)
  if (camera <= 0 && screen <= 0) return 0
  if (camera <= 0) return screen
  if (screen <= 0) return camera
  return clamp01((camera + screen) / 2)
}

/** Normalize older drafts missing mute/overlay/recordingVolume fields. */
export function normalizeEditorProject(
  project: EditorProject | null | undefined,
  sourceDuration: number,
): EditorProject {
  const base = defaultEditorProject(sourceDuration)
  if (!project) return base

  const cameraVolume = clamp01(project.cameraVolume ?? base.cameraVolume)
  const screenVolume = clamp01(project.screenVolume ?? base.screenVolume)
  const cameraMuted = Boolean(project.cameraMuted)
  const screenMuted = Boolean(project.screenMuted)
  const recordingVolume = clamp01(
    typeof project.recordingVolume === 'number'
      ? project.recordingVolume
      : (cameraVolume + screenVolume) / 2,
  )

  return {
    ...base,
    ...project,
    cameraVolume,
    screenVolume,
    cameraMuted,
    screenMuted,
    recordingVolume,
    recordingMuted: Boolean(project.recordingMuted) || (cameraMuted && screenMuted),
    overlayAudio: normalizeOverlayAudioClip(project.overlayAudio),
    intro: { ...base.intro, ...project.intro },
    outro: { ...base.outro, ...project.outro },
    cuts: Array.isArray(project.cuts) ? project.cuts : [],
    blackFrames: Array.isArray(project.blackFrames) ? project.blackFrames : [],
  }
}

export function normalizeOverlayAudioClip(
  clip: OverlayAudioClip | null | undefined,
): OverlayAudioClip | null {
  if (!clip || typeof clip !== 'object') return null
  if (!clip.id || !clip.sourceType) return null

  const sourceDurationS = Math.max(0, Number(clip.sourceDurationS) || 0)
  const durationS = Math.max(0, Number(clip.durationS) || sourceDurationS)
  const format = clip.format === 'm4a' || clip.format === 'mp3' ? clip.format : 'other'

  return {
    id: clip.id,
    sourceType: clip.sourceType === 'upload' ? 'upload' : 'youtube',
    sourceUrl: clip.sourceUrl,
    fileName: clip.fileName,
    sourceDurationS,
    extractStartSeconds:
      typeof clip.extractStartSeconds === 'number' ? Math.max(0, clip.extractStartSeconds) : undefined,
    format,
    startAtEditedS: Math.max(0, Number(clip.startAtEditedS) || 0),
    durationS,
    volume: clamp01(clip.volume ?? 1),
    muted: Boolean(clip.muted),
    createdAt: typeof clip.createdAt === 'string' ? clip.createdAt : new Date().toISOString(),
  }
}

export const EDITOR_TRANSITIONS: { id: EditorTransitionType; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Hard cut' },
  { id: 'fade', label: 'Fade', hint: 'Fade through black' },
  { id: 'dissolve', label: 'Dissolve', hint: 'Crossfade soft flash' },
  { id: 'wipe-left', label: 'Wipe left', hint: 'Push from the right' },
  { id: 'wipe-up', label: 'Wipe up', hint: 'Push from the bottom' },
]

export type TimelineSegment =
  | {
      kind: 'video'
      sourceStart: number
      sourceEnd: number
      timelineStart: number
      timelineEnd: number
    }
  | {
      kind: 'black'
      id: string
      durationS: number
      holdSourceTime: number
      timelineStart: number
      timelineEnd: number
    }

export function normalizeCuts(cuts: EditorCutRange[], trimStart: number, trimEnd: number): EditorCutRange[] {
  return mergeCuts(
    cuts
      .map((cut) => ({
        ...cut,
        start: Math.max(trimStart, Math.min(cut.start, cut.end)),
        end: Math.min(trimEnd, Math.max(cut.start, cut.end)),
      }))
      .filter((cut) => cut.end - cut.start > 0.05),
  )
}

/** Merge overlapping or abutting cut ranges into single contiguous cuts. */
export function mergeCuts(cuts: EditorCutRange[]): EditorCutRange[] {
  if (cuts.length === 0) return []

  const sorted = [...cuts]
    .map((cut) => ({
      ...cut,
      start: Math.min(cut.start, cut.end),
      end: Math.max(cut.start, cut.end),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const merged: EditorCutRange[] = [{ ...sorted[0]! }]

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!
    const last = merged[merged.length - 1]!
    // Overlap or touch (±10ms) → expand the existing cut.
    if (current.start <= last.end + 0.01) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}

function keptSourceRanges(project: EditorProject): { start: number; end: number }[] {
  const trimStart = Math.max(0, project.trimStart)
  const trimEnd = Math.max(trimStart, project.trimEnd)
  const cuts = normalizeCuts(project.cuts, trimStart, trimEnd)

  const kept: { start: number; end: number }[] = []
  let cursor = trimStart

  for (const cut of cuts) {
    if (cut.start > cursor) kept.push({ start: cursor, end: cut.start })
    cursor = Math.max(cursor, cut.end)
  }
  if (cursor < trimEnd) kept.push({ start: cursor, end: trimEnd })
  return kept.filter((range) => range.end - range.start > 0.01)
}

/** Visual assembly of the result bar: active clips, skipped cuts, and inserted frames. */
export type AssemblyPiece =
  | {
      kind: 'video'
      sourceStart: number
      sourceEnd: number
      duration: number
      assemblyStart: number
      assemblyEnd: number
    }
  | {
      kind: 'cut'
      id: string
      sourceStart: number
      sourceEnd: number
      duration: number
      assemblyStart: number
      assemblyEnd: number
    }
  | {
      kind: 'black'
      id: string
      holdSourceTime: number
      duration: number
      assemblyStart: number
      assemblyEnd: number
    }

/** Full-width bar model (keeps + cuts + black frames). Playable time skips cuts. */
export function buildAssemblyPieces(project: EditorProject): AssemblyPiece[] {
  const trimStart = Math.max(0, project.trimStart)
  const trimEnd = Math.max(trimStart, project.trimEnd)
  const cuts = normalizeCuts(project.cuts, trimStart, trimEnd)
  const frames = [...project.blackFrames].sort((a, b) => a.afterSourceTime - b.afterSourceTime)

  type Raw =
    | { kind: 'video'; sourceStart: number; sourceEnd: number }
    | { kind: 'cut'; id: string; sourceStart: number; sourceEnd: number }
    | { kind: 'black'; id: string; holdSourceTime: number; duration: number }

  const raw: Raw[] = []
  let cursor = trimStart
  let cutIndex = 0
  let frameIndex = 0

  while (cursor < trimEnd - 0.0005) {
    const nextCut = cuts[cutIndex]
    const nextFrame = frames[frameIndex]

    const cutAt = nextCut?.start ?? Number.POSITIVE_INFINITY
    const frameAt = nextFrame?.afterSourceTime ?? Number.POSITIVE_INFINITY

    // Frame exactly at cursor → insert before advancing source
    if (nextFrame && Math.abs(nextFrame.afterSourceTime - cursor) < 0.02) {
      raw.push({
        kind: 'black',
        id: nextFrame.id,
        holdSourceTime: nextFrame.afterSourceTime,
        duration: Math.max(0.2, nextFrame.durationS),
      })
      frameIndex += 1
      continue
    }

    if (nextCut && Math.abs(nextCut.start - cursor) < 0.02) {
      raw.push({
        kind: 'cut',
        id: nextCut.id,
        sourceStart: nextCut.start,
        sourceEnd: nextCut.end,
      })
      cursor = nextCut.end
      cutIndex += 1
      continue
    }

    const nextBoundary = Math.min(trimEnd, cutAt, frameAt)
    if (nextBoundary - cursor > 0.01) {
      raw.push({ kind: 'video', sourceStart: cursor, sourceEnd: nextBoundary })
      cursor = nextBoundary
      continue
    }

    // Landed on a frame mid-way
    if (nextFrame && nextFrame.afterSourceTime <= cursor + 0.02) {
      raw.push({
        kind: 'black',
        id: nextFrame.id,
        holdSourceTime: nextFrame.afterSourceTime,
        duration: Math.max(0.2, nextFrame.durationS),
      })
      frameIndex += 1
      continue
    }

    break
  }

  // Trailing frames at/after trim end
  while (frameIndex < frames.length) {
    const frame = frames[frameIndex]!
    if (frame.afterSourceTime <= trimEnd + 0.05) {
      raw.push({
        kind: 'black',
        id: frame.id,
        holdSourceTime: frame.afterSourceTime,
        duration: Math.max(0.2, frame.durationS),
      })
    }
    frameIndex += 1
  }

  const pieces: AssemblyPiece[] = []
  let assemblyCursor = 0
  for (const piece of raw) {
    if (piece.kind === 'video') {
      const duration = piece.sourceEnd - piece.sourceStart
      pieces.push({
        kind: 'video',
        sourceStart: piece.sourceStart,
        sourceEnd: piece.sourceEnd,
        duration,
        assemblyStart: assemblyCursor,
        assemblyEnd: assemblyCursor + duration,
      })
      assemblyCursor += duration
    } else if (piece.kind === 'cut') {
      const duration = piece.sourceEnd - piece.sourceStart
      pieces.push({
        kind: 'cut',
        id: piece.id,
        sourceStart: piece.sourceStart,
        sourceEnd: piece.sourceEnd,
        duration,
        assemblyStart: assemblyCursor,
        assemblyEnd: assemblyCursor + duration,
      })
      assemblyCursor += duration
    } else {
      pieces.push({
        kind: 'black',
        id: piece.id,
        holdSourceTime: piece.holdSourceTime,
        duration: piece.duration,
        assemblyStart: assemblyCursor,
        assemblyEnd: assemblyCursor + piece.duration,
      })
      assemblyCursor += piece.duration
    }
  }

  return pieces
}

/**
 * Ordered export passes. Cuts are explicit skip steps so the encoder can stay
 * paused while source playback continues — avoiding fragile WebM seeks that
 * bake freeze frames and accidentally keep cut-out footage.
 */
export type ExportPlanStep =
  | {
      kind: 'video'
      sourceStart: number
      sourceEnd: number
      timelineStart: number
      timelineEnd: number
    }
  | {
      kind: 'cut'
      id: string
      sourceStart: number
      sourceEnd: number
    }
  | {
      kind: 'black'
      id: string
      durationS: number
      holdSourceTime: number
      timelineStart: number
      timelineEnd: number
    }

export function buildExportPlan(project: EditorProject): ExportPlanStep[] {
  const pieces = buildAssemblyPieces(project)
  const steps: ExportPlanStep[] = []
  let timeline = 0

  for (const piece of pieces) {
    if (piece.kind === 'video') {
      steps.push({
        kind: 'video',
        sourceStart: piece.sourceStart,
        sourceEnd: piece.sourceEnd,
        timelineStart: timeline,
        timelineEnd: timeline + piece.duration,
      })
      timeline += piece.duration
      continue
    }

    if (piece.kind === 'cut') {
      steps.push({
        kind: 'cut',
        id: piece.id,
        sourceStart: piece.sourceStart,
        sourceEnd: piece.sourceEnd,
      })
      continue
    }

    steps.push({
      kind: 'black',
      id: piece.id,
      durationS: piece.duration,
      holdSourceTime: piece.holdSourceTime,
      timelineStart: timeline,
      timelineEnd: timeline + piece.duration,
    })
    timeline += piece.duration
  }

  return steps
}

export function getAssemblyDuration(project: EditorProject): number {
  const pieces = buildAssemblyPieces(project)
  if (pieces.length === 0) return 0
  return pieces[pieces.length - 1]!.assemblyEnd
}

/** Map edited (playable) time → assembly bar position (cuts take space, skipped on play). */
export function editedToAssembly(project: EditorProject, editedTime: number): number {
  const pieces = buildAssemblyPieces(project)
  let editCursor = 0
  for (const piece of pieces) {
    if (piece.kind === 'cut') continue
    const nextEdit = editCursor + piece.duration
    if (editedTime <= nextEdit + 0.0005) {
      return piece.assemblyStart + Math.max(0, editedTime - editCursor)
    }
    editCursor = nextEdit
  }
  return getAssemblyDuration(project)
}

/** Map assembly bar position → edited seek time (lands on playable media). */
export function assemblyToEdited(project: EditorProject, assemblyTime: number): number {
  const pieces = buildAssemblyPieces(project)
  const t = Math.max(0, Math.min(assemblyTime, getAssemblyDuration(project)))
  let editCursor = 0

  for (const piece of pieces) {
    if (t < piece.assemblyEnd - 0.0005 || piece === pieces[pieces.length - 1]) {
      if (piece.kind === 'cut') {
        // Snap to the next playable piece start (or previous end).
        return editCursor
      }
      return editCursor + Math.max(0, Math.min(piece.duration, t - piece.assemblyStart))
    }
    if (piece.kind !== 'cut') editCursor += piece.duration
  }

  return getEditedDuration(project)
}

/** Source time under an assembly position (for cut / frame insert). */
export function assemblyToSource(project: EditorProject, assemblyTime: number): number {
  const pieces = buildAssemblyPieces(project)
  const t = Math.max(0, Math.min(assemblyTime, getAssemblyDuration(project)))

  for (const piece of pieces) {
    if (t >= piece.assemblyStart && t <= piece.assemblyEnd) {
      if (piece.kind === 'black') return piece.holdSourceTime
      if (piece.kind === 'cut') {
        return piece.sourceStart + (t - piece.assemblyStart)
      }
      return piece.sourceStart + (t - piece.assemblyStart)
    }
  }

  return project.trimEnd
}

/** Build edited timeline: kept video ranges + black-frame inserts. */
export function buildTimelineSegments(project: EditorProject): TimelineSegment[] {
  const kept = keptSourceRanges(project)
  const inserts = [...project.blackFrames].sort((a, b) => a.afterSourceTime - b.afterSourceTime)

  const pieces: Array<
    | { kind: 'video'; start: number; end: number }
    | { kind: 'black'; id: string; durationS: number; holdSourceTime: number }
  > = []

  for (const range of kept) {
    const localInserts = inserts.filter(
      (item) => item.afterSourceTime > range.start + 0.001 && item.afterSourceTime < range.end - 0.001,
    )
    let cursor = range.start
    for (const insert of localInserts) {
      if (insert.afterSourceTime > cursor) {
        pieces.push({ kind: 'video', start: cursor, end: insert.afterSourceTime })
      }
      pieces.push({
        kind: 'black',
        id: insert.id,
        durationS: Math.max(0.2, insert.durationS),
        holdSourceTime: insert.afterSourceTime,
      })
      cursor = insert.afterSourceTime
    }
    if (cursor < range.end) pieces.push({ kind: 'video', start: cursor, end: range.end })

    // Frames placed exactly at a kept range end
    for (const insert of inserts.filter((item) => Math.abs(item.afterSourceTime - range.end) < 0.02)) {
      if (pieces.some((piece) => piece.kind === 'black' && piece.id === insert.id)) continue
      pieces.push({
        kind: 'black',
        id: insert.id,
        durationS: Math.max(0.2, insert.durationS),
        holdSourceTime: range.end,
      })
    }
  }

  // Frames before first kept or between ranges (at cut boundaries)
  for (const insert of inserts) {
    if (pieces.some((piece) => piece.kind === 'black' && piece.id === insert.id)) continue
    const insideKept = kept.some(
      (range) => insert.afterSourceTime >= range.start && insert.afterSourceTime <= range.end,
    )
    if (!insideKept) {
      // Place after nearest previous kept end, or at trim start
      pieces.push({
        kind: 'black',
        id: insert.id,
        durationS: Math.max(0.2, insert.durationS),
        holdSourceTime: insert.afterSourceTime,
      })
    }
  }

  // Re-sort: video by start, blacks by hold time — simple pass already mostly ordered.
  // Rebuild cleanly in source order:
  const events: Array<
    | { kind: 'video'; start: number; end: number }
    | { kind: 'black'; id: string; durationS: number; holdSourceTime: number; order: number }
  > = []

  for (const range of kept) {
    const rangeInserts = inserts
      .filter((item) => item.afterSourceTime >= range.start && item.afterSourceTime <= range.end)
      .sort((a, b) => a.afterSourceTime - b.afterSourceTime)

    let cursor = range.start
    for (const insert of rangeInserts) {
      if (insert.afterSourceTime - cursor > 0.01) {
        events.push({ kind: 'video', start: cursor, end: insert.afterSourceTime })
      }
      events.push({
        kind: 'black',
        id: insert.id,
        durationS: Math.max(0.2, insert.durationS),
        holdSourceTime: insert.afterSourceTime,
        order: insert.afterSourceTime,
      })
      cursor = insert.afterSourceTime
    }
    if (range.end - cursor > 0.01) {
      events.push({ kind: 'video', start: cursor, end: range.end })
    }
  }

  const segments: TimelineSegment[] = []
  let timelineCursor = 0
  for (const event of events) {
    if (event.kind === 'video') {
      const length = event.end - event.start
      segments.push({
        kind: 'video',
        sourceStart: event.start,
        sourceEnd: event.end,
        timelineStart: timelineCursor,
        timelineEnd: timelineCursor + length,
      })
      timelineCursor += length
    } else {
      segments.push({
        kind: 'black',
        id: event.id,
        durationS: event.durationS,
        holdSourceTime: event.holdSourceTime,
        timelineStart: timelineCursor,
        timelineEnd: timelineCursor + event.durationS,
      })
      timelineCursor += event.durationS
    }
  }

  return segments
}

export function getEditedDuration(project: EditorProject): number {
  const segments = buildTimelineSegments(project)
  if (segments.length === 0) return 0
  return segments[segments.length - 1]!.timelineEnd
}

export function timelineToSource(project: EditorProject, timelineTime: number): number {
  const segments = buildTimelineSegments(project)
  if (segments.length === 0) return project.trimStart

  const t = Math.max(0, Math.min(timelineTime, getEditedDuration(project)))
  for (const segment of segments) {
    if (t >= segment.timelineStart && t <= segment.timelineEnd) {
      if (segment.kind === 'black') return segment.holdSourceTime
      return segment.sourceStart + (t - segment.timelineStart)
    }
  }

  const last = segments[segments.length - 1]!
  return last.kind === 'black' ? last.holdSourceTime : last.sourceEnd
}

export function sourceToTimeline(project: EditorProject, sourceTime: number): number | null {
  const segments = buildTimelineSegments(project)
  for (const segment of segments) {
    if (segment.kind === 'video' && sourceTime >= segment.sourceStart && sourceTime <= segment.sourceEnd) {
      return segment.timelineStart + (sourceTime - segment.sourceStart)
    }
  }
  return null
}

/** Clamp a source time onto the nearest active (kept / untrimmed) media. */
export function clampSourceToKept(project: EditorProject, sourceTime: number): number {
  const videoSegments = buildTimelineSegments(project).filter(
    (segment): segment is Extract<TimelineSegment, { kind: 'video' }> => segment.kind === 'video',
  )

  if (videoSegments.length === 0) return Math.max(0, project.trimStart)

  for (const segment of videoSegments) {
    if (sourceTime >= segment.sourceStart && sourceTime <= segment.sourceEnd) {
      return sourceTime
    }
  }

  let best = videoSegments[0]!.sourceStart
  let bestDist = Number.POSITIVE_INFINITY
  for (const segment of videoSegments) {
    for (const edge of [segment.sourceStart, segment.sourceEnd]) {
      const distance = Math.abs(edge - sourceTime)
      if (distance < bestDist) {
        bestDist = distance
        best = edge
      }
    }
  }
  return best
}

/**
 * Map a source playhead (full bar) onto a playable edited timeline position.
 * If the playhead sits in a trimmed-out / cut region, snap to the nearest kept
 * media; if past the end of the last segment, snap to the start of the edit.
 */
export function resolvePlayableTimeline(
  project: EditorProject,
  preferredSourceTime: number,
): { timelineTime: number; sourceTime: number } {
  const sourceTime = clampSourceToKept(project, preferredSourceTime)
  const mapped = sourceToTimeline(project, sourceTime)
  if (mapped != null) {
    return { timelineTime: mapped, sourceTime }
  }

  const videoSegments = buildTimelineSegments(project).filter(
    (segment): segment is Extract<TimelineSegment, { kind: 'video' }> => segment.kind === 'video',
  )
  const first = videoSegments[0]
  if (!first) {
    return { timelineTime: 0, sourceTime: Math.max(0, project.trimStart) }
  }
  return { timelineTime: first.timelineStart, sourceTime: first.sourceStart }
}

export function findSegmentAtTimeline(project: EditorProject, timelineTime: number): TimelineSegment | null {
  const segments = buildTimelineSegments(project)
  if (segments.length === 0) return null

  const t = Math.max(0, Math.min(timelineTime, getEditedDuration(project)))

  // Prefer black inserts so their duration is respected at join points.
  for (const segment of segments) {
    if (segment.kind === 'black' && t >= segment.timelineStart && t < segment.timelineEnd) {
      return segment
    }
  }

  for (const segment of segments) {
    if (segment.kind === 'video' && t >= segment.timelineStart && t < segment.timelineEnd) {
      return segment
    }
  }

  return segments[segments.length - 1] ?? null
}

export function transitionProgressAt(
  project: EditorProject,
  timelineTime: number,
  transitionWindowS = project.transitionDurationS ?? 0.5,
): { type: EditorTransitionType; progress: number; isJoin: boolean } {
  const segments = buildTimelineSegments(project)
  const segment = findSegmentAtTimeline(project, timelineTime)
  if (!segment || segments.length === 0) {
    return { type: 'none', progress: 1, isJoin: false }
  }

  const index = segments.findIndex((item) => item.timelineStart === segment.timelineStart)
  const isJoin = index > 0 && segment.kind === 'video'
  if (!isJoin || project.transition === 'none' || transitionWindowS <= 0) {
    return { type: project.transition, progress: 1, isJoin: false }
  }

  const intoSegment = timelineTime - segment.timelineStart
  const progress = Math.min(1, Math.max(0, intoSegment / transitionWindowS))
  return { type: project.transition, progress, isJoin: true }
}
