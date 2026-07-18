from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.device_mirror import DeviceMirrorSession

router = APIRouter(prefix="/api/device", tags=["device"])
session = DeviceMirrorSession()


@router.post("/connect")
def connect() -> dict[str, bool]:
    session.connect_async()
    return {"ok": True}


@router.get("/status")
def status() -> dict:
    return session.get_status()


@router.post("/disconnect")
def disconnect() -> dict[str, bool]:
    session.disconnect()
    return {"ok": True}


@router.get("/stream")
def stream() -> StreamingResponse:
    st = session.get_status()
    if st["state"] != "connected":
        raise HTTPException(
            status_code=409,
            detail={"error": "Device is not connected.", "code": "not_connected"},
        )
    return StreamingResponse(session.iter_stream(), media_type="video/mp4")
