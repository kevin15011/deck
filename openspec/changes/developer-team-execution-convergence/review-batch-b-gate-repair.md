# Batch B Combined Gate-Repair Review: Developer Team Execution Convergence

## Verdict

**FAIL — REQUEST CHANGES.** The combined repair closes the previously reported medium/low precedence, authoritative-delta, unchanged-baseline, and depth-3 issuance failures, but two independently reproduced data-integrity defects remain in the normative delta and dossier contracts. The claimed exact public acceptance matrix also retains subset-only export evidence. PASS is therefore not available.

**Scope:** general, backend, integration  
**Mode:** registry-deferred; this report is the only repository write  
**Adaptive context:** loaded as advisory context; official OpenSpec artifacts, current source/tests/worktree, and fresh execution are authoritative.

## Findings

### BLOCKER — B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1

- **Severity / Category:** BLOCKER — Architecture / Integration / Data Integrity
- **Fingerprint:** `B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1`
- **Anchor:** auxiliary repair design, “Relationship decision” (`relationship` cannot change for one finding identity) and “Full Failure-Delta and Risk Algebra” (bucket union exactly covers the comparison universe); EG2-R3B exact relationship and bucket obligations; B-B2 gate closure.
- **Files:** `packages/sdd-runtime/src/orchestrator/failure-delta.ts:24-43`.
- **Evidence:** an inactive prior finding immediately continues at lines 26-28 when its relationship is `unrelated_baseline`. If the same identity is current, active, and `batch_related`, the second loop also excludes it because `before` exists. The transition is neither rejected nor assigned to any bucket.
- **Fresh reproducer:** a prior `pre_existing/unrelated_baseline` high-security finding and a current `open/batch_related` finding had the same `findingId`. `computeFailureDeltaV1` accepted the relationship change and returned all six buckets empty while `currentRisk` contained `securityHardStops:1`, `high:1`, `weighted:100` and `progress:"negative"`.
- **Impact:** the delta violates both relationship immutability and coverage completeness. Consumers cannot reconcile a current protected finding to any delta bucket, even though it affects risk and routing.
- **Required correction:** reject any relationship change for an existing finding identity before classification, and add an individually named package-root acceptance case asserting the exact rejection.

### BLOCKER — B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1

- **Severity / Category:** BLOCKER — Architecture / Data Integrity
- **Fingerprint:** `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1`
- **Anchor:** REQ-CONTRACT-004; auxiliary repair design, “Append-only revisions”; EG2-R3B complete predecessor-history, immutable-prefix, and no-silent-repair obligations; B-B3 gate closure.
- **Files:** `packages/sdd-runtime/src/contracts/execution-dossier.ts:81-88,109-113`.
- **Evidence:** prefix validation uses `next.slice(0, previous.length).some(...)` without first requiring `next.length >= previous.length`. A shorter current array yields a shorter slice and no mismatching callback, so both `registryIntents` and `causalContext.priorDecisionDigests` can be deleted. The parser repeats the same defect.
- **Fresh reproducer:** revision 1 contained one registry intent and one prior-decision digest. `reviseExecutionDossierV1(first, { registryIntents: [], causalContext: emptyCausal })` issued revision 2 with both histories empty, and `parseExecutionDossierV1(second, first)` accepted it.
- **Impact:** revisions are not append-only and a validly hashed dossier can erase previously recorded governance intent and decision history. Full predecessor validation at depth 3+ does not compensate for accepting a corrupt hop.
- **Required correction:** require each append-only collection to be at least the predecessor length before element-wise prefix comparison in both issuance and parsing; add exact independently named truncation cases for each protected prefix at revision 2 and within a depth-3 chain.

### MAJOR — B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1

- **Severity / Category:** MAJOR — Test Quality / Maintainability
- **Fingerprint:** `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1`
- **Anchor:** EG2-R2-S02 and EG2-R3B/R3C amendments requiring exact, individually named package-root public acceptance and forbidding subset/count/aggregate evidence; prior `B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1` required correction.
- **Files:** `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts:70-85`; `packages/sdd-runtime/src/index.ts:15-44`.
- **Evidence:** the test named “exports every supported Batch B public function” explicitly checks only 11 of 24 Batch B runtime value exports. It omits the legacy adapter and 12 authorization, registry-intent, staged-verification, causal-context, and lane builders/parsers. It also checks only four internal names rather than comparing the exact supported value surface.
- **Fresh static audit:** 24 Batch B value exports were enumerated from the package root; 13 were absent from this export oracle. Other tests invoke several omitted functions, but that does not make the claimed exact export-surface assertion complete and would not catch an unintended additional export.
- **Impact:** B-B7 can remain green after a supported export disappears or an unintended internal value becomes public. This is the prohibited subset-evidence failure mode.
- **Required correction:** assert the exact supported package-root Batch B value-export set, with explicit legacy-adapter compatibility and explicit internal exclusions; keep behavior/mutation cases individually named.

## Finding Disposition B-B1–B-B7

| Finding | Disposition | Fresh review evidence |
|---|---|---|
| B-B1 | **CLOSED** | Closed manifest/evidence shapes and recursive pre-hash scans reject the exercised PEM/JWT/secret-key placements; no raw secret or secret-derived digest influence was reproduced. |
| B-B2 | **OPEN / BLOCKING** | Six-field lexicographic precedence, conjunction-based positive progress, exact 2x penalty, authoritative parsing, and unchanged/removed baseline no-credit behavior pass. Relationship mutation for the same identity is accepted and omitted from every bucket. |
| B-B3 | **OPEN / BLOCKING** | Revision 3 issuance/parsing with complete history succeeds without digest repair, but revision hops can truncate registry-intent and prior-decision prefixes. |
| B-B4 | **CLOSED** | Reviewed POSIX/Windows root normalization and external, traversal, UNC-like, drive-relative, duplicate-separator, and NUL rejection remain sound. |
| B-B5 | **CLOSED** | Exact evidence deduplication, order-independent bytes, and semantic collision/duplicate-finding rejection remain sound. |
| B-B6 | **CLOSED** | `parseFailureDeltaV1` now requires explicit prior/current authority and dossier parsing recursively invokes the nested parsers. Missing authority and self-hashed malformed algebra reject. |
| B-B7 | **OPEN / MAJOR** | Dormant tables, broad throws, and parser loops were removed, but the public export oracle is still a subset rather than an exact surface assertion. The two fresh defects also lack acceptance cases. |

## Gate Findings

- Fresh focused execution passed: **66/66** tests across the four Batch B gate files.
- Fresh affected runtime execution passed: **166/166** tests across 15 contract/orchestrator/index files.
- The independent gate reproducer confirmed `medium 0→1, low 11→0` yields movement `+1` but `progress:"negative"`; missing delta authority rejects with `invalid-evidence: failure delta authority`; unchanged unrelated baseline yields no bucket, movement, or progress credit; and revision 3 preserves dossier identity and links to revision 2.
- Green suites did not detect relationship-transition bucket omission or append-only-prefix truncation; these are blocking engineering defects, not test-run failures.

## Security

- No new secret, dependency, command-injection, auth, or generated-output exposure was identified.
- The reviewed failure-manifest boundary allowlists persisted fields and scans accepted content before hashing. Exercised short JWT and private-key placements reject exactly.
- `B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1` is security-relevant because a current protected finding can affect risk while disappearing from the authoritative delta buckets.
- `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1` permits deletion of recorded governance/decision lineage from a later validly hashed dossier.

## Delta/Risk

- **Closed:** full precedence order is security hard stops → critical → high → uncovered requirements → medium → low.
- **Closed:** positive progress requires a strictly safer complete vector, positive weighted movement, and no protected regression guard.
- **Closed:** the regression formula counts current risk and applies the current finding weight again; the reproduced reopened critical case remains the exact `-2000` penalty.
- **Closed:** unchanged/removed unrelated baseline identities receive no persistent/resolved bucket or movement/credit; newly observed validated baseline remains isolated.
- **Open:** a same-identity relationship transition is not rejected and breaks exact bucket-union coverage.

## Dossier/Revision

- Complete predecessor arrays now support revision 3+, exact `revision + 1`, previous digest, stable dossier/batch identity, nested parsing, and no digest repair.
- Every supplied predecessor is recursively parsed in order.
- Append-only validation is incomplete: shorter registry-intent and prior-decision arrays silently pass in both revision issuance and parsing.

## Parsers/API/Legacy

- `parseFailureDeltaV1(value, previous, current)` is fail-closed when authority is omitted and recomputes the complete canonical delta from required manifests.
- Nested dossier contracts are parsed rather than accepted on self-consistent hashes alone.
- Public additions remain additive, canonical helpers remain unexported, and no legacy result/source regression was found in reviewed evidence.
- The API itself exposes 24 Batch B runtime values; the acceptance oracle explicitly checks only 11, so exact public-surface evidence remains incomplete.

## Test Quality

- Exact errors are used; no no-message `.toThrow()`, dormant `parserCases`, `.every()` aggregation, `for` loop generation, or filler/count-only evidence was found in the four gate files.
- FailureDelta and dossier gate cases are individually named through the package root.
- Missing cases: same-identity relationship mutation; registry-intent prefix truncation; prior-decision prefix truncation; truncation inside a depth-3 chain; and exact package-root value-export equality.

## Maintainability

- No dependency or speculative abstraction was introduced; the changes remain localized to existing contract boundaries.
- The trust kernel still uses compressed one-line helpers and duplicate prefix checks. This is not independently blocking, but it made the length-precondition omission easy to repeat in issuance and parsing. A shared, named append-only-prefix validator would reduce duplicated invariant risk without widening scope.
- Runtime operations remain bounded by contract collection limits; no material scalability regression was found.

## Scope Audit

- Gate-repair evidence identifies changes only in the three authorized runtime sources, four adjacent Batch B acceptance files, and authorized current-change artifacts. No Batch C/later runtime, registry coordinator, production lane/prompt wiring, dependency, historical archive rewrite, excluded-WIP intersection, or unrelated product path was identified.
- Current worktree also contains previously classified Batch A and broader change files. No evidence attributes those paths to this gate-repair launch.
- `apps/cli/src/runtime/build-info.generated.ts` is not changed. The pre-existing tracked canonical skill output hashes to `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`, matching the recorded canonical hash.
- This review did not modify shared registry files, progress/incident artifacts, source, tests, generated output, dependencies, or any file other than this report.

## Artifact

`openspec/changes/developer-team-execution-convergence/review-batch-b-gate-repair.md`

## Artifact Evidence

- Fresh review timestamp: `2026-07-15T21:50:22Z`.
- Focused tests: `66 pass / 0 fail`; affected runtime tests: `166 pass / 0 fail`.
- Independent reproducers: complete precedence/authority/baseline/revision-3 positive controls; relationship-transition omission; append-only-prefix truncation.
- Static audit: 24 Batch B package-root runtime value exports versus 11 explicit export assertions.
- Report bytes and SHA-256 are self-verified after write.

## Phase

`review`

## Status

`changes_requested`

## Registry Write

`deferred` — mandatory registry-deferred mode; no shared registry file was modified.

## Registry Intent

- **Phase:** `review`
- **Status:** `changes_requested`
- **Event:** `review.batch-b.gate-repair.failed`
- **Artifact:** `review-batch-b-gate-repair.md`
- **Provenance:** fresh independent `deck-developer-review`; model `openai/gpt-5.6-sol`; official OpenSpec context plus current source/tests/worktree, static audit, and independent reproducers; timestamp `2026-07-15T21:50:22Z`; registry-deferred.

## Blockers

1. `B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1` — BLOCKER.
2. `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1` — BLOCKER.
3. `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1` — MAJOR required change.
