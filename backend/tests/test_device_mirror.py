import os
import shutil
import threading
import time
from unittest.mock import patch

from app.device_mirror import (
    FRIENDLY_ERRORS,
    RECORD_APPEAR_MIN_BYTES,
    RECORD_APPEAR_TIMEOUT_S,
    SCRCPY_PID_TIMEOUT_S,
    DeviceMirrorSession,
    Fmp4Broadcast,
    build_ffmpeg_cmd,
    build_open_terminal_cmd,
    build_scrcpy_cmd,
    build_tail_cmd,
    create_record_file,
    extract_fmp4_init_segment,
    is_pipeline_ready_for_stream,
    list_ready_adb_devices,
    pick_adb_device,
    resolve_scrcpy_headless_flags,
    resolve_scrcpy_video_source_flags,
    resolve_tools,
    write_scrcpy_launch_script,
)


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


def test_resolve_tools_returns_none_when_adb_missing():
    with patch(
        "app.device_mirror.shutil.which",
        side_effect=lambda name: None if name == "adb" else f"/usr/local/bin/{name}",
    ):
        assert resolve_tools() is None


def test_resolve_tools_returns_paths_when_all_present():
    with patch("app.device_mirror.shutil.which", side_effect=lambda name: f"/opt/homebrew/bin/{name}"):
        tools = resolve_tools()
        assert tools == {
            "adb": "/opt/homebrew/bin/adb",
            "scrcpy": "/opt/homebrew/bin/scrcpy",
            "ffmpeg": "/opt/homebrew/bin/ffmpeg",
        }


def test_list_ready_adb_devices_parses_device_lines():
    output = (
        "List of devices attached\n"
        "192.168.1.50:37123\tdevice\n"
        "R58M123\toffline\n"
        "emulator-5554\tdevice\n"
        "ABC\tunauthorized\n"
    )
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = output
        run.return_value.returncode = 0
        assert list_ready_adb_devices("/opt/homebrew/bin/adb") == [
            "192.168.1.50:37123",
            "emulator-5554",
        ]


def test_list_ready_adb_devices_filters_mdns_service_entries():
    output = (
        "List of devices attached\n"
        "adb-R58M12345678-abc123._adb-tls-connect._tcp\tdevice\n"
        "10.100.102.6:37487\tdevice\n"
        "R58M12345678\tdevice\n"
    )
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = output
        run.return_value.returncode = 0
        assert list_ready_adb_devices("/opt/homebrew/bin/adb") == [
            "10.100.102.6:37487",
            "R58M12345678",
        ]


def test_list_ready_adb_devices_empty_when_none():
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = "List of devices attached\n\n"
        run.return_value.returncode = 0
        assert list_ready_adb_devices("/opt/homebrew/bin/adb") == []


def test_pick_adb_device_prefers_clean_host_port():
    assert (
        pick_adb_device(
            [
                "R58M123",
                "adb-R58M123._adb-tls-connect._tcp",
                "10.100.102.6:37487",
                "emulator-5554",
            ]
        )
        == "10.100.102.6:37487"
    )


def test_pick_adb_device_falls_back_to_first():
    assert pick_adb_device(["R58M123", "emulator-5554"]) == "R58M123"
    assert pick_adb_device([]) is None


def test_resolve_scrcpy_headless_flags_parks_window_offscreen_for_metal():
    """macOS Metal needs a real window; park it off-screen instead of --no-window."""
    help_text = (
        "  -N, --no-playback\n"
        "  --no-window\n"
        "  --window-borderless\n"
        "  --window-x=value\n"
        "  --window-y=value\n"
    )
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = help_text
        run.return_value.stderr = ""
        run.return_value.returncode = 0
        assert resolve_scrcpy_headless_flags("/opt/homebrew/bin/scrcpy") == [
            "--no-playback",
            "--window-borderless",
            "--window-x=-10000",
            "--window-y=-10000",
        ]


def test_resolve_scrcpy_headless_flags_falls_back_to_no_display():
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = "  --no-display\n"
        run.return_value.stderr = ""
        run.return_value.returncode = 0
        assert resolve_scrcpy_headless_flags("/opt/homebrew/bin/scrcpy") == ["--no-display"]


def test_resolve_scrcpy_headless_flags_falls_back_to_no_window_without_positioning():
    help_text = "  --no-window\n  --no-playback\n"
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = help_text
        run.return_value.stderr = ""
        run.return_value.returncode = 0
        assert resolve_scrcpy_headless_flags("/opt/homebrew/bin/scrcpy") == [
            "--no-window",
            "--no-playback",
        ]


def test_create_record_file_makes_regular_file_not_fifo():
    import stat

    record_path, temp_dir = create_record_file()
    try:
        assert os.path.isdir(temp_dir)
        assert record_path.startswith(temp_dir)
        assert record_path.endswith("record.mkv")
        # Path is reserved for scrcpy; file may be created empty or absent until start.
        if os.path.exists(record_path):
            mode = os.stat(record_path).st_mode
            assert not stat.S_ISFIFO(mode)
            assert stat.S_ISREG(mode)
    finally:
        if os.path.exists(record_path):
            os.unlink(record_path)
        os.rmdir(temp_dir)


def test_scrcpy_cmd_records_to_file_not_dev_stdout_or_dash():
    record = "/tmp/device-mirror-test/record.mkv"
    cmd = build_scrcpy_cmd(
        "/opt/homebrew/bin/scrcpy",
        "10.100.102.6:37487",
        headless_flags=[
            "--no-playback",
            "--window-borderless",
            "--window-x=-10000",
            "--window-y=-10000",
        ],
        record_path=record,
        video_source_flags=["--video-source=display"],
    )
    assert cmd[0].endswith("scrcpy")
    serial_idx = cmd.index("--serial")
    assert cmd[serial_idx + 1] == "10.100.102.6:37487"
    assert "--no-window" not in cmd
    assert "--no-playback" in cmd
    assert "--window-borderless" in cmd
    assert "--window-x=-10000" in cmd
    assert "--window-y=-10000" in cmd
    assert "--video-source=display" in cmd
    assert f"--record={record}" in cmd
    assert "--record=/dev/stdout" not in cmd
    assert "--record=-" not in cmd
    assert not any(a.startswith("--record=mirror") for a in cmd)
    assert "--max-size=1080" in cmd
    assert any("8M" in a for a in cmd)


def test_record_appear_timeout_gives_terminal_launch_time():
    """Terminal.app + Metal init is slow; don't give up after a few seconds."""
    assert RECORD_APPEAR_TIMEOUT_S >= 60.0
    assert SCRCPY_PID_TIMEOUT_S >= 20.0
    assert RECORD_APPEAR_MIN_BYTES >= 1


def test_write_scrcpy_launch_script_is_executable_and_writes_pid():
    import shlex
    import stat
    import tempfile

    record_dir = tempfile.mkdtemp(prefix="device-mirror-script-test-")
    try:
        cmd = [
            "/opt/homebrew/bin/scrcpy",
            "--serial",
            "10.0.0.1:5555",
            "--record=/tmp/device-mirror-test/record.mkv",
        ]
        script_path, pid_path, log_path = write_scrcpy_launch_script(cmd, record_dir)
        assert script_path.endswith(".command")
        assert os.path.isfile(script_path)
        assert os.stat(script_path).st_mode & stat.S_IXUSR
        assert log_path.endswith("scrcpy.log")
        body = open(script_path, encoding="utf-8").read()
        assert body.startswith("#!/bin/bash")
        assert pid_path in body
        assert log_path in body
        # stdout+stderr must land in the temp-dir log for post-mortem inspection
        assert "2>&1" in body
        assert ">>" in body
        assert shlex.quote(log_path) in body or log_path in body
        assert "/opt/homebrew/bin/scrcpy" in body
        assert "--record=/tmp/device-mirror-test/record.mkv" in body
        assert "exec" in body
    finally:
        shutil.rmtree(record_dir, ignore_errors=True)


def test_teardown_cleans_record_dir_only_after_pipeline_stop():
    """Temp dir must survive until teardown (kill) — not mid-wait cleanup."""
    import tempfile

    record_dir = tempfile.mkdtemp(prefix="device-mirror-teardown-test-")
    record_path = os.path.join(record_dir, "record.mkv")
    log_path = os.path.join(record_dir, "scrcpy.log")
    with open(record_path, "wb") as fh:
        fh.write(b"\x00" * 32)
    with open(log_path, "w", encoding="utf-8") as fh:
        fh.write("scrcpy starting\n")

    session = DeviceMirrorSession()
    session._record_path = record_path
    session._record_dir = record_dir
    assert os.path.isdir(record_dir)
    assert os.path.isfile(log_path)

    session._teardown_procs()

    assert not os.path.isdir(record_dir)
    assert session._record_path is None
    assert session._record_dir is None


def test_build_open_terminal_cmd_uses_terminal_app():
    script = "/tmp/device-mirror-test/run-scrcpy.command"
    cmd = build_open_terminal_cmd(script)
    assert cmd[:3] == ["open", "-a", "Terminal.app"]
    assert cmd[-1] == script


def test_resolve_scrcpy_video_source_flags_uses_display_when_supported():
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = "    --video-source=source\n        Select the video source (display or camera).\n"
        run.return_value.stderr = ""
        run.return_value.returncode = 0
        assert resolve_scrcpy_video_source_flags("/opt/homebrew/bin/scrcpy") == [
            "--video-source=display"
        ]


def test_resolve_scrcpy_video_source_flags_empty_when_unsupported():
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = "  --no-window\n"
        run.return_value.stderr = ""
        run.return_value.returncode = 0
        assert resolve_scrcpy_video_source_flags("/opt/homebrew/bin/scrcpy") == []


def test_tail_cmd_follows_record_file_from_start():
    record = "/tmp/device-mirror-test/record.mkv"
    cmd = build_tail_cmd(record)
    assert cmd[0] == "tail"
    assert "-c" in cmd or "+0" in cmd
    assert "-F" in cmd
    assert record in cmd


def test_ffmpeg_cmd_remuxes_tailed_pipe_to_live_fragmented_mp4_stdout():
    """ffmpeg reads matroska from stdin (fed by tail -F), not a direct file open.

    Direct ``ffmpeg -i growing.mkv`` hits premature EOF; tail -F keeps the pipe open
    as scrcpy appends.
    """
    cmd = build_ffmpeg_cmd("/opt/homebrew/bin/ffmpeg")
    joined = " ".join(cmd)
    assert "-f" in cmd
    assert "matroska" in cmd
    assert "pipe:0" in cmd
    assert "pipe:1" in cmd
    assert "frag_every_frame" in joined
    assert "empty_moov" in joined
    assert "default_base_moof" in joined
    assert "max_interleave_delta" in joined
    assert "mp4" in cmd


def _box(typ: bytes, payload: bytes) -> bytes:
    return (8 + len(payload)).to_bytes(4, "big") + typ + payload


def test_extract_fmp4_init_segment_returns_ftyp_and_moov_only():
    ftyp = _box(b"ftyp", b"iso5" + (0x200).to_bytes(4, "big") + b"iso5iso6mp41")
    moov = _box(b"moov", b"\x00" * 64)
    moof = _box(b"moof", b"\x00" * 32)
    mdat = _box(b"mdat", b"\x11" * 40)
    blob = ftyp + moov + moof + mdat

    init, rest = extract_fmp4_init_segment(blob)
    assert init == ftyp + moov
    assert rest == moof + mdat


def test_extract_fmp4_init_segment_incomplete_until_moov_arrives():
    ftyp = _box(b"ftyp", b"iso5" + (0x200).to_bytes(4, "big") + b"iso5iso6mp41")
    moov = _box(b"moov", b"\x00" * 64)
    partial = ftyp + moov[:20]
    init, rest = extract_fmp4_init_segment(partial)
    assert init is None
    assert rest == partial

    init, rest = extract_fmp4_init_segment(ftyp + moov + _box(b"moof", b"\x00" * 8))
    assert init == ftyp + moov
    assert rest.startswith(b"\x00\x00\x00")


def test_fmp4_broadcast_replays_init_segment_to_late_subscriber():
    """Browsers often open /stream twice; the second client must still get ftyp+moov."""
    ftyp = _box(b"ftyp", b"iso5" + (0x200).to_bytes(4, "big") + b"iso5iso6mp41")
    moov = _box(b"moov", b"\x00" * 64)
    moof1 = _box(b"moof", b"\x01" * 16)
    moof2 = _box(b"moof", b"\x02" * 16)

    broadcast = Fmp4Broadcast()
    broadcast.feed(ftyp + moov)

    first_chunks: list[bytes] = []
    first_gen = broadcast.subscribe()
    first_chunks.append(next(first_gen))
    assert first_chunks[0] == ftyp + moov

    broadcast.feed(moof1)
    first_chunks.append(next(first_gen))
    assert first_chunks[1] == moof1

    second_gen = broadcast.subscribe()
    assert next(second_gen) == ftyp + moov
    broadcast.feed(moof2)
    # Both live subscribers receive subsequent fragments.
    assert next(first_gen) == moof2
    assert next(second_gen) == moof2
    first_gen.close()
    second_gen.close()


def test_fmp4_broadcast_prerolls_media_until_first_subscriber():
    """Connected waits for media; that burst must not be dropped before /stream attaches."""
    ftyp = _box(b"ftyp", b"iso5" + (0x200).to_bytes(4, "big") + b"iso5iso6mp41")
    moov = _box(b"moov", b"\x00" * 64)
    moof1 = _box(b"moof", b"\x01" * 16)
    moof2 = _box(b"moof", b"\x02" * 16)

    broadcast = Fmp4Broadcast()
    assert broadcast.media_seen is False
    broadcast.feed(ftyp + moov)
    assert broadcast.media_seen is False
    broadcast.feed(moof1)
    assert broadcast.media_seen is True
    broadcast.feed(moof2)

    gen = broadcast.subscribe()
    assert next(gen) == ftyp + moov
    assert next(gen) == moof1
    assert next(gen) == moof2
    gen.close()


def test_live_pipeline_is_ready_without_media_fragments():
    """scrcpy Metal init can exceed any fragment timeout — never gate connected on moof."""
    assert is_pipeline_ready_for_stream(scrcpy_alive=True, ffmpeg_alive=True) is True
    assert is_pipeline_ready_for_stream(scrcpy_alive=True, ffmpeg_alive=False) is False
    assert is_pipeline_ready_for_stream(scrcpy_alive=False, ffmpeg_alive=True) is False


def test_start_pipeline_source_does_not_abort_on_missing_media_fragments():
    """Regression: fragment wait + _abort_start kills initializing scrcpy (zsh: killed)."""
    import inspect

    from app.device_mirror import DeviceMirrorSession

    src = inspect.getsource(DeviceMirrorSession._start_pipeline)
    assert "_wait_for_media_fragment" not in src


def test_concurrent_connect_async_never_overlaps_workers():
    """Rapid concurrent POSTs must serialize — never two pipelines at once."""
    session = DeviceMirrorSession()
    active = 0
    max_active = 0
    lock = threading.Lock()

    def counting_worker(self, epoch: int = 0):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        with self._lock:
            if epoch != self._connect_epoch:
                return
        self._set_state("connected", device_address="192.168.1.1:5555", message=None)

    with patch.object(DeviceMirrorSession, "_connect_worker", counting_worker):
        callers = [threading.Thread(target=session.connect_async) for _ in range(24)]
        for t in callers:
            t.start()
        for t in callers:
            t.join(timeout=2.0)
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            thread = session._connect_thread
            if thread is None or not thread.is_alive():
                break
            thread.join(timeout=0.05)

    assert max_active == 1
    assert session.get_status()["state"] == "connected"


def test_connect_while_running_tears_down_then_restarts():
    """Idempotent connect: kill any in-flight/running pipeline before a new start."""
    session = DeviceMirrorSession()
    teardown_calls: list[float] = []
    start_count = 0
    count_lock = threading.Lock()

    def fake_teardown(self):
        teardown_calls.append(time.monotonic())

    def recording_start(self, epoch: int = 0):
        nonlocal start_count
        with count_lock:
            start_count += 1
        self._set_state("connected", device_address="10.0.0.2:5555", message=None)

    with (
        patch.object(DeviceMirrorSession, "_teardown_procs", fake_teardown),
        patch.object(DeviceMirrorSession, "_connect_worker", recording_start),
    ):
        session.connect_async()
        if session._connect_thread:
            session._connect_thread.join(timeout=2.0)
        assert session.get_status()["state"] == "connected"

        session.connect_async()
        if session._connect_thread:
            session._connect_thread.join(timeout=2.0)

    assert start_count == 2
    assert len(teardown_calls) >= 1
    assert session.get_status()["state"] == "connected"
