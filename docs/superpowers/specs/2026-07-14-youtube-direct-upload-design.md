# YouTube Direct Upload — Design

**Date:** 2026-07-14  
**Status:** Approved (Option A)

## Goal

Publish a recorded video Blob from the browser directly to the user's YouTube channel with zero server-side video storage. FastAPI only handles OAuth token exchange/refresh and initiating YouTube resumable uploads.

## Architecture

1. User connects YouTube via Google OAuth (`access_type=offline`, `prompt=consent`).
2. Backend stores tokens in a local JSON file (`TOKEN_STORE_PATH`).
3. On Publish, backend obtains a resumable `upload_uri`; the browser PUTs 8MB chunks straight to Google.
4. Single-user personal app — no multi-user auth.

## Backend (FastAPI :8080)

- `app/youtube_auth.py` — load/save/refresh tokens
- `app/routers/auth.py` — `/auth/google`, `/auth/callback`, `/auth/status`, `/auth/logout`
- `app/routers/youtube.py` — `/youtube/initiate-upload`, `/youtube/channel`
- CORS includes `http://localhost:5173` and `http://127.0.0.1:5173`
- `GOOGLE_CLIENT_SECRET` never exposed to the frontend

## Frontend (Vite :5173)

- `VITE_API_BASE_URL=http://localhost:8080`
- API client + chunked upload helper + `usePublish`
- Real OAuth in existing `YoutubeSettingsSection`
- `/auth/callback` page forwards `code` to FastAPI
- Editor Publish uses modal + real upload of recording `videoBlob`
- No second IndexedDB draft store (reuse `streamstudio-recordings`)

## Out of scope

- Cloud Run token store migration (Secret Manager / Firestore)
- Server-side remux / FFmpeg
- Multi-user auth
