# Auxiliary Verify Report: Batch B EG2-R3B

## Summary

**Verdict**: FAIL  
**Change**: `developer-team-execution-convergence`  
**Slice**: EG2-R3B, adaptive launch 2/3  
**Verified failure-set delta**: `{B-B1, B-B2, B-B3, B-B4, B-B5, B-B6, B-B7}` → `{B-B1, B-B2, B-B3, B-B7}` (`7 → 4`)  
**Continuation**: Hard stop. R3C is not eligible.

The focused and affected suites are green, and the original enumerated B-B1 corpus, B-B4, B-B5, and B-B6 public-entrypoint reproducers pass. The required exact remainder is nevertheless not `{B-B2, B-B3}`. A fresh package-root probe found that a syntactically JWT-like compact credential with shorter valid base64url-like segments is accepted and persisted in all four protected prose placements, reopening B-B1 as a security finding. The mandatory public matrix also remains non-compliant: it omits the two supported open parsers, uses broad `toThrow()` assertions, and aggregates parser/mutation cases in loops that can hide later failures. B-B7 therefore remains open.

## Public Matrix Assessment

The package root exposes 20 V1 build/parse entrypoints:

- Builders: ApplyBatch, FailureManifest, ExecutionDecision, AuthorizationReference, InvocationAuthorizationClaims, RegistryIntent, StagedVerificationState, CausalContext, and LaneDecision.
- Parsers: the same nine leaf families, plus FailureDelta and ExecutionDossier.

`batch-b-r3a-public-matrix.test.ts` exercises the nine leaf builder/parser families but does not import or classify `parseFailureDeltaV1` or `parseExecutionDossierV1`, even as exact RED rows for B-B2 and B-B3. It also contains broad no-message `toThrow()` assertions at lines 111, 123, and 124; ten aggregate loops, including parser and mutation loops; one selected scalar per parser rather than independently executing every applicable category per parser; and a freeze assertion that checks only the root and immediate children. These are directly contrary to the continuation contract in `tasks.md:417-421`, which forbids broad `toThrow`, requires one exact oracle per case, and says aggregate loops must not hide later failures.

The reported `14 pass / 183 assertions` is therefore a green test result, not evidence of a complete corrective Design matrix.

## Finding Disposition

| Finding | Result | Independent evidence |
|---|---|---|
| B-B1 | OPEN — CRITICAL | All 36 original corpus/placement cases reject with the constant safe error and no raw/hash-derived error influence. However, `eyJhbGciOiJIUzI1NiJ9.RAW_PAYLOAD.RAW_SIG` is accepted and persisted in `summary`, `remediationCode`, evidence `excerpt`, and evidence `resultCode`. The Design requires JWT-like compact credentials to be detected before hashing. |
| B-B2 | OPEN — expected remainder | `parseFailureDeltaV1` remains public and no delta closure is claimed or implemented in R3B. It is absent from the mandatory matrix. |
| B-B3 | OPEN — expected remainder | `parseExecutionDossierV1` remains public and no dossier/reference/revision closure is claimed or implemented in R3B. It is absent from the mandatory matrix. |
| B-B4 | CLOSED | Independent package-root probe confirmed identical finding ID, fingerprint, and relative locations across arbitrary POSIX and case-varied Windows roots; five external/traversal/drive-relative/double-separator/NUL paths rejected. |
| B-B5 | CLOSED | Independent package-root probe confirmed equivalent evidence collapses from three entries to two, reordered input produces identical evidence and manifest digest, and semantic collision rejects exactly. |
| B-B6 | CLOSED for the nine leaf boundaries | Independent package-root probe covered all nine leaf parsers for canonical wire, unchanged input, plain recursive clone/freeze, unknown fields, prototypes, NaN/Infinity, non-array and sparse-array input, and malicious nested evidence. Exact assertions passed. |
| B-B7 | OPEN — CRITICAL | The mandatory independently executing public matrix is incomplete and contains prohibited broad/aggregate evidence. The short JWT-like credential gap was not represented and was hidden by the selected corpus. |

## Compliance Matrix

| Requirement / gate | Method | Result | Notes |
|---|---|---|---|
| Complete public parser × mutation matrix | Static inventory plus source-level matrix audit | FAIL | Two public parsers omitted; broad assertions and aggregate loops remain. |
| B-B1 secret safety and zero persisted influence | Package-root inline reproducer | FAIL | Original 36 cases pass; a new JWT-like credential persists in four protected placements. |
| B-B4 authoritative roots and unsafe paths | Package-root inline reproducer | PASS | Arbitrary POSIX/Windows identity and five rejection cases pass. |
| B-B5 evidence identity/dedup/conflict | Package-root inline reproducer | PASS | Exact dedup, byte/digest equality, and collision rejection pass. |
| B-B6 recursive DTO boundaries | Package-root inline reproducer | PASS | Nine leaf parsers pass the independently exercised categories. |
| B-B7 exact adversarial public evidence | Matrix audit plus public probes | FAIL | Matrix structure violates the normative continuation amendment. |
| Only B-B2/B-B3 remain open | Artifact/source audit | FAIL | Verified exact set is `{B-B1, B-B2, B-B3, B-B7}`. |
| No hidden delta/dossier closure | Apply/source/public export audit | PASS | B-B2/B-B3 remain explicit and no R3C marker or closure claim exists in package code. |
| Affected tests and typecheck | Commands below | PASS | All invoked suites and typecheck passed. |
| API and legacy compatibility | Public index, legacy harness, core fixtures | PASS | 1/1 public-index, 84/84 legacy, and 2/2 core compatibility tests passed. |
| Generated and scope discipline | SHA-256 and changed-path/R3C marker audit | PASS | Canonical generated hash is unchanged; no R3C or Batch C package marker found. |

## Independent Reproducers

All custom probes imported only `packages/sdd-runtime/src/index.ts`.

1. **B-B1 original corpus**: 9 credential forms × 4 protected placements = 36/36 exact safe rejections; errors contained neither raw values nor SHA-256 hex derived from them.
2. **B-B1 new security case**: a shorter JWT-like compact credential was accepted and present in issued manifest bytes for all four placements.
3. **B-B4**: arbitrary `/tmp/arbitrary/checkout` and `Z:\\CI\\checkout` roots produced equal identity; five unsafe path forms rejected.
4. **B-B5**: duplicate equivalent evidence persisted exactly two semantic entries; reordered input had identical digest; conflicting semantic duplicate rejected with `invalid-evidence: evidence-collision`.
5. **B-B6**: nine leaf parsers preserved canonical wire, did not mutate input, returned recursively frozen plain data, and rejected the independently supplied unknown-field, prototype, non-finite number, non-array, sparse-array, and malformed nested cases.

## Test and Typecheck Evidence

| Command | Result |
|---|---|
| `bun test packages/sdd-runtime/src/contracts/batch-b-r3a-public-matrix.test.ts` | 14 pass, 0 fail, 183 assertions |
| `bun test packages/sdd-runtime/src/contracts` | 124 pass, 0 fail, 465 assertions |
| `bun test packages/sdd-runtime` | 310 pass, 0 fail, 953 assertions |
| `bun test packages/core` | 1474 pass, 0 fail, 5228 assertions |
| Legacy fixture/incident/pipeline/artifact-state focused command | 84 pass, 0 fail, 265 assertions |
| `bun test packages/sdd-runtime/src/index.test.ts` | 1 pass, 0 fail |
| Core registry/prompt compatibility fixtures | 2 pass, 0 fail |
| `bunx tsc --noEmit` | PASS, exit 0 |
| Serena diagnostics on matrix, public index, and affected contract files | No errors; two unused-value hints and one intentional nonexistent-file lookup during diagnostics |

## Security, API, Legacy, Scope, and Generated Audit

- **Security**: FAIL because JWT-like compact credential detection is incomplete and accepted bytes influence the issued manifest digest.
- **API**: Existing public-index compatibility test passes; canonical internals remain absent from the root. The matrix inventory omission is a verification-contract failure, not an observed export deletion.
- **Legacy**: Focused legacy and core compatibility suites pass with no regression.
- **Scope**: No `R3C`, `EG2-R3C`, or `in-progress-r3c` marker exists under `packages/**`. No Batch C implementation was observed. R3B's declared changed-file list remains limited to the authorized kernel/leaf files and matrix test.
- **Generated**: `packages/core/src/skills/external/content.generated.ts` SHA-256 is `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`, matching the governed baseline.

## Findings

### CRITICAL

1. **R3B-VERIFY-SEC-JWT-LIKE-ACCEPTED-v1**  
   Contract: corrective Design secret detector and B-B1.  
   Latest result: FAIL — public `buildFailureManifestV1` accepts and persists the short JWT-like credential in four protected placements.  
   Classification: new related security fingerprint; B-B1 remains open.  
   Suspected scope: `packages/sdd-runtime/src/contracts/canonical.ts` secret value detector and exact matrix corpus.  
   Retry count: launch 2/3 consumed; no per-slice retry.  
   Next verification action: none under this override; R3C is blocked because the security hard stop expires continuation.

2. **R3B-VERIFY-PUBLIC-MATRIX-INCOMPLETE-v1**  
   Contract: `tasks.md:417-421`, corrective Design public matrix, B-B7.  
   Latest result: FAIL — two supported parsers are absent, three assertions are broad `toThrow()`, and aggregate loops can hide later parser/mutation failures.  
   Classification: same matrix-completeness fingerprint carried from R3A/EG2-R2; B-B7 remains open.  
   Suspected scope: `packages/sdd-runtime/src/contracts/batch-b-r3a-public-matrix.test.ts`.  
   Retry count: R3A launch 1/3 and R3B launch 2/3 consumed; no retry authorized.  
   Next verification action: none under this override; a new explicit governance decision would be required.

### WARNING

None.

### SUGGESTION

None.

## Governance Decision

The continuation condition is not met. The exact open set is not strictly `{B-B2, B-B3}`, and a new related security failure exists. Record `verify.batch-b.r3b.failed`, retain phase `apply`, set a hard-stop verification-failed status, preserve launch accounting, expire the adaptive continuation, and keep EG2-R3C, EG3-T1, and Batch C blocked.
