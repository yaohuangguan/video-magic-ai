# VideoMagic

Local-first AI commentary studio for turning a source video and narration script into a finished voiceover video.

## V0.1 — Windows first

Core flow:

1. Import a local video.
2. Paste a commentary script.
3. Pick a local voice preset.
4. Generate speech locally.
5. Fit narration to the video timeline.
6. Duck and mix source audio.
7. Generate synchronized subtitles.
8. Export MP4.

The core pipeline is designed to work without uploading the source video.

## Architecture

```text
React + TypeScript
      |
      v
Tauri 2
      |
      v
persistent NDJSON sidecar
      |
      v
Python 3.11+ engine
   |          |
   v          v
GPT-SoVITS  FFmpeg
```

The engine stays separate from the desktop UI. On Windows it will be packaged as a sidecar executable so users do not need to manage Python manually.

See `docs/engine-protocol.md`.

## Repository

```text
videomagic/
├── src/
├── src-tauri/
├── engine/
│   ├── pyproject.toml
│   └── videomagic_engine/
└── docs/
    └── engine-protocol.md
```

## Current milestone

The desktop UI and local-engine protocol are scaffolded.

Next Windows milestone:

- verify Tauri/WebView2 build;
- package FFmpeg;
- wire Tauri to the persistent Python sidecar;
- integrate the first GPT-SoVITS preset;
- implement one real end-to-end render path.

## Frontend development

```bash
pnpm install
pnpm dev
```

Desktop development also requires the official Tauri prerequisites and Rust.

## Product principles

- Local by default.
- Keep source video on the user's computer for the core workflow.
- Make the one-click path excellent before building a full timeline editor.
- Keep the voice engine modular so presets and engines can evolve independently.
