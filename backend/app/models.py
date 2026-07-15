from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ExtractRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    startTimeSeconds: float = Field(ge=0, default=0)
    durationSeconds: float = Field(ge=1, le=60)

    @field_validator("url")
    @classmethod
    def strip_url(cls, value: str) -> str:
        return value.strip()


class ExtractResponse(BaseModel):
    audioUrl: str
    durationSeconds: float
    format: Literal["m4a", "mp3"]
    expiresAt: str


class ErrorBody(BaseModel):
    error: str
    code: str
