# Contributing to VideoMagic

VideoMagic is a Windows-first, local-first AI voiceover studio. Contributions are welcome when they keep the creator workflow focused and preserve the local-first privacy model.

## Before opening a pull request

1. Open or reference an issue for larger behavior changes.
2. Keep unrelated refactors out of feature pull requests.
3. Do not add cloud uploads or telemetry to the core workflow without an explicit product decision.
4. Never commit model files, render outputs, local runtimes, credentials, or user media.

## Local checks

Frontend:

    pnpm install
    pnpm build

Rust shell:

    cargo check --manifest-path src-tauri/Cargo.toml --locked

Python engine:

    PYTHONPATH=engine python -m unittest discover -s engine/tests -v

The Windows CI workflow runs the same lightweight checks for pull requests.

## Product constraints

- Source video should remain local for the core workflow.
- File access should be explicitly scoped.
- The one-click flow should remain usable even as advanced timeline controls grow.
- Voice features must not be designed around impersonating real people without permission.
- Windows is the supported release target today.

## Pull requests

Keep the PR description concrete: what changed, why, how it was validated, and screenshots/recordings for UI changes.

Merges to main run Windows CI. A successful main CI run triggers the release workflow, which automatically creates the next patch tag and publishes the Windows installer.
