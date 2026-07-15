# Editor Audio Panel — Design

Date: 2026-07-14  
Status: **Superseded** — see `docs/superpowers/plans/2026-07-14-insert-audio-cloud-run.md`

## Goal

Make the editor **Audio** panel control per-channel mix (camera vs screen) and let the user insert background/music audio by pasting a **YouTube URL**, with start time, duration, and volume relative to the edited recording.

## Current state

- `EditorProject` has `cameraVolume` and `screenVolume` (0–1).
- Preview applies a single average: `(cameraVolume + screenVolume) / 2` on the draft `<video>`.
- Recordings are mixed into one file at capture time; camera vs screen volumes are **preview intent / future mix knobs**, not separate decoded tracks yet.
- No overlay / inserted audio clip model exists.
- No extract backend exists (Vite SPA only).

## Decisions (approved)

1. **Channel controls:** mute toggle + volume slider per channel (camera, screen). Explicit mute flags so unmuting restores the previous slider level.
2. **Insert method:** YouTube URL → small **local backend** using `yt-dlp` → audio file stored with the draft.
3. **Insert controls:** start point on the edited timeline, duration, volume.
4. **v1 scope:** one inserted overlay clip at a time (replace or clear before adding another).

## Architecture

```
┌─────────────────────┐     POST /api/audio/youtube      ┌──────────────────────┐
│ Editor Audio panel  │ ───────────────────────────────► │ Local extract server │
│ (React)             │ ◄──────── audio blob + meta ──── │ (Node + yt-dlp)      │
└─────────┬───────────┘                                  └──────────────────────┘
          │
          ▼
┌─────────────────────┐
│ IndexedDB draft     │
│ - editorProject     │
│ - overlayAudioBlob  │
└─────────────────────┘
```

- Frontend remains Vite/React.
- New lightweight Node (or similar) service runs beside `npm run dev` (e.g. `npm run audio-server`).
- Vite proxies `/api/audio/*` to that server in development.

### Extract API (local)

`POST /api/audio/youtube`

Request:

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

Response (success): multipart or JSON+base64 — prefer returning:

- `audio` — binary body (`audio/mpeg` or `audio/webm`) via multipart, **or** JSON with a temporary download URL served by the same server under `/api/audio/files/:id` for the client to `fetch` into a `Blob`.
- metadata: `{ title, durationS, sourceUrl, thumbnailUrl? }`

Errors (JSON): `{ error: string }` with HTTP 4xx/5xx for invalid URL, private/unavailable video, extract failure.

### System requirements

- `yt-dlp` installed and on `PATH` (document in README).
- Optional: `ffmpeg` if yt-dlp needs it for audio remux — document if required.

## Data model

Extend `EditorProject`:

```ts
cameraVolume: number      // 0–1 (existing)
screenVolume: number      // 0–1 (existing)
cameraMuted: boolean      // new, default false
screenMuted: boolean      // new, default false

overlayAudio: null | {
  id: string
  sourceUrl: string
  title: string
  /** Full extracted clip duration in seconds */
  sourceDurationS: number
  /** When the overlay starts on the *edited* timeline */
  startAtEditedS: number
  /** How long it plays in the edit (≤ remaining source and edit length) */
  durationS: number
  volume: number          // 0–1
}
```

Effective channel gain for preview:

- `cameraGain = cameraMuted ? 0 : cameraVolume`
- `screenGain = screenMuted ? 0 : screenVolume`
- Combined draft video gain (v1, single mixed file):  
  `videoGain = clamp01((cameraGain + screenGain) / 2)`  
  If both muted → `0`.

**Blob storage:** store overlay audio blob keyed by recording id (or `overlayAudio.id`) in IndexedDB alongside the draft (extend `recording-storage` / recordings context), not only in memory.

## UI (Audio panel)

Match existing `PanelFieldHeading` styles.

### Channels

For **Camera audio** and **Screen audio**:

- Heading + mute checkbox (“Mute”) or icon toggle as trailing control.
- Volume slider (0–100%), dimmed/disabled when muted.
- Trailing % readout when not muted.

### Inserted audio

Empty state:

- Hint: paste a YouTube link to add music / bed under the recording.
- URL input + **Add** button.
- Loading: “Fetching audio…”

Filled state (one clip):

- Title (and optional thumb).
- **Start at** — number input or range over edited duration.
- **Duration** — range, max = `min(sourceDurationS, editedDuration - startAtEditedS)`.
- **Volume** — range 0–100%.
- **Remove** — clears clip + blob.

Validation: clamp start/duration when trim/cuts change so the window stays inside the edited timeline.

## Preview behavior

While the draft video plays:

1. Apply `videoGain` to the main `<video>`.
2. If `overlayAudio` is set and timeline is within `[startAtEditedS, startAtEditedS + durationS)`:
   - Play/seek a secondary `<audio>` (or `Audio` element) to `timeline - startAtEditedS` (plus any offset if we later support source in-point — v1 source in-point = 0).
   - Set overlay element volume to `overlayAudio.volume`.
3. Outside that window: pause overlay audio (or keep muted).

On playhead scrub / seek: sync overlay `currentTime` the same way.

## Publish / export (v1 note)

v1 delivers **preview-faithful mixing in the editor**. Baking overlay + channel gains into the published file may remain a follow-up unless export already re-encodes; document as out-of-scope for the first implementation slice if needed, but keep data so export can consume it later.

## Error handling

| Case | UX |
|------|----|
| Invalid / non-YouTube URL | Inline error under input |
| Video unavailable / private | Inline error from server message |
| Extract timeout / yt-dlp missing | Clear “Audio service unavailable — is it running?” |
| Replace existing clip | Confirm or auto-replace with toast “Replaced previous clip” |

## Out of scope (v1)

- Multiple overlay tracks / stacking.
- Spotifying / generic “any site” beyond what yt-dlp accepts when given a URL (YouTube is the primary UX; other yt-dlp URLs may work but are not marketed).
- Separate unmixed camera/screen audio stems (requires capture pipeline change).
- Cloud-hosted extract (local server only for now).

## Implementation slices (for planning)

1. Channel mute + volume UI + effective `videoGain` in preview.
2. Local extract server + Vite proxy + fetch client helper.
3. Overlay data model + IndexedDB blob persistence.
4. Audio panel YouTube insert UI + start/duration/volume.
5. Preview sync (secondary audio with playhead).
6. README / `package.json` scripts for running extract server with `yt-dlp`.

## Risks

- **YouTube ToS / fragility:** yt-dlp can break when YouTube changes; personal/local use only.
- **Single mixed recording file:** camera vs screen volume is approximate until separate tracks exist.
- **Large downloads:** cap max audio duration (e.g. 10–15 min) on the server to protect the browser.
