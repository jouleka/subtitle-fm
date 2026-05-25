# Python worker container for RunPod serverless.
#
# Default base is CPU-only `python:3.11-slim` (small, fast to push). For
# real GPU inference swap the base to `runpod/pytorch:2.5.1-py3.11-cuda12.4`
# or similar; the rest of the Dockerfile stays the same.

FROM python:3.11-slim AS runtime

# ffmpeg for the preprocess stage; build-essential because some Python
# audio deps compile native code on install. git is needed by demucs to
# pull demo audio on first run if the cache is missing.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project metadata + source first so dependency install can be
# cached separately from code changes.
COPY pyproject.toml ./
COPY src/ ./src/

# Install our package + RunPod SDK. The runpod extra is the only difference
# from a local pip install -e ".[dev]".
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir ".[runpod]"

# RunPod's serverless framework expects a long-lived process that polls
# for jobs. handler.py registers our handler() and starts the poller.
CMD ["python", "-m", "subtitle_worker.handler"]
