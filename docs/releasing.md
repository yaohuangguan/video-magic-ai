# Releasing VideoMagic

Public Windows releases are automated from main.

## Automatic path

1. A pull request is merged to main.
2. Windows CI runs the frontend build, Rust check, and lightweight Python engine tests.
3. When that main-branch CI run succeeds, Release Windows starts.
4. The workflow checks whether that exact main commit already has a published semantic-version release. Automatic reruns do not create duplicate releases.
5. The release workflow reads the latest semantic tag and increments the patch version.
6. The runner stamps that version consistently into the frontend package, Tauri config, Cargo manifest, and Cargo lockfile.
7. The runner builds the NSIS installer and calculates SHA-256.
8. GitHub creates the new tag and Release against the exact main commit.
9. The release uploads:
   - VideoMagic-Windows-x64-setup.exe
   - VideoMagic-Windows-x64-setup.exe.sha256

The stable asset name is intentional. The website can always use:

    https://github.com/yaohuangguan/video-magic-ai/releases/latest/download/VideoMagic-Windows-x64-setup.exe

## Versioning

The current automatic release line uses patch increments, starting after v0.1.0. Example:

    v0.1.1
    v0.1.2
    v0.1.3

Minor/major release policy can be introduced once the V0.1 product boundary is stable.

## Manual release

The Release Windows workflow also supports workflow_dispatch. Use this only when a release needs to be recreated intentionally; a manual run creates the next patch release.


## Website

The product website source lives in site/ and the production site is hosted on Cloudflare Pages:

    https://videomagic.pages.dev/

Deploy the current site from an authenticated Wrangler environment with:

    wrangler pages deploy site --project-name videomagic --branch main

The website intentionally uses the stable GitHub latest-release asset URL, so a new Windows release does not require a website edit.
