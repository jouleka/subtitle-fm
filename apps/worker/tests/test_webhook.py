"""Tests for the webhook signing + POST helper.

Cross-language compatibility note: the TS api at apps/api/src/lib/hmac.ts
verifies these signatures. The `test_signature_matches_ts_implementation`
test pins the exact hex value Node's createHmac produces for the same
(secret, body) pair so a drift in either side is caught here.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from subtitle_worker.webhook import (
    SIGNATURE_HEADER,
    post_signed_json,
    sign_sha256,
)

SECRET = "test-secret-do-not-use-in-prod"
BODY = b'{"eventId":"abc","episodeId":"a3f4"}'

# Pre-computed with Bun:
#   bun -e 'import {createHmac} from "node:crypto"; \
#     console.log(createHmac("sha256", "test-secret-do-not-use-in-prod") \
#       .update("{\"eventId\":\"abc\",\"episodeId\":\"a3f4\"}").digest("hex"))'
EXPECTED_HEX = "c2e811da0b548b8d69fea39e81f8ff2e7ee907b2a70177107ccaf8c34fd20258"


class TestSignSha256:
    def test_returns_sha256_prefixed_lowercase_hex(self) -> None:
        sig = sign_sha256(BODY, SECRET)
        assert sig.startswith("sha256=")
        hex_part = sig.removeprefix("sha256=")
        assert len(hex_part) == 64
        assert all(c in "0123456789abcdef" for c in hex_part)

    def test_signature_matches_ts_implementation(self) -> None:
        # Pinning the EXACT hex so a drift in either Python or TS HMAC
        # behavior is caught here. Cross-language compatibility is the
        # whole point of this module.
        assert sign_sha256(BODY, SECRET) == f"sha256={EXPECTED_HEX}"

    def test_different_body_produces_different_signature(self) -> None:
        a = sign_sha256(BODY, SECRET)
        b = sign_sha256(BODY + b" ", SECRET)
        assert a != b

    def test_different_secret_produces_different_signature(self) -> None:
        a = sign_sha256(BODY, SECRET)
        b = sign_sha256(BODY, SECRET + "x")
        assert a != b

    def test_raises_on_empty_secret(self) -> None:
        # Rule 12 fail loud: signing with "" produces a deterministic
        # signature with no security value. Reject at the boundary so a
        # missing env var doesn't silently leak through.
        with pytest.raises(ValueError, match="empty"):
            sign_sha256(BODY, "")


class _CapturingTransport(httpx.BaseTransport):
    """Records the last request; returns a configurable canned response."""

    def __init__(self, status: int = 200, body: bytes = b'{"ok":true}') -> None:
        self.status = status
        self.body = body
        self.last_request: httpx.Request | None = None

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.last_request = request
        return httpx.Response(self.status, content=self.body)


def _build_client(transport: _CapturingTransport) -> httpx.Client:
    return httpx.Client(transport=transport)


class TestPostSignedJson:
    def _payload(self) -> dict[str, Any]:
        return {
            "eventId": "ep-1:preprocess:run-1",
            "episodeId": "ep-1",
            "pipelineRunId": "run-1",
            "stage": "preprocess",
            "status": "completed",
            "output": {"audioKey": "stage/preprocess/ep-1.wav"},
        }

    def test_sends_body_and_signature_header(self) -> None:
        transport = _CapturingTransport()
        client = _build_client(transport)
        post_signed_json(
            "https://api.example/webhooks/runpod",
            self._payload(),
            SECRET,
            client=client,
        )
        req = transport.last_request
        assert req is not None
        assert req.method == "POST"
        assert SIGNATURE_HEADER in req.headers
        sent_sig = req.headers[SIGNATURE_HEADER]
        # The signature must verify against THE BYTES WE SENT — that's the
        # whole contract. Recompute and compare.
        assert sent_sig == sign_sha256(req.content, SECRET)
        # JSON payload survives the round trip.
        assert json.loads(req.content) == self._payload()

    def test_content_type_is_json(self) -> None:
        transport = _CapturingTransport()
        client = _build_client(transport)
        post_signed_json(
            "https://api.example/webhooks/runpod",
            self._payload(),
            SECRET,
            client=client,
        )
        assert transport.last_request is not None
        assert transport.last_request.headers["Content-Type"] == "application/json"

    def test_raises_on_non_2xx(self) -> None:
        transport = _CapturingTransport(status=401, body=b'{"error":"bad_signature"}')
        client = _build_client(transport)
        with pytest.raises(httpx.HTTPStatusError):
            post_signed_json(
                "https://api.example/webhooks/runpod",
                self._payload(),
                SECRET,
                client=client,
            )

    def test_serializes_non_ascii_payload_correctly(self) -> None:
        # Anime names contain non-ASCII; the signature must be computed on
        # the EXACT bytes sent (utf-8 of the JSON, with ensure_ascii=False).
        transport = _CapturingTransport()
        client = _build_client(transport)
        payload = {**self._payload(), "error": "クラッシュ"}
        post_signed_json(
            "https://api.example/webhooks/runpod", payload, SECRET, client=client
        )
        req = transport.last_request
        assert req is not None
        assert "クラッシュ".encode() in req.content
        assert req.headers[SIGNATURE_HEADER] == sign_sha256(req.content, SECRET)
