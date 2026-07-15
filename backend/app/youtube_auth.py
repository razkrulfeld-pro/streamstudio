from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.getenv("REDIRECT_URI", "http://localhost:5173/auth/callback")
TOKEN_STORE_PATH = Path(os.getenv("TOKEN_STORE_PATH", "./tokens.json"))
if not TOKEN_STORE_PATH.is_absolute():
    TOKEN_STORE_PATH = (_BACKEND_DIR / TOKEN_STORE_PATH).resolve()

TOKEN_URL = "https://oauth2.googleapis.com/token"
EXPIRY_SKEW_SECONDS = 60


def save_tokens(access_token: str, refresh_token: str | None, expiry: str | float | datetime) -> None:
    existing = load_tokens() or {}
    expiry_iso = _normalize_expiry(expiry)

    payload: dict[str, Any] = {
        "access_token": access_token,
        "refresh_token": refresh_token or existing.get("refresh_token"),
        "expiry": expiry_iso,
    }
    if not payload["refresh_token"]:
        raise ValueError("No refresh_token available to store.")

    TOKEN_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_STORE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_tokens() -> dict[str, Any] | None:
    if not TOKEN_STORE_PATH.exists():
        return None
    try:
        data = json.loads(TOKEN_STORE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.exception("Failed to read token store at %s", TOKEN_STORE_PATH)
        return None
    if not isinstance(data, dict):
        return None
    return data


def has_tokens() -> bool:
    tokens = load_tokens()
    return bool(tokens and tokens.get("refresh_token"))


def clear_tokens() -> None:
    if TOKEN_STORE_PATH.exists():
        TOKEN_STORE_PATH.unlink()


def get_valid_access_token() -> str:
    tokens = load_tokens()
    if not tokens or not tokens.get("refresh_token"):
        raise TokenError("YouTube account not connected")

    access_token = tokens.get("access_token")
    expiry = tokens.get("expiry")
    if access_token and expiry and not _is_expired(expiry):
        return str(access_token)

    refreshed = _refresh_access_token(str(tokens["refresh_token"]))
    new_access = refreshed["access_token"]
    expires_in = int(refreshed.get("expires_in", 3600))
    new_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    # Google may omit refresh_token on refresh; keep the existing one.
    save_tokens(new_access, tokens.get("refresh_token"), new_expiry)
    return new_access


class TokenError(Exception):
    pass


def _refresh_access_token(refresh_token: str) -> dict[str, Any]:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise TokenError("Google OAuth client is not configured")

    response = httpx.post(
        TOKEN_URL,
        data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=30.0,
    )
    if response.status_code != 200:
        logger.error("Token refresh failed: %s %s", response.status_code, response.text)
        raise TokenError("Failed to refresh YouTube access token")
    return response.json()


def _normalize_expiry(expiry: str | float | datetime) -> str:
    if isinstance(expiry, datetime):
        dt = expiry if expiry.tzinfo else expiry.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    if isinstance(expiry, (int, float)):
        return datetime.fromtimestamp(float(expiry), tz=timezone.utc).isoformat()
    return str(expiry)


def _is_expired(expiry: str | float) -> bool:
    try:
        if isinstance(expiry, (int, float)):
            expiry_dt = datetime.fromtimestamp(float(expiry), tz=timezone.utc)
        else:
            expiry_dt = datetime.fromisoformat(str(expiry).replace("Z", "+00:00"))
            if expiry_dt.tzinfo is None:
                expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return datetime.now(timezone.utc) >= expiry_dt - timedelta(seconds=EXPIRY_SKEW_SECONDS)
