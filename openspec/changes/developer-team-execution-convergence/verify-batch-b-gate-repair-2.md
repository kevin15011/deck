# Verify Report: Batch B Gate Repair 2

## Verdict

**FAIL**

Gate Repair 2 closes the bidirectional relationship-transition defect and the combined protected-placement acceptance case. It does not close the complete append-only prefix contract or the exact package-root export oracle. A fresh public-entrypoint reproducer showed that reordered `priorDecisionDigests` are silently normalized and accepted during both dossier issuance and parsing at revision depth 3. Static inspection also showed that the committed export test still performs 25 selected function/internal assertions instead of exact `Object.keys()` equality over the complete pre-Batch-B-plus-approved runtime surface.

Registry mode is explicitly deferred. This report is the only repository file written by Verify.

## Finding Disposition B-B1–B-B7

| Finding | Disposition | Fresh independent evidence |
|---|---|---|
| B-B1 | CLOSED | Four individually named package-root PEM placement cases cover summary, excerpt, remediation, and transcript with exact errors. Secret/public matrix and broad suites pass. |
| B-B2 | CLOSED | Both same-identity relationship transitions reject through `computeFailureDeltaV1` and authoritative `parseFailureDeltaV1` with exact `invalid-evidence: finding relationship transition`; complete risk/delta tests remain green. |
| B-B3 | **OPEN — BLOCKING** | Truncation and mutation reject, and registry-intent reorder rejects, but reordered causal prior-decision prefixes are accepted in both revision issuance and parsing because the causal-context boundary normalizes the sequence before prefix validation. |
| B-B4 | CLOSED | Authoritative POSIX/Windows path and identity matrix remains green. |
| B-B5 | CLOSED | Exact deduplication, reorder identity, collision rejection, and no-inflation matrix remains green. |
| B-B6 | CLOSED | Public recursive parsers, authoritative delta recomputation, malformed-wire rejection, and freeze tests remain green. |
| B-B7 | **OPEN — BLOCKING** | Combined placement case is closed and prohibited aggregate/filler constructs are absent, but no committed test compares the complete package-root runtime key set exactly; selected positive checks and four selected internal exclusions cannot detect extra exports. |

## Gate-Repair-2 Findings

| Fingerprint | Result | Evidence |
|---|---|---|
| `B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1` | CLOSED | Independent compute and parser checks passed in both directions with the stable exact rejection. |
| `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1` | **OPEN — BLOCKING** | Independent depth-3 issuance and parsing accepted reordered `priorDecisionDigests`; this is the same append-only-prefix identity, not a new unrelated finding. |
| `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1` | **OPEN — BLOCKING** | `batch-b-replacement.test.ts` has 25 individual function checks and four internal-name exclusions but zero exact package-root key-equality assertions. |
| `B-B7-COMBINED-PLACEMENT-CASE-v1` | CLOSED | Summary, excerpt, remediation, and transcript are four separately named exact package-root tests. |

## Exact Blocking Set

`{B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1, B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1}`

### Structured Failure Manifest

| Field | B-B3 append-only prefix | B-B7 export oracle |
|---|---|---|
| Normalized fingerprint | `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1` | `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1` |
| Severity | CRITICAL | CRITICAL for the mandatory final acceptance gate |
| Contract / requirement | REQ-CONTRACT-004; corrective Design append-only revisions and exact dossier matrix | REQ-VERIFY-005; EG2-R3C exact export matrix; corrective Design root-export equality |
| Evidence command | Independent package-root `bun -e` dossier corpus | Static audit of all `*batch-b*.test.ts` plus package-root key enumeration |
| Latest result | Prior-decision reorder accepted during issuance and parsing at depth 3 | Runtime has 57 keys and all 24 approved new Batch B values, but committed tests contain zero exact complete-key equality assertions |
| Owner / routing | General Apply; causal-context/dossier boundary | General Apply; Batch B package-root acceptance owner |
| Suspected scope | `contracts/causal-context.ts`, `contracts/execution-dossier.ts`, exact dossier tests | `contracts/batch-b-replacement.test.ts` or the dedicated package-root export test |
| Changed files when known | Gate Repair 2 changed dossier source/test but not causal sequence normalization | Gate Repair 2 changed the replacement test only |
| Retry count | Gate Repair 2 fresh Verify cycle 1 | Gate Repair 2 fresh Verify cycle 1 |
| Previous attempt summary | Length checks fixed truncation, but set-style canonicalization still erases prior-decision order before prefix comparison | Selected export assertions expanded to all approved functions but did not become complete root-key equality |
| Generated classification | Not generated | Not generated |
| Next verification action | Preserve prior-decision sequence semantics and add exact depth-3 issuance/parser reorder cases | Assert exact sorted package-root keys equal the frozen pre-Batch-B set plus approved Batch B values |

## Independent Reproducers

- Relationship transition corpus: **4/4 passed** — compute and parser paths, `unrelated_baseline → batch_related` and `batch_related → unrelated_baseline`, all rejected with the exact stable message.
- Dossier depth-3 corpus exercised truncation, reorder, and mutation for registry-intent and prior-decision prefixes in issuance and parsing.
  - Registry-intent truncation/reorder/mutation: all issuance and parsing checks rejected exactly.
  - Prior-decision truncation/mutation: issuance and parsing rejected exactly.
  - Prior-decision reorder: **issuance accepted unexpectedly; parsing accepted unexpectedly**.
  - A valid complete revision-1/revision-2/revision-3 chain parsed successfully; the focused public test also confirms exact full-chain equality.
- Package-root enumeration found **57 runtime keys**, all **24 approved new Batch B runtime values**, and none of the four named canonical internals. This establishes current runtime presence but does not replace the required committed exact complete-key oracle.

## Focused/Affected Evidence

| Check | Result |
|---|---|
| Gate Repair 2 target files | 43 pass, 0 fail, 77 assertions |
| Four Batch B acceptance files | 75 pass, 0 fail, 130 assertions |
| Contracts + delta + dossier + public matrix | 175 pass, 0 fail, 380 assertions across 15 files |
| Full `packages/sdd-runtime` | 359 pass, 0 fail, 857 assertions across 30 files |
| Full `packages/core` | 1474 pass, 0 fail, 5228 assertions across 55 files |
| Legacy/export/registry matrix | 158 pass, 0 fail, 484 assertions across 11 files |
| Changed-file Serena diagnostics | No warning/error diagnostics for the four Gate Repair 2 source/test paths |

Static audit of the four Batch B acceptance files found zero `parserCases`, `.every()`, `for`/`while` aggregate loops, broad no-message `toThrow()`, `toHaveLength()`, or modulo evidence. It found zero exact package-root key-equality assertions. The only `Object.keys()` uses are local canonical-hash helpers, not an export oracle.

## Typecheck

`bunx tsc --noEmit` passed with exit 0 and no diagnostics.

The repository binary build was not run because it writes `dist/**`, while this invocation explicitly permits only this report file to be written. The requested typecheck and all runtime test gates were executed.

## Broad Evidence

`timeout 900s bun test --timeout 30000` completed within the required 900000 ms wall allowance:

- 3398 pass.
- 0 fail.
- 11901 assertions across 190 files.
- 57.29 seconds.
- No timeout, binary-doctor failure, quarantine use, or unapproved failure.

The broad green result does not override the two independently demonstrated acceptance/contract blockers.

## Generated/Scope Audit

- Canonical generated skill SHA-256 before/after the generated test: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- Build-info SHA-256 before/after: `d664532190265f72bdbcaa8df5a16358c0cf71dccf7201d85e34b876124e0a6e`.
- Generated canonical test: 19 pass, 0 fail, 326 assertions; both tracked files were byte-identical before/after.
- Current worktree contains preserved prior Batch A and broader change paths already classified by official evidence. Gate Repair 2's declared implementation scope is limited to `failure-delta.ts`, `execution-dossier.ts`, `batch-b-replacement.test.ts`, and `batch-b-direct-recovery.test.ts`, plus current-change governance artifacts.
- No Gate Repair 2 generated/build-info edit, dependency, Batch C/later implementation, excluded WIP, historical archive rewrite, or unrelated product expansion was identified.
- Registry base files were read only: state SHA-256 `afe189d097f1882ec3602c43e405be36284e83d10750ade72cc0ac591a3a9444`; events SHA-256 `49a458528fb1e2d9adb3ebe092bee76ee0d4c4f50ca00a10816c9e64e787311b`.

## Artifact

`openspec/changes/developer-team-execution-convergence/verify-batch-b-gate-repair-2.md`

## Artifact Evidence

- File existence, non-empty bytes, and SHA-256 were checked after the final write and are returned with this report.
- Verify wrote no source, test, generated output, shared registry, progress, incident, or other artifact.

## Phase

`verify`

## Status

`failed`

## Registry Write

`deferred`

## Registry Intent

- **Phase:** `verify`
- **Status:** `failed`
- **Event:** `verify.batch-b.gate-repair-2.failed`
- **Artifact:** `verify-batch-b-gate-repair-2.md`
- **Provenance:** agent `deck-developer-verify`; model `openai/gpt-5.6-sol`; timestamp `2026-07-15T22:35:32.080Z`; fresh independent Batch B Gate Repair 2 verification; official OpenSpec/source/test evidence authoritative; adaptive memory advisory only; registry-deferred
- **Base state SHA-256:** `afe189d097f1882ec3602c43e405be36284e83d10750ade72cc0ac591a3a9444`
- **Base events SHA-256:** `49a458528fb1e2d9adb3ebe092bee76ee0d4c4f50ca00a10816c9e64e787311b`

## Blockers

1. Preserve `priorDecisionDigests` as a meaningful append-only sequence and reject reordered prefixes during both revision issuance and parsing at depth 3+.
2. Replace selected export assertions with exact complete package-root runtime key equality covering every pre-Batch-B export plus the approved Batch B values and excluding every unintended internal.

Batch B remains unaccepted. Return to Apply; Verify made no implementation changes.
