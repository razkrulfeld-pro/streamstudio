# Connect Device Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Connect Device source that scans the LAN for ADB TCP `:5555`, mirrors the phone via headless scrcpy into the existing studio screen layer (video + audio), with friendly connection status and errors.

**Architecture:** FastAPI owns discovery, `adb`/`scrcpy`/`ffmpeg` subprocesses, and a live fragmented-MP4 stream. The React studio treats device mirror as mutually exclusive with OS screen share, feeding the same hidden screen `<video>`, `captureStream()`, compositor, and screen-audio path.

**Tech Stack:** FastAPI, Python `subprocess`/`threading`/`socket`, Homebrew `adb`/`scrcpy`/`ffmpeg`, React 19, TypeScript, existing Vite frontend + `src/lib/api.ts`.

## Global Constraints

- Mutually exclusive with screen share; phone feed uses the existing screen layer and compositor path.
- scrcpy must be invisible (`--no-playback` / no-display); no separate window or scrcpy UI.
- scrcpy flags: `--max-size=1080`, video bit rate `8M`, audio enabled.
- Status UX: Searching → Found → Connecting → Connected (overlay dismisses) + Error with Retry.
- Friendly UI copy only — no ADB/scrcpy/ffmpeg/port jargon in the UI.
- Match existing studio UI patterns; no new design component families.
- Tools resolved from PATH (Homebrew). Single active device session.
- LAN scan must time-bound and move to Error if nothing found.

---

## File Structure

- Create `backend/app/device_mirror.py`: session state machine, LAN scan, adb connect, scrcpy+ffmpeg pipeline, stream reader, teardown.
- Create `backend/app/routers/device.py`: `/api/device` connect/status/stream/disconnect endpoints.
- Create `backend/app/models.py` additions (or inline response models in router): `DeviceStatusResponse`.
- Create `backend/tests/test_device_mirror.py`: unit tests with mocked subprocess/socket.
- Modify `backend/app/main.py`: include device router.
- Modify `src/lib/api.ts`: device connect/status/disconnect helpers + stream URL builder.
- Modify `src/hooks/use-recording-session.ts`: device connect/disconnect, status polling, stream attach via `captureStream()`, mutual exclusion with screen share.
- Modify `src/pages/recording-session-page.tsx`: empty-state dual CTAs, status/error overlay.

---

### Task 1: Device session state machine + friendly errors

**Files:**
- Create: `backend/app/device_mirror.py`
- Create: `backend/tests/test_device_mirror.py`

**Interfaces:**
- Produces:
  - `DeviceState = Literal["idle","searching","found","connecting","connected","error"]`
  - `class DeviceStatus(TypedDict)` / dataclass with `state`, `deviceAddress: str | None`, `message: str | None`, `error: str | None`
  - `FRIENDLY_ERRORS: dict[str, str]` keys: `not_found`, `tools_missing`, `connect_failed`, `connection_lost`
  - `class DeviceMirrorSession` with `get_status() -> DeviceStatus`, `_set_state(...)`, `reset_to_idle()`
- Consumes: none yet (pipeline wired in later tasks)

- [ ] **Step 1: Write failing tests for status transitions and friendly messages**

Create `backend/tests/test_device_mirror.py`:

```python
from app.device_mirror import FRIENDLY_ERRORS, DeviceMirrorSession


def test_initial_status_is_idle():
    session = DeviceMirrorSession()
    status = session.get_status()
    assert status["state"] == "idle"
    assert status["deviceAddress"] is None
    assert status["error"] is None


def test_set_error_uses_friendly_not_found_message():
    session = DeviceMirrorSession()
    session.set_error("not_found")
    status = session.get_status()
    assert status["state"] == "error"
    assert status["error"] == FRIENDLY_ERRORS["not_found"]
    assert "5555" not in (status["error"] or "")
    assert "ADB" not in (status["error"] or "").upper()


def test_set_error_tools_missing():
    session = DeviceMirrorSession()
    session.set_error("tools_missing")
    assert session.get_status()["error"] == FRIENDLY_ERRORS["tools_missing"]


def test_reset_to_idle_clears_error():
    session = DeviceMirrorSession()
    session.set_error("connection_lost")
    session.reset_to_idle()
    status = session.get_status()
    assert status["state"] == "idle"
    assert status["error"] is None
```

- [ ] **Step 2: Run tests — expect fail (module missing)**

Run: `cd backend && python -m pytest tests/test_device_mirror.py -v`  
Expected: FAIL import error

- [ ] **Step 3: Implement minimal session + friendly errors**

Create `backend/app/device_mirror.py` with:

```python
from __future__ import annotations

import threading
from typing import Literal, TypedDict

DeviceState = Literal["idle", "searching", "found", "connecting", "connected", "error"]

FRIENDLY_ERRORS = {
    "not_found": (
        "Couldn't find a phone on your network. "
        "Make sure Wireless debugging is on and try again."
    ),
    "tools_missing": (
        "Device tools aren't available on this Mac. "
        "Install adb, scrcpy, and ffmpeg (Homebrew), then retry."
    ),
    "connect_failed": (
        "Couldn't connect to your phone. "
        "Check that it's unlocked and on the same Wi‑Fi, then retry."
    ),
    "connection_lost": "Connection lost. Retry to reconnect.",
}


class DeviceStatus(TypedDict):
    state: DeviceState
    deviceAddress: str | None
    message: str | None
    error: str | None


class DeviceMirrorSession:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: DeviceState = "idle"
        self._device_address: str | None = None
        self._message: str | None = None
        self._error: str | None = None

    def get_status(self) -> DeviceStatus:
        with self._lock:
            return {
                "state": self._state,
                "deviceAddress": self._device_address,
                "message": self._message,
                "error": self._error,
            }

    def set_error(self, code: str) -> None:
        with self._lock:
            self._state = "error"
            self._message = None
            self._error = FRIENDLY_ERRORS.get(code, FRIENDLY_ERRORS["connect_failed"])

    def reset_to_idle(self) -> None:
        with self._lock:
            self._state = "idle"
            self._device_address = None
            self._message = None
            self._error = None
```

Also define status message helpers used later:

```python
STATUS_MESSAGES = {
    "searching": "Looking for your phone on the local network…",
    "found": "Phone found. Connecting…",
    "connecting": "Starting mirror…",
}
```

Add `_set_state(self, state, *, device_address=None, message=None)` that updates fields under the lock (clear `error` when leaving `error`).

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && python -m pytest tests/test_device_mirror.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/device_mirror.py backend/tests/test_device_mirror.py
git commit -m "Add device mirror session state and friendly errors"
```

---

### Task 2: Tool resolution + LAN scan + adb connect

**Files:**
- Modify: `backend/app/device_mirror.py`
- Modify: `backend/tests/test_device_mirror.py`

**Interfaces:**
- Produces:
  - `resolve_tools() -> dict[str, str] | None` (keys `adb`, `scrcpy`, `ffmpeg`; `None` if any missing)
  - `scan_for_adb_device(timeout_s: float = 5.0) -> str | None` returns `"ip:5555"` or `None`
  - `adb_connect(adb: str, address: str, timeout_s: float = 10.0) -> bool`
  - `DeviceMirrorSession.connect_async()` starts background thread: searching → found → connecting (adb) → leaves ready for pipeline task; on failure `set_error`
  - `DeviceMirrorSession.disconnect()` teardown + `reset_to_idle` (pipeline kill added in Task 3)
- Consumes: Task 1 session API

- [ ] **Step 1: Write failing tests with mocks**

Append to `backend/tests/test_device_mirror.py`:

```python
from unittest.mock import patch

from app.device_mirror import resolve_tools, scan_for_adb_device


def test_resolve_tools_returns_none_when_adb_missing():
    with patch("app.device_mirror.shutil.which", side_effect=lambda name: None if name == "adb" else f"/usr/local/bin/{name}"):
        assert resolve_tools() is None


def test_resolve_tools_returns_paths_when_all_present():
    with patch("app.device_mirror.shutil.which", side_effect=lambda name: f"/opt/homebrew/bin/{name}"):
        tools = resolve_tools()
        assert tools == {
            "adb": "/opt/homebrew/bin/adb",
            "scrcpy": "/opt/homebrew/bin/scrcpy",
            "ffmpeg": "/opt/homebrew/bin/ffmpeg",
        }


def test_scan_returns_first_open_port(monkeypatch):
    # Mock local subnet as 192.168.1.0/24 and only .50 open
    monkeypatch.setattr("app.device_mirror._local_ipv4", lambda: "192.168.1.10")
    def fake_probe(ip, port, timeout):
        return ip == "192.168.1.50" and port == 5555
    monkeypatch.setattr("app.device_mirror._probe_tcp", fake_probe)
    assert scan_for_adb_device(timeout_s=2.0) == "192.168.1.50:5555"


def test_scan_returns_none_when_nothing_open(monkeypatch):
    monkeypatch.setattr("app.device_mirror._local_ipv4", lambda: "192.168.1.10")
    monkeypatch.setattr("app.device_mirror._probe_tcp", lambda *a, **k: False)
    assert scan_for_adb_device(timeout_s=1.0) is None
```

- [ ] **Step 2: Run tests — expect fail**

Run: `cd backend && python -m pytest tests/test_device_mirror.py -v`  
Expected: FAIL missing symbols

- [ ] **Step 3: Implement resolve_tools, scan, adb_connect, connect_async**

In `device_mirror.py`:

- `resolve_tools()` via `shutil.which` for `adb`, `scrcpy`, `ffmpeg`.
- `_local_ipv4()`: UDP connect to `8.8.8.8:80` trick to get primary interface IP; ignore loopback.
- `_probe_tcp(ip, port, timeout)`: non-blocking/`socket.create_connection` with short timeout.
- `scan_for_adb_device`: concurrent thread pool (e.g. 64 workers) over `/24` hosts excluding self; overall deadline `timeout_s`; return first hit as `f"{ip}:5555"`.
- `adb_connect`: `subprocess.run([adb, "connect", address], capture_output=True, text=True, timeout=timeout_s)` and verify `adb devices` lists the address as `device`.
- `connect_async`: if state in searching/found/connecting/connected → no-op; else spawn daemon thread:
  1. `_set_state("searching", message=STATUS_MESSAGES["searching"])`
  2. tools = resolve_tools(); if None → set_error("tools_missing"); return
  3. address = scan…; if None → set_error("not_found"); return
  4. `_set_state("found", device_address=address, message=STATUS_MESSAGES["found"])`
  5. `_set_state("connecting", message=STATUS_MESSAGES["connecting"])`
  6. if not adb_connect → set_error("connect_failed"); return
  7. Store tools + address on session; set state `connecting` still (pipeline starts in Task 3) — for now set a flag `_adb_ready=True` and leave state `connecting` so Task 3 can continue, OR call a hook `_start_pipeline()` stub that Task 3 fills. Prefer: end Task 2 by setting state to `connecting` with `_adb_ready` and document that Task 3’s `_start_pipeline` is invoked at end of the thread.

Minimal stub for Task 2 completion without hanging the UI forever:

```python
# End of connect thread after successful adb_connect:
self._tools = tools
self._device_address = address
self._start_pipeline()  # defined in Task 3; for Task 2 make it set connected with a no-op stream placeholder OR set_error if not implemented

```

For Task 2 only, implement `_start_pipeline` as:

```python
def _start_pipeline(self) -> None:
    # Placeholder until Task 3 — mark connected so status flow is testable
    self._set_state("connected", device_address=self._device_address, message=None)
```

Task 3 replaces this with the real pipeline.

Also implement `disconnect()`: `adb disconnect` if address known, `reset_to_idle()`, clear `_tools`.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && python -m pytest tests/test_device_mirror.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/device_mirror.py backend/tests/test_device_mirror.py
git commit -m "Add device LAN scan and adb connect flow"
```

---

### Task 3: scrcpy + ffmpeg pipeline and stream reader

**Files:**
- Modify: `backend/app/device_mirror.py`
- Modify: `backend/tests/test_device_mirror.py`

**Interfaces:**
- Produces:
  - `DeviceMirrorSession._start_pipeline()` real implementation
  - `DeviceMirrorSession.iter_stream()` → iterator/generator of `bytes` chunks while connected
  - Process handles: `_scrcpy_proc`, `_ffmpeg_proc`
  - On process death → `set_error("connection_lost")` + teardown
- Consumes: tools paths, device address from Task 2

- [ ] **Step 1: Write failing test for pipeline argv construction**

```python
from app.device_mirror import build_scrcpy_cmd, build_ffmpeg_cmd


def test_scrcpy_cmd_is_headless_1080_8m():
    cmd = build_scrcpy_cmd("/opt/homebrew/bin/scrcpy", "192.168.1.50:5555")
    assert cmd[0].endswith("scrcpy")
    assert "--no-playback" in cmd
    assert "--max-size=1080" in cmd or ("--max-size" in cmd and "1080" in cmd)
    bit = [a for a in cmd if "8M" in a or a == "8M"]
    assert bit, cmd
    assert "--window" not in " ".join(cmd)


def test_ffmpeg_cmd_outputs_fragmented_mp4():
    cmd = build_ffmpeg_cmd("/opt/homebrew/bin/ffmpeg")
    joined = " ".join(cmd)
    assert "frag_keyframe" in joined
    assert "empty_moov" in joined
    assert cmd[-2:] == ["-f", "mp4"] or "-f" in cmd
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement pipeline**

```python
def build_scrcpy_cmd(scrcpy: str, serial: str) -> list[str]:
    return [
        scrcpy,
        "--serial", serial,
        "--no-playback",
        "--max-size=1080",
        "--video-bit-rate=8M",
        "--audio-codec=aac",
        "--record=-",
        "--record-format=mkv",
    ]


def build_ffmpeg_cmd(ffmpeg: str) -> list[str]:
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-c", "copy",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "pipe:1",
    ]
```

`_start_pipeline`:
1. `Popen` scrcpy with `stdout=PIPE`, `stderr=PIPE`.
2. `Popen` ffmpeg with `stdin=scrcpy.stdout`, `stdout=PIPE`, `stderr=PIPE`.
3. Close scrcpy.stdout in parent after handoff.
4. Store procs; `_set_state("connected")`.
5. Start a watcher thread: if either proc exits → teardown + `set_error("connection_lost")` if not intentional disconnect.

`iter_stream`: while connected and ffmpeg stdout open, `yield ffmpeg.stdout.read(65536)` (or larger); stop on empty/EOF.

`disconnect`: set `_stopping=True`, terminate/kill both procs, `adb disconnect`, `reset_to_idle()`.

If scrcpy rejects `--video-bit-rate`, try `--bit-rate=8M` as fallback in a small helper that probes `--help` once — keep YAGNI: try primary flags first; on immediate failure retry once with `--bit-rate=8M`.

- [ ] **Step 4: Run unit tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add backend/app/device_mirror.py backend/tests/test_device_mirror.py
git commit -m "Add headless scrcpy ffmpeg mirror pipeline"
```

---

### Task 4: FastAPI `/api/device` router

**Files:**
- Create: `backend/app/routers/device.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_device_router.py` (optional light TestClient tests)

**Interfaces:**
- Produces HTTP:
  - `POST /api/device/connect` → `{ ok: true }` + starts `connect_async`
  - `GET /api/device/status` → DeviceStatus JSON
  - `GET /api/device/stream` → `StreamingResponse` `video/mp4` or 409 if not connected
  - `POST /api/device/disconnect` → `{ ok: true }`
- Module-level singleton `device_session = DeviceMirrorSession()`

- [ ] **Step 1: Implement router**

```python
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.device_mirror import DeviceMirrorSession

router = APIRouter(prefix="/api/device", tags=["device"])
session = DeviceMirrorSession()

@router.post("/connect")
def connect() -> dict[str, bool]:
    session.connect_async()
    return {"ok": True}

@router.get("/status")
def status() -> dict:
    return session.get_status()

@router.post("/disconnect")
def disconnect() -> dict[str, bool]:
    session.disconnect()
    return {"ok": True}

@router.get("/stream")
def stream():
    st = session.get_status()
    if st["state"] != "connected":
        raise HTTPException(status_code=409, detail={"error": "Device is not connected.", "code": "not_connected"})
    return StreamingResponse(session.iter_stream(), media_type="video/mp4")
```

Wire in `main.py`: `app.include_router(device_router.router)` and ensure CORS already allows localhost Vite.

- [ ] **Step 2: Manual smoke with TestClient**

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_status_idle():
    r = client.get("/api/device/status")
    assert r.status_code == 200
    assert r.json()["state"] == "idle"


def test_stream_not_connected():
    r = client.get("/api/device/stream")
    assert r.status_code == 409
```

Install `httpx` already present; Starlette TestClient works.

- [ ] **Step 3: Run tests**

Run: `cd backend && python -m pytest tests/test_device_mirror.py tests/test_device_router.py -v`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/device.py backend/app/main.py backend/tests/test_device_router.py
git commit -m "Expose device mirror connect status and stream API"
```

---

### Task 5: Frontend API client + recording session device source

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/use-recording-session.ts`

**Interfaces:**
- Produces in `api.ts`:
  - `connectDevice(): Promise<void>`
  - `getDeviceStatus(): Promise<DeviceStatus>`
  - `disconnectDevice(): Promise<void>`
  - `deviceStreamUrl(): string` → `${apiBaseUrl()}/api/device/stream`
- Produces from hook:
  - `deviceConnectionState: DeviceState | 'idle'`
  - `deviceError: string | null`
  - `startDeviceMirror(): Promise<void>`
  - `stopDeviceMirror(): Promise<void>`
  - `retryDeviceMirror(): Promise<void>`
  - `screenSource: 'none' | 'display' | 'device'`
  - Existing `screenShareEnabled` true when either display or device is active

- [ ] **Step 1: Add API helpers**

```ts
export type DeviceMirrorState =
  | 'idle'
  | 'searching'
  | 'found'
  | 'connecting'
  | 'connected'
  | 'error'

export interface DeviceStatus {
  state: DeviceMirrorState
  deviceAddress: string | null
  message: string | null
  error: string | null
}

export function connectDevice(): Promise<{ ok: boolean }> {
  return request('/api/device/connect', { method: 'POST' })
}

export function getDeviceStatus(): Promise<DeviceStatus> {
  return request('/api/device/status')
}

export function disconnectDevice(): Promise<{ ok: boolean }> {
  return request('/api/device/disconnect', { method: 'POST' })
}

export function deviceStreamUrl(): string {
  return `${apiBaseUrl()}/api/device/stream`
}
```

- [ ] **Step 2: Wire hook**

In `use-recording-session.ts`:

- Track `deviceState` / `deviceError` / `screenSourceRef`.
- `stopDeviceMirror`: clear poll timer; `disconnectDevice()`; clear `screenVideo.src` (use `removeAttribute('src')` + `load()`), stop tracks from prior `captureStream` if tracked separately without stopping forever-shared logic carefully — do **not** call `stopMediaStream` on captureStream tracks in a way that breaks reconnect; prefer stopping only when leaving. Pattern:

```ts
const attachDeviceStream = async () => {
  const video = screenVideoRef.current
  if (!video) return
  video.srcObject = null
  video.src = deviceStreamUrl()
  await video.play()
  const captured = video.captureStream()
  screenStreamRef.current = captured
  const hasAudio = captured.getAudioTracks().length > 0
  setScreenAudioAvailable(hasAudio)
  captured.getAudioTracks().forEach((t) => {
    t.enabled = screenAudioEnabledRef.current
  })
  setScreenAudioCaptureEnabled(screenAudioEnabledRef.current)
  setScreenShareEnabled(true)
}
```

- `startDeviceMirror`: if display share active → `stopScreenShare()` first; `connectDevice()`; poll `getDeviceStatus` every 500ms; update `deviceState`/`deviceError`/`message`; on `connected` call `attachDeviceStream`; on `error` stop polling.
- `startScreenShare`: if device active → `await stopDeviceMirror()` first; then existing getDisplayMedia.
- `stopScreenShare`: if source is device, call `stopDeviceMirror`; else existing stop.
- Cleanup on discard/unmount: stop device mirror.
- Expose new fields on return object.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --pretty false` from repo root (or project’s usual check)  
Expected: no errors in touched files

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/hooks/use-recording-session.ts
git commit -m "Wire device mirror into recording session screen layer"
```

---

### Task 6: Studio UI — dual CTA, status overlay, retry

**Files:**
- Modify: `src/pages/recording-session-page.tsx`

**Interfaces:**
- Consumes hook fields from Task 5
- Produces UI only

- [ ] **Step 1: Update empty state**

When `!screenShareEnabled` and not connecting-camera and camera not fullscreen, show dual CTAs:

```tsx
<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
  <button type="button" ... onClick={() => void recording.toggleScreenShare()}>
    Share screen
  </button>
  <button type="button" ... onClick={() => void recording.startDeviceMirror()}>
    Connect Device
  </button>
</div>
<p className="mt-3 text-[11px] text-white/45">
  Or use the share control in the bar below
</p>
```

Use the same classes as the existing Share screen pill button for both.

Update headline/body slightly to cover either source, e.g. title “Add your screen or phone”, body mentioning slides/desktop or a mirrored phone.

- [ ] **Step 2: Status / error overlay**

When `deviceState` is `searching` | `found` | `connecting`, show overlay like camera connecting:

```tsx
{['searching','found','connecting'].includes(recording.deviceState) ? (
  <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 text-sm text-white">
    {recording.deviceMessage ?? 'Connecting…'}
  </div>
) : null}

{recording.deviceState === 'error' ? (
  <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 p-6">
    <div className="flex max-w-sm flex-col items-center text-center">
      <p className="text-sm text-white/90">{recording.deviceError}</p>
      <button type="button" className="mt-6 ... same pill ..." onClick={() => void recording.retryDeviceMirror()}>
        Retry
      </button>
    </div>
  </div>
) : null}
```

Hide the empty-state dual CTA while device is searching/found/connecting/error (error shows retry overlay instead).

- [ ] **Step 3: Visual/manual check**

Run frontend + backend; without a phone, Connect Device should end in friendly not-found + Retry. With tools missing, tools_missing copy.

- [ ] **Step 4: Commit**

```bash
git add src/pages/recording-session-page.tsx
git commit -m "Add Connect Device CTA and connection status overlay"
```

---

### Task 7: Spec self-check polish

**Files:**
- Touch any gaps found (orientation is automatic; mutual exclusion; disconnect on exit)

- [ ] **Step 1: Verify checklist against spec**

| Spec item | Task |
| --- | --- |
| LAN scan :5555 | Task 2 |
| Status Searching→Found→Connecting→Connected | Tasks 1–3, 6 |
| Headless scrcpy 1080 / 8M | Task 3 |
| fMP4 stream + video element + captureStream | Tasks 3–5 |
| Device audio via screen-audio path | Task 5 |
| Mutual exclusion | Task 5 |
| Friendly errors + Retry | Tasks 1, 6 |
| Side panel still applies to phone frame | unchanged layout path |

- [ ] **Step 2: Fix any gaps** (e.g. ensure `discardSession` / exit calls `stopDeviceMirror`)

- [ ] **Step 3: Run full backend tests + frontend tsc**

```bash
cd backend && python -m pytest tests/test_device_mirror.py tests/test_device_router.py -v
cd .. && npx tsc -b --pretty false
```

- [ ] **Step 4: Final commit if needed**

```bash
git commit -m "Polish device mirror edge cases for exit and exclusivity"
```

---

## Spec coverage (plan self-review)

- Goal / architecture / decisions → Tasks 1–6  
- UI empty state, overlay, retry → Task 6  
- API endpoints → Task 4  
- Process pipeline + PATH tools → Tasks 2–3  
- Error messages → Task 1 + 6  
- Testing → unit tests in 1–4; manual in 6–7  
- Open notes (MSE fallback, flag aliases) → Task 3 fallback + note in code comments if `src` playback fails  

No TBD placeholders remain in task steps.
