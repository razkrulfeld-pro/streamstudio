from unittest.mock import patch

from app.device_mirror import (
    FRIENDLY_ERRORS,
    DeviceMirrorSession,
    build_ffmpeg_cmd,
    build_scrcpy_cmd,
    list_ready_adb_devices,
    pick_adb_device,
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


def test_list_ready_adb_devices_empty_when_none():
    with patch("app.device_mirror.subprocess.run") as run:
        run.return_value.stdout = "List of devices attached\n\n"
        run.return_value.returncode = 0
        assert list_ready_adb_devices("/opt/homebrew/bin/adb") == []


def test_pick_adb_device_prefers_network_serial():
    assert pick_adb_device(["R58M123", "192.168.1.50:37123", "emulator-5554"]) == "192.168.1.50:37123"


def test_pick_adb_device_falls_back_to_first():
    assert pick_adb_device(["R58M123", "emulator-5554"]) == "R58M123"
    assert pick_adb_device([]) is None


def test_scrcpy_cmd_is_headless_1080_8m():
    cmd = build_scrcpy_cmd("/opt/homebrew/bin/scrcpy", "192.168.1.50:37123")
    assert cmd[0].endswith("scrcpy")
    assert "--no-playback" in cmd
    assert "--max-size=1080" in cmd
    assert any("8M" in a for a in cmd)
    assert "--window" not in " ".join(cmd)


def test_ffmpeg_cmd_outputs_fragmented_mp4():
    cmd = build_ffmpeg_cmd("/opt/homebrew/bin/ffmpeg")
    joined = " ".join(cmd)
    assert "frag_keyframe" in joined
    assert "empty_moov" in joined
    assert "-f" in cmd
    assert "mp4" in cmd
