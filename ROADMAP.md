# VideoMagic V0.1 roadmap

## Milestone 1 — Windows shell
- [x] Tauri 2 app builds on Windows.
- [x] NSIS installer builds successfully.
- [x] Local video picker.
- [x] React UI for script, voice, speed, and source-audio level.
- [x] Rust -> Python local engine bridge.

## Milestone 2 — First real narration
- [x] Python 3.11 local engine.
- [x] CUDA PyTorch on RTX 2080 SUPER.
- [x] Kokoro Mandarin plus American/British English fixed voices.
- [x] Mandarin script -> WAV without a cloud TTS API.
- [x] Model/cache paths moved off C drive on the dev PC.
- [x] Standalone first-run runtime bootstrap with managed Python, Torch, Kokoro and FFmpeg.
- [x] Portable runtime verified from E: without the development venv or system FFmpeg.
- [ ] Clean-machine / VM validation of the installer bootstrap.
- [ ] GPT-SoVITS adapter for custom voice cloning / stronger style voices.

## Milestone 3 — Video render
- [x] Probe video duration and streams.
- [x] Mix narration with source audio.
- [x] Adjustable original-audio level.
- [x] Render a finished H.264/AAC MP4.
- [x] Real end-to-end Windows render test.
- [x] Mandarin sentence segmentation and automatic timeline planner.
- [x] Automatic speech-rate fitting with a maximum-speed guard.
- [x] Narration-aware smart ducking with FFmpeg sidechain compression.
- [x] User-edited sentence timeline is accepted as a real render input.
- [x] Per-segment timing validation, overlap protection and automatic fit-speed adjustment.

## Milestone 4 — Creator experience
- [x] Progress events surfaced live in the UI.
- [x] Render cancel via process-tree termination.
- [x] Output-folder selection.
- [x] Voice preview before render.
- [x] Live first-run setup-stage progress.
- [x] First-run runtime setup UI with user-selected storage location.
- [x] Synchronized SRT generation and burned-in subtitles.
- [x] Project autosave / restore and drag-and-drop import.
- [x] Native .vmagic project Open / Save / Save As workflow.
- [x] Desktop keyboard shortcuts for project, import, render, and cancel actions.
- [x] Recent-projects browser backed by native app config.
- [x] Reusable creator presets with built-in and custom profiles.
- [x] Auto / GPU / CPU inference selection with Auto CUDA-to-CPU fallback.
- [x] Repair-in-place runtime recovery using the existing data directory.
- [x] Manual GitHub Actions workflow for reproducible unsigned Windows installer artifacts.
- [x] Settings & diagnostics center for runtime, GPU, media tools and shortcuts.
- [x] Secure local video preview with runtime-scoped asset access.
- [x] Creator Timeline V1 with draggable narration segments, precise timing inputs and per-segment preview.
- [x] Timeline persistence in autosave and native .vmagic project files.
- [x] Persistent render history with reusable settings.
- [x] Warm local AI worker across preview/render requests.
- [x] American/British English narration voices alongside Mandarin.
- [x] Automatic local video scene analysis on import.
- [x] Natural-language edit planning from timestamped scene descriptions.
- [x] Real FFmpeg/NVENC source cutting from the local AI edit plan.
- [x] SmolVLM2 500M Fast mode verified on RTX 2080 SUPER CUDA.
- [x] 8GB-class GPU Auto policy defaults to Fast; 2.2B remains an explicit Quality option.
- [x] Runtime schema v2 upgrades older local runtimes in place.
- [ ] Evaluate a quantized 4B-class quality model for stronger semantic editing on supported GPUs.
- [x] Source-audio waveform visualization behind the narration timeline.
- [x] Left/right resize handles directly on narration blocks.
- [ ] Per-segment cached regeneration without re-synthesizing unchanged segments.
- [ ] Windows code signing and auto-update.

## Later
- [ ] GPT-SoVITS custom voices.
- [ ] Dialect / character-style presets.
- [ ] Automatic video understanding and script writing.
- [ ] Multi-track timeline editor (music/SFX/B-roll beyond the V1 narration track).
- [ ] Cloud rendering option.
- [ ] Publishing integrations.
