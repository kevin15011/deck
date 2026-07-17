# Verify Report: Batch C EG3-R1 Host-Facing Boundary Repair

## Verdict

**FAIL**

Fresh independent registry-deferred verification found remaining Batch C blockers. The current source now satisfies the main fail-closed authority, Git, protected-risk, and invalid-input safety behaviors in independent reproducers, and all focused/affected/typecheck/broad commands executed in this Verify pass. However, Batch C still does **not** satisfy the repaired acceptance contract because the explicit legacy/shadow/terminal composition remains incomplete at the public host-facing boundary and the required 68-row matrix is name-complete but semantically non-compliant. Several rows are filler/substitute assertions rather than exact public-boundary contract tests.

Actual runner-host reachability remains correctly deferred to Batch D under `HO-BC-TO-BD-HOST-REACHABILITY-v1`; this report does **not** fail Batch C for lacking a runner-native host caller. No Batch D bridge implementation was found or credited.

## Finding Disposition C-R2-C-R6

| Finding | Disposition | Result | Evidence |
|---|---|---:|---|
| `C-R2` / `C-B2` authority and Git fail-open | Behavior closed | PASS | Independent reproducer: missing authority returns `stop` with `AUTHZ_MISSING`; source uses mandatory `authority` / `gitSafety` states in `decision-kernel.ts` and effect denial in `execution-adapter-port.ts`. |
| `C-R3` / `C-B3` data-loss protected risk | Behavior closed | PASS | Independent data-loss positive-shrink reproducer returns `escalate` with `PROTECTED_RISK_DATA_LOSS`; `classifyProtectedRiskV1()` is consumed by both `failure-delta.ts` and `decision-kernel.ts`. |
| `C-R4` / `C-B4` invalid-input safe identity/replay | Behavior closed | PASS | Independent cyclic/secret invalid input did not throw, returned `invalid-evidence`, produced a safe digest, and did not serialize `SECRET_SENTINEL`. |
| `C-R5` / `C-B5` legacy/shadow/terminal composition | Still open | FAIL | `composeDeveloperTeamExecutionV1()` calls `runOrchestratorPipeline(input.legacyInput)` before runtime admission validation; a shadow call without `legacyInput` throws `TypeError: undefined is not an object (evaluating 'input.auditType')` instead of the stable `SHADOW_NO_LEGACY_COMPARISON`/`invalid-evidence` rejection. No `resolveTerminalGovernanceGuardV1` implementation exists, and terminal rows in tests do not exercise real repair-incident budget/fingerprint composition. |
| `C-R6` / `C-B6` exact 68-row matrix | Still open | FAIL | `batch-c-authoritative-matrix.test.ts` has exactly 68 named tests and passes, but many rows are substitute/filler cases that do not exercise the claimed scenario; the catalog audit checks only names/field labels. |

## Batch D Handoff Status

**PASS / correctly deferred.**

- `spec-repair-batch-c.md` defines `HO-BC-TO-BD-HOST-REACHABILITY-v1` and transfers actual non-test runner-host reachability (`C-R1`/`C-B1`/`C-C2`) to Batch D `RQH-BC-001`-`003`.
- `design-repair-batch-c.md` states Batch C is host-facing and production-ready but not production-reachable, and Batch D owns OpenCode/Pi bridge callers, invocation authorization, and real reachability proof.
- Static audit found no Batch D bridge implementation or invocation-authorization service in this Batch C scope.
- The current Batch C source exports `runProductionExecutionDecisionPipelineV1` only as a deprecated compatibility facade from `execution-composition.ts`; this name is not credited as production reachability.

## Exact Blocking Set

1. **`C-R5` / `C-B5` / `REQ-CBC-006`** — explicit legacy/shadow/active composition is incomplete at the runtime boundary. Missing shadow `legacyInput` throws an uncontrolled legacy-pipeline `TypeError`; the required stable rejection/comparison contract is absent, and restrictive terminal-governance composition is not implemented through the named `resolveTerminalGovernanceGuardV1` contract.
2. **`C-R6` / `C-B6` / `REQ-CBC-007`** — the 68-row matrix is name-complete but not exact. Multiple rows assert unrelated generic decisions, invalid placeholders, or catalog presence rather than the required action/rationale/digest/terminal/effect/legacy contract for the named scenario.

## Independent Reproducers

| Reproducer | Result | Evidence |
|---|---:|---|
| Missing authority fails closed | PASS | Inline independent script: `{ action: "stop", rationale: ["AUTHZ_MISSING"] }`. |
| Data-loss positive shrink blocks targeted repair | PASS | Inline independent script: `{ action: "escalate", rationale: ["PROTECTED_RISK_DATA_LOSS"] }`. |
| Invalid cyclic/secret input is safe | PASS | Inline independent script: `threw: false`, `reason: "invalid-evidence"`, `serializedLeaksSecret: false`. |
| Shadow with valid legacy input remains legacy-authoritative | PASS | Inline independent script: `{ authoritative: "legacy", hasLegacy: true, mode: "shadow", v1Action: "targeted_repair" }`. |
| Shadow without legacy input rejects through stable contract | FAIL | Inline independent script: `threw:TypeError: undefined is not an object (evaluating 'input.auditType')`; expected stable admission rejection / `SHADOW_NO_LEGACY_COMPARISON` or equivalent fail-closed error. |
| Matrix semantic exactness audit | FAIL | Static audit: `matrix_tests=68`, `unique_ids=68`, but at least 10 rows are weak/filler (`C-RISK-04`, `C-ROUTE-01`, `C-ROUTE-08`, `C-ROUTE-09`, `C-TERM-03`, `C-TERM-04`, `C-LEGACY-01`, `C-SHADOW-02`, `C-SHADOW-03`, `C-EFFECT-11`). |
| Batch D bridge absence / no false implementation | PASS | Static audit found `batchD_bridge_diff=none`; grep found no `createOpenCodeDeveloperTeamExecutionBridgeV1`, `createPiDeveloperTeamExecutionBridgeV1`, `invocation-authorization-service`, or packaged `developer-team-execution` plugin/extension. |

## Host Boundary / Safety / Replay / Legacy Evidence

- **One-way host boundary:** `orchestrator-pipeline.ts` no longer imports `../execution/`; `execution-composition.ts` imports the legacy orchestrator one-way. This satisfies the no-cycle side of `REQ-CBC-001`.
- **No Batch D bridge credited:** Package exports and the deprecated production-named facade are compatibility surface only; real runner-host reachability remains open for Batch D.
- **Fail-closed authority/Git:** `decision-kernel.ts` stops explicit `missing`/`invalid` authority and `confirmation-required`/`invalid` Git states; `executeTargetedRepairV1()` denies missing/mismatched authority, Git, target, decision, and descriptor conditions.
- **Shared protected risk:** `classifyProtectedRiskV1()` includes security/data-loss, high/critical, authorization/Git-safety, and uncovered-requirement dimensions; both delta/kernel paths consume it.
- **Invalid input / replay:** `planExecutionDecisionV1()` builds frozen invalid replay records from safe classification; independent cyclic/secret input did not throw or leak the sentinel.
- **Legacy/shadow:** Valid shadow with a provided legacy input is legacy-authoritative, but missing legacy input is not safely/stably rejected and the required shadow comparison error code is absent.
- **Terminal governance:** `decision-kernel.ts` still calls `evaluateRepairIncident()` through a local `terminalGuard()` helper; `resolveTerminalGovernanceGuardV1` is absent, and tests do not prove all terminal outcomes through real incidents.

## Matrix Audit

**FAIL.** `batch-c-authoritative-matrix.test.ts` contains 68 individually named tests and they all pass, but this is not compliant with `REQ-CBC-007` because rows are not exact public-boundary scenario tests.

Examples:

- `C-RISK-04 data-loss safe class is non-modifying` calls `invalid("data-loss")`; it does not construct a data-loss finding and assert protected-risk routing.
- `C-ROUTE-01 unrelated baseline is quarantined`, `C-ROUTE-08 pending verification advances`, and `C-ROUTE-09 completed verification completes` all reuse a default low-risk positive-shrink decision and expect `targeted_repair`.
- `C-TERM-03` and `C-TERM-04` do not construct real soft-budget or repeated-fingerprint incidents.
- `C-LEGACY-01` is an `invalid("legacy no dossier")` placeholder rather than an exact legacy/no-dossier behavior-compatible path.
- `C-SHADOW-02` and `C-SHADOW-03` use default non-shadow decisions and expect `legacy: "not-applicable"`.
- `C-EFFECT-11 completion has no effect` expects `targeted_repair`, not `complete`.
- `batch-c-matrix-audit.test.ts` verifies only catalog size and field labels through an aggregate `for (const [id, fields] of Object.entries(...))`; it cannot prove semantic exactness.

## Focused / Affected Evidence

| Check | Command | Result |
|---|---|---:|
| Authoritative 68 matrix | `bun test packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts --timeout 30000` | PASS: 68 pass / 0 fail / 204 expects. Semantic audit still FAIL. |
| Matrix catalog audit | `bun test packages/sdd-runtime/src/execution/batch-c-matrix-audit.test.ts --timeout 30000` | PASS: 1 pass / 0 fail / 207 expects. Catalog-only evidence. |
| Batch C focused | `bun test ...batch-c-authoritative-matrix.test.ts ...batch-c-matrix-audit.test.ts ...execution-composition.test.ts ...execution-control-plane.test.ts ...decision-kernel.test.ts ...repair-loop-governance.test.ts ...orchestrator-pipeline.test.ts --timeout 30000` | PASS: 200 pass / 0 fail / 716 expects across 7 files. |
| Legacy/export/registry | `bun test packages/sdd-runtime/src/index.test.ts packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts packages/core/src/spec-registry/{types,validator,schema,execution-v1-baseline,paths,events}.test.ts --timeout 30000` | PASS: 92 pass / 0 fail / 257 expects across 8 files. |
| Affected sdd-runtime | `bun test packages/sdd-runtime --timeout 30000` | PASS: 510 pass / 0 fail / 1381 expects across 35 files. |
| Affected core | `bun test packages/core --timeout 30000` | PASS: 1474 pass / 0 fail / 5228 expects across 55 files. |

## Typecheck

**PASS**

Command: `bunx tsc --noEmit`  
Exit: `0`  
Output: none.

## Broad Evidence

**PASS**

Command: `bun test --timeout 30000`  
Wall allowance: `900000 ms`  
Result: `3549 pass / 0 fail`, `12425` expectations, `195` files, observed duration `75.77s`.

## Generated / Scope Audit

| Audit | Result |
|---|---|
| Canonical generated skill hash | `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` |
| Build-info generated hash | `75624e5005c4d82a223e1948345c76cee66c79794e846054aa79801694edbed7` |
| Batch D bridge implementation | None found in current diff/source for `developer-team-execution-bridge`, `invocation-authorization-service`, or packaged OpenCode/Pi `developer-team-execution` plugin/extension. |
| Excluded WIP/archive | No Batch C evidence credits `runner-capability-standardization` or `openspec/archive`. |
| Worktree context | Repository contains broad pre-existing dirty/untracked OpenSpec and Batch A/B/C files. This Verify writes only `verify-batch-c-host-boundary-repair.md` and does not modify registry/source/generated files. |

## Compliance Matrix

| Requirement / Scenario | Method | Result | Notes |
|---|---|---:|---|
| `REQ-CBC-001` one-way host-facing boundary / no cycle | Source import audit + focused tests | PASS | One-way source direction holds. Runner-host caller remains deferred to Batch D and is not required for Batch C. |
| `REQ-CBC-002` canonical all-input freeze/replay | Source + focused/reproducer evidence | PASS WITH WARNING | Valid/invalid replay behavior is substantially closed; exact matrix rows for replay immutability are weak. |
| `REQ-CBC-003` fail-closed authority/Git/effect | Independent reproducers + focused tests | PASS | Missing/invalid authority and Git states deny modification. |
| `REQ-CBC-004` shared protected risk including data loss | Independent reproducer + source audit | PASS | True data-loss positive shrink escalates with `PROTECTED_RISK_DATA_LOSS`. |
| `REQ-CBC-005` total invalid-input safe identity | Independent reproducer + focused tests | PASS | Cyclic/secret invalid input is safe and non-throwing at `planExecutionDecisionV1()`. |
| `REQ-CBC-006` explicit legacy/shadow/active restrictive terminal composition | Independent reproducer + source/test audit | FAIL | Missing shadow `legacyInput` throws uncontrolled TypeError; terminal mapping function required by repair design is absent; tests substitute legacy mode for shadow rows. |
| `REQ-CBC-007` exhaustive exact 68-row matrix | Static matrix audit + test execution | FAIL | 68 tests pass but multiple rows are filler/substitute assertions, not exact scenario contracts. |
| `REQ-CBC-008` Batch C completion gate / no false host reachability | Artifact/source/scope audit | FAIL | Handoff is correct, but Batch C cannot complete while `REQ-CBC-006` and `REQ-CBC-007` are failing. |
| `RQH-BC-001`-`003` Batch D handoff | Spec/design/source audit | PASS / OPEN FOR BATCH D | Explicitly documented and no Batch D bridge was implemented or falsely credited. |

## Findings

### CRITICAL

- `C-R5` / `REQ-CBC-006`: The public composition boundary does not fail closed with a stable contract when shadow legacy input is absent and does not expose the exact restrictive terminal-governance adapter required by the repair design.
- `C-R6` / `REQ-CBC-007`: The mandatory 68-row matrix is semantically incomplete. The green test count is a false closure because rows do not exercise their named contract.

### WARNING

- `REQ-CBC-002` replay exactness is behaviorally improved, but some replay rows in the 68 matrix are still generic/default decisions rather than exact mutation/replay scenarios.

### SUGGESTION

- None.

## Artifact

`openspec/changes/developer-team-execution-convergence/verify-batch-c-host-boundary-repair.md`

## Artifact Evidence

- Registry-deferred mode: this Verify writes only this report artifact.
- `state.yaml`, `events.yaml`, `apply-progress.md`, source, tests, generated output, and other files are not modified by this Verify.
- Official context reviewed: original `spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, `repair-incident.md`, prior Batch C Verify/Review reports, `spec-repair-batch-c.md`, `design-repair-batch-c.md`, current source/tests/diff/static audits.
- Post-write artifact byte count: `15389` bytes.

## Phase

`verify`

## Status

`failed`

## Registry Write

`deferred`

## Registry Intent

- **phase:** `verify`
- **status:** `failed`
- **event:** `verify.batch-c.host-boundary-repair.failed`
- **artifact:** `verify-batch-c-host-boundary-repair.md`
- **provenance:** `deck-developer-verify`; model `openai/gpt-5.5`; fresh independent Batch C EG3-R1 host-facing boundary repair Verify; registry-deferred; official OpenSpec/source/test/current-worktree evidence; independent reproducers, 68-matrix semantic audit, focused/affected/typecheck/broad/generated/scope audits; 2026-07-16.

## Blockers

1. `C-R5` / `C-B5` / `REQ-CBC-006` — implement stable explicit shadow/legacy/active composition and restrictive terminal-governance mapping, including safe `SHADOW_NO_LEGACY_COMPARISON`/`invalid-evidence` rejection and exact incident-driven terminal tests.
2. `C-R6` / `C-B6` / `REQ-CBC-007` — replace filler/substitute matrix rows with 68 exact public-boundary contract tests. Each row must exercise its named scenario and assert exact action, complete ordered rationale codes, digest/replay, terminal result, authority/Git reason, legacy status, and effect result.
