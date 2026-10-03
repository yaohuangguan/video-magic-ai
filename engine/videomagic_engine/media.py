from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def probe_video(video_path: str | Path) -> dict[str, Any]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("ffprobe was not found in PATH.")

    source = str(Path(video_path))
    completed = _run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=index,codec_type,codec_name,width,height",
            "-of",
            "json",
            source,
        ]
    )
    data = json.loads(completed.stdout)
    streams = data.get("streams", [])
    duration = float(data.get("format", {}).get("duration") or 0)
    return {
        "path": source,
        "durationSeconds": duration,
        "hasAudio": any(stream.get("codec_type") == "audio" for stream in streams),
        "streams": streams,
    }


def mix_voiceover(
    video_path: str | Path,
    narration_path: str | Path,
    output_path: str | Path,
    original_volume: float = 0.24,
) -> dict[str, Any]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found in PATH.")

    if not 0 <= original_volume <= 1:
        raise ValueError("original_volume must be between 0 and 1.")

    video = Path(video_path)
    narration = Path(narration_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    info = probe_video(video)
    duration = max(info["durationSeconds"], 0.01)

    if info["hasAudio"]:
        command = [
            ffmpeg,
            "-y",
            "-i",
            str(video),
            "-i",
            str(narration),
            "-filter_complex",
            (
                f"[0:a]volume={original_volume}[bg];"
                "[1:a]volume=1.0,apad[voice];"
                "[bg][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
            ),
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(output),
        ]
    else:
        command = [
            ffmpeg,
            "-y",
            "-i",
            str(video),
            "-i",
            str(narration),
            "-filter_complex",
            "[1:a]apad[a]",
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-t",
            f"{duration:.3f}",
            "-movflags",
            "+faststart",
            str(output),
        ]

    completed = _run(command)
    return {
        "path": str(output),
        "videoDurationSeconds": duration,
        "originalVolume": original_volume,
        "ffmpegTail": completed.stderr.splitlines()[-10:],
    }
