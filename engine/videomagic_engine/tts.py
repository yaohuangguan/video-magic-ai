from __future__ import annotations

import os
import re
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


def _load_pipeline(device: str) -> tuple[Any, str]:
    global _pipeline, _pipeline_device

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


def _auto_fallback_allowed(device: str) -> bool:
    forced = os.environ.get("VIDEOMAGIC_TTS_DEVICE", "").strip().lower()
    return device == "cuda" and forced != "cuda"


def get_pipeline() -> tuple[Any, str]:
    device = _resolve_device()

    try:
        return _load_pipeline(device)
    except Exception:
        if not _auto_fallback_allowed(device):
            raise
        return _load_pipeline("cpu")


def split_script(text: str) -> list[str]:
    clean = re.sub(r"\s+", " ", text.strip())
    if not clean:
        return []

    pieces = re.split(r"(?<=[。！？!?；;])\s*|\n+", clean)
    segments = [piece.strip() for piece in pieces if piece.strip()]
    return segments or [clean]


def _generate_segment(
    pipeline: Any,
    text: str,
    voice: str,
    speed: float,
) -> np.ndarray:
    pieces: list[np.ndarray] = []
    internal_silence = np.zeros(int(SAMPLE_RATE * 0.04), dtype=np.float32)

    for result in pipeline(text, voice=voice, speed=speed):
        audio = result.audio
        if audio is None:
            continue
        chunk = audio.detach().cpu().numpy().astype(np.float32)
        if pieces:
            pieces.append(internal_silence)
        pieces.append(chunk)

    if not pieces:
        raise RuntimeError(f"TTS produced no audio for segment: {text[:32]}")

    return np.concatenate(pieces)


def _validate(text: str, voice: str, speed: float) -> str:
    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Narration text is empty.")
    if voice not in VOICE_IDS:
        raise ValueError(f"Unknown voice: {voice}")
    if not 0.6 <= speed <= 1.6:
        raise ValueError("Speed must be between 0.6 and 1.6.")
    return clean_text


def synthesize(
    text: str,
    output_path: str | Path,
    voice: str = DEFAULT_VOICE,
    speed: float = 1.0,
) -> dict[str, Any]:
    clean_text = _validate(text, voice, speed)
    pipeline, device = get_pipeline()
    segments = split_script(clean_text)

    try:
        generated = [
            _generate_segment(pipeline, segment, voice=voice, speed=speed)
            for segment in segments
        ]
    except Exception:
        if not _auto_fallback_allowed(device):
            raise
        pipeline, device = _load_pipeline("cpu")
        generated = [
            _generate_segment(pipeline, segment, voice=voice, speed=speed)
            for segment in segments
        ]
    sentence_gap = np.zeros(int(SAMPLE_RATE * 0.10), dtype=np.float32)
    pieces: list[np.ndarray] = []
    timeline: list[dict[str, Any]] = []
    cursor = 0

    for index, (segment, audio) in enumerate(zip(segments, generated)):
        if index:
            pieces.append(sentence_gap)
            cursor += sentence_gap.shape[0]

        start = cursor / SAMPLE_RATE
        pieces.append(audio)
        cursor += audio.shape[0]
        end = cursor / SAMPLE_RATE
        timeline.append({"text": segment, "start": start, "end": end})

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
        "timeline": timeline,
        "autoTiming": False,
    }


def synthesize_timed(
    text: str,
    output_path: str | Path,
    target_duration: float,
    voice: str = DEFAULT_VOICE,
    speed: float = 1.0,
) -> dict[str, Any]:
    clean_text = _validate(text, voice, speed)
    if target_duration <= 0.5:
        raise ValueError("Video is too short for automatic narration timing.")

    pipeline, device = get_pipeline()
    segments = split_script(clean_text)

    def generate(at_speed: float) -> list[np.ndarray]:
        nonlocal pipeline, device
        try:
            return [
                _generate_segment(pipeline, segment, voice=voice, speed=at_speed)
                for segment in segments
            ]
        except Exception:
            if not _auto_fallback_allowed(device):
                raise
            pipeline, device = _load_pipeline("cpu")
            return [
                _generate_segment(pipeline, segment, voice=voice, speed=at_speed)
                for segment in segments
            ]

    effective_speed = speed
    generated = generate(effective_speed)
    speech_samples = sum(audio.shape[0] for audio in generated)
    speech_duration = speech_samples / SAMPLE_RATE
    fit_window = max(target_duration * 0.90, 0.5)

    if speech_duration > fit_window and effective_speed < 1.6:
        effective_speed = min(
            1.6,
            max(effective_speed, effective_speed * speech_duration / fit_window),
        )
        generated = generate(effective_speed)
        speech_samples = sum(audio.shape[0] for audio in generated)
        speech_duration = speech_samples / SAMPLE_RATE

    if speech_duration > target_duration * 1.02:
        raise ValueError(
            "Narration is too long for this video even at the maximum automatic speed. "
            "Shorten the script or increase the video duration."
        )

    target_samples = max(int(target_duration * SAMPLE_RATE), speech_samples)
    available_silence = max(0, target_samples - speech_samples)
    gap_count = len(generated) + 1
    base_gap = available_silence // gap_count
    remainder = available_silence % gap_count

    pieces: list[np.ndarray] = []
    timeline: list[dict[str, Any]] = []
    cursor = 0

    for index, (segment, audio) in enumerate(zip(segments, generated)):
        gap_samples = base_gap + (1 if index < remainder else 0)
        if gap_samples:
            pieces.append(np.zeros(gap_samples, dtype=np.float32))
            cursor += gap_samples

        start = cursor / SAMPLE_RATE
        pieces.append(audio)
        cursor += audio.shape[0]
        end = cursor / SAMPLE_RATE
        timeline.append(
            {
                "text": segment,
                "start": start,
                "end": end,
            }
        )

    tail_samples = max(0, target_samples - cursor)
    if tail_samples:
        pieces.append(np.zeros(tail_samples, dtype=np.float32))

    merged = np.concatenate(pieces)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, merged, SAMPLE_RATE, subtype="PCM_16")

    return {
        "path": str(output),
        "sampleRate": SAMPLE_RATE,
        "samples": int(merged.shape[0]),
        "durationSeconds": float(merged.shape[0] / SAMPLE_RATE),
        "speechDurationSeconds": speech_duration,
        "targetDurationSeconds": target_duration,
        "voice": voice,
        "speed": effective_speed,
        "requestedSpeed": speed,
        "device": device,
        "model": REPO_ID,
        "timeline": timeline,
        "autoTiming": True,
    }


def plan_timeline(text: str, target_duration: float) -> dict[str, Any]:
    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Narration text is empty.")
    if target_duration <= 0.5:
        raise ValueError("Video is too short to build a narration timeline.")

    segments = split_script(clean_text)
    count = len(segments)
    if not count:
        raise ValueError("Narration text produced no timeline segments.")

    lead = min(0.35, max(0.08, target_duration * 0.03))
    tail = lead
    gap = min(0.22, max(0.05, target_duration * 0.012))

    reserved = lead + tail + gap * max(0, count - 1)
    if reserved >= target_duration * 0.45:
        lead = min(0.10, target_duration * 0.02)
        tail = lead
        gap = min(0.06, target_duration * 0.006)
        reserved = lead + tail + gap * max(0, count - 1)

    usable = target_duration - reserved
    if usable <= 0.1:
        raise ValueError("Video is too short for the number of narration segments.")

    def weight(segment: str) -> float:
        visible = re.sub(r"[\s，。！？!?；;、,.…:：\"“”'‘’（）()\-—]", "", segment)
        return float(max(2, len(visible)))

    weights = [weight(segment) for segment in segments]
    total_weight = sum(weights)
    cursor = lead
    timeline: list[dict[str, Any]] = []

    for index, (segment, segment_weight) in enumerate(zip(segments, weights)):
        if index == count - 1:
            end = target_duration - tail
        else:
            duration = usable * (segment_weight / total_weight)
            end = cursor + duration

        timeline.append(
            {
                "id": f"segment-{index + 1}",
                "text": segment,
                "start": round(cursor, 3),
                "end": round(max(end, cursor + 0.08), 3),
            }
        )
        cursor = end + gap

    return {
        "timeline": timeline,
        "durationSeconds": float(target_duration),
        "draft": True,
    }


def synthesize_timeline(
    segments: list[dict[str, Any]],
    output_path: str | Path,
    target_duration: float,
    voice: str = DEFAULT_VOICE,
    speed: float = 1.0,
) -> dict[str, Any]:
    if target_duration <= 0.5:
        raise ValueError("Video is too short for timeline narration.")
    if voice not in VOICE_IDS:
        raise ValueError(f"Unknown voice: {voice}")
    if not 0.6 <= speed <= 1.6:
        raise ValueError("Speed must be between 0.6 and 1.6.")
    if not isinstance(segments, list) or not segments:
        raise ValueError("Timeline has no narration segments.")

    normalized: list[dict[str, Any]] = []
    previous_end = 0.0
    for index, raw in enumerate(segments):
        text = str(raw.get("text") or "").strip()
        if not text:
            raise ValueError(f"Timeline segment {index + 1} has no text.")

        try:
            start = float(raw.get("start"))
            end = float(raw.get("end"))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Timeline segment {index + 1} has invalid timing.") from exc

        if start < 0 or end <= start:
            raise ValueError(f"Timeline segment {index + 1} has invalid start/end timing.")
        if end > target_duration + 0.05:
            raise ValueError(
                f"Timeline segment {index + 1} ends after the source video."
            )
        if index and start < previous_end - 0.01:
            raise ValueError("Timeline narration segments cannot overlap.")

        normalized.append(
            {
                "id": str(raw.get("id") or f"segment-{index + 1}"),
                "text": text,
                "start": start,
                "end": end,
            }
        )
        previous_end = end

    pipeline, device = get_pipeline()

    def generate_segment_audio(text: str, at_speed: float) -> np.ndarray:
        nonlocal pipeline, device
        try:
            return _generate_segment(pipeline, text, voice=voice, speed=at_speed)
        except Exception:
            if not _auto_fallback_allowed(device):
                raise
            pipeline, device = _load_pipeline("cpu")
            return _generate_segment(pipeline, text, voice=voice, speed=at_speed)

    target_samples = int(target_duration * SAMPLE_RATE)
    pieces: list[np.ndarray] = []
    timeline: list[dict[str, Any]] = []
    cursor = 0

    for index, segment in enumerate(normalized):
        start_samples = int(segment["start"] * SAMPLE_RATE)
        window_seconds = segment["end"] - segment["start"]
        if start_samples < cursor:
            raise ValueError("Timeline narration segments cannot overlap.")

        if start_samples > cursor:
            pieces.append(np.zeros(start_samples - cursor, dtype=np.float32))
            cursor = start_samples

        effective_speed = speed
        audio = generate_segment_audio(segment["text"], effective_speed)
        audio_duration = audio.shape[0] / SAMPLE_RATE
        fit_duration = max(window_seconds * 0.96, 0.08)

        if audio_duration > fit_duration and effective_speed < 1.6:
            effective_speed = min(
                1.6,
                max(
                    effective_speed,
                    effective_speed * audio_duration / fit_duration,
                ),
            )
            audio = generate_segment_audio(segment["text"], effective_speed)
            audio_duration = audio.shape[0] / SAMPLE_RATE

        if audio_duration > window_seconds + 0.02:
            raise ValueError(
                f'Timeline segment {index + 1} is too long for its '
                f'{window_seconds:.2f}s window. Widen the segment, shorten the text, '
                "or move nearby segments."
            )

        pieces.append(audio)
        cursor += audio.shape[0]
        actual_end = cursor / SAMPLE_RATE

        timeline.append(
            {
                "id": segment["id"],
                "text": segment["text"],
                "start": segment["start"],
                "end": float(actual_end),
                "windowEnd": segment["end"],
                "speed": float(effective_speed),
            }
        )

    if cursor < target_samples:
        pieces.append(np.zeros(target_samples - cursor, dtype=np.float32))

    merged = np.concatenate(pieces)
    if merged.shape[0] > target_samples:
        merged = merged[:target_samples]

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, merged, SAMPLE_RATE, subtype="PCM_16")

    return {
        "path": str(output),
        "sampleRate": SAMPLE_RATE,
        "samples": int(merged.shape[0]),
        "durationSeconds": float(merged.shape[0] / SAMPLE_RATE),
        "targetDurationSeconds": float(target_duration),
        "voice": voice,
        "speed": speed,
        "device": device,
        "model": REPO_ID,
        "timeline": timeline,
        "autoTiming": False,
        "customTimeline": True,
    }
