"""Local end-to-end pipeline driver — no api / no queue / no RunPod.

Takes a local audio (or video) file, runs preprocess → vocals → ASR →
translate, and prints English subtitles to stdout. Useful when you have
an OpenAI or Anthropic key but not the full RunPod / R2 infrastructure
and just want to see real subtitles come out of the pipeline.

Usage:
    python -m subtitle_worker.local_pipeline path/to/audio.mp3
    python -m subtitle_worker.local_pipeline ep01.mkv --show 'Hunter x Hunter'
    python -m subtitle_worker.local_pipeline ep01.mkv --no-vocals --model tiny

Requirements:
    - ffmpeg on PATH (brew install ffmpeg / apt install ffmpeg)
    - Python deps: `pip install -e '.[dev,openai]'` from apps/worker
    - One of ANTHROPIC_API_KEY or OPENAI_API_KEY in env

CPU notes:
    - Whisper `base` model (default) is ~150MB; expect 1–3x realtime on CPU
    - Demucs vocal isolation is ~80MB model + ~5x realtime on CPU; pass
      `--no-vocals` to skip if you're impatient (quality will be worse)
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

from subtitle_worker.stages.asr import transcribe_audio
from subtitle_worker.stages.preprocess import preprocess_for_asr
from subtitle_worker.stages.translate import translate_segments
from subtitle_worker.stages.vocals import isolate_vocals


def _print_stage(label: str) -> None:
    print(f"\n[{label}] ...", file=sys.stderr, flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="local_pipeline",
        description="Run the full subtitle.fm pipeline on a local audio file.",
    )
    parser.add_argument("audio", type=Path, help="Path to source audio/video file")
    parser.add_argument(
        "--show", default=None, help="Show title for translation context (optional)"
    )
    parser.add_argument(
        "--no-preprocess",
        action="store_true",
        help="Skip the ffmpeg extract+trim step; pass --audio in 16kHz mono WAV form",
    )
    parser.add_argument(
        "--no-vocals",
        action="store_true",
        help="Skip Demucs vocal isolation (faster on CPU but worse on BGM-heavy audio)",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("WHISPER_MODEL", "base"),
        help="Whisper model name or path (default: base, env: WHISPER_MODEL). "
        "Use 'tiny' for speed, 'small' or larger for quality.",
    )
    parser.add_argument(
        "--lead",
        type=float,
        default=0.0,
        help="Leading trim seconds (default 0 — no OP trim for local files)",
    )
    parser.add_argument(
        "--tail",
        type=float,
        default=0.0,
        help="Trailing trim seconds (default 0 — no ED trim for local files)",
    )
    parser.add_argument(
        "--language", default="ja", help="Source language for Whisper (default: ja)"
    )
    parser.add_argument(
        "--keep-workdir",
        action="store_true",
        help="Don't delete the temp work directory at the end (for debug)",
    )
    args = parser.parse_args(argv)

    if not args.audio.exists():
        print(f"FATAL: input file not found: {args.audio}", file=sys.stderr)
        return 1

    work_dir = Path(tempfile.mkdtemp(prefix="sfm-local-"))
    print(f"[work_dir] {work_dir}", file=sys.stderr)

    try:
        if args.no_preprocess:
            current = args.audio
        else:
            _print_stage("preprocess: ffmpeg extract + trim")
            current = preprocess_for_asr(
                args.audio,
                work_dir,
                leading_trim_sec=args.lead,
                trailing_trim_sec=args.tail,
            )

        if args.no_vocals:
            print("[vocals] skipped (--no-vocals)", file=sys.stderr)
        else:
            _print_stage("vocals: Demucs (htdemucs)")
            vocals = isolate_vocals(current, work_dir)
            current = vocals.vocals_path

        _print_stage(f"asr: Whisper model={args.model}, device=cpu")
        segments = transcribe_audio(
            current,
            model_path=args.model,
            language=args.language,
            device="cpu",
            compute_type="int8",
        )
        print(f"[asr] {len(segments)} segments", file=sys.stderr)

        _print_stage("translate: provider auto-selected from env")
        translated = translate_segments(
            segments,
            glossary=[],
            show_title=args.show,
        )
        review_count = sum(1 for s in translated if s.needs_review)
        print(
            f"[translate] {len(translated)} segments, {review_count} flagged for review",
            file=sys.stderr,
        )

        print("\n=== SUBTITLES ===\n")
        for seg in translated:
            flag = " [REVIEW]" if seg.needs_review else ""
            start = seg.start_ms / 1000
            end = seg.end_ms / 1000
            print(f"[{start:7.2f} → {end:7.2f}]{flag} {seg.text}")
        return 0

    finally:
        if args.keep_workdir:
            print(f"[work_dir] preserved at {work_dir}", file=sys.stderr)
        else:
            import shutil

            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
