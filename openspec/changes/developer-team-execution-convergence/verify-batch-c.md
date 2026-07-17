# Verify Report: Batch C — EG3-T1 / EG3-T2

## Verdict

**FAIL**

Fresh independent verification found blocking Batch C defects. Focused, affected, typecheck, and broad suites pass, but independent reproducers show the decision kernel still authorizes targeted repair for a positive-shrink dossier with a remaining high-severity implementation finding. That violates the Batch C safety/precedence contract: shrinking progress may continue only when no high/critical, security, data-loss, or uncovered-requirement regression remains. In addition, the new production execution boundary is only exported and test-called; no non-test production caller is connected, so REQ-DECISION-005 is not satisfied.

## Finding Set

| ID | Severity | Status | Summary |
|---|---:|---|---|
| `C-C1-HIGH-RISK-SHRINK-REPAIRS-v1` | CRITICAL | OPEN | `evaluateExecutionDecisionV1()` returns `targeted_repair` for a strictly shrinking implementation delta with a remaining high-severity finding. |
| `C-C2-PRODUCTION-CALLER-DISCONNECTED-v1` | CRITICAL | OPEN | `runExecutionDecisionPipelineV1()` / `executeDeveloperTeamStepV1()` are referenced only by exports and tests, not by a production caller. |
| `C-C3-BATCH-C-TEST-ORACLE-INCOMPLETE-v1` | CRITICAL | OPEN | Batch C tests are false-green: they omit high-risk shrink, unrelated baseline, terminal budget, review anchoring, and production-caller connectivity cases. |

## Decision Kernel Verification

| Requirement / scenario | Method | Result | Notes |
|---|---|---|---|
| Pure deterministic kernel uses dossier/delta/root-cause inputs, not prompt prose | Source inspection and focused tests | PASS | `evaluateExecutionDecisionV1()` is pure over `ExecutionDossierV1`, optional authorization/Git flags, and optional incident/governance config. |
| Security and critical hard-stop precedence | Source inspection and focused tests | PASS | Security root cause, Git-safety root cause, `isSecurityRelevant`, and `critical` findings escalate/stop before implementation repair. |
| High-risk shrink cannot continue as targeted repair | Independent reproducer | **FAIL** | Current high-severity implementation finding with positive delta returns `targeted_repair` and `DELTA_POSITIVE_SCOPED_REPAIR`. Required behavior is replan/escalate/stop, not modification. |
| Invalid oracle / requirement / design classifications | Source inspection and focused tests | PASS | `oracle` routes `correct_oracle`, `requirement` routes `replan_spec`, and `architecture`/`batch_shape` route `replan_design_or_tasks`. |
| No-progress / negative-progress behavior | Focused tests and source inspection | PASS WITH LIMITATION | `none` routes `checkpoint`; negative routes design/task replan. Exact regression/new-related tables are not independently complete in tests. |
| New unrelated baseline behavior | Source inspection only | PASS WITH WARNING | Open findings filter excludes `relationship === "unrelated_baseline"`; however there is no exact Batch C test for this required case. |
| Terminal budget as safety bound | Legacy governance tests and source inspection | PASS WITH WARNING | Existing `evaluateRepairIncident()` compatibility tests pass and terminal guard can only restrict selected repair; Batch C tests do not assert budget/fingerprint terminal cases. |

Independent reproducer output:

```json
{"name":"high-risk-shrink-must-not-targeted-repair","expected":"not targeted_repair","actual":"targeted_repair","rationale":["DELTA_POSITIVE_SCOPED_REPAIR"],"pass":false}
{"name":"authorization-root-cause-must-stop-not-repair","expected":"stop/escalate","actual":"escalate","rationale":["SECURITY_REGRESSION"],"pass":true}
```

## Production/Replay Verification

| Requirement / scenario | Method | Result | Notes |
|---|---|---|---|
| Shadow and active planning call the same kernel | Source inspection and focused tests | PASS | `runExecutionDecisionPipelineV1()` computes `decision` and `replay()` from the same parsed dossier/kernel input. |
| Replay determinism | Focused tests | PASS | `plan.replay()` equals `plan.decision` in committed tests. |
| Production caller connected | Serena reference trace | **FAIL** | `runExecutionDecisionPipelineV1()` references are only `orchestrator-pipeline.ts` re-export, `index.ts` re-export, and `execution-control-plane.test.ts`. `executeDeveloperTeamStepV1()` references are only `index.ts` and tests. No non-test production caller invokes the new boundary. |
| Invalid dossier blocks modification | Focused tests | PASS | Invalid active plan returns `reasonCode: invalid-evidence`; adapter call count remains unchanged after invalid execution. |

## Shadow/Safety Verification

| Requirement / scenario | Method | Result | Notes |
|---|---|---|---|
| Shadow mode has zero adapter effects | Focused tests | PASS | Shadow plan invokes zero adapter calls. |
| Legacy mode has zero adapter effects | Source inspection | PASS | `executeDeveloperTeamStepV1()` invokes only when `plan.mode === "active"`. |
| Invalid plan has zero adapter effects | Focused tests | PASS | Invalid plan does not invoke adapter. |
| Stop/escalate plans have zero adapter effects | Source inspection | PASS | `executeDeveloperTeamStepV1()` refuses `stop` and `escalate`. |
| Active semantics and digest/rationales deterministic | Source inspection and focused tests | PASS WITH WARNING | Digest is deterministic over dossier digest and mode; rationale codes are arrays from fixed branches. Full decision table coverage is incomplete. |

## Compatibility

| Compatibility target | Method | Result | Notes |
|---|---|---|---|
| `evaluateRepairIncident()` legacy behavior intact | Focused suite | PASS | `repair-loop-governance.test.ts` remains green as part of Batch C focused run. |
| Existing `runOrchestratorPipeline()` behavior intact | Focused suite | PASS | `orchestrator-pipeline.test.ts` remains green. |
| Additive exports | Focused/affected suites and source inspection | PASS | New exports are additive; existing runtime/core suites pass. |
| Batch B closure compatibility | Official artifacts and affected tests | PASS | Final Batch B Verify/Review artifacts record zero blockers; Batch C affected suites pass against current Batch B contracts. |

## Test Quality

**FAIL.** The committed Batch C tests are too narrow for the acceptance contract.

Static audit:

```json
{
  "packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts": {
    "testCount": 3,
    "hasUnrelatedBaseline": false,
    "hasTerminalBudget": false,
    "hasReviewAnchoring": false,
    "toMatchObjectCount": 8
  },
  "packages/sdd-runtime/src/execution/execution-control-plane.test.ts": {
    "testCount": 2,
    "hasRegression": false,
    "hasTerminalBudget": false,
    "hasReviewAnchoring": false
  }
}
```

The high-risk shrink reproducer fails while the focused suite reports `65 pass / 0 fail`, proving the current aggregate is false-green for a required precedence case. Tests also do not prove a real non-test production caller, review anchoring/scope classification, exact unrelated-baseline behavior, or terminal budget/fingerprint behavior in the Batch C kernel.

## Focused/Affected Evidence

| Check | Command | Result |
|---|---|---|
| Independent targeted reproducers | `/tmp/opencode/verify-batch-c-independent.ts` via `bun` | **FAIL**: exit 42; high-risk shrink returned `targeted_repair`. |
| Batch C focused/kernel/control-plane | `bun test packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.test.ts packages/sdd-runtime/src/execution/execution-control-plane.test.ts --timeout 30000` | PASS: 65 pass / 0 fail. |
| Affected sdd-runtime | `bun test packages/sdd-runtime --timeout 30000` | PASS: 375 pass / 0 fail across 32 files. |
| Core legacy/export compatibility | `bun test packages/core --timeout 30000` | PASS: 1474 pass / 0 fail across 55 files. |

## Typecheck

**PASS**

Command: `bunx tsc --noEmit`  
Exit: 0  
Duration: 24703 ms.

## Broad Evidence

**PASS**

Command: `bun test --timeout 30000`  
Wall allowance: `900000 ms`  
Observed duration: 105.51 s  
Result: `3414 pass / 0 fail`, `11904` expectations, 192 files.

No nonzero or unapproved broad failure occurred.

## Generated/Scope Audit

| Audit | Result |
|---|---|
| Canonical generated skill hash | `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` |
| Build-info hash | `75624e5005c4d82a223e1948345c76cee66c79794e846054aa79801694edbed7` |
| Build-info worktree status | clean |
| Batch C implementation paths observed | `packages/sdd-runtime/src/orchestrator/decision-kernel.ts`, `decision-kernel.test.ts`, `orchestrator-pipeline.ts`, `packages/sdd-runtime/src/execution/`, `packages/sdd-runtime/src/index.ts`, and export snapshot test updates. |
| Batch D / adapter enforcement / registry coordinator / lane / prompt responsibility leakage | No Batch D authorization, invocation-authorization service, registry coordinator, lane router, or prompt-convergence source was found in Batch C scope. Existing adapter/core/generated worktree entries are prior Batch A/B scope, not new Batch C authority. |
| Historical / excluded WIP audit | No `runner-capability-standardization` or `openspec/archive` path appears in the Batch C implementation evidence. |

## Artifact

`openspec/changes/developer-team-execution-convergence/verify-batch-c.md`

## Artifact Evidence

- Registry-deferred mode: this Verify writes only this report artifact.
- `state.yaml`, `events.yaml`, `apply-progress.md`, `repair-incident.md`, source, tests, generated output, and other files are not modified by this Verify.
- Post-write artifact byte count: `10997` bytes.

## Phase

`verify`

## Status

`failed`

## Registry Write

`deferred`

## Registry Intent

- **phase**: `verify`
- **status**: `failed`
- **event**: `verify.batch-c.failed`
- **artifact**: `verify-batch-c.md`
- **provenance**: `deck-developer-verify`; model `openai/gpt-5.5`; timestamp `2026-07-16`; fresh independent Batch C verification; registry-deferred; focused, affected, typecheck, broad, generated/scope, static reference, and independent reproducer evidence.

## Blockers

1. `C-C1-HIGH-RISK-SHRINK-REPAIRS-v1` — repair the kernel so positive shrink cannot authorize targeted repair with remaining high/critical/security/data-loss/auth/Git-safety or uncovered-requirement risk, and add exact public/kernel tests.
2. `C-C2-PRODUCTION-CALLER-DISCONNECTED-v1` — connect the non-test production orchestration boundary to the same kernel/replay path or explicitly prove the boundary is the production caller under the approved Batch C scope.
3. `C-C3-BATCH-C-TEST-ORACLE-INCOMPLETE-v1` — replace false-green Batch C coverage with exact cases for the full routing table, high-risk shrink, unrelated baseline, regression/no-progress, terminal guard, review anchoring/scope classification, invalid evidence, shadow zero effects, and production caller connectivity.
