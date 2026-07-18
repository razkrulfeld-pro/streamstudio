# Connect Device Mirror — WebSocket H.264 Design

**Date:** 2026-07-18  
**Status:** Approved (implementation)  
**Replaces:** scrcpy GUI → MKV → ffmpeg → progressive fMP4

## Architecture

```
adb devices (existing pair)
        ▼
FastAPI device service
  ├── push scrcpy-server.jar
  ├── adb forward tcp:PORT → localabstract:scrcpy
  ├── adb shell app_process … Server raw_stream=true (no GUI client)
  └── TCP read Annex-B H.264 → WebSocket /api/device/ws (binary NALs)
        ▼
Browser: WebCodecs VideoDecoder → canvas → captureStream()
        ▼
existing compositor + MediaRecorder
```

## Non-goals

- ffmpeg remux, MKV shim, progressive fMP4 `/stream`
- Terminal.app / ScrcpyMirror.app / Metal window
- Touch injection / control socket
- Audio in v1 of this cut (video only; screen-audio path stays for OS share)

## Latency target

End-to-end phone → canvas frame **&lt; 2 seconds** (wall clock). No growing play-from-zero timeline.

## Terminal

Must open **zero** new Terminal windows. Server runs via `adb shell` subprocess only.

## API

| Endpoint | Role |
| --- | --- |
| `POST /api/device/connect` | Start server + forward |
| `GET /api/device/status` | State machine (unchanged) |
| `WS /api/device/ws` | Binary Annex-B NAL units (and JSON control frames) |
| `POST /api/device/disconnect` | Kill server, remove forward |
| `GET /api/device/latency` | Capture→WS tip lag diagnostics |

`GET /api/device/stream` (fMP4) is removed.
