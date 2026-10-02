# Changelog

> **Audience:** Users and maintainers reviewing release history.
> **Authority:** historical record; release workflow and release guidance own current procedure.
> **Maintainer:** Deck maintainers.
> **Evidence:** [repository releases](https://github.com/kevin15011/deck/releases), [release guidance](docs/maintainers/releasing.md), and [release descriptor reference](docs/release-descriptor.md).

All notable release changes to Deck are recorded here. Current release procedure belongs in [release guidance](docs/maintainers/releasing.md).

## [Unreleased]

## [0.8.0] - 2026-10-01

### Added

- Codex Review & Install now provisions the shared tools like Claude and OpenCode: a Deck-owned pinned RTK with a `PreToolUse` rewrite hook, Codebase Memory (an existing shared binary is reused, otherwise the pinned native release), and Context Mode. MCP entries and hooks are pinned to verified absolute paths instead of bare `PATH` names.
- Codex Supermemory uses only the pinned official `codex-supermemory` recall and flush hooks. The shared profile credential is injected into the launched Codex process only; no Supermemory MCP entry or Deck memory loopback is registered beside it, and conflicting Supermemory registrations block the launch.
- Deck-owned Codex hooks live in marker-delimited blocks, so existing user hooks (inline TOML or `hooks.json`) are preserved and removed only by their owner. The Codex launch passes `--dangerously-bypass-hook-trust` when Deck-owned hooks are present.

### Changed

- Codex and OpenCode launches print a short, product-level summary instead of a wall of diagnostics: routine notes move behind `--verbose` and `--dry-run`, nothing is printed twice, raw diagnostic ids are gone from normal output, and `exec` status goes to stderr. The single safety reminder about disabled sandbox and approvals stays.
- The Codex install is now global, like Claude's plugin and OpenCode's config: agents go to `$CODEX_HOME/agents`, skills to `~/.agents/skills`, MCP servers and hooks into marker blocks in `$CODEX_HOME/config.toml`, and Deck's manifest and hook scripts under `$CODEX_HOME/deck/`. Running Deck in a project writes nothing there, project trust is no longer required, and model assignments are global. A previous per-project install is reported (its files shadow the global agents and skills) and removed only with the explicit `--cleanup-legacy` flag; `--local-only` is accepted but has no effect.
- Codex custom agents are named by their canonical role id (for example `deck-lead`) with the catalog description, matching how Codex identifies agents.
- Docs now describe the Claude and Codex route-limited adapters instead of "detection only".

### Fixed

- Codex Web Search now works: the shared Tavily credential (environment or the Deck-owned shell profile) is handed to the Codex process only through a narrow sensitive-env binding, the MCP entry is pinned to the resolved `npx` path with `env_vars`, and the false "executable prerequisite unavailable" diagnosis for symlinked shims (nvm) is gone.
- Deck no longer adds a second Codebase Memory/Context Mode server when your own Codex config already registers the same executable; your registration is never edited.
- Running the Codex developer command from a very large directory (for example `$HOME`) now stops with an actionable message before any change instead of crashing.
- Dry-run output is no longer printed twice, and the memory line describes the official plugin route precisely.
- Codex project config merging no longer fails on a pre-existing `[features]` table.

## [0.7.1] - 2026-10-01

> Version 0.7.0 was tagged but never published: its release workflow failed on a stale `bun.lock` before building any artifact. 0.7.1 contains everything intended for 0.7.0 plus the release fixes below.

### Added

- Claude Code is now a supervised Deck runner. The `claude developer` runner launches a supervised Claude session with the Developer Team plugin files, and `claude native` launches a safe-mode session without them; both are also available from the TUI runner dashboard.
- The Claude adapter materializes pinned, checksum-verified native artifacts for Supermemory, RTK, and Codebase Memory (v0.11.0, Linux/macOS), and discovers available Claude models at launch.
- Launch diagnostics are color-coded (warnings yellow, errors red) and honor `NO_COLOR` and `FORCE_COLOR=0|false`.

### Changed

- Claude reuses an already-installed Codebase Memory binary (PATH or `~/.local/bin`, version 0.10.8 or newer) instead of installing its own pinned copy, so Claude and OpenCode share one version and the shared Codebase Memory daemon no longer hangs on a version mismatch. The pinned 0.11.0 install remains the fallback when none is found.
- The Claude RTK hook now runs through a small Node bridge that pins rewritten commands to the Deck-owned RTK binary, so rewrites no longer depend on a global `rtk`. Node.js 18+ is required for the bridge.
- Claude sessions launched by Deck now pass `--settings` with `attribution` set to empty `commit` and `pr` strings, so commits and pull requests created in those sessions carry no Claude co-author trailer or generated-with line. The change is session-only: no Claude user or project settings file is written, and sessions started outside Deck are unaffected.
- Serena bootstrap and web-search shell profile handling were adjusted so they work for Claude-managed sessions.

### Fixed

- The release workflow's frozen-lockfile install now succeeds: `bun.lock` includes the `@deck/adapter-claude` workspace.
- The `deck version` smoke test no longer depends on the git-ignored generated build info, so it passes in a clean checkout.

### Compatibility

- Pi, OpenCode, and Codex behavior is unchanged.

## [0.6.0] - 2026-09-29

### Changed

- Deck-managed OpenCode sessions now use the pinned official Supermemory plugin for recall, capture, injection, and compaction instead of Deck-owned OpenCode memory hooks. Pi and Codex memory behavior is unchanged; Context Mode remains an MCP integration.
- OpenCode setup offers a default credential and selectable literal Git SSH Host aliases. A uniquely matched, configured alias selects its credential; unresolved origins use the configured default. Launch stops if neither is available, without falling back to another account's credentials.
- Verified GitHub origins retain the canonical `sm_project_v1_<owner>_<repository>` tag, including linked worktrees. Without a verified origin, the plugin selects its own fallback container; memories under older plugin-generated tags are not migrated.

### Security and compatibility

- The selected credential is passed only to the managed OpenCode process, not stored in OpenCode configuration or launch diagnostics. Other plugins loaded in that same process can access its environment; use only trusted plugins.
- OpenCode Apply runs in the stable binary's `static-compatible` mode. OpenCode-native tool permissions still apply, but this mode does not provide Deck's invocation-scoped denial. Existing Pi/Codex and strict-mode checks are unchanged.
- The official plugin is pinned to `opencode-supermemory@2.0.15`; Deck supplies a loader-only compatibility adapter for the supported OpenCode generation. Restart Deck and reapply the OpenCode Developer Team installation after upgrading.

### Verification limitation

- A user canary confirmed installation, canonical tagging, and a project-memory write on OpenCode 1.18.31. The full combination of profile switching, resumed/child sessions, compaction, third-party plugins, RTK, and Context Mode in one isolated OpenCode process was not independently reproduced before this release; the user explicitly accepted this remaining risk. Do not treat this release as proof of full process-level isolation or strict Apply authorization.

## [0.5.0] - 2026-09-22

### Added

- OpenCode Developer Team sessions can search project and user skills for the current task, prepare an exact observed candidate, and confirm native loading independently for Lead and delegated specialists. A ready project skill registry is preferred; missing or stale registries use bounded read-only discovery.

### Fixed

- Ordinary nested skill frontmatter such as `metadata.author` and `metadata.version` no longer makes discovery incomplete. Unsafe YAML constructs and malformed descriptors remain rejected.
- Corrected TUI exit and rollback menu actions.

### Upgrade note

- After updating Deck, restart it and launch OpenCode through the updated Deck binary to reapply the managed plugin. If launching OpenCode directly, reapply the Developer Team installation from the updated Deck first. Verified native skill loading is OpenCode-only; Pi and Codex parity is not claimed.

## [0.4.3] - 2026-09-21

### Changed

- Codex project guidance now remains architecture-focused while dynamic Developer Team and Adaptive Memory policy stays on runner-owned runtime surfaces.

### Fixed

- Deck-managed Adaptive Memory now resolves exact macOS SSH host aliases such as `work → github.com` from protected operating-system account configuration, so project identity and recall work without rewriting Git remotes.
- Hardened macOS account and SSH configuration validation against ambient environment influence, unsafe paths, incomplete account records, file growth, unsupported directives, and failed-identity provider access.

## [0.4.2] - 2026-09-21

### Fixed

- Deck-managed Serena MCP configurations now disable automatic browser opening while keeping Serena's web dashboard available when opened explicitly.
- Existing OpenCode and Pi installations must reapply Serena configuration once after upgrading; legacy direct-launch Codex entries require the normal Deck configuration migration. Deck does not silently rewrite user-owned runner configuration during content-only sync.

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

[Unreleased]: https://github.com/kevin15011/deck/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/kevin15011/deck/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/kevin15011/deck/releases/tag/v0.4.3
[0.4.2]: https://github.com/kevin15011/deck/releases/tag/v0.4.2
[0.4.1]: https://github.com/kevin15011/deck/releases/tag/v0.4.1
[0.4.0]: https://github.com/kevin15011/deck/releases/tag/v0.4.0
[0.3.0]: https://github.com/kevin15011/deck/releases/tag/v0.3.0
[0.2.6]: https://github.com/kevin15011/deck/releases/tag/v0.2.6
[0.2.5]: https://github.com/kevin15011/deck/releases/tag/v0.2.5
[0.2.4]: https://github.com/kevin15011/deck/releases/tag/v0.2.4
[0.2.3]: https://github.com/kevin15011/deck/releases/tag/v0.2.3
