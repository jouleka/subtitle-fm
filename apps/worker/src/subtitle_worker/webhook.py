"""HMAC-SHA256 signed callbacks to the api's /webhooks/runpod receiver.

The signature contract matches apps/api/src/lib/hmac.ts exactly: the api
computes `sha256=<hex>` of the raw request body and timing-safe compares
against the `X-Signature-256` header. We produce the same hex over the same
bytes, send those bytes verbatim as the request body, and the round trip
verifies cleanly.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)

SIGNATURE_HEADER = "X-Signature-256"


def sign_sha256(body: bytes, secret: str) -> str:
    """Return the `sha256=<hex>` header value for a request body.

    Fails loud on an empty secret — silently signing with `""` would produce
    a deterministic-but-useless signature the api would never validate.
    """
    if not secret:
        raise ValueError("webhook secret is empty; refusing to sign")
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def post_signed_json(
    url: str,
    payload: dict[str, Any],
    secret: str,
    *,
    timeout_sec: float = 30.0,
    client: httpx.Client | None = None,
) -> httpx.Response:
    """POST `payload` as JSON to `url`, signed with `secret`.

    Returns the httpx Response on 2xx. Raises `httpx.HTTPStatusError` on
    non-2xx so the caller can decide whether to retry — RunPod will retry
    the whole invocation on failure, which is the desired behaviour for
    transient network errors.

    Pass `client` to inject a test stub. The body is serialized once and
    signed; we send the exact same bytes so the api's HMAC verify on the
    raw-text body succeeds.
    """
    # `ensure_ascii=False` + UTF-8 encode matches Hono's `c.req.text()` UTF-8
    # decoding on the api side, so the bytes we sign here are byte-identical
    # to the bytes verifyHmacSha256() will recompute over. Do NOT switch
    # serializers (e.g. orjson with `OPT_NON_STR_KEYS`) without re-checking
    # round-trip equivalence with the api's HMAC verifier.
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sig = sign_sha256(body, secret)
    log.info(
        "webhook.post.start",
        url=url,
        event_id=payload.get("eventId"),
        stage=payload.get("stage"),
        status=payload.get("status"),
        bytes=len(body),
    )
    owned_client = client is None
    http = client if client is not None else httpx.Client(timeout=timeout_sec)
    try:
        resp = http.post(
            url,
            content=body,
            headers={
                "Content-Type": "application/json",
                SIGNATURE_HEADER: sig,
            },
        )
        resp.raise_for_status()
        log.info("webhook.post.done", url=url, status_code=resp.status_code)
        return resp
    finally:
        if owned_client:
            http.close()
