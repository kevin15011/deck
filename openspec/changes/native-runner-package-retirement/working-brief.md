# Native runner package retirement

Status: design approved with four additional adjustments; implementation authorized as one candidate. Real-installation migration is gated on presentation/review of the concrete planning-only output. This supersedes the prior proposal to improve Context Mode/Serena parity.

Latest authority (2026-10-23): user approved only the reviewed 33 proven-owned removals after exact revalidation; the five ambiguous entries will be reviewed individually afterward. Active daemon work now requires waiting/deferral, so that real operation is authorized but deferred while this session executes. A13–A17 add mandatory historical-release CI, mode-specific upgrade behavior, active-work exclusion, public planning/recovery and changelog gates before publication. No release or broader real installation upgrade is authorized.

## User decision and scope

- Retire Deck installation, configuration, preparation and instruction composition for Context Mode and Serena across every runner and both native developer-team and cross-runner paths, including Lead and specialist roles/skills. Serena onboarding is included.
- Keep RTK unchanged.
- Make Codebase Memory optional and disabled by default; installation/preparation require explicit user activation.
- Prefer native web search when available under the current runner/model/provider/configuration; otherwise use the configured Deck provider. Detect effective capability rather than a fixed runner allowlist. Investigate Codex web_search=disabled, OpenCode without Zen/OPENCODE_ENABLE_EXA, Claude provider differences and Pi.
- Clean retired resources with manifest proof or location inside dedicated Deck directories. Preserve ambiguous shared-file entries unless the user explicitly confirms each displayed entry and context.
- Record all continuing Deck installation contributions in per-runner manifests with real content hashes and individual shared-file entries; no placeholder hashes.
- Unknown native web search uses the configured fallback with a possible-duplicate warning; unknown on supported configurations is a detection defect.
- Canonical configuration removes context-mode/Serena and defaults Codebase Memory off; legacy keys load, are ignored and reported.
- No changes to Lead workflow, check executor, output limits, session logic or Supermemory.
- Approved 2026-10-23: direct interactive Codex/Claude/OpenCode select search at launch/reopen only; managed cross-runner members still evaluate each turn. OpenCode's per-turn serve launch satisfies this boundary without dynamic MCP APIs. Doctor or the next session opening warns when effective configuration changed and an existing interactive CLI needs reopening. Pi receives no exception. Real migration remains pending plan review.

## First deliverable

Implement in the approved order: manifests, config/content, migration/review, per-turn search, complete verification. Do not migrate the user's actual installation (including indirect migration through install/update) before showing its concrete read-only plan. Real runner verification uses candidate-backed isolated installations and is reported separately from simulations.

Existing investigation owner: task-1cf2011b-0318-4587-84f5-47cef713f609. Artifact handoff: /tmp/native-runner-package-retirement/inventory.md and acceptance.md. Lead writes official artifacts; specialists do not edit OpenSpec.

Implementation owner: apply-deep, `task-a47ce13f-72f3-43c8-ab6c-87593818f50d`, accepted with structured NRP1–NRP5 covering A1–A12. Continue this same task for candidate corrections. This new task owns package retirement/manifests/search, distinct from the completed transport implementation. Real installation changes are excluded from its authority; isolated live checks and read-only planning are included. Candidate results remain unverified until reviewed.

## Acceptance topics to resolve from evidence

1. No retired-package references in generated Deck prompts, roles or skills, and no corresponding resources on clean installation.
2. Existing managed installations migrate cleanly and idempotently while preserving user-owned/shared/modified resources; ownership ambiguity and partial failures are explicit.
3. Codebase Memory is neither installed nor prepared without explicit opt-in, including legacy defaults whose provenance may be missing.
4. Exactly one effective search route when search is enabled, accounting for effective native configuration and the configured fallback. Identify any conflict with preserving independently installed user search tools rather than silently weakening either requirement.
5. RTK and Supermemory behavior remains unchanged; no unrelated execution/workflow changes.

The approved criteria below supersede the initial drafting topics. Historical OpenSpec evidence remains intact.

## Reviewed deliverable

- [Inventory](inventory.md): runner surfaces, canonical defaults, ownership limits, generated content, preparation and native-search evidence.
- [Approved acceptance](acceptance.md): twelve criteria and verification expectations.
- [Approved design](design.md): global Codebase Memory with runner exceptions, dedicated-root versus shared-entry cleanup, per-runner contribution manifests, planning-only and confirmation/recovery, and per-turn native-first search with unknown fallback.
- Reviewed investigation attempt 16, events 85084/85085. Corrected preliminary recommendations: markers/exact template matches do not replace manifest proof; unknown native search must not silently trigger a duplicate fallback; preparation contracts do not prove operations executed. Existing user direction already resolves ambiguous-resource preservation and unrelated preparation scope.
- User approved legacy Codebase Memory off/report and preservation of user search tools. User replaced unknown-search suppression with fallback/report, extended ownership to dedicated Deck directories, required per-entry confirmed ambiguity cleanup, complete per-runner manifests and canonical config removal. These decisions supersede the preliminary recommendations in the inventory and prior review note.
- Documentation validation: acceptance IDs A1–A10 and design Markdown fences checked; no production tests run because this is a design-only change.
- The user subsequently approved the design explicitly, with per-turn member-specific detection, planning-only migration, real four-runner verification and evaluation of a global Codebase Memory switch. The global switch plus runner overrides was selected: override > global > false. This supersedes the earlier design-approval pending state. Real-installation plan review and individual ambiguity confirmation remain separate boundaries.
