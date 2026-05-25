# subtitle-worker

Python worker. Runs the ASR + translation pipeline on a GPU host (RunPod RTX 4090).

## Stages

1. `ffmpeg` extract WAV 16kHz mono + leading/trailing trim (`stages/preprocess.py`)
2. `Demucs` (htdemucs) for vocal isolation (`stages/vocals.py`)
3. `faster-whisper` with `litagin/anime-whisper` model (`stages/asr.py`)
4. Claude (Sonnet 4.6) translation with per-show glossary (`stages/translate.py`)
5. Stage handler (`handler.py`) uploads outputs to R2 and POSTs a signed
   webhook back to the api (`/webhooks/runpod`)

## Local dev

```bash
# uv (recommended)
uv sync --extra dev
uv run python -m subtitle_worker

# or plain venv + pip
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m subtitle_worker
```

## Tests

```bash
# uv
uv run pytest

# or
.venv/bin/pytest
```

ffmpeg-touching tests skip cleanly when `ffmpeg` is not on PATH. Install it
locally (`brew install ffmpeg`, `apt install ffmpeg`) to run the full
integration suite. Scene-detection tests skip when `scenedetect` is not
installed.

## Local pipeline (no api / no RunPod)

Run the full pipeline on a local audio file with just a Claude or OpenAI
key — useful for quality testing without the full Path B infrastructure.

> First run downloads ~230MB of model weights (Whisper base + Demucs htdemucs)
> to `~/.cache`. Subsequent runs use the local cache.

```bash
# Setup (one-time)
brew install ffmpeg
cd apps/worker
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,openai]"   # or ".[dev]" if you only need Claude
export OPENAI_API_KEY=sk-...     # or ANTHROPIC_API_KEY

# Run on a local file. On an M-series Mac with CPU + Demucs enabled,
# expect ~5-10x realtime end-to-end (Demucs is the slow part). Pass
# --no-vocals for ~2-3x realtime at the cost of more hallucination
# on BGM-heavy clips.
PYTHONPATH=src python -m subtitle_worker.local_pipeline \
  ~/Downloads/test-clip.mp3 \
  --show 'Show Name' \
  --model base
```

Provider selection (auto):
- `LLM_PROVIDER=claude|openai` explicit, OR
- `ANTHROPIC_API_KEY` set → Claude, OR
- `OPENAI_API_KEY` set → OpenAI

CPU performance knobs:
- `--model tiny` — fast (~75MB), garbage on Japanese; use only for plumbing tests
- `--model base` — default (~150MB), tolerable on clean speech
- `--model small` or `medium` — better quality, slower; large-v3 is too slow for CPU
- `--no-vocals` — skip Demucs (saves ~5x audio length); BGM-heavy clips will hallucinate more
- `--no-preprocess` — skip ffmpeg trim (pass a 16kHz mono WAV directly)

Output is sent to stdout; per-stage progress to stderr so you can redirect:

```bash
PYTHONPATH=src python -m subtitle_worker.local_pipeline clip.mp3 > subs.txt
```

## Docker / RunPod deploy

```bash
# Build the container (from this directory)
docker build -t subtitle-fm-worker:latest .

# Smoke-test locally — the handler exits since no RunPod queue is attached,
# but you can verify the image boots and imports cleanly.
docker run --rm -e WORKER_WEBHOOK_SECRET=local-test subtitle-fm-worker:latest \
  python -c "from subtitle_worker.handler import handler; print('handler ok')"

# Push to a registry RunPod can pull from (Docker Hub, GHCR, etc.)
docker tag subtitle-fm-worker:latest <registry>/subtitle-fm-worker:latest
docker push <registry>/subtitle-fm-worker:latest
```

Then on RunPod:

1. Create a **Serverless Endpoint** pointing at the image
2. Set env vars on the endpoint:
   - `WORKER_WEBHOOK_SECRET` — must match the api's `.env`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — for
     stage artifact upload/download
   - `ANTHROPIC_API_KEY` — for the translate stage
3. Capture the **Endpoint ID** and set it as `RUNPOD_ENDPOINT_ID` in the
   api's `.env`. Set `WORKER_MODE=runpod` on the worker-runner to flip
   dispatch from stub to real.

The default base image is CPU-only `python:3.11-slim` (small, fast push).
For real GPU inference swap line 1 of `Dockerfile` to a CUDA base like
`runpod/pytorch:2.5.1-py3.11-cuda12.4` and rebuild — nothing else changes.

### Trust model

The handler dereferences whatever `sourceUrl` / `audioUrl` / `transcriptUrl`
the dispatcher provides. That's safe today because the RunPod endpoint is
gated by `RUNPOD_API_KEY` (only our api can invoke it), the first-stage
`sourceUrl` is a presigned R2 GET URL the api itself issued, and downstream
stages receive bare R2 keys the worker fetches with its own credentials.
Treat `RUNPOD_API_KEY` as the security boundary — without that gate the
worker has an SSRF surface.

## Notes

- GPU required for production ASR / vocal isolation. CPU works for
  smoke tests with the `tiny` Whisper model.
- Model weights pulled at first inference from HuggingFace; cache under
  `hf_cache/` (bake this into your container image for faster cold starts).
- See `pipeline.py` for the staged interface; per-stage implementations
  live under `stages/`.
