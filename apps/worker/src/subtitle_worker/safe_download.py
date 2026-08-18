"""Bounded downloader for user-supplied media URLs.

Every redirect target is resolved and checked before httpx connects. This blocks
loopback, RFC1918, link-local, and cloud-metadata destinations from the RunPod
worker while retaining direct public HTTPS media support.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import cast
from urllib.parse import urljoin, urlsplit

import httpx

MAX_REDIRECTS = 3
DEFAULT_MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 * 1024
AddrInfo = tuple[int, int, int, str, tuple[str, int] | tuple[str, int, int, int]]
Resolver = Callable[[str, int, int, int], Iterable[AddrInfo]]


def _system_resolver(hostname: str, port: int, family: int, kind: int) -> Iterable[AddrInfo]:
    return cast(list[AddrInfo], socket.getaddrinfo(hostname, port, family, kind))


def _resolved_addresses(
    hostname: str,
    port: int,
    resolver: Resolver,
) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        try:
            rows = resolver(hostname, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
        except socket.gaierror as error:
            raise ValueError("source URL hostname could not be resolved") from error
        addresses = {ipaddress.ip_address(str(row[4][0]).split("%")[0]) for row in rows}
        if not addresses:
            raise ValueError("source URL hostname did not resolve") from None
        return addresses
    return {literal}


def validate_public_https_url(url: str, resolver: Resolver = _system_resolver) -> None:
    parsed = urlsplit(url)
    allow_http = os.environ.get("ALLOW_INSECURE_SOURCE_URLS") == "1"
    if parsed.scheme != "https" and not (allow_http and parsed.scheme == "http"):
        raise ValueError("source URL must use HTTPS")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("source URL must not contain credentials")
    if not parsed.hostname:
        raise ValueError("source URL must include a hostname")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as error:
        raise ValueError("source URL has an invalid port") from error
    addresses = _resolved_addresses(parsed.hostname, port, resolver)
    if any(not address.is_global for address in addresses):
        raise ValueError("source URL resolves to a non-public address")


def download_public_https(
    url: str,
    target: Path,
    *,
    max_bytes: int | None = None,
    resolver: Resolver = _system_resolver,
) -> Path:
    configured_limit = os.environ.get("MAX_SOURCE_DOWNLOAD_BYTES", str(DEFAULT_MAX_DOWNLOAD_BYTES))
    limit = max_bytes or int(configured_limit)
    current_url = url

    for redirect_count in range(MAX_REDIRECTS + 1):
        validate_public_https_url(current_url, resolver)
        with httpx.stream("GET", current_url, follow_redirects=False, timeout=120.0) as response:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location or redirect_count == MAX_REDIRECTS:
                    raise ValueError("source URL exceeded the redirect limit")
                current_url = urljoin(current_url, location)
                continue

            response.raise_for_status()
            content_length = response.headers.get("content-length")
            if content_length:
                try:
                    declared_size = int(content_length)
                except ValueError:
                    declared_size = 0
                if declared_size > limit:
                    raise ValueError("source media exceeds the download limit")

            downloaded = 0
            with target.open("wb") as output:
                for chunk in response.iter_bytes():
                    downloaded += len(chunk)
                    if downloaded > limit:
                        raise ValueError("source media exceeds the download limit")
                    output.write(chunk)
            return target

    raise ValueError("source URL exceeded the redirect limit")
