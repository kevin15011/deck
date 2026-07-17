# Verify Report: Batch C Direct Recovery

## Verdict

**FAIL**

Fresh independent registry-deferred verification found remaining Batch C blockers. Focused, affected, core, typecheck, and broad suites pass, and the original high-risk shrink, fail-closed authority/shadow/Full-SDD floor, frozen replay, and legacy/no-dossier reproducers are now green. However, the production-kernel boundary is still not invoked by any non-test production caller beyond the wrapper/export surface, and the committed Batch C tests still do not encode the complete exact routing/safety matrix required by the direct-recovery acceptance gate.

## Finding Disposition C-C1/C-C2/C-C3/C-B1-C-B6

| Finding | Disposition | Result | Evidence |
|---|---|---:|---|
| `C-C1-HIGH-RISK-SHRINK-REPAIRS-v1` | Closed by behavior | PASS | Independent high-risk reproducer: `progress="positive"`, `currentRisk.high=1`, action `escalate`, rationale `HIGH_RISK_REPAIR_FORBIDDEN`. |
| `C-C2-PRODUCTION-CALLER-DISCONNECTED-v1` | Still open | FAIL | Static caller audit found `productionCalls: []`; non-test references are definitions/exports/wrapper only. |
| `C-C3-BATCH-C-TEST-ORACLE-INCOMPLETE-v1` | Still open | FAIL | Committed Batch C tests are 4 kernel tests + 5 control-plane tests and omit required unrelated-baseline, terminal-budget/fingerprint, review-anchoring/scope, Full-SDD effect-boundary, legacy/no-dossier, terminal-governance, and real production-caller cases. |
| `C-B1` | Still open | FAIL | Same as `C-C2`: `runProductionExecutionDecisionPipelineV1()` is a non-test wrapper, but no production caller invokes it. |
| `C-B2` | Closed by behavior | PASS | Missing authority, shadow-only, Full-SDD floor, invalid plan, and narrow capability reproductions have zero unauthorized effects. |
| `C-B3` | Closed by behavior | PASS | High-risk and protected routing now forbid targeted repair; low-risk implementation shrink remains targeted repair. |
| `C-B4` | Closed by behavior | PASS | Canonical input digest covers authority state; replay reparses the frozen canonical record and equals the captured decision. |
| `C-B5` | Closed by behavior, test coverage incomplete | PASS WITH WARNING | `adaptDossierToRepairIncidentV1()` exists; legacy no-dossier mode returns true legacy/no-effect plan; shadow has zero effects. Committed tests still omit exact terminal-governance and legacy/no-dossier rows. |
| `C-B6` | Still open | FAIL | Same as `C-C3`: exact production/safety test matrix remains incomplete. |

## Exact Blocking Set

1. `C-C2-PRODUCTION-CALLER-DISCONNECTED-v1` / `C-B1` — no non-test production caller invokes the Batch C decision pipeline; current connectivity is a wrapper plus exports plus tests.
2. `C-C3-BATCH-C-TEST-ORACLE-INCOMPLETE-v1` / `C-B6` — committed tests remain too narrow to prove the full required routing, production, authority, replay, legacy, and terminal-governance matrix.

## Independent Reproducers

| Reproducer | Result | Evidence |
|---|---:|---|
| High-risk positive shrink must not target repair | PASS | `/tmp/opencode/high-risk-correct.ts`: action `escalate`, rationale `HIGH_RISK_REPAIR_FORBIDDEN`. |
| Low-risk implementation positive shrink may target repair | PASS | `/tmp/opencode/verify-batch-c-direct-recovery-repro.ts`: action `targeted_repair`, rationale `DELTA_POSITIVE_SCOPED_REPAIR`. |
| Full-SDD floor blocks active effect | PASS | Plan action `escalate`; execution result `{ invoked: false, reasonCode: "modification-not-authorized" }`. |
| Missing authority fails closed | PASS | Captured authority `{ state: "missing" }`; execution result `{ invoked: false, reasonCode: "modification-not-authorized" }`. |
| Shadow-only floor has zero effects | PASS | Execution result `{ invoked: false, reasonCode: "modification-not-authorized" }`. |
| Valid narrow capability invokes only targeted repair | PASS | One call to target `packages/sdd-runtime`; rationale `DELTA_POSITIVE_SCOPED_REPAIR`. |
| Canonical digest distinguishes authority states | PASS | Missing-authority digest differed from invalid-authority digest. |
| Frozen canonical replay equals captured decision | PASS | `plan.inputDigest === sha256Digest(plan.canonicalInput)` and `plan.replay() === plan.decision`. |
| Legacy no-dossier path remains true legacy/no effect | PASS | Mode `legacy`, no new decision, no invalid-evidence reason. |
| Production composition wrapper records kernel input/output | PASS | Wrapper returns active plan with canonical input, decision, replay, and digest. |
| Non-test production caller exists beyond wrapper/export | FAIL | Static audit: `productionCalls: []`; hits are tests, definitions, exports, or the wrapper itself. |

## Routing/Production/Authority/Replay/Legacy Evidence

### Routing

- `evaluateExecutionDecisionV1()` now blocks high-risk positive shrink from `targeted_repair`.
- Low-risk implementation-only positive shrink remains `targeted_repair`.
- Full-SDD/shadow floors and protected risks are restrictive.

### Production

- `runProductionExecutionDecisionPipelineV1()` exists in `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` and calls `runExecutionDecisionPipelineV1()`.
- Blocking gap: source and static reference audit found no non-test production caller beyond that wrapper/export surface.

### Authority / effect boundary

- `executeDeveloperTeamStepV1()` denies missing authority, invalid plans, non-active modes, shadow-only dossiers, Full-SDD lanes, non-`targeted_repair` actions, missing capability, capability-kind mismatch, authority digest mismatch, out-of-scope targets, blocked targets, and adapter errors.
- The adapter port is narrowed to `TargetedRepairCapabilityV1`, so it cannot reinterpret generic governance actions.

### Replay

- `runExecutionDecisionPipelineV1()` builds a frozen `execution-kernel-input-v1` containing policy version, dossier, kernel mode, authority state/capability digest, Git confirmation state, incident/governance digests and values, and legacy input digest.
- `replayCanonical()` reparses the captured dossier and calls the same kernel; it does not close over mutable caller input for the decision.

### Legacy / shadow

- `adaptDossierToRepairIncidentV1()` validates change continuity and returns no incident when none exists.
- `decisionKernel: "legacy"` with no dossier returns a legacy/no-decision plan.
- Shadow-only dossiers produce zero active effects.

## Test Quality

**FAIL.** The tests improved but remain below the direct-recovery acceptance matrix.

Static audit:

| File | Tests | Expects | Missing exact required rows |
|---|---:|---:|---|
| `packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts` | 4 | 11 | unrelated baseline, terminal budget/fingerprint, review anchoring/scope classification, Full-SDD floor, mixed-root table breadth, repeated evaluation of every REQ-DECISION-002 row. |
| `packages/sdd-runtime/src/execution/execution-control-plane.test.ts` | 5 | 17 | actual non-test production caller connectivity, Full-SDD effect-boundary row, legacy/no-dossier mode row, terminal-governance composition, adapter error/scope-widening matrix breadth. |

The tests no longer rely on broad `toMatchObject()` partial assertions for Batch C, but they are still not the complete exact production/safety matrix required by `tasks.md` and the direct-recovery gate.

## Focused/Affected Evidence

| Check | Command | Result |
|---|---|---:|
| Independent reproducers | `bun /tmp/opencode/verify-batch-c-direct-recovery-repro.ts` and `bun /tmp/opencode/high-risk-correct.ts` | FAIL overall: 10/11 reproducers pass; production-caller reproducer fails. |
| Focused Batch C/kernel/control-plane | `bun test packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.test.ts packages/sdd-runtime/src/execution/execution-control-plane.test.ts --timeout 30000` | PASS: 69 pass / 0 fail / 209 expectations across 4 files. |
| Affected sdd-runtime | `bun test packages/sdd-runtime --timeout 30000` | PASS: 379 pass / 0 fail / 874 expectations across 32 files. |
| Core legacy/export compatibility | `bun test packages/core --timeout 30000` | PASS: 1474 pass / 0 fail / 5228 expectations across 55 files. |
| Serena diagnostics | Changed Batch C runtime source files | PASS: no warnings/errors returned. |

## Typecheck

**PASS**

Command: `bunx tsc --noEmit`  
Exit: `0`  
Duration: `34138 ms`.

## Broad Evidence

**PASS**

Command: `bun test --timeout 30000`  
Wall allowance: `900000 ms`  
Observed duration: `97.66 s`  
Result: `3418 pass / 0 fail`, `11918` expectations, 192 files.

## Generated/Scope Audit

| Audit | Result |
|---|---|
| Canonical generated skill hash | `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` |
| Build-info hash | `75624e5005c4d82a223e1948345c76cee66c79794e846054aa79801694edbed7` |
| Generated/build-info drift during verification | No hash drift observed. |
| Batch C source scope inspected | `packages/sdd-runtime/src/orchestrator/decision-kernel.ts`, `repair-loop-governance.ts`, `orchestrator-pipeline.ts`, `packages/sdd-runtime/src/execution/execution-control-plane.ts`, `execution-adapter-port.ts`, `packages/sdd-runtime/src/index.ts`, and adjacent tests. |
| Excluded WIP / archive intersection | No `runner-capability-standardization` or `openspec/archive` path appears in Batch C source/test evidence. |
| Later-scope expansion | No Batch D adapter bridge, registry coordinator, prompt/lane rollout, or invocation authorization service implementation was credited in this verification. |

## Compliance Matrix

| Requirement / Scenario | Method | Result | Notes |
|---|---|---:|---|
| REQ-DECISION-001 deterministic classifications/action/rationale | Focused tests + replay reproducer | PASS WITH WARNING | Determinism/replay green for sampled paths; complete exact table test remains incomplete. |
| REQ-DECISION-002 exact routing table | Independent reproducers + test audit | FAIL | High-risk shrink is fixed, but committed tests do not cover every required row. |
| REQ-DECISION-003 route by root cause/progress, not prompt/count | Source inspection + focused tests | PASS WITH WARNING | Main precedence paths green; review anchoring/scope classification tests incomplete. |
| REQ-DECISION-004 terminal bounds cannot manufacture progress | Legacy governance tests + source inspection | PASS WITH WARNING | Legacy governance tests pass; Batch C terminal-budget/fingerprint rows are missing. |
| REQ-DECISION-005 production path invokes kernel and records digest/action/rationales | Static caller audit + tests | FAIL | Wrapper records data, but no non-test production caller invokes it. |
| REQ-DECISION-006 invalid evidence blocks modification | Focused tests + reproducer | PASS | Invalid dossiers have distinct input digests and zero effects. |
| REQ-AUTH-002 missing/invalid authority default denial | Independent reproducers + focused tests | PASS | Missing authority and shadow/Full-SDD floors produce zero effects. |
| REQ-ROLLOUT-002 shadow modes do not change authoritative effects | Independent reproducers + focused tests | PASS | Shadow-only execution is denied; direct shadow zero-effect behavior is green. |
| Scenario: Failure delta routing table is enforced | Test audit | FAIL | Exact complete table is not committed. |
| Scenario: Terminal guard cannot manufacture progress | Test audit | PASS WITH WARNING | Existing governance suite passes; exact Batch C terminal composition rows absent. |
| Scenario: Production and replay use the same kernel | Static caller audit + reproducer | FAIL | Replay green; production caller connectivity remains unproven. |
| Scenario: Invalid authorization has zero modifying effects | Reproducer + focused tests | PASS | Missing authority has zero effects. |

## Artifact

`openspec/changes/developer-team-execution-convergence/verify-batch-c-direct-recovery.md`

## Artifact Evidence

- Registry-deferred mode: this Verify writes only this report artifact.
- `state.yaml`, `events.yaml`, `apply-progress.md`, `repair-incident.md`, source, tests, generated output, and other files are not modified by this Verify.
- Post-write artifact byte count: `13500` bytes.

## Phase

`verify`

## Status

`failed`

## Registry Write

`deferred`

## Registry Intent

- **phase**: `verify`
- **status**: `failed`
- **event**: `verify.batch-c.direct-recovery.failed`
- **artifact**: `verify-batch-c-direct-recovery.md`
- **provenance**: `deck-developer-verify`; model `openai/gpt-5.5`; timestamp `2026-07-16`; fresh independent Batch C direct-recovery verification; registry-deferred; official OpenSpec/source/test/current-worktree evidence; independent reproducers, focused/affected/core/typecheck/broad/generated/scope audits.

## Blockers

1. `C-C2-PRODUCTION-CALLER-DISCONNECTED-v1` / `C-B1` — connect an actual non-test production caller to the Batch C decision pipeline, or provide approved source evidence that the wrapper itself is the production caller under the Batch C contract. Tests/exports alone are insufficient.
2. `C-C3-BATCH-C-TEST-ORACLE-INCOMPLETE-v1` / `C-B6` — complete the committed exact matrix for routing, root cause, unrelated baseline, regression/no-progress, terminal budget/fingerprint, review anchoring/scope, invalid evidence, authority/shadow/Full-SDD floors, replay immutability, legacy/no-dossier/shadow semantics, production caller connectivity, adapter errors, and scope-widening denial.
