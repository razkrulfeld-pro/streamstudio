# Audio extract API (Cloud Run)

Extracts a ≤60s **audio-only** clip from a YouTube URL. Never returns or permanently stores video.

## Local run

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install yt-dlp
# System deps: ffmpeg + ffprobe on PATH
cp .env.example .env
uvicorn app.main:app --reload --port 8080
```

Health: `GET /health`  
Extract: `POST /api/extract` with JSON `{ "url", "startTimeSeconds", "durationSeconds" }` (duration 1–60).

Dev storage serves files at `GET /media/{name}`. Do **not** use local temp storage in public production — set `STORAGE_BACKEND=gcs` and `GCS_BUCKET`, and install `google-cloud-storage`.

## Docker / Cloud Run

```bash
docker build -t streaming-audio-extract .
docker run --rm -p 8080:8080 -e CORS_ORIGINS=https://your-netlify-site.netlify.app streaming-audio-extract
```

Suggested Cloud Run: max instances capped, concurrency modest (e.g. 1–4), min instances 0, request timeout ≥ extract timeout. Set GCP budget alerts. Configure bucket lifecycle to delete objects ≤ 24h.

## Honesty notes

- Section/range extraction is best-effort; some sources download more than 60s of media before ffmpeg trims.
- Output prefers M4A/AAC; MP3 only if AAC encode fails.
- CORS alone is not security — rate limiting is enabled; add Turnstile or auth before public traffic (Phase G).
