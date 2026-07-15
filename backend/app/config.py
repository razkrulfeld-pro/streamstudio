from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "streaming-app-audio-extract"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    storage_backend: str = "local"  # local | gcs
    local_temp_dir: str = "/tmp/streaming-app-audio"
    public_base_url: str = "http://127.0.0.1:8080"
    gcs_bucket: str = ""
    signed_url_ttl_seconds: int = 3600
    extract_timeout_seconds: int = 120
    max_work_dir_bytes: int = 200 * 1024 * 1024
    rate_limit_per_minute: int = 10
    port: int = 8080

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
