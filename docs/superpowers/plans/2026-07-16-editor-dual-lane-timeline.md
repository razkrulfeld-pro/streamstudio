# Editor Dual-Lane Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halve each timeline lane height, add a real waveform video-audio lane plus an inserted-audio lane, and keep playback running on hover.

**Architecture:** Extract peak downsampling into `audio-waveform.ts`. Restructure `CapCutTimeline` into stacked `h-7` lanes under one shared X axis; gate hover seek on `isPlaying`.

**Tech Stack:** React, Web Audio API, Tailwind, node:test

## Global Constraints

- Each lane height = half of current track (`h-7`)
- Hover while playing: show scrub UI only; no seek/pause
- Waveform from recording media; inserted audio stays solid emerald bed

---

### Task 1: Waveform peaks helper

**Files:**
- Create: `src/lib/audio-waveform.ts`
- Create: `src/lib/audio-waveform.test.ts`

- [x] Write tests for `downsamplePeaks` (empty, constant, length clamp)
- [x] Implement `downsamplePeaks` + `extractWaveformPeaks(blob|arrayBuffer)`

### Task 2: Timeline lane layout + hover gating

**Files:**
- Modify: `src/components/editor/capcut-timeline.tsx`
- Modify: `src/components/editor/editor-workspace.tsx`

- [x] Pass `isPlaying`, `videoBlob`, `videoUrl` into `CapCutTimeline`
- [x] Stack video / video-audio / inserted-audio lanes at `h-7`
- [x] Move inserted audio off video lane
- [x] Render waveform per video assembly piece
- [x] Gate `previewHoverAssembly` / `onDragChange` when `isPlaying`

### Task 3: Verify

- [x] Run waveform unit tests
- [x] Typecheck / lint touched files
