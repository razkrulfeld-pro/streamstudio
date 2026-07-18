# Publish Dialog Redesign — Design

**Date:** 2026-07-16  
**Status:** Approved  
**Approach:** Single modal with Review → Uploading → Success (enhance `PublishButton`)

## Goal

Turn the YouTube publish popup into a clear three-phase experience: editable review of upload settings, one engaging progress-aware loader for the entire wait, and a happy success state with the watch link and a short note that YouTube may take up to ~1 minute to make the video fully live.

## Non-goals

- Changing content type (Short / Standard / Square) at publish time
- Scheduling, thumbnails, playlists, or multi-platform publish
- Canceling an in-flight YouTube upload mid-chunk (dialog stays locked while busy)
- Adding Lottie or new animation libraries (use existing `framer-motion` + CSS)

## Flow

One modal opened by **Publish to YouTube**. Three mutually exclusive phases:

| Phase | When | User can |
| --- | --- | --- |
| **Review** | Dialog open, not busy, not success | Edit metadata, Cancel, Upload / Try Again |
| **Uploading** | Exporting edit or uploading to YouTube | Watch progress only (no dismiss) |
| **Success** | Upload returned `UploadResult` | Open on YouTube, copy link, Done |

Content type remains read-only (shown as a summary chip). Aspect ratio and duration limits stay as recorded.

## Review phase

### Editable fields

Prefilled from `SessionYouTubeMetadata`:

- **Title** (text) — same title-suffix preview as today when `titleSuffix` is set
- **Description** (textarea)
- **Privacy** — Public / Unlisted / Private (same options as settings)
- **Tags** — comma-separated text input, parsed to `string[]` on save
- **Category** — select from the same category list as YouTube settings (`22`, `27`, `28`, `24`, …)
- **Made for kids** — boolean toggle

### Read-only

- Content type label (and max-duration hint when applicable)

### Persistence

Sync the full draft metadata live as fields change via `onPublishMetadataChange` (generalize today’s title-only callback). Closing without uploading still keeps the edits on the recording. Failed uploads keep the edited draft as well.

`PublishButton` exposes `onPublishMetadataChange` for the full `SessionYouTubeMetadata` object; drop title-only as the sole path once parents are wired.

### Validation

- Empty title → fall back to `"Untitled recording"` at upload (current behavior)
- If `maxDurationSeconds` is set and edited duration exceeds it → block upload and show the existing duration error in Review (do not enter Uploading)

## Uploading phase — single loader

One surface covers **both** export and YouTube upload. No second spinner or second progress UI.

### Combined progress

Map to a single 0–100% value:

- **Export** occupies **0–35%** of the bar (`exportProgress * 0.35`)
- **Upload** occupies **35–100%** (`35 + uploadProgress * 0.65`)

Phase label switches with the internal phase:

- Exporting: “Rendering your edit…”
- Uploading: “Sending to YouTube…” / “Almost there…” near the end

Rotate short friendly sublines every few seconds (e.g. “Polishing the cut…”, “Packing the upload…”, “Handing it to YouTube…”) for anticipation — cosmetic only; the bar always reflects real combined progress.

### Visual treatment

Playful, conventional loader using existing stack (`framer-motion` + Lucide):

- Centered illustration motif (e.g. soft bouncing film-reel / upload rocket style motion — CSS/SVG, no new assets required)
- Determinate progress bar under it
- Large % readout
- Phase + rotating subline

Match existing app neutrals / accent (`#5234d2` or current brand tokens). Avoid a second indeterminate spinner.

### Dialog behavior while busy

- Disable Cancel / backdrop dismiss
- Do not reset progress on unrelated re-renders
- On error: return to Review with error message and **Try Again** (loader dismissed)

## Success phase

Happy, clear confirmation:

- Celebratory heading (e.g. “It’s on YouTube!”)
- Short body: upload succeeded; YouTube may take **up to about a minute** to finish processing before the video is fully live/playable everywhere
- Primary link: **Watch on YouTube** → `result.videoUrl` (new tab)
- Secondary: **Copy link** (clipboard + brief “Copied” feedback)
- **Done** closes the dialog and resets publish hook state

## Component shape

Keep orchestration in `PublishButton`; extract presentational pieces under `src/components/publish/` (or colocated) if the file grows:

- `PublishReviewForm` — editable fields
- `PublishUploadLoader` — illustration + combined progress + copy
- `PublishSuccessState` — celebration + link actions

Hook (`usePublish`) stays the source of upload status/progress/result/error. Local `phase` still tracks export vs upload for combined progress math.

Reuse category/visibility option lists from settings (shared constant module or import from a small shared config) to avoid drift.

## Error handling

| Case | Behavior |
| --- | --- |
| Export failure | Review + error; status idle |
| Upload failure | Review + error; `usePublish` status `error`; Try Again |
| Duration over limit | Stay in Review; no export started |
| Network / auth errors | Surface API message as today |

## Testing (manual)

1. Open Publish → all review fields editable and prefilled  
2. Change privacy/category/tags/kids → Upload → uploaded video matches on YouTube Studio  
3. Edits persist on the draft after cancel/reopen or failed upload  
4. Loader is a single UI; % advances through export then upload without jumping back to 0 mid-flow (except true restart)  
5. Success shows ~1 min note + working watch link + copy  
6. Cannot dismiss dialog during upload  

## Out of scope (explicit)

- Editing content type after recording  
- Upload cancel / abort controller UI  
- Server-side processing status polling beyond what YouTube returns at upload complete  
