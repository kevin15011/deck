# Spec Replan G1: Deterministic Apply → Verify → Review Flow

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `spec` |
| Instance provenance | bounded Spec replan instance; distinct from the original Spec instance and from the recorded Apply, Verify, and Review instances of G1 |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized action | bounded Spec replan authorized by the user's new message after G1 two-attempt repair governance was exhausted |
| Artifacts modified | `openspec/changes/deterministic-apply-verify-review-flow/spec.md` only |
| Artifacts written | `openspec/changes/deterministic-apply-verify-review-flow/spec-replan-g1.md` only |
| Status | `completed` (replan). G1 blockers resolved at the requirement (WHAT) level; Design+Task reconciliation and a newly authorized, scoped batch remain the only gates to any further modification. |
| Action | `stop_and_replan_handoff` — no modifying attempt is authorized by this replan. A third blind G1 repair is explicitly prohibited; a newly authorized, scoped batch is required only after Design+Task reconciliation against the revised spec. |
| Next stage | Design/Tasks reconciliation against the revised `spec.md` (digested below), then a new authorized batch via the normal OpenSpec workflow. `G2_apply` remains blocked. |
| Blockers resolved at requirement level | 3 (`REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY`, `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY`, `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY`) |
| Blockers remaining | None new. Design/Tasks reconciliation and a newly authorized, scoped batch are the only outstanding gates for any further modification; they are NOT resolved by this replan. |
| FailureManifestV1 | present below |
| Ordered RegistryIntentV1 values | `[]` |

This replan defines WHAT must hold, not HOW to implement it. It defines no code structure, file layout, public interface, library, or task routing. It preserves every prior requirement and every V1 compatibility and safety floor; the six added requirements are stricter authority floors only.

## Scope authority and write boundary

- **Official context used:** `proposal.md`, `exploration.md`, `spec.md` (prior), `design.md`, `tasks.md`, `repair-incident.md`, `review-g1.md`, `review-g1-repair-2.md`, `verify-g1.md`, `verify-g1-repair-1.md`, `verify-g1-repair-2.md`, and promoted specs (`adaptive-quality-control`, `artifact-state-contracts`, `runner-orchestration-resilience`).
- **Adaptive context:** not loaded; this decision uses official OpenSpec artifacts and the recorded G1 governance evidence only.
- **Write boundary:** this replan modified only `spec.md` and wrote only `spec-replan-g1.md`. It modified no source, test, generated output, registry YAML, `state.yaml`, `events.yaml`, other change, or `runner-capability-standardization` target. Pre-report `git status` showed no tracked or staged diffs; the only untracked source/test targets are the eight G1 source/test files, which were not touched by this replan.

## Immutable evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| `spec.md` (prior, before replan) | `sha256:55b388b463dcc37c4ee59f3018a4714025de980001ff44fabe859b8e2df500b3` |
| `spec.md` (revised, after replan) | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| `design.md` | `sha256:4b61d78ab9d698744946b329e43367383fe0184dc218d270e541b408d6657207` |
| `tasks.md` | `sha256:e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510` |
| `proposal.md` | `sha256:2b3c63a2bceaa06a8449c68d7ac080eee5724793a4060a9e5c4380a8a01e1ba1` |
| `repair-incident.md` | `sha256:5a6fe88506f0623793462c0656180200ed14991ef3e73be87fec460732ccef1a` |
| `review-g1.md` | `sha256:c628595de8398a6e1afa8529e7b4b05cc303adb111c9fb354805e47a88b31b00` |
| `review-g1-repair-2.md` (terminal Review evidence) | `sha256:5a3588e7a402f38138117ad3314f1f687e9637cf275852f5e9ebdd42907c4695` |
| `verify-g1-repair-2.md` | `sha256:38ee868900c4854f02fc90f8aef8e4ca62aeb6ff506c011af21be8409983ee02` |
| Replan decision digest | `sha256:6fbc9c4efd762dedded4793a6cf57aecbf7b92350bb9dce587404af3f6764be1` (deterministic digest of change ID + prior spec digest + revised spec digest + the three blocker fingerprints + repository HEAD) |

## G1 governance state consumed

| Item | Value |
|---|---|
| G1 repair attempts authorized | 2 |
| G1 repair attempts consumed | 2 |
| Terminal Review result | `request_changes` / `stop_and_replan` (see `review-g1-repair-2.md`) |
| Terminal Review blockers | `REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY`, `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY`, `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY` |
| `G2_apply` | blocked throughout |
| Repair-incident status | Blocked — both permitted G1 repair attempts are consumed |

The two-attempt repair budget is exhausted. This replan does not extend, reopen, or convert that budget into an authorize-anyway path.

## Three critical blockers resolved as verifiable requirements

### B1 — Protected-risk authority (`REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY`)

- **Reproduction (from `review-g1-repair-2.md`):** the disposition classifier's mandatory decision uses only caller-supplied requirement/task/check lists and ignores authoritative protected-risk evidence (security root cause and `isSecurityRelevant`). An advisory check policy can downgrade a protected-risk finding to `recommendation`; caller false/omitted risk flags can route an anchored protected-risk `implementation` finding to `targeted_repair`.
- **Required boundary (from Review):** protected-risk classification must be derived from authoritative per-finding evidence and mandatory safety policy, must dominate advisory/defer classification and repair routing, and must be recomputed at parse/decision boundaries; caller false/omitted overrides must never downgrade authoritative risk.
- **Resolved as new requirements:** `REQ-DAVR-FD-03` (protected-risk evidence is a mandatory authoritative classification input) and `REQ-DAVR-SEC-03` (protected-risk dominance is recomputed at every decision boundary and is immune to caller override). Anchors to existing `REQ-DAVR-FD-01`, `REQ-DAVR-RD-01`, `REQ-DAVR-SEC-02`, and `REQ-DAVR-IEV-01`.
- **New scenarios:** FD-03 has 3 scenarios (security-under-advisory, omitted-flag data-loss, conflicting evidence); SEC-03 has 3 scenarios (recompute-at-parse, forged-downgrade-rehash rejection, omitted-flag cannot authorize targeted repair).
- **Resolution status:** resolved at the WHAT level. Each scenario is independently reproducible against authoritative inputs; a caller-override downgrade and a forged downgrade rehash are explicitly testable as rejected.

### B2 — Retry-identity authority (`REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY`)

- **Reproduction (from `review-g1-repair-2.md`):** `computeRetryIdentity()` omits selected findings' oracle IDs and mandatory verification-plan check IDs and hard-codes the routing policy version instead of deriving it from current authority. Parsing only asserts the identity is digest-shaped. Effect validation recomputes anchors/targets/checks/obligations/evidence but never recomputes or compares `retryIdentity`. A validly rehashed projection with a replaced identity (and attempt counter) passed the effect boundary.
- **Required boundary (from Review):** one authoritative retry-identity projection containing every Spec/Design field, expose the actual policy version, recompute exact equality at parse/effect consumption; attempt and prior-attempt bindings validated against the current convergence ledger before effect authorization.
- **Resolved as new requirements:** `REQ-DAVR-RG-05` (retry identity is complete and derived from current authoritative policy) and `REQ-DAVR-MD-03` (retry identity and attempt bindings are recomputed and equal-verified at parse and effect boundaries). Anchors to existing `REQ-DAVR-RG-01`, `REQ-DAVR-CS-01`, `REQ-DAVR-MD-01`, `REQ-DAVR-MD-02`, and `REQ-DAVR-IEV-01`.
- **New scenarios:** RG-05 has 3 scenarios (identity includes oracle/verification-plan check IDs, policy version derived from current authority, completeness change creates new identity); MD-03 has 3 scenarios (forged identity rejected at parse, forged identity rejected at effect boundary, detached attempt binding rejected).
- **Resolution status:** resolved at the WHAT level. A forged/replaced identity and a detached attempt binding are explicitly testable as rejected fail-closed.

### B3 — Convergence authority (`REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY`)

- **Reproduction (from `review-g1-repair-2.md`):** non-modifying transitions accept a different `implementationSubjectDigest` while inheriting or accepting opaque scoped/Review/broad digests; no equality guard binds evidence to current subject or generation. A subject change across `review_stable`, `broad_accepted`, and `registry_committed` still reached `complete`. Separately, `appendExecutionConvergenceRevisionV1()` accepts an arbitrary caller-provided state without proving it is the output of a valid predecessor transition, and `parseExecutionConvergenceDossierV1()` validates hashes/history but not state transitions; a revision jumped from `awaiting_apply_result` to `complete` and parsed.
- **Required boundary (from Review):** bind every accepting event to stage-typed current-generation evidence whose dependency/subject digest equals current state; reject subject changes on non-modifying events unless dependency invalidation is applied; validate every persisted revision's state transition against its predecessor; arbitrary `complete` state append/rehash fails closed.
- **Resolved as new requirements:** `REQ-DAVR-BV-03` (accepting convergence events bind to stage-typed current-generation evidence with matching dependency/subject digest) and `REQ-DAVR-REG-03` (persisted convergence revisions are state-transition-validated; arbitrary complete append fails closed). Anchors to existing `REQ-DAVR-BV-02`, `REQ-DAVR-RV-01`, `REQ-DAVR-RV-02`, `REQ-DAVR-REG-02`, and `REQ-DAVR-IEV-01`.
- **New scenarios:** BV-03 has 3 scenarios (subject drift on non-modifying events blocks advancement, subject change requires explicit invalidation, opaque inherited evidence blocks completion); REG-03 has 3 scenarios (jump-to-complete rejection, out-of-table transition rejection, commit-readiness requires transition authority).
- **Resolution status:** resolved at the WHAT level. Subject drift, arbitrary complete append/rehash, and opaque inherited evidence are explicitly testable as rejected fail-closed.

## Preservation of prior requirements and safety floors

- All 42 prior requirements and 83 prior scenarios are preserved verbatim; no prior requirement text was weakened, merged, or removed.
- V1 compatibility floors (`REQ-DAVR-COMP-01`, `REQ-DAVR-COMP-02`) are unchanged.
- Safety floors (`REQ-DAVR-SAF-01`..`SAF-04`) are unchanged; the additions are stricter authority floors only and explicitly MUST NOT weaken compatibility, safety, or destructive-operation protections.
- Secrecy/evidence safety (`REQ-DAVR-SEC-01`, `REQ-DAVR-IEV-01`, `REQ-DAVR-IEV-02`) is unchanged and the new recompute/equal-check requirements extend fail-closed behavior, not bypass it.
- Excluded scope (`REQ-DAVR-SAF-04`, `runner-capability-standardization`) is unchanged; no requirement widens the worktree target allowlist or the eight G1 source/test targets.

## Mandatory next-step authority boundary

1. **Third blind G1 repair is prohibited.** The exhausted two-attempt G1 repair budget is not extended, reopened, or converted into an authorize-anyway path by this replan or by any prompt text. No third G1 modifying attempt may proceed without the boundary below.
2. **A newly authorized, scoped batch is required, and only after Design+Task reconciliation** against the revised `spec.md` (digest `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`). Design (`design.md`) and Tasks (`tasks.md`) MUST be updated to incorporate `REQ-DAVR-FD-03`, `REQ-DAVR-SEC-03`, `REQ-DAVR-RG-05`, `REQ-DAVR-MD-03`, `REQ-DAVR-BV-03`, and `REQ-DAVR-REG-03` into their disposition, routing, projection, and convergence models and into the task allowlists. Spec/Design/Tasks reconciliation is a hard prerequisite to any new modifying Apply, per the existing reconciliation contract recorded in `design.md`. Open question OQ-11 is added to Design to drive this reconciliation.
3. **Reconciliation must not leak HOW into Spec.** Design defines the authoritative source fields, policy-version derivation, and the state-transition validation model; the Spec only fixes the observable WHAT and the fail-closed authority floor.
4. **Scope ceiling preserved.** No requirement here authorizes widening the worktree target allowlist, the eight G1 source/test targets, the change-local OpenSpec directory, any other change, or `runner-capability-standardization`.

## Artifact counts after replan

| Item | Before | After |
|---|---|---|
| Capability areas | 18 | 18 (unchanged) |
| Requirements | 42 | 48 (+6: FD-03, SEC-03, RG-05, MD-03, BV-03, REG-03) |
| Given/When/Then scenarios | 83 | 101 (+18: 3 per new requirement) |
| Open questions | 10 | 11 (OQ-11 added) |

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": []
}
```

This replan produced no new blocking findings. The three G1 reproduction classes are recorded above as resolved at the requirement (WHAT) level and converted into six verifiable authority-floor requirements. The prior G1 failure manifests in `review-g1.md`, `review-g1-repair-2.md`, and `repair-incident.md` remain the authoritative record of the exhausted G1 repair loop; they are not re-emitted here.

## RegistryIntentV1

```json
[]
```

In centralized mode, the Spec phase produces no commit-ready intents and writes no `state.yaml` or `events.yaml`. The replan emits no registry intent and authorizes no registry mutation.

## Explicit blockers and exact next action

- **Spec blockers:** none. The three critical G1 reproduction classes are resolved as requirements.
- **Engineering blockers (gates, not findings):** Design/Tasks reconciliation against the revised `spec.md`, and a newly authorized, scoped batch issued via the normal OpenSpec workflow. A third blind G1 repair is explicitly prohibited.
- **Exact next action:** the coordinator must keep `G2_apply` blocked, emit no registry commit from this replan, route to Design/Tasks reconciliation (driven by OQ-11), and require a new human-approved bounded batch identity before any further modifying attempt. This replan does not authorize repair-3, source/test modification, registry mutation, or scope expansion.