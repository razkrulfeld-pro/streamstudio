import os
from unittest.mock import patch

from app.device_mirror import (
    FRIENDLY_ERRORS,
    DeviceMirrorSession,
    Fmp4Broadcast,
    build_ffmpeg_cmd,
    build_scrcpy_cmd,
    create_record_fifo,
    extract_fmp4_init_segment,
    list_ready_adb_devices,
    pick_adb_device,
    resolve_scrcpy_headless_flags,
    resolve_scrcpy_video_source_flags,
    resolve_tools,
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


def test_create_record_fifo_makes_named_pipe():
    import stat

    fifo_path, temp_dir = create_record_fifo()
    try:
        assert os.path.exists(fifo_path)
        assert os.path.isdir(temp_dir)
        assert fifo_path.startswith(temp_dir)
        assert stat.S_ISFIFO(os.stat(fifo_path).st_mode)
    finally:
        os.unlink(fifo_path)
        os.rmdir(temp_dir)


def test_scrcpy_cmd_records_to_fifo_not_dev_stdout_or_dash():
    fifo = "/tmp/device-mirror-test/record.mkv"
    cmd = build_scrcpy_cmd(
        "/opt/homebrew/bin/scrcpy",
        "10.100.102.6:37487",
        headless_flags=[
            "--no-playback",
            "--window-borderless",
            "--window-x=-10000",
            "--window-y=-10000",
        ],
        record_path=fifo,
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
    assert f"--record={fifo}" in cmd
    assert "--record=/dev/stdout" not in cmd
    assert "--record=-" not in cmd
    assert not any(a.startswith("--record=mirror") for a in cmd)
    assert "--max-size=1080" in cmd
    assert any("8M" in a for a in cmd)


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


def test_ffmpeg_cmd_remuxes_fifo_to_live_fragmented_mp4_stdout():
    fifo = "/tmp/device-mirror-test/record.mkv"
    cmd = build_ffmpeg_cmd("/opt/homebrew/bin/ffmpeg", fifo)
    joined = " ".join(cmd)
    assert "-f" in cmd
    assert "matroska" in cmd
    assert fifo in cmd
    assert "pipe:0" not in cmd
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
