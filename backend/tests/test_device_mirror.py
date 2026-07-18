"""Minimal smoke tests for the H.264 WebSocket device session helpers."""

from app.device_mirror import (
    FRIENDLY_ERRORS,
    DeviceMirrorSession,
    H264Broadcast,
    pick_adb_device,
    resolve_tools,
)
from app.scrcpy_h264 import build_scrcpy_server_shell_cmd


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


def test_pick_adb_device_prefers_clean_host_port():
    assert pick_adb_device(["emulator-5554", "10.0.0.2:37000"]) == "10.0.0.2:37000"


def test_h264_broadcast_bootstraps_sps_pps_idr():
    from app.scrcpy_h264 import build_ws_nal_message

    b = H264Broadcast()
    sps = build_ws_nal_message(b"\x00\x00\x00\x01\x67", nal_type=7, wall_ms=1, is_key=True)
    pps = build_ws_nal_message(b"\x00\x00\x00\x01\x68", nal_type=8, wall_ms=2, is_key=True)
    idr = build_ws_nal_message(b"\x00\x00\x00\x01\x65", nal_type=5, wall_ms=3, is_key=True)
    live = build_ws_nal_message(b"\x00\x00\x00\x01\x61", nal_type=1, wall_ms=4, is_key=False)
    b.feed(sps, nal_type=7)
    b.feed(pps, nal_type=8)
    b.feed(idr, nal_type=5)

    it = b.subscribe()
    assert next(it) == sps
    assert next(it) == pps
    assert next(it) == idr
    b.feed(live, nal_type=1)
    assert next(it) == live


def test_server_cmd_never_opens_terminal():
    cmd = build_scrcpy_server_shell_cmd(
        adb="/opt/homebrew/bin/adb",
        serial="10.0.0.1:1",
        version="4.1",
    )
    joined = " ".join(cmd)
    assert "Terminal" not in joined
    assert "open -a" not in joined


def test_session_open_h264_subscription_requires_connected_broadcast():
    from app.device_mirror import DeviceMirrorSession, H264Broadcast
    from app.scrcpy_h264 import build_ws_nal_message

    session = DeviceMirrorSession()
    assert session.open_h264_subscription() is None

    broadcast = H264Broadcast()
    sps = build_ws_nal_message(b"\x00\x00\x00\x01\x67", nal_type=7, wall_ms=1, is_key=True)
    broadcast.feed(sps, nal_type=7)
    with session._lock:
        session._state = "connected"
        session._broadcast = broadcast
        session._server_proc = type("P", (), {"poll": lambda self: None})()

    sub = session.open_h264_subscription()
    assert sub is not None
    assert broadcast.stats["subscribers"] == 1
    first = next(iter(sub))
    assert first == sps
    sub.close()
    assert broadcast.stats["subscribers"] == 0


def test_open_subscription_registers_immediately():
    from app.scrcpy_h264 import build_ws_nal_message
    from app.device_mirror import H264Broadcast

    b = H264Broadcast()
    sps = build_ws_nal_message(b"\x00\x00\x00\x01\x67", nal_type=7, wall_ms=1, is_key=True)
    b.feed(sps, nal_type=7)
    assert b.stats["subscribers"] == 0
    sub = b.open_subscription()
    assert sub is not None
    assert b.stats["subscribers"] == 1
    sub.close()
    assert b.stats["subscribers"] == 0


def test_get_latency_exposes_bridge_stage_fields():
    session = DeviceMirrorSession()
    lat = session.get_latency()
    assert lat["bridgeStage"] == "idle"
    assert lat["bridgeDetail"] is None
    assert lat["bytesReadTcp"] == 0
    assert lat["transport"] == "websocket-h264"


def test_resolve_tools_requires_adb_and_server_jar():
    tools = resolve_tools()
    # On this machine Homebrew is installed — assert shape when present.
    if tools is not None:
        assert "adb" in tools
        assert "server_jar" in tools
        assert tools["server_jar"].endswith("scrcpy-server")
