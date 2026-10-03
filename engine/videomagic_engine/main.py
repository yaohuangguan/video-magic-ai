from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .media import mix_voiceover, probe_video
from .tts import synthesize
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
        "engineVersion": "0.1.0",
        "python": sys.version.split()[0],
        "ffmpeg": shutil.which("ffmpeg"),
        "ffprobe": shutil.which("ffprobe"),
        "videomagicHome": os.environ.get("VIDEOMAGIC_HOME"),
        "kokoroInstalled": importlib.util.find_spec("kokoro") is not None,
        "gpu": _gpu_info(),
    }


def _default_output(name: str) -> Path:
    home = Path(
        os.environ.get(
            "VIDEOMAGIC_HOME",
            str(Path.home() / ".videomagic"),
        )
    )
    output_dir = home / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return output_dir / f"{stamp}-{name}"


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
    if method == "synthesize":
        output = params.get("outputPath") or str(_default_output("narration.wav"))
        emit_progress(request_id, "tts", 0.05, "Loading local Mandarin voice model")
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
        narration_path = params.get("narrationPath")
        if not narration_path:
            narration_path = str(_default_output("narration.wav"))
            emit_progress(request_id, "tts", 0.05, "Generating narration")
            synthesize(
                text=params["text"],
                output_path=narration_path,
                voice=params.get("voice", "zm_010"),
                speed=float(params.get("speed", 1.0)),
            )

        output_path = params.get("outputPath") or str(_default_output("video.mp4"))
        emit_progress(request_id, "mix", 0.72, "Mixing narration with source audio")
        mix = mix_voiceover(
            video_path=video_path,
            narration_path=narration_path,
            output_path=output_path,
            original_volume=float(params.get("originalVolume", 0.24)),
        )
        emit_progress(request_id, "done", 1.0, "Video ready")
        return {
            "video": mix,
            "narrationPath": narration_path,
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
