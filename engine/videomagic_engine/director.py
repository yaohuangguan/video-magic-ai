from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
from typing import Any

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
    from transformers import AutoModelForImageTextToText, AutoProcessor

    processor = AutoProcessor.from_pretrained(selected_model)
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForImageTextToText.from_pretrained(
        selected_model,
        torch_dtype=dtype,
        device_map="auto",
        low_cpu_mem_usage=True,
    )
    model.eval()

    _model = model
    _processor = processor
    _loaded_model_id = selected_model
    return model, processor


def _json_object(text: str) -> dict[str, Any]:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.strip("`").strip()
        if clean.lower().startswith("json"):
            clean = clean[4:].lstrip()

    try:
        value = json.loads(clean)
    except json.JSONDecodeError:
        start = clean.find("{")
        end = clean.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Video AI did not return a JSON edit plan.")
        value = json.loads(clean[start : end + 1])

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


def build_director_prompt(
    instruction: str,
    source_duration: float,
    target_duration: float | None = None,
    narration_language: str = "auto",
) -> str:
    duration_goal = (
        f"Target the final edit at about {target_duration:.1f} seconds."
        if target_duration and target_duration > 0
        else "Choose an appropriate concise final duration; do not make it longer than the source."
    )
    language_hint = _language_hint(narration_language)

    return f"""
You are the local AI director inside VideoMagic.

Watch the supplied source video and turn the user's instruction into a deterministic edit decision list.
The actual cutting will be performed by FFmpeg, so your output must describe source time ranges precisely.

SOURCE DURATION: {source_duration:.3f} seconds
USER INSTRUCTION:
{instruction.strip()}

{duration_goal}

Return STRICT JSON only. No Markdown and no explanation outside JSON.

Schema:
{{
  "title": "short working title",
  "summary": "one sentence describing the edit",
  "narrationLanguage": "zh" or "en",
  "clips": [
    {{
      "sourceStart": 0.0,
      "sourceEnd": 3.2,
      "speed": 1.0,
      "narration": "short narration for this selected clip, or empty string",
      "reason": "why this moment is kept"
    }}
  ]
}}

Rules:
- Keep between 1 and 12 clips.
- 0 <= sourceStart < sourceEnd <= {source_duration:.3f}.
- Each selected source range should normally be at least 0.35 seconds.
- speed must be between 0.5 and 2.0. Use 1.0 unless pacing clearly benefits from a change.
- Hard cuts only in this first version. Do not invent transitions, generated footage, zooms, or effects.
- Clips may be reordered only when the user's storytelling request clearly benefits from it.
- Avoid duplicate or nearly identical source ranges.
- Keep narration concise enough to fit inside each selected clip after speed adjustment.
- If the user asks for no narration, set narration to an empty string for every clip.
- narrationLanguage must follow this explicit hint when it is not auto: {language_hint}.
- If narrationLanguage is auto, use the language requested by the user; otherwise match the user's instruction language.
""".strip()


def normalize_edit_plan(
    raw_plan: dict[str, Any],
    source_duration: float,
) -> dict[str, Any]:
    raw_clips = raw_plan.get("clips")
    if not isinstance(raw_clips, list) or not raw_clips:
        raise ValueError("Video AI returned no clips.")

    clips: list[dict[str, Any]] = []
    output_cursor = 0.0

    for raw in raw_clips[:12]:
        if not isinstance(raw, dict):
            continue

        try:
            source_start = float(raw.get("sourceStart"))
            source_end = float(raw.get("sourceEnd"))
            speed = float(raw.get("speed", 1.0))
        except (TypeError, ValueError):
            continue

        source_start = max(0.0, min(source_start, source_duration))
        source_end = max(0.0, min(source_end, source_duration))
        speed = max(0.5, min(speed, 2.0))

        if source_end - source_start < 0.12:
            continue

        output_duration = (source_end - source_start) / speed
        output_start = output_cursor
        output_end = output_start + output_duration

        clips.append(
            {
                "id": f"clip-{len(clips) + 1}",
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

    if not clips:
        raise ValueError("Video AI returned no usable clip ranges.")

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

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "video", "url": str(video)},
                {
                    "type": "text",
                    "text": build_director_prompt(
                        instruction=instruction,
                        source_duration=source_duration,
                        target_duration=target_duration,
                        narration_language=narration_language,
                    ),
                },
            ],
        }
    ]

    frame_budget = min(96, max(24, int(math.ceil(source_duration))))
    downsample_mode = "16x"
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
        downsample_mode=downsample_mode,
        max_num_frames=frame_budget,
        stack_frames=1,
        max_slice_nums=1,
        use_image_id=False,
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

    plan = normalize_edit_plan(_json_object(response), source_duration)
    plan["rawModelResponse"] = response
    return plan
