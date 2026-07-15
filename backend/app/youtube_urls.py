from urllib.parse import urlparse

ALLOWED_YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


def is_allowed_youtube_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False

    if parsed.scheme not in {"http", "https"}:
        return False

    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_YOUTUBE_HOSTS:
        return False

    if host in {"youtu.be", "www.youtu.be"}:
        return bool(parsed.path.strip("/"))

    path = parsed.path.lower()
    return path.startswith("/watch") or path.startswith("/shorts/") or path.startswith("/live/")
