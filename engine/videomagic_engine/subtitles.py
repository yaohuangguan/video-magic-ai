from __future__ import annotations

from pathlib import Path
from typing import Any


def _timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def write_srt(
    timeline: list[dict[str, Any]],
    output_path: str | Path,
) -> dict[str, Any]:
    if not timeline:
        raise ValueError("Cannot create subtitles without a narration timeline.")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    blocks: list[str] = []
    for index, item in enumerate(timeline, start=1):
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        start = float(item.get("start") or 0)
        end = max(float(item.get("end") or start + 0.2), start + 0.2)
        blocks.append(
            f"{index}\n{_timestamp(start)} --> {_timestamp(end)}\n{text}\n"
        )

    output.write_text("\n".join(blocks), encoding="utf-8")
    return {
        "path": str(output),
        "entries": len(blocks),
    }
