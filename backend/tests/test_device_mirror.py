from unittest.mock import patch

from app.device_mirror import (
    FRIENDLY_ERRORS,
    DeviceMirrorSession,
    build_ffmpeg_cmd,
    build_scrcpy_cmd,
    resolve_tools,
    scan_for_adb_device,
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


def test_scan_returns_first_open_port(monkeypatch):
    monkeypatch.setattr("app.device_mirror._local_ipv4", lambda: "192.168.1.10")

    def fake_probe(ip, port, timeout):
        return ip == "192.168.1.50" and port == 5555

    monkeypatch.setattr("app.device_mirror._probe_tcp", fake_probe)
    assert scan_for_adb_device(timeout_s=2.0) == "192.168.1.50:5555"


def test_scan_returns_none_when_nothing_open(monkeypatch):
    monkeypatch.setattr("app.device_mirror._local_ipv4", lambda: "192.168.1.10")
    monkeypatch.setattr("app.device_mirror._probe_tcp", lambda *a, **k: False)
    assert scan_for_adb_device(timeout_s=1.0) is None


def test_scrcpy_cmd_is_headless_1080_8m():
    cmd = build_scrcpy_cmd("/opt/homebrew/bin/scrcpy", "192.168.1.50:5555")
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
