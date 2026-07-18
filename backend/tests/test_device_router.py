from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_status_idle():
    r = client.get("/api/device/status")
    assert r.status_code == 200
    assert r.json()["state"] == "idle"


def test_legacy_fmp4_stream_gone():
    r = client.get("/api/device/stream")
    assert r.status_code == 410
    assert r.json()["code"] == "gone"


def test_refresh_stream_not_connected():
    r = client.post("/api/device/refresh-stream")
    assert r.status_code == 409


def test_latency_idle():
    r = client.get("/api/device/latency")
    assert r.status_code == 200
    body = r.json()
    assert body["transport"] == "websocket-h264"
    assert body["state"] == "idle"
