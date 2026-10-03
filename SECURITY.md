# Security Policy

## Reporting a vulnerability

Please avoid filing public details for vulnerabilities that could expose local files, broaden desktop permissions, execute unintended commands, or compromise the installer/runtime bootstrap.

Use GitHub's private security reporting flow for this repository when available. If private reporting is unavailable, open a minimal issue asking for a private contact channel without including exploit details.

## Security model

VideoMagic is designed around a local-first core workflow:

- source video stays on the user's machine;
- local video preview uses runtime-scoped file access instead of broad disk access;
- AI inference and FFmpeg rendering run locally;
- runtime files and model caches live in a user-selected data directory.

This does not mean the project is formally audited. Treat unsigned development releases accordingly and verify release checksums when appropriate.
