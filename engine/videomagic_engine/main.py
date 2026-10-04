from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .media import (
    extract_analysis_clip,
    mix_voiceover,
    probe_video,
    render_edit_plan,
    scene_windows,
    waveform_peaks,
)
from .subtitles import write_srt
from .tts import (
    plan_timeline,
    release_pipelines,
    synthesize,
    synthesize_timed,
    synthesize_timeline,
)
from .vision import describe_clip, plan_edit, release_model as release_vision_model
from .voices import VOICES


@dataclass
class EngineResponse:
    id: str | None
    type: str
    result: Any = None
    error: str | None = None


def emit(response: EngineResponse) -> None:
    sys.stdout.write(json.dumps(asdict(response), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_progress(request_id: str | None, stage: str, progress: float, message: str) -> None:
    emit(
        EngineResponse(
            id=request_id,
            type="progress",
            result={
                "stage": stage,
                "progress": progress,
                "message": message,
            },
        )
    )


def _gpu_info() -> dict[str, Any]:
    try:
        import torch

        available = bool(torch.cuda.is_available())
        return {
            "cudaAvailable": available,
            "device": torch.cuda.get_device_name(0) if available else None,
            "torchVersion": getattr(torch, "__version__", None),
        }
    except Exception as exc:
        return {
            "cudaAvailable": False,
            "device": None,
            "error": str(exc),
        }


def doctor() -> dict[str, Any]:
    return {
        "engineVersion": "0.2.0",
        "python": sys.version.split()[0],
        "ffmpeg": shutil.which("ffmpeg"),
        "ffprobe": shutil.which("ffprobe"),
        "videomagicHome": os.environ.get("VIDEOMAGIC_HOME"),
        "kokoroInstalled": importlib.util.find_spec("kokoro") is not None,
        "visionInstalled": (
            importlib.util.find_spec("transformers") is not None
            and importlib.util.find_spec("torchvision") is not None
            and importlib.util.find_spec("av") is not None
        ),
        "gpu": _gpu_info(),
    }


def _home() -> Path:
    return Path(
        os.environ.get(
            "VIDEOMAGIC_HOME",
            str(Path.home() / ".videomagic"),
        )
    )


def _default_output(name: str) -> Path:
    output_dir = _home() / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return output_dir / f"{stamp}-{name}"


def _analyze_video(
    video_path: str,
    request_id: str | None,
    vision_mode: str = "auto",
) -> dict[str, Any]:
    info = probe_video(video_path)
    duration = max(float(info["durationSeconds"]), 0.01)
    windows = scene_windows(duration)

    release_pipelines()

    analysis_root = _home() / "tmp" / "vision-analysis" / (
        request_id or f"analysis-{int(time.time() * 1000)}"
    )
    analysis_root.mkdir(parents=True, exist_ok=True)

    scenes: list[dict[str, Any]] = []
    model_id: str | None = None
    device: str | None = None

    try:
        total = max(len(windows), 1)
        for index, window in enumerate(windows):
            scene_id = str(window["id"])
            start = float(window["start"])
            end = float(window["end"])
            emit_progress(
                request_id,
                "vision",
                0.08 + (index / total) * 0.60,
                f"Understanding scene {index + 1} of {len(windows)}",
            )

            clip_path = analysis_root / f"{scene_id}.mp4"
            extract_analysis_clip(video_path, start, end, clip_path)
            result = describe_clip(clip_path, mode=vision_mode)
            clip_path.unlink(missing_ok=True)

            model_id = str(result.get("model") or model_id or "")
            device = str(result.get("device") or device or "")
            scenes.append(
                {
                    "id": scene_id,
                    "start": start,
                    "end": end,
                    "description": str(result.get("text") or "").strip(),
                }
            )
    finally:
        shutil.rmtree(analysis_root, ignore_errors=True)

    return {
        "videoPath": video_path,
        "durationSeconds": duration,
        "scenes": scenes,
        "sceneCount": len(scenes),
        "model": model_id,
        "device": device,
        "visionMode": vision_mode,
    }


def handle(message: dict[str, Any], request_id: str | None) -> Any:
    method = message.get("method")
    params = message.get("params") or {}

    if method == "ping":
        return {"ok": True}
    if method == "doctor":
        return doctor()
    if method == "voices":
        return {"voices": VOICES}
    if method == "probe_video":
        return probe_video(params["videoPath"])

    if method == "analyze_video":
        emit_progress(request_id, "vision", 0.03, "Preparing local video understanding")
        result = _analyze_video(
            video_path=params["videoPath"],
            request_id=request_id,
            vision_mode=str(params.get("visionMode", "auto")),
        )
        emit_progress(request_id, "vision", 0.72, "Scene index ready")
        return result

    if method == "plan_edit":
        release_pipelines()
        emit_progress(request_id, "edit-plan", 0.74, "Planning edit from scene index")
        result = plan_edit(
            scenes=list(params.get("scenes") or []),
            instruction=str(params.get("instruction") or ""),
            mode=str(params.get("visionMode", "auto")),
        )
        emit_progress(request_id, "edit-plan", 0.84, "Edit plan ready")
        return result

    if method == "ai_edit":
        video_path = params["videoPath"]
        vision_mode = str(params.get("visionMode", "auto"))
        scenes = list(params.get("scenes") or [])
        analysis = None

        if not scenes:
            emit_progress(request_id, "vision", 0.03, "Understanding source video")
            analysis = _analyze_video(video_path, request_id, vision_mode)
            scenes = list(analysis["scenes"])

        release_pipelines()
        emit_progress(request_id, "edit-plan", 0.70, "Choosing the best scenes")
        plan = plan_edit(
            scenes=scenes,
            instruction=str(params.get("instruction") or ""),
            mode=vision_mode,
        )

        release_vision_model()
        emit_progress(request_id, "edit-render", 0.86, "Rendering AI edit")
        output_path = params.get("outputPath") or str(_default_output("ai-edit.mp4"))
        rendered = render_edit_plan(
            video_path=video_path,
            segments=list(plan["segments"]),
            output_path=output_path,
        )
        emit_progress(request_id, "done", 1.0, "AI edit ready")
        return {
            "analysis": analysis,
            "plan": plan,
            "video": rendered,
        }

    if method == "waveform":
        return waveform_peaks(
            params["videoPath"],
            int(params.get("points", 240)),
        )

    if method == "plan_timeline":
        return plan_timeline(
            text=params["text"],
            target_duration=float(params["targetDuration"]),
        )

    if method == "synthesize":
        release_vision_model()
        output = params.get("outputPath") or str(_default_output("narration.wav"))
        emit_progress(request_id, "tts", 0.05, "Loading local voice model")
        result = synthesize(
            text=params["text"],
            output_path=output,
            voice=params.get("voice", "zm_010"),
            speed=float(params.get("speed", 1.0)),
        )
        emit_progress(request_id, "tts", 1.0, "Narration generated")
        return result

    if method == "render":
        release_vision_model()
        video_path = params["videoPath"]
        auto_timing = bool(params.get("autoTiming", True))
        subtitles_enabled = bool(params.get("subtitles", True))

        emit_progress(request_id, "probe", 0.03, "Reading source video")
        video_info = probe_video(video_path)
        video_duration = max(float(video_info["durationSeconds"]), 0.5)

        narration_path = params.get("narrationPath")
        tts_result: dict[str, Any] | None = None

        if not narration_path:
            narration_path = str(_default_output("narration.wav"))
            emit_progress(request_id, "tts", 0.08, "Generating local narration")

            custom_timeline = params.get("timeline")
            if custom_timeline:
                tts_result = synthesize_timeline(
                    segments=custom_timeline,
                    output_path=narration_path,
                    target_duration=video_duration,
                    voice=params.get("voice", "zm_010"),
                    speed=float(params.get("speed", 1.0)),
                )
            elif auto_timing:
                tts_result = synthesize_timed(
                    text=params["text"],
                    output_path=narration_path,
                    target_duration=max(video_duration * 0.98, 0.5),
                    voice=params.get("voice", "zm_010"),
                    speed=float(params.get("speed", 1.0)),
                )
            else:
                tts_result = synthesize(
                    text=params["text"],
                    output_path=narration_path,
                    voice=params.get("voice", "zm_010"),
                    speed=float(params.get("speed", 1.0)),
                )

            emit_progress(request_id, "tts", 0.64, "Narration timeline ready")

        subtitle_result: dict[str, Any] | None = None
        subtitle_path: str | None = None

        if subtitles_enabled and tts_result and tts_result.get("timeline"):
            emit_progress(request_id, "subtitles", 0.70, "Building synchronized subtitles")
            subtitle_path = str(_default_output("subtitles.srt"))
            subtitle_result = write_srt(tts_result["timeline"], subtitle_path)

        output_path = params.get("outputPath") or str(_default_output("video.mp4"))
        emit_progress(
            request_id,
            "mix",
            0.78,
            "Ducking source audio and rendering final video"
            if subtitles_enabled
            else "Ducking source audio and mixing narration",
        )

        mix = mix_voiceover(
            video_path=video_path,
            narration_path=narration_path,
            output_path=output_path,
            original_volume=float(params.get("originalVolume", 0.24)),
            ducking=bool(params.get("ducking", True)),
            subtitle_path=subtitle_path,
        )

        emit_progress(request_id, "done", 1.0, "Video ready")
        return {
            "video": mix,
            "narrationPath": narration_path,
            "narration": tts_result,
            "subtitlePath": subtitle_path,
            "subtitles": subtitle_result,
        }

    raise ValueError(f"Unknown method: {method}")


def main() -> None:
    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        request_id: str | None = None
        try:
            message = json.loads(raw_line)
            request_id = message.get("id")
            result = handle(message, request_id)
            emit(EngineResponse(id=request_id, type="result", result=result))
        except Exception as exc:
            emit(EngineResponse(id=request_id, type="error", error=str(exc)))


if __name__ == "__main__":
    main()
