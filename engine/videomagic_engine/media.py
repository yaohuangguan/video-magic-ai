from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import numpy as np


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


def waveform_peaks(
    video_path: str | Path,
    points: int = 240,
) -> dict[str, Any]:
    ffmpeg = _media_tool("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found.")

    info = probe_video(video_path)
    count = max(64, min(int(points), 800))
    if not info["hasAudio"]:
        return {
            "peaks": [0.0] * count,
            "points": count,
            "durationSeconds": info["durationSeconds"],
            "hasAudio": False,
        }

    command = [
        ffmpeg,
        "-v",
        "error",
        "-i",
        str(Path(video_path)),
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
    ]
    completed = subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    samples = np.frombuffer(completed.stdout, dtype="<f4")
    if samples.size == 0:
        peaks = np.zeros(count, dtype=np.float32)
    else:
        chunks = np.array_split(np.abs(samples), count)
        peaks = np.array(
            [float(np.max(chunk)) if chunk.size else 0.0 for chunk in chunks],
            dtype=np.float32,
        )
        ceiling = float(np.max(peaks)) if peaks.size else 0.0
        if ceiling > 1e-6:
            peaks = np.clip(peaks / ceiling, 0.0, 1.0)

    return {
        "peaks": [round(float(value), 4) for value in peaks],
        "points": count,
        "durationSeconds": info["durationSeconds"],
        "hasAudio": True,
    }


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


def scene_windows(
    duration_seconds: float,
    target_chunk_seconds: float = 4.0,
    max_scenes: int = 24,
) -> list[dict[str, float | str]]:
    duration = max(float(duration_seconds), 0.0)
    if duration <= 0:
        return []

    target = max(2.5, min(float(target_chunk_seconds), 12.0))
    estimated = max(1, int(np.ceil(duration / target)))
    count = min(max_scenes, estimated)
    chunk = duration / count

    scenes: list[dict[str, float | str]] = []
    for index in range(count):
        start = chunk * index
        end = duration if index == count - 1 else chunk * (index + 1)
        scenes.append(
            {
                "id": f"scene-{index + 1:03d}",
                "start": round(start, 3),
                "end": round(end, 3),
            }
        )
    return scenes


def extract_analysis_clip(
    video_path: str | Path,
    start: float,
    end: float,
    output_path: str | Path,
) -> str:
    ffmpeg = _media_tool("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found.")

    if end <= start:
        raise ValueError("Analysis clip end must be after start.")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{end - start:.3f}",
        "-i",
        str(Path(video_path)),
        "-an",
        "-vf",
        "fps=2,scale=640:-2:force_original_aspect_ratio=decrease",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        str(output),
    ]
    _run(command)
    return str(output)


def clip_motion_score(video_path: str | Path) -> float:
    ffmpeg = _media_tool("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found.")

    completed = subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(Path(video_path)),
            "-an",
            "-vf",
            "fps=4,scale=160:90,format=gray",
            "-f",
            "rawvideo",
            "pipe:1",
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    frame_size = 160 * 90
    if len(completed.stdout) < frame_size * 2:
        return 0.0

    frames = np.frombuffer(completed.stdout, dtype=np.uint8)
    frame_count = frames.size // frame_size
    frames = frames[: frame_count * frame_size].reshape(frame_count, frame_size).astype(np.float32)

    differences = np.abs(np.diff(frames, axis=0))
    return round(float(np.mean(differences) / 255.0), 6)


def render_edit_plan(
    video_path: str | Path,
    segments: list[dict[str, Any]],
    output_path: str | Path,
) -> dict[str, Any]:
    ffmpeg = _media_tool("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found.")
    if not segments:
        raise ValueError("Edit plan has no segments.")

    video = Path(video_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    info = probe_video(video)
    duration = float(info["durationSeconds"])
    has_audio = bool(info["hasAudio"])

    normalized: list[dict[str, Any]] = []
    for index, segment in enumerate(segments):
        start = max(0.0, float(segment["start"]))
        end = min(duration, float(segment["end"]))
        if end <= start:
            raise ValueError(f"Edit segment {index + 1} has invalid timing.")
        normalized.append(
            {
                **segment,
                "start": start,
                "end": end,
            }
        )

    filters: list[str] = []
    concat_inputs: list[str] = []
    for index, segment in enumerate(normalized):
        start = segment["start"]
        end = segment["end"]
        filters.append(
            f"[0:v]trim=start={start:.3f}:end={end:.3f},"
            f"setpts=PTS-STARTPTS[v{index}]"
        )
        concat_inputs.append(f"[v{index}]")
        if has_audio:
            filters.append(
                f"[0:a]atrim=start={start:.3f}:end={end:.3f},"
                f"asetpts=PTS-STARTPTS[a{index}]"
            )
            concat_inputs.append(f"[a{index}]")

    if has_audio:
        filters.append(
            "".join(concat_inputs)
            + f"concat=n={len(normalized)}:v=1:a=1[vout][aout]"
        )
    else:
        filters.append(
            "".join(concat_inputs)
            + f"concat=n={len(normalized)}:v=1:a=0[vout]"
        )

    video_args = _video_encoder_args(ffmpeg, True)
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(video),
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[vout]",
    ]
    if has_audio:
        command.extend(["-map", "[aout]"])

    command.extend(video_args)
    if has_audio:
        command.extend(["-c:a", "aac", "-b:a", "192k"])
    command.extend(["-movflags", "+faststart", str(output)])

    completed = _run(command)
    return {
        "path": str(output),
        "segments": normalized,
        "segmentCount": len(normalized),
        "durationSeconds": sum(item["end"] - item["start"] for item in normalized),
        "hasAudio": has_audio,
        "videoEncoder": video_args[1] if len(video_args) > 1 else None,
        "ffmpegTail": completed.stderr.splitlines()[-12:],
    }
