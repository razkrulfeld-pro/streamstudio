# Streaming App

Vite + React editor. Frontend deploys as a static SPA (Netlify). YouTube audio extract runs on a separate Cloud Run service (`backend/`).

## Frontend

```bash
npm install
cp .env.example .env   # set VITE_AUDIO_API_URL to your extract API
npm run dev
```

## Audio extract API

See [`backend/README.md`](backend/README.md). Local: uvicorn on port 8080. Production: Cloud Run with `STORAGE_BACKEND=gcs`, rate limits, and budget alerts.

## Inserted audio (v1)

- Paste a YouTube URL or upload a local audio file (≤60s).
- Preview with audio-only controls; place on the CapCut timeline.
- Blob + metadata stored in IndexedDB with the draft (restored on reopen).
- YouTube **video** is never previewed, returned, or stored.
- Publish does **not** bake inserted audio into a new video file in v1.
