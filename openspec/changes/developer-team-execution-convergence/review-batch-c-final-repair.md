# Review Report: Batch C EG3-R1 Final Repair

## Summary

**Verdict: CHANGES_REQUESTED.** The final repair materially improves the previous state: the capability descriptor is now recomputed, valid active replay records are digest-checked, unsafe invalid dossier inputs receive bounded identities, shadow remains legacy-authoritative with no V1 effect, terminal restrictions are monotonic in the exercised cases, and the 68-case matrix is now executable rather than a label catalog. However, the public effect boundary still accepts a forged structural plan whose replay record is not canonical or self-verifying and delegates once. That is a blocking security defect. Three additional major correctness/architecture issues remain.

Actual runner-host reachability is intentionally deferred to Batch D under `HO-BC-TO-BD-HOST-REACHABILITY-v1`; it is neither counted as a Batch C defect nor credited as closed by exports or tests.

**Overall Rating:** REQUEST CHANGES  
**Scope:** general, backend, integration  
**Files reviewed:** 23 official artifacts, source modules, public exports, and tests

## Findings

### BLOCKER

#### BC-FR-01 / BC-HBR-01 — The effect boundary delegates from a forged plan without validating its canonical replay record

- **Category:** Security / Correctness / Integration
- **Files:**
  - `packages/sdd-runtime/src/execution/execution-adapter-port.ts:66-134`
  - `packages/sdd-runtime/src/execution/execution-control-plane.ts:355-461`
  - `packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts:251-293,694-700`
- **Evidence:** `executeTargetedRepairV1()` parses and recomputes the capability descriptor, but then trusts `plan.mode`, `plan.decision`, `plan.dossier`, and selected fields copied from `plan.replayRecord`. It never calls `replayExecutionDecisionV1()`, never verifies `plan.replayRecord.inputDigest`, and never proves that the plan decision/dossier are the decision/dossier represented by that record. The record parser that performs those checks exists at `execution-control-plane.ts:355-444`, but the effect path does not use it.
- **Independent reproduction:** A structurally forged plan with an `outcome: "valid"` replay object that omitted `schema`, `mode`, `policyVersion`, canonical dossier, terminal guard, and `inputDigest` was passed to the public effect function. With internally consistent attacker-chosen dossier/decision digests and a correctly recomputed descriptor digest, the result was `{ invoked: true }` and the capability call count was `1`.
- **Test gap:** The matrix observation helper always supplies `result.plan` produced by composition (`batch-c-authoritative-matrix.test.ts:251-271`). `C-EFFECT-01` mutates the capability and tests an unbound authentic plan, but never supplies a forged or digest-corrupted plan/replay record (`:694-700`). Thus the real boundary executes, but this adversarial boundary condition is absent.
- **Impact:** TypeScript structural typing is not a runtime trust boundary. A Batch D caller, compatibility consumer, or compromised adapter can bypass the canonical decision and cause a modifying capability invocation from attacker-assembled fields. Descriptor recomputation alone does not bind delegation to an authentic replayed decision.
- **Required change:** Parse and self-verify the complete plan/replay at `executeTargetedRepairV1()` entry. Derive the authoritative dossier and decision by replaying the canonical record, require exact record/plan/input/decision digest correspondence, then validate the bound descriptor. Any malformed, forged, or mismatched plan must return `invalid-evidence` or `modification-not-authorized` with zero calls. Add a public effect-boundary regression test using a malformed/forged record and a digest-corrupted authentic record.

### MAJOR

#### BC-FR-02 / BC-HBR-02 — Legacy replay records are emitted with a digest that cannot verify against their own canonical payload

- **Category:** Correctness / Compatibility
- **Files:**
  - `packages/sdd-runtime/src/execution/execution-composition.ts:122-138`
  - `packages/sdd-runtime/src/execution/execution-control-plane.ts:409-420`
  - `packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts:586-599`
- **Evidence:** Legacy composition hashes `{ schema, outcome, mode }`, then emits a replay record that also contains `policyVersion`. The replay parser recomputes the digest over `{ schema, outcome, mode, policyVersion }`. The producer and verifier therefore use different payloads.
- **Independent reproduction:** The emitted legacy `plan.inputDigest` was `sha256:164b711c225c750c65eb3af82642a698db4fbc534c53a90b3199d21088614786`; hashing the canonical emitted payload including `policyVersion` produced `sha256:6823a2add95d0424ed05eea2a21a96d21632826841a2874d6d502faa21341e3f`. They did not match.
- **Test gap:** `C-LEGACY-01` classifies digest verification as `not-applicable`, so it checks only digest shape and legacy output, not whether the emitted record self-verifies.
- **Impact:** The public compatibility record violates its own canonical digest contract. Future consumers cannot reliably distinguish a valid legacy record from a corrupt one, increasing migration and Hyrum's-law risk.
- **Required change:** Build legacy records through the same canonical record constructor/digest projection used by replay parsing, and add a self-verification assertion for the emitted legacy record without changing legacy pipeline behavior.

#### BC-FR-03 / BC-HBR-03 — Legacy admission silently accepts an incomplete mode contract

- **Category:** Correctness / Integration / Compatibility
- **Files:**
  - `packages/sdd-runtime/src/contracts/canonical.ts:17-20`
  - `packages/sdd-runtime/src/execution/execution-composition.ts:21-56,94-146`
  - `packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts:586-599`
- **Evidence:** `assertExactKeys()` rejects unknown keys but does not require allowed keys. The legacy branch validates only `dossier.kind` and then runs the legacy pipeline; it never validates the required `authority`, `gitSafety`, `governance`, or `effectBinding` discriminants declared by `DeveloperTeamExecutionCompositionInputV1`.
- **Independent reproduction:** A legacy input omitting all four fields was accepted as `legacy-authoritative`, returned the legacy `completed` outcome, and had no `invalid-evidence` reason.
- **Impact:** The runtime API and TypeScript contract disagree. Configuration mistakes are silently accepted at the host-facing boundary, and malformed legacy requests cannot be distinguished from deliberately explicit compatibility mode. Although this path has no V1 effect, it weakens fail-closed admission and makes rollout diagnostics unreliable.
- **Required change:** Validate the complete mode-specific discriminated shape before running legacy behavior. Legacy must require exact `not-applicable` authority/Git states, `governance: { kind: "none" }`, and `effectBinding: { kind: "none" }`; malformed inputs should return safe invalid evidence while valid legacy behavior remains unchanged.

#### BC-FR-04 — The control plane depends on the effect adapter, reversing the intended one-way boundary

- **Category:** Architecture / Maintainability
- **Files:**
  - `packages/sdd-runtime/src/execution/execution-control-plane.ts:27-30,311-332`
  - `packages/sdd-runtime/src/execution/execution-adapter-port.ts:10-13`
  - `packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts:340-345`
- **Evidence:** The control-plane module imports the descriptor parser and descriptor type from `execution-adapter-port.ts`, while the adapter imports `ExecutionPlanV1`/`GitSafetyStateV1` from the control plane. The adapter-side import is type-only, so this does not currently form a runtime initialization cycle, but it is still a bidirectional source dependency and places effect-port parsing inside the pure planning dependency chain. `C-ARCH-01` checks only whether the legacy orchestrator imports `../execution/`; it does not check this control-plane-to-adapter edge.
- **Impact:** Security-critical canonical planning cannot evolve independently from the effect adapter. A later runtime import added to the adapter can turn the latent source cycle into an initialization cycle, and the current structure contradicts the intended dependency direction.
- **Required change:** Move the capability descriptor contract, parser, and digest function to a neutral contract/control-plane-owned module. Both planning and the effect adapter should depend on that neutral module; the control plane must not import the effect adapter.

## Previous Blocker Disposition

| Previous blocker | Current disposition | Direct assessment |
|---|---|---|
| `BC-HBR-01 / C-R2` | **OPEN — BLOCKER** | Descriptor digest recomputation is fixed, and authority/Git matching is present, but delegation is not bound to a self-verified canonical plan/replay record (`BC-FR-01`). |
| `BC-HBR-02 / C-R4` | **PARTIAL — MAJOR remains** | Valid active records reject forged digests, and generated invalid identities exclude raw dossier values. The legacy producer/verifier digest mismatch remains (`BC-FR-02`). |
| `BC-HBR-03 / C-R5` | **PARTIAL — MAJOR remains** | Missing shadow legacy input is safely rejected, modifying shadow binding is invalid, shadow effects are zero, and exercised terminal outcomes are monotonic. Legacy admission still accepts omitted mandatory mode fields (`BC-FR-03`). |
| `BC-HBR-04 / C-R6` | **CLOSED for the original synthetic-oracle defect** | Exactly 68 unique `C-*` declarations exist, all in the authoritative matrix; no duplicate IDs, placeholder tokens, parameterized row loop, or missing shared full-contract assertion was found. Every row reaches effect observation, and helper-built effect cases construct composition internally. The matrix nevertheless lacks the adversarial plan/replay case needed to catch `BC-FR-01`. |

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ❌ Weak | Reverse control-plane→adapter dependency remains. |
| Security | ❌ Weak | Forged structural plans can reach a modifying capability. |
| Correctness | ❌ Weak | Legacy digest and admission contracts are inconsistent. |
| Scalability | ✅ Strong | Operations are bounded and linear over small evidence sets; no material hot-path issue found. |
| Maintainability | ⚠️ Adequate | Public surfaces are explicit, but boundary ownership and duplicated record construction need consolidation. |
| Code Quality | ⚠️ Adequate | Names are generally clear; security-critical validation is split across functions in a way that hides the effect-path gap. |
| Backend | N/A | No HTTP/database backend surface is involved. |
| Frontend | N/A | No frontend scope. |
| Integration | ❌ Weak | The effect seam does not authenticate its plan, and legacy runtime admission differs from its declared contract. |
| Economy / Critical Judgment | ✅ Strong | No unnecessary dependency or unrelated abstraction was introduced in the reviewed Batch C boundary. |

## Test and Check Evidence

- Focused command: `bun test packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts packages/sdd-runtime/src/execution/batch-c-matrix-audit.test.ts packages/sdd-runtime/src/execution/execution-composition.test.ts packages/sdd-runtime/src/execution/execution-control-plane.test.ts packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts`
  - Result: `86 pass / 0 fail`, 1,062 assertions, 5 files.
- Typecheck: `bunx tsc --noEmit`
  - Result: pass, zero diagnostics.
- Matrix semantic audit:
  - 68 `C-*` declarations total; 68 unique IDs; no duplicates.
  - Every row has one `assertBatchCContract()` call and reaches effect observation.
  - No `TODO`, `FIXME`, placeholder/fabricated catalog token, `test.each`, `describe.each`, `toMatchObject`, or scenario iteration was found.
  - Cases using `boundTargeted()` execute real composition internally; the helper does not fabricate the decision/effect observation.
- These green checks do not override `BC-FR-01`; the independent forged-plan reproducer exercised an input class absent from the committed matrix.

## Public API and Compatibility Assessment

- The package-root exact export oracle passed and the Batch C APIs are additive.
- `executeDeveloperTeamStepV1` and `runProductionExecutionDecisionPipelineV1` remain compatibility aliases; neither is credited as host reachability.
- Valid legacy pipeline output remains byte/behavior compatible in the exercised fixture.
- Adapter exceptions produce `adapter-error` with one call and no retry in `C-EFFECT-12`.
- Allowed/blocked target intersection and destructive exact-command matching are implemented and exercised.

## Open Questions / Assumptions

1. Is `ExecutionPlanV1` intended to be a trusted opaque capability rather than public structural input? The current public interface, runtime implementation, and repair design do not enforce opacity; this review therefore treats it as untrusted at the effect boundary.
2. The worktree has no repair-specific commit boundary. The current generated bundle hash matches the recorded value, but attribution of pre-existing uncommitted generated changes to a particular earlier batch cannot be independently reconstructed from Git alone.
3. Batch D host reachability and one-use authorization remain deliberately out of scope and open under `HO-BC-TO-BD-HOST-REACHABILITY-v1`.

## Residual Risks

- Batch D must still provide real runner-native reachability and atomic one-use authorization; this report does not evaluate or close either item.
- Compatibility aliases are observable public behavior and should be retained/deprecated deliberately to avoid accidental consumer breakage.
- The security-critical decision kernel remains dense; after the blocking boundary fixes, a no-behavior-change readability refactor would reduce precedence-review risk, but it is not required by this verdict.

## Artifact Discipline

- Review mode was read-only except for this new report.
- No source, test, generated output, prior report, `apply-progress.md`, `state.yaml`, or `events.yaml` was modified by Review.
- Current generated bundle SHA-256: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`, matching `apply-progress.md`.
- The generated bundle differs from `HEAD` (`2207ffc0cf845dc1a97ed6815990e38a57b1dff13b73871ceb4654855ec0748d`), consistent with pre-existing uncommitted work; no repair-specific attribution is claimed.
- No current worktree entry was found under `runner-capability-standardization`, `openspec/archive`, build-info generated output, or dependency lock/package metadata.
- Registry base hashes observed before report write:
  - `state.yaml`: `8a1bb55d51a62338950d57f90f940d44b6cad782abb8a10114850fc75b5202f9`
  - `events.yaml`: `b06dbea75ed6d7e069329235d9f2a3dca179d3925f112571e8c75352fa736945`

## Deferred Registry Intent

- **Registry write:** deferred; registry files were not modified.
- **Phase:** `review`
- **Status:** `changes_requested`
- **Event:** `review.batch-c.final-repair.failed`
- **Artifact:** `review-batch-c-final-repair.md`
- **Exact blocking set:** `{ BC-FR-01 / BC-HBR-01 }`
- **Required non-blocker changes:** `{ BC-FR-02 / BC-HBR-02, BC-FR-03 / BC-HBR-03, BC-FR-04 }`
- **Registry state path:** `openspec/changes/developer-team-execution-convergence/state.yaml`
- **Registry events path:** `openspec/changes/developer-team-execution-convergence/events.yaml`
