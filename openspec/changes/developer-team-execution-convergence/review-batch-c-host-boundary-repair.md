# Review Report: Batch C EG3-R1 Host-Facing Boundary Repair

## Verdict

**FAIL — REQUEST CHANGES.** Batch C does not fail because the Batch D runner bridge is absent; that reachability remains correctly deferred under `HO-BC-TO-BD-HOST-REACHABILITY-v1`. It fails because four concrete Batch C boundary defects remain: the effect boundary trusts a self-asserted capability digest, canonical replay accepts unsafe/unverified records, legacy/shadow/terminal composition is not fail-closed or restrictive-only, and the nominal 68-row matrix is a false-green synthetic oracle rather than the exact public-boundary matrix required by `REQ-CBC-007`.

**Overall Rating:** REQUEST CHANGES  
**Scope:** general, backend, integration  
**Blocking findings:** 4

## Findings

### BLOCKER — BC-HBR-01 / C-R2 — The effect boundary accepts a self-asserted capability digest

- **Category:** Security / Integration
- **Anchors:** `REQ-CBC-003(c)`; `design-repair-batch-c.md:271-309`; `tasks.md:499-502,511-512`.
- **Evidence:** `execution-adapter-port.ts:9` checks only that `authority.capabilityDigest === descriptor.capabilityDigest`; it never recomputes the descriptor digest with `capabilityDescriptorDigestV1()` before delegation. The descriptor's runner, invocation, batch, dossier, decision, target, and Git-effect fields are therefore not cryptographically bound to the accepted digest at this boundary.
- **Independent reproduction:** A descriptor declared `sha256:cccc...cccc`, while `capabilityDescriptorDigestV1()` recomputed `sha256:ce74151a749b0ff52bf9e5c858d1d0afd6f58b1c5b3dbd94096af187d8863994`. Supplying the declared digest in both the authority state and descriptor still returned `{ invoked: true }` and called the capability once.
- **Impact:** A caller can present a self-consistent but forged authority/descriptor pair. Batch D must add one-use authorization, but Batch C's own pre-delegation binding check is already mandatory and cannot defer this validation.
- **Required change:** Recompute and validate the complete descriptor digest before invocation; reject any mismatch with `modification-not-authorized` and zero calls. Add a real public effect-boundary test rather than a synthetic invalid-plan observation.

### BLOCKER — BC-HBR-02 / C-R4 — The all-input record and replay boundary are not safe or self-verifying

- **Category:** Security / Architecture
- **Anchors:** `REQ-CBC-002`, `REQ-CBC-005`; `design-repair-batch-c.md:166,201-255`; `tasks.md:498,503,517-518`.
- **Evidence:** `planExecutionDecisionV1()` in `execution-control-plane.ts:35` parses only the dossier. It copies authority, Git state, and effect binding directly into the replay record and hashes them without closed-shape validation. `replayExecutionDecisionV1()` at line 34 does not parse the record or verify `inputDigest`; it evaluates any object labeled as a valid record. The valid record also omits the safe legacy projection required by the repaired Design.
- **Independent reproductions:** (1) An extra `secret: "AUTHORITY_SECRET"` field on an otherwise accepted authority object was retained in serialized `replayRecord` and influenced its digest. (2) Replacing a valid record's `inputDigest` with `sha256:ffff...ffff` was accepted by `replayExecutionDecisionV1()` and returned `targeted_repair`.
- **Impact:** Unvalidated or secret-bearing host values can enter persisted identity, and forged replay records can produce authoritative-looking decisions. Replay cannot prove byte-stable all-input identity or legacy comparison continuity.
- **Required change:** Add exact runtime parsers for every composition/replay variant and every authority/Git/effect field; reject unknown keys and unsafe content before hashing. Verify the supplied replay digest over the canonical payload before evaluation, and include only the allowlisted safe legacy projection required by the repaired Design.

### BLOCKER — BC-HBR-03 / C-R5 — Legacy/shadow admission and terminal composition violate fail-closed ordering

- **Category:** Architecture / Compatibility / Security
- **Anchors:** `REQ-CBC-006(a-d)`; `design-repair-batch-c.md:168-176,257-269`; `tasks.md:504,520-521`.
- **Evidence:** `composeDeveloperTeamExecutionV1()` (`execution-composition.ts:11`) calls `runOrchestratorPipeline(input.legacyInput)` before validating the host-facing composition record. A shadow call with omitted `legacyInput` throws instead of returning safe `invalid-evidence`. The shadow/active union at lines 7-9 permits a targeted-repair descriptor in shadow, while `comparison` records only `v1Action` and `inputDigest`, not a redacted legacy-vs-new projection. The required `resolveTerminalGovernanceGuardV1()` symbol is absent. In `decision-kernel.ts:75-80`, an `escalate` terminal guard unconditionally changes a base authorization `stop` into `escalate`, reducing restrictiveness.
- **Independent reproductions:** Missing shadow `legacyInput` escaped as `TypeError: undefined is not an object (evaluating 'input.auditType')`. A missing-authority base decision was `stop`, but the same input with terminal guard `{ outcome: "escalate" }` returned `escalate` with `['AUTHZ_MISSING', 'TERMINAL_ESCALATE']`.
- **Impact:** Malformed host input can escape the public boundary, shadow comparison is incomplete, and terminal governance can weaken the permanent authority floor.
- **Required change:** Parse the complete mode-discriminated input before invoking legacy code; make malformed input total and non-throwing; require `effectBinding.kind === "none"` in shadow; record a redacted safe legacy comparison; and implement one restrictive mapping that preserves an existing `stop` and never lowers any authority/Git/security/Full-SDD floor.

### BLOCKER — BC-HBR-04 / C-R6 — The 68 named tests are synthetic false-green rows, not the required exact matrix

- **Category:** Test Quality / Maintainability / Integration
- **Anchors:** `REQ-CBC-007`, `REQ-CBC-008`; `design-repair-batch-c.md:498-569`; `tasks.md:505-506,523-524,535-550`.
- **Evidence:** `batch-c-authoritative-matrix.test.ts` has 68 names and 68 calls to `assertBatchCContract()`, but most rows construct an unrelated kernel decision or a fabricated `invalid()` observation. They do not invoke the public composition/replay/effect path named by the row. Examples:
  - `C-GIT-06` claims a permitted invocation but expects effect count `0` and never calls `executeTargetedRepairV1()`.
  - `C-RISK-04` passes the string `"data-loss"` to the invalid classifier instead of constructing and routing a data-loss finding.
  - `C-ROUTE-08` and `C-ROUTE-09` expect `targeted_repair`, not `advance_verification` and `complete`.
  - `C-TERM-03` through `C-TERM-06` supply no repair incident and expect terminal `permit` rather than checkpoint/replan/escalate/stop composition.
  - `C-LEGACY-01` fabricates `invalid-evidence`; `C-SHADOW-02`/`03` never call composition and report legacy `not-applicable`.
  - `C-EFFECT-01` through `03` and `12` never call the effect boundary.
- **Replay oracle defect:** `observe()` assigns the decision digest to both `inputDigest` and `replayDigest`; `assertBatchCContract()` then compares those supplied strings. It does not call replay or compare a canonical input digest with replayed decision output.
- **Structural handoff defect:** Both `C-ARCH-03` tests pass without inspecting a caller graph or `HO-BC-TO-BD-HOST-REACHABILITY-v1`. One only checks that the composition function exists; the other evaluates an ordinary kernel decision. Thus a wrapper-only state remains green.
- **Fresh execution:** The focused six-file suite passed `169/169` with `609` assertions. That green result coexists with all three independent boundary reproductions above, proving oracle inadequacy rather than runtime instability.
- **Required change:** Replace each row with a literal, individually named call through its actual public boundary and assert exact action, full ordered rationales, canonical digest plus real replay, terminal guard, authority/Git reason, legacy authority, and actual capability call count/target. Make `C-ARCH-03` inspect non-test callers or the exact open Batch D handoff and fail on an export/test wrapper alone.

## Finding Disposition C-R2–C-R6

| Prior finding | Disposition | Evidence |
|---|---|---|
| `C-R2` — authority/Git fail-open | **OPEN / BLOCKER** | Missing and explicit invalid states now stop, and destructive command matching exists, but the tool-capable boundary accepts a self-asserted capability digest (`BC-HBR-01`). |
| `C-R3` — data-loss/protected-risk routing | **CLOSED BY SOURCE, TEST PROOF DEFECTIVE** | `classifyProtectedRiskV1()` is shared by delta and kernel and includes data loss, security, high/critical, authorization/Git, and uncovered requirements. No routing defect was reproduced; the claimed exact rows remain invalid under `C-R6`. |
| `C-R4` — invalid identity/replay | **OPEN / BLOCKER** | Dossier invalid classification is bounded, but other all-input fields are unvalidated and secret-bearing values persist; forged replay digests are accepted (`BC-HBR-02`). |
| `C-R5` — shadow/legacy/terminal composition | **OPEN / BLOCKER** | Legacy mode exists and shadow does not directly invoke effects, but malformed shadow input throws, safe legacy comparison is absent, and terminal escalation weakens authorization stop (`BC-HBR-03`). |
| `C-R6` — exact acceptance matrix | **OPEN / BLOCKER** | The file contains exactly 68 names, but the rows are synthetic and do not execute or assert the named boundary behavior (`BC-HBR-04`). |

## Batch D Handoff Status

**Correctly deferred and still open; no failure is assigned for the missing bridge.** `spec-repair-batch-c.md` defines `HO-BC-TO-BD-HOST-REACHABILITY-v1` and `RQH-BC-001`–`003`; `tasks.md:665-674` makes those requirements mandatory before EG4-T2 completion. Static and graph inspection found no non-test caller of `composeDeveloperTeamExecutionV1()` and no caller of `executeTargetedRepairV1()`, which is acceptable for Batch C only because the handoff is explicit. No OpenCode/Pi bridge or invocation-authorization service was implemented, so Batch C does not falsely claim Batch D reachability and contains no Batch D implementation leakage.

The handoff's artifact-level gate is enforceable, but the required Batch C structural regression test is not: current `C-ARCH-03` checks neither the handoff ID nor non-test caller connectivity. This is part of `BC-HBR-04`, not a demand to implement Batch D early.

## Security

**Weak / blocking.** The narrow targeted-repair capability and explicit authority/Git unions are improvements. However, self-asserted capability binding, unsafe authority data in canonical identity, forged replay acceptance, and terminal weakening of an authorization stop prevent approval.

## Routing/Safety

**Partially strong, still blocked by composition.** The shared protected-risk classifier closes the original data-loss predicate divergence and remains linear in finding count. Missing/invalid authority and Git states have stable base rationales. Terminal composition can nevertheless downgrade `stop` to `escalate`, and the exact routing matrix does not exercise its claimed cases.

## Host Boundary/Replay/Legacy

**Weak / blocking.** Dependency direction is one-way: the legacy orchestrator imports no `execution/` module, while composition depends on the unchanged legacy pipeline. The boundary is not total for malformed host input, replay is not self-verifying, valid identity omits the safe legacy projection, and shadow comparison does not capture a redacted legacy-vs-new result.

## Test Quality

**FAIL.** Exactly 68 test declarations exist, with no parameterized test loop, `toMatchObject`, or broad `toThrow` in the authoritative matrix. Naming/count discipline alone is insufficient: many rows assert fabricated observations unrelated to their title. The catalog audit checks source text and field labels, not behavior. Focused green output therefore provides stability evidence but not Batch C acceptance evidence.

## Compatibility/Maintainability

- Existing `runOrchestratorPipeline()` and `evaluateRepairIncident()` behavior remains available; focused legacy/governance tests are green, and package-root changes are additive.
- No dependency or material performance regression was found. Delta/routing operations are bounded by dossier size and remain effectively linear aside from deterministic sorting/hashing.
- Maintainability is weak: security-critical source and acceptance fixtures are compressed into long one-line functions, obscuring validation order and making the false-oracle substitutions difficult to review. The exact export test name still says `61` while its literal surface is larger. These readability issues are non-blocking relative to the concrete defects above.

## Scope Audit

**PASS.** Current Batch C implementation paths are within the repaired EG3-R1 file map. No runner-native bridge, invocation-authorization service, adapter bootstrap, registry coordinator, prompt/lane rollout, dependency, generated/build-info output, historical archive, or `runner-capability-standardization` WIP was added by this repair. The broader dirty worktree contains prior Batch A/B and OpenSpec changes; none receives Batch C credit.

## Artifact

`openspec/changes/developer-team-execution-convergence/review-batch-c-host-boundary-repair.md`

## Artifact Evidence

- Official artifacts reviewed: `spec.md`, `design.md`, `tasks.md`, `spec-repair-batch-c.md`, `design-repair-batch-c.md`, `repair-incident.md`, `apply-progress.md`, relevant `state.yaml`/`events.yaml` entries, and all four prior Batch C Verify/Review reports.
- Source reviewed: decision kernel, shared protected-risk classifier, failure delta, legacy orchestrator, repair governance, control plane, composition boundary, effect port, and package exports.
- Tests reviewed: authoritative 68-row matrix, matrix audit, shared assertions, composition, control plane, kernel, governance, and exact root export oracle.
- Fresh focused run: `169 pass / 0 fail`, `609` assertions across six Batch C files.
- Independent effect reproducer: mismatched declared/recomputed capability digest still invoked once.
- Independent replay reproducer: secret-bearing authority data persisted; a forged replay digest still returned `targeted_repair`.
- Independent composition reproducer: missing shadow legacy input threw; terminal escalation changed authorization `stop` to `escalate`.
- Caller/scope audit: only a test calls composition; no non-test host caller exists; no Batch D bridge/service implementation exists.
- Adaptive context was not loaded, preserving this review's fresh independence; official OpenSpec, source, tests, and current worktree evidence were sufficient.
- Registry-deferred discipline: this Review writes only this artifact.

## Phase

`review`

## Status

`changes_requested`

## Registry Write

`deferred`

## Registry Intent

- **Phase:** `review`
- **Status:** `changes_requested`
- **Event:** `review.batch-c.host-boundary-repair.failed`
- **Artifact:** `review-batch-c-host-boundary-repair.md`
- **Provenance:** `deck-developer-review`; model `openai/gpt-5.6-sol`; fresh independent final Batch C EG3-R1 host-boundary review; registry-deferred; official artifact, current source/test/diff, focused test, graph/static caller, scope, and independent reproducer evidence; 2026-07-16.

## Blockers

`BC-HBR-01 / C-R2`, `BC-HBR-02 / C-R4`, `BC-HBR-03 / C-R5`, `BC-HBR-04 / C-R6`.
