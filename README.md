# VideoMagic

Local-first AI video editor and commentary studio. Import a video, let an open-source video model understand it, describe the cut you want, then add Mandarin or English narration and render locally.

[Website](https://videomagic.pages.dev/) · [Download Windows](https://github.com/yaohuangguan/video-magic-ai/releases/latest/download/VideoMagic-Windows-x64-setup.exe) · [Releases](https://github.com/yaohuangguan/video-magic-ai/releases) · [Roadmap](ROADMAP.md) · [Support](SUPPORT.md)

![Windows CI](https://github.com/yaohuangguan/video-magic-ai/actions/workflows/windows-ci.yml/badge.svg)
![Latest Release](https://img.shields.io/github/v/release/yaohuangguan/video-magic-ai?display_name=tag)

> Windows-first V0.1. The core workflow keeps source video and AI rendering on your own PC. Public installers are currently unsigned, so Windows SmartScreen may show a warning.

## V0.1 — Windows first

Current working flow:

1. Import or drag in a local video.
2. VideoMagic automatically builds a timestamped scene index with a local open-source video model.
3. Describe an edit in natural language, such as “keep the funniest reactions and make a short highlight”.
4. VideoMagic selects real scene IDs and FFmpeg/NVENC performs the actual trim/concat render.
5. Use the AI-edited result as a new source, or continue with the original video.
6. Write Mandarin or English narration and pick a local voice preset.
7. Generate speech locally with Kokoro on CUDA or CPU.
8. Auto-place narration, or use the visual timeline to drag/resize sentence blocks against the source waveform.
9. Generate synchronized subtitles and narration-aware source-audio ducking.
10. Export a finished H.264/AAC MP4 to a user-selected folder.

The source video never needs to be uploaded for the core workflow. Voice presets can be previewed before rendering. Local AI edit uses SmolVLM2 video understanding today: a 500M fast model for low-VRAM analysis and a 2.2B quality model when more GPU memory is available.

The desktop workspace also supports drag-and-drop import, secure local video preview, a persistent sentence-level creator timeline, autosave/restore, native `.vmagic` project files, explicit Open/Save/Save As, recent-project recall, persistent render history, reusable creator presets, custom export folders, desktop keyboard shortcuts, selectable Auto/GPU/CPU inference, and a warm local AI worker for fast repeated previews/renders.

## Current implementation

```text
React + TypeScript
      |
      v
Tauri 2 + Rust command bridge
      |
      v
Python 3.11 local engine
   |                 |                    |
   v                 v                    v
Kokoro 82M        SmolVLM2             FFmpeg
ZH / EN TTS       video understanding  probe / cut / concat / mix / subtitles / export
```

Kokoro is the current fixed-voice engine for Mandarin and American/British English narration. Local AI Edit uses SmolVLM2: Fast uses the 500M video model and Quality uses the larger 2.2B model. Auto stays on the 500M model on 8GB-class GPUs and only promotes to Quality when there is substantially more free VRAM.

GPT-SoVITS remains a planned pluggable engine for custom voice cloning, dialect/style voices, and stronger character voices. The UI and engine are intentionally separated so voice engines can be swapped without rewriting the desktop app.

See `docs/engine-protocol.md`.

## Verified on Windows

Verified on the Windows development PC:

- managed Python 3.11.17 installed by VideoMagic bootstrap;
- PyTorch 2.11.0 + CUDA 12.8;
- NVIDIA RTX 2080 SUPER;
- Kokoro 0.9.4 + Misaki Mandarin/English frontends;
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
- persistent warm Kokoro worker across preview/render requests;
- American English narration (`am_michael`) generated successfully on CUDA;
- SmolVLM2-500M video understanding generated real scene descriptions on CUDA;
- natural-language AI Edit selected a real scene ID and rendered a new MP4 with FFmpeg/NVENC;
- Auto video-model selection stays on the verified 500M Fast model at ~6.95GB free VRAM;
- runtime schema v2 detects and repairs older local runtimes before enabling the new AI-edit features.

A real 12-second end-to-end narration render and a separate natural-language AI Edit have both been completed from the local runtime without cloud inference. A custom two-segment timeline was also rendered successfully with narration starting at 1.0s and 7.0s; waveform checks confirmed silence outside the edited narration windows. On the RTX 2080 SUPER, repeated TTS on a warm worker measured about 0.18s after a roughly 14.4s cold start in the test case.

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
├── engine/                    Local Python AI/media engine
├── site/                      GitHub Pages product website
├── scripts/                   Runtime bootstrap scripts
├── docs/
│   ├── engine-protocol.md
│   └── releasing.md
└── .github/
    ├── workflows/             CI, Pages and automatic releases
    └── ISSUE_TEMPLATE/
```

## Development

Frontend:

```bash
pnpm install
pnpm build
```

Windows desktop development also requires Rust, MSVC Build Tools, the Windows SDK, and WebView2.

The local Python engine currently uses a project venv during development. This is intentionally not committed.

Pull requests and main-branch pushes run **Windows CI**. After a successful CI run on `main`, **Release Windows** automatically calculates the next patch version, builds the NSIS installer, creates the Git tag and GitHub Release, and uploads a stable installer name plus its SHA-256 checksum.

The product website source lives in `site/` and is published at [videomagic.pages.dev](https://videomagic.pages.dev/) through Cloudflare Pages. See [docs/releasing.md](docs/releasing.md) for the Windows release path and website deployment command. Public distribution still needs Windows code signing and updater hardening.

## First-run runtime bootstrap

The NSIS installer stays small and ships the desktop shell, bootstrap script, and VideoMagic Python engine source. There are no manual Python, Rust, FFmpeg or model prerequisites for end users.

On the first launch, VideoMagic automatically chooses a private per-user local data directory and prepares the AI runtime there. The user only needs an internet connection for the initial runtime/model downloads. Advanced users can change the runtime location later from Settings.

VideoMagic installs into that data directory:

- uv and a managed Python 3.11 runtime;
- a dedicated Python venv;
- CUDA PyTorch when NVIDIA is available, otherwise the CPU wheel;
- Kokoro / Misaki, Transformers / PyAV and the VideoMagic engine;
- FFmpeg / FFprobe;
- Hugging Face, Torch, pip, Python and temporary caches;
- voice and video-model weights automatically on first use.

The bootstrap is designed to be idempotent: interrupted or outdated runtimes can be repaired in place without reinstalling the desktop app. Current public distribution is still unsigned, so Windows SmartScreen may warn on launch.

## Product principles

- Local by default.
- Keep source video on the user's computer for the core workflow.
- Keep the one-click path excellent while adding timeline controls progressively instead of forcing every user into manual editing.
- Keep voice engines modular.
- Do not impersonate a real person's voice without permission.
