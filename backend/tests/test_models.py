import pytest
from pydantic import ValidationError

from app.models import ExtractRequest


def test_duration_max_60():
    with pytest.raises(ValidationError):
        ExtractRequest(url="https://www.youtube.com/watch?v=abc12345", startTimeSeconds=0, durationSeconds=61)


def test_duration_min_1():
    with pytest.raises(ValidationError):
        ExtractRequest(url="https://www.youtube.com/watch?v=abc12345", startTimeSeconds=0, durationSeconds=0.5)


def test_valid_request():
    body = ExtractRequest(
        url="https://www.youtube.com/watch?v=abc12345",
        startTimeSeconds=10,
        durationSeconds=30,
    )
    assert body.durationSeconds == 30
