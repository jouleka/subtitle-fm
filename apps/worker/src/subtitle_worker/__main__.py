"""Entry point. Wires queue listener to pipeline stages."""

from __future__ import annotations

import os
import sys

import structlog

from subtitle_worker.config import settings

log = structlog.get_logger()


def main() -> int:
    log.info("worker.boot", model=settings.asr_model, redis=settings.redis_url)
    log.info("worker.ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())
