# Connect Device Mirror — Design

**Date:** 2026-07-18  
**Status:** Approved  
**Approach:** FastAPI subprocess (adb + scrcpy + ffmpeg) → live fMP4 HTTP stream → existing screen layer via `video.captureStream()`

## Goal

Add a **Connect Device** source option alongside screen share in the studio recorder. When selected, the app uses a phone already listed by `adb devices` (Wireless debugging paired, or USB), and mirrors it into the existing recorder frame with no visible scrcpy UI. Phone video and audio feed the same compositor and screen-audio path used by screen share today.

## Non-goals

- LAN port scanning for random Wireless debugging ports (Android 11+ often uses a non-5555 port)
- Pairing / QR pairing UI inside the app (pair once via system Wireless debugging + `adb pair` / USB authorize)
- Multiple simultaneous device sessions
- Touch / keyboard injection or remote control of the phone
- A Node.js sidecar or Electron shell (Python FastAPI `subprocess` only)
- New UI component families or design patterns
- Changing camera, effects, or export pipelines beyond accepting the device stream as the screen source

## Decisions

| Topic | Choice |
| --- | --- |
| Runtime | Extend FastAPI with `subprocess` for `adb`, `scrcpy`, `ffmpeg` (Homebrew on PATH) |
| Discovery | Read `adb devices`; prefer a network serial (`host:port`); else first ready USB/emulator device. No LAN scan. |
| Source model | Mutually exclusive with screen share; same screen layer / compositor path |
| Transport | scrcpy → ffmpeg → live fragmented MP4 over HTTP; play in existing screen `<video>`; `captureStream()` for `MediaStream` |
| Audio | Device audio via scrcpy, routed through existing screen-share audio path (monitor + record) |
| Orientation | Rely on stream frame size; compositor already uses `videoWidth` / `videoHeight` |

## Architecture

```
Phone already in `adb devices` (wireless host:port or USB)
        ▼
FastAPI device service
  ├── adb devices → pick serial
  ├── scrcpy --no-playback --max-size 1080 --video-bit-rate 8M (+ audio)
  └── ffmpeg → live fragmented MP4 (stdout)
        │  GET /api/device/stream
        ▼
screen <video>  →  captureStream()  →  screenStreamRef (video + audio)
        │
        ▼
existing canvas compositor + MediaRecorder
```

- Single in-memory device session on the backend (one active pipeline at a time).
- scrcpy runs headless (`--no-playback` / equivalent no-display flag); never opens a window.
- Frontend never shells out; it only calls REST endpoints and consumes the stream URL.
- Stopping the mirror does not `adb disconnect` — pairing stays intact.

## UI

Match existing studio patterns only.

### Empty state

When neither screen share nor device mirror is active, keep the centered empty-state prompt. Offer two actions side by side in the same white pill button style as today’s **Share screen** CTA:

- **Share screen** — existing `getDisplayMedia` flow
- **Connect Device** — starts device discovery / connect

Update helper text to mention either control in the dock below.

### Dock / screen control

- The existing Monitor (screen) control remains the affordance for the screen *layer*.
- Starting **Connect Device** does not open the OS screen picker.
- Screen share and Connect Device are mutually exclusive: starting one stops the other (disconnect device or stop display capture as needed).
- While the device is connected, the Monitor control uses the same “enabled” styling as active screen share.
- The chevron still opens the existing **Screen share** side panel (background, margins, corner radius). Those layout settings apply to the phone frame exactly as they do for screen share.

### Connection status overlay

Shown inside the recorder frame, using the same dark/glass treatment as “Connecting camera and microphone…”:

| State | User-facing copy (calm, non-technical) |
| --- | --- |
| Searching | Looking for your phone on the local network… |
| Found | Phone found. Connecting… |
| Connecting | Starting mirror… |
| Connected | Overlay dismisses; feed fills the screen layer |
| Error | Friendly message + **Retry** (same white pill style as Share screen) |

Do not surface ADB, scrcpy, ffmpeg, or port numbers in the UI.

## API

New FastAPI router under `/api/device`:

| Endpoint | Role |
| --- | --- |
| `POST /api/device/connect` | List `adb devices` → pick serial → launch scrcpy + ffmpeg. Idempotent if already searching/connecting/connected. |
| `GET /api/device/status` | `{ state, deviceAddress?, message?, error? }` |
| `GET /api/device/stream` | Live fragmented MP4 (video + audio). Valid only when `state === connected`. |
| `POST /api/device/disconnect` | Kill processes, `adb disconnect`, reset to `idle`. |

### Status states

`idle` | `searching` | `found` | `connecting` | `connected` | `error`

### Process pipeline

1. Resolve `adb`, `scrcpy`, and `ffmpeg` from `PATH` (Homebrew).
2. Run `adb devices` and pick a ready serial (`device` state). Prefer a network serial (`host:port`, including Android 11+ random ports); otherwise use the first USB/emulator device.
3. Do **not** LAN-scan or call `adb connect` — the phone must already be paired/authorized so it appears in `adb devices`.
4. Start scrcpy with at least:
   - `--no-playback` (no window)
   - `--max-size=1080`
   - `--video-bit-rate=8M` (or `--bit-rate` alias if required by installed version)
   - audio enabled so phone audio is included in the recorded/piped output
5. Pipe scrcpy output into ffmpeg producing fragmented MP4 suitable for progressive/live play:
   - `frag_keyframe+empty_moov+default_base_moof` (or equivalent low-latency fMP4 flags)
   - Content-Type `video/mp4` on `/api/device/stream`

Exact scrcpy/ffmpeg argv may be adjusted for the Homebrew versions installed, as long as behavior matches: invisible mirror, 1080 max, ~8 Mbps video, audio included, stream playable in Chrome/Safari via the screen `<video>`.

### Frontend wiring

1. On Connect Device: `POST /api/device/connect`, then poll `GET /api/device/status` about every 500ms while state is `searching` | `found` | `connecting`.
2. On `connected`: set the existing screen `<video>` `src` to the stream URL, `play()`, then `captureStream()` into `screenStreamRef` (video + audio tracks).
3. Mark screen layer enabled; set `screenAudioAvailable` from whether the captured stream has audio tracks; honor existing `screenAudioEnabled` mute/toggle and recording mix.
4. On exit, discard, disconnect, or switching to OS screen share: `POST /api/device/disconnect`, clear `src` / stream refs the same way as stopping screen share today.

## Error handling

Always show a clear friendly message and a **Retry** button that calls connect again (after disconnect/cleanup).

| Condition | Message direction |
| --- | --- |
| No ready device in `adb devices` | Couldn’t find a connected phone. Pair it with Wireless debugging (or plug in USB), then try again. |
| `adb` / `scrcpy` / `ffmpeg` missing from PATH | Device tools aren’t available on this Mac. Install adb, scrcpy, and ffmpeg (Homebrew), then retry. |
| `adb connect` or pipeline fails to start | Couldn’t connect to your phone. Check that it’s unlocked and on the same Wi‑Fi, then retry. |
| Stream or processes die mid-session | Connection lost. Retry to reconnect. Tear down backend processes, set `error`, clear the video layer. |

- Starting Share screen while a device session exists → disconnect device first, then start display capture.
- Retry → disconnect/cleanup if needed, then `POST /connect` again.
- Log stderr and technical detail server-side only; never dump raw tool output into the UI.

## Testing

- Unit-test status state machine transitions (idle → searching → found → connecting → connected / error) with mocked subprocesses.
- Unit-test “tools missing” and “no device found” map to the friendly error messages.
- Manual: phone already listed in `adb devices` (wireless pair or USB), connect from studio, confirm no scrcpy window, mirror fills frame, rotation updates layout, device audio audible when screen audio is on and present in the recording, Retry recovers from unplug/disconnect, Share screen and Connect Device replace each other cleanly.

## Open implementation notes

- Prefer `--no-playback` on modern scrcpy; fall back to the no-display flag name used by the installed Homebrew build if needed.
- If a browser cannot play the live fMP4 URL via `src` alone, use Media Source Extensions against the same HTTP stream without changing the overall architecture.
- Stopping the mirror tears down scrcpy/ffmpeg only; it does not `adb disconnect`.
