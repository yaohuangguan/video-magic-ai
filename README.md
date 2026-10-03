# VideoMagic

Local-first AI commentary studio for turning a source video and narration script into a finished voiceover video.

## V0.1 — Windows first

Current working flow:

1. Import a local video.
2. Paste a Mandarin commentary script.
3. Pick a local voice preset.
4. Generate speech locally with Kokoro.
5. Split Mandarin scripts into sentence-level narration segments and fit them to the clip duration.
6. Optionally switch to the visual creator timeline and drag narration segments to exact positions.
7. Preview the local source video and seek it directly from the narration timeline.
8. Generate synchronized subtitles from the same narration timeline.
9. Apply narration-aware source-audio ducking.
10. Burn subtitles with GPU-accelerated H.264 when available.
11. Stream render progress to the desktop UI and allow cancellation.
12. Export a finished H.264/AAC MP4 to a user-selected folder.

The source video never needs to be uploaded for the core workflow. Voice presets can be previewed before rendering.

The desktop workspace also supports drag-and-drop import, secure local video preview, a persistent sentence-level creator timeline, autosave/restore, native `.vmagic` project files, explicit Open/Save/Save As, recent-project recall, persistent render history, reusable creator presets, custom export folders, desktop keyboard shortcuts, selectable Auto/GPU/CPU inference, and a warm local AI worker for fast repeated previews/renders.

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
- video + Mandarin script -> mixed MP4 using only the portable runtime;
- smart sidechain ducking;
- render progress events;
- cancellable render process tree;
- local voice preview returned directly to the UI;
- custom export-folder selection;
- automatic narration timing and speed fitting;
- synchronized SRT generation;
- burned-in Chinese subtitles;
- NVIDIA H.264 subtitle rendering when available;
- explicit CPU inference mode;
- automatic CUDA-to-CPU fallback in Auto mode;
- recent project persistence in native app config;
- reusable creator presets;
- repair-in-place runtime recovery;
- secure Tauri asset-protocol video preview with per-selected-file runtime scope;
- draggable sentence-level narration timeline persisted in `.vmagic` projects;
- custom timeline rendering where narration audio is physically placed at edited start times;
- source-audio waveform extraction rendered behind the narration track;
- direct drag and left/right resize handles for narration timing windows;
- persistent render history and reusable export settings;
- persistent warm Kokoro worker across preview/render requests.

A real 12-second end-to-end render has been completed from the bootstrapped runtime without using the development venv or system FFmpeg. A custom two-segment timeline was also rendered successfully with narration starting at 1.0s and 7.0s; waveform checks confirmed silence outside the edited narration windows. On the RTX 2080 SUPER, repeated TTS on a warm worker measured about 0.18s after a roughly 14.4s cold start in the test case.

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
│       ├── subtitles.py
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

A manual **Windows Package** GitHub Actions workflow builds the unsigned NSIS installer on `windows-latest` and uploads it as a downloadable workflow artifact. Public distribution still needs Windows code signing and updater hardening.

## First-run runtime bootstrap

The NSIS installer stays small and ships the desktop shell, bootstrap script, and VideoMagic Python engine source. On first setup, the user chooses a parent folder for heavy AI data.

VideoMagic then installs into that data directory:

- uv and a managed Python 3.11 runtime;
- a dedicated Python venv;
- CUDA PyTorch when NVIDIA is available, otherwise the CPU wheel;
- Kokoro / Misaki and the VideoMagic engine;
- FFmpeg / FFprobe;
- Hugging Face, Torch, pip, Python and temporary caches.

The bootstrap has been verified end to end on Windows and the installed NSIS resources have been used successfully. The desktop UI can rerun setup against the existing data directory as a repair operation. The remaining release check is a true clean-machine/VM test, code signing, and updater hardening.

## Product principles

- Local by default.
- Keep source video on the user's computer for the core workflow.
- Keep the one-click path excellent while adding timeline controls progressively instead of forcing every user into manual editing.
- Keep voice engines modular.
- Do not impersonate a real person's voice without permission.
