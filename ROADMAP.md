# VoiceMagic V0.1 roadmap

## Milestone 1 — Windows shell
- Tauri 2 app runs on Windows 10/11.
- NSIS installer builds successfully.
- Drag/select a local video.
- Engine doctor screen reports FFmpeg, GPU and TTS readiness.

## Milestone 2 — First real narration
- Bundle FFmpeg/FFprobe.
- Package Python 3.11 engine as a Windows sidecar.
- Load one GPT-SoVITS voice preset locally.
- Script to WAV works without cloud APIs.

## Milestone 3 — Video render
- Probe source duration.
- Split narration into segments.
- Basic automatic timing and speech-rate fitting.
- Duck source audio under narration.
- Render final H.264/AAC MP4.

## Milestone 4 — Useful creator experience
- Subtitle generation and burn-in.
- Render progress and cancel.
- Output folder selection.
- Preset management.
- Error recovery and hardware fallback.

## Not in V0.1
- Full nonlinear timeline editor.
- Cloud rendering.
- Automatic video understanding / script writing.
- Publishing integrations.
