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

Verified on the Windows development PC:

- managed Python 3.11.17 installed by VideoMagic bootstrap;
- PyTorch 2.11.0 + CUDA 12.8;
- NVIDIA RTX 2080 SUPER;
- Kokoro 0.9.4 + Misaki Chinese frontend;
- app-local FFmpeg / FFprobe;
- Tauri 2 release build and NSIS installer;
- installer resources for bootstrap + Python engine;
- Mandarin text -> WAV;
- video + Mandarin script -> mixed MP4 using only the portable runtime.

A real 12-second end-to-end render has been completed from the bootstrapped runtime without using the development venv or system FFmpeg.

## Local storage

Large runtime data is kept outside the C drive on the current Windows development setup.

```text
E:\Coding\videomagic
E:\Coding\videomagic-data
├── cache
├── exports
├── models
├── outputs
├── runtime
│   ├── python
│   └── venv
├── tmp
└── tools
    └── ffmpeg
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

## First-run runtime bootstrap

The NSIS installer stays small and ships the desktop shell, bootstrap script, and VideoMagic Python engine source. On first setup, the user chooses a parent folder for heavy AI data.

VideoMagic then installs into that data directory:

- uv and a managed Python 3.11 runtime;
- a dedicated Python venv;
- CUDA PyTorch when NVIDIA is available, otherwise the CPU wheel;
- Kokoro / Misaki and the VideoMagic engine;
- FFmpeg / FFprobe;
- Hugging Face, Torch, pip, Python and temporary caches.

The bootstrap has been verified end to end on Windows and the installed NSIS resources have been used successfully. The remaining release check is a true clean-machine/VM test plus better visible setup progress and recovery UX.

## Product principles

- Local by default.
- Keep source video on the user's computer for the core workflow.
- Make the one-click path excellent before building a full timeline editor.
- Keep voice engines modular.
- Do not impersonate a real person's voice without permission.
