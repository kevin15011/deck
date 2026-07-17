# Batch B Boundary Review: Developer Team Execution Convergence

## Verdict

**FAIL** — Apply Batch B (`EG2-T1`, `EG2-T2`) is not accepted. Batch C remains blocked. The implementation is additive and localized, but the public V1 contract boundary does not yet satisfy the required redaction, batch-reference continuity, failure-delta safety, deterministic path identity, or invalid-evidence behavior.

This is an auxiliary vertical-slice Review, not the final whole-change Review. No Batch C runtime wiring was reviewed or authorized.

## Scope and Ratings

**Scope**: general, backend, integration  
**Files reviewed**: 19 Batch B product/test files plus the official Proposal, Spec, Design, Tasks, Apply progress, registry state, and registry events.

| Dimension | Rating | Evidence summary |
|---|---|---|
| Architecture | ❌ Weak | The pure contract boundary is localized, but several advertised public contracts are type-only and the dossier does not validate all nested batch-bound references. |
| Security | ❌ Weak | Structural redaction is not deny-by-default; unknown keys and unrestricted nested values persist secrets. |
| Scalability | ⚠️ Adequate | Delta lookup is indexed and no dependency was added; correctness defects dominate performance considerations. |
| Maintainability | ❌ Weak | Canonical internals are exported publicly, validation is fragmented, and normalized duplicate keys are silently overwritten. |
| Code Quality | ⚠️ Adequate | Names and boundaries are concise, but compressed one-line modules/tests reduce reviewability and hide missing validation. |
| Integration | ❌ Weak | Exact batch-reference continuity and required delta classifications are not enforced end to end. |
| Economy / Critical Judgment | ✅ Strong | Node crypto and plain DTOs avoid dependencies and premature Batch C wiring; the volume is justified by the contract/security scope. |

## Findings

### BLOCKER

#### B-B1 — Security: persisted manifests leak secrets through unknown keys and unrestricted fields

- **Anchor**: REQ-CONTRACT-005; EG2-T1 lines 173–190; Design lines 408–421 (structural, deny-by-default redaction; secret-name keys removed regardless of value).
- **Files**: `packages/sdd-runtime/src/contracts/failure-manifest.ts:15-25`, `packages/sdd-runtime/src/contracts/canonical.ts:60-63`.
- **Evidence**: `finding()` spreads the complete finding and evidence objects, then redacts only `excerpt` and `summary`. `kind`, `checkId`, `resultCode`, `remediationCode`, unknown extension fields, secret-bearing map keys, and nested values remain unrestricted. An independent executable probe persisted all five seeded values: `CHECK_SECRET`, `RESULT_SECRET`, `NESTED_SECRET`, `REMEDIATION_SECRET`, and `EXTRA_SECRET`.
- **Affected behavior**: untrusted Verify/Review evidence can place credentials or secret-bearing diagnostics into a supposedly safe manifest and its canonical digest before persistence/emission.
- **Required correction**: construct every persisted shape from an allowlist; recursively reject/remove known secret-name keys and scan all accepted strings before hashing; validate closed-code fields; reject evidence when safe meaning cannot be retained.

#### B-B2 — Integration: failure delta can report positive progress for a new security regression and lacks required related/baseline buckets

- **Anchor**: REQ-DECISION-001, REQ-DECISION-002, the Spec definition of Positive progress, EG2-T2 lines 195–221, and Design lines 248–250.
- **Files**: `packages/sdd-runtime/src/contracts/failure-delta.ts:3-4`, `packages/sdd-runtime/src/orchestrator/failure-delta.ts:6-27`.
- **Evidence**: the public contract exposes one `added` bucket rather than `new-related` and `new-unrelated-baseline`. `progress` is selected only from scalar weighted movement. An independent probe resolving one critical finding while adding a low security-relevant finding returned `progress: "positive"` with movement `999`; the new security finding was merely `added`. The specified `2x` regressed-finding weighting is also absent.
- **Affected behavior**: later routing can treat a security regression as positive progress and cannot quarantine an unrelated baseline without an external, non-contract reconstruction.
- **Required correction**: represent all normative mutually exclusive buckets, classify baseline relationship from validated structured evidence, compute risk movement with security/high-critical dominance and regression weighting, and prohibit positive progress whenever the Spec's safety conditions fail.

#### B-B3 — Integration: the dossier accepts mismatched decision and registry references

- **Anchor**: REQ-CONTRACT-002, REQ-DECISION-006, EG2-T2 lines 204–221, and Design lines 157–176/395–406.
- **File**: `packages/sdd-runtime/src/contracts/execution-dossier.ts:17-27`.
- **Evidence**: `validate()` checks manifest references, verification `batchId`, causal `batchDigest`, and one current-delta digest only. It does not validate the decision batch, registry-intent batch ID/digest, authorization reference binding, prior/current delta chain, nested schemas, or supplied nested digests. An independent probe created and froze a dossier whose `decision.batchId` was `batch:v1:WRONG`.
- **Affected behavior**: a public immutable dossier can canonically attest cross-batch decision/intent evidence instead of rejecting it before authoritative use.
- **Required correction**: add runtime parsers/validators for every nested V1 contract and validate exact schema, batch ID, full digest, change ID, and cross-reference continuity before issuing or revising a dossier. Never silently recompute an already-issued nested digest.

#### B-B4 — Data/Determinism: finding identity changes across equivalent absolute-prefix variants

- **Anchor**: REQ-CONTRACT-003, REQ-CONTRACT-006, the “Findings normalize without leaking or identity drift” scenario, and EG2-T1 lines 183–190.
- **Files**: `packages/sdd-runtime/src/contracts/failure-manifest.ts:17-25`, `packages/sdd-runtime/src/contracts/canonical.ts:50-57`.
- **Evidence**: project-root inference is special-cased by splitting `sourceArtifact` on `/verify.md`. Equivalent Review findings using `/home/alice/repo/review-report.json` and `/mnt/ci/repo/review-report.json`, with corresponding unknown-extension locations, produced different `findingId` values and different external-path labels. The current test proves only the `/verify.md` plus recognized `/packages/` case.
- **Affected behavior**: replay on another checkout/runner can turn one finding into resolved-plus-added rather than persistent/reclassified.
- **Required correction**: require/inject the authoritative project root or a validated repository-relative identity; normalize all accepted source/evidence/location paths consistently before identity hashing, independent of filename or extension.

### MAJOR

#### B-B5 — Data Integrity: duplicate semantic keys/findings are accepted and produce inconsistent risk

- **Anchor**: REQ-CONTRACT-003, REQ-CONTRACT-006, REQ-DECISION-006, Design lines 399–406, and EG2-T1 collision/invalid-evidence tests.
- **Files**: `packages/sdd-runtime/src/contracts/apply-batch.ts:20-28`, `packages/sdd-runtime/src/contracts/failure-manifest.ts:28-34`, `packages/sdd-runtime/src/orchestrator/failure-delta.ts:18-23`.
- **Evidence**: artifact keys are normalized after enumeration and silently overwrite one another (`src\\a` and `src/a` were accepted with different digests). Two identical semantic findings are retained with the same ID; the delta map emits one `added` ID while risk counts both findings (`high: 2`, weighted `200`). The collision check rejects only equal truncated IDs with different full fingerprints and does not reject duplicate semantic identities.
- **Affected behavior**: canonical content depends on overwrite behavior, and finding/risk counts can be inflated without corresponding delta identities.
- **Required correction**: reject normalized-key collisions and duplicate finding identities as `invalid-evidence`; validate uniqueness before digesting or risk calculation.

#### B-B6 — API/Maintainability: advertised V1 parsers are absent and canonical internals became public API

- **Anchor**: REQ-CONTRACT-003, EG2-T1 lines 183–190, EG2-T2 lines 204–221, and Design line 110 (“internal canonicalization ... not exported”).
- **Files**: `packages/sdd-runtime/src/contracts/{execution-decision,invocation-authorization,registry-intent,verification-state,causal-context,execution-lane,failure-delta}.ts`, `packages/sdd-runtime/src/index.ts:14-24`.
- **Evidence**: most remaining V1 modules define TypeScript interfaces only. They cannot reject unknown mandatory versions, malformed enums/digests, unsafe strings, or mutable runtime input at their boundary. Conversely, `canonicalJson`, `deepFreeze`, path/redaction helpers, and digest assertions are exported from the root barrel, turning internal implementation details into an additive public commitment.
- **Affected behavior**: callers can construct malformed V1 values through casts/JSON while the package advertises versioned fail-closed contracts; future canonicalization changes become unnecessarily compatibility-sensitive.
- **Required correction**: provide narrow public parse/build functions that validate, clone, redact, hash, and freeze each wire contract; keep canonical helpers behind the internal boundary and expose only contract-level APIs/types intended for consumers.

#### B-B7 — Test Quality: acceptance tests do not exercise the security and integration boundaries they claim

- **Anchor**: EG2-T1/T2 TDD tables and required completion signals; Design lines 689–705.
- **Files**: `packages/sdd-runtime/src/contracts/{canonical,apply-batch,failure-manifest,execution-v1-contracts}.test.ts`, `packages/sdd-runtime/src/orchestrator/failure-delta.test.ts`, `packages/sdd-runtime/src/index.test.ts`.
- **Evidence**: the suite has no oracle for secret-name map keys/nested values/unknown extensions/private-key-like values, Review-path prefix variation, normalized-key collisions, duplicate finding identities, new-related versus unrelated-baseline, security-dominant movement, decision/intent batch mismatch, or unknown versions for type-only DTOs. The public-export test checks only that five names are functions; it does not compare the prior API surface or invoke legacy behavior. The delta test uses hand-forged manifests and therefore bypasses manifest identity/validation behavior.
- **Affected behavior**: all focused and affected tests pass while B-B1 through B-B6 remain reproducible.
- **Required correction**: add end-to-end behavioral table cases through public builders/parsers and assert exact safe bytes, IDs, buckets, risk vectors, rejection codes, immutable output, and legacy outcomes. Do not use aggregate test counts as a substitute for boundary coverage.

## Requirement and Design Compliance

| Area | Assessment |
|---|---|
| V1 versioning/additive compatibility | Partial: batch/manifest builders reject their own unknown schema and existing exports remain present, but most V1 DTOs have no runtime parser and internal helpers are exported. |
| Canonical JSON/SHA-256 | Partial: plain JSON key replay and SHA-256 are stable for tested inputs; normalized semantic-key collision rejection and portable path identity are incomplete. |
| Deep immutability/append-only dossier | Partial pass: issued objects and revisions are deeply frozen, prior objects remain unchanged, revision and `previousDigest` advance, and batch identity is preserved. Invalid nested references can nevertheless be frozen into an issued dossier. |
| Redaction | Fail: not structural or deny-by-default. |
| Finding identity/collision | Partial: prose/evidence order/severity are excluded and full fingerprints accompany truncated labels; path-prefix identity and duplicate semantic identity handling fail. |
| Failure delta | Fail: precedence among implemented buckets is deterministic, but normative bucket/risk semantics are incomplete and unsafe progress is possible. |
| Legacy adaptation | Pass for mutation compatibility: the adapter builds an in-memory projection and the legacy object serialization remains unchanged. Semantic field validation/redaction remains subject to B-B1. |

Kernel action selection for invalid-oracle, Spec contradiction, architecture mismatch, and security/data-loss routing belongs to EG3 and was not treated as missing Batch B scope. Batch B is blocked only by contract/delta behavior assigned to EG2. No unapproved new scope was made blocking.

## Security and Redaction Assessment

The security boundary fails closed-code and structural-redaction expectations. Absolute paths are hidden in the tested cases, but safe output is not guaranteed for arbitrary map keys or nested values. Secret leakage is directly reproducible before persistence/digesting, so B-B1 blocks acceptance.

## Determinism and Immutability Assessment

Object-key canonical replay, SHA-256 formatting, set sorting, deep freeze, and dossier revision chaining work in the tested happy path. Determinism is not complete because path identity depends on a `/verify.md` filename heuristic and normalized duplicate keys are silently overwritten. Immutability cannot compensate for invalid cross-batch content frozen into a dossier.

## Failure Delta Assessment

The implemented `regressed > reclassified > persistent` precedence is deterministic for supplied IDs, and lookup is indexed. However, `added` does not encode related versus unrelated baseline, security regressions can still yield positive scalar movement, duplicate identities desynchronize sets from risk counts, and the required regression weighting is absent. The invalid-oracle/Spec/Design/security action table remains correctly deferred to Batch C, but Batch C must not begin on this unsafe delta substrate.

## Compatibility and API Assessment

The tracked root export diff is additive and existing runtime/core tests remain green. `RepairIncident` input is not mutated. The review found no removal or reinterpretation of existing exports and no production caller of the new contracts. The root export of canonical internals is an unnecessary new compatibility commitment, while the intended public DTOs lack fail-closed runtime constructors.

## Test Quality Assessment

The reported focused `23/23` and runtime `284/284` counts reproduce exactly. A full current core run passes `1474/1474`; the Apply report's `1164/1164` was an earlier/narrower affected selection, not reproduced as the full package count. The focused count includes existing repair-incident compatibility tests and is not itself rejected, but the new tests are materially subset-only: passing labels/counts do not cover the trust-boundary and delta invariants above.

## Scope Audit

- No `runExecutionDecisionPipelineV1`, `executeDeveloperTeamStepV1`, decision-kernel policy, adapter bridge, registry coordinator, prompt convergence, or Batch C production wiring exists.
- New API usages are limited to Batch B definitions, tests, and the additive barrel.
- No Batch B intersection with `runner-capability-standardization`, generated output, build-info, prompts, adapters, or historical OpenSpec source was found.
- Optional new scope: none.
- Related regressions: B-B1 through B-B7 are Batch B implementation/acceptance defects.
- Unrelated baseline: exactly the established three release-metadata failures described below.

## Independent Verification Assessment

| Check | Independent result |
|---|---|
| Focused Batch B contracts | 23 passed, 0 failed, 95 expectations, 7 files. |
| Affected `packages/sdd-runtime` | 284 passed, 0 failed, 727 expectations, 26 files. |
| Full `packages/core` | 1474 passed, 0 failed, 5228 expectations, 55 files. |
| Workspace typecheck | `bunx tsc --noEmit` passed with zero diagnostics. |
| Broad repository | 3320 passed, exactly 3 failed, 11767 expectations, 186 files. |
| Broad failure classification | Exactly the known `scripts/prepare-release.test.ts` cases: non-interactive release JSON, `--help`, and `--sha256-file`; each reports stale ignored build metadata `1bba98b` versus HEAD `652a9b0ed14efc995300b9c982950a70b7792e98`. Unrelated baseline; no repair credit. |
| Generated output | SHA-256 before and after broad run: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; bytes stable. |

Passing existing tests do not override the independently reproduced contract defects.

## Registry Decision

- **Phase**: `apply`
- **Status**: `blocked-review`
- **Event**: `review.batch-b.failed`
- **Batch B acceptance**: rejected
- **Batch C readiness**: blocked
- **Source/test/generated modifications**: none by Review
- **Apply progress modification**: none on FAIL
