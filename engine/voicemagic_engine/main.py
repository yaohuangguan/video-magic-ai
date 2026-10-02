from __future__ import annotations

import json
import shutil
import sys
from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class EngineResponse:
    id: str | None
    type: str
    result: Any = None
    error: str | None = None


def emit(response: EngineResponse) -> None:
    sys.stdout.write(json.dumps(asdict(response), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def doctor() -> dict[str, Any]:
    return {
        "engineVersion": "0.1.0",
        "python": sys.version.split()[0],
        "ffmpeg": shutil.which("ffmpeg"),
        "ffprobe": shutil.which("ffprobe"),
        "tts": {
            "provider": "gpt-sovits",
            "status": "not-installed",
        },
    }


def handle(message: dict[str, Any]) -> Any:
    method = message.get("method")
    if method == "ping":
        return {"ok": True}
    if method == "doctor":
        return doctor()
    if method == "render":
        raise RuntimeError("render pipeline is not wired yet")
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
            result = handle(message)
            emit(EngineResponse(id=request_id, type="result", result=result))
        except Exception as exc:
            emit(EngineResponse(id=request_id, type="error", error=str(exc)))


if __name__ == "__main__":
    main()
