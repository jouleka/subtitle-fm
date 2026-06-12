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

# Install our package + RunPod SDK + the OpenAI translate provider. The
# runpod/openai extras are the only difference from a local pip install -e ".[dev]".
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir ".[runpod,openai]"

# Demucs fix: PyPI demucs 4.0.1 ships WITHOUT the `demucs.api` module the worker
# imports (it only exists in git). Install the git version that has it, with
# --no-deps so its stale `torchaudio<2.2` metadata pin doesn't conflict with the
# torch stack above (the code runs fine on the installed torchaudio). torchcodec
# backs torchaudio.save()/load() on torchaudio>=2.9. Verified locally: real
# htdemucs separation + save of a Japanese clip succeeds.
RUN pip install --no-cache-dir --no-deps "git+https://github.com/adefossez/demucs.git@b9ab48cad45976ba42b2ff17b229c071f0df9390" \
    && pip install --no-cache-dir torchcodec

# RunPod's serverless framework expects a long-lived process that polls
# for jobs. handler.py registers our handler() and starts the poller.
CMD ["python", "-m", "subtitle_worker.handler"]
