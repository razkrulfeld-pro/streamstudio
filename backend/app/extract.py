from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from app.config import Settings
from app.storage import StoredAudio, make_work_dir

logger = logging.getLogger(__name__)


class ExtractError(Exception):
    def __init__(self, message: str, code: str = "extract_failed") -> None:
        super().__init__(message)
        self.code = code


def _run(cmd: list[str], timeout: int, cwd: Path | None = None) -> None:
    logger.info("Running: %s", " ".join(cmd))
    try:
        completed = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd) if cwd else None,
        )
    except subprocess.TimeoutExpired as exc:
        raise ExtractError("Audio extraction timed out.", "timeout") from exc
    except FileNotFoundError as exc:
        raise ExtractError(f"Required binary missing: {cmd[0]}", "dependency") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "").strip()
        logger.error("Command failed (%s): %s", cmd[0], stderr[-2000:])
        raise ExtractError(
            "Failed to extract audio from this URL. Try another source or upload a file.",
            "extract_failed",
        )


def _ffprobe_duration(path: Path, timeout: int) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        completed = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 0.0
    if completed.returncode != 0:
        return 0.0
    try:
        return max(0.0, float((completed.stdout or "").strip()))
    except ValueError:
        return 0.0


def _dir_size(path: Path) -> int:
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def _pick_output(work: Path) -> Path | None:
    candidates = sorted(work.glob("*"))
    audio = [
        path
        for path in candidates
        if path.is_file()
        and path.suffix.lower() in {".m4a", ".mp3", ".aac", ".webm", ".opus", ".ogg", ".wav"}
    ]
    if audio:
        return audio[0]
    files = [path for path in candidates if path.is_file()]
    return files[0] if files else None


def _encode_clip(
    src: Path,
    dest: Path,
    *,
    seek_seconds: float,
    duration: float,
    codec: str,
    timeout: int,
) -> None:
    cmd = ["ffmpeg", "-y"]
    if seek_seconds > 0:
        cmd.extend(["-ss", str(seek_seconds)])
    cmd.extend(
        [
            "-i",
            str(src),
            "-t",
            str(duration),
            "-vn",
            "-c:a",
            codec,
            "-b:a",
            "192k",
            str(dest),
        ],
    )
    _run(cmd, timeout=timeout)


def extract_youtube_audio(
    *,
    url: str,
    start_time_seconds: float,
    duration_seconds: float,
    settings: Settings,
    storage: StoredAudio,
) -> tuple[str, float, str, str]:
    """
    Extract an audio-only clip. Never returns video content.
    Uses yt-dlp section download when supported; always cleans up work files.
    Returns (audio_url, duration, format, expires_at_iso).
    """
    timeout = settings.extract_timeout_seconds
    start = max(0.0, float(start_time_seconds))
    duration = min(60.0, max(1.0, float(duration_seconds)))
    end = start + duration
    section = f"*{start}-{end}"

    with make_work_dir() as work_name:
        work = Path(work_name)
        out_template = str(work / "clip.%(ext)s")
        used_section = True

        ytdlp_section = [
            "yt-dlp",
            "--no-playlist",
            "--no-warnings",
            "-f",
            "bestaudio/best",
            "--extract-audio",
            "--audio-format",
            "m4a",
            "--audio-quality",
            "0",
            "--download-sections",
            section,
            "--force-keyframes-at-cuts",
            "-o",
            out_template,
            "--",
            url,
        ]

        try:
            _run(ytdlp_section, timeout=timeout, cwd=work)
        except ExtractError:
            used_section = False
            for child in work.iterdir():
                if child.is_file():
                    child.unlink(missing_ok=True)
            ytdlp_full = [
                "yt-dlp",
                "--no-playlist",
                "--no-warnings",
                "-f",
                "bestaudio/best",
                "--extract-audio",
                "--audio-format",
                "m4a",
                "--audio-quality",
                "0",
                "-o",
                out_template,
                "--",
                url,
            ]
            _run(ytdlp_full, timeout=timeout, cwd=work)

        if _dir_size(work) > settings.max_work_dir_bytes:
            raise ExtractError("Downloaded media exceeded size limit.", "too_large")

        raw = _pick_output(work)
        if raw is None:
            raise ExtractError("No audio produced from this URL.", "extract_failed")

        # Section downloads are already windowed → seek 0. Full-source fallback seeks `start`.
        seek = 0.0 if used_section else start
        final_path = work / "trimmed.m4a"
        final_format = "m4a"
        content_type = "audio/mp4"

        try:
            _encode_clip(
                raw,
                final_path,
                seek_seconds=seek,
                duration=duration,
                codec="aac",
                timeout=timeout,
            )
            if not final_path.is_file() or final_path.stat().st_size == 0:
                raise ExtractError("Empty AAC output.", "transcode")
        except ExtractError:
            final_path = work / "trimmed.mp3"
            final_format = "mp3"
            content_type = "audio/mpeg"
            _encode_clip(
                raw,
                final_path,
                seek_seconds=seek,
                duration=duration,
                codec="libmp3lame",
                timeout=timeout,
            )
            if not final_path.is_file() or final_path.stat().st_size == 0:
                raise ExtractError("Could not encode audio as M4A or MP3.", "transcode")

        measured = _ffprobe_duration(final_path, timeout=min(30, timeout))
        out_duration = measured if measured > 0 else duration
        out_duration = min(60.0, out_duration)

        audio_url, expires = storage.put(final_path, content_type, final_format)
        return audio_url, out_duration, final_format, expires.isoformat()
