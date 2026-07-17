# Final Review: Batch B Gate Repair 3

## Verdict

FAIL. Blocking findings remain for Batch B Gate Repair 3. Intended event: `review.batch-b.gate-repair-3.failed`.

## Findings

### BLOCKER — B-B3-PARSER-REGISTRY-TRUNCATION-ORACLE-MISSING-v1

- **Category:** Architecture / Data Integrity / Test Quality
- **Evidence:** `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts:72-76` covers issuance-side registry-intent truncation, and `:95-103` covers only a valid registry-intent parser append chain. There is no independently named `parseExecutionDossierV1` rejection case that forges a self-hashed revision-3 wire dossier with a truncated `registryIntents` prefix and passes the complete predecessor array. A static audit of test names found zero parser-side registry prefix/truncation rejection tests, while prior-decision parser rejection tests exist at `:128-153`.
- **Why blocking:** Gate Repair 2 explicitly required parser-side truncation oracles for both protected append-only collections. Gate Repair 3 closes prior-decision parser coverage but leaves registry-intent parser truncation as a positive round-trip only, which is a filler shortcut rather than exact negative evidence.
- **Recommendation:** Add an independently named package-root test that builds a valid revision-3 chain with appended registry intents, forges the revision-3 wire value to truncate `registryIntents`, recomputes only the dossier digest, calls `parseExecutionDossierV1(forged, [rev1, rev2])`, and asserts exactly `invalid-evidence: registry intent prefix`.

### BLOCKER — B-B3-UNSAFE-HISTORY-SLICING-v1

- **Category:** Architecture / Data Integrity
- **Evidence:** `packages/sdd-runtime/src/contracts/execution-dossier.ts:70-78` validates `previous` with `historyForPrevious = history.length > expectedPredecessorCount ? history.slice(0, expectedPredecessorCount) : history`. This silently discards any supplied history suffix before validation. Gate Repair 3 tests intentionally pass histories such as `[d1, d2]` to revise from `d2` and rely on slicing rather than an exact predecessor-history contract.
- **Why blocking:** The review gate explicitly called out “no unsafe history slicing or trust of unvalidated predecessors.” The corrective design requires authoritative revision parsing and exact append-only chain validation. Silently ignoring extra history entries is a silent repair/normalization of caller evidence and can hide malformed or mismatched supplied predecessor material instead of rejecting it.
- **Recommendation:** Replace suffix slicing with an explicit contract. Either require `history.length === previous.revision - 1` and reject extras, or, if legacy callers may provide a full chain including `previous`, first validate that the final supplied item is byte-identical to `previous`, validate the whole chain, and reject any extra/mismatched suffix. Add exact tests for extra/mismatched history rejection and for the accepted canonical history form.

## Finding Disposition B-B1–B-B7

- **B-B1:** CLOSED in this review. Secret/prose protections and current short JWT-like cases are represented; no new concrete B-B1 defect found.
- **B-B2:** CLOSED in this review. Relationship identity, unrelated-baseline zero credit, risk vectors, lexicographic precedence, regression penalty, and authoritative delta recomputation are coherent.
- **B-B3:** OPEN. Parser registry-intent truncation evidence is still missing, and revision issuance uses unsafe history slicing.
- **B-B4:** CLOSED in this review. Path identity and unsafe path rejection remain coherent.
- **B-B5:** CLOSED in this review. Evidence deduplication, collision rejection, and finding identity handling remain coherent.
- **B-B6:** CLOSED in this review. Recursive parser boundaries, canonical digest checks, immutability, and malformed nested DTO rejection remain coherent.
- **B-B7:** CLOSED in this review. The package-root export oracle now uses exact literal equality over 57 unique runtime keys and preserves the observed legacy surface.

## Gate-Repair-3 Findings

- Gate Repair 3 resolves the exact 57-key export oracle defect.
- Gate Repair 3 partially resolves prior-decision depth-3 issue/parse coverage.
- Gate Repair 3 does not fully resolve B-B3 because registry-intent parser truncation lacks the required negative oracle and the implementation added silent history slicing.

## Security

No new raw-secret exposure, credential hashing, injection, or path traversal issue was found in the reviewed Gate Repair 3 code. The remaining B-B3 issues are governance/data-integrity risks: registry intents and dossier predecessor evidence are part of the trust boundary and must not be silently normalized or left without parser-side negative coverage.

## Delta/Risk

Failure delta and risk handling are acceptable in this review: authoritative manifests are required, unrelated baselines do not receive movement/repair credit, relationship transitions are rejected, and the lexicographic vector includes security hard stops, critical, high, uncovered requirements, medium, and low before progress is declared.

## Dossier/Revision

Not acceptable. Registry-intent and prior-decision prefix guards exist in production parsing, but the registry-intent parser branch is not protected by an exact negative depth-3 test. Revision issuance also uses unsafe suffix slicing before predecessor validation.

## Parsers/API/Legacy

Parser quality remains blocked by the missing registry-intent truncation oracle. API/legacy surface is acceptable: `batch-b-replacement.test.ts` asserts exact sorted equality against 57 unique package-root runtime keys and keeps canonical helpers absent from the root.

## Test Quality

Not acceptable. The registry-intent parser case is represented only by a valid round-trip, not by the required forged negative case. This is exactly the kind of broad/positive/filler evidence the prior gate rejected.

## Maintainability

Adequate except for the history-slicing branch. The slicing comment documents a workaround rather than a durable public contract, and the behavior makes future maintenance risky because callers cannot tell whether supplied history was validated or silently ignored.

## Scope Audit

No Batch C/later implementation, dependency addition, build-info edit, or new generated-output drift was attributed to Gate Repair 3. The broader worktree still contains historical/excluded WIP and generated files from earlier authorized work, but this review attributes blocking findings only to the Gate Repair 3 dossier/test changes.

## Artifact

`openspec/changes/developer-team-execution-convergence/review-batch-b-gate-repair-3.md`

## Artifact Evidence

- Official artifacts reviewed: `spec.md`, `tasks.md`, `design.md`, `design-repair-batch-b.md`, `apply-progress.md`, prior Batch B Review/Verify reports, state/events registry files, and Gate Repair 3 evidence.
- Source/tests reviewed: `contracts/execution-dossier.ts`, `contracts/causal-context.ts`, `contracts/failure-delta.ts`, `orchestrator/failure-delta.ts`, `contracts/failure-manifest.ts`, `contracts/batch-b-direct-recovery.test.ts`, `contracts/batch-b-replacement.test.ts`, and `index.ts`.
- Static audit facts: 38 direct-recovery tests; zero parser-side registry-intent prefix/truncation rejection test names; two parser-side prior-decision prefix/order rejection test names; exact export expected set has 57 unique keys.
- Report byte count self-check: 7809 bytes.

## Phase

review

## Status

changes_requested

## Registry Write

deferred

## Registry Intent

artifact `review-batch-b-gate-repair-3.md`, phase `review`, status `changes_requested`, event `review.batch-b.gate-repair-3.failed`

## Blockers

- `B-B3-PARSER-REGISTRY-TRUNCATION-ORACLE-MISSING-v1`
- `B-B3-UNSAFE-HISTORY-SLICING-v1`
