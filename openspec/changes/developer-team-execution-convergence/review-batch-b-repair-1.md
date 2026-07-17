# Batch B Repair Review Cycle 1: Developer Team Execution Convergence

## Verdict

**FAIL — HARD STOP**

EG2-R1 attempt 1 does not close the original Batch B failure manifest. All seven original findings remain reproducible or directly evidenced. The failure set is unchanged (`7 → 7`), not strictly shrinking. No new related product regression was found, but B-B1 still permits private-key material in persisted manifest prose. Secret leakage and an unchanged failure set independently trigger the repair hard-stop rules. Attempt 2 is ineligible and Batch C remains blocked.

## Scope and Ratings

**Scope**: general, backend, integration  
**Review cycle**: 1 of 2 maximum  
**Repair attempt reviewed**: EG2-R1 attempt 1 of 2 maximum  
**Overall rating**: REQUEST CHANGES / GOVERNANCE HARD STOP

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ❌ Weak | Public DTO boundaries still accept malformed self-consistent data and dossiers still freeze invalid nested contracts. |
| Security | ❌ Weak | PEM private-key content survives bounded prose processing and enters manifest bytes/digest. |
| Scalability | ⚠️ Adequate | Delta lookup remains indexed and no unbounded hot path was found; correctness defects dominate. |
| Maintainability | ❌ Weak | Shallow per-DTO parsers duplicate incomplete validation and create a misleading trust boundary. |
| Code Quality | ❌ Weak | Repair claims and tests materially overstate the behavior implemented. |
| Integration | ❌ Weak | Same-batch dossier continuity, portable identity, and normative delta semantics remain incomplete. |
| Economy / Critical Judgment | ⚠️ Adequate | No dependency or Batch C abstraction was added, but security/completeness cannot be traded for economy. |

## Findings

### BLOCKER

#### B-B1 — Security: private-key material persists through summary and evidence excerpt

- **Anchor**: REQ-CONTRACT-005; EG2-R1 B-B1; Design redaction rules.
- **Files**: `packages/sdd-runtime/src/contracts/canonical.ts:60-66`, `packages/sdd-runtime/src/contracts/failure-manifest.ts:15-33`.
- **Evidence**: `finding()` deliberately excludes `summary` and evidence `excerpt` from `assertNoUnsafeDiagnosticContent()`. `redactBoundedText()` recognizes bearer/token/password/secret/API-key forms but not PEM private-key markers. A fresh public-builder probe persisted both `-----BEGIN PRIVATE KEY-----` and `PRIVATE_KEY_MATERIAL` in serialized `FailureManifestV1` bytes, so the secret also influences the manifest digest.
- **Required correction**: reject or structurally redact every credential/private-key/cookie/auth-header form before hashing. Exact safe bytes must contain neither raw material nor a raw-secret-derived digest.

#### B-B2 — Integration: delta semantics still omit regression weighting and exact required coverage

- **Anchor**: REQ-DECISION-001–002; Positive progress definition; EG2-R1 B-B2; Design deterministic delta decision table.
- **Files**: `packages/sdd-runtime/src/orchestrator/failure-delta.ts:5-29`, `packages/sdd-runtime/src/contracts/failure-delta.ts:4-9`.
- **Evidence**: a low-to-high same-identity regression is bucketed as `regressed`, but `weightedMovement` is only `priorRisk.weighted - currentRisk.weighted` (`1 - 100 = -99`). The required telemetry weighting applies a `2x` multiplier to regressed findings; no such computation exists. The repair test asserts only bucket membership and `progress`, not exact risk vectors/movement or a reopened case.
- **Required correction**: implement and exactly test all normative buckets, reopened/regressed and unrelated-baseline cases, lexicographic safety dominance, and the specified regression-weighted telemetry movement.

#### B-B3 — Integration: same-batch dossiers accept malformed nested issued decisions

- **Anchor**: REQ-CONTRACT-002; REQ-DECISION-006; EG2-R1 B-B3; Design dossier and intent integrity.
- **File**: `packages/sdd-runtime/src/contracts/execution-dossier.ts:17-39`.
- **Evidence**: `validate()` checks `decision.batchId` but does not call the decision parser or verify its supplied digest, ID, enums, arrays, freshness, terminal guard, or nested intents. `issue()` validates supplied digests only for lane, verification, and causal context. A fresh probe created and froze a dossier containing a same-batch decision with an unrelated digest, invalid action/root cause, and non-array rationale codes.
- **Required correction**: parse every supplied nested issued DTO and validate exact schema, digest, ID, batch/change bindings, authorization, intent, and prior/current delta continuity before issuance or revision.

#### B-B4 — Data/Determinism: checkout-prefix identity still depends on a filename heuristic

- **Anchor**: REQ-CONTRACT-003; REQ-CONTRACT-006; EG2-R1 B-B4; Design normalization rules.
- **Files**: `packages/sdd-runtime/src/contracts/failure-manifest.ts:20-26`, `packages/sdd-runtime/src/contracts/canonical.ts:50-57`.
- **Evidence**: there is no injected authoritative project root or validated repository-relative identity. Root inference depends on the first `packages|apps|openspec|scripts|docs|assets` segment. Equivalent locations `/home/alice/repo/src/a.ts` and `/mnt/ci/repo/src/a.ts` normalize to different external-path hashes and produce different finding IDs. The repair test uses `packages/...`, so it proves only the heuristic's happy path.
- **Required correction**: derive identity from an authoritative root or validated repository-relative location and test varied repository layouts/extensions, not a fixed directory-name heuristic.

### MAJOR

#### B-B5 — Data Integrity: duplicate semantic evidence still inflates persisted evidence

- **Anchor**: REQ-CONTRACT-003; REQ-CONTRACT-006; REQ-DECISION-006; EG2-R1 B-B5.
- **File**: `packages/sdd-runtime/src/contracts/failure-manifest.ts:27-33`.
- **Evidence**: evidence entries are sorted but neither deduplicated nor rejected. A fresh public-builder probe supplied the same semantic evidence twice and received two persisted entries. Artifact-key and duplicate-finding rejection do not close the required duplicate-evidence case.
- **Required correction**: normalize or reject duplicate equivalent evidence before manifest digest and downstream risk use; assert the exact deterministic outcome.

#### B-B6 — API/Maintainability: public V1 boundaries remain shallow and fail open

- **Anchor**: REQ-CONTRACT-003; EG2-R1 B-B6; Design public/internal contract boundary.
- **Files**: `packages/sdd-runtime/src/contracts/{apply-batch,failure-delta,execution-decision,invocation-authorization,registry-intent,verification-state,causal-context,execution-lane,execution-dossier}.ts`.
- **Evidence**: the new test sends only `{ schema: "unknown-v1", extension: true }` to each parser. It does not test exact-shape malformed values. A self-hashed `FailureDeltaV1` with `resolved: "not-array"`, malformed risk vectors, string movement, and otherwise exact keys was accepted and frozen. `buildApplyBatchContractV1()` also accepted and persisted an unknown top-level extension. Static inspection shows similarly partial enum, nested-record, string, timestamp, digest-array, prototype, and cross-field validation in the other parsers. Root `index.ts` no longer exports canonical runtime helpers, but export narrowing does not repair boundary validation.
- **Required correction**: give every public V1 DTO a closed schema parser/builder that validates all scalar, enum, collection, nested, prototype, digest, and cross-field constraints before clone/hash/freeze; add exact supported-versus-internal export assertions.

#### B-B7 — Test Quality: adversarial acceptance remains subset-only and permits false closure

- **Anchor**: REQ-VERIFY-005; EG2-R1 B-B7; Design TDD architecture.
- **File**: `packages/sdd-runtime/src/contracts/batch-b-repair.test.ts:32-88`.
- **Evidence**: five tests combine seven findings but omit the required PEM/private-key prose case, exact manifest bytes, regression-weighted risk movement, reopened delta, arbitrary checkout layout/authoritative-root case, duplicate evidence, malformed exact-shape DTO table, nested decision digest validation, exact API-surface comparison, and legacy adapter outcome. The parser loop checks only rejection of an unknown schema and uses broad `toThrow()` assertions. Existing tests passed 12/12 while the independent probes above reproduced B-B1–B-B6.
- **Required correction**: replace subset claims with exact public-boundary tables for each required input/output/error, including legacy behavior and deep immutability.

## Original Finding Disposition B-B1–B-B7

| Original finding | Current disposition | Fresh evidence |
|---|---|---|
| B-B1 | OPEN — unchanged BLOCKER | PEM private-key bytes persist through summary/excerpt. |
| B-B2 | OPEN — unchanged BLOCKER | Required `2x` regression weighting absent; exact delta matrix incomplete. |
| B-B3 | OPEN — unchanged BLOCKER | Malformed same-batch decision accepted into frozen dossier. |
| B-B4 | OPEN — unchanged BLOCKER | Equivalent `src/...` locations under different prefixes yield different IDs. |
| B-B5 | OPEN — unchanged MAJOR | Duplicate semantic evidence persists twice. |
| B-B6 | OPEN — unchanged MAJOR | Malformed self-hashed delta and unknown Apply-batch extension accepted. |
| B-B7 | OPEN — unchanged MAJOR | Passing tests omit the adversarial cases that reproduce B-B1–B-B6. |

## Failure-Set Delta

- **Original set**: `{B-B1, B-B2, B-B3, B-B4, B-B5, B-B6, B-B7}`.
- **Current exact remainder**: `{B-B1, B-B2, B-B3, B-B4, B-B5, B-B6, B-B7}`.
- **Cardinality**: `7 → 7`.
- **Strictly shrinking**: no.
- **New related regression**: no; the defects are continuations of the original stable subjects.
- **Hard-stop conditions**: secret leakage and unchanged failure set.

## Security and Redaction

FAIL. Unknown finding/evidence fields and the five original identifier-style seeds are rejected, but private-key material in accepted prose remains persistable and hash-affecting. This violates deny-by-default structural redaction and prohibits attempt 2 under the active governance.

## Delta Semantics

FAIL. Named buckets exist and a new related finding forces negative progress, but regression weighting and the complete exact reopened/baseline/risk-vector oracle remain absent. Unrelated baseline receives no scalar credit only because every new related finding is treated as regression; the required complete semantics are not established.

## Dossier, Identity, and Collision Integrity

FAIL. Direct cross-batch decision rejection works, but malformed same-batch nested decisions are accepted. Identity is stable only for recognized repository-marker paths, not authoritative-root variation. Artifact and duplicate-finding collisions reject, but duplicate evidence remains accepted.

## Parsers, API, and Compatibility

FAIL. Outputs are cloned/frozen and canonical helpers are internal at the root, but parsers are not fail-closed for exact-shape malformed DTOs. No pre-Batch-B export was observed removed, and the legacy adapter was not modified, but the repair test does not execute the required exact compatibility oracle.

## Test and Verification Audit

- Focused Review run: **12 passed, 0 failed** across four Batch B files.
- Workspace typecheck: **passed**.
- Broad Review run: **3324 passed, 4 failed** across 187 files. Three failures exactly match the recorded `prepare-release` stale-build-metadata cases. The fourth is `Binary smoke tests > doctor runs and reports diagnostics`, the separately recorded repository baseline timeout in `openspec/baseline-health.yaml`; it is unrelated to EG2-R1, but the Apply claim of exactly three broad failures was not reproduced.
- Generated SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no generated byte change was made by Review.
- No Batch C/later implementation, generated edit, excluded-WIP intersection, or new unrelated product path was found in EG2-R1's declared path set. Pre-existing authorized workspace changes remain outside repair credit.

## Governance Decision

Review cycle 1 is failed. Append only `repair.review.failed`; do not append `repair.review.completed`, `review.batch-b.completed`, or `apply.batch-b.completed`. The active Batch B repair is hard-stopped. Attempt 2 is **ineligible** because the remainder is unchanged and secret leakage persists. Batch C remains blocked.
