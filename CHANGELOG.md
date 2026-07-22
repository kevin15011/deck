# Changelog

> **Audience:** Users and maintainers reviewing release history.
> **Authority:** historical record; release workflow and release guidance own current procedure.
> **Maintainer:** Deck maintainers.
> **Evidence:** [repository releases](https://github.com/kevin15011/deck/releases), [release guidance](docs/maintainers/releasing.md), and [release descriptor reference](docs/release-descriptor.md).

All notable release changes to Deck are recorded here. Current release procedure belongs in [release guidance](docs/maintainers/releasing.md).

## [Unreleased]

## [0.2.4] - 2026-07-22

### Changed

- Developer Team execution now uses deterministic runner authority with a hardened authorization boundary and retry-ledger binding, while preserving safety and compatibility behavior.
- Developer Team phase communication now confirms non-trivial intake, makes Proposal collaborative, uses phase-appropriate summaries, gives Design ownership of exact implementation instructions, stops Apply on fidelity or ambiguity issues, and explains Verify/Review failures clearly.
- Compact Developer Team profiles remain the default.

## [0.2.3] - 2026-07-15

### Added

- Structured `release.json` descriptors support binary, content, migration, advisory, and channel-end-of-life items. See the [release descriptor reference](docs/release-descriptor.md).

### Fixed

- Hardened self-update staging, backup, and rollback so failed upgrades preserve or restore the installed Deck binary safely.

### Changed

- OpenCode model selection now uses the model inventory resolved by the active runner.
- Streamlined project documentation and strengthened contributor, architecture, release, and documentation-governance guidance.

[Unreleased]: https://github.com/kevin15011/deck/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/kevin15011/deck/releases/tag/v0.2.4
[0.2.3]: https://github.com/kevin15011/deck/releases/tag/v0.2.3
