"""Runtime settings, loaded from env."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgres://user:pass@localhost:5432/subtitle_fm"

    # faster-whisper needs a CTranslate2-format model. `large-v3` is pulled
    # ready-made. The intended `litagin/anime-whisper` is a transformers
    # checkpoint and must first be converted with `ct2-transformers-converter`
    # (see stages/asr.py) and pointed at via ASR_MODEL=<ct2-dir>.
    asr_model: str = "large-v3"
    asr_compute_type: str = "float16"
    asr_device: str = "cuda"

    demucs_model: str = "htdemucs"

    anthropic_api_key: str = ""
    translation_model: str = "claude-sonnet-4-6"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_media: str = "subtitle-fm-media"
    r2_bucket_peaks: str = "subtitle-fm-peaks"

    api_public_url: str = "http://localhost:3000"
    worker_webhook_secret: str = ""


settings = Settings()
