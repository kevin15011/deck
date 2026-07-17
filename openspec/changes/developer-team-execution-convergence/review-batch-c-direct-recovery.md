# Review Report: Batch C Direct Recovery

## Verdict

**FAIL — REQUEST CHANGES.** Six blocking Spec/Design/Task defects remain. The recovery fixes the original high-severity implementation-shrink example, adds a narrow targeted-repair capability, captures valid inputs for immutable replay, and adds a compatibility symbol. It does not, however, connect the kernel to an actual non-test production caller, fully fail closed on authority and Git-safety state, protect data-loss findings, safely identify every invalid input, preserve mandatory shadow/legacy composition, or provide the exact required acceptance matrix.

**Overall Rating:** REQUEST CHANGES  
**Scope:** general, backend, integration  
**Blocking findings:** 6

## Findings

### BLOCKER — C-R1 — The renamed production wrapper remains test-only and creates a circular composition boundary

- **Category:** Architecture / Integration
- **Anchors:** REQ-DECISION-005 (`spec.md:69-70`); EG3-T2 production-caller RED/GREEN and completion gates (`tasks.md:526-533`); production boundary (`design.md:455-457`).
- **Evidence:** `runProductionExecutionDecisionPipelineV1()` at `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts:26-28` is a three-line forwarding helper. Fresh graph/reference inspection finds no non-test inbound caller; its only repository call is `execution-control-plane.test.ts:19`. `executeDeveloperTeamStepV1()` likewise has no non-test caller. The new wrapper also imports `execution-control-plane.ts`, while that module imports `runOrchestratorPipeline()` from `orchestrator-pipeline.ts` (`execution-control-plane.ts:6`), creating a circular module dependency solely to place the forwarding name in the legacy module.
- **Impact:** The repository still has no active production orchestration path that invokes or records the V1 kernel. An exported helper whose only invocation is a test is the exact condition REQ-DECISION-005 excludes; renaming the helper does not connect production authority.
- **Required change:** Connect one real non-test production orchestration entry point to planning and the authorized effect boundary, without implementing Batch D runner bridges. If the approved EG3 boundary cannot contain such a caller, route that conflict through Spec/Design replan rather than treating a forwarding export as production wiring. Remove the circular dependency through a one-way composition boundary.

### BLOCKER — C-R2 — Missing authority and missing Git confirmation still fail open at public decision/effect boundaries

- **Category:** Security / Architecture
- **Anchors:** permanent authority/Git-safety precedence (`design.md:16-24`); decision inputs and precedence (`design.md:499-505`); EG3-T1 hard-stop precedence (`tasks.md:495-502`); REQ-BOUNDARY-001 (`spec.md:168-169`).
- **Evidence:** `ExecutionDecisionKernelInputV1.authorizationValid` and `destructiveGitConfirmed` remain optional (`decision-kernel.ts:9-10`). The public kernel rejects only explicit `false` (`decision-kernel.ts:52-53`), and its own test expects a missing-authority input to return `targeted_repair` (`decision-kernel.test.ts:9-15`). The production planner converts absent Git confirmation to `true` with `input.destructiveGitConfirmed !== false` (`execution-control-plane.ts:77`).
- **Independent reproduction:** `evaluateExecutionDecisionV1({ dossier })` returned `targeted_repair` with no authority field. A valid active plan with no Git-confirmation field captured `destructiveGitConfirmed: true`; a matching injected capability was invoked once.
- **Impact:** The public decision contract still treats absent authority as permission, and an absent permanent Git-safety confirmation can cross the modifying capability boundary. The narrow capability reduces action widening but does not repair default-allow decision inputs.
- **Required change:** Make authority and applicable Git-safety state mandatory, validated canonical inputs. Missing/invalid authority must select stop with a distinct stable rationale. Missing destructive-operation confirmation must never be synthesized as confirmed and must block any capability that could perform that operation.

### BLOCKER — C-R3 — Data-loss risk can still route to targeted repair

- **Category:** Security / Correctness
- **Anchors:** positive-progress definition (`spec.md:17-20`); security/data-loss routing (`spec.md:53-59`); complete EG3-T1 routing table (`tasks.md:495-502`); decision precedence (`design.md:499-518`).
- **Evidence:** `hasProtectedRisk` in `decision-kernel.ts:42-46` checks security, critical/high severity, authorization, Git safety, and requirement root cause, but not the existing `category === "data-loss"` classification used by `failure-delta.ts`. A low-severity implementation-rooted data-loss finding therefore satisfies the targeted-repair conjunction at `decision-kernel.ts:64-65` after a positive delta.
- **Independent reproduction:** A valid dossier whose data-loss finding shrank from critical to low produced a positive delta and `targeted_repair`. The same path can replan rather than escalate a newly related low-severity data-loss regression.
- **Impact:** REQ-DECISION-002's explicit no-automatic-retry floor for data-loss risk remains bypassable. This keeps C-C1/C-B3 open despite closure of the narrower high-severity example.
- **Required change:** Use one shared protected-risk predicate for delta and kernel routing, including data loss, security, authorization, Git safety, critical/high risk, and uncovered requirements. Add exact positive-shrink and new-regression cases for each protected class.

### BLOCKER — C-R4 — Invalid-input identity can throw and can hash unsafe raw evidence

- **Category:** Security / Reliability
- **Anchors:** REQ-CONTRACT-005 (`spec.md:37-38`); REQ-DECISION-006 (`spec.md:72-73`); canonical/redaction rules (`design.md:397-421`); invalid-dossier gate (`tasks.md:526-533`); failure response (`design.md:674-678`).
- **Evidence:** The catch path at `execution-control-plane.ts:87-90` computes a digest over the raw rejected `input.dossier` and parser error. It does not pass the rejected value through a bounded safe canonical projection. Unsupported values such as cycles can make this second hash throw; secret-bearing rejected values can influence a persisted/audited digest, which Design explicitly prohibits.
- **Independent reproduction:** A cyclic invalid dossier caused `runExecutionDecisionPipelineV1()` to throw `invalid-canonical-value: cyclic input` instead of returning an `invalid-evidence` plan.
- **Impact:** Invalid evidence is not reliably fail-closed and replay-identifiable, and unsafe raw input can influence decision identity. Valid-input replay is materially improved, but C-B4 is not fully closed at the invalid boundary.
- **Required change:** Produce invalid-input identity from a bounded, redacted, non-secret safe classification that itself cannot throw. Every rejected input class must return a deterministic `invalid-evidence` plan with zero effects; raw rejected bytes and raw-secret-derived hashes must never enter the record.

### BLOCKER — C-R5 — Shadow mode still does not require or preserve legacy authority composition

- **Category:** Architecture / Compatibility
- **Anchors:** EG3-T2 composition (`tasks.md:516-518`); production/shadow boundary (`design.md:455`); repair-governance integration (`design.md:520-527`); REQ-ROLLOUT-002 (`spec.md:142-143`).
- **Evidence:** `legacyInput` remains optional (`execution-control-plane.ts:28`). Shadow mode computes a legacy result only when a caller happens to provide it (`execution-control-plane.ts:64`), and `executeDeveloperTeamStepV1()` returns `effect-not-permitted` for every shadow plan (`execution-control-plane.ts:97`) without representing the unchanged legacy effect path. `adaptDossierToRepairIncidentV1()` now exists, but only returns an externally supplied incident after a change-ID check (`repair-loop-governance.ts:37-41`); no Batch C test composes it with repeated-fingerprint/budget outcomes.
- **Independent reproduction:** A valid shadow plan without `legacyInput` returned `legacy === undefined`.
- **Impact:** The API still permits shadow execution without the mandatory legacy/new comparison, so it cannot demonstrate that legacy remains authoritative while the eventual active semantics are observed. The compatibility symbol alone does not close C-B5.
- **Required change:** Model legacy, shadow, and active composition explicitly. Shadow planning must require/derive the unchanged legacy result and record the comparison while preventing the V1 recommendation from controlling effects. Add exact no-dossier legacy and terminal-governance composition tests.

### BLOCKER — C-R6 — The exact Batch C safety and production test matrix is still absent

- **Category:** Test Quality / Maintainability
- **Anchors:** EG3-T1 exact table evidence (`tasks.md:495-502`); EG3-T2 production/effect evidence (`tasks.md:526-533`); test architecture (`design.md:689-705`); REQ-VERIFY-005 (`spec.md:120-121`).
- **Evidence:** The new kernel file has four tests and the control-plane file has five. They do not provide individually named exact cases for unrelated-baseline quarantine, low/medium related regression, data-loss risk, mixed roots, Full-SDD floor, missing versus invalid authority rationale, missing Git confirmation, repeated fingerprint, soft/hard terminal budgets composed with kernel actions, Review anchoring/scope classification, legacy/no-dossier behavior, shadow legacy authority, capability digest mismatch, allowed/blocked target mismatch, non-delegating actions, adapter error, or cyclic/prototype/secret-bearing invalid evidence. The production test directly calls the still-disconnected wrapper. The terminal-only test merely compares one in-memory evaluation to itself and supplies no incident (`decision-kernel.test.ts:29-32`).
- **Impact:** The suite passes while the independent authority, data-loss, invalid-cycle, shadow-composition, and production-connectivity defects above remain reproducible. C-C3/C-B6 remain open.
- **Required change:** Add the complete individually named public-boundary matrix required by EG3-T1/T2. Assert exact action, complete ordered rationales, digest/decision replay, terminal guard, authority reason, and zero-effect result for each case; include a structural test that fails unless a real non-test production caller exists.

## Finding Disposition C-C1/C-C2/C-C3/C-B1–C-B6

| Finding | Disposition | Evidence |
|---|---|---|
| `C-C1-HIGH-RISK-SHRINK-REPAIRS-v1` | **OPEN / partially repaired** | The named high-severity example now escalates, but a positive data-loss shrink still returns `targeted_repair` (C-R3), and the public kernel still permits repair with omitted authority (C-R2). |
| `C-C2-PRODUCTION-CALLER-DISCONNECTED-v1` | **OPEN** | The new production-named wrapper has no non-test inbound caller and only forwards to the prior helper (C-R1). |
| `C-C3-BATCH-C-TEST-ORACLE-INCOMPLETE-v1` | **OPEN** | Nine new tests omit most required table, terminal, authority, legacy, invalid-input, and connectivity cases (C-R6). |
| `C-B1` | **OPEN** | No actual non-test production execution path calls planning/effect code (C-R1). |
| `C-B2` | **OPEN** | The effect port is narrower, but public authority and Git confirmation remain default-allow when absent (C-R2). |
| `C-B3` | **OPEN / partially repaired** | High-severity shrink is fixed; data-loss protected-risk routing is not (C-R3). |
| `C-B4` | **OPEN / partially repaired** | Valid canonical input is frozen and replayed; rejected input can throw or influence identity from unsafe raw values (C-R4). |
| `C-B5` | **OPEN / partially repaired** | The compatibility symbol and no-dossier branch exist, but shadow does not require/retain legacy authority and terminal composition lacks exact integration evidence (C-R5). |
| `C-B6` | **OPEN** | Required exact production and safety tests remain absent (C-R6). |

## Security

**Weak / blocking.** The targeted-repair-only capability is a meaningful improvement and prevents governance actions from being reinterpreted as effects. Missing authority at the public kernel, synthesized Git confirmation, omitted data-loss classification, and unsafe invalid-input hashing remain concrete security boundary failures.

## Routing/Safety

**Weak / blocking.** High/critical implementation risk, security, authorization, Git safety, mixed roots, related regression, and Full-SDD/shadow floors are now represented. The routing predicates are duplicated across delta and kernel code and already diverge on data loss. Terminal governance remains restrictive-only when supplied, but its absence and composition are not qualified by the new tests.

## Production/Replay

**Weak / blocking.** Valid plans capture a deeply frozen, versioned canonical record and replay through dossier parsing, which closes most of the original mutable-closure defect. Production connectivity remains absent, and invalid-input replay identity is not total or safe.

## Authority/Legacy

**Weak / blocking.** Active execution now checks mode, parsed plan, authority state, shadow/Full-SDD floors, action, capability kind/digest, and exact target inclusion. However, upstream defaults still manufacture valid-enough decision inputs from missing authority/Git state, and shadow can omit the legacy plan entirely.

## Test Quality

**Weak / blocking.** Official Apply evidence reports focused `69/69`, sdd-runtime `379/379`, core `1474/1474`, typecheck clean, and broad `3418/3418`; those results establish stability, not adequacy of the Batch C oracle. Independent reproductions demonstrate false-green required cases.

## Compatibility/Maintainability

- Existing `evaluateRepairIncident()` and `runOrchestratorPipeline()` bodies are unchanged; the root export oracle is exact over the current 63-key surface and the API changes are additive.
- Complexity is linear in finding count and acceptable for dossier sizes; no dependency or material performance issue was found.
- Maintainability is weakened by the orchestrator/control-plane import cycle, duplicated protected-risk predicates, dense one-line fixtures/control flow, and the stale export-test name/comment claiming 61 keys while asserting 63. These are secondary to the blocking architectural and test defects above.

## Scope Audit

- The direct-recovery implementation remains within the declared Batch C runtime/test paths: decision kernel, repair-governance adapter, orchestrator composition, control plane, targeted-repair port, package exports, and adjacent tests.
- No Batch D authorization service/runner bridge, registry coordinator, prompt authority, new dependency, build-info edit, historical archive edit, or excluded `runner-capability-standardization` path was attributed to this recovery.
- The broader dirty worktree contains prior authorized Batch A/B adapter/generated/governance work. It receives no Batch C credit. The canonical generated skill hash reported by Apply remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- **Scope result:** PASS; no independent scope-expansion blocker found.

## Artifact

`openspec/changes/developer-team-execution-convergence/review-batch-c-direct-recovery.md`

## Artifact Evidence

- Official context reviewed: `verify-batch-c.md`, `review-batch-c.md`, `repair-incident.md`, `apply-progress.md`, `tasks.md`, `spec.md`, and `design.md`.
- Current source/tests/diff reviewed: Batch C decision kernel, control plane, adapter port, orchestrator composition, repair-governance projection, package exports, exact export oracle, kernel tests, control-plane tests, and current changed-path/diff evidence.
- Fresh code-graph index and inbound traces: `runProductionExecutionDecisionPipelineV1()` and `executeDeveloperTeamStepV1()` have no non-test callers.
- Independent reproducer output: `{"directMissingAuthority":"targeted_repair","dataLossPositive":"targeted_repair","destructiveMissingCaptured":true,"effect":{"invoked":true},"calls":1,"shadowHasLegacy":false,"invalidCycle":"threw:Error: invalid-canonical-value: cyclic input"}`.
- Serena diagnostics: no errors or warnings in the seven changed Batch C source/test files inspected.
- Adaptive context: Supermemory advisory recall was loaded; official OpenSpec artifacts, source, tests, and current bytes remained authoritative.
- Registry-deferred discipline: this Review writes only this artifact and reports immutable registry intent below.

## Phase

`review`

## Status

`changes_requested`

## Registry Write

`deferred`

## Registry Intent

- **phase:** `review`
- **status:** `changes_requested`
- **event:** `review.batch-c.direct-recovery.failed`
- **artifact:** `review-batch-c-direct-recovery.md`
- **provenance:** `deck-developer-review`; model `openai/gpt-5.6-sol`; fresh independent Batch C direct-recovery Review; registry-deferred; official artifact, current source/test/diff, graph, diagnostics, and independent reproducer evidence; 2026-07-16.

## Blockers

`C-R1`, `C-R2`, `C-R3`, `C-R4`, `C-R5`, `C-R6`.
