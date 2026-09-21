# Changelog

> **Audience:** Users and maintainers reviewing release history.
> **Authority:** historical record; release workflow and release guidance own current procedure.
> **Maintainer:** Deck maintainers.
> **Evidence:** [repository releases](https://github.com/kevin15011/deck/releases), [release guidance](docs/maintainers/releasing.md), and [release descriptor reference](docs/release-descriptor.md).

All notable release changes to Deck are recorded here. Current release procedure belongs in [release guidance](docs/maintainers/releasing.md).

## [Unreleased]

## [0.4.1] - 2026-09-21

### Changed

- Release jobs now use the repository's canonical target-aware build pipeline and Bun 1.3.12 toolchain contract instead of duplicating compile and archive commands in GitHub Actions.
- Local canary builds validate workspace dependencies before compilation and embed the current checkout version, commit, target, date, and development channel without rewriting tracked generated metadata.

### Fixed

- Darwin binaries now remove Bun's malformed placeholder signature, apply an ad-hoc macOS signature, and verify it before archive creation. Extracted release artifacts are verified again and executed on matching CI architectures.
- The macOS installer rejects unsigned or invalid candidates before replacing an existing binary and reports empty status-137 failures as `SIGKILL` before rollback.
- macOS test and runtime smokes now account for canonical `/private` temporary paths, BSD tar behavior, host platform selection, and signed compiled executables.

### Security

- Runner environment sanitization now removes personal access token variables such as `GITHUB_MCP_PAT` while preserving Deck-owned loopback credentials.

## [0.4.0] - 2026-09-07

### Added

- Added Deck-supervised Supermemory conversation capture and bounded project-profile and task-relevant recall, with one canonical scope per project and one conversation document per session. Automatic memory is available only on runner paths with a verified capture and context-injection boundary.
- Added managed project recall so agents can retrieve relevant project context without choosing provider-specific scopes or exposing credentials.
- Added metadata-only receipts that correlate capture, recall, and actual context injection by project, session, and logical turn, without persisting private identifiers or memory content in observability records.

### Changed

- Supermemory Adaptive Memory now distinguishes Deck-supervised runtime behavior from optional MCP recall, avoids mixed stdout capture, and keeps Pi credentials in Deck's secret store instead of runner MCP config.
- Supermemory owns extraction, profiles, ranking, and deduplication; Deck limits retrieved context and keeps ordinary memory failures from interrupting coding work.
- OpenCode now retains recalled context through the current user turn and acknowledges actual system-context injection with metadata-only receipts.

### Fixed

- Ordinary Markdown lists containing durable decisions, requirements, and preferences are no longer rejected as patches solely because they use dash bullets; structural patch and sensitive-content filters remain in place.
- OpenCode and Pi execution assets now use the release-pinned Bun toolchain for deterministic generation, rejecting mismatched runtimes before changing generated outputs.
- Stabilized release verification for RunnerAdapter readiness and TUI model discovery, removing dependence on an ambient Codex installation and fixed rendering delays.

### Security

- Memory requests bind project scope inside Deck's authenticated runtime, reject caller-supplied scope, and keep projects isolated. Missing or invalid scope disables memory effects without blocking coding work.
- Expanded provider-neutral rejection of credential-bearing managed recall requests and authorization headers before provider calls, with redacted diagnostics. Observability retains only allowlisted metadata rather than raw queries, credentials, provider correlation IDs, or native session and message IDs.

## [0.3.0] - 2026-08-14

### Added

- Added a `static-compatible` Codex CLI runner beta with native Developer Team roles and skills, project-local transactional materialization, MCP/shared-binary readiness, Supermemory integration, targeted TUI and doctor flows, and content-only upgrade synchronization. The public adapter installs no trusted-hook surface and marks host authorization, dossier, controlled-effect, registry, and bound-verification controls as explicit gaps.
- Added runner-neutral web search capability so package instructions can expose bounded search and point extraction consistently across supported runners.
- Added product documentation entry points, CLI and support references, operational guides, and Deck brand assets for the public documentation set.

### Changed

- Consolidated Deck preferences into the XDG configuration path and migrated runner setup away from the legacy project-local `.deck/config.json` preference file.
- Canonicalized Supermemory project scoping so every scoped memory operation uses Deck's materialized project container consistently across runner instructions and launch composition.
- Hardened Codex launch composition with a portable Serena proxy and clearer static-compatible runner wiring.

### Security

- Codex integration never auto-trusts repositories or persists external credentials. Managed writes use reviewed previews, optimistic preimages, durable recovery journals, semantic verification, and conflict-preserving rollback.
- Every non-install-only Codex Developer Team launch now uses Codex's `--dangerously-bypass-approvals-and-sandbox` flag. The launch preview and Doctor report that sandboxing and command approvals are disabled; the per-launch flag is never persisted.
- Codex rollback is operation-scoped by exact native/local-only transaction IDs, and semantic verification failure now awaits rollback before returning.
- Codex package instructions preserve canonical metadata and tool policy while translating runner-specific OpenCode/Claude wording to verified Codex behavior.

## [0.2.6] - 2026-08-05

### Changed

- Redesigned Developer Team execution around adaptive, outcome-driven routes with clearer ownership, focused follow-up deltas, and protected quality checks for material risk.
- Hardened OpenCode and Pi runner setup with deterministic readiness handling, model migration, and Serena bridge integration.

### Fixed

- Stable and main-branch releases now publish the Intel macOS (`darwin-x64`) archive alongside the other supported binary targets.

## [0.2.5] - 2026-08-03

### Added

- Runner-aware skill discovery now maintains a bounded, safe project registry and integrates its setup and diagnostics across OpenCode and Pi.

### Changed

- Developer Team orchestration now selects proportionate workflows, keeps routine recovery moving, distinguishes causal regressions from unrelated baseline debt, reuses only fresh evidence, consolidates Review findings, and preserves durable approvals and honest lifecycle outcomes.
- Conversational follow-up changes can continue as focused deltas without restarting the full delivery workflow, while independent Verify and Review safeguards remain intact.

### Fixed

- OpenCode now uses native OAuth for Supermemory without persisting an API key, while Pi setup keeps its runtime credential out of Deck project config.
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

[Unreleased]: https://github.com/kevin15011/deck/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/kevin15011/deck/releases/tag/v0.4.1
[0.4.0]: https://github.com/kevin15011/deck/releases/tag/v0.4.0
[0.3.0]: https://github.com/kevin15011/deck/releases/tag/v0.3.0
[0.2.6]: https://github.com/kevin15011/deck/releases/tag/v0.2.6
[0.2.5]: https://github.com/kevin15011/deck/releases/tag/v0.2.5
[0.2.4]: https://github.com/kevin15011/deck/releases/tag/v0.2.4
[0.2.3]: https://github.com/kevin15011/deck/releases/tag/v0.2.3
