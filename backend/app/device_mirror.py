from __future__ import annotations

import logging
import os
import queue
import re
import shutil
import subprocess
import tempfile
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


def resolve_scrcpy_headless_flags(scrcpy: str) -> list[str]:
    """Pick flags that hide the mirror UI without disabling Metal capture.

    On macOS, scrcpy 4.x needs a real window so the Metal renderer can
    initialize. ``--no-window`` fails silently (no video). Prefer an
    off-screen borderless window plus ``--no-playback`` instead.
    """
    help_text = _scrcpy_help_text(scrcpy)

    can_park_offscreen = (
        "--window-x" in help_text
        and "--window-y" in help_text
        and "--window-borderless" in help_text
    )
    if can_park_offscreen:
        flags: list[str] = []
        if "--no-playback" in help_text:
            flags.append("--no-playback")
        flags.extend(
            [
                "--window-borderless",
                "--window-x=-10000",
                "--window-y=-10000",
            ]
        )
        return flags

    flags = []
    if "--no-window" in help_text:
        flags.append("--no-window")
    if "--no-playback" in help_text:
        flags.append("--no-playback")
    elif "--no-display" in help_text:
        flags.append("--no-display")

    if not flags:
        flags = [
            "--no-playback",
            "--window-borderless",
            "--window-x=-10000",
            "--window-y=-10000",
        ]
    return flags


def resolve_scrcpy_video_source_flags(scrcpy: str) -> list[str]:
    """Explicitly enable display capture when the installed scrcpy supports it."""
    help_text = _scrcpy_help_text(scrcpy)
    if "--video-source" in help_text:
        return ["--video-source=display"]
    return []


def _scrcpy_help_text(scrcpy: str) -> str:
    try:
        result = subprocess.run(
            [scrcpy, "--help"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return f"{result.stdout}\n{result.stderr}"
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Could not probe scrcpy --help: %s", exc)
        return ""


def create_record_fifo() -> tuple[str, str]:
    """Create a temp dir + named pipe for scrcpy ``--record=``.

    On macOS, ``--record=/dev/stdout`` does not reliably follow a Python
    ``Popen(stdout=PIPE)`` redirect (and can mix server log lines into the
    bitstream). A FIFO keeps Matroska bytes clean for ffmpeg.
    """
    temp_dir = tempfile.mkdtemp(prefix="device-mirror-")
    fifo_path = os.path.join(temp_dir, "record.mkv")
    os.mkfifo(fifo_path)
    return fifo_path, temp_dir


def build_scrcpy_cmd(
    scrcpy: str,
    serial: str,
    *,
    bit_rate_flag: str = "--video-bit-rate=8M",
    headless_flags: list[str] | None = None,
    video_source_flags: list[str] | None = None,
    record_path: str,
) -> list[str]:
    """Build scrcpy argv that records Matroska into ``record_path`` (FIFO).

    Never use ``--record=-``: scrcpy 4.x treats that as a file named ``-``.
    Prefer a named pipe over ``/dev/stdout`` on macOS.
    """
    headless = headless_flags if headless_flags is not None else resolve_scrcpy_headless_flags(scrcpy)
    video_source = (
        video_source_flags
        if video_source_flags is not None
        else resolve_scrcpy_video_source_flags(scrcpy)
    )
    return [
        scrcpy,
        "--serial",
        serial,
        *headless,
        *video_source,
        "--max-size=1080",
        bit_rate_flag,
        "--audio-codec=aac",
        f"--record={record_path}",
        "--record-format=mkv",
    ]


def build_ffmpeg_cmd(ffmpeg: str, input_path: str) -> list[str]:
    """Remux live Matroska from a FIFO into fragmented MP4 on stdout.

    ``frag_every_frame`` + ``max_interleave_delta=0`` are required so ffmpeg
    flushes media fragments while the input is still open (plain
    ``frag_keyframe`` alone buffers until EOF with scrcpy's long GOPs).
    """
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "matroska",
        "-i",
        input_path,
        "-c",
        "copy",
        "-f",
        "mp4",
        "-movflags",
        "frag_every_frame+empty_moov+default_base_moof+skip_trailer",
        "-max_interleave_delta",
        "0",
        "-muxdelay",
        "0",
        "-muxpreload",
        "0",
        "pipe:1",
    ]


def extract_fmp4_init_segment(buffer: bytes) -> tuple[bytes | None, bytes]:
    """Split a fMP4 buffer into ``(ftyp+moov, remainder)`` when init is complete.

    Returns ``(None, buffer)`` until both ``ftyp`` and ``moov`` boxes are fully
    present. Used so late HTTP subscribers can replay the init segment.
    """
    offset = 0
    has_ftyp = False
    moov_end: int | None = None
    length = len(buffer)

    while offset + 8 <= length:
        size = int.from_bytes(buffer[offset : offset + 4], "big")
        typ = buffer[offset + 4 : offset + 8]
        if size == 0:
            break
        if size == 1:
            if offset + 16 > length:
                return None, buffer
            size = int.from_bytes(buffer[offset + 8 : offset + 16], "big")
        if size < 8:
            break
        if offset + size > length:
            return None, buffer
        if typ == b"ftyp":
            has_ftyp = True
        elif typ == b"moov":
            moov_end = offset + size
            break
        offset += size

    if not has_ftyp or moov_end is None:
        return None, buffer
    return buffer[:moov_end], buffer[moov_end:]


class Fmp4Broadcast:
    """Fan-out live fMP4 so every subscriber receives the init segment first.

    ffmpeg stdout is a single consumer pipe. Browsers (and Vite/devtools) often
    open ``/api/device/stream`` more than once; without replaying ``ftyp+moov``,
    the second connection gets mid-stream ``moof`` bytes and cannot decode.
    """

    _QUEUE_SIZE = 64

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buffer = b""
        self._init: bytes | None = None
        self._subscribers: list[queue.Queue[bytes | None]] = []
        self._closed = False

    @property
    def init_segment(self) -> bytes | None:
        with self._lock:
            return self._init

    def feed(self, data: bytes) -> None:
        if not data:
            return
        with self._lock:
            if self._closed:
                return
            if self._init is None:
                self._buffer += data
                init, rest = extract_fmp4_init_segment(self._buffer)
                if init is None:
                    return
                self._init = init
                self._buffer = b""
                data = rest
                if not data:
                    return
            dead: list[queue.Queue[bytes | None]] = []
            for q in self._subscribers:
                try:
                    q.put_nowait(data)
                except queue.Full:
                    dead.append(q)
            if dead:
                self._subscribers = [q for q in self._subscribers if q not in dead]

    def close(self) -> None:
        with self._lock:
            self._closed = True
            subs = list(self._subscribers)
            self._subscribers.clear()
        for q in subs:
            try:
                q.put_nowait(None)
            except queue.Full:
                pass

    def subscribe(self) -> Iterator[bytes]:
        q: queue.Queue[bytes | None] = queue.Queue(maxsize=self._QUEUE_SIZE)
        with self._lock:
            if self._closed:
                return
            init = self._init
            self._subscribers.append(q)

        try:
            if init:
                yield init
            while True:
                item = q.get()
                if item is None:
                    return
                yield item
        finally:
            with self._lock:
                if q in self._subscribers:
                    self._subscribers.remove(q)


def _spawn_stderr_logger(proc: subprocess.Popen[bytes], label: str) -> threading.Thread:
    """Continuously drain subprocess stderr into the uvicorn log."""

    def _run() -> None:
        stream = proc.stderr
        if stream is None:
            return
        try:
            for raw in iter(stream.readline, b""):
                line = raw.decode("utf-8", errors="replace").rstrip()
                if line:
                    logger.info("%s: %s", label, line)
        except Exception:
            logger.exception("Failed reading %s stderr", label)

    thread = threading.Thread(target=_run, name=f"{label}-stderr", daemon=True)
    thread.start()
    return thread


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
        self._broadcast: Fmp4Broadcast | None = None
        self._pump_thread: threading.Thread | None = None
        self._fifo_path: str | None = None
        self._fifo_dir: str | None = None
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

        try:
            fifo_path, fifo_dir = create_record_fifo()
        except OSError as exc:
            logger.warning("Failed to create record FIFO: %s", exc)
            self.set_error("connect_failed")
            return

        scrcpy_cmd = build_scrcpy_cmd(tools["scrcpy"], address, record_path=fifo_path)
        ffmpeg_cmd = build_ffmpeg_cmd(tools["ffmpeg"], fifo_path)
        logger.info(
            "Starting mirror pipeline via FIFO %s: %s | %s",
            fifo_path,
            " ".join(scrcpy_cmd),
            " ".join(ffmpeg_cmd),
        )

        # FIFO handshake: start ffmpeg first so it blocks in open(O_RDONLY) on the
        # named pipe; only then start scrcpy, which opens O_WRONLY and unblocks both.
        try:
            ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as exc:
            logger.warning("Failed to start ffmpeg: %s", exc)
            self._cleanup_fifo(fifo_path, fifo_dir)
            self.set_error("connect_failed")
            return

        _spawn_stderr_logger(ffmpeg_proc, "ffmpeg")

        if not self._wait_for_ffmpeg_reader(ffmpeg_proc, timeout_s=3.0):
            logger.warning("ffmpeg exited before opening the record FIFO")
            self._kill_procs(None, ffmpeg_proc)
            self._cleanup_fifo(fifo_path, fifo_dir)
            self.set_error("connect_failed")
            return

        logger.info("ffmpeg is waiting on FIFO; starting scrcpy writer")

        try:
            scrcpy_proc = subprocess.Popen(
                scrcpy_cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except OSError:
            scrcpy_cmd = build_scrcpy_cmd(
                tools["scrcpy"],
                address,
                bit_rate_flag="--bit-rate=8M",
                record_path=fifo_path,
            )
            try:
                scrcpy_proc = subprocess.Popen(
                    scrcpy_cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
            except OSError as exc:
                logger.warning("Failed to start scrcpy: %s", exc)
                self._kill_procs(None, ffmpeg_proc)
                self._cleanup_fifo(fifo_path, fifo_dir)
                self.set_error("connect_failed")
                return

        _spawn_stderr_logger(scrcpy_proc, "scrcpy")

        time.sleep(0.75)
        if scrcpy_proc.poll() is not None:
            logger.warning("scrcpy exited early (rc=%s); see scrcpy stderr logs above", scrcpy_proc.returncode)
            self._kill_procs(scrcpy_proc, ffmpeg_proc)
            self._cleanup_fifo(fifo_path, fifo_dir)
            self.set_error("connect_failed")
            return

        if ffmpeg_proc.poll() is not None:
            logger.warning("ffmpeg exited early (rc=%s); see ffmpeg stderr logs above", ffmpeg_proc.returncode)
            self._kill_procs(scrcpy_proc, ffmpeg_proc)
            self._cleanup_fifo(fifo_path, fifo_dir)
            self.set_error("connect_failed")
            return

        broadcast = Fmp4Broadcast()
        pump = threading.Thread(
            target=self._pump_ffmpeg_stdout,
            args=(ffmpeg_proc, broadcast),
            name="device-mirror-pump",
            daemon=True,
        )
        pump.start()

        if not self._wait_for_init_segment(broadcast, timeout_s=8.0):
            logger.warning("Timed out waiting for fMP4 init segment from ffmpeg")
            broadcast.close()
            self._kill_procs(scrcpy_proc, ffmpeg_proc)
            self._cleanup_fifo(fifo_path, fifo_dir)
            self.set_error("connect_failed")
            return

        with self._lock:
            self._scrcpy_proc = scrcpy_proc
            self._ffmpeg_proc = ffmpeg_proc
            self._broadcast = broadcast
            self._pump_thread = pump
            self._fifo_path = fifo_path
            self._fifo_dir = fifo_dir

        self._set_state("connected", device_address=address, message=None)
        watcher = threading.Thread(target=self._watch_procs, name="device-mirror-watch", daemon=True)
        self._watcher_thread = watcher
        watcher.start()

    @staticmethod
    def _wait_for_ffmpeg_reader(ffmpeg_proc: subprocess.Popen[bytes], timeout_s: float) -> bool:
        """Ensure ffmpeg stayed alive long enough to reach blocking FIFO open."""
        deadline = time.monotonic() + timeout_s
        settled_at = time.monotonic() + 0.15
        while time.monotonic() < deadline:
            if ffmpeg_proc.poll() is not None:
                return False
            if time.monotonic() >= settled_at:
                return True
            time.sleep(0.05)
        return ffmpeg_proc.poll() is None

    @staticmethod
    def _wait_for_init_segment(broadcast: Fmp4Broadcast, timeout_s: float) -> bool:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if broadcast.init_segment:
                return True
            time.sleep(0.05)
        return broadcast.init_segment is not None

    @staticmethod
    def _pump_ffmpeg_stdout(
        ffmpeg_proc: subprocess.Popen[bytes],
        broadcast: Fmp4Broadcast,
    ) -> None:
        stdout = ffmpeg_proc.stdout
        if stdout is None:
            broadcast.close()
            return
        try:
            while True:
                chunk = stdout.read(65536)
                if not chunk:
                    break
                broadcast.feed(chunk)
        except Exception:
            logger.exception("Failed pumping ffmpeg stdout into fMP4 broadcast")
        finally:
            broadcast.close()

    def _watch_procs(self) -> None:
        while not self._stopping:
            scrcpy = self._scrcpy_proc
            ffmpeg = self._ffmpeg_proc
            if scrcpy is None or ffmpeg is None:
                return
            if scrcpy.poll() is not None or ffmpeg.poll() is not None:
                if not self._stopping:
                    logger.warning(
                        "Mirror pipeline process exited (scrcpy rc=%s ffmpeg rc=%s)",
                        scrcpy.poll(),
                        ffmpeg.poll(),
                    )
                    self._teardown_procs()
                    self.set_error("connection_lost")
                return
            time.sleep(0.5)

    def iter_stream(self) -> Iterator[bytes]:
        with self._lock:
            if self._state != "connected" or self._stopping:
                return
            broadcast = self._broadcast
        if broadcast is None:
            return
        yield from broadcast.subscribe()

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
            broadcast = self._broadcast
            fifo_path = self._fifo_path
            fifo_dir = self._fifo_dir
            self._scrcpy_proc = None
            self._ffmpeg_proc = None
            self._broadcast = None
            self._pump_thread = None
            self._fifo_path = None
            self._fifo_dir = None
        if broadcast is not None:
            broadcast.close()
        self._kill_procs(scrcpy, ffmpeg)
        self._cleanup_fifo(fifo_path, fifo_dir)

    @staticmethod
    def _cleanup_fifo(fifo_path: str | None, fifo_dir: str | None) -> None:
        if fifo_path:
            try:
                os.unlink(fifo_path)
            except OSError:
                pass
        if fifo_dir:
            shutil.rmtree(fifo_dir, ignore_errors=True)

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
