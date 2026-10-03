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

from .director import intelligence_status, plan_video_edit
from .media import mix_voiceover, probe_video, render_edit_plan, waveform_peaks
from .subtitles import write_srt
from .tts import plan_timeline, synthesize, synthesize_timed, synthesize_timeline
from .voices import DEFAULT_VOICE, VOICES, voice_language


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
        "engineVersion": "0.1.0",
        "python": sys.version.split()[0],
        "ffmpeg": shutil.which("ffmpeg"),
        "ffprobe": shutil.which("ffprobe"),
        "videomagicHome": os.environ.get("VIDEOMAGIC_HOME"),
        "kokoroInstalled": importlib.util.find_spec("kokoro") is not None,
        "videoIntelligence": intelligence_status(),
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


def _voice_for_language(requested_voice: str, language: str) -> str:
    try:
        current_language = voice_language(requested_voice)
    except Exception:
        current_language = voice_language(DEFAULT_VOICE)
        requested_voice = DEFAULT_VOICE

    if language == "en":
        return requested_voice if current_language.startswith("en") else "af_heart"
    if language == "zh":
        return requested_voice if current_language == "zh" else "zm_010"
    return requested_voice


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

    if method == "waveform":
        return waveform_peaks(
            params["videoPath"],
            int(params.get("points", 240)),
        )

    if method == "plan_timeline":
        return plan_timeline(
            text=params["text"],
            target_duration=float(params["targetDuration"]),
            voice=params.get("voice", "zm_010"),
        )

    if method == "intelligence_status":
        return intelligence_status()

    if method == "plan_ai_edit":
        video_path = params["videoPath"]
        instruction = str(params.get("instruction") or "").strip()
        target_duration = params.get("targetDuration")
        narration_language = str(params.get("narrationLanguage") or "auto")

        emit_progress(
            request_id,
            "analyze",
            0.04,
            "Loading local Video AI model and understanding the source video",
        )
        plan = plan_video_edit(
            video_path=video_path,
            instruction=instruction,
            target_duration=float(target_duration) if target_duration else None,
            narration_language=narration_language,
        )
        emit_progress(request_id, "analyze", 1.0, "AI edit plan ready")
        return plan

    if method == "ai_edit":
        video_path = params["videoPath"]
        instruction = str(params.get("instruction") or "").strip()
        target_duration = params.get("targetDuration")
        narration_language = str(params.get("narrationLanguage") or "auto")
        requested_voice = str(params.get("voice") or DEFAULT_VOICE)

        emit_progress(
            request_id,
            "analyze",
            0.04,
            "Loading local Video AI model and understanding the source video",
        )
        plan = plan_video_edit(
            video_path=video_path,
            instruction=instruction,
            target_duration=float(target_duration) if target_duration else None,
            narration_language=narration_language,
        )

        emit_progress(request_id, "edit", 0.40, "Cutting selected source moments")
        roughcut_path = _default_output("ai-roughcut.mp4")
        roughcut = render_edit_plan(
            video_path=video_path,
            clips=plan["clips"],
            output_path=roughcut_path,
        )
        edited_duration = max(float(roughcut["videoDurationSeconds"]), 0.5)

        narration_segments = [
            {
                "id": clip["id"],
                "text": clip["narration"],
                "start": clip["outputStart"],
                "end": clip["outputEnd"],
            }
            for clip in plan["clips"]
            if str(clip.get("narration") or "").strip()
        ]

        output_path = Path(
            params.get("outputPath") or str(_default_output("ai-video.mp4"))
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)

        tts_result: dict[str, Any] | None = None
        subtitle_result: dict[str, Any] | None = None
        subtitle_path: str | None = None
        narration_path: str | None = None

        if narration_segments:
            plan_language = str(plan.get("narrationLanguage") or "zh")
            voice = _voice_for_language(requested_voice, plan_language)
            narration_path = str(_default_output("ai-narration.wav"))

            emit_progress(request_id, "tts", 0.58, "Generating AI narration")
            try:
                tts_result = synthesize_timeline(
                    segments=narration_segments,
                    output_path=narration_path,
                    target_duration=edited_duration,
                    voice=voice,
                    speed=float(params.get("speed", 1.0)),
                )
            except ValueError:
                fallback_text = " ".join(
                    segment["text"] for segment in narration_segments
                )
                tts_result = synthesize_timed(
                    text=fallback_text,
                    output_path=narration_path,
                    target_duration=edited_duration,
                    voice=voice,
                    speed=float(params.get("speed", 1.0)),
                )

            if bool(params.get("subtitles", True)) and tts_result.get("timeline"):
                emit_progress(
                    request_id,
                    "subtitles",
                    0.70,
                    "Building synchronized subtitles",
                )
                subtitle_path = str(_default_output("ai-subtitles.srt"))
                subtitle_result = write_srt(tts_result["timeline"], subtitle_path)

            emit_progress(request_id, "mix", 0.80, "Mixing narration and final video")
            final_video = mix_voiceover(
                video_path=roughcut_path,
                narration_path=narration_path,
                output_path=output_path,
                original_volume=float(params.get("originalVolume", 0.24)),
                ducking=bool(params.get("ducking", True)),
                subtitle_path=subtitle_path,
            )
        else:
            shutil.copy2(roughcut_path, output_path)
            final_video = probe_video(output_path)
            final_video["path"] = str(output_path)

        try:
            roughcut_path.unlink(missing_ok=True)
        except Exception:
            pass

        emit_progress(request_id, "done", 1.0, "AI edit ready")
        return {
            "video": final_video,
            "editPlan": plan,
            "narrationPath": narration_path,
            "narration": tts_result,
            "subtitlePath": subtitle_path,
            "subtitles": subtitle_result,
        }

    if method == "synthesize":
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
            emit_progress(request_id, "tts", 0.08, "Generating narration")

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
