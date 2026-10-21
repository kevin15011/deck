# Changelog

> **Audience:** Users and maintainers reviewing release history.
> **Authority:** historical record; release workflow and release guidance own current procedure.
> **Maintainer:** Deck maintainers.
> **Evidence:** [repository releases](https://github.com/kevin15011/deck/releases), [release guidance](docs/maintainers/releasing.md), and [release descriptor reference](docs/maintainers/release-descriptor.md).

All notable release changes to Deck are recorded here. Current release procedure belongs in [release guidance](docs/maintainers/releasing.md).

## [Unreleased]

## [0.13.0] - 2026-10-20

### Added

- Durable cross-runner continuity for delegated attempts, explicit Lead review/integration records, and session-owned decisions with revisions, reply targeting and evidence-backed resolution.
- Text-only current-turn messaging for verified Codex 0.162.1 sessions and guarded Claude Code 2.1.296 executions, with exact native identity, durable admission and conservative reconciliation.
- Native personal skills, MCP servers and plugins remain available to Lead and all delegated roles across Claude Code, Codex, OpenCode and Pi, under their existing native permissions. Deck configuration is additive and preserves native HOME and authentication identity.
- Explicit, persistent and revocable OpenCode project trust in New session and Assignments: user/global sources remain available automatically; executable project configuration, plugins and compatibility skills require consent for the canonical project. Stale or replayed grants cannot undo revocation.
- Persistent per-device unread Lead replies with exact links into paginated conversations, independently tracked display receipts and retained attention while other tasks continue.
- Browser Back/Forward navigation for sessions, tabs and supported details, preserving drafts and message anchors across exact reply links and warm notification navigation.
- Menu-only daemon restart for validated stable/custom-prefix and canonical canary installations, with same-channel build selection, durable handoff and exact startup verification. Normal restart refuses busy work; explicit force records interruption, denied approvals and cancelled questions/queued input without rolling back prior effects.
- Menu-only Install Deck action with browser capability detection, manual installation guidance and standalone-aware visibility; canonical manifest and raster app icons.

### Changed

- Lead guidance yields after justified delegation, keeps reports unverified until reviewed, and makes the substantive answer the last action of the turn. Genuine user evidence remains separate from synthetic continuations and delivery bookkeeping.
- Notifications include bounded, sanitized, response-language summaries of eligible decisions and Lead replies/results by default, without extra model calls or a preview setting. Summaries may appear on the lock screen.
- Push attention and delivery receipts survive restart with bounded recovery, subscription renewal and independent delivery while other work runs. Opted-in device authorization renews for a finite 180 days.
- Lead briefly states the objective and scope of new substantive work, asks one focused question and waits when required input is missing or material ambiguity remains, and proceeds on clear authorized requests. Follow-ups preserve the ongoing work without restarting intake; equivalent guidance is materialized across runners.
- Mobile navigation uses a full-width scrolling project/session list, comfortable touch rows and a separate Install Deck footer. Decisions stay compact, and the Subagents tab shows current child work.
- Codebase Memory selection consistently reuses reviewed shared or Deck-owned executables across runners, preserving shared binaries and custom configuration. Preparation never downloads a replacement.
- Managed Claude, Codex and OpenCode sessions can continue when optional Codebase Memory is unsupported or unavailable, with a visible warning and alternate repository-discovery guidance; verified restoration clears the warning.
- Updated product/contributor documentation, Apertura branding and favicon, and added the MIT license.

### Fixed

- Keep background release checks responsive with a cancellable asynchronous transport and the existing five-second deadline; timed-out or unmounted checks cannot start a delayed request.
- Streaming chat retains message and Markdown component identity, avoiding repeated entrance fades, lost text selection and reset code-copy controls on each chunk.
- Keep outstanding task outcomes and blocked reviews visible across user topics, retries and interrupted Lead turns without recap-only wakes or duplicate delivery.
- Preserve immutable genuine admission evidence across native reseeding and steering acknowledgments; reject stale decision authority and durable command-ID collisions.
- Treat uncertain native delivery conservatively: never resend automatically, and never requeue a definitive refusal that arrives after its admission barrier expires.
- Unconditionally tear down revoked devices' streams and in-flight pushes even when storage cleanup fails; revalidate exact reply receipts after held request bodies and retire removed-session attention durably.
- Guard Deck-owned Pi Codebase MCP launches, including native reconnect, lazy connection and retry, against rejected executable bytes. Preserve ownership checks, output backpressure and bounded cleanup; cancellation and protected integrity failures remain failures.
- Keep pinned Bun executable argument handling and binary web-asset digest normalization consistent with canonical build generation.

### Compatibility and limits

- OpenCode and unsupported runner/version combinations retain FIFO queue delivery. Current-turn messaging requires verified native capability and supports text only; images use the queue. Acceptance is not proof of model consumption.
- Claude input not confirmed as folded into the selected execution remains uncertain and may be retained in native future context; Deck does not silently retry it. Decisions and approvals never resolve merely from a reply, read, push or navigation.
- Unread visibility is per device and records display, not comprehension. Native final-phase evidence is conservative; bounded extraction may omit an outcome rather than invent finality.
- Reply storage migrates to schema 2 while preserving enrollment floors and genuine receipts. Older-binary downgrade compatibility has not been certified.
- Native Pi Codebase launch, reload and tool-policy coverage is verified with Pi 1.0.0 only. Protected failures are checked before Deck launch and supported native factory startup; after startup, an existing model turn may continue while Codebase tool calls remain blocked and diagnostics persist.
- Pi guarded launches detect later executable/configuration drift but cannot eliminate a same-user verification-to-execution race. Successful cleanup waits for both output streams; permanently stalled stderr can prevent diagnostic delivery, so bounded cleanup reports failure.
- Web restart requires one CLI bootstrap for older daemons; unsupported development, Homebrew and untrusted installation shapes use the channel-correct CLI recovery command. Paired devices share the existing authorization/proxy boundary; same-user processes are not isolated.
- OpenCode project trust governs future discovery and launches, not already-running native configuration, and is not a plugin sandbox. Native settings that disable project loading still apply; conflicts with required Deck hooks or protected MCP declarations fail visibly.
- Native customization was exercised with Claude Code 2.1.296, Codex 0.162.1, OpenCode 1.18.31 and the Pi 1.0.0 SDK. Arbitrary third-party plugin combinations, real OAuth refresh and completion of automatic native memory capture are not certified.
- PWA installation and notifications depend on browser support and secure context; iOS uses the supported Home Screen flow. Voice notes and human-operated Web terminals remain feasibility research only.

## [0.12.0] - 2026-10-17

### Added

- Cross-browser opt-in push notifications for Lead completion, pending questions, approvals and actionable failures, with private notification text and delivery diagnostics.
- Runner-neutral question handling and explicit approval scopes, revocable session permissions and per-session YOLO controls.
- Deck branding, animated theme selection and Dark, Light, Green, EVA-01 and Cyberpunk themes, including rendered Markdown.
- Optional automatic access through a trusted private Tailscale Serve proxy.

### Changed

- Chat history loads progressively with a bounded rendered window, and typing remains isolated from history updates.
- Subagents move to the top when delegated or when they respond; profiles, compact cards and full detail views improve navigation.
- Mobile avatar navigation scrolls horizontally and the composer follows the visible keyboard viewport.

### Fixed

- Recover chat connections after browser suspension and preserve unseen push notifications through foreground acknowledgment races.
- Resume long Codex conversations without hydrating the entire native history.
- Allow standalone Claude launches without a Git repository or origin by disabling Deck memory for that launch only; invalid repository identities still fail closed.
- Preserve exact approval identity, protect sensitive question answers, and keep review controls visible.
- Regenerate embedded web assets during canary installation and disable spellcheck in the chat input.

### Compatibility and limits

- Push notifications require browser permission and a supported secure context; mobile Safari requires installation on the Home Screen. Ordinary subagent completions do not notify.
- Trusted Tailscale access is opt-in; pairing remains the default. Runner CLIs and external integrations remain separate prerequisites.

## [0.11.3] - 2026-10-15

### Added

- Pi supervised client proof and an explicit resume target.
- Global memory mode for cross-runner sessions.

### Fixed

- Keep degraded runners available during model discovery.
- Install Claude global plugin files independently of project context.
- Repair cross-session preparation.

## [0.11.2] - 2026-10-15

The v0.11.0 and v0.11.1 tags were blocked by release verification and did not publish stable binaries. This release includes the workspace features and clean-checkout/Linux verification fixes.

### Added

- Cross-runner developer sessions with Claude, Codex and OpenCode, durable conversations, delegated tasks, session-specific model assignments and bounded execution budgets.
- A project-independent web workspace with persistent project/session navigation, Markdown conversations, Lead activity, subagent and OpenSpec views, dark/light themes, and connection/work/unread indicators.
- Queued messages and multiple pasted or selected images, with thumbnails, authenticated previews, zoom and native image delivery to supported runner models.
- Explicit daemon lifecycle commands and session preparation, resource release, rename and removal actions.

### Changed

- Closing a web session releases its owned resources and returns the same conversation to preparation; its history, images and compatible native context remain available. Pending messages stay paused until explicitly resumed.
- Project and session removal hide entries without deleting project files or saved history. Remove actions use red text in both themes.
- Cross sessions use verified native memory integrations and canonical project identity, with runner-reported tool, reasoning and hook activity shown separately from chat responses.
- Supermemory account credentials can be validated without querying a project's memories or profile.

### Fixed

- Supervised runner output is fully flushed before reporting completion; incomplete or failed output draining is reported as a failure.
- Session recovery and command retries preserve ownership, prevent duplicate execution, and keep stale preparation or catalog responses from restoring obsolete state.
- Compact sidebar controls, nested directory completion, latest-message navigation and automatic activity scrolling work across desktop and mobile layouts.
- Pi supervised child cleanup and recovery work on macOS, and global/project skill collisions are handled through reviewed, reversible installation changes.
- Claude model configuration rejects blocked installation plans, preserves staged edits and reports the actual apply or rollback failure.

### Compatibility and limits

- The compiled Deck executable includes its web assets, contracts and managed content; supported runner CLIs and configured external tools remain separate runtime prerequisites. Images require a compatible vision model.
- Session removal is not secure erasure. Existing successor conversations remain separate when an older closed session is reopened.

## [0.10.0] - 2026-10-04

### Added

- Native Pi 1.0+ integration: a manifest-owned global Developer Team package, built-in MCP with direct tool exposure, Deck-owned tool provisioning, version preflight and expanded Doctor diagnostics. Deck sessions no longer depend on community MCP/subagent packages.
- Session-owned Pi background subagents with bounded parallel scheduling, live clarifications, inspect/cancel/resume controls, explicit review and integration, cumulative completion recaps, and a floating task panel with compact fallback counters. Recovery reopens exact child history only after execution ownership is settled; navigation and shutdown cancel owned jobs.
- Explicit `memory_search` and `memory_save` tools for supervised Pi and Codex sessions through Deck's authenticated loopback runtime. Project scope stays runtime-bound; Pi read-only roles receive search only, and the Codex bridge holds no provider credential.
- Pi compaction recall and enriched native summaries, including bounded Lead-summary capture. Memory survives native reload and authorized internal continuations without duplicate recall/capture or restoring bearer tokens to the environment.

### Changed

- Pi installs globally under its agent directory with ownership hashes, conflict-preserving settings/MCP updates, Deck skill precedence in Deck sessions, legacy detection and opt-in backed-up transactional cleanup. User-owned configuration and modified files are preserved; install does not write project files.
- Pi tool policy enforces the supported read-only role boundary, rewrites eligible Bash commands through Deck-owned RTK, and adds advisory graph-navigation guidance without blocking searches.
- Execution skills stay in the executing role's context. Materialized skills, agents and package instructions use runner-specific wording across Pi, OpenCode, Codex and Claude.

### Fixed

- Preserve configured Pi model/thinking assignments across installation and refresh, and Codex global model assignments on fresh launches instead of replacing them with defaults.
- Pi subagent children load the Deck package consistently; Serena ownership checks are composed lazily and memory token handoff avoids leaking bearer tokens into MCP environments.

### Compatibility and limits

- Pi requires `@earendil-works/pi-coding-agent` 1.0.0 or newer. Reapply the managed Developer Team installation after upgrading; legacy cleanup is explicit and preserves unmatched files.
- Pi child Bash containment is Linux process-group ownership, not a full sandbox, rollback, or guarantee over daemonized, remote or MCP effects. Model assignments and role instructions do not establish arbitrary model compliance; other runners retain their documented authorization limits.

## [0.9.0] - 2026-10-02

### Added

- Temporary Linux installation sandbox with the stable Codex, OpenCode, and Claude Code CLIs. `bun run sandbox` builds and includes Deck Canary; `bun run sandbox:clean` starts with runners only; `bun run sandbox:update` refreshes the cached image. Agents can inspect the sandbox through Docker without preserving runner configuration between runs.
- Project-local runner evolution review skill and version history for tracking runner compatibility and improvement opportunities.
- Shared frontend design routing with 29 additional standalone design skills. Deck selects compatible aesthetic and supporting skills, records their responsibilities, and replaces superseded directions when users request a different design. Imported source licenses and provenance are retained.

### Changed

- Supported runner packages start selected for review while saved deselections remain respected. Selection alone does not install packages; Review & Install retains the authorization boundary.
- Runner selection uses neutral labels. Installation, model discovery, and model saving provide visible activity; failed saves retain an actionable error and allow retry.
- Codex Developer Team sessions allow Lead-directed delegation and consistently identify delegated team tasks.
- Claude Code materializes the canonical standalone skill catalog with its supporting resources in the managed plugin.

### Fixed

- Codex Serena MCP uses the active Deck executable, including Canary installations, rather than relying on a different binary in `PATH`.
- OpenCode exposes Context7 in package selection again.
- Pi no longer mistakes nested skill metadata for top-level agent definitions.
- Codex launches can continue when Supermemory is selected but the project has no verified repository identity. Memory and all Codex hooks are disabled only for that launched session; saved preferences and installed configuration are preserved. Verified projects retain credential and registration checks.

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

- Structured `release.json` descriptors support binary, content, migration, advisory, and channel-end-of-life items. See the [release descriptor reference](docs/maintainers/release-descriptor.md).

### Fixed

- Hardened self-update staging, backup, and rollback so failed upgrades preserve or restore the installed Deck binary safely.

### Changed

- OpenCode model selection now uses the model inventory resolved by the active runner.
- Streamlined project documentation and strengthened contributor, architecture, release, and documentation-governance guidance.

[Unreleased]: https://github.com/kevin15011/deck/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/kevin15011/deck/compare/v0.9.0...v0.10.0
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
