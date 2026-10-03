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
- [x] Kokoro Mandarin fixed voices.
- [x] Mandarin script -> WAV without a cloud TTS API.
- [x] Model/cache paths moved off C drive on the dev PC.
- [ ] Standalone runtime bootstrap for a clean Windows machine.
- [ ] GPT-SoVITS adapter for custom voice cloning / stronger style voices.

## Milestone 3 — Video render
- [x] Probe video duration and streams.
- [x] Mix narration with source audio.
- [x] Adjustable original-audio level.
- [x] Render a finished H.264/AAC MP4.
- [x] Real end-to-end Windows render test.
- [ ] Sentence segmentation and timeline planner.
- [ ] Automatic speech-rate fitting.
- [ ] Audio ducking that follows narration activity instead of one global volume.

## Milestone 4 — Creator experience
- [ ] Progress events surfaced live in the UI.
- [ ] Render cancel.
- [ ] Output-folder selection.
- [ ] Subtitle generation and burn-in.
- [ ] Voice preview before render.
- [ ] Preset management.
- [ ] Hardware fallback / CPU mode.
- [ ] First-run model/runtime download UI.

## Later
- [ ] GPT-SoVITS custom voices.
- [ ] Dialect / character-style presets.
- [ ] Automatic video understanding and script writing.
- [ ] Full timeline editor.
- [ ] Cloud rendering option.
- [ ] Publishing integrations.
