# Apply Progress: First-Class Codex CLI Runner Support

## Status

- Phase: Apply
- State: Completed
- Started: 2026-08-05
- Implementation owner: one continuous Apply Deep candidate through the first functional Codex vertical

## Approved product defaults

1. Codex project artifacts are commit-eligible by default; `--local-only` is exact, best-effort, and honest about tracked/shared edits.
2. Initial adaptive-memory support is none plus Supermemory; Engram is an explicit deferred gap.
3. First-class status requires every advertised launch mode to be bound to a trusted runner-host bridge; otherwise the mode remains `static-compatible`.
4. Project mutation requires preview and interactive confirmation, or explicit `--yes` for non-interactive use.

## Progress

| Phase | Status | Evidence |
|---|---|---|
| 0. Preconditions and spikes | Completed | Released Codex 0.145.0/0.146.1 fixtures; pinned source-range TOML parser; released hooks selected as bridge candidate. |
| 1. Runner composition and launch contracts | Completed | Discriminated launch contracts, generic CLI orchestration, one adapter registry, Pi/OpenCode compatibility paths. |
| 2. Safe Codex materialization | Completed | Seven roles/agent skills, 29 standalone bundles/support files, two bootstrap skills, AGENTS/TOML ownership, durable manifest, CAS journal/recovery/rollback, local-only handling. |
| 3. Functional Codex runtime candidate | Completed | Interactive, exec, resume-by-ID/latest grammar, inspected feature gating, preview/consent, production install-through-spawn; all modes `static-compatible`. |
| 4. Trusted execution and capability parity | Completed with approved gaps | MCP/shared binaries, none+Supermemory, model/reasoning, package instructions, metadata parity completed. Trusted host controls remain explicit gaps; every route stays `static-compatible`. Engram remains deferred. |
| 5. Doctor and targeted TUI | Completed | Adapter-driven environment/review/install/model/memory/doctor flows; registry-derived generic runner routing; no Codex placeholder or direct adapter import. |
| 6. Hardening, synchronization, docs, release | Completed | Content-only sync, docs, support matrix, generated assets, full suite, typecheck, four-target build, and Linux artifact smoke passed. |

## Verification evidence

- Pre-Apply OpenSpec validation: 0 errors, 0 warnings.
- Pre-Apply documentation governance: 10 passed, 0 failed.
- Specification traceability: 70 requirements, all covered by acceptance scenarios.
- Initial candidate focused tests: 188 passed, 0 failed.
- Pi/OpenCode contract and migration tests: 297 passed, 0 failed.
- Post-hardening focused lead rerun: 90 passed, 0 failed.
- TypeScript `bunx tsc --noEmit`: passed after candidate and after hardening.
- Independent quality review: safe to continue; no blocker or High finding remains.
- Complete candidate focused gates: Codex, core, CLI, doctor, sync, TUI, Pi/OpenCode, documentation, generated reachability, and generic synthetic-runner routing passed.
- Final independent pre-broad review: GO; no blocker, High, or Medium implementation finding remains.
- First broad run: 4303 passed, 1 failed (`core-purity-audit` detected new concrete runner/provider data in core).
- Root-cause repair: all Pi/OpenCode/Codex mappings and dispositions moved to immutable adapter-owned contributions; core diagnostics became runner-neutral; duplicate contributions fail deterministically; real Codex parity reaches inventory/review/doctor/TUI.
- Final broad suite: 4308 passed, 0 failed across 270 files; 17,274 assertions.
- Final TypeScript check: `bunx tsc --noEmit` passed.
- Release build: `bun run build` produced Deck 0.2.6 archives for Linux x64/arm64 and macOS x64/arm64 plus checksums.
- Built Linux x64 smoke: version/target metadata passed; Codex `--dry-run` rendered the complete mutation preview and left the temporary project empty.

## Current classification

- Interactive: `static-compatible`
- Exec: `static-compatible`
- Resume by ID: `static-compatible`
- Resume latest: `static-compatible`

No mode may become first-class until Phase 4 binds its exact production route to the trusted runner-host bridge.

## Accepted Apply gaps

- Trusted Codex host lifecycle and six protected execution controls remain explicit capability gaps; no public first-class promotion path ships.
- Engram remains deferred for Codex.
- The documented Node/Bun pathname-resolution race remains an accepted platform limitation after immediate revalidation and atomic replacement safeguards.

## Result

Apply is complete. The candidate is ready for Verify/Review evidence and user acceptance. No commit or push was performed.

## Post-review package-selection correction

User feedback revealed that Codex exposed inventory/parity capabilities as selectable packages. The package selector incorrectly used `getCapabilityIds()` instead of the dedicated package-instruction support contract.

The repaired boundary now exposes exactly five optional package instructions for Pi, OpenCode, and Codex, in canonical order:

1. `codebase-memory`
2. `context-mode`
3. `rtk`
4. `adaptive-memory`
5. `serena`

`code-economy` remains the always-on, non-toggleable baseline. Home Configure Packages, dashboard rows/cursors, loading, toggling, persistence, review actions, and final team-install bundle generation all intersect canonical package metadata with `adapter.packageInstructionIds`. Capability/parity/MCP/provider/skill entries cannot leak into package selection or bundles. Synthetic partial-support runners are covered end-to-end.

The same delta removed per-file journal amplification: apply now uses three transaction-level durable journal persists and rollback uses two, while retaining durable preimages/intents, CAS checks, file/directory fsync, crash recovery, and operation-scoped receipts.

Delta verification:

- Independent package-boundary review: no blocker, High, or Medium findings.
- Final broad suite after the correction: 4319 passed, 0 failed; 17,315 assertions.
- TypeScript: passed.
- Four-target release build: passed.

## Post-review Codex model-discovery correction

User feedback revealed that the Developer Team TUI was using Deck's static Codex model catalog rather than the models exposed by the installed/authenticated Codex CLI.

Codex model discovery now:

- runs released `codex debug models` as the authenticated primary source;
- falls back to `codex debug models --bundled` only when primary discovery fails;
- treats bundled output as stale, visibly degraded, and non-editable rather than active-account availability;
- exposes Retry through an uncached `rescan`;
- filters hidden/deprecated models and preserves priority, display metadata, defaults, upgrades, modalities, and capabilities;
- preserves per-model reasoning efforts dynamically, including `max` and `ultra`;
- stores canonical `openai-codex/<slug>` IDs while serializing native slugs to Codex;
- returns an explicit empty degraded inventory if both commands fail.

The subprocess uses no shell, ignored stdin, bounded stdout/stderr, timeout termination with SIGKILL escalation, race-safe completion, bounded catalog fields, and secret-free diagnostics. Tests inject all process behavior and perform no network or user-home access.

Model-discovery delta verification:

- Independent Quality: no blocker, High, or Medium findings.
- Final broad suite: 4333 passed, 0 failed; 17,354 assertions across 272 files.
- TypeScript: passed.
- Four-target release build: passed.

## Post-review Review & Install and Supermemory OAuth correction

Runtime feedback exposed two related boundaries after model discovery:

- Review & Install could receive a malformed runner inventory and dereference a missing `capabilities` array.
- Codex Supermemory setup incorrectly modeled authentication as a manually supplied `SUPERMEMORY_API_KEY` instead of Codex-native MCP OAuth.

The repaired Review & Install path normalizes adapter inventory to the shared `CapabilityInventory` contract. Invalid or mismatched inventory now produces a visible `dashboard-inventory-invalid` review result and performs no plan or apply effects.

Codex Supermemory now:

- writes only the streamable HTTP MCP endpoint `https://mcp.supermemory.ai/mcp`, with no bearer-token field;
- never asks Codex users to enter, capture, persist, or display a Supermemory token;
- exposes `codex mcp login supermemory` only as a user-owned follow-up after the complete reviewed installation succeeds;
- parses Codex 0.146 MCP status strictly, requiring `enabled: true` and `auth_status: "oauth"` for authenticated readiness;
- reports configured, authenticated, and indeterminate states without consulting `SUPERMEMORY_API_KEY`;
- never executes OAuth, opens a browser, starts a callback listener, or emits an authorization URL during installation;
- creates the inert follow-up only after typed post-apply verification evidence proves the exact MCP configuration and the overall installation succeeds;
- keeps post-apply evidence runner-neutral through the shared adapter contract and preserves Pi/OpenCode behavior.

Review & Install and OAuth delta verification:

- Independent Quality required two repair passes, then approved with no blocker, High, Medium, or advisory finding.
- Focused Core/Codex/OAuth/TUI/inventory/install checks passed; Pi/OpenCode/doctor regressions passed.
- Final broad suite: 4354 passed, 0 failed; 17,443 assertions across 275 files.
- TypeScript: passed.
- Four-target release build: passed.
- No live OAuth login was executed; the remaining interactive browser/account step belongs to the user-controlled Codex flow.

## Post-acceptance static-compatible review-readiness correction

User acceptance testing showed that Review & Install remained blocked after complete Codex configuration. The six approved protected-control gaps were correctly visible in inventory, but the review builder incorrectly converted them into executable blocked actions and included them in install readiness.

The correction adds a typed, adapter-owned `static-compatible-gap` review disposition for exactly those six controls. They remain required blocked capability gaps, remain visible as warnings, and continue to prevent first-class claims, but they are not install work and no longer block the approved static-compatible installation path. All other blocked capabilities—including unsupported runtime/version, collisions, selected deferred Engram, malformed inventory, and actual required failures—remain fail-closed. Review & Install now surfaces the first specific genuine blocker instead of a generic retry message.

Static-compatible readiness delta verification:

- Current-project reproduction: six protected gaps remained visible; no blocked manual actions were generated for them; `plan.ready` became true.
- Independent Quality: approved with no blocker, High, Medium, or advisory finding.
- Final broad suite: 4356 passed, 0 failed; 17,455 assertions across 275 files.
- TypeScript: passed.
- Four-target release build: passed.

## Post-acceptance user-owned OAuth correction

User acceptance testing showed that invoking Codex's native login from Review & Install attempted to open a browser and printed an authorization URL when browser launch failed. The product contract now assigns this interactive account authorization exclusively to the user.

Deck applies and semantically verifies only the credential-free Supermemory MCP configuration. It does not execute `codex mcp login supermemory` or own any browser, callback listener, or authorization URL. After—and only after—the entire reviewed installation succeeds, the completion result displays `Run codex mcp login supermemory when you are ready to authorize Supermemory.` as inert runner-neutral follow-up guidance. Failed, cancelled, partial, stale, or blocked runs show no OAuth next step. Read-only status inspection accepts only Codex 0.146's exact `enabled: true` plus `auth_status: "oauth"` authenticated state.

User-owned OAuth delta verification:

- Independent Quality: approved with no blocker, High, Medium, or advisory finding.
- Final broad suite: 4349 passed, 0 failed.
- TypeScript: passed.
- Four-target release build: passed.
- No OAuth login, browser, callback listener, or external account effect was executed during verification.

## Post-acceptance Codex model-assignment rehydration correction

User acceptance testing showed that model and reasoning assignments were correctly materialized in project-local `.codex/agents/deck-*.toml`, but Deck forgot them after restart because the Codex adapter's assignment readers returned empty maps and the TUI passed an empty project root.

The adapter now reads bounded project-local role TOML without mutation, restores native model slugs as canonical `openai-codex/<slug>` assignments, preserves unavailable installed models for visible unavailable state, and restores bounded dynamic `model_reasoning_effort` values. Deck passes the resolved project root and hydrates assignments before discovery updates availability. Missing files and fields remain harmless; malformed, oversized, symlink-redirected, or otherwise unsafe paths are omitted with safe Doctor diagnostics. Existing installed assignments require no migration.

Model-assignment rehydration verification:

- Current-project probe restored `openai-codex/gpt-5.6-sol` with reasoning `high` from `.codex/agents/deck-lead.toml`.
- Independent Quality: approved with no blocker, High, Medium, or advisory finding after symlink-ancestor hardening.
- Final broad suite: 4352 passed, 0 failed; 17,465 assertions across 274 files.
- TypeScript: passed.
- Four-target release build: passed.

## Post-acceptance direct Codex Lead launch correction

User acceptance testing identified an experience gap relative to OpenCode: Codex 0.146 exposes no native root custom-agent selector, Tab role picker, or `--agent` flag, while Deck's launch left the root session generic and required the user to request `deck-lead` manually.

`deck codex developer` now establishes new interactive and exec root sessions as Deck Lead automatically through a bounded static `developer_instructions` configuration override. The bootstrap requires the root to load the installed Lead skill, own the user outcome, route proportionately, coordinate native child roles, and remain the centralized OpenSpec writer. It is instruction-level and remains truthfully `static-compatible`; it does not claim native Codex root-role identity or host enforcement.

New sessions also apply the verified persisted Lead model and reasoning assignment. Interactive launch adds no synthetic user turn. Exec uses exact `codex exec -` grammar and sends the bounded user prompt only through typed stdin; prompts never enter argv, environment, previews, or diagnostics. Resume-by-ID/latest preserves the existing session without bootstrap, model, reasoning, or prompt reinjection. No `--agent`, child Lead spawn, global config write, or trust change is introduced. At the time of this delta, no sandbox/approval bypass was introduced; that historical policy was explicitly superseded by the user-approved 2026-08-10 amendment recorded in `preconditions.md` and REQ-CDX-RUN-005.

Direct Lead launch verification:

- Installed Codex 0.146 evidence confirmed `-c`, `exec -`, resume grammar, and absence of a native root `--agent` selector.
- Independent Quality: approved with no blocker, High, Medium, or advisory finding after exec stdin normalization.
- Final broad suite: 4360 passed, 0 failed; 17,514 assertions across 274 files.
- TypeScript: passed.
- Four-target release build: passed.

## User-approved always-on Codex sandbox and approval bypass

On 2026-08-10, after an informed warning, the user explicitly selected an always-on launch policy for Deck's Codex Developer Team route. Every supported non-install-only interactive, exec, resume-by-ID, and resume-latest plan now places exactly one fixed `--dangerously-bypass-approvals-and-sandbox` token at argv position zero, before any Codex subcommand.

The policy is adapter-owned and cannot be supplied, removed, duplicated, or transformed through caller input, persisted model/reasoning assignments, user prompts, environment, project TOML, global config, roles, or manifests. Option-shaped model/reasoning values fail closed, while the same text in an exec prompt remains bounded stdin-only data. Install-only performs no launch; install-only dry-run receives a runner-neutral policy diagnostic without planning or spawning Codex. Interactive previews, launch diagnostics, Doctor, and public documentation warn that Codex may run commands and modify or delete files without sandboxing or command approvals.

Always-on bypass verification:

- Independent security review initially found argv duplication through an adversarial model value and missing install-only dry-run disclosure; both were repaired and re-reviewed.
- Final delta review: no blocker, High, Medium, or advisory finding.
- Final broad suite: 4365 passed, 0 failed; 17,563 assertions across 274 files.
- TypeScript: passed.
- Four-target release build: passed.
- No real Codex process was launched during automated verification.

This delta does not resolve the separately confirmed marker-ownership and unowned-byte-preservation blockers or the existing Medium backlog. The overall candidate remains not ready for push, merge, or release.

## Post-acceptance shared Serena launcher correction

Runtime testing on Codex 0.147 showed that Serena failed with `No such file or directory` even though Deck had already installed a healthy Serena 1.6.1 runtime for OpenCode. OpenCode used the absolute Deck-owned launcher under the private Serena tool root, while Codex incorrectly serialized the bare command `serena`, which was not on `PATH`.

Core now exposes the canonical bounded existing-Serena readiness contract. The first repair serialized the validated absolute launcher like OpenCode/Pi; pre-commit review found that representation was not portable in commit-eligible project Codex configuration. That intermediate serialization is superseded by the portable Deck proxy correction below. Missing or unusable readiness still blocks broken MCP configuration; explicitly authorized provisioning uses the existing Core bootstrap. Legacy Deck-managed entries remain repairable, while unowned same-ID collisions remain fail-closed.

The project-local `deck-release-publish` skill also received valid Codex YAML frontmatter; it was a tracked legacy skill rather than a Codex-generated manifest entry.

Serena/frontmatter verification:

- Existing private launcher probe: Serena 1.6.1 resolved outside `PATH` with no reinstall.
- Independent Quality initially found Doctor ordering and stale inspection-cache issues; both were repaired and the final delta review approved with no findings.
- Final broad suite: 4373 passed, 0 failed; 17,606 assertions across 274 files.
- TypeScript: passed.
- Four-target release build: passed.
- No current project config, user-home config, real MCP server, commit, or push was modified by verification.

The overall candidate remains blocked by the inherited marker-ownership and unowned-byte-preservation findings.

## Pre-commit portable Serena proxy and planning-scope correction

Pre-commit review rejected the user-specific absolute Serena path and found that several TUI/sync call sites could build plans without preparation. Codex now commits only the portable MCP entry `command = "deck"`, `args = ["internal", "serena-mcp"]`, and inherited environment names `HOME`, `PATH`, and `XDG_DATA_HOME`. The hidden `deck internal serena-mcp` route performs read-only Core resolution and proxies fixed Serena arguments without a shell, bootstrap, configuration write, arbitrary input, or global PATH mutation. It forwards termination signals, cleans handlers/timers, and preserves child exit/signal outcomes.

Full install paths require a bounded capability probe returning `deck-serena-mcp-proxy-v1`; unsupported or stale Deck binaries block before portable config is claimed ready. The final probe bound is 2 seconds, matching the existing bounded Doctor executable probe and accommodating compiled binary startup. Public inventory probes freshly; Doctor and one operation reuse bounded evidence; apply/verify revalidate.

Generic planning now distinguishes `full` from `content-only`. Normal CLI/TUI team/package/model/install paths prepare exactly once. Content-only sync and backup perform no Serena resolution/bootstrap and no runtime/MCP/provider/config mutation; existing manifest-owned config bytes/hash carry forward without adopting drift. A later full install performs the managed bare/absolute-to-proxy migration. The current project artifacts were regenerated transactionally with no home path.

Portable Serena verification:

- Current `.codex/config.toml`: portable `deck internal serena-mcp` entry; no username or installation root.
- Temporary and packaged Linux x64 binary probes returned `deck-serena-mcp-proxy-v1`.
- Final broad suite: 4387 passed, 0 failed; 17,665 assertions across 275 files.
- TypeScript: passed.
- Four-target release build: passed.
- No secret or absolute home path was added to the diff.

The overall candidate remains blocked by the inherited materialization ownership and unowned-byte-preservation findings.
