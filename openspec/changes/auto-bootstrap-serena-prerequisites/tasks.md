# Tasks: Auto-bootstrap Serena prerequisites

## Authority, reconciliation, and execution limits

- **Approved scope inputs:** Proposal `sha256:d4cc905b11ca6604f2760b3ab11abafa466a8815258f53f0979f4bb8481e8184`; Spec `sha256:d60592b9b705df3a0dbeaf2203fd08cf4c4fecd2d3fb3d960141b1f5d38729ae`; Design `sha256:849e3e245c36cfd6ed8bc61ae6d4592c2d6c6175ebff69b29e236ac351e7b257`.
- **Scope:** the current interactive Deck TUI Review & Install operation for OpenCode and Pi, and only after the user explicitly selects Serena for that operation. The official installer is remote executable content; the user accepted that residual risk. Deck must make no claim that the endpoint, installer, or downstream artifacts are independently integrity-verified, checksum-verified, release-pinned, attested, or provenance-verified.
- **Reconciliation:** the former custom pinned-archive, attestation, trust-manifest, archive/executable-digest, target-classifier, and tar-decoder work is superseded and is not a requirement, task, test, dependency, or Apply gate. No task may recreate it or treat it as evidence.
- **Apply status:** `P-SEC-001` is superseded and must not block Apply. The former `P-CLI-001` collision was resolved when `opencode-configured-providers-filter` was closed as abandoned under explicit user authorization at `2026-08-03T22:27:19Z`; its state is `phase: closed`, `status: abandoned`, and its archive report records no source WIP and the unresolved backend scope. No external ownership handoff blocks T17. T17 must still fresh-read `app.tsx`, restrict edits to Serena selection/cancellation/composition behavior, and rerun relevant provider-filter/menu regression tests as implementation safety checks. The current coordinator lacks Bun, so no automated check is run here; a Bun-capable runner is required for independent QA evidence. This environment constraint does not authorize scope reduction or a substitute live test.
- **Planning evidence:** no installer, network, child process, user-home write, `bun run deck:run`, or automated test was run during this reconciliation.
- **Write authority:** this phase writes only `tasks.md` and `preconditions.md`. Future Apply may modify only the exact 38 implementation/test paths in the allowlist below. No registry YAML, state/events, Proposal, Spec, Design, prompt, skill, system instruction, generated/materialized file, source outside the allowlist, test outside the allowlist, configuration, dependency, lockfile, or Git state is in scope.
- **Adaptive context:** not loaded; official Proposal, Spec, Design, repository evidence, and preconditions are authoritative.

## Requirement and scenario index

Every Apply and independent gate task maps to these approved identifiers:

### Requirements

- `REQ-SERENA-GATE-001` — Serena effects require current-operation explicit TUI selection; defaults, startup, initialization, bulk, and unrelated flows never authorize them.
- `REQ-SERENA-REUSE-001` — inspect Deck-owned `uv`/Serena readiness first; reuse fresh ready state; found-but-unusable or indeterminate Serena fails closed without replacement.
- `REQ-SERENA-BOOTSTRAP-001` — when selected Serena is missing and Deck-owned `uv` is unavailable, use only `https://astral.sh/uv/install.sh` through the controlled process with `UV_UNMANAGED_INSTALL` in Deck-owned storage; Python is delegated to `uv`.
- `REQ-SERENA-BOUNDARY-001` — fixed URL/arguments/environment/executables only; no shell interpolation, inherited environment, profiles, `PATH` edits, global/system Python, system directories, `pipx`, or fallback; no independent-verification claim.
- `REQ-SERENA-COMMAND-001` — after resolved `uv` readiness, invoke exactly `tool install -p 3.13 serena-agent` through the resolved `uv` path.
- `REQ-SERENA-SOURCE-001` — selectable source identity is `serena-agent`; no stale repository or generic Python-tool identity.
- `REQ-SERENA-CANCEL-001` — stop pending work, terminate active children, await known termination or report `partial`, skip writes, and preserve partial user state.
- `REQ-SERENA-READY-001` — successful flow carries fresh resolved Serena path/fingerprint evidence; installer exit status alone is insufficient; revalidate immediately before MCP configuration.
- `REQ-SERENA-MCP-GATE-001` — every failure, cancellation, partial, stale, path-validation, readiness, or configuration failure skips Serena writes and preserves known-good configuration.
- `REQ-SERENA-UX-001` — render only concise applicable stages and bounded, redacted, actionable outcomes; never expose raw streams or private paths.
- `REQ-SERENA-PARITY-001` — OpenCode and Pi have equivalent selection, reuse, bootstrap, command, cancellation, readiness, gating, and redaction semantics without capability standardization.
- `REQ-SERENA-TEST-001` — unit, adapter-contract, and render tests use strict deterministic mocks and perform no network, real installer/process, or user-home I/O.
- `REQ-SERENA-MANUAL-001` — only the user may later run `bun run deck:run`; it is deferred, not automated, and never run by an agent.

### Scenarios

- `S01` Unselected Serena is inert.
- `S02` Explicit selection is runner-scoped.
- `S03` Ready installation is reused.
- `S04` Missing `uv` uses the controlled official installer.
- `S05` Existing unusable Serena fails closed.
- `S06` Exact Serena command follows `uv` validation.
- `S07` Bootstrap safety boundary is enforced.
- `S08` Official installer failure has no fallback.
- `S09` Cancellation before mutation.
- `S10` Cancellation during an active command.
- `S11` Fresh readiness enables configuration.
- `S12` Post-install executable is not ready.
- `S13` Known-good configuration is preserved.
- `S14` Successful flow is progressful but quiet.
- `S15` Unsafe diagnostic data is redacted.
- `S16` Equivalent runner outcomes.
- `S17` Automated evidence has no external effects.
- `S18` Manual validation is deferred.

## Global design constraints and exclusions

- **AD-1:** one runner-neutral Core service owns authorization, Deck-owned path resolution, official-installer acquisition/execution, sequencing, cancellation, readiness, redaction, and typed outcomes; adapters translate to native formats and the CLI owns intent/progress/cancellation composition. All effects are injectable.
- **AD-2:** explicit selection is ephemeral current-operation state. Defaults, preferences, inventory, existing configuration, and prior operations never authorize Serena; runner changes and new operations reset it.
- **AD-3:** begin only at the fixed official HTTPS endpoint `https://astral.sh/uv/install.sh`, manually follow at most five server-provided HTTPS redirects without embedded credentials or custom ports, and use a controlled direct `/bin/sh` child with script bytes on stdin. Reject insecure, credential-bearing, malformed, or excess redirects. Do not independently verify or describe the remote content as verified. No alternate starting endpoint, user-controlled URL, archive, package manager, or fallback is permitted.
- **AD-4:** resolve a canonical user-owned `<deck-data-root>/tools/serena/` root and use `uv/`, `uv-tools/`, `bin/`, `python/`, `python-bin/`, and `cache/` for `UV_UNMANAGED_INSTALL`, `UV_TOOL_DIR`, `UV_TOOL_BIN_DIR`, `UV_PYTHON_INSTALL_DIR`, `UV_PYTHON_BIN_DIR`, and `UV_CACHE_DIR`. Use newly constructed allowlisted environments, never `process.env`; never modify profiles, `PATH`, global/system Python, or system directories; never invoke `pipx` or `uv self update`.
- **AD-5:** readiness uses only contained absolute managed paths, stable identity/fingerprint, bounded direct probes, and fresh evidence. An expected `uv tool install` symlink is valid only while its canonical regular executable target remains inside the same owned root; fingerprint and immediate pre-write revalidation bind both link and target identities. Dangling, escaping, retargeted, found-but-unusable, or indeterminate Serena is not replaced or configured.
- **AD-6:** results carry typed readiness evidence privately; writers receive the resolved absolute executable and exact fixed MCP arguments, preserve unrelated/known-good state, use atomic merges, and return `created|updated|unchanged`.
- **AD-7:** one operation `AbortController` crosses UI, runner, adapters, Core, fetch, probes, child process, and writers. Cancellation stops pending work, requests termination, waits for known close/error, reports `partial/termination-unknown` when unknown, and never cleans up user state.
- **AD-8:** use only fixed stage enums/templates and bounded sanitization. Keep child output internal; redact credentials, tokens, private roots, control/format characters, and unbounded output.
- **No EII applies:** every task has EII ID `none`, EII mode `none`, and must preserve the exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”

### Explicitly excluded from every task

`runner-capability-standardization`; custom pinned archives; archive/executable digest or checksum verification; attestation, provenance, or trust-manifest material; target/libc classifiers; archive/tar decoders; installer scripts other than the fixed official endpoint; fallback installers; `pipx`; system/global Python; profile or `PATH` mutation; self-update; startup, `deck-init`, project-initialization, implicit/default/bulk/global installs; language-server tooling; generated/materialized files; registry YAML/history; prompts, skills, and system instructions; package dependencies/lockfiles; historical OpenSpec changes; unrelated capability behavior; live installer/network/process execution; user-home writes by agents/tests; `bun run deck:run` by agents; destructive Git operations; and the closed `opencode-package-install-running-binary-regression` change.

### Joint rollout and rollback contracts

- **R0 rollout:** land and independently check the Core service/contracts first; complete OpenCode and Pi with equivalent gates; then enable the joint CLI flow only after targeted checks, affected-area checks, independent Review, broad QA, cancellation, readiness/configuration gates, redaction, and scope checks pass. Unsupported bootstrap platforms remain fail-closed. The user-only `bun run deck:run` is deferred acceptance evidence.
- **RB rollback:** revert only future source/tests in this change as a normal source change. Preserve existing valid MCP configuration, partial tools, `uv`, Python, and Serena state. Never delete user state, rewrite registry history, or use Git discard/reset/restore/clean operations.

## Execution groups and dependency order

| Group | Tasks | Route | Order / parallelism |
|---|---|---|---|
| G1 Shared Core | T01–T02 | Backend/General Apply | T01 → T02; no runner work starts before T02 contracts are available. |
| G2 OpenCode | T03–T07 | Backend Apply | T03 → T04; T05 and T07 may run in parallel after their dependencies; T06 joins after T04, T05, and T07. |
| G3 Pi | T08–T12 | Backend Apply | T08 → T09; T10 and T12 may run in parallel after their dependencies; T11 joins after T09, T10, and T12. G2 and G3 are independent after T02. |
| G4 CLI TUI | T13–T17 | Frontend Apply | T13 follows both plan tasks; T14 follows both adapter joins; T15 → T16 → T17. T17 has no external collision dependency and retains an in-task fresh-read/scope/regression safety check. |
| G5 Independent Targeted Verify | T18 | Independent Verify | After T01–T17; no Apply author verifies their own work. |
| G6 Independent Affected-Area Verify | T19 | Independent Verify | After T18; fresh affected-area evidence, with no source repair. |
| G7 Independent Review | T20 | Independent Review | After T19; fresh reviewer and fresh evidence; Review cannot waive a failed gate. |
| G8 Independent Broad QA | T21 | Independent Verify | After T20 acceptance; broad repository evidence is the final automated gate and cannot repair source or waive Review. |

**Required independent order:** targeted checks (T18) → affected-area checks (T19) → independent Review (T20) → broad QA (T21). No live installer or user-home effect is substituted for any step.

## Apply tasks

### T01 — Core controlled official-`uv` bootstrap and Serena readiness service

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — shared runtime foundation; T02 depends on it.
- **Depends on:** None.
- **Files (exact allowlist):**
  - `packages/core/src/serena-bootstrap.ts`
  - `packages/core/src/serena-bootstrap.test.ts`
- **Requirements:** `REQ-SERENA-REUSE-001`, `REQ-SERENA-BOOTSTRAP-001`, `REQ-SERENA-BOUNDARY-001`, `REQ-SERENA-COMMAND-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-UX-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S03`, `S04`, `S05`, `S06`, `S07`, `S08`, `S09`, `S10`, `S11`, `S12`, `S15`, `S17`.
- **Design constraints:** AD-1, AD-3, AD-4, AD-5, AD-7, AD-8. Require `interactive-tui-explicit-selection`, runner, and operation identity. Probe canonical Deck-owned Serena and `uv` first; reuse fresh ready state; block found-but-unusable/indeterminate Serena. If `uv` is missing, begin with a bounded GET to `https://astral.sh/uv/install.sh`, manually follow at most five server-provided HTTPS redirects without credentials or custom ports, and feed bounded bytes to a direct `/bin/sh` child with `shell: false`, no command string, no user URL/argument interpolation, and a newly constructed allowlisted environment. Set `UV_UNMANAGED_INSTALL` below the owned root, validate `<root>/uv/uv` by absolute path and `--version`, then invoke only the resolved `uv` with `['tool','install','-p','3.13','serena-agent']` and the fixed Deck-owned tool/Python/cache environment. Do not inherit the environment or alter profiles, `PATH`, system/global Python, system directories, `pipx`, or self-update. Probe Serena directly with `['--help']`, produce stable path/fingerprint evidence, bound/redact diagnostics, and implement known-outcome cancellation, partial termination, pre-effect checks, and same-root single-flight. Make no independent-verification claim about remote content.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Environment contract:** the installer child receives exactly `PATH=/usr/bin:/bin`, `LC_ALL=C`, `UV_UNMANAGED_INSTALL=<deck-data-root>/tools/serena/uv`, and `UV_NO_MODIFY_PATH=1`; the Serena child receives exactly `PATH=/usr/bin:/bin`, `LC_ALL=C`, `UV_TOOL_DIR=<root>/uv-tools`, `UV_TOOL_BIN_DIR=<root>/bin`, `UV_PYTHON_INSTALL_DIR=<root>/python`, `UV_PYTHON_BIN_DIR=<root>/python-bin`, and `UV_CACHE_DIR=<root>/cache`. Construct both environments afresh; never inherit `process.env`. Unsupported fixed-child environments fail closed before fetch.
- **Description:** Add the runner-neutral controlled official-installer service and typed safe outcomes `reused|installed|failed|cancelled|partial`. Every external boundary is injected; production defaults are not reached by tests. The service owns no runner adapter or TUI state.
- **RED:** Add deterministic mocked failures for missing/invalid authorization, unselected/default-only/runner-mismatched operations, outside-root paths, unusable Serena, missing `uv`, non-fixed initial URL, insecure or excess redirect, oversized/timeout response, installer failure, unusable post-installer `uv`, exact-command violations, unsafe/inherited environment, forbidden fallback, unready Serena, dangling/escaping/retargeted symlinks, path/fingerprint drift, cancellation before each effect, confirmed termination, unknown termination, raw/private diagnostic leakage, and all forbidden external effects. Assert acceptance of only a contained stable `uv tool install` symlink, the exact initial URL, bounded secure redirect behavior without a volatile CDN allowlist, direct `/bin/sh` stdin shape, `shell:false`, fixed environments, `UV_UNMANAGED_INSTALL`, exact Serena argument array, no `pipx`/self-update/profile/PATH/system writes, and no independent-verification wording.
- **GREEN:** Implement only the smallest service and injected effect seams needed for RED. Tests use fake fetch, process, filesystem, path resolver, probe, clock/timeout, cancellation, and redaction dependencies; no network, installer, process, or user-home I/O is reachable. Preserve partial state and never perform cleanup or fallback.
- **Verification:** Targeted future-only `bun test packages/core/src/serena-bootstrap.test.ts`; affected Core checks are T19. No command runs in this phase.
- **Completion evidence:** authorization and sequence trace; exact endpoint/process/argument/environment assertions; Deck-root containment; reuse and fail-closed matrix; readiness path/fingerprint and revalidation fixtures; cancellation/partial evidence; bounded redaction evidence; and proof that every test effect was mocked.
- **Rollout:** R0; both adapters remain disabled until this service and its contracts pass independent checks.
- **Rollback boundary:** RB; revert only this service/test pair and preserve external tools/configuration.
- **Task-specific excluded targets:** no archive downloader/parser/decoder, trust manifest, attestation/provenance/checksum module, target classifier, fallback installer, adapter import, or file outside the two listed paths.

### T02 — Core authorization, readiness, and MCP result contracts

- **Owner:** General Apply
- **Priority:** P0
- **Complexity:** Medium
- **Parallel:** No — depends on T01 and precedes both adapters and the CLI.
- **Depends on:** T01.
- **Files (exact allowlist):**
  - `packages/core/src/index.ts`
  - `packages/core/src/runner-adapter.ts`
  - `packages/core/src/runner-adapter.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S01`, `S02`, `S03`, `S05`, `S11`, `S13`, `S16`, `S17`.
- **Design constraints:** AD-1, AD-2, AD-6. Export additive authorization, operation, readiness, revalidator, and `created|updated|unchanged` result contracts. Reject non-Serena evidence, relative/NUL/escaping paths, unknown states, missing success evidence, stale evidence, and failed/cancelled/partial evidence. Do not persist explicit selection and do not make Core depend on an adapter or CLI.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Make Core-facing DTOs carry current-operation authorization and resolved readiness evidence rather than a bare command or exit status. Keep unrelated consumers source-compatible through additive optional fields.
- **RED:** Add contract assertions for invalid evidence, missing success evidence, unsafe paths, stale fingerprints, failed/cancelled/partial values carrying evidence, unchanged writer results, valid reusable evidence, and additive export compatibility.
- **GREEN:** Implement additive types, validators, exports, and test seams only; prove no existing export is removed or reinterpreted and no evidence can bypass the pre-write revalidator.
- **Verification:** Targeted future-only `bun test packages/core/src/runner-adapter.test.ts`; affected Core checks are T19. No command runs now.
- **Completion evidence:** public export/type snapshot, valid/invalid evidence table, revalidation contract tests, typecheck output from T19, and a three-file scope audit.
- **Rollout:** R0; consumers remain disabled until both runner paths and CLI use these contracts.
- **Rollback boundary:** RB; preserve non-Serena result shapes and all user state.
- **Task-specific excluded targets:** no runner-specific serialization, persisted selection, registry, public network API, or changes outside the three listed paths.

### T03 — OpenCode Serena source identity and selectable metadata

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** Low
- **Parallel:** Yes — after T02; independent of Pi metadata.
- **Depends on:** T02.
- **Files (exact allowlist):**
  - `packages/adapter-opencode/src/capability-catalog.ts`
  - `packages/adapter-opencode/src/capability-catalog.test.ts`
  - `packages/adapter-opencode/src/installation-plan.ts`
  - `packages/adapter-opencode/src/installation-plan.test.ts`
- **Requirements:** `REQ-SERENA-SOURCE-001`, `REQ-SERENA-GATE-001`, `REQ-SERENA-PARITY-001`.
- **Scenarios:** `S02`, `S06`, `S16`.
- **Design constraints:** AD-2 and AD-4. Preserve capability ID `serena` and OpenCode scope, expose `serena-agent` as the installable source identity, and do not describe repository, generic Python-tool, default, or stale installation behavior.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Correct only OpenCode catalog and installation-plan metadata. Do not invoke installation, inspect PATH, or move MCP configuration into metadata.
- **RED:** Assert exact `serena-agent` identity, no stale identity or fallback text, unchanged capability IDs/ordering/required flags, and no implicit authorization metadata.
- **GREEN:** Update the smallest metadata surfaces and focused tests without changing unrelated tools.
- **Verification:** Targeted future-only `bun test packages/adapter-opencode/src/capability-catalog.test.ts packages/adapter-opencode/src/installation-plan.test.ts`.
- **Completion evidence:** exact source identity assertions, stale-text absence, and four-file scope audit.
- **Rollout:** R0; metadata activates only with OpenCode plan/service/config wiring.
- **Rollback boundary:** RB; revert metadata without deleting tools or configuration.
- **Task-specific excluded targets:** no installer, MCP serialization, Pi, CLI, archive/trust material, or other file.

### T04 — OpenCode explicit plan gating and action ordering

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** Medium
- **Parallel:** Yes — after T03; independent of Pi plan work.
- **Depends on:** T02, T03.
- **Files (exact allowlist):**
  - `packages/adapter-opencode/src/capability-plan.ts`
  - `packages/adapter-opencode/src/capability-plan.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-PARITY-001`.
- **Scenarios:** `S01`, `S02`, `S03`, `S05`, `S11`, `S13`, `S16`.
- **Design constraints:** AD-2 and AD-6. Require ordinary selection and current-operation explicit selection, matching operation/runner context, deterministic install-before-config ordering, and `configWrites` after installation. Never manufacture readiness or configure unrelated capabilities.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Make a default/config-loaded Serena selection inert and emit Serena actions only for the authorized current operation; the action runner remains responsible for evidence and final gating.
- **RED:** Table-test default-only, unselected, explicitly selected, ready reuse, failed/unusable inventory, runner mismatch, config-write grouping, stale operation, and unrelated-capability continuation.
- **GREEN:** Implement the dual selection gate and deterministic order while retaining all non-Serena action shapes.
- **Verification:** Targeted future-only `bun test packages/adapter-opencode/src/capability-plan.test.ts`.
- **Completion evidence:** exact action/group assertions, no default-only Serena action, and two-file scope audit.
- **Rollout:** R0; no plan is executable until T05–T07 and CLI evidence gates are complete.
- **Rollback boundary:** RB; reverting plan code does not touch existing MCP configuration.
- **Task-specific excluded targets:** no provider-filter/menu-windowing, general scheduler, Pi plan, or Core implementation.

### T05 — OpenCode projection into Core controlled bootstrap

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** Yes — after T02/T03; may run alongside T04 and T07.
- **Depends on:** T01, T02, T03.
- **Files (exact allowlist):**
  - `packages/adapter-opencode/src/install-tools.ts`
  - `packages/adapter-opencode/src/install-tools.test.ts`
- **Requirements:** `REQ-SERENA-REUSE-001`, `REQ-SERENA-BOOTSTRAP-001`, `REQ-SERENA-BOUNDARY-001`, `REQ-SERENA-COMMAND-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-UX-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S03`, `S04`, `S05`, `S06`, `S07`, `S08`, `S09`, `S10`, `S12`, `S15`, `S17`.
- **Design constraints:** AD-1, AD-3, AD-4, AD-5, AD-7, AD-8. Replace only the obsolete OpenCode Serena branch with a thin Core projection carrying authorization, operation signal, resolver, progress, and injected effects. Preserve non-Serena installers and do not add a system-Python or fallback path.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Map Core outcomes, stages, bounded diagnostics, cancellation, and readiness evidence into the existing OpenCode installer result family. Core alone owns the official endpoint and exact command; this adapter must not duplicate or weaken that policy.
- **RED:** Mock reuse, controlled missing-`uv` bootstrap, fixed URL/process/environment, exact `tool install -p 3.13 serena-agent`, no inherited environment, no fallback/pipx/system Python, cancellation/partial, unready post-install, redaction, and zero production I/O.
- **GREEN:** Delegate all Serena effects to Core and project the result; every fake records calls and asserts forbidden effects are absent.
- **Verification:** Targeted future-only `bun test packages/adapter-opencode/src/install-tools.test.ts`; affected OpenCode checks are T19.
- **Completion evidence:** verification-before-execution trace, exact command/environment assertions, outcome/evidence mapping, forbidden fallback absence, and two-file scope audit.
- **Rollout:** R0; do not expose the projection to the TUI until T06, T07, T14, and T17 pass.
- **Rollback boundary:** RB; preserve partial tools and known-good configuration.
- **Task-specific excluded targets:** no Core implementation, live endpoint/process, OpenCode writer, archive/trust work, or file outside the two listed paths.

### T06 — OpenCode evidence handoff and fail-closed adapter action

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — OpenCode integration join.
- **Depends on:** T02, T04, T05, T07.
- **Files (exact allowlist):**
  - `packages/adapter-opencode/src/runner-adapter.ts`
  - `packages/adapter-opencode/src/runner-adapter.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S01`, `S02`, `S05`, `S08`, `S09`, `S10`, `S11`, `S12`, `S13`, `S16`, `S17`.
- **Design constraints:** AD-1, AD-5, AD-6, AD-7. Require explicit authorization, current runner/operation identity, valid evidence, cancellation state, and an immediate same-path/same-fingerprint revalidation before T07 writes. No PATH lookup or bare `serena` gate remains.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Carry T05 evidence into OpenCode's result family, move Serena configuration into `configWrites`, and reject direct/manual/stale plans, changed evidence, failed/cancelled/partial outcomes, and unknown operation context without calling the writer.
- **RED:** Test stale/handcrafted plans, invalid/missing/changed evidence, failed/cancelled/partial outcomes, cancellation races, known-good preservation, unrelated capability continuation, exact writer invocation, and no raw/private data in callbacks.
- **GREEN:** Add the evidence and revalidation guards while preserving native non-Serena action translation.
- **Verification:** Targeted future-only `bun test packages/adapter-opencode/src/runner-adapter.test.ts`; affected adapter checks are T19.
- **Completion evidence:** blocked-path writer matrix, one immediate matching revalidation positive trace, known-good preservation, and two-file scope audit.
- **Rollout:** R0; OpenCode cannot activate alone or bypass Pi parity.
- **Rollback boundary:** RB; never remove valid configuration during rollback.
- **Task-specific excluded targets:** no CLI controller, provider filtering, generic runner standardization, or Core changes.

### T07 — OpenCode absolute-path idempotent Serena MCP writer

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** Yes — independent writer boundary; T06 consumes it.
- **Depends on:** T01, T02, T03.
- **Files (exact allowlist):**
  - `packages/adapter-opencode/src/opencode-mcp-config.ts`
  - `packages/adapter-opencode/src/opencode-mcp-config.test.ts`
- **Requirements:** `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S11`, `S12`, `S13`, `S17`.
- **Design constraints:** AD-5 and AD-6. Accept only a validated absolute contained executable and exact array `[absolutePath, 'start-mcp-server', '--context', 'ide', '--project-from-cwd']`; preserve unrelated entries; reject malformed/unreadable configuration; use same-directory atomic merge; return `unchanged` without writing equivalent known-good state.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Add only Serena-specific OpenCode serialization. A legacy bare entry stays untouched on any failure/cancellation and may be replaced only after successful selected-operation evidence and revalidation.
- **RED:** Fixture-test relative/NUL/escaping/private/changed paths, wrong args, malformed config, unrelated-entry preservation, known-good no-write, legacy-on-failure preservation, and `created|updated|unchanged` results.
- **GREEN:** Implement validated atomic idempotent merge using injected fixture paths; never write a real home.
- **Verification:** Targeted future-only `bun test packages/adapter-opencode/src/opencode-mcp-config.test.ts`.
- **Completion evidence:** exact serialized array, no-write/preservation assertions, malformed-config failure, unchanged result, and two-file scope audit.
- **Rollout:** R0; callable only after T06/T14 revalidation gates.
- **Rollback boundary:** RB; do not delete or rewrite configuration during rollback.
- **Task-specific excluded targets:** no generic MCP rewrite, Pi writer, user-home test path, archive/trust work, or other file.

### T08 — Pi Serena source identity and selectable metadata

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** Low
- **Parallel:** Yes — after T02; independent of OpenCode metadata.
- **Depends on:** T02.
- **Files (exact allowlist):**
  - `packages/adapter-pi/src/capability-catalog.ts`
  - `packages/adapter-pi/src/capability-catalog.test.ts`
  - `packages/adapter-pi/src/installation-plan.ts`
  - `packages/adapter-pi/src/installation-plan.test.ts`
- **Requirements:** `REQ-SERENA-SOURCE-001`, `REQ-SERENA-GATE-001`, `REQ-SERENA-PARITY-001`.
- **Scenarios:** `S02`, `S06`, `S16`.
- **Design constraints:** AD-2 and AD-4. Keep capability ID `serena` and Pi scope, expose `serena-agent`, and remove metadata that presents Serena as a default/persisted authorization or generic Python tool.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Correct only Pi catalog and installation-plan metadata. Actual current-operation authorization is T13; bootstrap projection is T10.
- **RED:** Assert exact source identity, no stale/default/fallback text, and unchanged unrelated catalog/order behavior.
- **GREEN:** Update the smallest metadata surfaces and focused tests without changing other capabilities.
- **Verification:** Targeted future-only `bun test packages/adapter-pi/src/capability-catalog.test.ts packages/adapter-pi/src/installation-plan.test.ts`.
- **Completion evidence:** exact `serena-agent` assertions, stale-text absence, and four-file scope audit.
- **Rollout:** R0; metadata activates only with Pi service/config wiring and parity.
- **Rollback boundary:** RB; preserve user tools/configuration.
- **Task-specific excluded targets:** no Pi installer loop, MCP writer, CLI default state, archive/trust work, or other file.

### T09 — Pi explicit plan gating and capability-specific action

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** Medium
- **Parallel:** Yes — after T08; independent of OpenCode plan work.
- **Depends on:** T02, T08.
- **Files (exact allowlist):**
  - `packages/adapter-pi/src/capability-plan.ts`
  - `packages/adapter-pi/src/capability-plan.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-PARITY-001`.
- **Scenarios:** `S01`, `S02`, `S03`, `S05`, `S11`, `S13`, `S16`.
- **Design constraints:** AD-2 and AD-6. Require ordinary and current-operation explicit selection, matching operation/runner context, a named Serena configuration action only for Serena's selected operation, no false readiness, and no incidental writes from unrelated Pi actions.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Narrow Pi plan generation without standardizing all capabilities; T11/T14 later gate execution on evidence.
- **RED:** Table-test default-only, unselected, explicitly selected, ready/unready/failed, capability-specific routing, and unrelated-action non-interference.
- **GREEN:** Implement dual authorization and named-action behavior while preserving existing group/order semantics.
- **Verification:** Targeted future-only `bun test packages/adapter-pi/src/capability-plan.test.ts`.
- **Completion evidence:** exact action/group assertions and two-file scope audit.
- **Rollout:** R0; Pi remains disabled until T10–T12 and CLI parity checks pass.
- **Rollback boundary:** RB; never remove existing Pi MCP entries.
- **Task-specific excluded targets:** no all-capability standardization, unrelated writer rewrite, OpenCode, archive/trust work, or other file.

### T10 — Pi projection into Core controlled bootstrap

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** Yes — after T02/T08; may run alongside T09 and T12.
- **Depends on:** T01, T02, T08.
- **Files (exact allowlist):**
  - `packages/adapter-pi/src/install-tools.ts`
  - `packages/adapter-pi/src/install-tools.test.ts`
- **Requirements:** `REQ-SERENA-REUSE-001`, `REQ-SERENA-BOOTSTRAP-001`, `REQ-SERENA-BOUNDARY-001`, `REQ-SERENA-COMMAND-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-UX-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S03`, `S04`, `S05`, `S06`, `S07`, `S08`, `S09`, `S10`, `S12`, `S15`, `S17`.
- **Design constraints:** AD-1, AD-3, AD-4, AD-5, AD-7, AD-8. Replace Pi's obsolete installer loop with one authorized Core projection; preserve non-Serena installers and never return manual success for failed/unverified readiness. The official remote installer remains accepted residual risk, not independently verified content.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Map Core outcomes, stages, readiness evidence, cancellation, and safe diagnostics into Pi's install result family. The only Serena command is the exact resolved-`uv` argument array; no `pipx`, obsolete package, system Python, inherited environment, or fallback is allowed.
- **RED:** Mock reuse, fixed endpoint and process contract, exact command/environment, every boundary rejection, no fallback, cancellation/partial, unready, redaction, and no-effect cases.
- **GREEN:** Implement the thin projection with injected external boundaries and preserve unrelated shared-binary behavior.
- **Verification:** Targeted future-only `bun test packages/adapter-pi/src/install-tools.test.ts`; affected Pi checks are T19.
- **Completion evidence:** exact call/result trace, no fallback assertion, strict no-I/O proof, and two-file scope audit.
- **Rollout:** R0; no Pi action exposes this projection before T11/T14.
- **Rollback boundary:** RB; preserve partial tools and existing configuration.
- **Task-specific excluded targets:** no direct Pi MCP write, system-Python management, live command, archive/trust work, or other file.

### T11 — Pi evidence handoff and capability-specific dispatch

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — Pi integration join.
- **Depends on:** T02, T09, T10, T12.
- **Files (exact allowlist):**
  - `packages/adapter-pi/src/runner-adapter.ts`
  - `packages/adapter-pi/src/runner-adapter.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S01`, `S02`, `S05`, `S08`, `S09`, `S10`, `S11`, `S12`, `S13`, `S16`, `S17`.
- **Design constraints:** AD-1, AD-5, AD-6, AD-7. Narrow `write-pi-mcp-config` to its named Serena capability; unrelated actions and `write-deck-config` cannot create Serena. Require authorization, evidence, immediate matching revalidation, cancellation state, and exact native serialization before T12.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Replace only the allowed all-MCP dispatch boundary, carry T10 evidence, and fail closed for stale/handcrafted/direct paths while preserving unrelated Pi action semantics.
- **RED:** Test unrelated actions cannot write Serena, matching evidence/revalidation is required, all failure/cancel/partial/stale paths skip T12, known-good config is preserved, and unrelated capabilities continue.
- **GREEN:** Implement capability-specific evidence-gated dispatch without changing other Pi writers.
- **Verification:** Targeted future-only `bun test packages/adapter-pi/src/runner-adapter.test.ts`; affected adapter checks are T19.
- **Completion evidence:** writer-call matrix, no incidental Serena writes, path/fingerprint revalidation proof, and two-file scope audit.
- **Rollout:** R0; Pi cannot enable independently from OpenCode.
- **Rollback boundary:** RB; preserve existing Pi settings/configuration.
- **Task-specific excluded targets:** no CLI controller, generic runner framework, other MCP writers, archive/trust work, or other file.

### T12 — Pi absolute-path idempotent Serena MCP writer

- **Owner:** Backend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** Yes — independent writer boundary; T11 consumes it.
- **Depends on:** T01, T02, T08.
- **Files (exact allowlist):**
  - `packages/adapter-pi/src/pi-mcp-config.ts`
  - `packages/adapter-pi/src/pi-mcp-config.test.ts`
- **Requirements:** `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S11`, `S12`, `S13`, `S17`.
- **Design constraints:** AD-5 and AD-6. Serialize `mcpServers.serena.command` as the validated absolute executable and `args` as `['start-mcp-server','--context','ide','--project-from-cwd']`; validate exact values, preserve unrelated entries, reject malformed/unreadable config, atomically merge, and return `unchanged` without an equivalent write.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Add only Serena-specific Pi writer behavior. A legacy bare command is not known-good under this change and remains untouched on failure/cancellation.
- **RED:** Fixture-test unsafe/changed paths, wrong args, malformed config, unrelated entries, known-good no-write, create/update/unchanged results, and legacy preservation on failure.
- **GREEN:** Implement atomic idempotent writer behavior with fixture paths and injected/isolateable file operations; never write a real home.
- **Verification:** Targeted future-only `bun test packages/adapter-pi/src/pi-mcp-config.test.ts`.
- **Completion evidence:** exact command/args serialization, no-write/preservation assertions, and two-file scope audit.
- **Rollout:** R0; writer is reachable only after T11/T14 evidence gates.
- **Rollback boundary:** RB; no configuration deletion or cleanup.
- **Task-specific excluded targets:** no broad Pi MCP rewrite, Supermemory, user-home writes, archive/trust work, or other file.

### T13 — Ephemeral current-operation explicit-selection state

- **Owner:** Frontend Apply
- **Priority:** P0
- **Complexity:** Medium
- **Parallel:** No — follows both runner plan contracts and Core contract fields.
- **Depends on:** T02, T04, T09.
- **Files (exact allowlist):**
  - `apps/cli/src/tui/runner-dashboard/state.ts`
  - `apps/cli/src/tui/runner-dashboard/reducer.ts`
  - `apps/cli/src/tui/runner-dashboard/reducer.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S01`, `S02`, `S16`, `S17`.
- **Design constraints:** AD-2. Add in-memory `explicitlySelectedCapabilities`; Serena is not preselected; only a current-operation toggle-on records it, toggle-off removes it, and runner changes/new operations reset it. Config, preferences, inventory, and persistence never populate it.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Preserve ordinary selection separately from explicit authorization in all reducer/reset/plan-regeneration paths. Tests are pure reducer tests.
- **RED:** Test default/config-loaded state, toggle provenance, deselection, runner switch, new operation/reset, stale-plan invalidation, and unrelated capability continuation.
- **GREEN:** Implement ephemeral transitions and adapter-facing projection without persistent state or external effects.
- **Verification:** Targeted future-only `bun test apps/cli/src/tui/runner-dashboard/reducer.test.ts`.
- **Completion evidence:** reducer transition table, proof no persistence occurs, and three-file scope audit.
- **Rollout:** R0; state alone cannot authorize a flow without T14–T17 gates.
- **Rollback boundary:** RB; no persisted user state is migrated or deleted.
- **Task-specific excluded targets:** no catalog, prompt/skill, startup/deck-init, provider-filter, archive/trust work, or other file.

### T14 — CLI action-runner evidence gate, cancellation, and redacted orchestration

- **Owner:** Frontend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — central CLI join after both runner joins and T13.
- **Depends on:** T06, T07, T11, T12, T13.
- **Files (exact allowlist):**
  - `apps/cli/src/tui/runner-dashboard/action-runner.ts`
  - `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-REUSE-001`, `REQ-SERENA-BOOTSTRAP-001`, `REQ-SERENA-BOUNDARY-001`, `REQ-SERENA-COMMAND-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-UX-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S01`–`S17`.
- **Design constraints:** AD-1, AD-2, AD-5, AD-6, AD-7, AD-8. Enforce authorization before dispatch; pass one operation signal and stage callback through both adapters; retain evidence privately by capability; revalidate immediately before each writer; skip writes for every failed/cancelled/partial/unready/malformed/stale path; preserve known-good config; map known termination and `partial/termination-unknown`; never expose raw streams or private paths.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Make `runRunnerReviewPlan` enforce current-operation selection, operation identity, runner scope, install-before-config ordering, and typed evidence while keeping unrelated capabilities independent.
- **RED:** Add strict contract tests for default-only/stale plans, all failure/cancel/partial/unready/boundary paths, matching versus changed revalidation, known-good preservation, runner parity, cancellation wait semantics, bounded redaction, and zero raw/private data in callbacks/results. Inject every installer/writer/process seam.
- **GREEN:** Implement the smallest typed orchestration and signal/evidence projection; no real process, network, installer, filesystem, or home writer is reachable from tests.
- **Verification:** Targeted future-only `bun test apps/cli/src/tui/runner-dashboard/action-runner.test.ts`; the cross-runner contract test is T15.
- **Completion evidence:** ordered action trace, complete negative writer matrix, matching-revalidation positive case, cancellation/partial evidence, redaction bounds, and two-file scope audit.
- **Rollout:** R0; both runner semantics and T13 state must be present; no one-runner activation.
- **Rollback boundary:** RB; preserve tool/config state and do not clean partial external state.
- **Task-specific excluded targets:** no direct adapter implementation, UI rendering, generic non-Serena action-policy rewrite, archive/trust work, or other file.

### T15 — Cross-runner runner-install contract evidence

- **Owner:** Frontend Apply
- **Priority:** P0
- **Complexity:** Medium
- **Parallel:** No — depends on the action-runner implementation and is consumed by rendering and app composition.
- **Depends on:** T14.
- **Files (exact allowlist):**
  - `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-REUSE-001`, `REQ-SERENA-BOOTSTRAP-001`, `REQ-SERENA-BOUNDARY-001`, `REQ-SERENA-COMMAND-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-READY-001`, `REQ-SERENA-MCP-GATE-001`, `REQ-SERENA-UX-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S01`–`S17`.
- **Design constraints:** AD-1, AD-2, AD-5, AD-6, AD-7, AD-8. Exercise the shared action-runner contract for both OpenCode and Pi: current-operation authorization, fixed stages, signal propagation, typed readiness evidence, immediate revalidation, fail-closed writes, known cancellation outcomes, and bounded redaction must be semantically equivalent while native serialization remains runner-specific.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Add the strict cross-runner contract matrix that proves T14 does not allow one runner to bypass the shared gates. This is test-only evidence and does not standardize runner capabilities.
- **RED:** Add failing paired cases for unselected/default-only and runner-mismatched operations, ready reuse, controlled bootstrap, exact command/environment, every failure/cancel/partial/unready path, matching versus changed revalidation, known-good preservation, stage ordering, bounded redaction, and zero external I/O.
- **GREEN:** Implement only deterministic mocked contract fixtures and assertions; no production boundary, network, process, installer, filesystem, or home writer is invoked.
- **Verification:** Targeted future-only `bun test apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`.
- **Completion evidence:** paired runner outcome matrix, no-bypass/no-I/O proof, exact stage and revalidation assertions, and one-file scope audit.
- **Rollout:** R0; both runner paths must pass the same contract before T16/T17 integration.
- **Rollback boundary:** RB; remove only this test evidence and preserve all user state.
- **Task-specific excluded targets:** no source implementation outside the test, capability standardization, live I/O, archive/trust work, or other file.

### T16 — Serena stage and terminal-outcome rendering

- **Owner:** Frontend Apply
- **Priority:** P0
- **Complexity:** Medium
- **Parallel:** No — depends on T15's result/progress contract; T17 composes it.
- **Depends on:** T15.
- **Files (exact allowlist):**
  - `apps/cli/src/tui/screens/runner-dashboard-screens.tsx`
  - `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`
- **Requirements:** `REQ-SERENA-UX-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`.
- **Scenarios:** `S10`, `S14`, `S15`, `S16`, `S17`.
- **Design constraints:** AD-7 and AD-8. Render concise applicable labels **Preparing uv**, **Installing Serena**, **Validating Serena**, and **Configuring MCP** only after revalidation; suppress raw streams, private paths, control characters, and unbounded diagnostics; show bounded success/reuse/failure/cancel/partial outcomes.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Project typed stages/outcomes into both runner views. Reuse omits inapplicable stages; failed/cancelled/partial states remain actionable and do not imply MCP success.
- **RED:** Render adversarial tokens, paths, control sequences, and oversized diagnostics plus every terminal outcome; assert stage applicability/order and absence of raw/private data.
- **GREEN:** Render only sanitized typed result data; render tests use fixtures and no process/network/filesystem.
- **Verification:** Targeted future-only `bun test apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`.
- **Completion evidence:** both-runner render assertions for every outcome, stage order, redaction/bounds proof, and two-file scope audit.
- **Rollout:** R0; visible stages ship only with T14 and T17 cancellation composition.
- **Rollback boundary:** RB; revert rendering without altering tools/configuration.
- **Task-specific excluded targets:** no installer behavior, prompt/skill text, unrelated TUI screens, archive/trust work, or other file.

### T17 — TUI operation composition and `app.tsx` integration

- **Owner:** Frontend Apply
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — final CLI composition after T16. There is no external `app.tsx` collision dependency; T17 must perform its mandatory pre-edit fresh read and remain Serena-only.
- **Depends on:** T13, T15, T16.
- **Files (exact allowlist):**
  - `apps/cli/src/tui/app.tsx`
- **Requirements:** `REQ-SERENA-GATE-001`, `REQ-SERENA-CANCEL-001`, `REQ-SERENA-UX-001`, `REQ-SERENA-PARITY-001`, `REQ-SERENA-TEST-001`, `REQ-SERENA-MANUAL-001`.
- **Scenarios:** `S01`, `S02`, `S09`, `S10`, `S14`, `S15`, `S16`, `S17`, `S18`.
- **Design constraints:** AD-2, AD-7, AD-8 and Design coordination rules. Pass only current-operation explicit authorization, runner identity, operation ID, and one abort controller into plan/action execution. Escape/quit requests cancellation and holds progress until termination is known; unknown termination cannot claim success or navigate away. Do not modify provider-filter/menu-windowing behavior.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Compose T13 state, T14/T15 orchestration and contract evidence, and T16 stages for both OpenCode and Pi. A new operation clears prior explicit selection/evidence. The only live acceptance action remains the later user-run `bun run deck:run`; no agent starts it.
- **RED:** Use the existing T14–T16 contract/render seams to cover default-only, explicit selection, runner scoping, Escape/quit before/during command, known/unknown termination, progress hold, no later config, manual deferral, and provider-filter/menu non-regression. Do not add a test path or target outside the exact `app.tsx` scope.
- **GREEN:** Fresh-read `app.tsx`, then wire only operation controller, signal, authorization, and stage composition; do not start a live TUI or installer.
- **Verification:** Targeted future-only T14/T15/T16 contract/render checks plus relevant provider-filter/menu regression tests after the `app.tsx` change; no command runs now.
- **Completion evidence:** pre-edit fresh-read record, Serena-only scope audit, both-runner composition traces, cancellation/termination evidence, provider-filter/menu regression output, deferred manual-validation record, and one-file scope audit.
- **Rollout:** R0; joint OpenCode/Pi enablement waits for T18–T21. User-only `bun run deck:run` remains deferred.
- **Rollback boundary:** RB; normal source revert only, preserving tools/config and never using destructive Git operations.
- **Task-specific excluded targets:** no provider-filter/menu-windowing implementation, live manual command by an agent, archive/trust work, or other file.

## Independent targeted Verify

### T18 — Independent targeted checks and strict no-I/O evidence

- **Owner:** Independent Verify
- **Priority:** P0
- **Complexity:** Medium
- **Parallel:** No — after all Apply tasks; no Apply author may verify their own work.
- **Depends on:** T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17.
- **Files:** Read-only inspection and test execution against exactly the 38 allowlisted implementation/test paths, plus `proposal.md`, `spec.md`, `design.md`, `preconditions.md`, `openspec/config.yaml`, and `openspec/baseline-health.yaml`; no file modifications.
- **Requirements:** all 13 requirements.
- **Scenarios:** `S01`–`S18`.
- **Design constraints:** validate AD-1 through AD-8, R0, RB, exact fixed endpoint/process/environment contract, no independent-verification claim, exact command, fresh evidence/revalidation, and exact 38-path closure.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Run focused tests in the first independent gate. Confirm every install-facing boundary is mocked and that no test can reach network, `/bin/sh`, `uv`, Serena, a real process, or a user-home writer.
- **RED:** Block missing requirement/scenario coverage, implicit selection, inherited environment, wrong endpoint, fallback, bare command, stale evidence, writer-on-failure, raw/private diagnostic leak, parity drift, unauthorized path, or real-I/O seam.
- **GREEN:** Accept only exact focused results, strict mock/no-I/O evidence, both-runner parity, and a clean allowlist audit. Do not repair source.
- **Verification:** Future-only targeted commands: `bun test packages/core/src/serena-bootstrap.test.ts packages/core/src/runner-adapter.test.ts`; all six OpenCode test files; all six Pi test files; `bun test apps/cli/src/tui/runner-dashboard/reducer.test.ts apps/cli/src/tui/runner-dashboard/action-runner.test.ts apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`. No command runs in this coordinator environment.
- **Completion evidence:** independent focused command outputs, test-to-requirement/scenario matrix, mock/no-I/O proof, changed-path audit, and explicit `bun run deck:run` deferral.
- **Rollout:** R0; T19, T20, and T21 remain required before enablement.
- **Rollback boundary:** RB; read-only verification cannot repair or discard changes.
- **Task-specific excluded targets:** no source repair, registry/state/events write, generated regeneration, live installer/network/home effect, archive/trust evidence, or user-only command execution.

## Independent affected-area Verify

### T19 — Independent affected-area checks and type evidence

- **Owner:** Independent Verify
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — after T18; fresh evidence and no Apply-author substitution.
- **Depends on:** T18.
- **Files:** Read-only inspection/test execution of the exact 38 allowlisted paths and affected package/TUI test roots; no file modifications.
- **Requirements:** all 13 requirements.
- **Scenarios:** `S01`–`S18`.
- **Design constraints:** validate the same AD-1–AD-8, R0, RB, no-EII, fixed endpoint, controlled child, Deck-owned storage, exact command, evidence/revalidation, fail-closed, parity, and strict mock constraints without adding a target.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Run affected-area suites and typechecking after targeted evidence is green. Re-run the relevant provider-filter/menu tests after T17's `app.tsx` change and compare failures with the baseline only as evidence; do not repair source.
- **RED:** Any new focused/affected failure, type error, scope drift, weak mock, external effect, single-runner behavior, writer bypass, missing T17 fresh-read/scope/regression evidence, or provider-filter/menu regression blocks progression to Review.
- **GREEN:** Accept only passing affected suites/typecheck, T17 safety evidence, strict mocked-I/O proof, parity, and complete affected coverage.
- **Verification:** Future-only `bun test packages/core/src`; `bun test packages/adapter-opencode/src`; `bun test packages/adapter-pi/src`; `bun test apps/cli/src/tui`; `bunx tsc --noEmit`; then the relevant provider-filter/menu regression tests. No command runs here because Bun is absent.
- **Completion evidence:** independent affected command outputs, typecheck result, provider-filter/menu regression output, baseline comparison, 38-path audit, and manual-test deferral.
- **Rollout:** R0; T20 must independently review this evidence before broad QA.
- **Rollback boundary:** RB; Verify remains read-only.
- **Task-specific excluded targets:** no source repair, registry/config/generated/home writes, live installer, archive/trust evidence, or `bun run deck:run`.

## Independent post-Verify Review

### T20 — Independent Review of security, scope, parity, and readiness

- **Owner:** Independent Review
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — fresh reviewer after T19; no Apply author may substitute.
- **Depends on:** T19.
- **Files:** Read-only review of the exact 38 allowlisted paths, Proposal/Spec/Design digests above, `preconditions.md`, T18/T19 evidence, and T17's fresh-read/scope/regression evidence; no file modifications.
- **Requirements:** all 13 requirements.
- **Scenarios:** `S01`–`S18`.
- **Design constraints:** independently judge AD-1 through AD-8, exact `serena-agent` identity and command, fixed official endpoint, controlled child/no inherited environment, Deck-owned storage, readiness/revalidation, fail-closed writes, cancellation/partial semantics, redaction, OpenCode/Pi parity, R0, RB, exact 38-path allowlist, and no-EII/exclusion fidelity. Do not request or accept the superseded P-SEC-001 trust material.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** Perform a fresh read-only judgment against all approved artifacts and T18/T19 evidence. Confirm the user-accepted residual risk is accurately represented and that no artifact claims independent remote-installer verification.
- **RED:** Record a blocking finding for any requirement/scenario gap, custom trust/archive work, false verification claim, “latest”/alternate URL, fallback, real-I/O test, stale evidence acceptance, config write on failure, raw/private leak, parity drift, unauthorized file, weak cancellation, T17 scope violation or missing provider-filter/menu regression evidence, or rollback violation. Review does not imply repair.
- **GREEN:** Accept only complete independent evidence, exact scope, both-runner semantic parity, T17 fresh-read/scope/regression safety evidence, and an explicit recommendation for the final broad QA gate. Review cannot waive P-ENV-001 or the deferred manual action.
- **Verification:** Read-only comparison of implementation diff/evidence against every requirement, scenario, Design constraint, exclusion, the exact 38 paths, and both active/superseded precondition records. No installer, network, process, home write, or `bun run deck:run`.
- **Completion evidence:** signed Review judgment, requirement/scenario/design/exclusion matrix, residual-risk statement, P-CLI resolution record, broad-QA entry criteria, and explicit readiness disposition pending T21.
- **Rollout:** R0; Review acceptance is required before T21 and any joint enablement.
- **Rollback boundary:** RB; Review cannot discard, revert, repair, or rewrite history.
- **Task-specific excluded targets:** no code repair, registry YAML, source/test/config/generated/home writes, live installer, trust-manifest approval, or user-only command execution.

## Independent broad QA

### T21 — Independent broad QA, scope drift, and deferred manual record

- **Owner:** Independent Verify
- **Priority:** P0
- **Complexity:** High
- **Parallel:** No — final automated gate after independent Review.
- **Depends on:** T20 accepted evidence.
- **Files:** Read-only inspection of the exact 38 allowlisted paths, official OpenSpec artifacts, `openspec/baseline-health.yaml`, and test output; no file modifications.
- **Requirements:** all 13 requirements.
- **Scenarios:** `S01`–`S18`.
- **Design constraints:** validate AD-1 through AD-8, R0, RB, exact 38-path closure, no-EII instruction, approved digest basis, no independent-verification claim, and the separation of automated evidence from user-only live acceptance.
- **EII:** ID `none`; mode `none`; exact instruction: “No EII applies. The future implementation does not edit Deck-owned prompts, skills, or system instructions.”
- **Description:** After Review, run the broad repository checks and final scope/drift audit. Any new failure blocks closure; this task does not repair source or weaken Review findings.
- **RED:** Block any new broad failure/type error against the baseline, unauthorized path/generated/registry/prompt/skill/config/dependency/home change, missing mock/no-I/O proof, parity regression, unresolved Review blocker, or substitution of agent-run `bun run deck:run` for manual acceptance.
- **GREEN:** Accept only passing broad QA, baseline disposition, clean 38-path audit, preserved exclusions/rollback, and an explicit record that only the user may later run `bun run deck:run`.
- **Verification:** Future-only `bun test --timeout 30000`, compared with `openspec/baseline-health.yaml`, followed by read-only changed-path/generated-hash/scope audit. Never run `bun run deck:run`, the installer, network access, or user-home effects as an agent.
- **Completion evidence:** broad command output and baseline comparison, final scope/drift report, no-I/O evidence, T20 acceptance reference, and deferred manual-validation record.
- **Rollout:** R0; only after T21 green may the coordinator route joint OpenCode/Pi enablement, subject to user-only manual acceptance remaining deferred.
- **Rollback boundary:** RB; broad QA is read-only and cannot discard or alter work.
- **Task-specific excluded targets:** no source repair, registry/state/events write, generated regeneration, live installer/network/home effect, custom archive/trust evidence, or agent-run `bun run deck:run`.

## Exact 38-path Design allowlist coverage

The Design allowlist is preserved exactly: **38/38 paths**, each owned once by Apply. Verification tasks inspect these paths read-only and do not expand the future modification authority.

| Area | Apply task | Exact paths |
|---|---|---|
| Core (5) | T01–T02 | `packages/core/src/serena-bootstrap.ts`; `packages/core/src/serena-bootstrap.test.ts`; `packages/core/src/index.ts`; `packages/core/src/runner-adapter.ts`; `packages/core/src/runner-adapter.test.ts` |
| OpenCode (12) | T03–T07 | `packages/adapter-opencode/src/capability-catalog.ts`; `packages/adapter-opencode/src/capability-catalog.test.ts`; `packages/adapter-opencode/src/installation-plan.ts`; `packages/adapter-opencode/src/installation-plan.test.ts`; `packages/adapter-opencode/src/capability-plan.ts`; `packages/adapter-opencode/src/capability-plan.test.ts`; `packages/adapter-opencode/src/install-tools.ts`; `packages/adapter-opencode/src/install-tools.test.ts`; `packages/adapter-opencode/src/runner-adapter.ts`; `packages/adapter-opencode/src/runner-adapter.test.ts`; `packages/adapter-opencode/src/opencode-mcp-config.ts`; `packages/adapter-opencode/src/opencode-mcp-config.test.ts` |
| Pi (12) | T08–T12 | `packages/adapter-pi/src/capability-catalog.ts`; `packages/adapter-pi/src/capability-catalog.test.ts`; `packages/adapter-pi/src/installation-plan.ts`; `packages/adapter-pi/src/installation-plan.test.ts`; `packages/adapter-pi/src/capability-plan.ts`; `packages/adapter-pi/src/capability-plan.test.ts`; `packages/adapter-pi/src/install-tools.ts`; `packages/adapter-pi/src/install-tools.test.ts`; `packages/adapter-pi/src/pi-mcp-config.ts`; `packages/adapter-pi/src/pi-mcp-config.test.ts`; `packages/adapter-pi/src/runner-adapter.ts`; `packages/adapter-pi/src/runner-adapter.test.ts` |
| CLI TUI (9) | T13–T17 | `apps/cli/src/tui/runner-dashboard/state.ts`; `apps/cli/src/tui/runner-dashboard/reducer.ts`; `apps/cli/src/tui/runner-dashboard/reducer.test.ts`; `apps/cli/src/tui/runner-dashboard/action-runner.ts`; `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`; `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`; `apps/cli/src/tui/screens/runner-dashboard-screens.tsx`; `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`; `apps/cli/src/tui/app.tsx` |

No Apply task owns a path outside this table. The Design's 38 paths remain unchanged; no `runner-capability-parity` path is added.

## Dependency graph

```text
T01 → T02
T02 → T03 → T04
T01 + T02 + T03 → T05
T01 + T02 + T03 → T07
T04 + T05 + T07 → T06

T02 → T08 → T09
T01 + T02 + T08 → T10
T01 + T02 + T08 → T12
T09 + T10 + T12 → T11

T02 + T04 + T09 → T13
T06 + T07 + T11 + T12 + T13 → T14 → T15 → T16
T13 + T15 + T16 → T17

T01–T17 → T18 → T19 → T20 → T21
```

All task references above resolve to T01–T21. The former P-CLI-001 collision is resolved and is not a task dependency or Apply blocker.

## Verification command matrix

Commands are planning evidence only in the current absent-Bun environment.

| Stage | Future command/evidence | Required condition |
|---|---|---|
| Targeted | Focused Core, OpenCode, Pi, reducer, action-runner contract, and render commands in T18. | Independent runner; strict mocks; no network/process/installer/home writes. |
| Affected area | `bun test packages/core/src`; `bun test packages/adapter-opencode/src`; `bun test packages/adapter-pi/src`; `bun test apps/cli/src/tui`; `bunx tsc --noEmit`; relevant provider-filter/menu tests after T17. | T18 green; no new failures/type errors; T17 fresh-read, Serena-only scope, and regression evidence. |
| Review | Fresh read-only T20 comparison against approved digests, Spec/Design, requirements/scenarios, exclusions, evidence, and 38 paths. | T19 green; no Apply-author substitution; no superseded P-SEC evidence. |
| Broad QA | `bun test --timeout 30000` plus baseline and changed-path audit in T21. | T20 accepted; any new fingerprint blocks closure. |
| Manual, deferred | User-run `bun run deck:run`. | Never run by an agent; not an automated gate; not a replacement for mocks. |

## Complexity summary

| Complexity | Count | Task IDs |
|---|---:|---|
| Low | 2 | T03, T08 |
| Medium | 7 | T02, T04, T09, T13, T15, T16, T18 |
| High | 12 | T01, T05, T06, T07, T10, T11, T12, T14, T17, T19, T20, T21 |
| **Total** | **21** | **T01–T21** |

## Flagged for splitting

None. Apply tasks are split by Core, native runner boundary, CLI ownership, and evidence stage. T18/T19/T20/T21 are intentionally sequential independent gates and must not be merged, parallelized, or weakened.

## Review Workload Forecast

| Signal | Forecast |
|---|---|
| Estimated implementation footprint | Exactly 38 allowlisted paths: 20 production files and 18 test files, matching Design; no added dependency or lockfile. |
| Security/runtime-boundary risk | High — remote official installer residual risk, controlled child boundary, Deck-owned storage, cancellation, TOCTOU readiness, fail-closed writes, and redaction. No independent remote-content verification is claimed. |
| Cross-runner parity risk | High — OpenCode and Pi must ship together with equivalent gates and native serialization. |
| Active-file collision risk | Resolved/Low — `opencode-configured-providers-filter` is closed as abandoned with no source WIP or active ownership claim. T17 still requires a fresh `app.tsx` read, Serena-only scope, and relevant provider-filter/menu regression tests. |
| Verification risk | High — Bun is absent in the current coordinator; targeted and affected evidence must run on an independent Bun-capable runner, followed by Review and broad QA. |
| Scope risk | High — exact 38-path allowlist; no registry, generated, prompt/skill, dependency, config, historical, or unrelated capability changes. |
| Manual-validation risk | Explicitly deferred — only the user may later run `bun run deck:run`; no agent may substitute a live installer/network/home write. |
| Review recommendation | Fresh independent targeted, affected-area, Review, and broad-QA passes in that order, with security/scope/parity scrutiny and no waiver of fail-closed gates. |

## Open questions and blockers

- **P-SEC-001:** explicitly superseded by the approved revised scope; no trust manifest, archive, attestation, provenance, checksum, or tar-decoder evidence is required or permitted as an Apply blocker.
- **P-CLI-001:** resolved at `2026-08-03T22:27:19Z`; the closed abandoned change has no source WIP or active ownership claim. It is not an Apply blocker. T17 retains the fresh pre-edit `app.tsx` read, Serena-only scope restriction, and relevant provider-filter/menu regression tests as implementation safety checks.
- **Verification-stage mapping:** for this reconciled task set, the Bun-capable runner supplies T18 targeted, T19 affected-area, and T21 broad-QA evidence; no agent runs those commands here.
- **P-ENV-001:** current coordinator lacks Bun. No automated checks run here; a Bun-capable runner is required for independent T18/T19/T21 QA evidence. T20 is a read-only Review after T19. This is an execution/verification constraint, not permission to run a live installer or to reduce scope.
- **Manual acceptance:** `bun run deck:run` is user-only and deferred; it is never an agent command or automated gate.
- **Design ambiguity:** none. If implementation needs an unallowlisted path, dependency, alternate endpoint, fallback, changed EII, or independent-verification claim, stop with `design-instruction-ambiguous` and return to Design/Task reconciliation.
- **Apply readiness:** source Apply is ready for T01–T17 after normal task dependencies; no P-CLI-001 handoff blocks T17. Full automated closure is not ready in this environment until independent Bun-capable evidence completes T18–T21.
