# Changelog

> **Audience:** Users and maintainers reviewing release history.
> **Authority:** historical record; release workflow and release guidance own current procedure.
> **Maintainer:** Deck maintainers.
> **Evidence:** [repository releases](https://github.com/kevin15011/deck/releases), [release guidance](docs/maintainers/releasing.md), and [release descriptor reference](docs/release-descriptor.md).

All notable release changes to Deck are recorded here. Current release procedure belongs in [release guidance](docs/maintainers/releasing.md).

## [Unreleased]

### Added

- Structured `release.json` descriptors support binary, content, migration, advisory, and channel-end-of-life items. See the [release descriptor reference](docs/release-descriptor.md).

## [0.2.3] - 2026-07-15

### Fixed

- Hardened self-update staging, backup, and rollback so failed upgrades preserve or restore the installed Deck binary safely.

### Changed

- OpenCode model selection now uses the model inventory resolved by the active runner.
- Streamlined project documentation and strengthened contributor, architecture, release, and documentation-governance guidance.

[Unreleased]: https://github.com/kevin15011/deck/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/kevin15011/deck/releases/tag/v0.2.3
