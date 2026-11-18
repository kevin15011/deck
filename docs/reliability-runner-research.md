# Reliability and non-invasive runner research

Status: bounded research baseline and [operating-model synthesis](operating-model.md) reviewed. Exact native/tool feasibility and responsiveness remain untested. This records requirements, source observations and evaluation criteria, not final runner-management or automatic-update choices. No installation, configuration change, live model dispatch or benchmark load is part of this investigation.

## Product problem

The user reports recurring weaknesses in actionable errors, error handling, logs, debugging, stability and compatibility across changes. Investigate the production paths and existing protections before attributing causes. A source example alone does not establish a system-wide defect. Recreating Deck in Rust must improve observable recovery and supportability; language choice alone cannot prove that improvement.

The user also wants to investigate reducing support burden by avoiding persistent changes inside runners. Tools such as Codebase Memory and standalone skills could live in a shared Deck-owned location and be made available at execution time. This is a proposed model, with runner-specific constraints and latency still to establish.

## Meaning of non-invasive integration

Evaluate these boundaries separately:

| Resource | Research question |
|---|---|
| Existing native runner binary and global profile | Can Deck use it without patching, installing extensions, or editing configuration, hooks, agents, skills or ownership records? |
| Deck-owned shared tools/content | Can versioned binaries, services and skill sources be prepared once and reused safely across runners and sessions? Shared installation does not imply unrestricted shared session state. |
| Launch/session configuration | Which documented command arguments, environment values, protocol fields and tool endpoints are scoped to the process/session? Which native settings still merge or take precedence? |
| Isolated Deck-owned runner profile | Does this alternative preserve required auth, discovery, permissions, models and continuation without copying private credentials or mutating the original profile? An alternate home alone is not proof. |
| Normal native activity | Distinguish Deck configuration writes from the runner's own login, credential refresh, cache and session-history writes. State any unavoidable effects honestly. |
| Project configuration and user tools | How are existing project rules, trust and user-owned tools preserved or explicitly admitted without collision? |

Compare Codex, Claude Code, OpenCode and Pi using current local implementation/help and official documentation. State exact version evidence and unknowns. A prompt describing a tool is not executable tool exposure; injected skill text is not automatically native skill discovery or a hook. Failure to preserve a required permission boundary makes that mode unavailable.

The existing roadmap's runner installation/configuration flows remain proposals under evaluation. The current-behavior catalog is not a requirement to retain invasive materialization. Resolve the target disposition of C02–C05 and C09–C10 using the research before committing S4/S5/S7 to a mechanism.

## Reliability acceptance to refine with evidence

| Area | Required user outcome | Representative acceptance scenario |
|---|---|---|
| Errors | Understand what failed, affected scope, what is known about execution and a safe next action; technical details are available separately. | Unsupported runner version blocks before dispatch and explains the supported route; an uncertain dispatch says it may have arrived and offers inspection without automatic resubmission. |
| Error handling | Preserve meaningful distinctions between rejection, timeout, cancellation, lost connection, corrupted state and unknown outcome. | A browser disconnect does not become a false task failure or repeat work; a failed tool does not silently imply whole-session success. |
| Logs and diagnostics | Correlate safe diagnostics with session/task/attempt and component/version; bound storage and avoid leaking prompts, tokens or credentials. | A user can inspect/export a deliberately selected diagnostic bundle with sensitive fields removed; logging failure cannot masquerade as durable execution success. |
| Debugging | Explain the failed stage and provide enough context for reproduction without requiring raw stack traces as the only message. | Native handshake failure can be distinguished from tool readiness and browser transport failures. Debug collection is scoped and reversible. |
| Stability and recovery | Keep process ownership, durable intent and uncertain outcomes truthful through crashes, cancellation races and reconnection. | A restart with unknown native ownership blocks unsafe reuse; an acknowledged command is not executed twice. |
| Compatibility | Know supported runner/protocol/tool/state combinations and reject incompatible operations before damage. | A changed runner or cached browser client receives an explicit incompatibility/reload path; an unsupported state downgrade is not attempted by swapping only the binary. |

Use one coherent error/event vocabulary where practical. Separate durable execution receipts from best-effort diagnostic logs. Prefer targeted failure checks at real boundaries over a broad new telemetry framework or tests that pin message wording.

## Responsiveness evaluation

Separate cold installation/preparation, cold host/runner start, warm task creation, reconnect and a normal message to an already active Lead. A favorable warm-message result must not hide an unacceptable startup cost.

For comparable baselines, record browser submission, host acceptance/durable receipt, native dispatch/acknowledgment and first output separately. Compare equivalent runner/model/tool/project/version conditions and report sample distribution and uncertainty; model/network time must not conceal added local overhead. No numerical budget or zero-overhead claim is established yet.

Investigate which discovery, hashing, version checks, content preparation, process starts and tool handshakes can occur outside normal message handling and be reused with explicit invalidation. Do not assume that caching, persistent shared services or prewarming are free: account for freshness, memory, isolation, cancellation and recovery. In particular, avoid making installation, full preparation or service restart a routine prerequisite for each message.

## Managed helper-binary updates (C15)

The user explicitly adds version/update management for binaries used by Deck, naming Codebase Memory and RTK, with a web option and/or automatic behavior to evaluate. This is distinct from updating Deck itself (C12), modifying native runners (C10), and updating non-executable skill content. No actual update or installation is authorized by this planning addition.

Proposed web behavior: inspect installation ownership/source, installed and compatible available versions, last check, update progress and outcome; allow a manual check/update and evaluate a configurable notification-only or opt-in automatic policy. The default remains a design proposal, not an established user preference. A user must be able to pause automatic changes or retain a compatible known version, with any support implications explained.

Evaluate the lifecycle against these conditions:

- Manage Deck-owned binaries in Deck's shared tool area without installing into existing runner profiles. Identify externally/package-manager-owned installations and preserve their owner; using one does not imply update authority.
- Check artifact provenance and integrity, platform support and Deck/runner/tool compatibility before activation. A newer release alone is not compatibility evidence.
- Stage and verify a candidate before changing the version selected for future work. Preserve the tool identity admitted for active work, or defer activation until all affected users of the tool/service settle.
- Account for shared daemons, client/server versions and persistent indexes/data. In particular, a Codebase Memory update may involve more than swapping an executable. If parallel versions or state downgrade are unsafe, require a compatible maintenance/recovery path rather than implying seamless coexistence or rollback.
- Make download, preparation, activation, health failure, deferral and recovery visible as distinct operation states. Retain a previous compatible version when safe, without overwriting newer user changes or assuming data-schema rollback.
- Keep update discovery/download/preparation out of normal message dispatch. Evaluate background resource contention and startup costs; no zero-overhead assertion is made without measurements.
- Automatic operation requires a configured policy covering the effect; recheck ownership, relevant state and compatibility at execution time. Changing policy does not grant unrelated runner mutation authority.

Acceptance examples: a corrupt artifact never activates; offline checks leave a healthy installed version usable; an active indexed session is not broken by replacing its service; an incompatible upgrade explains why it is deferred/rejected; a failed activation preserves an honest recovery state; message dispatch does not wait for an update check. These are proposed future checks, not tests already executed.

## Roadmap placement

- **S1:** clear launch/connection failures, correlated minimal diagnostics, exact native support evidence and baseline timing points.
- **S2–S3:** meaningful effect/approval/cancellation errors, durable uncertain outcomes and fault/reconnect coverage.
- **S4–S5:** verified non-invasive or explicitly bounded runner integration, effective content/tool provenance, initial C15 version inspection/manual updates and no hidden per-message preparation.
- **S6:** proportional verification and compatibility regressions integrated into the developer workflow.
- **S7:** decide runner-management scope from the per-runner feasibility matrix; preserve externally owned resources.
- **S9–S10:** independent recovery/support diagnostics, supported update/state-compatibility paths, and evaluated optional automatic updates for managed helper binaries.

These refine existing slices, not a separate late hardening sprint. Source-backed findings and final acceptance will update the [catalog](product-catalog.md), [contracts](product-contracts.md) and [roadmap](roadmap.md).

## Work and evidence status

Investigate task `task-76e6fa3d-3149-4331-a9b0-c73eacd44679`, attempt 5, supplied a reviewed conditional feasibility baseline: launch-scoped mechanisms exist, while auth/history/native skill behavior and latency parity remain unproven. Instruction coverage was subsequently developed through the bounded batches recorded in the audit inventory. Quality attempt 3 supplied reliability findings and accepted the coexistence correction. Architect attempt 4 (42572/42573) was synthesized into the operating model, contracts and increments; Quality attempt 4 (44297/44298) passed that bounded planning candidate. Quality attempt 5 (71416/71417) subsequently passed the bounded instruction-audit and planning synthesis. Exact native/tool qualification and runtime acceptance remain pending.

The reliability review identified specific diagnostic loss in Codex's generic startup fallback and an outer web-handler catch that labels unexpected exceptions as invalid requests. It also identified existing failure classification/redaction, durable input claims, conservative recovery and guarded restoration worth preserving. Those bounded findings do not establish the cause of every reported incident, repository-wide absence of diagnostics, or measured logging latency. No runtime tests or benchmarks were run by the review.

Initial source anchors: [Codex process launch](../../deck/packages/adapter-codex/src/session-driver/launch.ts) accepts process overrides and a selected profile root; [OpenCode process launch](../../deck/packages/adapter-opencode/src/session-driver/launch.ts) constructs process configuration and tool specifications. These are mechanisms to investigate, not a complete no-mutation mode. [Daemon logging](../../deck/packages/session-host/src/daemon-logger.ts) and [recovery](../../deck/packages/session-host/src/recovery.ts) are initial reliability trace points; their presence or implementation alone does not establish user-visible failure rates or latency.
