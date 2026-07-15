from __future__ import annotations

import shutil
import tempfile
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import Settings


class StoredAudio(ABC):
    @abstractmethod
    def put(self, local_path: Path, content_type: str, extension: str) -> tuple[str, datetime]:
        """Store file; return (public_or_signed_url, expires_at)."""


class LocalTempStorage(StoredAudio):
    """Dev-only: files under a temp directory, served by the API. Not for public prod."""

    def __init__(self, settings: Settings) -> None:
        self._root = Path(settings.local_temp_dir)
        self._root.mkdir(parents=True, exist_ok=True)
        self._base = settings.public_base_url.rstrip("/")
        self._ttl = settings.signed_url_ttl_seconds

    def put(self, local_path: Path, content_type: str, extension: str) -> tuple[str, datetime]:
        del content_type  # tracked by filename for local serving
        token = uuid.uuid4().hex
        dest = self._root / f"{token}.{extension.lstrip('.')}"
        shutil.copy2(local_path, dest)
        expires = datetime.now(timezone.utc) + timedelta(seconds=self._ttl)
        # Expiry embedded in query for client; server still serves until deleted.
        url = f"{self._base}/media/{dest.name}?expires={int(expires.timestamp())}"
        return url, expires

    def resolve(self, name: str) -> Path | None:
        safe = Path(name).name
        path = self._root / safe
        if not path.is_file():
            return None
        return path


class GcsSignedUrlStorage(StoredAudio):
    """Production: upload to GCS and return a short-lived signed URL."""

    def __init__(self, settings: Settings) -> None:
        if not settings.gcs_bucket:
            raise RuntimeError("GCS_BUCKET is required when STORAGE_BACKEND=gcs")
        self._bucket_name = settings.gcs_bucket
        self._ttl = settings.signed_url_ttl_seconds

    def put(self, local_path: Path, content_type: str, extension: str) -> tuple[str, datetime]:
        try:
            from google.cloud import storage  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "google-cloud-storage is required for STORAGE_BACKEND=gcs",
            ) from exc

        client = storage.Client()
        bucket = client.bucket(self._bucket_name)
        blob_name = f"extracts/{uuid.uuid4().hex}.{extension.lstrip('.')}"
        blob = bucket.blob(blob_name)
        blob.upload_from_filename(str(local_path), content_type=content_type)
        expires = datetime.now(timezone.utc) + timedelta(seconds=self._ttl)
        url = blob.generate_signed_url(expiration=expires, method="GET")
        return url, expires


def create_storage(settings: Settings) -> StoredAudio:
    backend = settings.storage_backend.lower().strip()
    if backend == "gcs":
        return GcsSignedUrlStorage(settings)
    return LocalTempStorage(settings)


def make_work_dir(prefix: str = "extract-") -> tempfile.TemporaryDirectory[str]:
    return tempfile.TemporaryDirectory(prefix=prefix)
