# Preconditions: Deterministic Apply → Verify → Review Flow

## Change identity

- **Change ID:** `deterministic-apply-verify-review-flow`
- **Execution mode:** Automatic
- **Phase:** tasks

## Precondition assessment

### External / User Preconditions

| Condition | Status | Notes |
|-----------|--------|-------|
| Spec SHA-256 matches authoritative artifact | **SATISFIED** | `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` — confirmed against design-replan-g1.md authoritative binding |
| Design SHA-256 matches authoritative artifact | **SATISFIED** | `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` — confirmed against design-replan-g1.md authoritative binding |
| Design decisions complete | **SATISFIED** | All 11 Spec OQs (OQ-1..OQ-11) resolved; design.md OQ table fully resolved |
| Proposal approved | **SATISFIED** | `proposal.md` exists and authorized Spec + Design to proceed |
| Exploration complete | **SATISFIED** | `exploration.md` complete; B1–B6 identified and addressed by Spec/Design |
| User authorized this change | **SATISFIED** | Explicit user request for `deterministic-apply-verify-review-flow` in Automatic mode |
| OpenSpec initialized | **SATISFIED** | `openspec/config.yaml` initialized: `initialized: true` |
| Baseline ledger present | **SATISFIED** | `openspec/baseline-health.yaml` exists with exact known failure fingerprint |
| Registry schema present | **SATISFIED** | `openspec/registry-schema.md` exists and defines centralized lifecycle |
| Promoted specs available | **SATISFIED** | `adaptive-quality-control`, `artifact-state-contracts`, `runner-orchestration-resilience` all referenced and accessible |
| No `runner-capability-standardization` dependency | **SATISFIED** | Explicitly excluded by exploration, proposal, spec, and design |

### Runtime / Repository Preconditions

| Condition | Status | Notes |
|-----------|--------|-------|
| Worktree clean (or Git discard protection satisfied) | **VERIFY BEFORE APPLY** | Pre-batch gate classifies own-change untracked planning artifacts as **expected** and **not a discard reason**. Expected untracked: `openspec/changes/deterministic-apply-verify-review-flow/**` (tasks.md, preconditions.md, design.md, spec.md, exploration.md, proposal.md) and any companion planning artifacts under `openspec/changes/deterministic-apply-verify-review-flow/`. The gate **blocks**: (1) any modified tracked source/test/config file unrelated to the current change; (2) any untracked file outside `openspec/changes/deterministic-apply-verify-review-flow/`; (3) any generated output file (`*.generated.ts`, `build-info.generated.ts`, etc.). Git discard safeguards (git-safety.ts protocol) remain in force for all destructive operations. |
| Existing V1 contracts readable | **SATISFIED** | `failure-manifest.ts`, `apply-batch.ts`, `execution-dossier.ts`, `execution-decision.ts` all readable |
| Existing orchestrator policy readable | **SATISFIED** | `decision-kernel.ts`, `failure-delta.ts`, `staged-verification.ts`, `freshness-policy.ts`, `repair-loop-governance.ts` all readable |
| Execution control plane readable | **SATISFIED** | `execution-control-plane.ts` readable |
| Registry coordinator readable | **SATISFIED** | `registry-coordinator.ts` readable |
| Canonical prompt sources readable | **SATISFIED** | All 6 `*-content.ts` files readable |
| Existing test infrastructure | **SATISFIED** | Bun test runner available; existing test files readable as oracle |
| TypeScript compiler available | **SATISFIED** | `tsc --noEmit` available per `openspec/config.yaml` |

### Authorization Preconditions

| Condition | Status | Notes |
|-----------|--------|-------|
| No target intersection with another active OpenSpec change | **VERIFY PER TASK** | Must be checked at each batch issuance; no known intersection identified in tasks |
| No target intersection with `runner-capability-standardization` | **SATISFIED** | Hard exclusion confirmed in all artifacts |
| No historical OpenSpec change target conflict | **SATISFIED** | `developer-team-execution-convergence/**` is read-only evidence; not a modification target |
| Generated files not in any target allowlist | **SATISFIED** | Generated files are downstream effects only; explicitly blocked in all task target lists |

### Spec Digest Precondition for Apply

> **CRITICAL**: The Spec SHA-256 `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` must be confirmed **immediately before** the first Apply batch is issued. If the spec.md artifact has been modified (even whitespace), reconciliation is required before any modifying batch is authorized.
>
> **ALSO REQUIRED**: Design SHA-256 `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` must be confirmed immediately before any modifying batch is issued.
>
> **RECOVERY BATCH CEILING (G1)**: The recovery batch `deterministic-apply-verify-review-flow-recovery-batch-g1` is bounded to exactly 8 files (4 source + 4 test). No index, fixture, orchestrator, execution, adapter, prompt, generated, config, registry YAML, other OpenSpec change, or historical target may be added.
>
> **PROPOSED EFFECT-AUTHORITY RECOVERY BATCH**: A new proposed batch `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` is defined in `tasks-replan-effect-authority.md`. This batch **requires named human approval** before any modifying attempt. Spec/Design replan is NOT required — Review confirmed the revised Spec and Design already require the missing boundaries. The proposed batch ceiling is exactly 8 files (4 source + 4 test), same as the G1 recovery batch.

---

## Conclusion

**Unresolved external/user preconditions: None**

All inputs required to begin Task reconciliation are present and satisfied. The sole remaining precondition checks are:

1. **Before recovery batch issuance**: Confirm spec.md SHA-256 matches `374a8fb1...` AND design.md SHA-256 matches `a2873999...`.
2. **Before each Apply batch**: Confirm no target allowlist intersects `runner-capability-standardization` or any other active OpenSpec change.
3. **Before each Apply batch**: Confirm worktree policy — own-change untracked planning artifacts (`openspec/changes/deterministic-apply-verify-review-flow/**`) are expected; block unrelated tracked modifications, unrelated untracked files, and generated outputs; Git discard safeguards preserved.
4. **Before repository-wide test**: Confirm `openspec/baseline-health.yaml` known failure fingerprint matches and no additional failures exist.
5. **Before any modifying attempt**: Confirm a new explicit human-approved batch identity has been issued through the normal OpenSpec workflow.
6. **Before proposed effect-authority batch attempt**: Confirm named human approval for proposed batch `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`; Spec/Design replan is NOT required per Review verdict.

---

## Phase Result Data

- **Status:** `preconditions_reassessed`
- **Unresolved external preconditions:** none
- **Verifiable preconditions before Apply:** 6 (spec digest, design digest, target exclusion, worktree clean, human batch approval, named human approval for proposed effect-authority batch)
- **Blockers to Tasks:** none
- **Blockers to Apply (beyond Tasks completion):** spec SHA-256 drift, design SHA-256 drift, target intersection, worktree state, baseline regression, missing human batch approval, missing named human approval for proposed effect-authority batch `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`
- **Recovery batch ceiling (G1):** exactly 8 files (4 source + 4 test); G2 BLOCKED; repair-3 PROHIBITED
- **Proposed effect-authority batch:** `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` — bounded to exactly 8 files (same ceiling as G1); **NOT APPROVED** — requires named human approval
- **Spec/Design replan required for effect-authority:** NO per Review verdict in `review-recovery-g1.md`

(End of file — total lines: ~75)
