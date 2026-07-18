from __future__ import annotations

import logging
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.youtube_auth import TokenError, get_valid_access_token, has_tokens

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/youtube", tags=["youtube"])

YOUTUBE_UPLOAD_INIT_URL = (
    "https://www.googleapis.com/upload/youtube/v3/videos"
    "?uploadType=resumable&part=snippet,status"
)
YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"


class InitiateUploadRequest(BaseModel):
    title: str
    description: str = ""
    privacy_status: Literal["public", "private", "unlisted"] = "unlisted"
    category_id: str = "22"
    tags: list[str] = []
    made_for_kids: bool = False
    contains_synthetic_media: bool = False
    mime_type: str = "video/webm"


@router.post("/initiate-upload")
def initiate_upload(body: InitiateUploadRequest) -> dict[str, str]:
    if not has_tokens():
        raise HTTPException(status_code=401, detail={"error": "YouTube account not connected"})

    try:
        access_token = get_valid_access_token()
    except TokenError as exc:
        raise HTTPException(status_code=401, detail={"error": str(exc)}) from exc

    payload = {
        "snippet": {
            "title": body.title,
            "description": body.description,
            "categoryId": body.category_id,
            "tags": body.tags,
        },
        "status": {
            "privacyStatus": body.privacy_status,
            "selfDeclaredMadeForKids": body.made_for_kids,
            "containsSyntheticMedia": body.contains_synthetic_media,
        },
    }
    headers = {
        "Authorization": f"Bearer {access_token}",
        "X-Upload-Content-Type": body.mime_type or "video/webm",
        "Content-Type": "application/json",
    }

    response = httpx.post(YOUTUBE_UPLOAD_INIT_URL, headers=headers, json=payload, timeout=30.0)
    if response.status_code not in {200, 201}:
        logger.error("Initiate upload failed: %s %s", response.status_code, response.text)
        raise HTTPException(
            status_code=502,
            detail={"error": "Failed to initiate YouTube upload", "details": response.text},
        )

    upload_uri = response.headers.get("Location") or response.headers.get("location")
    if not upload_uri:
        raise HTTPException(status_code=502, detail={"error": "YouTube did not return an upload URI"})

    return {"upload_uri": upload_uri}


@router.post("/upload-chunk")
async def upload_chunk(
    request: Request,
    x_upload_uri: Annotated[str, Header(alias="X-Upload-Uri")],
    x_content_range: Annotated[str, Header(alias="X-Content-Range")],
    x_content_type: Annotated[str, Header(alias="X-Content-Type")] = "application/octet-stream",
) -> StreamingResponse:
    """Proxy a single resumable-upload chunk to YouTube to avoid browser CORS."""
    if not x_upload_uri.startswith("https://"):
        raise HTTPException(status_code=400, detail={"error": "Invalid upload URI"})
    if "googleapis.com" not in x_upload_uri and "googleusercontent.com" not in x_upload_uri:
        raise HTTPException(status_code=400, detail={"error": "Upload URI host is not allowed"})

    # Buffer one chunk (frontend sends ~8MB). Streaming request bodies would force
    # chunked transfer encoding, which YouTube's resumable protocol rejects.
    chunk = await request.body()
    forward_headers: dict[str, str] = {
        "Content-Type": x_content_type or "application/octet-stream",
        "Content-Range": x_content_range,
        "Content-Length": str(len(chunk)),
    }

    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0))
    try:
        yt_request = client.build_request(
            "PUT",
            x_upload_uri,
            headers=forward_headers,
            content=chunk,
        )
        yt_response = await client.send(yt_request, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        logger.error("YouTube chunk upload failed: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "Failed to upload chunk to YouTube"}) from exc

    yt_status = yt_response.status_code
    # Browsers treat HTTP 308 as a redirect; Google uses 308 for "resume incomplete".
    # Surface the real status via header and return 200 so fetch can read the body.
    http_status = 200 if yt_status == 308 else yt_status
    media_type = yt_response.headers.get("content-type")

    async def stream_body():
        try:
            async for part in yt_response.aiter_bytes():
                yield part
        finally:
            await yt_response.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=http_status,
        media_type=media_type,
        headers={
            "X-Youtube-Status": str(yt_status),
            "X-Youtube-Range": yt_response.headers.get("range", ""),
        },
    )


@router.get("/channel")
def channel_info() -> dict[str, str]:
    if not has_tokens():
        raise HTTPException(status_code=401, detail={"error": "YouTube account not connected"})

    try:
        access_token = get_valid_access_token()
    except TokenError as exc:
        raise HTTPException(status_code=401, detail={"error": str(exc)}) from exc

    response = httpx.get(
        YOUTUBE_CHANNELS_URL,
        params={"part": "snippet,statistics", "mine": "true"},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30.0,
    )
    if response.status_code != 200:
        logger.error("Channel lookup failed: %s %s", response.status_code, response.text)
        raise HTTPException(status_code=502, detail={"error": "Failed to fetch YouTube channel"})

    items = response.json().get("items") or []
    if not items:
        raise HTTPException(status_code=404, detail={"error": "No YouTube channel found for this account"})

    item = items[0]
    snippet = item.get("snippet") or {}
    statistics = item.get("statistics") or {}
    thumbnails = snippet.get("thumbnails") or {}
    thumbnail = (
        (thumbnails.get("default") or {}).get("url")
        or (thumbnails.get("medium") or {}).get("url")
        or ""
    )
    channel_id = item.get("id") or ""

    return {
        "channel_id": channel_id,
        "channel_title": snippet.get("title") or "",
        "subscriber_count": str(statistics.get("subscriberCount", "0")),
        "video_count": str(statistics.get("videoCount", "0")),
        "thumbnail_url": thumbnail,
        "subscribe_url": f"https://youtube.com/channel/{channel_id}?sub_confirmation=1",
    }
