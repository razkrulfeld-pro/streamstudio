"""Tests for Annex-B NAL splitting and scrcpy-server launch (no GUI / Terminal)."""

from __future__ import annotations

import struct

import pytest

from app.scrcpy_h264 import (
    annex_b_split_nals,
    build_scrcpy_server_shell_cmd,
    build_ws_nal_message,
    parse_ws_nal_message,
    resolve_scrcpy_server_jar,
)


def test_resolve_scrcpy_server_jar_finds_homebrew_share():
    path = resolve_scrcpy_server_jar()
    assert path is not None
    assert path.endswith("scrcpy-server")
    assert "scrcpy" in path


def test_build_scrcpy_server_shell_cmd_is_raw_stream_no_gui():
    cmd = build_scrcpy_server_shell_cmd(
        adb="/opt/homebrew/bin/adb",
        serial="10.0.0.1:5555",
        version="4.1",
        max_size=1080,
        bit_rate=8_000_000,
        max_fps=60,
    )
    # Must be adb shell app_process — never open/Terminal/scrcpy GUI binary.
    assert cmd[0].endswith("adb")
    assert "-s" in cmd
    assert "shell" in cmd
    assert any("app_process" in p for p in cmd)
    assert any("raw_stream=true" in p for p in cmd)
    assert any("audio=false" in p for p in cmd)
    assert any("control=false" in p for p in cmd)
    assert any("tunnel_forward=true" in p for p in cmd)
    joined = " ".join(cmd)
    assert "Terminal" not in joined
    assert "open" not in joined
    assert not any(p.endswith("/scrcpy") and "server" not in p for p in cmd)


def test_annex_b_split_nals_finds_sps_pps_idr():
    # Minimal fake Annex-B: startcode + nal_type in low 5 bits
    def nal(nt: int, payload: bytes = b"\x00") -> bytes:
        return b"\x00\x00\x00\x01" + bytes([nt & 0x1F]) + payload

    blob = nal(7, b"SPS") + nal(8, b"PPS") + nal(5, b"IDR") + nal(1, b"P")
    units = annex_b_split_nals(blob)
    assert [u.nal_type for u in units] == [7, 8, 5, 1]
    assert units[0].data.startswith(b"\x00\x00\x00\x01")
    assert b"SPS" in units[0].data


def test_annex_b_split_nals_handles_3_byte_start_codes():
    blob = b"\x00\x00\x01\x67\xaa" + b"\x00\x00\x01\x68\xbb"
    units = annex_b_split_nals(blob)
    assert len(units) == 2
    assert units[0].nal_type == 7
    assert units[1].nal_type == 8


def test_annex_b_split_nals_returns_remainder_for_incomplete_tail():
    complete = b"\x00\x00\x00\x01\x67\x00\x00"
    # Second start begins but we will treat last start..EOF as remainder.
    blob = complete + b"\x00\x00\x00\x01\x65"
    units, rest = annex_b_split_nals(blob, return_remainder=True)
    assert len(units) == 1
    assert units[0].nal_type == 7
    assert rest.startswith(b"\x00\x00\x00\x01\x65")


def test_ws_nal_message_roundtrip_includes_wall_timestamp():
    payload = b"\x00\x00\x00\x01\x65\x00"
    msg = build_ws_nal_message(
        payload,
        nal_type=5,
        wall_ms=1_700_000_000_123,
        is_key=True,
    )
    parsed = parse_ws_nal_message(msg)
    assert parsed["nal_type"] == 5
    assert parsed["is_key"] is True
    assert parsed["wall_ms"] == 1_700_000_000_123
    assert parsed["data"] == payload
