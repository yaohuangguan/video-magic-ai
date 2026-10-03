from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from .voices import DEFAULT_VOICE, VOICE_IDS

SAMPLE_RATE = 24000
REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"

_pipeline: Any = None
_pipeline_device: str | None = None


def _resolve_device() -> str:
    forced = os.environ.get("VIDEOMAGIC_TTS_DEVICE", "").strip().lower()
    if forced in {"cpu", "cuda"}:
        return forced

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _configure_text_cache() -> None:
    try:
        import jieba

        home = Path(
            os.environ.get(
                "VIDEOMAGIC_HOME",
                str(Path.home() / ".videomagic"),
            )
        )
        cache_file = home / "cache" / "jieba.cache"
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        jieba.dt.cache_file = str(cache_file)
    except Exception:
        pass


def get_pipeline() -> tuple[Any, str]:
    global _pipeline, _pipeline_device

    device = _resolve_device()
    if _pipeline is not None and _pipeline_device == device:
        return _pipeline, device

    _configure_text_cache()
    from kokoro import KPipeline

    _pipeline = KPipeline(
        lang_code="z",
        repo_id=REPO_ID,
        device=device,
    )
    _pipeline_device = device
    return _pipeline, device


def synthesize(
    text: str,
    output_path: str | Path,
    voice: str = DEFAULT_VOICE,
    speed: float = 1.0,
) -> dict[str, Any]:
    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Narration text is empty.")
    if voice not in VOICE_IDS:
        raise ValueError(f"Unknown voice: {voice}")
    if not 0.6 <= speed <= 1.6:
        raise ValueError("Speed must be between 0.6 and 1.6.")

    pipeline, device = get_pipeline()
    pieces: list[np.ndarray] = []
    silence = np.zeros(int(SAMPLE_RATE * 0.08), dtype=np.float32)

    for result in pipeline(clean_text, voice=voice, speed=speed):
        audio = result.audio
        if audio is None:
            continue
        chunk = audio.detach().cpu().numpy().astype(np.float32)
        if pieces:
            pieces.append(silence)
        pieces.append(chunk)

    if not pieces:
        raise RuntimeError("TTS produced no audio.")

    merged = np.concatenate(pieces)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, merged, SAMPLE_RATE, subtype="PCM_16")

    return {
        "path": str(output),
        "sampleRate": SAMPLE_RATE,
        "samples": int(merged.shape[0]),
        "durationSeconds": float(merged.shape[0] / SAMPLE_RATE),
        "voice": voice,
        "speed": speed,
        "device": device,
        "model": REPO_ID,
    }
