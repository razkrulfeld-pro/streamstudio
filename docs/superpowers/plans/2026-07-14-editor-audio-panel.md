# Editor Audio Panel Implementation Plan

> **SUPERSEDED** by `docs/superpowers/plans/2026-07-14-insert-audio-cloud-run.md` (Cloud Run + honest channels + required export mix). Do not implement this plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the editor Audio panel per-channel mute/volume and YouTube-linked overlay audio (start, duration, volume) with local `yt-dlp` extraction and preview mixing.

**Architecture:** Extend `EditorProject` with mute flags + one `overlayAudio` clip; persist audio blobs on the draft in IndexedDB; run a small Node extract server proxied by Vite; sync a secondary `<audio>` element to the edited playhead in `EditorWorkspace`.

**Tech Stack:** React 19, TypeScript, Vite 8, IndexedDB (`recording-storage`), Node http server + `yt-dlp`, Framer Motion (existing panels).

## Global Constraints

- One overlay clip at a time (replace/clear before adding another).
- YouTube paste is the primary UX; extract via **local** `yt-dlp` server only (no cloud extract).
- Channel mute uses **explicit** `cameraMuted` / `screenMuted` (unmuting restores slider level).
- v1 preview mixes onto the existing single video file; do not rebuild capture into separate stems.
- Cap extracted audio length at **15 minutes** on the server.
- Reuse `PanelFieldHeading` / `PanelHint` styles — do not invent new heading classes.
- Match existing package scripts and `@/` aliases.
- Do not commit unless the user asks (plan “Commit” steps are optional for later).

---

## File map

| File | Responsibility |
|------|----------------|
| `src/types/editor-project.ts` | Mute flags, `OverlayAudioClip`, defaults, `effectiveVideoGain()` |
| `src/lib/audio-gain.ts` | Pure gain helpers (testable) |
| `src/lib/youtube-audio-client.ts` | `fetchYoutubeAudio(url)` → blob + meta |
| `src/lib/recording-storage.ts` | Persist `overlayAudioBlob` on stored drafts |
| `src/context/recordings-context.tsx` | Pass-through save/load of overlay blob if needed |
| `src/pages/editor-studio-page.tsx` | Load overlay blob URL into workspace |
| `src/components/editor/editor-workspace.tsx` | Audio panel UI, videoGain, overlay `<audio>` sync |
| `server/youtube-audio.mjs` | Local extract HTTP server |
| `vite.config.ts` | Proxy `/api/audio` → `localhost:8787` |
| `package.json` | `audio-server` / `dev:all` scripts |
| `README.md` | yt-dlp + ffmpeg + how to run |
| `src/lib/audio-gain.test.ts` | Unit tests for gain helper |

---

### Task 1: Data model + effective video gain

**Files:**
- Create: `src/lib/audio-gain.ts`
- Create: `src/lib/audio-gain.test.ts`
- Modify: `src/types/editor-project.ts`
- Modify: `package.json` (add `vitest` if missing; add `"test": "vitest run"`)

**Interfaces:**
- Produces: `effectiveVideoGain(project: Pick<EditorProject,'cameraVolume'|'screenVolume'|'cameraMuted'|'screenMuted'>): number`
- Produces: `OverlayAudioClip` type; `cameraMuted`/`screenMuted`/`overlayAudio` on `EditorProject`

- [ ] **Step 1: Add vitest (if not present) and a failing gain test**

```bash
npm install -D vitest
```

```ts
// src/lib/audio-gain.test.ts
import { describe, expect, it } from 'vitest'
import { effectiveVideoGain } from '@/lib/audio-gain'

describe('effectiveVideoGain', () => {
  it('averages unmuted channels', () => {
    expect(
      effectiveVideoGain({
        cameraVolume: 1,
        screenVolume: 0.5,
        cameraMuted: false,
        screenMuted: false,
      }),
    ).toBeCloseTo(0.75)
  })

  it('treats muted channel as 0', () => {
    expect(
      effectiveVideoGain({
        cameraVolume: 1,
        screenVolume: 1,
        cameraMuted: true,
        screenMuted: false,
      }),
    ).toBeCloseTo(0.5)
  })

  it('returns 0 when both muted', () => {
    expect(
      effectiveVideoGain({
        cameraVolume: 1,
        screenVolume: 1,
        cameraMuted: true,
        screenMuted: true,
      }),
    ).toBe(0)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `npx vitest run src/lib/audio-gain.test.ts`  
Expected: FAIL cannot find `@/lib/audio-gain` (or vitest path alias — configure `vitest.config.ts` with same `@` alias as Vite if needed)

- [ ] **Step 3: Implement helper + project types**

```ts
// src/lib/audio-gain.ts
export function effectiveVideoGain(input: {
  cameraVolume: number
  screenVolume: number
  cameraMuted: boolean
  screenMuted: boolean
}): number {
  const camera = input.cameraMuted ? 0 : Math.min(1, Math.max(0, input.cameraVolume))
  const screen = input.screenMuted ? 0 : Math.min(1, Math.max(0, input.screenVolume))
  return Math.min(1, Math.max(0, (camera + screen) / 2))
}
```

In `EditorProject` add:

```ts
cameraMuted: boolean
screenMuted: boolean
overlayAudio: OverlayAudioClip | null
```

```ts
export interface OverlayAudioClip {
  id: string
  sourceUrl: string
  title: string
  sourceDurationS: number
  startAtEditedS: number
  durationS: number
  volume: number
}
```

Defaults in `defaultEditorProject`: `cameraMuted: false`, `screenMuted: false`, `overlayAudio: null`.

Normalize loaded projects that lack new fields when seeding workspace state (spread defaults then initial).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run src/lib/audio-gain.test.ts`  
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS (fix any call sites that construct `EditorProject` literals)

---

### Task 2: Channel mute + volume UI and preview gain

**Files:**
- Modify: `src/components/editor/editor-workspace.tsx` (`AudioPanel` + video volume effect)

**Interfaces:**
- Consumes: `effectiveVideoGain`
- Produces: UI that patches `cameraMuted` / `screenMuted` / volumes

- [ ] **Step 1: Replace AudioPanel channel section**

For each channel (Camera / Screen), use `PanelFieldHeading` with trailing Mute checkbox; slider `disabled={muted}` with `opacity-40` when muted; trailing `%` when unmuted.

```tsx
<PanelFieldHeading
  trailing={
    <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
      <input
        type="checkbox"
        checked={project.cameraMuted}
        onChange={(e) => onPatch({ cameraMuted: e.target.checked })}
      />
      Mute
    </label>
  }
>
  Camera audio
</PanelFieldHeading>
<input
  type="range"
  min={0}
  max={1}
  step={0.01}
  disabled={project.cameraMuted}
  value={project.cameraVolume}
  onChange={(e) => onPatch({ cameraVolume: Number(e.target.value) })}
  className={cn('w-full accent-[#5234d2]', project.cameraMuted && 'opacity-40')}
/>
```

(Same pattern for screen.) Keep YouTube insert as a placeholder section heading only if Task 5 not done yet — or leave hint “YouTube insert coming next” temporarily; prefer implementing channels only and leave existing panel below empty until Task 5.

- [ ] **Step 2: Wire preview volume**

Replace the existing average effect with:

```ts
useEffect(() => {
  const video = videoRef.current
  if (!video) return
  video.volume = effectiveVideoGain(project)
}, [
  project.cameraVolume,
  project.screenVolume,
  project.cameraMuted,
  project.screenMuted,
  videoUrl,
])
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev` → open a draft → Audio panel → mute camera → hear quieter/half; mute both → silence; unmute restores slider level visually.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

---

### Task 3: Local YouTube extract server + Vite proxy

**Files:**
- Create: `server/youtube-audio.mjs`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `POST /api/audio/youtube` → JSON `{ id, title, durationS, sourceUrl, thumbnailUrl, downloadPath }` then `GET /api/audio/files/:id`
- Produces: Vite proxy `/api/audio` → `http://127.0.0.1:8787`

- [ ] **Step 1: Implement extract server**

```js
// server/youtube-audio.mjs — outline
// - createServer on 8787
// - POST /api/audio/youtube { url }
// - validate URL contains youtube.com or youtu.be
// - spawn yt-dlp: yt-dlp -x --audio-format mp3 --audio-quality 5
//   --max-downloads 1 --download-sections "*0-900" (15 min cap)
//   -o tempDir/%(id)s.%(ext)s --print-json URL
// - store file in os.tmpdir()/streamstudio-audio/{id}.mp3
// - respond { id, title, durationS, sourceUrl, thumbnailUrl }
// - GET /api/audio/files/:id streams the mp3
// - on yt-dlp missing: 503 { error: 'yt-dlp is not installed or not on PATH' }
```

Use `node:child_process` `spawn` with `yt-dlp` (not shell). Timeout ~120s. Clean old files older than 1h opportunistically.

- [ ] **Step 2: Vite proxy**

In `vite.config.ts` `server.proxy`:

```ts
server: {
  proxy: {
    '/api/audio': {
      target: 'http://127.0.0.1:8787',
      changeOrigin: true,
    },
  },
},
```

- [ ] **Step 3: Scripts + README**

```json
"audio-server": "node server/youtube-audio.mjs",
"dev:app": "vite",
"dev": "vite"
```

Document: install `yt-dlp` and `ffmpeg`; run `npm run audio-server` in one terminal and `npm run dev` in another.

- [ ] **Step 4: Smoke-test extract**

Terminal A: `npm run audio-server`  
Terminal B:

```bash
curl -s -X POST http://127.0.0.1:8787/api/audio/youtube \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}'
```

Expected: JSON with `id`, `title`, `durationS`. Then `curl -I http://127.0.0.1:8787/api/audio/files/<id>` → `200` and `audio/mpeg` (or similar).

---

### Task 4: Client fetch helper + IndexedDB overlay blob

**Files:**
- Create: `src/lib/youtube-audio-client.ts`
- Modify: `src/lib/recording-storage.ts`
- Modify: `src/context/recordings-context.tsx` (if update path needs blob)
- Modify: `src/pages/editor-studio-page.tsx`

**Interfaces:**
- Produces: `extractYoutubeAudio(url: string): Promise<{ blob: Blob; meta: OverlayAudioClipMeta }>`
- Produces: `StoredRecording.overlayAudioBlob?: Blob`
- Produces: workspace props `overlayAudioUrl: string | null`

- [ ] **Step 1: Client helper**

```ts
// src/lib/youtube-audio-client.ts
export async function extractYoutubeAudio(url: string) {
  const res = await fetch('/api/audio/youtube', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch audio')
  const fileRes = await fetch(`/api/audio/files/${data.id}`)
  if (!fileRes.ok) throw new Error('Failed to download extracted audio')
  const blob = await fileRes.blob()
  return {
    blob,
    meta: {
      id: data.id as string,
      sourceUrl: data.sourceUrl as string,
      title: data.title as string,
      sourceDurationS: Number(data.durationS),
      thumbnailUrl: (data.thumbnailUrl as string | undefined) ?? null,
    },
  }
}
```

- [ ] **Step 2: Persist blob on draft**

Extend `StoredRecording`:

```ts
overlayAudioBlob?: Blob
```

On `updateStoredRecording`, allow `overlayAudioBlob` patch (including `undefined` to clear — use a sentinel or explicit `null` clear in patch type).

Bump `DB_VERSION` only if schema upgrade needed — same object store is fine (extra fields OK in IDB).

- [ ] **Step 3: Load blob URL in editor page**

When loading draft, if `overlayAudioBlob` exists, `URL.createObjectURL` and pass to `EditorWorkspace`; revoke on cleanup. When saving draft, include blob from workspace callback.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

---

### Task 5: Audio panel — YouTube insert UI

**Files:**
- Modify: `src/components/editor/editor-workspace.tsx` (`AudioPanel` + props)

**Interfaces:**
- Consumes: `extractYoutubeAudio`, `OverlayAudioClip`, `editedDuration`
- Produces: panel that sets `overlayAudio` and notifies parent of new `Blob`

- [ ] **Step 1: Extend AudioPanel props**

```ts
editedDuration: number
overlayAudioUrl: string | null
onOverlayAudioBlob: (blob: Blob | null) => void
```

- [ ] **Step 2: Insert UI**

Empty: URL input + Add; loading state; error string under input.  
Filled: show `title`; fields **Start at**, **Duration**, **Volume** with `PanelFieldHeading`; Remove clears `overlayAudio` + `onOverlayAudioBlob(null)`.

On Add success:

```ts
onPatch({
  overlayAudio: {
    id: meta.id,
    sourceUrl: meta.sourceUrl,
    title: meta.title,
    sourceDurationS: meta.sourceDurationS,
    startAtEditedS: 0,
    durationS: Math.min(meta.sourceDurationS, editedDuration),
    volume: 0.8,
  },
})
onOverlayAudioBlob(blob)
```

Clamp duration max: `Math.min(sourceDurationS, Math.max(0, editedDuration - startAtEditedS))`.

Replace existing clip without confirm (spec: auto-replace); optional short `actionMessage` “Replaced previous clip”.

- [ ] **Step 3: Manual verify UI**

With audio-server running, paste a short public YouTube URL → see title + controls; remove clears.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

---

### Task 6: Preview overlay sync with playhead

**Files:**
- Modify: `src/components/editor/editor-workspace.tsx`

**Interfaces:**
- Consumes: `overlayAudioUrl`, `project.overlayAudio`, `timelineTime`, `isPlaying`

- [ ] **Step 1: Add hidden audio element**

```tsx
<audio ref={overlayAudioRef} src={overlayAudioUrl ?? undefined} preload="auto" />
```

- [ ] **Step 2: Sync effect**

Whenever `timelineTime`, `isPlaying`, or overlay fields change:

```ts
const clip = project.overlayAudio
const el = overlayAudioRef.current
if (!el || !clip || !overlayAudioUrl) {
  el?.pause()
  return
}
el.volume = Math.min(1, Math.max(0, clip.volume))
const local = timelineTime - clip.startAtEditedS
const inWindow = local >= 0 && local < clip.durationS
if (!inWindow) {
  el.pause()
  return
}
if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = local
if (isPlaying && el.paused) void el.play().catch(() => undefined)
if (!isPlaying && !el.paused) el.pause()
```

Also pause overlay in existing `stopCutPreview` / seek gates when appropriate (do not fight scrubbing — keep seeking sync via timelineTime updates).

- [ ] **Step 3: Manual verify**

Play draft with overlay starting at 2s for 5s: bed starts at 2s, stops at 7s; scrub into window hears music; main video gain still follows mute.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

---

### Task 7: Clamp overlay window when edits change + docs polish

**Files:**
- Modify: `src/components/editor/editor-workspace.tsx` or `src/types/editor-project.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-14-editor-audio-panel-design.md` (status → Approved)

**Interfaces:**
- Produces: `clampOverlayAudio(clip, editedDuration): OverlayAudioClip`

- [ ] **Step 1: Add clamp helper**

```ts
export function clampOverlayAudio(
  clip: OverlayAudioClip,
  editedDuration: number,
): OverlayAudioClip {
  const start = Math.min(Math.max(0, clip.startAtEditedS), Math.max(0, editedDuration))
  const maxDur = Math.min(clip.sourceDurationS, Math.max(0, editedDuration - start))
  const durationS = Math.min(Math.max(0.1, clip.durationS), Math.max(0.1, maxDur) || 0.1)
  return { ...clip, startAtEditedS: start, durationS }
}
```

Apply in an effect when `editedDuration` / trim / cuts change if `overlayAudio` is set.

- [ ] **Step 2: README section**

Document Audio panel: yt-dlp, ffmpeg, `npm run audio-server`, mute/volume, YouTube insert limits (15 min, one clip).

- [ ] **Step 3: Final verification**

- `npx vitest run`
- `npx tsc --noEmit`
- Manual: mute channels + YouTube bed end-to-end with save/reload draft (blob persists).

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Channel mute + volume | 2 |
| Explicit mute flags | 1–2 |
| `effectiveVideoGain` | 1–2 |
| YouTube extract local server | 3 |
| Vite proxy | 3 |
| Client extract + blob | 4 |
| IndexedDB persistence | 4 |
| Insert UI start/duration/volume | 5 |
| One clip / replace | 5 |
| Preview secondary audio sync | 6 |
| Clamp on edit length change | 7 |
| README / scripts | 3, 7 |
| 15 min cap | 3 |
| Export bake | Out of scope (noted in spec) |

## Placeholder scan

None intentional — server file is sketched with concrete endpoints and yt-dlp flags.

## Type consistency

- `OverlayAudioClip` defined in Task 1; used in Tasks 4–7.
- `extractYoutubeAudio` returns meta → mapped into `OverlayAudioClip` in Task 5.
- `effectiveVideoGain` used only for `<video>.volume` in Task 2+.
