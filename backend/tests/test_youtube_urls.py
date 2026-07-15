from app.youtube_urls import is_allowed_youtube_url


def test_allows_watch_url():
    assert is_allowed_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")


def test_allows_youtu_be():
    assert is_allowed_youtube_url("https://youtu.be/dQw4w9WgXcQ")


def test_rejects_non_youtube():
    assert not is_allowed_youtube_url("https://example.com/watch?v=abc")


def test_rejects_javascript():
    assert not is_allowed_youtube_url("javascript:alert(1)")
