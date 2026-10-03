# VideoMagic

Local-first AI commentary studio for turning a source video and narration script into a finished voiceover video.

## V0.1 — Windows first

Current working flow:

1. Import a local video.
2. Paste a Mandarin commentary script.
3. Pick a local voice preset.
4. Generate speech locally with Kokoro.
5. Lower and mix the source audio with FFmpeg.
6. Export a finished H.264/AAC MP4.

The source video never needs to be uploaded for the core workflow.

## Current implementation

```text
React + TypeScript
      |
      v
Tauri 2
      |
      v
Rust command bridge
      |
      v
Python 3.11 local engine
   |              |
   v              v
Kokoro 82M      FFmpeg
Mandarin TTS    probe / mix / export
```

Kokoro is the V0.1 fixed-voice engine because it is small enough for a fast local MVP and works on the current Windows CUDA setup.

GPT-SoVITS remains a planned pluggable engine for custom voice cloning, dialect/style voices, and stronger character voices. The UI and engine are intentionally separated so voice engines can be swapped without rewriting the desktop app.

See `docs/engine-protocol.md`.

## Verified on Windows

Verified on the development PC:

- Python 3.11.9
- PyTorch 2.11.0 + CUDA 12.8
- NVIDIA RTX 2080 SUPER
- Kokoro 0.9.4 + Misaki Chinese frontend
- FFmpeg / FFprobe
- Tauri 2 release build
- NSIS installer build
- Mandarin text -> WAV
- video + Mandarin script -> mixed MP4

A real 12-second end-to-end render has been completed successfully with CUDA TTS and FFmpeg mixing.

## Local storage

Large runtime data is kept outside the C drive on the current Windows development setup.

```text
E:\Coding\videomagic
E:\Coding\videomagic-data
├── cache
├── exports
├── models
├── outputs
└── tmp
```

The engine also supports:

- `VIDEOMAGIC_HOME`
- `VIDEOMAGIC_ENGINE_PYTHON`
- `HF_HOME`
- `TORCH_HOME`

Local virtual environments, model caches, render outputs, and Cargo targets are ignored by Git.

## Repository

```text
videomagic/
├── src/                       React UI
├── src-tauri/                 Tauri / Rust desktop bridge
├── engine/
│   ├── pyproject.toml
│   └── videomagic_engine/
│       ├── main.py
│       ├── media.py
│       ├── tts.py
│       └── voices.py
└── docs/
    └── engine-protocol.md
```

## Development

Frontend:

```bash
pnpm install
pnpm build
```

Windows desktop development also requires Rust, MSVC Build Tools, the Windows SDK, and WebView2.

The local Python engine currently uses a project venv during development. This is intentionally not committed.

## Current release blocker

The generated NSIS installer currently packages the Tauri desktop shell, but it does **not yet package or bootstrap the full Python/PyTorch/Kokoro runtime**.

That means the current installer is a development artifact, not yet a standalone installer for a clean Windows PC.

The next release milestone is a first-run runtime bootstrap (or packaged sidecar) that installs/downloads the local AI runtime into the user's chosen data directory without requiring a preinstalled Python environment.

## Product principles

- Local by default.
- Keep source video on the user's computer for the core workflow.
- Make the one-click path excellent before building a full timeline editor.
- Keep voice engines modular.
- Do not impersonate a real person's voice without permission.
