# Tasks — OpenCode Package Install Running Binary Regression

## Authority and Execution Contract

- **Mode:** Automatic SDD.
- **Approved behavior:** `proposal.md`.
- **Normative behavior:** `spec.md` — 34 requirements, 51 scenarios.
- **Technical authority:** reconciled `design.md`.
- **Apply authorization:** pending explicit user authorization after this Tasks phase.
- **Apply evidence target:** `apply-progress.md` may be created/updated by the assigned Apply owner for RED/GREEN evidence only.
- **Permanent exclusions:** no generated files, dependencies/lockfiles, live user configuration, live process discovery/signaling, upstream mutation, binary replacement/staging, implicit upgrade, retry loop, archived-history rewrite, Git state/history mutation, or path under `runner-capability-standardization`.
- **Ambiguity stop:** any required edit outside the exact allowlist, public Core status expansion, process ownership logic, active-upgrade behavior, or weakened diagnostic boundary stops Apply for Spec/Design reconciliation.

## Exact Maximum Implementation Allowlist

1. `packages/adapter-opencode/src/model-discovery-context.ts`
2. `packages/adapter-opencode/src/model-discovery-context.test.ts`
3. `packages/adapter-opencode/src/required-tools.ts`
4. `packages/adapter-opencode/src/required-tools.test.ts`
5. `packages/adapter-opencode/src/capability-inventory.ts`
6. `packages/adapter-opencode/src/capability-inventory.test.ts`
7. `packages/adapter-opencode/src/install-tools.ts`
8. `packages/adapter-opencode/src/install-tools.test.ts`
9. `packages/adapter-opencode/src/runner-adapter.ts`
10. `packages/adapter-opencode/src/runner-adapter.test.ts`
11. `apps/cli/src/tui/app.tsx`
12. `apps/cli/src/tui/runner-dashboard/action-runner.ts`
13. `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`
14. `apps/cli/src/tui/screens/runner-dashboard-screens.tsx`
15. `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`

## Deterministic Order

`T1 → T2 → T3 → T4 → T5 → T6 → V1 → R1 → B1 → Archive`

Tasks are serialized. T2 and T3 have partially disjoint production files, but both establish the same evidence/result contract and append to one Apply evidence artifact; parallel editing would create avoidable contract and evidence races.

## T1 — Reuse the authoritative OpenCode local-config source and JSONC parser

- **Owner:** `deck-developer-apply-backend`
- **Priority:** P0
- **Complexity:** M
- **Parallel:** No
- **Depends on:** None
- **Files:** `packages/adapter-opencode/src/model-discovery-context.ts`; `packages/adapter-opencode/src/model-discovery-context.test.ts`; evidence-only `openspec/changes/opencode-package-install-running-binary-regression/apply-progress.md`.
- **Requirements / scenarios:** `REQ-EVD-04` (`EVD-04-S1`, `EVD-04-S2`); `REQ-TST-01` (`TST-01-S1`, `TST-01-S2`); `REQ-TST-02` (`TST-02-S1`).
- **Design constraints:** export/reuse one pure local config-source enumerator and JSONC parser; preserve exact layer order, `.jsonc` precedence, disable/pure behavior, relative bases, safe DTO/fingerprint behavior, no interpolation/network/shell evaluation.
- **Blocked targets:** no second config scanner/parser; no model-discovery behavior broadening; no user-home fixture.
- **RED:** add deterministic source-order/parser/reuse assertions, then run `bun test packages/adapter-opencode/src/model-discovery-context.test.ts`; record exact failing tests/count/output before production edit.
- **Verification:** GREEN the same command; `git diff --check`; no unrelated test changes.
- **Completion evidence:** exported helper is consumed without duplicating source enumeration; legacy model-discovery assertions remain green.
- **Rollback:** revert both T1 files together.
- **Ambiguity stop:** stop if reuse requires changing the public adapter contract or supporting remote/managed configuration.

## T2 — Implement strict installed evidence and inventory consumption

- **Owner:** `deck-developer-apply-backend`
- **Priority:** P0
- **Complexity:** L
- **Parallel:** No
- **Depends on:** T1
- **Files:** `packages/adapter-opencode/src/required-tools.ts`; `packages/adapter-opencode/src/required-tools.test.ts`; `packages/adapter-opencode/src/capability-inventory.ts`; create `packages/adapter-opencode/src/capability-inventory.test.ts`; evidence-only `apply-progress.md`.
- **Requirements / scenarios:** all scenarios under `REQ-EVD-01`–`REQ-EVD-04`, `REQ-MIS-01`–`REQ-MIS-02`, `REQ-PCV-01`–`REQ-PCV-02`, `REQ-PAG-01`, and `REQ-TST-01`–`REQ-TST-03`.
- **Design constraints:** exact `usable | declared | broken | absent | indeterminate` evidence; exact package command/canonical mapping; adapter-authoritative config precedence; declaration-only never ready; independent valid PATH/canonical proof may prevent reinstall while retaining broken-config reasons; POSIX `X_OK`, Windows `PATHEXT`, `node:path.delimiter`, realpath/non-empty regular-file checks; no public resolved path.
- **Blocked targets:** no health/version execution; no substring package matching; no declaration re-promotion; no live PATH/HOME dependency in tests.
- **RED:** add full injected config/PATH/canonical/invalid matrix and inventory negative cases; run `bun test packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts`; preserve exact failing tests/count/output.
- **Verification:** GREEN the RED command; affected `bun test packages/adapter-opencode/src/model-discovery-context.test.ts packages/adapter-opencode/src/runner-capabilities.test.ts`; `git diff --check`.
- **Completion evidence:** only usable evidence sets command-backed capability installed; config-only/plugin compatibility is preserved.
- **Rollback:** revert all four T2 files atomically, deleting only the newly created test file.
- **Ambiguity stop:** stop if any supported config surface cannot reuse T1 authority or if a package lacks an approved executable-evidence contract.

## T3 — Make package installation idempotent, truthful, isolated, and diagnostically safe

- **Owner:** `deck-developer-apply-backend`
- **Priority:** P0
- **Complexity:** L
- **Parallel:** No
- **Depends on:** T2
- **Files:** `packages/adapter-opencode/src/install-tools.ts`; `packages/adapter-opencode/src/install-tools.test.ts`; evidence-only `apply-progress.md`.
- **Requirements / scenarios:** all scenarios under `REQ-RCK-01`–`REQ-RCK-02`, `REQ-APO-01`, `REQ-FAL-01`–`REQ-FAL-02`, `REQ-PAG-01`–`REQ-PAG-02`, `REQ-SAF-01`–`REQ-SAF-05`, `REQ-CTO-01`–`REQ-CTO-02`, `REQ-CAN-01`, `REQ-MPI-01`, and `REQ-TST-01`–`REQ-TST-03`.
- **Design constraints:** discriminated `already-present | executed | failed | skipped`; one result factory; immediate in-gate recheck and shell second recheck; same-scope per-tool single-flight; one result per exact tool ID; no duplicate effects; cooperative cancellation only; genuine nonzero/post-evidence failure never redeemed; no retries or process operations.
- **Diagnostic constraints:** raw streams only in non-enumerable immediate adapter fields; downloaded script hard limit 1 MiB; stdout/stderr tail capture 65,536 bytes each; deterministic sanitation order; enumerable lines ≤6, ≤240 scalars each, ≤1,024 bytes; cause ≤2 lines/320 bytes; exact fallback; no raw logging or serialization.
- **Blocked targets:** no `pgrep`, `pkill`, `kill`, process enumeration, staging/rename activation, binary overwrite, error-string special case, network in automated tests, or mid-process termination.
- **RED:** add outcome/call-count, stale-plan, second-recheck, concurrency, cancellation, duplicate-ID, per-package isolation, raw-boundary, adversarial sanitizer, and inert v0.9.0 text fixtures; run `bun test packages/adapter-opencode/src/install-tools.test.ts`; record exact failing tests/count/output before source edit.
- **Verification:** GREEN the RED command; affected `bun test packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts`; `git diff --check`.
- **Completion evidence:** an already-present codebase-memory executable causes zero downloader/installer/post-install calls; a genuine copy failure remains failed with a bounded safe cause.
- **Rollback:** revert source and tests together; no external cleanup.
- **Ambiguity stop:** stop if existing process execution seams cannot preserve full completion without process signaling, or if raw data must cross into TUI state.

## T4 — Preserve compatible direct adapter outcomes and project scope

- **Owner:** `deck-developer-apply-backend`
- **Priority:** P1
- **Complexity:** M
- **Parallel:** No
- **Depends on:** T2, T3
- **Files:** `packages/adapter-opencode/src/runner-adapter.ts`; `packages/adapter-opencode/src/runner-adapter.test.ts`; evidence-only `apply-progress.md`.
- **Requirements / scenarios:** `REQ-APO-02` (`APO-02-S1`); `REQ-FAL-01` scenarios; `REQ-FAL-03` (`FAL-03-S1`); `REQ-SAF-04` (`SAF-04-S1`); `REQ-SAF-05` (`SAF-05-S1`); `REQ-TST-01` scenarios.
- **Design constraints:** Core status union unchanged; already-present maps to existing satisfied skipped semantics with safe structured outcome; failed remains failed; project scope/evidence context propagated; unsafe adapter raw streams dropped.
- **Blocked targets:** no Core edits/status member; no fresh-install claim for already-present; no raw stdout/stderr in action results.
- **RED:** add direct `runAction`/inventory scope, mapping, serialization, and no-fresh-install assertions; run `bun test packages/adapter-opencode/src/runner-adapter.test.ts`; record exact RED.
- **Verification:** GREEN the RED command; affected adapter tests from T1–T3; `git diff --check`.
- **Completion evidence:** direct adapter path is source-compatible and truthful for every package outcome.
- **Rollback:** revert both T4 files together.
- **Ambiguity stop:** stop if compatibility requires a Core contract edit.

## T5 — Project safe package outcomes through the TUI and gate only matching dependents

- **Owner:** `deck-developer-apply-frontend`
- **Priority:** P0
- **Complexity:** L
- **Parallel:** No
- **Depends on:** T4
- **Files:** `apps/cli/src/tui/app.tsx`; `apps/cli/src/tui/runner-dashboard/action-runner.ts`; `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`; evidence-only `apply-progress.md`.
- **Requirements / scenarios:** all scenarios under `REQ-APO-02`, `REQ-FAL-01`, `REQ-FAL-03`, `REQ-DIA-01`, `REQ-DIA-03`, `REQ-MPI-01`, `REQ-SAF-04`, `REQ-SAF-05`, and `REQ-TST-01`–`REQ-TST-03`.
- **Design constraints:** map by exact tool ID; missing/duplicate/unknown/mismatched IDs are integrity failures; local public status unchanged; `already-present` = satisfied skipped, ordinary skipped = unsatisfied; failed/ordinary skipped gate only matching capability config; unrelated work continues; aggregate rules exact; raw captures dropped before state/callbacks; defense-in-depth TUI bounds ≤8 strings, ≤240 scalars each, ≤1,280 bytes.
- **Blocked targets:** no Pi behavior change; no hidden success; no display-text identity matching; no diagnostic dump; no Core status edit.
- **RED:** add all outcome/integrity/aggregate/gating/sanitization cases; run `bun test apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`; record exact RED.
- **Verification:** GREEN the RED command; affected `bun test apps/cli/src/tui/runner-dashboard/action-runner.test.ts`; `bunx tsc --noEmit`; `git diff --check`.
- **Completion evidence:** already-present permits matching config; failure blocks only its own dependent action and exposes only bounded safe diagnostics.
- **Rollback:** revert all three T5 files together.
- **Ambiguity stop:** stop if exact tool ID cannot be preserved without changing an excluded plan/Core contract.

## T6 — Render identified inline package causes without new screen state

- **Owner:** `deck-developer-apply-frontend`
- **Priority:** P1
- **Complexity:** M
- **Parallel:** No
- **Depends on:** T5
- **Files:** `apps/cli/src/tui/screens/runner-dashboard-screens.tsx`; `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`; evidence-only `apply-progress.md`.
- **Requirements / scenarios:** all scenarios under `REQ-DIA-01`–`REQ-DIA-03`, `REQ-PAG-02`, `REQ-SAF-05`, and `REQ-TST-01`–`REQ-TST-03`.
- **Design constraints:** existing progress/completion views only; identified action/package plus stable message and one indented bounded cause; progress keeps final-five behavior; symbol/ID/text convey meaning without color; already-present says installer not run; no details panel or safe-lines dump.
- **Blocked targets:** no new key binding/modal/panel; no raw output; no unbounded wrapping; no accessibility regression.
- **RED:** add render fixtures for already-present, codebase-memory failure, secret/path/control stripping, final-five behavior, and text-only meaning; run `bun test apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`; record exact RED.
- **Verification:** GREEN the RED command; affected `bun test apps/cli/src/tui/runner-dashboard/render.test.tsx`; `bunx tsc --noEmit`; `git diff --check`.
- **Completion evidence:** the real incident is actionable in the dashboard without exposing the home path or progress/control noise.
- **Rollback:** revert both T6 files together.
- **Ambiguity stop:** stop if rendering requires new interaction state or diagnostic retention beyond Design bounds.

## V1 — Independent targeted and affected-area Verify

- **Owner:** `deck-developer-verify`
- **Priority:** P0
- **Complexity:** M
- **Parallel:** No
- **Depends on:** T1, T2, T3, T4, T5, T6
- **Files:** evidence-only `verify-report.md`.
- **Verification:** independently run the seven-file focused command from Design, affected adapter/TUI suites, `bunx tsc --noEmit`, `bun run build:dry-run`, `git diff --check`, rooted OpenSpec validation, source/test freshness digest, changed-path prohibition audit, and the disposable Linux sandbox protocol using only `/tmp` or a container. The sandbox must prove an already-running harness-owned v0.9.0 binary is recognized as already present, no installer sentinel runs, checksum is unchanged, and real user roots are untouched. If a safe disposable sandbox cannot be established, return a blocker; never substitute the live user installation.
- **Completion evidence:** all 34 requirements/51 scenarios mapped; RED evidence present for each behavior task; no stale evidence.
- **Rollback:** none; Verify is read-only except its report.

## R1 — Independent engineering Review

- **Owner:** `deck-developer-review`
- **Priority:** P0
- **Complexity:** M
- **Parallel:** No
- **Depends on:** V1 PASS
- **Files:** evidence-only `review-report.md`.
- **Verification:** review correctness, evidence precedence, TOCTOU/concurrency, cancellation, package isolation, diagnostic secrecy/bounds, status compatibility, accessibility, maintainability, exact scope, TDD evidence, and all prohibited behaviors. A blocking finding stops before broad; no automatic repair.
- **Completion evidence:** explicit APPROVE or anchored REQUEST_CHANGES.
- **Rollback:** none; Review is read-only except its report.

## B1 — Mandatory broad gate

- **Owner:** `deck-developer-verify`
- **Priority:** P0
- **Complexity:** S
- **Parallel:** No
- **Depends on:** R1 non-blocking
- **Files:** evidence-only `verify-report.md`.
- **Verification:** exact `bun test`, then `git diff --check` and rooted OpenSpec validation. Any failure blocks Archive and requires user decision before repair.
- **Completion evidence:** exact pass/fail/skip counts and stable source/test digest.
- **Rollback:** none.

## Archive

- **Owner:** `deck-developer-archive`
- **Priority:** P1
- **Complexity:** S
- **Parallel:** No
- **Depends on:** B1 PASS
- **Files:** `archive-report.md` and canonical move of this OpenSpec change; centralized coordinator owns registry YAML.
- **Verification:** all gates fresh/non-contradictory; source change directory absent after move; one archive destination; archived OpenSpec validation and `git diff --check` pass.
- **Completion evidence:** final archive path, registry intent, residual warnings, and no commit/push claim.
- **Rollback:** canonical lifecycle recovery only; no Git discard.

## Shared-File Coordination

- Apply tasks execute in dependency order and append evidence serially to `apply-progress.md`.
- T1–T4 own adapter files; T5–T6 own TUI files. No Apply specialist may edit another task's files.
- Verify, Review, and Archive are independent and may modify only their evidence artifact/lifecycle destination.

## Complexity Summary

| Complexity | Task IDs | Count |
|---|---|---:|
| L | T2, T3, T5 | 3 |
| M | T1, T4, T6, V1, R1 | 5 |
| S | B1, Archive | 2 |
| **Total** | T1–T6, V1, R1, B1, Archive | **10** |

## Routing and Batches

1. **Backend batch:** T1 → T2 → T3 → T4.
2. **Frontend batch:** T5 → T6.
3. **Independent quality:** V1 → R1 → B1.
4. **Closure:** Archive.

## Review Workload Forecast

- **Risk:** Medium with security-sensitive diagnostic handling and concurrency semantics.
- **Review focus:** 15-file maximum diff; shared config authority; no false readiness; no public status break; no raw-data escape; exact sanitizer bounds; package-local dependency gates; prohibited process/binary behavior; disposable sandbox evidence.
- **Expected review effort:** Medium–High because result contracts cross adapter and TUI boundaries despite no public API expansion.

## Coverage and Blockers

- **Requirement coverage:** 34/34 requirements and 51/51 scenarios are assigned through T1–T6 and V1.
- **Open design questions:** None.
- **External preconditions:** None.
- **Apply blocker:** explicit user modification authorization for the 15-file maximum allowlist plus `apply-progress.md` evidence target.
- **Excluded dependency:** forced active-session upgrade remains upstream/separate and does not block this repair.
