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
uv sync --extra dev
uv run python -m subtitle_worker
```

## Notes

- GPU required for real runs. CPU works for smoke tests with `tiny` model.
- Model weights pulled at first inference from HuggingFace; cache under `hf_cache/`.
- See `pipeline.py` for the staged interface — implementations land in Phase 1.
