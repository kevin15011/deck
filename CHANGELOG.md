# Changelog

> **Audience:** Users and maintainers reviewing release history.
> **Authority:** historical record; release workflow and release guidance own current procedure.
> **Maintainer:** Deck maintainers.
> **Evidence:** [repository releases](https://github.com/kevin15011/deck/releases), [release guidance](docs/maintainers/releasing.md), and [release descriptor reference](docs/release-descriptor.md).

All notable release changes to Deck are recorded here. Current release procedure belongs in [release guidance](docs/maintainers/releasing.md).

## [Unreleased]

## [0.2.6] - 2026-08-05

### Changed

- Redesigned Developer Team execution around adaptive, outcome-driven routes with clearer ownership, focused follow-up deltas, and protected quality checks for material risk.
- Hardened OpenCode and Pi runner setup with deterministic readiness handling, model migration, and Serena bridge integration.

## [0.2.5] - 2026-08-03

### Added

- Runner-aware skill discovery now maintains a bounded, safe project registry and integrates its setup and diagnostics across OpenCode and Pi.

### Changed

- Developer Team orchestration now selects proportionate workflows, keeps routine recovery moving, distinguishes causal regressions from unrelated baseline debt, reuses only fresh evidence, consolidates Review findings, and preserves durable approvals and honest lifecycle outcomes.
- Conversational follow-up changes can continue as focused deltas without restarting the full delivery workflow, while independent Verify and Review safeguards remain intact.

### Fixed

- OpenCode now uses native OAuth for Supermemory without persisting an API key, while Pi retains its explicit API-key handoff.
- OpenCode QA delegation recognizes the native `task` tool as well as the legacy `delegate` name, preventing resumed sessions from failing with `invalid-evidence` before Verify or Review starts.

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

[Unreleased]: https://github.com/kevin15011/deck/compare/v0.2.6...HEAD
[0.2.6]: https://github.com/kevin15011/deck/releases/tag/v0.2.6
[0.2.5]: https://github.com/kevin15011/deck/releases/tag/v0.2.5
[0.2.4]: https://github.com/kevin15011/deck/releases/tag/v0.2.4
[0.2.3]: https://github.com/kevin15011/deck/releases/tag/v0.2.3
