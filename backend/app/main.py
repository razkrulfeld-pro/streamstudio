from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from app.config import get_settings
from app.extract import ExtractError, extract_youtube_audio
from app.models import ErrorBody, ExtractRequest, ExtractResponse
from app.routers import auth as auth_router
from app.routers import youtube as youtube_router
from app.storage import LocalTempStorage, create_storage
from app.youtube_urls import is_allowed_youtube_url

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()
app = FastAPI(title=settings.app_name)
storage = create_storage(settings)

# Ensure local Vite + production Netlify origins are always allowed.
_cors_origins = list(
    dict.fromkeys(
        [
            *settings.cors_origin_list,
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "https://streamstudioapp.netlify.app",
        ]
    )
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Youtube-Status", "X-Youtube-Range"],
)

app.include_router(auth_router.router)
app.include_router(youtube_router.router)

_rate_lock = Lock()
_rate_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _check_rate_limit(request: Request) -> None:
    limit = settings.rate_limit_per_minute
    if limit <= 0:
        return
    now = time.time()
    ip = _client_ip(request)
    with _rate_lock:
        hits = _rate_hits[ip]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again shortly.")
        hits.append(now)


@app.get("/", response_class=HTMLResponse)
def root() -> str:
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Audio extract API</title></head>
<body style="font-family:system-ui;max-width:36rem;margin:3rem auto;line-height:1.5">
  <h1>Audio extract API</h1>
  <p>This is the backend only (port <strong>8080</strong>). The Streaming App UI is not served here.</p>
  <p>Open the app at <a href="http://127.0.0.1:5173/">http://127.0.0.1:5173/</a> (Vite).</p>
  <p>Health: <a href="/health">/health</a></p>
</body></html>"""


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/extract", response_model=ExtractResponse)
def extract(body: ExtractRequest, request: Request) -> ExtractResponse:
    _check_rate_limit(request)

    if not is_allowed_youtube_url(body.url):
        raise HTTPException(
            status_code=400,
            detail=ErrorBody(
                error="Only YouTube watch/shorts URLs are supported.",
                code="invalid_url",
            ).model_dump(),
        )

    try:
        audio_url, duration, fmt, expires = extract_youtube_audio(
            url=body.url,
            start_time_seconds=body.startTimeSeconds,
            duration_seconds=body.durationSeconds,
            settings=settings,
            storage=storage,
        )
    except ExtractError as exc:
        status = 504 if exc.code == "timeout" else 422 if exc.code in {"too_large"} else 502
        raise HTTPException(
            status_code=status,
            detail=ErrorBody(error=str(exc), code=exc.code).model_dump(),
        ) from exc
    except Exception:
        logger.exception("Unexpected extract failure")
        raise HTTPException(
            status_code=500,
            detail=ErrorBody(error="Unexpected server error.", code="server_error").model_dump(),
        ) from None

    return ExtractResponse(
        audioUrl=audio_url,
        durationSeconds=duration,
        format=fmt,  # type: ignore[arg-type]
        expiresAt=expires,
    )


@app.get("/media/{name}")
def media(name: str) -> FileResponse:
    if settings.storage_backend.lower() != "local":
        raise HTTPException(status_code=404, detail="Not found")
    if not isinstance(storage, LocalTempStorage):
        raise HTTPException(status_code=404, detail="Not found")
    path = storage.resolve(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    suffix = path.suffix.lower()
    media_type = "audio/mpeg" if suffix == ".mp3" else "audio/mp4"
    return FileResponse(path, media_type=media_type, filename=path.name)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict):
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorBody(error=str(detail), code="http_error").model_dump(),
    )
