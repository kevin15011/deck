# Final Fresh Review: Batch B Gate Repair 2

## Verdict

**REQUEST CHANGES / FAIL.** Gate-repair-2 corrects the relationship-transition runtime defect and both append-only validation branches, and the focused suites are green. The gate nevertheless retains two blocking acceptance-quality findings: the public export oracle is still not exact, and the parser-side depth-3 truncation guards have no independently named regression cases. PASS requires zero blocking findings.

## Findings

### MAJOR — B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1

- **Category:** Integration / API / Test Quality
- **Anchor:** EG2-R2-S02; the EG2-R3B/R3C exact package-root acceptance amendments; Direct Recovery Gate Repair 2 acceptance requiring an “exact complete key set”; REQ-CONTRACT-005 and backward compatibility.
- **Files:** `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts:84-117`; `packages/sdd-runtime/src/index.ts:9-51`.
- **Evidence:** the test performs 25 independent `typeof ... === "function"` checks and four selected negative membership checks. It never compares `Object.keys(publicApi)` (or an exact Batch-B-plus-legacy projection) with an explicit expected key set. A fresh runtime audit found 57 package-root value exports, all 25 expected Batch B values present, and no four named canonical-helper leaks; the current test would still pass if any other internal value became public or if an unlisted legacy value disappeared. This is presence/subset evidence, not the required exact complete export oracle.
- **Impact:** accidental API expansion and legacy API contraction remain undetectable at this gate, creating an avoidable Hyrum’s-Law compatibility commitment.
- **Recommendation:** compare a sorted, explicit expected package-root value-export array with the complete sorted runtime key set, or compare exact exhaustive legacy and Batch B partitions whose union is also asserted equal to the complete root key set. Keep the existing per-function callability checks only as supplementary evidence.

### MAJOR — B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1

- **Category:** Architecture / Data Integrity / Test Quality
- **Anchor:** REQ-CONTRACT-004; auxiliary repair design “Append-only revisions”; Gate Repair 2 requirement that registry-intent and prior-decision history cannot truncate at depth 3+ in both issue and parse paths; EG2-R3B/R3C independently named public-entrypoint evidence rules.
- **Files:** `packages/sdd-runtime/src/contracts/execution-dossier.ts:114-125`; `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts:69-87`.
- **Evidence:** production parsing now has explicit length-before-prefix guards for both collections. The only two truncation tests invoke `reviseExecutionDossierV1`; there is no independently named test that presents a correctly rehashed revision-3 wire dossier with a truncated `registryIntents` prefix to `parseExecutionDossierV1`, and none for a truncated `causalContext.priorDecisionDigests` prefix. Static audit found zero parse-truncation test names. The positive depth-3 parser test does not execute either rejection branch.
- **Impact:** the parser half of the exact repaired invariant can regress while all current gate-repair-2 tests remain green. This is material because the preceding defect existed in both issuance and parsing.
- **Recommendation:** add two independently named package-root tests at revision 3, one per protected collection. Rehash the forged wire dossier without repairing its semantic history, pass the complete revision-1/revision-2 predecessor array, and assert the exact parser errors `invalid-evidence: registry intent prefix` and `invalid-evidence: decision digest prefix`.

## Finding Disposition B-B1–B-B7

| Finding | Disposition | Fresh review evidence |
|---|---|---|
| B-B1 | **CLOSED** | Individually named PEM and JWT cases cover summary, remediation, and evidence placements. Closed schemas and pre-hash recursive unsafe-content rejection prevent persisted raw or derived secret influence. |
| B-B2 | **CLOSED** | `computeFailureDeltaV1` rejects either same-identity relationship transition before bucket classification with the exact stable error; both directions have individually named tests. Six-dimensional precedence, authoritative recomputation, regression penalty, and unrelated-baseline isolation remain coherent. |
| B-B3 | **OPEN / BLOCKING (acceptance evidence)** | Issuance and parser code both perform length-before-prefix validation and complete predecessor parsing. Issuance has depth-3 truncation tests; the public parser’s two truncation rejection branches do not. |
| B-B4 | **CLOSED** | Authoritative POSIX/Windows root normalization, checkout-independent identity, and external/traversal/drive-relative/duplicate-separator/NUL rejection remain localized and deterministic. |
| B-B5 | **CLOSED** | Exact evidence duplicates collapse deterministically, reordering preserves bytes, semantic evidence collisions reject, and duplicate finding identities do not inflate counts. |
| B-B6 | **CLOSED** | Public builders/parsers validate versions, exact shapes, references, digests, and recursively nested contracts; delta parsing requires authoritative manifests; canonical helpers are not currently exported from the package root. |
| B-B7 | **OPEN / BLOCKING** | Protected-placement cases are individually named, but the claimed export oracle remains a 25-name presence list plus four selected exclusions rather than an exact complete key comparison preserving all legacy exports. |

## Gate-Repair-2 Findings

- `B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1`: runtime and exact two-direction regression evidence are corrected.
- `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1`: runtime issuance/parsing logic is corrected; parser-side exact regression evidence remains incomplete under `B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1`.
- `B-B7-COMBINED-PLACEMENT-CASE-v1`: corrected; the PEM protected placements are split into four independently named cases, with the JWT placement cases independently named in the public matrix.
- `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1`: unresolved.

## Security

No new exploitable secret, injection, authorization, or data-exposure defect was reproduced. The recursive secret detector executes before identity/digest issuance, rejects suspicious structural keys and credential forms, and returns fixed errors. Relationship mutation now fails closed rather than dropping a protected identity from delta buckets. Security rating: **Strong for the reviewed implementation; gate remains failed for acceptance integrity.**

## Delta/Risk

The relationship-transition guard runs for active and inactive predecessor states before normal classification. Existing exact checks cover unrelated-baseline no-credit behavior, reopened protected findings, six-field lexicographic precedence, weighted movement, 2x regression penalty, and mandatory authoritative parsing. No residual delta/risk blocker was found.

## Dossier/Revision

The implementation validates every predecessor in order, requires exactly `revision - 1` predecessors, preserves dossier identity and previous digest, and checks collection length before prefix equality in both revision issuance and parsing. The remaining blocker is the missing parser-side rejection oracle, not a reproduced runtime acceptance defect.

## Parsers/API/Legacy

All 25 intended Batch B runtime functions are currently reachable from the root and the sampled canonical internals are absent. Legacy repair-incident parsing and adaptation remain reachable and existing legacy tests pass. However, no exact 57-key package-root snapshot or equivalent exhaustive partition proves that this complete current surface—and only this surface—is preserved.

## Test Quality

- Fresh focused run: `75 pass / 0 fail`, 130 expectations across four Batch B files.
- Fresh contracts run: `173 pass / 0 fail`, 369 expectations across 13 files.
- The eight PEM/JWT protected-placement cases are individually named; no combined placement test remains.
- Blocking weaknesses: no exact complete export-key equality and no named parser truncation cases for the two append-only collections.
- `bun run typecheck` is not a repository script; an attempted bare `bunx tsc --noEmit` printed compiler help because no root `tsconfig.json` is present. This is recorded as unavailable fresh review evidence, not as a product finding; prior official verification records a passing configured typecheck.

## Maintainability

The production fixes are localized, additive, dependency-free, and use stable exact error contracts. The two duplicated prefix checks are readable and appropriate at separate issue/parse trust boundaries. `batch-b-direct-recovery.test.ts` remains heavily compressed into long single-line fixtures and assertions, which raises review cost, but this is not independently blocking. Maintainability rating: **Adequate**.

## Scope Audit

Gate-repair-2 product/test edits are confined by official Apply evidence to `failure-delta.ts`, `execution-dossier.ts`, `batch-b-replacement.test.ts`, and `batch-b-direct-recovery.test.ts`, plus authorized governance artifacts. No dependency, Batch C/later runtime, generated/build-info, historical OpenSpec, adapter, prompt, or unrelated gate-repair-2 edit was identified. The working tree contains earlier authorized and quarantined change files, including generated content; they predate this local repair fingerprint and were not modified by this Review. This Review writes only this report. Adaptive memory was loaded as advisory context; official OpenSpec artifacts, source, tests, and current bytes controlled every disposition.

## Artifact

`openspec/changes/developer-team-execution-convergence/review-batch-b-gate-repair-2.md`

## Artifact Evidence

The report was written as the sole Review artifact and is subject to immediate byte-for-byte read-back and SHA-256 verification. The immutable digest and byte count are returned to the orchestrator.

## Phase

`review`

## Status

`changes_requested`

## Registry Write

`deferred` — mandatory registry-deferred mode; `state.yaml`, `events.yaml`, progress, incident, source, tests, generated outputs, and all other files were not written by Review.

## Registry Intent

- Artifact: `review-batch-b-gate-repair-2.md`
- Phase: `review`
- Status: `changes_requested`
- Event: `review.batch-b.gate-repair-2.failed`
- Immutable finding set: `{B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1, B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1}`

## Blockers

`{B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1, B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1}`
