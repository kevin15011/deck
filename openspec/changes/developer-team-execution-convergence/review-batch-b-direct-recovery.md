# Batch B Direct-Recovery Review: Developer Team Execution Convergence

## Verdict

**FAIL — REQUEST CHANGES.** The direct recovery retains blocking FailureDelta authority/algebra defects, cannot advance a dossier beyond revision 2, and does not provide the required exact public-entrypoint acceptance matrix. Focused tests pass, but independent adversarial cases reproduce the defects below.

**Scope:** general, backend, integration  
**Mode:** registry-deferred; this report is the only repository write  
**Adaptive context:** loaded as advisory context; all conclusions below are based on official artifacts, current source/tests/diff, and independent execution.

## Ratings

| Dimension | Rating | Evidence-based assessment |
|---|---|---|
| Architecture | ❌ Weak | Public parsing can trust self-authored delta algebra, and revision validation cannot support the designed append-only chain. |
| Security | ⚠️ Adequate | Secret/JWT/PEM rejection is materially improved, but untrusted delta authority can still influence routing. |
| Scalability | ⚠️ Adequate | Operations are bounded by existing contract limits; no material new hot-path concern was found. |
| Maintainability | ❌ Weak | Dense one-line algebra and dormant matrix metadata obscure missing invariants and allowed these defects through green tests. |
| Code Quality | ❌ Weak | The implementation and tests claim complete matrices while omitting required branches and leaving unused test-case tables. |
| Backend / Integration | ❌ Weak | Delta and dossier contracts are integration authority boundaries; both retain reproducible invalid behavior. |
| Economy / Critical Judgment | ⚠️ Adequate | No dependency or unnecessary abstraction was added, but concision materially reduced reviewability in the affected trust kernel. |

## Findings

### BLOCKER — B-B2-RISK-PRECEDENCE-OMITS-MEDIUM-LOW-v1

- **Category:** Architecture / Integration
- **Anchor:** auxiliary repair design, “Risk vector” and “Progress precedence”; EG2-R3B exact complete risk-vector/progress obligations; Direct Recovery Override acceptance for complete B-B2 algebra.
- **Files:** `packages/sdd-runtime/src/orchestrator/failure-delta.ts:16-19`.
- **Evidence:** `precedence()` compares only `securityHardStops`, `critical`, `high`, and `uncoveredRequirements`, omitting the required `medium` then `low` dimensions. Positive progress also uses `lexicographic < 0 || weightedMovement > 0`, although the design requires a strictly safer vector **and** positive movement.
- **Independent reproducer:** prior risk `{medium:0, low:11, weighted:11}` and current risk `{medium:1, low:0, weighted:10}` produced `weightedMovement: 1` and `progress: "positive"`. The complete required vector is worse at `medium`, so precedence requires `negative`.
- **Impact:** a newly introduced medium-risk failure can be reported as progress by offsetting it with enough resolved low-risk findings. This corrupts the routing signal consumed by later decision logic.
- **Required correction:** compare all risk dimensions in the specified order and implement positive progress as the conjunction of a strictly safer complete vector, positive weighted movement, and no protected guard.

### BLOCKER — B-B2-DELTA-PARSER-OPTIONAL-AUTHORITY-v1

- **Category:** Security / API / Integration
- **Anchor:** REQ-CONTRACT-003; repair design “Root Architectural Error” and “Full Failure-Delta and Risk Algebra”; EG2-R2-S04 and EG2-R3B parser recomputation requirements; original B-B6 fail-closed parser finding.
- **Files:** `packages/sdd-runtime/src/contracts/failure-delta.ts:5-15`.
- **Evidence:** `previous` and `current` are optional. Line 14 recomputes algebra only when `current` is supplied; otherwise the parser accepts caller-supplied buckets, risk vectors, movement, and progress after checking only internal shape/hash consistency.
- **Independent reproducer:** a valid delta was changed to invented risk vectors (`priorRisk.low=7`, `currentRisk.low=8`), `weightedMovement=-1`, and `progress="negative"`, then self-hashed. `parseFailureDeltaV1(wire)` accepted it when manifests were omitted.
- **Impact:** the public trust boundary repeats the prohibited “self-hash then trust” architecture. An untrusted persisted wire record can manufacture routing authority without the manifests that define the algebra.
- **Required correction:** require authoritative manifest context for authoritative parsing/recomputation, or separate a clearly internal structural decoder from the public semantic parser so callers cannot mistake self-consistent bytes for validated delta authority.

### BLOCKER — B-B2-BASELINE-PERSISTENT-BUCKET-v1

- **Category:** Integration / Data Integrity
- **Anchor:** repair design “Full Failure-Delta and Risk Algebra” (comparison universe and newly observed baseline bucket); Direct Recovery Override requirement for complete disjoint buckets and baseline no-credit behavior.
- **Files:** `packages/sdd-runtime/src/orchestrator/failure-delta.ts:12-13`.
- **Evidence:** any prior finding with a matching current finding falls through to `persistent`, even when both are inactive `unrelated_baseline` findings. The design includes only newly observed validated baseline identities in `newUnrelatedBaseline`; baseline identities are outside active batch-related persistence/risk.
- **Independent reproducer:** comparing one unchanged `pre_existing` / `unrelated_baseline` finding against itself produced `persistent: [findingId]` and `newUnrelatedBaseline: []`.
- **Impact:** the declared bucket union is not the specified comparison universe, so consumers cannot rely on the delta classification even though movement remains zero.
- **Required correction:** explicitly form the prior-active, current-active, and newly observed baseline universes before classification; do not place unchanged inactive baseline findings in `persistent`.

### BLOCKER — B-B3-REVISION-CHAIN-STOPS-AT-TWO-v1

- **Category:** Architecture / Data Integrity
- **Anchor:** REQ-CONTRACT-004; repair design “Append-only revisions”; EG2-R3B recursive revision-chain requirements; Direct Recovery Override requirement for recursive dossier/revision integrity.
- **Files:** `packages/sdd-runtime/src/contracts/execution-dossier.ts:62-72,81-89`.
- **Evidence:** both `reviseExecutionDossierV1()` and `parseExecutionDossierV1(value, previous)` first call `parseExecutionDossierV1(previous)` without the predecessor of `previous`. A revision-2 dossier therefore fails that recursive call because revisions greater than one require their own previous dossier.
- **Independent reproducer:** revision 1 was created and revision 2 was accepted; `reviseExecutionDossierV1(revision2,{})` failed with `invalid-evidence: dossier revision` instead of issuing revision 3.
- **Impact:** the supposedly append-only revision contract supports only one revision transition. Normal long-lived dossiers cannot progress, and the parser API cannot validate the recursive chain it claims to protect.
- **Required correction:** define an explicit validated-chain representation or accept sufficient predecessor context. Do not recursively reparse a later revision without its chain; preserve exact `revision + 1`, `previousDigest`, stable identity, prefix, and manifest-transition checks for arbitrary bounded chain length.

### MAJOR — B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1

- **Category:** Test Quality / Maintainability
- **Anchor:** EG2-R2-S02; EG2-R3B/R3C amendments requiring individually named package-root tests and forbidding aggregate loops, subsets, labels, modulo/property sampling, filler, and count-only evidence; Direct Recovery Override B-B7 acceptance.
- **Files:** `packages/sdd-runtime/src/contracts/batch-b-r3a-public-matrix.test.ts:68-79`; `packages/sdd-runtime/src/contracts/batch-b-repair.test.ts:33-40,80-95`; `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts:70-73`.
- **Evidence:** `parserCases` declares nine parser mutation rows but is never executed. The repair suite combines every parser under one test name (`B-B3/B-B6 every V1 parser...`) rather than independently named public-entrypoint rows. The export oracle maps only a `required` subset and checks four selected internals, not the exact supported public surface. The B-B1 repair oracle also aggregates five seeds through `every()`.
- **Independent assessment:** all four focused files pass (`45 pass, 0 fail`), yet they did not catch the three B-B2 defects or the revision-3 failure above. Static search found the dormant table and subset/aggregate shortcuts.
- **Impact:** the matrix can remain green while mandatory public boundaries and cross-field invariants are absent. This is the exact false-closure mode B-B7 was intended to prevent.
- **Required correction:** replace dormant/aggregate/subset evidence with individually named package-root cases for every required parser, mutation, security, path, evidence, export, legacy, and revision branch, with exact values/errors and unchanged-input/freeze assertions where applicable.

## Finding Disposition B-B1–B-B7

| Finding | Disposition | Review evidence |
|---|---|---|
| B-B1 | **CLOSED** | Closed-shape manifest construction plus recursive secret checks reject tested private-key and short-JWT placements before hashing. No raw or secret-derived persisted influence was reproduced. |
| B-B2 | **OPEN / BLOCKING** | Three independent defects: incomplete risk precedence, optional-authority parser acceptance, and unchanged-baseline misclassification. |
| B-B3 | **OPEN / BLOCKING** | Nested parsing/reference checks improved, but the append-only revision chain cannot advance beyond revision 2. |
| B-B4 | **CLOSED** | Authoritative roots normalize equivalent POSIX/Windows checkout prefixes and reject external, traversal, UNC-like, duplicate-separator, NUL, and drive-relative paths. |
| B-B5 | **CLOSED** | Exact evidence deduplicates, reorder is canonical, and conflicting semantic tuples/finding identities reject without count inflation. |
| B-B6 | **OPEN / BLOCKING through B-B2-DELTA-PARSER-OPTIONAL-AUTHORITY-v1** | Most public/internal export narrowing and closed parsers are improved, but `parseFailureDeltaV1` remains fail-open semantically when manifest authority is omitted. |
| B-B7 | **OPEN / MAJOR** | The required exact public matrix still contains dormant filler, aggregate cases, and subset export assertions. |

## Security

- Secret/JWT/PEM handling is materially improved and no direct secret persistence was reproduced.
- The remaining security-relevant concern is authority integrity: a self-hashed delta can be accepted without manifests and then presented as validated progress/risk evidence.
- No new dependency, credential, command-injection surface, or direct generated-output secret exposure was found.

## Delta / Risk

- Exact sorting, disjointness, `added` projection, 2x regression penalty, and protected critical/high/security regression guards are present.
- Complete algebra is not achieved because medium/low precedence is omitted, positive progress uses an unsafe disjunction, unchanged baseline enters `persistent`, and parsing can skip manifest recomputation.

## Dossier / References

- Nested batch, manifest, delta, decision, lane, verification, causal, authorization, and intent parsers are invoked; intent identity/key uniqueness and acyclic decision-digest binding are enforced.
- Supplied nested hashes are verified rather than silently repaired.
- Revision integrity is still blocking because the public create/revise/parse path cannot represent or validate revision 3.

## Identity / Parsers / API

- Checkout-independent path identity, evidence collision handling, and root export narrowing are sound in the reviewed cases.
- The delta parser's optional semantic authority violates the fail-closed public boundary.
- Existing root exports remain additive; canonical helpers are not re-exported from the package root.

## Test Quality

- Focused execution: `45 pass`, `0 fail`, four Batch B files.
- Independent adversarial execution reproduced four invalid outcomes despite those green tests.
- The new direct-recovery file has individually named exact FailureDelta/Dossier rows, but the complete Batch B matrix still fails the no-aggregate/no-subset/no-filler gate.

## Compatibility / Maintainability

- No legacy-result or pre-Batch-B root-export regression was found in the inspected evidence.
- Inputs are cloned/frozen at public boundaries, and canonical sorting remains deterministic.
- Dense compressed source and duplicated contract checks materially hinder review and contributed to missed invariants. The revision API needs a clearer chain abstraction rather than additional local conditions.
- Contract sizes remain bounded; no material portability or performance regression was found beyond the correctness failures.

## Scope Audit

- Current status contains the previously classified Batch A adapter/generator/canonical-skill work plus Batch B runtime/contracts/tests and this OpenSpec change directory.
- No `apps/cli/src/runtime/build-info.generated.ts` change is present. The tracked canonical skill file is dirty as pre-existing Batch A scope; direct-recovery evidence reports its hash remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- The direct-recovery implementation paths are confined to FailureDelta, dossier, and Batch B acceptance artifacts described by the override. No Batch C/later runtime, registry coordinator, production lane/prompt wiring, dependency, historical archive rewrite, excluded WIP intersection, or unrelated product path was identified.
- This review did not modify shared registry files, Apply artifacts, source, tests, generated outputs, or historical OpenSpec artifacts.

## Artifact and Registry Intent

- **Artifact:** `openspec/changes/developer-team-execution-convergence/review-batch-b-direct-recovery.md`
- **Phase:** `review`
- **Status:** `changes_requested`
- **Event:** `review.batch-b.direct-recovery.failed`
- **Registry write:** deferred
- **Provenance:** fresh independent Review Agent; official OpenSpec artifacts plus current source/tests/diff and independent adversarial execution; 2026-07-15

## Blockers

1. `B-B2-RISK-PRECEDENCE-OMITS-MEDIUM-LOW-v1`
2. `B-B2-DELTA-PARSER-OPTIONAL-AUTHORITY-v1`
3. `B-B2-BASELINE-PERSISTENT-BUCKET-v1`
4. `B-B3-REVISION-CHAIN-STOPS-AT-TWO-v1`
5. `B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1` (MAJOR required change)
