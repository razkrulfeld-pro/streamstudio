"""scrcpy-server raw H.264 helpers — no GUI client, no ffmpeg, no Terminal."""

from __future__ import annotations

import glob
import os
import re
import shutil
import struct
import subprocess
from dataclasses import dataclass
from typing import TypedDict


@dataclass(frozen=True)
class NalUnit:
    nal_type: int
    data: bytes  # includes start code


class WsNalParsed(TypedDict):
    nal_type: int
    is_key: bool
    wall_ms: int
    data: bytes


# WS binary frame:
# magic(2)="H2" | version(u8)=1 | flags(u8) | nal_type(u8) | pad(3) | wall_ms(u64 BE) | payload
_WS_MAGIC = b"H2"
_WS_VERSION = 1
_FLAG_KEY = 0x01


def resolve_scrcpy_server_jar() -> str | None:
    """Locate Homebrew (or PATH-adjacent) scrcpy-server jar/binary blob."""
    which = shutil.which("scrcpy")
    candidates: list[str] = []
    if which:
        prefix = os.path.dirname(os.path.dirname(os.path.realpath(which)))
        candidates.append(os.path.join(prefix, "share", "scrcpy", "scrcpy-server"))
        cellar = os.path.join(prefix, "Cellar", "scrcpy")
        candidates.extend(
            sorted(glob.glob(os.path.join(cellar, "*", "share", "scrcpy", "scrcpy-server")))
        )
    candidates.extend(
        [
            "/opt/homebrew/share/scrcpy/scrcpy-server",
            "/usr/local/share/scrcpy/scrcpy-server",
        ]
    )
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def resolve_scrcpy_server_version(scrcpy_bin: str | None = None) -> str:
    """Return version string expected by the server (first argv after main)."""
    bin_path = scrcpy_bin or shutil.which("scrcpy")
    if not bin_path:
        return "4.1"
    try:
        result = subprocess.run(
            [bin_path, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        text = f"{result.stdout}\n{result.stderr}"
        match = re.search(r"scrcpy\s+(\d+\.\d+(?:\.\d+)?)", text, re.I)
        if match:
            return match.group(1)
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "4.1"


def build_scrcpy_server_shell_cmd(
    *,
    adb: str,
    serial: str,
    version: str,
    max_size: int = 1080,
    bit_rate: int = 8_000_000,
    max_fps: int = 60,
    remote_jar: str = "/data/local/tmp/scrcpy-server.jar",
) -> list[str]:
    """adb shell argv that starts scrcpy-server in raw_stream mode (no GUI)."""
    args = (
        f"CLASSPATH={remote_jar} app_process / com.genymobile.scrcpy.Server {version} "
        f"tunnel_forward=true audio=false control=false cleanup=false "
        f"raw_stream=true max_size={max_size} video_bit_rate={bit_rate} max_fps={max_fps}"
    )
    return [adb, "-s", serial, "shell", args]


def annex_b_split_nals(
    data: bytes, *, return_remainder: bool = False
) -> list[NalUnit] | tuple[list[NalUnit], bytes]:
    """Split Annex-B byte stream into NAL units (3- or 4-byte start codes).

    When ``return_remainder`` is True, only NALs bounded by a following start
    code are emitted; bytes from the last start code onward (possibly
    incomplete) are returned as remainder for the next read.
    """
    starts: list[tuple[int, int]] = []
    i = 0
    n = len(data)
    while i + 3 <= n:
        if data[i] == 0 and data[i + 1] == 0:
            if i + 3 < n and data[i + 2] == 0 and data[i + 3] == 1:
                starts.append((i, 4))
                i += 4
                continue
            if data[i + 2] == 1:
                starts.append((i, 3))
                i += 3
                continue
        i += 1

    if not return_remainder:
        units: list[NalUnit] = []
        for idx, (off, sc_len) in enumerate(starts):
            next_off = starts[idx + 1][0] if idx + 1 < len(starts) else n
            nal_bytes = data[off:next_off]
            if len(nal_bytes) <= sc_len:
                continue
            units.append(NalUnit(nal_type=nal_bytes[sc_len] & 0x1F, data=bytes(nal_bytes)))
        return units

    if not starts:
        return [], data
    units = []
    for idx in range(len(starts) - 1):
        off, sc_len = starts[idx]
        next_off = starts[idx + 1][0]
        nal_bytes = data[off:next_off]
        if len(nal_bytes) <= sc_len:
            continue
        units.append(NalUnit(nal_type=nal_bytes[sc_len] & 0x1F, data=bytes(nal_bytes)))
    prefix = data[: starts[0][0]]
    remainder = data[starts[-1][0] :]
    return units, prefix + remainder


def build_ws_nal_message(
    payload: bytes,
    *,
    nal_type: int,
    wall_ms: int,
    is_key: bool,
) -> bytes:
    flags = _FLAG_KEY if is_key else 0
    header = (
        _WS_MAGIC
        + bytes([_WS_VERSION, flags, nal_type & 0xFF, 0, 0, 0])
        + struct.pack(">Q", wall_ms & 0xFFFFFFFFFFFFFFFF)
    )
    return header + payload


def parse_ws_nal_message(message: bytes) -> WsNalParsed:
    if len(message) < 16 or message[:2] != _WS_MAGIC:
        raise ValueError("invalid H.264 WS frame")
    version = message[2]
    if version != _WS_VERSION:
        raise ValueError(f"unsupported WS frame version {version}")
    flags = message[3]
    nal_type = message[4]
    wall_ms = struct.unpack(">Q", message[8:16])[0]
    return {
        "nal_type": nal_type,
        "is_key": bool(flags & _FLAG_KEY),
        "wall_ms": wall_ms,
        "data": message[16:],
    }


def is_key_nal(nal_type: int) -> bool:
    return nal_type in (5, 7, 8)
