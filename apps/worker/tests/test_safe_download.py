from __future__ import annotations

import socket
from pathlib import Path
from typing import ClassVar

import httpx
import pytest

from subtitle_worker import safe_download
from subtitle_worker.safe_download import AddrInfo


def public_resolver(host: str, port: int, family: int, kind: int) -> list[AddrInfo]:
    del host, family, kind
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/video.mp4",
        "https://127.0.0.1/video.mp4",
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.8/video.mp4",
        "https://user:pass@example.com/video.mp4",
    ],
)
def test_rejects_insecure_or_private_targets(url: str) -> None:
    with pytest.raises(ValueError):
        safe_download.validate_public_https_url(url, public_resolver)


def test_rejects_hostname_that_resolves_private() -> None:
    def private_resolver(host: str, port: int, family: int, kind: int) -> list[AddrInfo]:
        del host, family, kind
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.10", port))]

    with pytest.raises(ValueError, match="non-public"):
        safe_download.validate_public_https_url("https://media.example/video.mp4", private_resolver)


def test_revalidates_and_blocks_private_redirect(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    class Redirect:
        is_redirect = True
        headers: ClassVar[dict[str, str]] = {"location": "https://127.0.0.1/metadata"}

        def __enter__(self) -> Redirect:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(httpx, "stream", lambda *_args, **_kwargs: Redirect())
    with pytest.raises(ValueError, match="non-public"):
        safe_download.download_public_https(
            "https://media.example/video.mp4",
            tmp_path / "source",
            resolver=public_resolver,
        )


def test_download_is_bounded(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class Response:
        is_redirect = False
        headers: ClassVar[dict[str, str]] = {}

        def __enter__(self) -> Response:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def raise_for_status(self) -> None:
            return None

        def iter_bytes(self):  # type: ignore[no-untyped-def]
            yield b"1234"
            yield b"5678"

    monkeypatch.setattr(httpx, "stream", lambda *_args, **_kwargs: Response())
    with pytest.raises(ValueError, match="download limit"):
        safe_download.download_public_https(
            "https://media.example/video.mp4",
            tmp_path / "source",
            max_bytes=5,
            resolver=public_resolver,
        )
