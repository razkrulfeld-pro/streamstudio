from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_status_idle():
    r = client.get("/api/device/status")
    assert r.status_code == 200
    assert r.json()["state"] == "idle"


def test_stream_not_connected():
    r = client.get("/api/device/stream")
    assert r.status_code == 409
