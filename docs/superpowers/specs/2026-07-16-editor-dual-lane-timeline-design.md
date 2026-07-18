# Editor Dual-Lane Timeline — Design

**Date:** 2026-07-16  
**Status:** Approved  
**Approach:** Dual lanes + live Web Audio waveform; hover preview without pausing playback

## Goal

Make the editor timeline easier to read by stacking a shorter video lane above dedicated audio lanes, and stop hover-scrub from interrupting active playback.

## Layout

Shared time axis (same trim window, playhead, hover line). Each lane is **half** of today’s single track height (`h-14` → `h-7` / ~28px per lane):

1. **Video lane** — kept regions, cuts, black frames, trim handles (existing behavior, shorter).
2. **Video audio lane** — real waveform peaks of the recording audio, aligned to the same assembly mapping (video pieces show peaks; cut/black gaps stay flat/empty).
3. **Inserted audio lane** — emerald bed / pending cue moved off the video track onto its own row. Shown only when overlay audio or a pending cue exists.

Playhead and hover scrub line span all visible lanes.

## Playback & hover

While **playing**:

- Hover still shows the scrub line and `+`
- Hover does **not** seek, enter scrub/drag mode, or pause
- Playback and audio keep running

Seek / pause only when the user:

- Clicks the timeline (seek; drag continues scrub), or
- Presses Pause

While **paused**: hover scrub behaves as today (preview frame under the cursor).

Trim handles, cut/frame edges, and `+` menu actions remain click/drag-driven.

## Waveform

- Decode recording audio once via Web Audio API (`decodeAudioData`) from the editor `videoBlob` (fallback: fetch `videoUrl`)
- Downsample to a fixed peak array (normalized 0–1), cached per media identity
- Render peaks in the video-audio lane for each `video` assembly piece; cut/black pieces leave a gap
- Failure to decode: show a muted solid bed (no crash)

## Non-goals

- Editing/muting the source video audio from the new lane
- Waveform for inserted overlay audio (lane is a solid bed)
- Changing cut/trim/export semantics
- New animation libraries

## Files

- `src/lib/audio-waveform.ts` (+ unit test for peak downsampling)
- `src/components/editor/capcut-timeline.tsx` — lane layout, waveform, hover gating
- `src/components/editor/editor-workspace.tsx` — pass `isPlaying`, media source into timeline
