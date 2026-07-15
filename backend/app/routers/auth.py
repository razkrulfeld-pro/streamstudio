from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.youtube_auth import (
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI,
    TOKEN_URL,
    clear_tokens,
    has_tokens,
    save_tokens,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

SCOPES = " ".join(
    [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "openid",
        "email",
        "profile",
    ]
)


@router.get("/google")
def google_auth_url() -> dict[str, str]:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail={"error": "GOOGLE_CLIENT_ID is not configured"})

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
    }
    return {"auth_url": f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"}


@router.get("/callback")
def google_callback(code: str = Query(...)) -> dict[str, object]:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail={"error": "Google OAuth client is not configured"})

    response = httpx.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=30.0,
    )
    logger.error("Token exchange response: status=%s body=%s", response.status_code, response.text)
    if response.status_code != 200:
        logger.error("OAuth token exchange failed: %s %s", response.status_code, response.text)
        raise HTTPException(status_code=400, detail={"error": "Failed to exchange authorization code"})

    data = response.json()
    access_token = data.get("access_token")
    refresh_token = data.get("refresh_token")
    expires_in = int(data.get("expires_in", 3600))
    if not access_token or not refresh_token:
        raise HTTPException(
            status_code=400,
            detail={"error": "Token response missing access_token or refresh_token"},
        )

    expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    try:
        save_tokens(access_token, refresh_token, expiry)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc

    return {"success": True, "message": "YouTube account connected"}


@router.get("/status")
def auth_status() -> dict[str, bool]:
    return {"connected": has_tokens()}


@router.post("/logout")
def logout() -> dict[str, bool]:
    clear_tokens()
    return {"success": True}
# debug - remove later
