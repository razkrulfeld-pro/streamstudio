# Insert Audio into Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract an audio-only clip (YouTube or local upload), preview it with audio controls, insert it into the existing editor project (including timeline placement), and persist the Blob + metadata in IndexedDB—without ever previewing, returning, or storing YouTube **video**.

**Architecture:** Netlify hosts the SPA. Cloud Run (FastAPI + yt-dlp + FFmpeg) extracts **audio only** from a YouTube URL. Local file upload is a client-side fallback. The clip is stored on the draft, shown on the CapCut timeline as an audio bed, and previewed via a secondary `<audio>` element synced to the edited playhead plus panel play/pause controls. YouTube picture never appears. **v1 does not export, remux, or rewrite the recording video file.**

**Tech Stack:** React 19, TypeScript, Vite, IndexedDB, FastAPI, yt-dlp, FFmpeg, Cloud Run, Netlify, optional GCS for short-lived extract objects.

**Date:** 2026-07-14  
**Status:** **Approved — implement v1**  
**Supersedes:** Prior drafts of this plan and `2026-07-14-editor-audio-panel.md`

---

## Scope questions (resolved)

### 1. Listen-only vs project insert?

**Inserted into the existing recording project** — timeline, volume/mute, remove/replace, IndexedDB. Not download-and-listen-only. YouTube **video** never appears.

### 2. Local audio upload in v1?

**Yes.**

---

## Core distinction

| Asset | Preview | Returned | Persisted |
|-------|---------|----------|-----------|
| YouTube **source video** | Never | Never | Never |
| Extracted / uploaded **audio** | Yes (`<audio>` + timeline bed) | Audio bytes only | Blob + metadata in IndexedDB |

---

## Global Constraints

- Never preview YouTube video.
- Backend produces only ≤**60s** audio; never returns/stores video.
- Prefer **M4A/AAC**; **MP3** only when AAC fails.
- Minimize download; section/range where supported; always cleanup temps.
- Progress: Validating → Processing audio → Ready / Failed.
- One inserted clip at a time (v1).
- IndexedDB migration, missing-blob handling, QuotaExceededError, cleanup on replace/remove, upload size limit.
- Production abuse/cost controls for YouTube extract.
- **Export / remux / canvas / MediaRecorder video composition are out of scope for v1.**
- UI must **not** claim Publish or Download includes the inserted audio.
- Do not commit unless the user asks.

---

## Definition of done (v1)

- Paste a YouTube URL  
- Select a source start time  
- Select a duration between 1 and 60 seconds  
- Extract an audio-only clip  
- Never preview, return, or persist the YouTube video  
- Preview the extracted clip using audio-only controls  
- Insert it into the existing editor project  
- Place it on the existing timeline  
- Control volume and mute  
- Remove or replace it  
- Support local audio upload as a fallback  
- Store the audio Blob and metadata in IndexedDB  
- Restore the audio correctly when reopening the draft  

Publishing or downloading an existing video does **not** need to bake in the inserted audio in this phase.

---

## Explicitly out of scope (v1)

- Export mix / remux into a final video file  
- Canvas-based video composition  
- MediaRecorder video export  
- Video codec/container compatibility work for rewrite  
- Any claim that Publish/Download includes inserted audio  

---

## Time semantics

| Concept | Meaning |
|---------|---------|
| Source `startTimeSeconds` + `durationSeconds` | Window inside YouTube/upload source; baked into clip; **1–60s**. |
| Placement `startAtEditedS` + `durationS` | On edited timeline; default **0** + full clip length after Ready. |

---

## Data model

```ts
export type OverlayAudioSourceType = 'youtube' | 'upload'

export interface OverlayAudioClip {
  id: string
  sourceType: OverlayAudioSourceType
  sourceUrl?: string
  fileName?: string
  sourceDurationS: number
  extractStartSeconds?: number
  format: 'm4a' | 'mp3' | 'other'
  startAtEditedS: number
  durationS: number
  volume: number
  muted: boolean
  createdAt: string
}
```

- `EditorProject.overlayAudio: OverlayAudioClip | null`
- `StoredRecording.overlayAudioBlob?: Blob`
- One clip in v1

---

## Phases

| Phase | Deliverable |
|-------|-------------|
| **A** | Types + IDB blob + migration + restore on reopen |
| **B–C** | Cloud Run extract (audio-only) + cleanup + storage port |
| **D** | YouTube insert UI + Ready audio controls + project meta |
| **E** | Upload fallback + size/quota handling |
| **F** | Timeline bed + playhead-synced `<audio>` under recording preview |
| **G** | Production hardening + Netlify env |
| **H** | Tests + one-clip copy + Publish/Download honesty copy |

**Feature complete after Phase F** (+ restore path from A). Phase G before public YouTube extract traffic.

Report after each phase: files changed, tests run/results, deviations, manual setup.

---

## Channel honesty

Prefer **Original recording** + **Inserted audio** volume/mute over fake Camera/Screen labels when touching the Audio panel.

---

## Backend (YouTube)

`POST /api/extract` → temporary audio URL; client downloads once into IndexedDB.

---

## Known limitations

- Inserted audio is in the **project / preview** only; Publish/Download do not bake it in v1.  
- Source download may exceed 60s window; client receives ≤60s audio.  
- One clip only.  
