from __future__ import annotations

import logging
import re
import shutil
import subprocess
import threading
import time
from typing import Iterator, Literal, TypedDict

logger = logging.getLogger(__name__)

DeviceState = Literal["idle", "searching", "found", "connecting", "connected", "error"]

# mDNS / Bonjour service discovery entries are not usable scrcpy serials.
ADB_MDNS_MARKER = "._adb-tls-connect._tcp"
# Prefer a plain IPv4 host:port serial from Wireless debugging.
CLEAN_HOST_PORT_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}:\d+$")

FRIENDLY_ERRORS = {
    "not_found": (
        "Couldn't find a connected phone. "
        "Pair it with Wireless debugging (or plug in USB), then try again."
    ),
    "tools_missing": (
        "Device tools aren't available on this Mac. "
        "Install adb, scrcpy, and ffmpeg (Homebrew), then retry."
    ),
    "connect_failed": (
        "Couldn't connect to your phone. "
        "Check that it's unlocked and authorized on this Mac, then retry."
    ),
    "connection_lost": "Connection lost. Retry to reconnect.",
}

STATUS_MESSAGES = {
    "searching": "Looking for your phone…",
    "found": "Phone found. Connecting…",
    "connecting": "Starting mirror…",
}


class DeviceStatus(TypedDict):
    state: DeviceState
    deviceAddress: str | None
    message: str | None
    error: str | None


def resolve_tools() -> dict[str, str] | None:
    paths: dict[str, str] = {}
    for name in ("adb", "scrcpy", "ffmpeg"):
        found = shutil.which(name)
        if not found:
            return None
        paths[name] = found
    return paths


def is_mdns_adb_serial(serial: str) -> bool:
    return ADB_MDNS_MARKER in serial


def is_clean_host_port_serial(serial: str) -> bool:
    return bool(CLEAN_HOST_PORT_RE.match(serial))


def list_ready_adb_devices(adb: str, timeout_s: float = 10.0) -> list[str]:
    """Return usable serials currently listed as `device` by `adb devices`."""
    try:
        result = subprocess.run(
            [adb, "devices"],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("adb devices failed: %s", exc)
        return []

    serials: list[str] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("List"):
            continue
        parts = line.split()
        if len(parts) < 2 or parts[1] != "device":
            continue
        serial = parts[0]
        if is_mdns_adb_serial(serial):
            continue
        serials.append(serial)
    return serials


def pick_adb_device(serials: list[str]) -> str | None:
    """Prefer a clean host:port serial; otherwise the first usable device."""
    usable = [s for s in serials if not is_mdns_adb_serial(s)]
    if not usable:
        return None
    for serial in usable:
        if is_clean_host_port_serial(serial):
            return serial
    for serial in usable:
        if ":" in serial and not serial.startswith("emulator-"):
            return serial
    return usable[0]


def build_scrcpy_cmd(scrcpy: str, serial: str, *, bit_rate_flag: str = "--video-bit-rate=8M") -> list[str]:
    return [
        scrcpy,
        "--serial",
        serial,
        "--no-playback",
        "--max-size=1080",
        bit_rate_flag,
        "--audio-codec=aac",
        "--record=-",
        "--record-format=mkv",
    ]


def build_ffmpeg_cmd(ffmpeg: str) -> list[str]:
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-c",
        "copy",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-f",
        "mp4",
        "pipe:1",
    ]


class DeviceMirrorSession:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: DeviceState = "idle"
        self._device_address: str | None = None
        self._message: str | None = None
        self._error: str | None = None
        self._tools: dict[str, str] | None = None
        self._scrcpy_proc: subprocess.Popen[bytes] | None = None
        self._ffmpeg_proc: subprocess.Popen[bytes] | None = None
        self._stopping = False
        self._connect_thread: threading.Thread | None = None
        self._watcher_thread: threading.Thread | None = None

    def get_status(self) -> DeviceStatus:
        with self._lock:
            return {
                "state": self._state,
                "deviceAddress": self._device_address,
                "message": self._message,
                "error": self._error,
            }

    def _set_state(
        self,
        state: DeviceState,
        *,
        device_address: str | None = None,
        message: str | None = None,
        clear_error: bool = True,
    ) -> None:
        with self._lock:
            self._state = state
            if device_address is not None:
                self._device_address = device_address
            self._message = message
            if clear_error:
                self._error = None

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
            self._tools = None

    def connect_async(self) -> None:
        with self._lock:
            if self._state in ("searching", "found", "connecting", "connected"):
                return
            if self._connect_thread and self._connect_thread.is_alive():
                return
            self._stopping = False
            thread = threading.Thread(target=self._connect_worker, name="device-mirror-connect", daemon=True)
            self._connect_thread = thread
        thread.start()

    def _connect_worker(self) -> None:
        try:
            self._set_state("searching", message=STATUS_MESSAGES["searching"])
            tools = resolve_tools()
            if tools is None:
                self.set_error("tools_missing")
                return

            serials = list_ready_adb_devices(tools["adb"])
            if self._stopping:
                return
            address = pick_adb_device(serials)
            if address is None:
                self.set_error("not_found")
                return

            self._set_state(
                "found",
                device_address=address,
                message=STATUS_MESSAGES["found"],
            )
            self._set_state(
                "connecting",
                device_address=address,
                message=STATUS_MESSAGES["connecting"],
            )

            with self._lock:
                self._tools = tools
                self._device_address = address

            self._start_pipeline()
        except Exception:
            logger.exception("Device connect failed unexpectedly")
            if not self._stopping:
                self.set_error("connect_failed")

    def _start_pipeline(self) -> None:
        tools = self._tools
        address = self._device_address
        if not tools or not address:
            self.set_error("connect_failed")
            return

        scrcpy_cmd = build_scrcpy_cmd(tools["scrcpy"], address)
        ffmpeg_cmd = build_ffmpeg_cmd(tools["ffmpeg"])

        try:
            scrcpy_proc = subprocess.Popen(
                scrcpy_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError:
            # Retry once with legacy bit-rate flag
            scrcpy_cmd = build_scrcpy_cmd(tools["scrcpy"], address, bit_rate_flag="--bit-rate=8M")
            try:
                scrcpy_proc = subprocess.Popen(
                    scrcpy_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
            except OSError as exc:
                logger.warning("Failed to start scrcpy: %s", exc)
                self.set_error("connect_failed")
                return

        if scrcpy_proc.stdout is None:
            scrcpy_proc.kill()
            self.set_error("connect_failed")
            return

        try:
            ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=scrcpy_proc.stdout,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as exc:
            logger.warning("Failed to start ffmpeg: %s", exc)
            scrcpy_proc.kill()
            self.set_error("connect_failed")
            return

        scrcpy_proc.stdout.close()

        # Brief settle — if scrcpy dies immediately, treat as connect failure
        time.sleep(0.4)
        if scrcpy_proc.poll() is not None:
            stderr = b""
            try:
                stderr = scrcpy_proc.stderr.read() if scrcpy_proc.stderr else b""
            except Exception:
                pass
            logger.warning("scrcpy exited early: %s", stderr.decode("utf-8", errors="replace")[:500])
            self._kill_procs(scrcpy_proc, ffmpeg_proc)
            # Retry with alternate bit-rate flag if we used the primary
            if "--video-bit-rate=8M" in scrcpy_cmd:
                alt = build_scrcpy_cmd(tools["scrcpy"], address, bit_rate_flag="--bit-rate=8M")
                try:
                    scrcpy_proc = subprocess.Popen(alt, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    if scrcpy_proc.stdout is None:
                        raise OSError("no stdout")
                    ffmpeg_proc = subprocess.Popen(
                        ffmpeg_cmd,
                        stdin=scrcpy_proc.stdout,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                    )
                    scrcpy_proc.stdout.close()
                    time.sleep(0.4)
                    if scrcpy_proc.poll() is not None:
                        self._kill_procs(scrcpy_proc, ffmpeg_proc)
                        self.set_error("connect_failed")
                        return
                except OSError:
                    self.set_error("connect_failed")
                    return
            else:
                self.set_error("connect_failed")
                return

        with self._lock:
            self._scrcpy_proc = scrcpy_proc
            self._ffmpeg_proc = ffmpeg_proc

        self._set_state("connected", device_address=address, message=None)
        watcher = threading.Thread(target=self._watch_procs, name="device-mirror-watch", daemon=True)
        self._watcher_thread = watcher
        watcher.start()

    def _watch_procs(self) -> None:
        while not self._stopping:
            scrcpy = self._scrcpy_proc
            ffmpeg = self._ffmpeg_proc
            if scrcpy is None or ffmpeg is None:
                return
            if scrcpy.poll() is not None or ffmpeg.poll() is not None:
                if not self._stopping:
                    logger.warning("Mirror pipeline process exited")
                    self._teardown_procs()
                    self.set_error("connection_lost")
                return
            time.sleep(0.5)

    def iter_stream(self) -> Iterator[bytes]:
        while True:
            with self._lock:
                if self._state != "connected" or self._stopping:
                    break
                proc = self._ffmpeg_proc
                stdout = proc.stdout if proc else None
            if stdout is None:
                break
            chunk = stdout.read(65536)
            if not chunk:
                break
            yield chunk

    def disconnect(self) -> None:
        self._stopping = True
        # Do not `adb disconnect` — we reuse whatever device was already paired.
        self._teardown_procs()
        self.reset_to_idle()
        self._stopping = False

    def _teardown_procs(self) -> None:
        with self._lock:
            scrcpy = self._scrcpy_proc
            ffmpeg = self._ffmpeg_proc
            self._scrcpy_proc = None
            self._ffmpeg_proc = None
        self._kill_procs(scrcpy, ffmpeg)

    @staticmethod
    def _kill_procs(
        scrcpy: subprocess.Popen[bytes] | None,
        ffmpeg: subprocess.Popen[bytes] | None,
    ) -> None:
        for proc in (ffmpeg, scrcpy):
            if proc is None:
                continue
            try:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
            except OSError:
                pass
