from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .media import probe_video

DEFAULT_VIDEO_MODEL = "openbmb/MiniCPM-V-4.6"

_model: Any = None
_processor: Any = None
_loaded_model_id: str | None = None


def model_id() -> str:
    return os.environ.get("VIDEOMAGIC_VIDEO_MODEL", DEFAULT_VIDEO_MODEL).strip() or DEFAULT_VIDEO_MODEL


def intelligence_status() -> dict[str, Any]:
    installed = all(
        importlib.util.find_spec(name) is not None
        for name in ("torch", "transformers", "av")
    )
    cached = False
    cache_path: str | None = None

    if installed:
        try:
            from huggingface_hub import snapshot_download

            cache_path = snapshot_download(model_id(), local_files_only=True)
            cached = True
        except Exception:
            cached = False

    return {
        "provider": "transformers",
        "model": model_id(),
        "dependenciesInstalled": installed,
        "modelCached": cached,
        "cachePath": cache_path,
    }


def _load_model() -> tuple[Any, Any]:
    global _model, _processor, _loaded_model_id

    selected_model = model_id()
    if _model is not None and _processor is not None and _loaded_model_id == selected_model:
        return _model, _processor

    import torch
    from transformers import AutoModelForMultimodalLM, AutoProcessor

    processor = AutoProcessor.from_pretrained(selected_model)
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForMultimodalLM.from_pretrained(
        selected_model,
        dtype=dtype,
        device_map="auto",
        low_cpu_mem_usage=True,
    )
    model.eval()

    _model = model
    _processor = processor
    _loaded_model_id = selected_model
    return model, processor


def release_video_model() -> None:
    global _model, _processor, _loaded_model_id

    _model = None
    _processor = None
    _loaded_model_id = None

    try:
        import gc
        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass


def _json_object(text: str) -> dict[str, Any]:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.strip("`").strip()
        if clean.lower().startswith("json"):
            clean = clean[4:].lstrip()

    try:
        value = json.loads(clean)
    except json.JSONDecodeError:
        try:
            import json_repair

            value = json_repair.loads(clean)
        except Exception as exc:
            raise ValueError("Video AI did not return a usable JSON edit plan.") from exc

    if not isinstance(value, dict):
        raise ValueError("Video AI edit plan must be a JSON object.")
    return value


def _language_hint(value: str | None) -> str:
    normalized = (value or "auto").strip().lower()
    if normalized in {"en", "english", "en-us", "en-gb"}:
        return "en"
    if normalized in {"zh", "chinese", "mandarin", "中文"}:
        return "zh"
    return "auto"


def _candidate_windows(
    source_duration: float,
    max_windows: int = 32,
) -> list[dict[str, Any]]:
    window_seconds = max(1.0, source_duration / max_windows)
    count = max(1, int(math.ceil(source_duration / window_seconds)))
    candidates: list[dict[str, Any]] = []

    for index in range(count):
        start = index * window_seconds
        end = min(source_duration, (index + 1) * window_seconds)
        if end - start < 0.08:
            continue
        candidates.append(
            {
                "id": index + 1,
                "sourceStart": round(start, 3),
                "sourceEnd": round(end, 3),
            }
        )

    return candidates


def _label_candidate_frames(
    frames: np.ndarray,
    candidates: list[dict[str, Any]],
) -> np.ndarray:
    if len(frames) == 0:
        return frames

    annotated: list[np.ndarray] = []

    for index, frame in enumerate(frames):
        candidate = candidates[min(index, len(candidates) - 1)]
        image = Image.fromarray(frame).convert("RGB")
        draw = ImageDraw.Draw(image)

        try:
            font = ImageFont.load_default(size=max(18, min(image.size) // 14))
        except TypeError:
            font = ImageFont.load_default()

        label = (
            f"CLIP {candidate['id']:02d}  "
            f"{candidate['sourceStart']:.1f}-{candidate['sourceEnd']:.1f}s"
        )
        bbox = draw.textbbox((0, 0), label, font=font)
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        pad = max(6, height // 4)
        x = 10
        y = 10

        draw.rounded_rectangle(
            (x - pad, y - pad, x + width + pad, y + height + pad),
            radius=max(4, pad),
            fill=(0, 0, 0),
        )
        draw.text((x, y), label, fill=(255, 255, 255), font=font)
        annotated.append(np.asarray(image, dtype=np.uint8))

    return np.stack(annotated, axis=0)


def build_director_prompt(
    instruction: str,
    source_duration: float,
    target_duration: float | None = None,
    narration_language: str = "auto",
    candidates: list[dict[str, Any]] | None = None,
) -> str:
    duration_goal = (
        f"Target the final edit at about {target_duration:.1f} seconds."
        if target_duration and target_duration > 0
        else "Choose an appropriate concise final duration; do not make it longer than the source."
    )
    language_hint = _language_hint(narration_language)
    candidate_catalog = "\n".join(
        f"- CLIP {item['id']:02d}: {item['sourceStart']:.1f}-{item['sourceEnd']:.1f}s"
        for item in (candidates or [])
    )

    return f"""
You are the local AI director inside VideoMagic.

Watch the supplied source video and turn the user's instruction into a deterministic edit decision list.
VideoMagic has already divided the source into authoritative candidate clips. Every sampled frame is visibly stamped with its CLIP ID and exact source time range.
You MUST select candidate CLIP IDs. Never invent sourceStart/sourceEnd timestamps.

SOURCE DURATION: {source_duration:.3f} seconds
USER INSTRUCTION:
{instruction.strip()}

{duration_goal}

AVAILABLE CANDIDATE CLIPS:
{candidate_catalog}

Return STRICT JSON only. No Markdown and no explanation outside JSON.

Schema:
{{
  "title": "short working title",
  "summary": "one sentence describing the edit",
  "narrationLanguage": "zh" or "en",
  "clips": [
    {{
      "clipIds": [5, 6, 7],
      "speed": 1.0,
      "narration": "short narration for this selected clip group, or empty string",
      "reason": "why these candidate clips are kept"
    }}
  ]
}}

Rules:
- Keep between 1 and 12 clip groups.
- clipIds must come only from AVAILABLE CANDIDATE CLIPS.
- clipIds inside one group should be consecutive source clips. Start a new group when there is a gap.
- Do not select INTRO/END or unrelated candidates when the user explicitly excludes them.
- speed must be between 0.5 and 2.0. Use 1.0 unless pacing clearly benefits from a change.
- Hard cuts only in this first version. Do not invent transitions, generated footage, zooms, or effects.
- Clips may be reordered only when the user's storytelling request clearly benefits from it.
- Avoid duplicate or nearly identical source ranges.
- Keep narration concise enough to fit inside each selected clip after speed adjustment.
- When a target duration is supplied, verify the arithmetic before returning JSON: sum((sourceEnd-sourceStart)/speed) must be within 5% of that target whenever the requested content makes it possible.
- If the user asks for no narration, set narration to an empty string for every clip.
- narrationLanguage must follow this explicit hint when it is not auto: {language_hint}.
- If narrationLanguage is auto, use the language requested by the user; otherwise match the user's instruction language.
""".strip()


def normalize_edit_plan(
    raw_plan: dict[str, Any],
    source_duration: float,
    target_duration: float | None = None,
    candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    raw_clips = raw_plan.get("clips")
    if not isinstance(raw_clips, list) or not raw_clips:
        raise ValueError("Video AI returned no clips.")

    clips: list[dict[str, Any]] = []
    output_cursor = 0.0
    candidate_map = {
        int(item["id"]): item
        for item in (candidates or [])
    }

    for raw in raw_clips[:12]:
        if not isinstance(raw, dict):
            continue

        try:
            speed = float(raw.get("speed", 1.0))
        except (TypeError, ValueError):
            speed = 1.0
        speed = max(0.5, min(speed, 2.0))

        ranges: list[tuple[float, float, list[int]]] = []
        raw_ids = raw.get("clipIds")

        if candidate_map and isinstance(raw_ids, list):
            valid_ids = sorted(
                {
                    int(value)
                    for value in raw_ids
                    if isinstance(value, (int, float, str))
                    and str(value).strip().isdigit()
                    and int(value) in candidate_map
                }
            )

            group: list[int] = []
            for clip_id in valid_ids:
                if group and clip_id != group[-1] + 1:
                    first = candidate_map[group[0]]
                    last = candidate_map[group[-1]]
                    ranges.append(
                        (
                            float(first["sourceStart"]),
                            float(last["sourceEnd"]),
                            group[:],
                        )
                    )
                    group = []
                group.append(clip_id)

            if group:
                first = candidate_map[group[0]]
                last = candidate_map[group[-1]]
                ranges.append(
                    (
                        float(first["sourceStart"]),
                        float(last["sourceEnd"]),
                        group[:],
                    )
                )
        else:
            try:
                ranges.append(
                    (
                        float(raw.get("sourceStart")),
                        float(raw.get("sourceEnd")),
                        [],
                    )
                )
            except (TypeError, ValueError):
                continue

        for source_start, source_end, clip_ids in ranges:
            source_start = max(0.0, min(source_start, source_duration))
            source_end = max(0.0, min(source_end, source_duration))
            if source_end - source_start < 0.12:
                continue

            output_duration = (source_end - source_start) / speed
            output_start = output_cursor
            output_end = output_start + output_duration

            clips.append(
                {
                    "id": f"clip-{len(clips) + 1}",
                    "clipIds": clip_ids,
                    "sourceStart": round(source_start, 3),
                    "sourceEnd": round(source_end, 3),
                    "speed": round(speed, 3),
                    "outputStart": round(output_start, 3),
                    "outputEnd": round(output_end, 3),
                    "narration": str(raw.get("narration") or "").strip(),
                    "reason": str(raw.get("reason") or "").strip(),
                }
            )
            output_cursor = output_end
            if len(clips) >= 12:
                break

        if len(clips) >= 12:
            break

    if not clips:
        raise ValueError("Video AI returned no usable clip ranges.")

    if target_duration and target_duration > 0 and output_cursor > target_duration * 1.05:
        scale = target_duration / output_cursor
        adjusted: list[dict[str, Any]] = []
        output_cursor = 0.0

        for clip in clips:
            source_start = float(clip["sourceStart"])
            speed = float(clip["speed"])
            current_output = float(clip["outputEnd"]) - float(clip["outputStart"])
            desired_output = max(0.12 / speed, current_output * scale)
            source_end = min(
                float(clip["sourceEnd"]),
                source_start + desired_output * speed,
            )
            actual_output = (source_end - source_start) / speed

            adjusted.append(
                {
                    **clip,
                    "sourceEnd": round(source_end, 3),
                    "outputStart": round(output_cursor, 3),
                    "outputEnd": round(output_cursor + actual_output, 3),
                }
            )
            output_cursor += actual_output

        clips = adjusted

    narration_language = _language_hint(str(raw_plan.get("narrationLanguage") or "auto"))
    if narration_language == "auto":
        narration_language = "zh"

    return {
        "title": str(raw_plan.get("title") or "AI edit").strip() or "AI edit",
        "summary": str(raw_plan.get("summary") or "").strip(),
        "narrationLanguage": narration_language,
        "sourceDurationSeconds": float(source_duration),
        "outputDurationSeconds": round(output_cursor, 3),
        "clips": clips,
        "model": model_id(),
    }


def plan_video_edit(
    video_path: str | Path,
    instruction: str,
    target_duration: float | None = None,
    narration_language: str = "auto",
) -> dict[str, Any]:
    instruction = instruction.strip()
    if not instruction:
        raise ValueError("AI edit instruction is empty.")

    video = Path(video_path).resolve()
    if not video.exists():
        raise ValueError("Source video does not exist.")

    info = probe_video(video)
    source_duration = max(float(info["durationSeconds"]), 0.1)
    model, processor = _load_model()

    from transformers.video_utils import load_video

    candidates = _candidate_windows(source_duration)
    frame_budget = len(candidates)
    video_frames, _video_metadata = load_video(
        str(video),
        num_frames=frame_budget,
        backend="pyav",
    )
    video_frames = _label_candidate_frames(video_frames, candidates)

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "video", "video": video_frames},
                {
                    "type": "text",
                    "text": build_director_prompt(
                        instruction=instruction,
                        source_duration=source_duration,
                        target_duration=target_duration,
                        narration_language=narration_language,
                        candidates=candidates,
                    ),
                },
            ],
        }
    ]

    downsample_mode = "16x"
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
        processor_kwargs={
            "videos_kwargs": {
                "do_sample_frames": False,
                "max_num_frames": frame_budget,
                "stack_frames": 1,
                "max_slice_nums": 1,
                "downsample_mode": downsample_mode,
                "use_image_id": False,
            }
        },
    ).to(model.device)

    generated_ids = model.generate(
        **inputs,
        downsample_mode=downsample_mode,
        max_new_tokens=1800,
        do_sample=False,
    )
    generated_ids = [
        output_ids[len(input_ids) :]
        for input_ids, output_ids in zip(inputs.input_ids, generated_ids)
    ]
    response = processor.batch_decode(
        generated_ids,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )[0]

    plan = normalize_edit_plan(
        _json_object(response),
        source_duration,
        target_duration=target_duration,
        candidates=candidates,
    )
    plan["rawModelResponse"] = response
    return plan
