from __future__ import annotations

import asyncio
import logging
import queue
import threading

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.device_mirror import DeviceMirrorSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/device", tags=["device"])
session = DeviceMirrorSession()


@router.post("/connect")
def connect() -> dict[str, bool]:
    session.connect_async()
    return {"ok": True}


@router.get("/status")
def status() -> dict:
    return session.get_status()


@router.get("/latency")
def latency() -> dict:
    return session.get_latency()


@router.post("/disconnect")
def disconnect() -> dict[str, bool]:
    session.disconnect()
    return {"ok": True}


@router.post("/refresh-stream")
def refresh_stream() -> dict[str, bool]:
    st = session.get_status()
    if st["state"] != "connected":
        raise HTTPException(
            status_code=409,
            detail={"error": "Device is not connected.", "code": "not_connected"},
        )
    if not session.refresh_stream():
        raise HTTPException(
            status_code=503,
            detail={"error": "Could not refresh device stream.", "code": "refresh_failed"},
        )
    return {"ok": True}


@router.get("/stream")
def stream_removed() -> JSONResponse:
    """Legacy fMP4 endpoint removed — use WebSocket /api/device/ws."""
    return JSONResponse(
        status_code=410,
        content={
            "error": "fMP4 stream removed. Use WebSocket /api/device/ws for H.264.",
            "code": "gone",
        },
    )


@router.websocket("/ws")
async def device_ws(websocket: WebSocket) -> None:
    st = session.get_status()
    if st["state"] != "connected":
        logger.warning("device.ws: reject — state=%s (need connected)", st["state"])
        await websocket.close(code=4409)
        return

    # Subscribe BEFORE accept so a 101 always means the client is counted in
    # broadcast.subscribers (never accept then silently fail to register).
    sub = session.open_h264_subscription()
    logger.info(
        "device.ws: open_h264_subscription returned %s session id=%s",
        type(sub).__name__ if sub is not None else None,
        id(session),
    )
    if sub is None:
        logger.warning("device.ws: reject — open_h264_subscription returned None")
        await websocket.close(code=1013)
        return

    lat = session.get_latency()
    bc = lat.get("broadcast") or {}
    logger.info(
        "device.ws: pre-accept subscribers=%s broadcast_id_stats=%s has_sps=%s has_idr=%s",
        bc.get("subscribers"),
        bc,
        bc.get("has_sps"),
        bc.get("has_idr"),
    )
    if not bc.get("subscribers"):
        logger.error(
            "device.ws: BUG — subscription object exists but subscribers=%s; closing",
            bc.get("subscribers"),
        )
        sub.close()
        await websocket.close(code=1011)
        return

    await websocket.accept()
    await websocket.send_json(
        {
            "type": "hello",
            "codec": "h264",
            "transport": "websocket-h264",
            "deviceAddress": st.get("deviceAddress"),
        }
    )
    logger.info(
        "device.ws: accepted device=%s subscribers=%s",
        st.get("deviceAddress"),
        (session.get_latency().get("broadcast") or {}).get("subscribers"),
    )

    # Thread-safe sync queue — NEVER block the event loop with
    # run_coroutine_threadsafe(...).result() (deadlocks the producer).
    bridge: queue.Queue[bytes | None] = queue.Queue(maxsize=256)
    stop = threading.Event()
    sent = {"n": 0, "bytes": 0}

    def _producer() -> None:
        try:
            logger.info("device.ws: producer start")
            for msg in sub:
                if stop.is_set():
                    break
                try:
                    bridge.put(msg, timeout=5)
                except queue.Full:
                    try:
                        bridge.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        bridge.put_nowait(msg)
                    except queue.Full:
                        logger.warning("device.ws: bridge full — drop frame")
            logger.info("device.ws: producer iter ended (sent_so_far=%s)", sent["n"])
        except Exception:
            logger.exception("device.ws: producer failed")
        finally:
            sub.close()
            try:
                bridge.put_nowait(None)
            except queue.Full:
                try:
                    bridge.put(None, timeout=1)
                except Exception:
                    pass

    thread = threading.Thread(target=_producer, name="device-ws-producer", daemon=True)
    thread.start()

    async def _send_pump() -> str:
        while True:
            msg = await asyncio.to_thread(bridge.get)
            if msg is None:
                return "eof"
            await websocket.send_bytes(msg)
            sent["n"] += 1
            sent["bytes"] += len(msg)
            if sent["n"] == 1 or sent["n"] % 60 == 0:
                logger.info(
                    "device.ws: sent frames=%s bytes=%s last=%s",
                    sent["n"],
                    sent["bytes"],
                    len(msg),
                )

    async def _watch_client() -> str:
        # Without this, a quiet stream leaves the handler blocked on bridge.get
        # after the browser disconnects — subscription never dropped.
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                return "disconnect"

    send_task = asyncio.create_task(_send_pump(), name="device-ws-send")
    watch_task = asyncio.create_task(_watch_client(), name="device-ws-watch")
    try:
        done, pending = await asyncio.wait(
            {send_task, watch_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            try:
                reason = task.result()
            except WebSocketDisconnect:
                reason = "disconnect"
            except Exception:
                logger.exception("device.ws: task failed")
                reason = "error"
            logger.info(
                "device.ws: finished reason=%s frames=%s bytes=%s",
                reason,
                sent["n"],
                sent["bytes"],
            )
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
    finally:
        stop.set()
        sub.close()
        try:
            await websocket.close()
        except Exception:
            pass
