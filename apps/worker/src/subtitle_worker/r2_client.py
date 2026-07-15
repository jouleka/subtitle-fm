"""Cloudflare R2 (S3-compatible) client + per-stage key helpers.

Mirrors `apps/api/src/lib/r2.ts`:
- Lazy-init so missing env vars don't crash on module load.
- Account-scoped endpoint URL `https://{ACCOUNT_ID}.r2.cloudflarestorage.com`.
- region=auto, no path-style addressing (R2 supports virtual-hosted).

Keys: per-stage artifacts use a stable `stage/{stage}/{episodeId}.{ext}`
shape so retrying a stage overwrites its previous output rather than
leaking new objects on every retry.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client
else:
    S3Client = object  # type: ignore[assignment,misc]

DEFAULT_BUCKET_MEDIA = "subtitle-fm-media"
DEFAULT_BUCKET_PEAKS = "subtitle-fm-peaks"


class R2NotConfigured(RuntimeError):
    """Raised when required R2 env vars are missing."""


_cached_client: object | None = None


def _resolve_creds() -> tuple[str, str, str]:
    account_id = os.environ.get("R2_ACCOUNT_ID", "")
    access_key_id = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    if not (account_id and access_key_id and secret_access_key):
        raise R2NotConfigured(
            "R2 not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
        )
    return account_id, access_key_id, secret_access_key


def get_client() -> S3Client:
    """Return a process-wide boto3 S3 client pointed at R2.

    Lazy import of boto3 so the module loads in environments that haven't
    installed it (e.g., a partial pip install for local stage-only dev).
    """
    global _cached_client
    if _cached_client is not None:
        return _cached_client  # type: ignore[return-value]

    import boto3
    from botocore.config import Config

    account_id, access_key_id, secret_access_key = _resolve_creds()
    _cached_client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="auto",
        config=Config(s3={"addressing_style": "virtual"}),
    )
    return _cached_client  # type: ignore[return-value]


def media_bucket() -> str:
    return os.environ.get("R2_BUCKET_MEDIA", DEFAULT_BUCKET_MEDIA)


def peaks_bucket() -> str:
    return os.environ.get("R2_BUCKET_PEAKS", DEFAULT_BUCKET_PEAKS)


def derive_stage_artifact_key(episode_id: str, stage: str, ext: str) -> str:
    """`stage/<stage>/<episodeId>.<ext>` — stable per (episode, stage).

    Stable so a stage retry overwrites the previous output cleanly instead
    of leaking a new object per attempt. If you ever need attempt-isolated
    keys (e.g., for debugging a flaky stage), namespace under a
    pipelineRunId in the key path.

    Validates inputs so a malformed episode_id or stage can't path-traverse
    into another prefix.
    """
    if not episode_id or "/" in episode_id or ".." in episode_id:
        raise ValueError(f"invalid episode_id: {episode_id!r}")
    if not stage or "/" in stage:
        raise ValueError(f"invalid stage: {stage!r}")
    if not ext or "/" in ext or "." in ext:
        raise ValueError(f"invalid ext: {ext!r}")
    return f"stage/{stage}/{episode_id}.{ext}"


def derive_episode_peaks_key(episode_id: str) -> str:
    """Stable waveform key so retrying preprocessing overwrites the object."""
    if not episode_id or "/" in episode_id or ".." in episode_id:
        raise ValueError(f"invalid episode_id: {episode_id!r}")
    return f"{episode_id}.dat"


def upload_file(local_path: Path, bucket: str, key: str) -> None:
    """Upload a local file to R2 at `bucket/key`. Raises on failure."""
    get_client().upload_file(str(local_path), bucket, key)


def download_to_file(bucket: str, key: str, local_path: Path) -> None:
    """Download `bucket/key` from R2 to `local_path`. Raises on failure."""
    local_path.parent.mkdir(parents=True, exist_ok=True)
    get_client().download_file(bucket, key, str(local_path))
