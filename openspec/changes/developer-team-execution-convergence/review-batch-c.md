# Review Report: Batch C (`EG3-T1`, `EG3-T2`)

## Verdict

**FAIL.** Batch C has six blocking engineering findings. The implementation is localized and the focused tests pass, but the decision helper is not connected to a production caller, active execution fails open across authorization and lane boundaries, the routing table permits an unsafe high-risk repair, replay identity omits decision-driving inputs, legacy terminal governance is not actually composed as designed, and the tests do not exercise the mandatory safety matrix. Intended event: `review.batch-c.failed`.

## Findings

### BLOCKER — C-B1 — The decision pipeline is a disconnected helper, not production wiring

- **Category**: Architecture / Integration
- **Anchor**: REQ-DECISION-005 (`spec.md:69-70`); EG3-T2 production-caller RED/GREEN gate (`tasks.md:526-529`); Design production boundary (`design.md:455-457`).
- **Evidence**: `runExecutionDecisionPipelineV1()` is defined at `packages/sdd-runtime/src/execution/execution-control-plane.ts:12-23`. `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts:15-18` only re-exports it, and `packages/sdd-runtime/src/index.ts:55-57` only exposes it. Code-graph inbound tracing found only `execution-control-plane.test.ts` as a caller; no runner, host, orchestration entry point, or other production symbol invokes it. `executeDeveloperTeamStepV1()` likewise has only the test caller.
- **Impact**: Active cohorts cannot use or record this kernel through the production orchestration path. Passing direct helper tests cannot satisfy the explicit requirement that a test/prompt-only helper is insufficient.
- **Required change**: Add the authorized versioned production composition/caller inside the EG3 boundary, preserving `runOrchestratorPipeline()` behavior. Prove the caller records the canonical versioned input identity, action, and ordered rationale without implementing EG4 adapters, EG5 registry coordination, verification lanes, prompts, or rollout.

### BLOCKER — C-B2 — Active execution fails open and can invoke the adapter from a shadow-only dossier

- **Category**: Security / Architecture
- **Anchor**: REQ-ROLLOUT-002 (`spec.md:142`); Design authorization and safety precedence (`design.md:499-506`), immutable Full-SDD floors (`design.md:533-539`), and missing-authorization failure response (`design.md:677-679`).
- **Evidence**: `ExecutionDecisionKernelInputV1.authorizationValid` is optional (`decision-kernel.ts:7-13`), but only explicit `false` stops (`decision-kernel.ts:42`). `executeDeveloperTeamStepV1()` checks neither missing authorization nor `plan.dossier.lane.shadowOnly`; it invokes the generic adapter for every active action except `stop` and `escalate` (`execution-control-plane.ts:25-29`). The port accepts every `ExecutionActionV1` plus the full dossier and has no target-scope or validated-authority capability (`execution-adapter-port.ts:4-5`).
- **Independent reproduction**: An active plan built from a dossier with `lane.shadowOnly=true` and no authorization produced `advance_verification` and invoked the adapter once. Supplying `authorizationValid=false` produced `stop`. Exact output: `{"shadowOnly":true,"missingAuthAction":"advance_verification","explicitInvalidAction":"stop","sameInputDigest":true,"adapterCalls":1}`.
- **Impact**: Missing authority is treated as permission, a permanent shadow-only floor is silently lowered, and non-modifying governance actions such as `complete`, `checkpoint`, `replan_*`, `correct_oracle`, and `advance_verification` can be reinterpreted by a generic effect adapter. This is an unsafe automatic-action boundary even though real EG4 adapter implementation is not yet authorized.
- **Required change**: Fail closed on absent/invalid authority and on `shadowOnly`/Full-SDD floors; make the effect request impossible to widen or reinterpret. Until EG4 authorization exists, active modifying delegation must remain unavailable except through an explicitly validated injected capability. Do not implement EG4 issuance, runner bridges, rollout, or later-lane behavior in this repair.

### BLOCKER — C-B3 — The kernel routes a remaining high-risk finding to automatic targeted repair

- **Category**: Security / Correctness
- **Anchor**: REQ-DECISION-002 (`spec.md:48-59`), especially the shrinking-set and high-risk rows; Design decision table (`design.md:501-516`); EG3-T1 mandatory table evidence (`tasks.md:495-502`).
- **Evidence**: The implementation reduces routing to selected root cause plus `delta.progress` (`decision-kernel.ts:38-52`). For implementation findings, positive progress always selects `targeted_repair`; it does not enforce the requirement that all remaining findings be implementation-rooted and that no high/critical, security, data-loss, uncovered-requirement regression, or Full-SDD floor remains. It also escalates only critical/security findings, not high-risk regressions (`decision-kernel.ts:44`).
- **Independent reproduction**: A valid full-SDD dossier that improved one implementation finding from critical to high yielded `delta.progress="positive"`, `currentRisk.high=1`, and `action="targeted_repair"` with `DELTA_POSITIVE_SCOPED_REPAIR`.
- **Impact**: A high-risk unresolved state can trigger another modifying retry, directly violating the no-unsafe-retry acceptance condition.
- **Required change**: Implement the exact structured delta/risk/root-cause table, including high/critical/security/data-loss/uncovered-requirement guards, related-regression severity, mixed-root remaining findings, unrelated-baseline quarantine, and lane/policy floors. Preserve deterministic precedence and ordered enum rationale codes.

### BLOCKER — C-B4 — The recorded input digest cannot replay or audit the decision

- **Category**: Architecture / Security
- **Anchor**: REQ-DECISION-001 and REQ-DECISION-005 (`spec.md:45-46,69-70`); production/replay scenario (`spec.md:202-206`); Design decision-input boundary (`design.md:499`) and kernel-divergence response (`design.md:677`).
- **Evidence**: `inputDigest` hashes only `{ dossierDigest, mode }` (`execution-control-plane.ts:18`). Decision-driving authorization, destructive-Git state, terminal incident/governance result, governance policy/configuration, and a kernel/policy version are absent. The `replay()` closure captures `kernelInput`, including externally supplied optional incident/config objects, and re-evaluates them later (`execution-control-plane.ts:16-19`) rather than parsing a frozen canonical input. Every invalid dossier also receives the same constant digest (`execution-control-plane.ts:20-21`).
- **Independent reproduction**: The missing-authorization plan and explicit-invalid-authorization plan had identical `inputDigest` values but different actions (`advance_verification` versus `stop`).
- **Impact**: One recorded digest identifies multiple security-relevant outputs; mutation or policy drift can change replay; invalid executions are not distinguishable. The record therefore cannot prove deterministic production/replay equivalence.
- **Required change**: Define one canonical, validated, frozen, versioned kernel-input record whose digest covers every decision-driving value or immutable referenced digest. Replay must parse that captured record and compare an exact decision digest/action/rationale, not close over mutable caller objects.

### BLOCKER — C-B5 — Legacy repair governance and shadow composition are not integrated as designed

- **Category**: Architecture / Compatibility
- **Anchor**: EG3-T1 compatibility projection (`tasks.md:485-491`); EG3-T2 legacy composition (`tasks.md:516-518`); Design execution composition and shadow authority (`design.md:455`); Design repair-governance integration (`design.md:520-527`).
- **Evidence**: The required `adaptDossierToRepairIncidentV1()` symbol does not exist. `repair-loop-governance.ts` has no Batch C diff. The kernel applies terminal governance only when an already-constructed, unvalidated `incident` is manually supplied (`decision-kernel.ts:26-33`). `legacyInput` is optional (`execution-control-plane.ts:8,13`), so shadow mode need not compute a legacy plan at all. `legacy` mode still requires/parses a V1 dossier and evaluates the new kernel (`execution-control-plane.ts:14-19`) instead of providing the specified unchanged no-dossier legacy path. Shadow execution simply returns without any mechanism for the legacy plan to remain authoritative (`execution-control-plane.ts:25-29`).
- **Impact**: Budget/fingerprint terminal safety can be silently omitted; shadow cannot perform the required legacy/new comparison while retaining legacy authority; rollback semantics are not represented by the API.
- **Required change**: Add the approved compatibility projection and explicit mode composition. Keep `evaluateRepairIncident()` byte/behavior compatible, ensure terminal outcomes only increase restriction, preserve true legacy/no-dossier behavior, and make shadow always compare the same normalized kernel while only the existing legacy path controls effects.

### BLOCKER — C-B6 — Tests are too weak to qualify the authority boundary and encode one unsafe behavior

- **Category**: Test Quality / Maintainability
- **Anchor**: EG3-T1 and EG3-T2 evidence gates (`tasks.md:495-502,526-533`); Design test architecture (`design.md:689-705`).
- **Evidence**: The new kernel suite contains 3 tests/9 expectations; the control-plane suite contains 2 tests/5 expectations. Eight kernel assertions use partial `toMatchObject`, so they do not prove exact digest, full ordered rationale, terminal result, freshness, or decision shape. There are no fixtures for mixed precedence, high remaining risk, medium/high related regression, data loss, uncovered requirements, unrelated-baseline-only evidence, repeated fingerprint, exhausted budget, terminal override floors, review anchoring, batch mismatch, mutable replay input, legacy/no-dossier mode, adapter error behavior, or a production caller. The sole replay test evaluates the same in-memory argument twice. `execution-control-plane.test.ts:16-24` positively expects adapter invocation from the fixture whose lane is `shadowOnly=true`, thereby codifying C-B2.
- **Independent check**: Focused Batch C plus legacy-governance tests pass `34/34` with `88` expectations, showing these are oracle omissions rather than test-run instability. Serena reports no diagnostics in the five Batch C source/test files.
- **Impact**: The tests pass while the independent security reproductions above fail the specified safety behavior; regressions at the authority boundary would not be detected.
- **Required change**: Replace partial smoke coverage with the required exact table and boundary matrix. Evaluate every row twice, assert complete decision/digest/rationale output, exercise terminal budgets/fingerprints and precedence combinations, add a real production-caller test, and add negative tests proving zero calls for missing authority, shadow-only lanes, invalid evidence, stop/escalate/non-delegating actions, and scope-widening attempts.

## Requirement/Design Compliance

**Not acceptable for Batch C.** REQ-DECISION-005 is unimplemented in production (C-B1); REQ-ROLLOUT-002 safety floors are bypassable (C-B2); REQ-DECISION-002 unsafe-routing cases are wrong (C-B3); REQ-DECISION-001/005 replay identity is insufficient (C-B4); and accepted Design integration for legacy terminal governance is absent (C-B5). These are anchored MUST/accepted-Design failures, not preference findings.

## Decision/Replay Architecture

The kernel is side-effect-free and its returned contract is deep-frozen by `buildExecutionDecisionV1()`, which is a sound base. Complexity is linear in finding count and raises no performance concern at expected dossier sizes. However, the root-cause scan is not a complete decision table, the policy/version is not represented, and replay is an in-memory closure over incomplete inputs. C-B3 and C-B4 block approval.

## Safety/Shadow

Direct `shadow` mode makes zero adapter calls, and invalid parsed dossiers also make zero calls. Those properties are insufficient because active mode ignores a dossier's `shadowOnly` floor and treats missing authorization as allowed. The effect port is also broad enough to reinterpret non-delegating actions. C-B2 blocks approval.

## Compatibility/API

The existing `evaluateRepairIncident()` implementation and legacy governance tests remain unchanged; focused compatibility tests passed. Root exports are additive and the exact package-root oracle currently lists 61 keys. Nevertheless, the public control-plane API is easy to misuse, the required compatibility projection is absent, and `legacy|shadow|active` do not model the accepted semantics. C-B5 blocks approval; no legacy-output regression was independently found.

## Test Quality

Current tests are deterministic and fast but are smoke tests, not independent authority-boundary oracles. They omit most required rows and one test asserts unsafe active execution. C-B6 blocks approval.

## Maintainability

No dependency was added and the new files are small. The generic adapter request, optional safety booleans, mutable replay closure, optional legacy composition, and broad catch that collapses all kernel/parser faults into `invalid-evidence` create hidden coupling and poor failure attribution. These concrete risks are captured by C-B2, C-B4, and C-B5. No separate preference-only finding is raised.

## Scope Audit

The claimed Batch C product/test paths match the EG3 scopes: decision kernel, control-plane/port, additive legacy-pipeline/root exports, focused tests, and the exact export oracle. No registry coordinator, real OpenCode/Pi bridge, verification-lane scheduler, prompt authority, rollout implementation, dependency, generated output, build-info, historical archive, or excluded WIP was added by Batch C. The broader dirty worktree contains prior authorized Batch A/B and active OpenSpec material; none receives Batch C credit. The generic port itself is EG3-authorized, but its unsafe authority semantics are C-B2 rather than a scope-expansion finding.

## Artifact

`openspec/changes/developer-team-execution-convergence/review-batch-c.md`

## Artifact Evidence

- Official context reviewed: `tasks.md`, `spec.md`, `design.md`, `design-repair-batch-b.md`, `apply-progress.md`, `state.yaml`, `events.yaml`, and Batch B Gate Repair 4 Verify/Review closure reports.
- Source/tests reviewed: Batch C kernel, control plane, port, legacy pipeline export, package root, decision/dossier/delta/lane/repair-governance contracts and tests, plus the current worktree diff/scope.
- Structural evidence: code-graph inbound traces found no production caller for either Batch C runtime function; no `adaptDossierToRepairIncidentV1` symbol exists.
- Independent reproductions: missing authorization plus `shadowOnly=true` invoked once; explicit invalid authorization changed the action without changing input digest; a positive delta with one high-risk Full-SDD finding selected `targeted_repair`.
- Focused execution: `34 pass / 0 fail`, `88 expect()` calls across kernel, control-plane, and legacy-governance tests.
- Diagnostics: no Serena warnings/errors in the five reviewed Batch C source/test files.
- Adaptive context: Supermemory advisory recall was loaded; official OpenSpec artifacts, registry records, source, tests, and current bytes remained authoritative.
- Self-verified report byte count: `15951` bytes.

## Phase

`review`

## Status

`changes_requested`

## Registry Write

`deferred`

## Registry Intent

- **Phase**: `review`
- **Status**: `changes_requested`
- **Event**: `review.batch-c.failed`
- **Artifact**: `review-batch-c.md`
- **Provenance**: `deck-developer-review`; fresh independent Batch C review; registry-deferred; source/spec/design/task/current-diff evidence; 2026-07-16.

## Blockers

`C-B1`, `C-B2`, `C-B3`, `C-B4`, `C-B5`, `C-B6`.
