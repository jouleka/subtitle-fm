# subtitle-worker

Python worker. Runs the ASR + translation pipeline on a GPU host (RunPod RTX 4090).

## Stages

1. `ffmpeg` extract WAV 16kHz mono
2. `PySceneDetect` to trim OP/ED
3. `Demucs` (htdemucs) for vocal isolation
4. `faster-whisper` with `litagin/anime-whisper` model
5. Claude (Sonnet 4.6) translation with per-show glossary
6. Emit `.ass` and POST back to API

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

## Notes

- GPU required for real ASR. CPU works for smoke tests with `tiny` model.
- Model weights pulled at first inference from HuggingFace; cache under `hf_cache/`.
- See `pipeline.py` for the staged interface; per-stage implementations
  live under `stages/`.
