# VoiceMagic local engine protocol

VoiceMagic keeps the heavy AI/media process outside the UI.

## Transport

The desktop app starts a persistent sidecar process and communicates over newline-delimited JSON (NDJSON) on stdin/stdout.

This is intentional:
- no localhost port to expose or collide with;
- the TTS model can stay loaded between jobs;
- progress events can stream to the desktop UI;
- the Python engine can later be packaged as `voicemagic-engine.exe` with PyInstaller.

## Request

```json
{"id":"job-1","method":"doctor","params":{}}
```

## Result

```json
{"id":"job-1","type":"result","result":{"engineVersion":"0.1.0"},"error":null}
```

Future long-running render calls will emit `progress` messages before the final result.
