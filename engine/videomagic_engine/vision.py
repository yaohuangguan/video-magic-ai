from __future__ import annotations

import gc
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

QUALITY_MODEL = "HuggingFaceTB/SmolVLM2-2.2B-Instruct"
FAST_MODEL = "HuggingFaceTB/SmolVLM2-500M-Video-Instruct"

_model: Any = None
_processor: Any = None
_model_id: str | None = None
_model_device: str | None = None


def _device() -> str:
    forced = os.environ.get("VIDEOMAGIC_VISION_DEVICE", "").strip().lower()
    if forced in {"cpu", "cuda"}:
        return forced
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _free_gpu_gb() -> float:
    try:
        import torch
        if not torch.cuda.is_available():
            return 0.0
        free, _total = torch.cuda.mem_get_info()
        return float(free / (1024 ** 3))
    except Exception:
        return 0.0


def select_model(mode: str = "auto") -> str:
    normalized = (mode or "auto").strip().lower()
    if normalized == "fast":
        return FAST_MODEL
    if normalized == "quality":
        return QUALITY_MODEL
    if _device() != "cuda":
        return FAST_MODEL
    return QUALITY_MODEL if _free_gpu_gb() >= 10.0 else FAST_MODEL


def release_model() -> None:
    global _model, _processor, _model_id, _model_device
    _model = None
    _processor = None
    _model_id = None
    _model_device = None
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _load_model(mode: str = "auto") -> tuple[Any, Any, str, str]:
    global _model, _processor, _model_id, _model_device

    model_id = select_model(mode)
    device = _device()
    if _model is not None and _processor is not None and _model_id == model_id and _model_device == device:
        return _model, _processor, model_id, device

    release_model()

    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor

    dtype = torch.float16 if device == "cuda" else torch.float32
    processor = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForImageTextToText.from_pretrained(
        model_id,
        dtype=dtype,
        low_cpu_mem_usage=True,
    )
    model = model.to(device)
    model.eval()

    _model = model
    _processor = processor
    _model_id = model_id
    _model_device = device
    return model, processor, model_id, device


def _run(messages: list[dict[str, Any]], mode: str, max_new_tokens: int = 180) -> dict[str, Any]:
    model, processor, model_id, device = _load_model(mode)

    import torch
    dtype = torch.float16 if device == "cuda" else torch.float32
    has_presampled_video = any(
        content.get("type") == "video" and isinstance(content.get("path"), list)
        for message in messages
        for content in message.get("content", [])
        if isinstance(content, dict)
    )
    processor_kwargs = (
        {"do_sample_frames": False}
        if has_presampled_video
        else None
    )
    inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
        processor_kwargs=processor_kwargs,
    )
    inputs = inputs.to(model.device, dtype=dtype)

    with torch.inference_mode():
        generated_ids = model.generate(
            **inputs,
            do_sample=False,
            max_new_tokens=max_new_tokens,
        )

    input_length = inputs["input_ids"].shape[-1]
    generated = generated_ids[:, input_length:]
    text = processor.batch_decode(generated, skip_special_tokens=True)[0].strip()
    return {
        "text": text,
        "model": model_id,
        "device": device,
    }


def _sample_clip_frames(
    clip_path: str | Path,
    output_dir: str | Path,
    max_frames: int = 12,
) -> list[str]:
    import av

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    frames: list[str] = []

    with av.open(str(Path(clip_path))) as container:
        for frame in container.decode(video=0):
            if len(frames) >= max_frames:
                break
            path = destination / f"frame-{len(frames):03d}.jpg"
            frame.to_image().save(path, "JPEG", quality=86)
            frames.append(str(path))

    if not frames:
        raise RuntimeError("Video clip produced no decodable frames.")
    return frames


def describe_clip(
    clip_path: str | Path,
    mode: str = "auto",
) -> dict[str, Any]:
    prompt = (
        "Describe only what visibly happens in this video clip. "
        "Mention the main subjects, actions, reactions, major camera/scene changes, "
        "and visible on-screen text if important. Be concrete and concise. "
        "Do not invent events that are not visible."
    )

    with tempfile.TemporaryDirectory(prefix="videomagic-frames-") as directory:
        frame_paths = _sample_clip_frames(clip_path, directory)
        return _run(
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "video", "path": frame_paths},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            mode,
            max_new_tokens=110,
        )


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    first = cleaned.find("{")
    last = cleaned.rfind("}")
    if first < 0 or last <= first:
        raise ValueError("Local video model did not return a JSON edit plan.")
    return json.loads(cleaned[first : last + 1])


def plan_edit(
    scenes: list[dict[str, Any]],
    instruction: str,
    mode: str = "auto",
) -> dict[str, Any]:
    if not scenes:
        raise ValueError("Video analysis contains no scenes.")
    if not instruction.strip():
        raise ValueError("Editing instruction is empty.")

    compact = [
        {
            "id": scene["id"],
            "start": scene["start"],
            "end": scene["end"],
            "description": scene["description"],
        }
        for scene in scenes
    ]

    prompt = f"""
You are a local video editor. Select and order scenes to satisfy the user's edit request.
You MUST only use scene IDs from the supplied scene index. Never invent timestamps.
Prefer the fewest scenes that satisfy the request. Preserve source order unless the user
clearly asks for a montage or reorder.

USER REQUEST:
{instruction.strip()}

SCENE INDEX:
{json.dumps(compact, ensure_ascii=False)}

Return JSON only with this exact schema:
{{
  "sceneIds": ["scene-001"],
  "summary": "short explanation",
  "title": "optional short title"
}}
""".strip()

    result = _run(
        [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        mode,
        max_new_tokens=180,
    )
    parsed = _extract_json(result["text"])

    valid_ids = {scene["id"] for scene in scenes}
    selected_ids = [
        str(scene_id)
        for scene_id in parsed.get("sceneIds", [])
        if str(scene_id) in valid_ids
    ]
    if not selected_ids:
        raise ValueError("Local video model did not select any valid scenes.")

    scene_map = {scene["id"]: scene for scene in scenes}
    selected = [scene_map[scene_id] for scene_id in selected_ids]
    summary = str(parsed.get("summary") or "").strip()
    title = str(parsed.get("title") or "").strip()
    if summary.lower() in {"short explanation", "brief explanation"}:
        summary = ""
    if title.lower() in {"optional short title", "short title"}:
        title = ""

    return {
        "sceneIds": selected_ids,
        "segments": [
            {
                "sceneId": scene["id"],
                "start": float(scene["start"]),
                "end": float(scene["end"]),
                "description": scene["description"],
            }
            for scene in selected
        ],
        "summary": summary,
        "title": title,
        "model": result["model"],
        "device": result["device"],
    }
