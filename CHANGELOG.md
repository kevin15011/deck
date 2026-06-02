# Changelog

All notable changes to Deck are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Self-update system** (`deck upgrade` / `deck update`): Deck can now
  detect and apply structured GitHub Release descriptors (`release.json`)
  attached to every release. The descriptor is a typed JSON document
  that lists release items (binary, content, migration, advisory,
  channel_eol) with explicit SHA-256 checksums, replacing the previous
  regex-based release-body SHA parsing path.
- **Release descriptor schema** (`apps/cli/src/upgrade-command/release-descriptor.ts`):
  a Zod-validated `release.json` schema with five item kinds, ISO-8601
  timestamps, and 64-char lowercase hex SHA-256 values. See
  `docs/release-descriptor.md` for the full reference.
- **Release preparation helper** (`scripts/prepare-release.ts`):
  guided, maintainer-facing CLI for assembling `release.json`. Supports
  interactive mode, non-interactive mode for CI, and a
  `--from-assets-dir` mode that auto-builds the binary items from the
  tar.gz archives produced by `scripts/build-binaries.ts` and writes
  their real SHA-256s.
- **Release pipeline attachment**: the GitHub Actions release workflow
  (`.github/workflows/release.yml`) now runs `prepare-release.ts` after
  building binaries and attaches `release.json` to every GitHub Release
  alongside the platform tarballs and `checksums.txt`. Both the
  tag-based stable release job and the main-push pre-release job emit a
  descriptor.

### Homebrew users

> **If you installed Deck with Homebrew, do not run `deck upgrade` /
> `deck update`.** Homebrew owns the binary and will refuse any
> out-of-band self-update. To get the latest version, run:
>
> ```sh
> brew upgrade deck
> ```
>
> Homebrew users will still receive content-only updates (skills,
> prompts, sub-agents, MCP config) via `deck sync` once that flow is
> fully wired.

### Notes

- `zod` was added as a runtime dependency (used by the descriptor
  schema and validation helpers). It is the only newly required
  runtime dependency for the self-update path.
- The schema is `schemaVersion: 1`. Future schema changes will be
  shipped as additive revisions with explicit migration steps; older
  clients fail closed (rejecting unknown schema versions) rather than
  silently ignoring unknown fields.
- The previous binary-only upgrade path remains as a fallback for
  releases that do not yet attach a `release.json`.

[Unreleased]: https://github.com/gentleman-programming/deck/compare/HEAD
