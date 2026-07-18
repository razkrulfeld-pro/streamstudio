"""Device mirror via scrcpy-server raw H.264 → WebSocket (no GUI / ffmpeg / Terminal)."""

from __future__ import annotations

import logging
import os
import queue
import re
import shutil
import signal
import socket
import subprocess
import threading
import time
from typing import Callable, Iterator, Literal, TypedDict

from app.scrcpy_h264 import (
    annex_b_split_nals,
    build_scrcpy_server_shell_cmd,
    build_ws_nal_message,
    is_key_nal,
    resolve_scrcpy_server_jar,
    resolve_scrcpy_server_version,
)

logger = logging.getLogger(__name__)

DeviceState = Literal["idle", "searching", "found", "connecting", "connected", "error"]

ADB_MDNS_MARKER = "._adb-tls-connect._tcp"
CLEAN_HOST_PORT_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}:\d+$")
REMOTE_JAR = "/data/local/tmp/scrcpy-server.jar"
TARGET_CAPTURE_LAG_S = 2.0

FRIENDLY_ERRORS = {
    "not_found": (
        "Couldn't find a connected phone. "
        "Pair it with Wireless debugging (or plug in USB), then try again."
    ),
    "tools_missing": (
        "Device tools aren't available on this Mac. "
        "Install adb and scrcpy (Homebrew), then retry."
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
    adb = shutil.which("adb")
    jar = resolve_scrcpy_server_jar()
    if not adb or not jar:
        return None
    return {"adb": adb, "server_jar": jar}


def is_mdns_adb_serial(serial: str) -> bool:
    return ADB_MDNS_MARKER in serial


def is_clean_host_port_serial(serial: str) -> bool:
    return bool(CLEAN_HOST_PORT_RE.match(serial))


def list_ready_adb_devices(adb: str, timeout_s: float = 10.0) -> list[str]:
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


def wake_device_screen(adb: str, serial: str) -> None:
    for args in (
        [adb, "-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
        [adb, "-s", serial, "shell", "settings", "put", "system", "screen_off_timeout", "600000"],
    ):
        try:
            subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger.warning("wake_device_screen failed (%s): %s", args, exc)


def pick_free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class H264Subscription:
    """One WebSocket client's handle on an H264Broadcast (registered immediately)."""

    def __init__(
        self,
        broadcast: "H264Broadcast",
        q: queue.Queue[bytes | None],
        bootstrap: list[bytes],
    ) -> None:
        self._broadcast = broadcast
        self._q = q
        self._bootstrap = bootstrap
        self._closed = False

    def __iter__(self) -> Iterator[bytes]:
        # Do NOT close() in a finally here — generator GC / early exit would drop
        # the subscriber from _subscribers while the WebSocket is still open.
        # Callers (WS producer / handler) must call close() explicitly.
        for msg in self._bootstrap:
            if self._closed:
                return
            yield msg
        while not self._closed:
            item = self._q.get()
            if item is None or self._closed:
                return
            yield item

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._broadcast._drop_subscriber(self._q)
        try:
            self._q.put_nowait(None)
        except queue.Full:
            pass


class H264Broadcast:
    """Fan-out framed H.264 NAL messages to WebSocket subscribers."""

    _QUEUE_SIZE = 256

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: list[queue.Queue[bytes | None]] = []
        self._closed = False
        self._sps: bytes | None = None
        self._pps: bytes | None = None
        self._last_idr: bytes | None = None
        self._bytes_fed = 0
        self._nal_count = 0

    @property
    def stats(self) -> dict[str, int | bool]:
        with self._lock:
            return {
                "bytes_fed": self._bytes_fed,
                "nal_count": self._nal_count,
                "subscribers": len(self._subscribers),
                "has_sps": self._sps is not None,
                "has_pps": self._pps is not None,
                "has_idr": self._last_idr is not None,
                "closed": self._closed,
            }

    def feed(self, message: bytes, *, nal_type: int) -> None:
        with self._lock:
            if self._closed:
                return
            self._bytes_fed += len(message)
            self._nal_count += 1
            if nal_type == 7:
                self._sps = message
            elif nal_type == 8:
                self._pps = message
            elif nal_type == 5:
                self._last_idr = message
            dead: list[queue.Queue[bytes | None]] = []
            for q in self._subscribers:
                try:
                    q.put_nowait(message)
                except queue.Full:
                    # Drop oldest by getting one, then put — stay on live edge.
                    try:
                        q.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        q.put_nowait(message)
                    except queue.Full:
                        dead.append(q)
            for q in dead:
                if q in self._subscribers:
                    self._subscribers.remove(q)

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

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    def _add_subscriber(self, q: queue.Queue[bytes | None]) -> int:
        """Append a subscriber queue; return the new subscriber count (-1 if closed)."""
        with self._lock:
            if self._closed:
                logger.warning(
                    "broadcast._add_subscriber: refused (broadcast closed) id=%s",
                    id(self),
                )
                return -1
            self._subscribers.append(q)
            count = len(self._subscribers)
        logger.info(
            "broadcast._add_subscriber: appended q id=%s broadcast id=%s subscribers=%s",
            id(q),
            id(self),
            count,
        )
        return count

    def open_subscription(self) -> H264Subscription | None:
        """Register a subscriber immediately (before any yield / thread hop)."""
        q: queue.Queue[bytes | None] = queue.Queue(maxsize=self._QUEUE_SIZE)
        with self._lock:
            if self._closed:
                logger.warning(
                    "broadcast.open_subscription: None (closed) broadcast id=%s",
                    id(self),
                )
                return None
            bootstrap = [m for m in (self._sps, self._pps, self._last_idr) if m is not None]
            self._subscribers.append(q)
            count = len(self._subscribers)
        logger.info(
            "broadcast._add_subscriber: appended q id=%s broadcast id=%s subscribers=%s "
            "bootstrap=%s",
            id(q),
            id(self),
            count,
            len(bootstrap),
        )
        return H264Subscription(self, q, bootstrap)

    def _drop_subscriber(self, q: queue.Queue[bytes | None]) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)
                count = len(self._subscribers)
            else:
                count = len(self._subscribers)
                logger.info(
                    "broadcast._drop_subscriber: q id=%s not in list broadcast id=%s "
                    "subscribers=%s",
                    id(q),
                    id(self),
                    count,
                )
                return
        logger.info(
            "broadcast._drop_subscriber: removed q id=%s broadcast id=%s subscribers=%s",
            id(q),
            id(self),
            count,
        )

    def subscribe(self) -> Iterator[bytes]:
        sub = self.open_subscription()
        if sub is None:
            return iter(())

        def _gen() -> Iterator[bytes]:
            try:
                yield from sub
            finally:
                sub.close()

        return _gen()


class DeviceMirrorSession:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connect_mutex = threading.Lock()
        self._connect_epoch = 0
        self._state: DeviceState = "idle"
        self._device_address: str | None = None
        self._message: str | None = None
        self._error: str | None = None
        self._tools: dict[str, str] | None = None
        self._server_proc: subprocess.Popen[bytes] | None = None
        self._tcp_sock: socket.socket | None = None
        self._forward_port: int | None = None
        self._broadcast: H264Broadcast | None = None
        self._reader_thread: threading.Thread | None = None
        self._pipeline_wall_t0: float | None = None
        self._first_nal_wall: float | None = None
        self._last_nal_wall: float | None = None
        self._nal_count = 0
        self._bytes_out = 0
        self._bytes_read_tcp = 0
        self._bridge_stage: str = "idle"
        self._bridge_detail: str | None = None
        self._stopping = False
        self._connect_thread: threading.Thread | None = None

    def _set_bridge_stage(self, stage: str, detail: str | None = None) -> None:
        with self._lock:
            self._bridge_stage = stage
            self._bridge_detail = detail
        if detail:
            logger.info("bridge.stage: %s — %s", stage, detail)
        else:
            logger.info("bridge.stage: %s", stage)

    def get_status(self) -> DeviceStatus:
        with self._lock:
            return {
                "state": self._state,
                "deviceAddress": self._device_address,
                "message": self._message,
                "error": self._error,
            }

    def get_latency(self) -> dict[str, float | int | str | bool | None]:
        now = time.time()
        with self._lock:
            wall_t0 = self._pipeline_wall_t0
            first_nal = self._first_nal_wall
            last_nal = self._last_nal_wall
            state = self._state
            port = self._forward_port
            broadcast = self._broadcast
            nal_count = self._nal_count
            bytes_out = self._bytes_out
            bytes_read_tcp = self._bytes_read_tcp
            bridge_stage = self._bridge_stage
            bridge_detail = self._bridge_detail
        age = (now - wall_t0) if wall_t0 else None
        tip_age = (now - last_nal) if last_nal else None
        return {
            "state": state,
            "pipelineAgeS": age,
            "captureTipAgeS": tip_age,
            "targetCaptureLagS": TARGET_CAPTURE_LAG_S,
            "withinTarget": tip_age is not None and tip_age <= TARGET_CAPTURE_LAG_S,
            "stages": {
                "firstNalAfterS": (first_nal - wall_t0) if first_nal and wall_t0 else None,
                "lastNalAgeS": tip_age,
            },
            "bridgeStage": bridge_stage,
            "bridgeDetail": bridge_detail,
            "forwardPort": port,
            "nalCount": nal_count,
            "bytesOut": bytes_out,
            "bytesReadTcp": bytes_read_tcp,
            "broadcast": broadcast.stats if broadcast else None,
            "wallClock": now,
            "transport": "websocket-h264",
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
            self._connect_epoch += 1
            epoch = self._connect_epoch
            self._stopping = True

        def run() -> None:
            with self._connect_mutex:
                with self._lock:
                    if epoch != self._connect_epoch:
                        return
                    self._stopping = False
                self._teardown_procs()
                with self._lock:
                    if epoch != self._connect_epoch:
                        return
                    self._state = "idle"
                    self._device_address = None
                    self._message = None
                    self._error = None
                    self._tools = None
                try:
                    self._connect_worker(epoch)
                except Exception:
                    logger.exception("Device connect failed unexpectedly")
                    if not self._is_stale(epoch):
                        self.set_error("connect_failed")

        thread = threading.Thread(target=run, name="device-mirror-connect", daemon=True)
        with self._lock:
            self._connect_thread = thread
        thread.start()

    def _connect_worker(self, epoch: int) -> None:
        if self._is_stale(epoch):
            return
        self._set_state("searching", message=STATUS_MESSAGES["searching"])
        tools = resolve_tools()
        if tools is None:
            self.set_error("tools_missing")
            return

        serials = list_ready_adb_devices(tools["adb"])
        if self._is_stale(epoch):
            return
        address = pick_adb_device(serials)
        if address is None:
            self.set_error("not_found")
            return

        self._set_state("found", device_address=address, message=STATUS_MESSAGES["found"])
        self._set_state(
            "connecting",
            device_address=address,
            message=STATUS_MESSAGES["connecting"],
        )
        with self._lock:
            if epoch != self._connect_epoch:
                return
            self._tools = tools
            self._device_address = address

        wake_device_screen(tools["adb"], address)
        self._start_pipeline(epoch)

    def _is_stale(self, epoch: int) -> bool:
        with self._lock:
            return self._stopping or epoch != self._connect_epoch

    def _start_pipeline(self, epoch: int) -> None:
        if self._is_stale(epoch):
            return
        tools = self._tools
        address = self._device_address
        if not tools or not address:
            self.set_error("connect_failed")
            return

        adb = tools["adb"]
        jar = tools["server_jar"]
        version = resolve_scrcpy_server_version()
        port = pick_free_tcp_port()
        pipeline_wall_t0 = time.time()
        self._set_bridge_stage("push_jar", f"jar={jar} remote={REMOTE_JAR}")

        # Push server jar
        try:
            push = subprocess.run(
                [adb, "-s", address, "push", jar, REMOTE_JAR],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            self._set_bridge_stage("push_jar_failed", str(exc))
            logger.warning("adb push failed: %s", exc)
            self._abort_start(epoch)
            return
        if push.returncode != 0:
            detail = (push.stderr or push.stdout).strip()
            self._set_bridge_stage("push_jar_failed", detail)
            logger.warning("adb push failed: %s", detail)
            self._abort_start(epoch)
            return
        self._set_bridge_stage("push_jar_ok", (push.stdout or "").strip()[:200])

        # Forward TCP → abstract socket (no Terminal, no GUI scrcpy)
        self._set_bridge_stage("adb_forward", f"tcp:{port} → localabstract:scrcpy")
        try:
            fwd = subprocess.run(
                [adb, "-s", address, "forward", f"tcp:{port}", "localabstract:scrcpy"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            self._set_bridge_stage("adb_forward_failed", str(exc))
            logger.warning("adb forward failed: %s", exc)
            self._abort_start(epoch)
            return
        if fwd.returncode != 0:
            detail = (fwd.stderr or fwd.stdout or f"rc={fwd.returncode}").strip()
            self._set_bridge_stage("adb_forward_failed", detail)
            logger.warning("adb forward failed: %s", detail)
            self._abort_start(epoch)
            return
        self._set_bridge_stage(
            "adb_forward_ok",
            f"tcp:{port} → localabstract:scrcpy stdout={(fwd.stdout or '').strip()!r}",
        )

        server_cmd = build_scrcpy_server_shell_cmd(
            adb=adb,
            serial=address,
            version=version,
            max_size=1080,
            bit_rate=8_000_000,
            max_fps=60,
            remote_jar=REMOTE_JAR,
        )
        self._set_bridge_stage("start_server", " ".join(server_cmd))
        logger.info(
            "Starting scrcpy-server raw H.264 on tcp:%s (no Terminal/GUI): %s",
            port,
            " ".join(server_cmd),
        )
        try:
            server_proc = subprocess.Popen(
                server_cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
            )
        except OSError as exc:
            self._set_bridge_stage("start_server_failed", str(exc))
            logger.warning("Failed to start scrcpy-server: %s", exc)
            self._remove_forward(adb, address, port)
            self._abort_start(epoch)
            return
        self._set_bridge_stage("start_server_ok", f"pid={server_proc.pid}")

        def _log_server() -> None:
            stream = server_proc.stdout
            if stream is None:
                return
            try:
                for raw in iter(stream.readline, b""):
                    line = raw.decode("utf-8", errors="replace").rstrip()
                    if line:
                        logger.info("scrcpy-server: %s", line)
            except Exception:
                logger.exception("Failed reading scrcpy-server output")

        threading.Thread(target=_log_server, name="scrcpy-server-log", daemon=True).start()

        # Server listens after start; connect with retries.
        # IMPORTANT: `adb forward` accepts TCP even when nothing listens on the
        # device — those sockets EOF immediately. Retry until we get a live
        # connection (data or a blocking wait without EOF).
        self._set_bridge_stage("tcp_connect", f"127.0.0.1:{port}")
        sock: socket.socket | None = None
        primed: bytes = b""
        deadline = time.time() + 15.0
        last_err: Exception | None = None
        attempts = 0
        eof_stubs = 0
        while time.time() < deadline:
            if self._is_stale(epoch):
                server_proc.terminate()
                self._remove_forward(adb, address, port)
                return
            if server_proc.poll() is not None:
                self._set_bridge_stage(
                    "tcp_connect_failed",
                    f"scrcpy-server exited early rc={server_proc.returncode}",
                )
                logger.warning("scrcpy-server exited early rc=%s", server_proc.returncode)
                self._remove_forward(adb, address, port)
                self._abort_start(epoch)
                return
            attempts += 1
            try:
                candidate = socket.create_connection(("127.0.0.1", port), timeout=1.0)
                candidate.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                candidate.settimeout(1.0)
                try:
                    first = candidate.recv(65536)
                except socket.timeout:
                    # Connected and alive; frames not yet — keep it.
                    sock = candidate
                    primed = b""
                    self._set_bridge_stage(
                        "tcp_connect_ok",
                        f"port={port} attempts={attempts} eof_stubs={eof_stubs} "
                        f"primed=0 (alive, waiting for first NAL)",
                    )
                    break
                if not first:
                    # Immediate EOF: forward stub without a listening server.
                    eof_stubs += 1
                    logger.info(
                        "bridge.tcp: attempt=%s immediate EOF on tcp:%s (stub; retry)",
                        attempts,
                        port,
                    )
                    candidate.close()
                    time.sleep(0.1)
                    continue
                sock = candidate
                primed = first
                self._set_bridge_stage(
                    "tcp_connect_ok",
                    f"port={port} attempts={attempts} eof_stubs={eof_stubs} "
                    f"primed={len(primed)} first_hex={primed[:16].hex()}",
                )
                break
            except OSError as exc:
                last_err = exc
                logger.info("bridge.tcp: attempt=%s connect error: %s", attempts, exc)
                time.sleep(0.15)
        if sock is None:
            self._set_bridge_stage(
                "tcp_connect_failed",
                f"port={port} attempts={attempts} eof_stubs={eof_stubs} last_err={last_err}",
            )
            logger.warning("TCP connect to scrcpy-server failed: %s", last_err)
            server_proc.terminate()
            self._remove_forward(adb, address, port)
            self._abort_start(epoch)
            return

        sock.settimeout(None)
        broadcast = H264Broadcast()
        with self._lock:
            if epoch != self._connect_epoch:
                sock.close()
                server_proc.terminate()
                self._remove_forward(adb, address, port)
                return
            self._server_proc = server_proc
            self._tcp_sock = sock
            self._forward_port = port
            self._broadcast = broadcast
            self._pipeline_wall_t0 = pipeline_wall_t0
            self._first_nal_wall = None
            self._last_nal_wall = None
            self._nal_count = 0
            self._bytes_out = 0
            self._bytes_read_tcp = len(primed)

        self._set_bridge_stage("tcp_read", f"reader starting primed={len(primed)}")
        reader = threading.Thread(
            target=self._read_h264_loop,
            args=(epoch, sock, broadcast, pipeline_wall_t0, primed),
            name="device-mirror-h264",
            daemon=True,
        )
        reader.start()
        with self._lock:
            self._reader_thread = reader

        # Wait briefly for first NAL before marking connected.
        ready_deadline = time.time() + 10.0
        while time.time() < ready_deadline:
            if self._is_stale(epoch):
                self._abort_start(epoch)
                return
            with self._lock:
                first = self._first_nal_wall
            if first is not None:
                break
            if server_proc.poll() is not None:
                self._abort_start(epoch)
                return
            time.sleep(0.05)
        else:
            with self._lock:
                bytes_read = self._bytes_read_tcp
            self._set_bridge_stage(
                "first_nal_timeout",
                f"port={port} bytes_read_tcp={bytes_read} (no Annex-B NAL in 10s)",
            )
            logger.warning(
                "No H.264 NAL received within timeout (bytes_read_tcp=%s)",
                bytes_read,
            )
            self._abort_start(epoch)
            return

        if self._is_stale(epoch):
            self._abort_start(epoch)
            return

        with self._lock:
            bytes_read = self._bytes_read_tcp
            nal_count = self._nal_count
        self._set_bridge_stage(
            "streaming",
            f"port={port} bytes_read_tcp={bytes_read} nals={nal_count}",
        )
        self._set_state("connected", device_address=address, message=None)
        threading.Thread(
            target=self._keep_device_awake,
            args=(epoch, adb, address),
            name="device-mirror-awake",
            daemon=True,
        ).start()
        threading.Thread(
            target=self._watch_server,
            args=(epoch,),
            name="device-mirror-watch",
            daemon=True,
        ).start()
        logger.info(
            "pipeline.connected: h264 ws port=%s first_nal=%.3fs",
            port,
            (self._first_nal_wall or pipeline_wall_t0) - pipeline_wall_t0,
        )

    def _read_h264_loop(
        self,
        epoch: int,
        sock: socket.socket,
        broadcast: H264Broadcast,
        pipeline_wall_t0: float,
        primed: bytes = b"",
    ) -> None:
        buf = primed
        total_read = len(primed)
        first_chunk_logged = False
        try:
            if primed:
                logger.info(
                    "bridge.tcp_read: primed=%s bytes first_hex=%s",
                    len(primed),
                    primed[:16].hex(),
                )
            # Process any bytes already read during the live-connect probe.
            if buf:
                units, buf = annex_b_split_nals(buf, return_remainder=True)
                now = time.time()
                wall_ms = int(now * 1000)
                for unit in units:
                    msg = build_ws_nal_message(
                        unit.data,
                        nal_type=unit.nal_type,
                        wall_ms=wall_ms,
                        is_key=is_key_nal(unit.nal_type),
                    )
                    broadcast.feed(msg, nal_type=unit.nal_type)
                    with self._lock:
                        if self._first_nal_wall is None:
                            self._first_nal_wall = now
                            self._bridge_stage = "first_nal"
                            self._bridge_detail = (
                                f"after={now - pipeline_wall_t0:.3f}s type={unit.nal_type} "
                                f"bytes_read_tcp={total_read}"
                            )
                            logger.info(
                                "bridge.stage: first_nal — %s",
                                self._bridge_detail,
                            )
                            logger.info(
                                "pipeline.latency: first_nal after=%.3fs type=%s",
                                now - pipeline_wall_t0,
                                unit.nal_type,
                            )
                        self._last_nal_wall = now
                        self._nal_count += 1
                        self._bytes_out += len(msg)
            while not self._is_stale(epoch):
                try:
                    chunk = sock.recv(65536)
                except OSError as exc:
                    self._set_bridge_stage(
                        "tcp_read_error",
                        f"recv OSError: {exc} bytes_read_tcp={total_read}",
                    )
                    logger.warning(
                        "bridge.tcp_read: OSError after %s bytes: %s", total_read, exc
                    )
                    break
                if not chunk:
                    self._set_bridge_stage(
                        "tcp_eof",
                        f"bytes_read_tcp={total_read} nals={self._nal_count}",
                    )
                    logger.warning(
                        "bridge.tcp_read: EOF after bytes_read_tcp=%s nals=%s",
                        total_read,
                        self._nal_count,
                    )
                    break
                total_read += len(chunk)
                with self._lock:
                    self._bytes_read_tcp = total_read
                if not first_chunk_logged:
                    first_chunk_logged = True
                    logger.info(
                        "bridge.tcp_read: first_live_chunk=%s bytes hex=%s total=%s",
                        len(chunk),
                        chunk[:16].hex(),
                        total_read,
                    )
                elif total_read < 65536 or total_read % (512 * 1024) < len(chunk):
                    logger.info(
                        "bridge.tcp_read: +%s bytes total=%s nals=%s",
                        len(chunk),
                        total_read,
                        self._nal_count,
                    )
                buf += chunk
                units, buf = annex_b_split_nals(buf, return_remainder=True)
                now = time.time()
                wall_ms = int(now * 1000)
                for unit in units:
                    msg = build_ws_nal_message(
                        unit.data,
                        nal_type=unit.nal_type,
                        wall_ms=wall_ms,
                        is_key=is_key_nal(unit.nal_type),
                    )
                    broadcast.feed(msg, nal_type=unit.nal_type)
                    with self._lock:
                        if self._first_nal_wall is None:
                            self._first_nal_wall = now
                            self._bridge_stage = "first_nal"
                            self._bridge_detail = (
                                f"after={now - pipeline_wall_t0:.3f}s type={unit.nal_type} "
                                f"bytes_read_tcp={total_read}"
                            )
                            logger.info(
                                "bridge.stage: first_nal — %s",
                                self._bridge_detail,
                            )
                            logger.info(
                                "pipeline.latency: first_nal after=%.3fs type=%s",
                                now - pipeline_wall_t0,
                                unit.nal_type,
                            )
                        self._last_nal_wall = now
                        self._nal_count += 1
                        self._bytes_out += len(msg)
        except Exception:
            self._set_bridge_stage("tcp_read_failed", f"bytes_read_tcp={total_read}")
            logger.exception("H.264 reader failed")
        finally:
            broadcast.close()
            logger.info(
                "pipeline.h264: reader ended (nals=%s bytes_read_tcp=%s)",
                self._nal_count,
                total_read,
            )

    def _keep_device_awake(self, epoch: int, adb: str, serial: str) -> None:
        while not self._is_stale(epoch):
            wake_device_screen(adb, serial)
            for _ in range(20):
                if self._is_stale(epoch):
                    return
                time.sleep(1.0)

    def _watch_server(self, epoch: int) -> None:
        while not self._is_stale(epoch):
            with self._lock:
                proc = self._server_proc
                broadcast = self._broadcast
            if proc is not None and proc.poll() is not None:
                if not self._stopping:
                    logger.warning("scrcpy-server exited; ending session")
                    self._teardown_procs()
                    self.set_error("connection_lost")
                return
            if broadcast is not None and broadcast.closed:
                if not self._stopping:
                    self._teardown_procs()
                    self.set_error("connection_lost")
                return
            time.sleep(0.5)

    def _abort_start(self, epoch: int | None = None) -> None:
        self._teardown_procs()
        if epoch is not None and self._is_stale(epoch):
            return
        self.set_error("connect_failed")

    def open_h264_subscription(self) -> H264Subscription | None:
        """Register on the live broadcast immediately (call from WS accept path)."""
        with self._lock:
            state = self._state
            stopping = self._stopping
            broadcast = self._broadcast
        if stopping or state != "connected":
            logger.info(
                "open_h264_subscription: None (state=%s stopping=%s session id=%s)",
                state,
                stopping,
                id(self),
            )
            return None
        if broadcast is None:
            logger.info(
                "open_h264_subscription: None (broadcast is None session id=%s)",
                id(self),
            )
            return None
        if broadcast.closed:
            logger.info(
                "open_h264_subscription: None (broadcast closed id=%s session id=%s)",
                id(broadcast),
                id(self),
            )
            return None
        sub = broadcast.open_subscription()
        # If pipeline swapped broadcast under us, drop the orphan subscription.
        with self._lock:
            still_current = self._broadcast is broadcast and self._state == "connected"
        if sub is not None and not still_current:
            logger.warning(
                "open_h264_subscription: broadcast swapped after subscribe — dropping "
                "orphan sub broadcast id=%s session id=%s",
                id(broadcast),
                id(self),
            )
            sub.close()
            return None
        logger.info(
            "open_h264_subscription: returned %s broadcast id=%s session id=%s "
            "subscribers=%s",
            "H264Subscription" if sub is not None else None,
            id(broadcast),
            id(self),
            broadcast.stats.get("subscribers"),
        )
        return sub

    def iter_h264(self) -> Iterator[bytes]:
        """Yield framed H.264 WS messages while the pipeline is live."""
        while self._pipeline_streaming():
            sub = self.open_h264_subscription()
            if sub is None:
                time.sleep(0.05)
                continue
            try:
                for msg in sub:
                    yield msg
                    if not self._pipeline_streaming():
                        return
            finally:
                sub.close()
            if not self._pipeline_streaming():
                return
            time.sleep(0.05)

    def _pipeline_streaming(self) -> bool:
        with self._lock:
            if self._stopping or self._state != "connected":
                return False
            proc = self._server_proc
            broadcast = self._broadcast
        if proc is None or proc.poll() is not None:
            return False
        if broadcast is None or broadcast.closed:
            return False
        return True

    def disconnect(self) -> None:
        with self._lock:
            self._connect_epoch += 1
            self._stopping = True
        self._teardown_procs()
        self.reset_to_idle()
        self._stopping = False

    def refresh_stream(self) -> bool:
        """Restart capture (e.g. after rotation)."""
        with self._lock:
            if self._stopping or self._state != "connected":
                return False
            tools = dict(self._tools) if self._tools else None
            address = self._device_address
            self._connect_epoch += 1
            epoch = self._connect_epoch
        if not tools or not address:
            return False
        self._teardown_procs()
        with self._lock:
            if epoch != self._connect_epoch or self._stopping:
                return False
            self._tools = tools
            self._device_address = address
            self._state = "connecting"
            self._message = STATUS_MESSAGES["connecting"]
            self._error = None
        try:
            self._start_pipeline(epoch)
        except Exception:
            logger.exception("refresh-stream failed")
            return False
        return self.get_status()["state"] == "connected"

    def _teardown_procs(self) -> None:
        with self._lock:
            sock = self._tcp_sock
            proc = self._server_proc
            broadcast = self._broadcast
            port = self._forward_port
            tools = self._tools
            address = self._device_address
            self._tcp_sock = None
            self._server_proc = None
            self._broadcast = None
            self._reader_thread = None
            self._forward_port = None
            self._pipeline_wall_t0 = None
            self._first_nal_wall = None
            self._last_nal_wall = None
        if broadcast is not None:
            broadcast.close()
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
        if proc is not None:
            try:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
            except OSError:
                pass
        # Kill any leftover server on device for this session
        if tools and address:
            try:
                subprocess.run(
                    [tools["adb"], "-s", address, "shell", "pkill", "-f", "scrcpy.Server"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired):
                pass
            if port is not None:
                self._remove_forward(tools["adb"], address, port)

    @staticmethod
    def _remove_forward(adb: str, serial: str, port: int) -> None:
        try:
            subprocess.run(
                [adb, "-s", serial, "forward", "--remove", f"tcp:{port}"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
