from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _media_tool(name: str) -> str | None:
    home = os.environ.get("VIDEOMAGIC_HOME")
    if home:
        executable = f"{name}.exe" if os.name == "nt" else name
        local = Path(home) / "tools" / "ffmpeg" / "bin" / executable
        if local.exists():
            return str(local)

    return shutil.which(name)


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
    ffprobe = _media_tool("ffprobe")
    if not ffprobe:
        raise RuntimeError("ffprobe was not found.")

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


def _subtitle_filter(path: str | Path) -> str:
    normalized = Path(path).resolve().as_posix()
    normalized = normalized.replace(":", r"\:")
    normalized = normalized.replace("'", r"\'")
    style = (
        "FontName=Segoe UI,"
        "FontSize=24,"
        "PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,"
        "BorderStyle=1,"
        "Outline=2,"
        "Shadow=0,"
        "Alignment=2,"
        "MarginV=38"
    )
    return f"subtitles='{normalized}':force_style='{style}'"


def _video_encoder_args(ffmpeg: str, burn_subtitles: bool) -> list[str]:
    if not burn_subtitles:
        return ["-c:v", "copy"]

    has_nvidia = shutil.which("nvidia-smi") is not None
    if has_nvidia:
        try:
            encoders = _run([ffmpeg, "-hide_banner", "-encoders"]).stdout
            if "h264_nvenc" in encoders:
                return [
                    "-c:v",
                    "h264_nvenc",
                    "-preset",
                    "p5",
                    "-cq",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                ]
        except Exception:
            pass

    return [
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
    ]


def mix_voiceover(
    video_path: str | Path,
    narration_path: str | Path,
    output_path: str | Path,
    original_volume: float = 0.24,
    ducking: bool = True,
    subtitle_path: str | Path | None = None,
) -> dict[str, Any]:
    ffmpeg = _media_tool("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found.")

    if not 0 <= original_volume <= 1:
        raise ValueError("original_volume must be between 0 and 1.")

    video = Path(video_path)
    narration = Path(narration_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    info = probe_video(video)
    duration = max(info["durationSeconds"], 0.01)
    burn_subtitles = bool(subtitle_path)
    video_args = _video_encoder_args(ffmpeg, burn_subtitles)

    command = [
        ffmpeg,
        "-y",
        "-i",
        str(video),
        "-i",
        str(narration),
    ]

    if burn_subtitles:
        command.extend(["-vf", _subtitle_filter(subtitle_path)])

    if info["hasAudio"]:
        if ducking:
            audio_filter = (
                f"[0:a]volume={original_volume}[source];"
                "[1:a]volume=1.0,apad[voice];"
                "[source][voice]sidechaincompress="
                "threshold=0.015:ratio=10:attack=15:release=320:makeup=1[ducked];"
                "[ducked][voice]amix=inputs=2:duration=first:"
                "dropout_transition=0:normalize=0[a]"
            )
        else:
            audio_filter = (
                f"[0:a]volume={original_volume}[source];"
                "[1:a]volume=1.0,apad[voice];"
                "[source][voice]amix=inputs=2:duration=first:"
                "dropout_transition=0:normalize=0[a]"
            )

        command.extend(
            [
                "-filter_complex",
                audio_filter,
                "-map",
                "0:v:0",
                "-map",
                "[a]",
            ]
        )
    else:
        command.extend(
            [
                "-filter_complex",
                "[1:a]apad[a]",
                "-map",
                "0:v:0",
                "-map",
                "[a]",
                "-t",
                f"{duration:.3f}",
            ]
        )

    command.extend(video_args)
    command.extend(
        [
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )

    completed = _run(command)
    return {
        "path": str(output),
        "videoDurationSeconds": duration,
        "originalVolume": original_volume,
        "ducking": ducking,
        "subtitlesBurned": burn_subtitles,
        "videoEncoder": video_args[1] if len(video_args) > 1 else None,
        "ffmpegTail": completed.stderr.splitlines()[-12:],
    }
