# Repair Incident Ledger: Developer Team Execution Convergence

## Identity and State

- Schema: `repair-incident-v1`
- Fingerprint: `INC-BATCH-A-GEN-SKILL-SUPPORT-ORDER-v1`
- Change: `developer-team-execution-convergence`
- Batch: A
- Related tasks: `EG1-T1`, `EG1-T2`, repair tasks `EG1-R1` and `EG1-R2`
- Operating mode: `automatic`
- State: `resolved/review-accepted`
- Lifecycle effect: auxiliary Apply governance only; this is not a new SDD phase and does not advance `currentPhase` beyond `apply`.

## Audited Evidence

1. `packages/core/src/skills/external/content.generated.ts` has ordering-only drift; no canonical skill source changed.
2. `scripts/generate-skill-bundle.ts` recursively consumes unsorted `readdirSync()` results, so output order is not deterministic.
3. The generated-bundle idempotency test invokes the canonical generator against the tracked generated file and can leave it dirty when the test fails.
4. EG1-T2 validates telemetry shape but not runtime value; baseline rows are static instead of recorded from bounded executions; adapter probes use `{}` rather than adapter-owned capability surfaces.
5. EG1-T1 is mostly complete, but some scenario fixtures assert labels rather than actual legacy behavior.
6. Three `scripts/prepare-release.test.ts` failures are unrelated stale ignored build metadata (`1bba98b` versus current HEAD), not Batch A regressions.
7. No excluded WIP or historical OpenSpec path changed.

## Governance Budgets

| Control | Bound |
|---|---|
| Operating mode | Automatic |
| Initial decision | `replan` |
| Modifying repair attempts | 1 |
| Fingerprint attempts | 1 |
| Blind second modifying attempt | Prohibited |
| Post-repair verification cycles | Maximum 2 |
| Cycle 1 | Targeted and affected checks |
| Cycle 2 | Broad checks plus canonical double-regeneration and drift check |
| Freshness | Fresh independent Review required after repair |

## evaluateRepairIncident-Oriented Decision

- Current outcome: `replan`.
- Rationale: the same bounded Batch A scope needs corrected acceptance evidence and deterministic generator/test isolation before another verification attempt; broad retry without that repair would repeat the fingerprint.
- Authorized transition: `active/replan` → one EG1-R1 modifying attempt → cycle 1 → cycle 2 → fresh independent Review.
- Success transition: mark the incident resolved, record clean generated drift and accepted Review, then unblock Batch B.
- Recurrence transition: repeated fingerprint or generated drift returns hard stop/escalation; no second modifying repair attempt.

## Allowed Scope

- Complete EG1-T2 runtime-value telemetry validation, fixture-derived bounded baseline recording, and meaningful adapter-owned capability probes.
- Strengthen only label-only EG1-T1 fixtures needed for claimed Batch A acceptance into assertions against actual legacy behavior.
- Sort every recursive generator traversal with `(a, b) => a < b ? -1 : a > b ? 1 : 0`.
- Make the idempotency test isolate writes or restore snapshotted original bytes in `finally`, without Git restore/discard.
- Run canonical generation after source repair and prove a byte-identical second output.
- Run targeted/affected verification, then broad verification plus drift check.
- If unchanged, retain stable quarantine evidence for exactly the three audited stale build-metadata test failures; do not claim them fixed.

## Prohibited Scope and Hard Stops

- Prompt convergence, broad EG7 work, Batch B contracts, or other later execution groups.
- Canonical skill-content changes or direct generated-file edits.
- Git restore, checkout-discard, reset, clean, or any destructive/discard operation.
- Build-info cleanup, regeneration, metadata fix, or weakening `scripts/prepare-release.test.ts`.
- Historical OpenSpec edits, other OpenSpec changes, `apply-progress.md`, excluded `runner-capability-standardization` WIP, commit `8c6d167`, or unrelated product scope.
- Hard stop immediately on repeated generated drift, canonical skill-content change, excluded-WIP intersection, or new unrelated product scope.

## Completion Evidence

- EG1-R1 red/green evidence and changed-path audit.
- Runtime-value telemetry, real bounded baseline, adapter-owned probe, and behavior-fixture tests pass.
- A deliberately failing idempotency-test path leaves tracked generated output byte-unchanged.
- First canonical regeneration reconciles only expected ordering; second regeneration is byte-identical with zero drift.
- Exactly the audited unrelated release failures, if persistent, have stable quarantine evidence and no repair credit.
- Fresh independent Review accepts the bounded repair.

## Attempt and Verification History

### EG1-R1 — modifying attempt 1 of 1

- Decision before modification: `replan`, as produced by the existing `evaluateRepairIncident()`-oriented no-progress semantics.
- Failure delta after modification: all five scoped deficiencies resolved; no related regression, excluded-scope intersection, canonical skill-content change, or new unrelated product path.
- Attempt budget: consumed (`0` remaining). Fingerprint budget: consumed (`0` remaining). No modifying retry is authorized.
- Changed implementation scope is recorded exactly in `apply-progress.md`.

### Verification cycle 1 of 2

- Focused repair suite: 32 passed, 0 failed.
- Affected runtime/core/OpenCode/Pi suite: 2,068 passed, 0 failed.
- Workspace typecheck and Serena diagnostics: passed.

### Verification cycle 2 of 2

- Broad repository suite: 3,309 passed, exactly 3 quarantined unrelated failures.
- The three failure names and the `1bba98b` versus `652a9b0ed14efc995300b9c982950a70b7792e98` mismatch are unchanged from audited evidence.
- Workspace typecheck passed.
- Canonical generated output SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` before/after both post-broad generator invocations; second output was byte-identical.

### Next governed transition

- Modification and verification are complete. Fresh independent Review ran and rejected Batch A.
- Review evidence is recorded in `incident-review-batch-a.md`: label-only scenario fixtures still do not invoke actual legacy behavior, and the generated-bundle test no longer compares first canonical output with the tracked pre-test bytes.
- Attempt 1/1 and verification cycles 2/2 remain consumed. No automatic or blind second repair attempt is available.
- Hard-stop disposition: Batch A is not accepted; Batch B remains blocked pending explicit replanning and new modification authorization.

## Higher-Level Replan and Explicit Human Override

### Override record

- Exact authorization: `Autorizo el replan superior de Batch A y un único intento adicional para corregir los dos hallazgos del Review.`
- Authorization effect: exactly one additional modifying Apply attempt for the two findings in `incident-review-batch-a.md`; no other authority and no further override are implied.
- Linked failed Review: `incident-review-batch-a.md`, verdict `FAIL — HARD STOP`, prior incident `INC-BATCH-A-GEN-SKILL-SUPPORT-ORDER-v1`.
- Prior governance remains exhausted: EG1-R1 attempt `1/1`, fingerprint budget `1/1`, and verification cycles `2/2` are consumed and are not reset.

### New combined fingerprint and state

- Fingerprint: `INC-BATCH-A-ACCEPTANCE-ORACLE-GAPS-v1`
- Task: `EG1-R2`
- Operating mode: `automatic` with explicit human override.
- Initial decision: `replan`.
- State: `active/replan`.
- New modifying budget: exactly `1` attempt.
- New verification budget: maximum `2` cycles: targeted/affected, then broad plus drift/quarantine comparison.
- Fresh independent Review: mandatory after repair.

### Authorized scope

1. Replace label/literal-only compatibility assertions with tests that invoke corresponding real legacy behavior and assert exact outcomes.
2. Generate the bundle to a temporary destination; compare first generated bytes with tracked canonical `packages/core/src/skills/external/content.generated.ts`; generate independently to a second temporary destination and require byte identity; leave the tracked file unchanged on pass and failure.
3. Make only the smallest supporting test-harness changes for those two oracles.
4. Run targeted/affected verification, then broad verification and exact comparison against the established three-test stale-build-metadata quarantine.

### Prohibited scope and hard stops

- No product/runtime behavior change. If existing behavior prevents an exact legacy oracle, stop and report; do not broaden automatically.
- No direct generated edit, canonical skill-content change, prompt/EG7 work, Batch B/EG2 work, build-info repair, historical OpenSpec edit, excluded WIP, Git restore/discard, or unrelated scope.
- Hard stop on either repeated Review finding, dirty tracked generated output, semantic skill-content change, scope expansion, excluded-WIP intersection, or a new unrelated product path.
- Exhaustion or hard stop authorizes no additional attempt; another explicit human decision would be required.

### Governed transition

`active/replan` → EG1-R2 attempt 1/1 → verification cycle 1/2 → verification cycle 2/2 → fresh independent Review. Only accepted Review may unblock Batch B.

### EG1-R2 attempt and verification result

- Modifying attempt 1/1 consumed; 0 attempts remain. The invocation-scoped override is fully consumed and grants no retry.
- Failure delta: both acceptance-oracle findings resolved; no persistent, regressed, new-related, or new-unrelated finding was observed. Decision: proceed to mandatory fresh independent Review.
- Cycle 1/2 passed: compatibility 5/5, generated bundle 19/19, affected runtime 273/273, affected core 1,474/1,474, and workspace typecheck.
- Cycle 2/2 completed: broad suite 3,309 passed with exactly the unchanged three `scripts/prepare-release.test.ts` stale-build-metadata failures; workspace typecheck passed.
- Tracked generated output remained byte-identical at SHA-256 `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` before/after both cycles, including success and induced-failure oracle paths. No tracked-output generator invocation or direct generated edit occurred.
- State: `verification-passed/review-required`. Batch A remains unaccepted and Batch B remains blocked pending fresh independent Review.

### EG1-R2 fresh independent Review and resolution

- Review artifact: `incident-review-batch-a-override.md`.
- Verdict: `PASS`; both acceptance-oracle findings from `incident-review-batch-a.md` are closed by actual legacy behavior assertions and temporary-destination canonical-byte assertions.
- Independent evidence reproduced compatibility 5/5, generated 19/19, runtime 273/273, core 1,474/1,474, broad 3,309 passes with exactly the unchanged three quarantined stale build-metadata failures, and a passing workspace typecheck.
- Tracked generated output remained byte-identical at SHA-256 `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no temporary bundle root remained after success or induced failure.
- Resolution: `resolved/review-accepted`. Batch A is accepted and Batch B is unblocked.
- The failed EG1-R1 Review, its hard stop, and all exhausted prior and override budgets remain preserved. This resolution grants no additional repair attempt.

## Batch B Contract Trust and Delta Integrity Incident

### Identity and decision

- Fingerprint: `INC-BATCH-B-CONTRACT-TRUST-DELTA-INTEGRITY-v1`.
- Authoritative Review: `review-batch-b.md`, verdict `FAIL`, findings `B-B1`–`B-B7`.
- Batch/task scope: Batch B contracts only; `EG2-T1`, `EG2-T2`, repair task `EG2-R1`.
- Operating mode: `automatic`.
- Initial decision: `repair`; Spec and Design remain valid and every finding is an in-scope implementation/acceptance gap.
- State: `active/repair`.
- Lifecycle effect: auxiliary Apply governance only; `currentPhase` remains `apply` and Batch C remains blocked.

### Compact current failure manifest

| Finding ID | Severity | Category | Stable subject | Reproducer | Required result |
|---|---|---|---|---|---|
| B-B1 | BLOCKER | security/redaction | `failure-manifest:persisted-safe-shape` | Seed unknown keys, nested values, check/result/remediation codes with five named secrets. | Allowlisted safe output or `unsafe-diagnostic-content`; zero seeded leakage before hashing/persistence. |
| B-B2 | BLOCKER | delta/safety | `failure-delta:normative-buckets-progress` | Resolve critical while adding low security finding; add related and unrelated baseline cases. | Complete mutually exclusive buckets; security/regression dominance; never positive progress; regression weighting. |
| B-B3 | BLOCKER | reference-integrity | `execution-dossier:same-batch-chain` | Decision/intent/auth/delta/schema/digest/change mismatch inside dossier. | `batch-reference-mismatch` or `invalid-evidence` before issue/freeze; no digest recomputation. |
| B-B4 | BLOCKER | deterministic-identity | `failure-finding:portable-path-identity` | Equivalent Review findings under different absolute checkout prefixes/extensions. | Same full fingerprint/finding ID using authoritative root or validated relative identity. |
| B-B5 | MAJOR | semantic-collision | `canonical-input:normalized-uniqueness` | `src\\a` plus `src/a`; duplicate semantic finding/evidence. | Reject normalized-key/finding collisions; normalize or reject duplicate evidence before risk; no inflation. |
| B-B6 | MAJOR | boundary-api | `v1-contracts:runtime-parser-export-surface` | Unknown/malformed/mutable input for every DTO; inspect root exports. | Every boundary fails closed, clones/freezes; internal canonical helpers absent from root barrel. |
| B-B7 | MAJOR | acceptance-oracle | `batch-b:adversarial-boundary-table` | Run all prior cases through public parsers/builders and legacy adapters. | Exact bytes, IDs, buckets, vectors, errors, immutability, and legacy outcomes; no count/subset/label shortcuts. |

All findings are related to Batch B. There is no unrelated product finding, Batch C scope, generated drift, excluded-WIP intersection, or Spec/Design contradiction in this manifest.

### Governance budgets

| Control | Bound |
|---|---|
| Incident modifying attempts | Maximum 2 |
| Attempt 1 | Authorized now |
| Identical-fingerprint blind retry | Maximum 1; no blind attempt 2 |
| Attempt 2 condition | Review 1 proves strictly shrinking set, no new regression, and emits exact remainder manifest |
| Verification per attempt | Maximum 2 cycles: targeted/affected, then broad+drift |
| Independent Review cycles | Maximum 2; fresh Review after each modifying attempt |
| Unchanged/expanded result | Hard stop/escalate |

### Allowed scope

- The Batch B contract, failure-delta, dossier, parser/export, and exact adversarial test files enumerated in `EG2-R1`.
- Fail-closed parsers for every boundary DTO; strict unknown-key/nested redaction; normalized-key collision rejection; deterministic duplicate semantic evidence handling; path-prefix-stable identity; exact same-batch/reference continuity; complete normative delta buckets; security/regression dominance.
- Narrow supported public APIs only; canonical/internal helpers stay internal unless Design explicitly declares them public.
- Two verification cycles per authorized attempt and exact established stale-build-metadata quarantine comparison.

### Prohibited scope and hard stops

- No Batch C or later runtime/kernel/adapter/registry/prompt work, generated edit, canonical skill change, historical OpenSpec edit, excluded WIP, build-info repair, or unrelated product path.
- No count inflation, subset-only assertion, label-only fixture, forged unparsed DTO acceptance, or secret-derived hash.
- Hard stop on secret leakage, a security regression classified as progress, repeated identical fingerprint/no progress, unchanged/expanded Review findings, generated drift, Batch C/later scope, excluded-WIP intersection, or unrelated product path.

### Governed transition

`active/repair` → EG2-R1 attempt 1 → verification cycles 1/2 and 2/2 → fresh Review 1. Only a strictly shrinking exact remainder manifest with no regression may authorize attempt 2; otherwise accept on full closure or hard-stop/escalate. A second fresh Review is mandatory after attempt 2. Batch C unblocks only after accepted closure.

### EG2-R1 attempt 1 consumed

- Attempt 1/2 is consumed for `INC-BATCH-B-CONTRACT-TRUST-DELTA-INTEGRITY-v1`; one conditional attempt remains unavailable pending fresh Review.
- Manifest disposition: B-B1–B-B7 are `repaired-awaiting-review` with exact public-boundary RED/GREEN evidence recorded in `apply-progress.md`.
- Cycle 1 passed sdd-runtime 289/289, core 1474/1474, and typecheck. Cycle 2 produced 3325 broad passes plus exactly the unchanged three quarantined `prepare-release` failures; generated SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- No hard stop fired. Next transition is fresh independent Review 1; no Batch B completion event is recorded and Batch C remains blocked.

### EG2-R1 fresh Review cycle 1 — failed and hard-stopped

- Artifact: `review-batch-b-repair-1.md`; verdict: `FAIL`.
- Exact remainder: `B-B1`, `B-B2`, `B-B3`, `B-B4`, `B-B5`, `B-B6`, `B-B7`; cardinality `7 → 7`.
- The failure set is not strictly shrinking. No new related regression was found, but B-B1 still persists PEM private-key material and therefore triggers the explicit secret-leakage hard stop.
- Attempt 2 is ineligible under the existing governance. No completion event is recorded, the active repair is hard-stopped, and Batch C remains blocked.
- Fresh Review evidence: focused 12/12 and typecheck passed; broad verification produced 3324 passes plus the three established stale-build-metadata failures and the separately recorded unrelated binary-doctor baseline timeout. Generated SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.

## Batch B Higher-Level Trust-Boundary Replacement

### Override and linkage

- Exact authorization: `Autorizo el replan superior de Batch B y un único intento de reemplazo integral del trust boundary para corregir B-B1 a B-B7.`
- New fingerprint: `INC-BATCH-B-TRUST-BOUNDARY-REPLACEMENT-v1`.
- Task: `EG2-R2`.
- Authoritative corrective design: `design-repair-batch-b.md`.
- Linked Reviews: `review-batch-b.md` and `review-batch-b-repair-1.md`.
- Prior fingerprint `INC-BATCH-B-CONTRACT-TRUST-DELTA-INTEGRITY-v1`, EG2-R1 attempt 1, verification cycles 2/2, fresh Review failure, unchanged `7→7` manifest, secret-leak hard stop, and attempt-2 ineligibility remain exhausted historical facts. This replacement is not EG2-R1 attempt 2.

### Replacement failure manifest

| ID | Stable replacement subject | Current exact reproducer | Replacement acceptance |
|---|---|---|---|
| B-B1 | `trust.secret-policy` | PEM/private-key bytes survive manifest summary/excerpt and influence digest. | Recursive structural/value detector rejects or constant-redacts permitted inline assignment before hashing; no raw or raw-secret-derived bytes/digest influence. |
| B-B2 | `trust.delta-risk-algebra` | Regression weighting/reopened/baseline exact matrix incomplete. | Complete disjoint buckets, exact added union, baseline zero credit, regression penalty, vectors/movement/progress, and hard-risk non-positive precedence. |
| B-B3 | `trust.dossier-reference-chain` | Malformed self-hashed same-batch nested decision can be frozen in dossier. | Every nested issued DTO recursively parsed; exact acyclic cross-references/revisions; no silent issuance/recomputation. |
| B-B4 | `trust.repository-path-identity` | Equivalent `src/...` under different checkout roots produces different identity. | Injected authoritative POSIX/Windows context yields identical canonical relative subject/fingerprint/ID; no marker inference. |
| B-B5 | `trust.semantic-collision-dedup` | Duplicate semantic evidence persists and can inflate state. | Exact equivalent dedup; conflicting semantic tuple rejection; path/key/finding collisions reject before digest/risk. |
| B-B6 | `trust.recursive-boundary-parser` | Exact-shape malformed self-hashed DTO and unknown extension can pass shallow parser. | Shared recursive closed schemas reject malformed/canonical-changing wire exactly; builders issue, parsers verify, outputs plain/frozen. |
| B-B7 | `trust.public-adversarial-oracle` | Subset tests omit exact bytes/vectors/errors/export/legacy cases. | Complete public-entrypoint RED/GREEN matrix with exact outputs and no broad/subset/label/count shortcuts. |

### Governance

- Operating mode: `automatic` with explicit human override.
- Initial decision: `replan`.
- State: `active/replan`.
- Modifying replacement attempts: exactly `1`; consumed when product/test modification begins.
- Verification cycles: maximum `2`: targeted/affected, then broad plus drift/scope/baseline comparison.
- Fresh independent Review cycles: exactly `1` after modification.
- No automatic retry, EG2-R1 attempt 2, or second override is implied.

### Relationship and authority rules

- Relationship is structured: `batch_related | unrelated_baseline`.
- Ambiguous and legacy cases default to `batch_related`.
- `unrelated_baseline` requires validated pre-existing evidence with `status: pre_existing` and receives no batch risk movement or repair credit.
- Every public V1 entrypoint follows recursive inspect→closed parse→secret/path/canonical/semantic validation→builder issue or parser verify→cross-reference validation→plain clone→deep freeze.

### Allowed scope

- Exactly the files, symbols, test matrices, and sequence `EG2-R2-S01`–`EG2-R2-S13` listed in `tasks.md` and the File Impact/One-Attempt sections of `design-repair-batch-b.md`.
- Replace, do not locally patch: shared recursive kernel; leaf builders/parsers; secret policy; path context; identity/dedup; delta/risk algebra; dossier/reference/revision validation; explicit root exports; exact adversarial matrix; legacy compatibility.

### Prohibited scope and hard stops

- No source outside the corrective-design file table; no Batch C/later runtime/adapter/registry/lane/prompt work; no generated/canonical-skill/build-info/unrelated changes; no dependencies; no historical OpenSpec rewrite; no excluded WIP; no Git discard/reset/restore/clean.
- Hard stop on any B-B1–B-B7 reproducer remaining; secret bytes or secret-derived digest influence; malformed self-hashed DTO acceptance; security/critical/high/data-loss/auth/Git-safety regression positive progress; path-dependent identity; duplicate/collision inflation; cross-reference/revision corruption; legacy API/result/source regression; generated drift; Batch C/later scope; excluded WIP; or unrelated product path.

### Governed transition

`active/replan` → complete RED matrix → EG2-R2 replacement attempt 1/1 → verification cycle 1/2 → verification cycle 2/2 → fresh independent Review 1/1. Only full accepted closure unblocks Batch C. Any failure hard-stops without retry.

### EG2-R2 attempt 1/1 consumed — verification hard stop

- The invocation-scoped override was consumed when `batch-b-replacement.test.ts` and Batch B product files were modified.
- RED evidence was 0/7 and focused GREEN was 7/7 for one public reproducer per B-B1–B-B7. The required complete every-parser mutation matrix was not present before product modification; S02 and S10 therefore failed.
- Verification cycle 1 passed: contract 111/111, legacy 77/77, core compatibility 2/2, affected sdd-runtime 296/296, workspace typecheck, and empty Serena error diagnostics.
- Verification cycle 2 timed out during the combined broad/typecheck/drift command. It was not retried because the maximum is two cycles and no retry is authorized.
- Final state: `hard-stop/verification-failed`; replacement attempts remaining `0`; verification cycles consumed `2/2`; fresh Review `not eligible/not run`; Batch C remains blocked.
- No replacement-completed or verification-completed event is recorded. All prior incidents, overrides, Review failures, and budgets remain unchanged.

## Batch B Adaptive Three-Slice Closure

### Override and identity

- Exact authorization: `Autorizo un override adaptativo para cerrar Batch B en tres slices seriales, con máximo tres Apply launches, sin nuevas aprobaciones mientras el failure set se reduzca y no aparezcan regresiones de seguridad, scope o generated drift.`
- Fingerprint: `INC-BATCH-B-ADAPTIVE-THREE-SLICE-CLOSURE-v1`.
- Mode/state: `automatic adaptive`, `active/replan`.
- This is not an EG2-R2 retry. EG2-R2 remains exhausted; its partial source/test work is preserved and must not be reset or discarded.
- One continuing General Apply owner carries causal context through all slices.

### Adaptive initial failure manifest

Until Slice 1 completes the mandatory full matrix and fresh Verify classification, B-B1–B-B7 remain open/unclassified for continuation; partial green EG2-R2 tests are advisory only.

| ID | Planned closure | Exact evidence |
|---|---|---|
| B-B1 | R3A | Secret corpus/nested/prose placements safe before hashing; zero raw/derived influence. |
| B-B4 | R3A | POSIX/Windows authoritative roots yield identical relative identity. |
| B-B5 | R3A | Collisions reject; equivalent evidence dedupes; semantic conflicts reject; no inflation. |
| B-B6 | R3A | Every leaf builder/parser passes complete exact mutation table and freezes plain output. |
| B-B7 | R3A/R3C | Full matrix classified before edits and fully integrated at closure. |
| B-B2 | R3B | Exact delta arrays/vectors/movement/progress, zero baseline credit, regression penalty, hard-risk dominance. |
| B-B3 | R3B | Recursive nested DTO/reference/revision validation; no malformed/cross-batch/silent recomputation. |

### Three-launch budget and slice progress

| Slice | Task | Launch | Independent gate | State |
|---|---|---:|---|---|
| 1 | EG2-R3A | 1/3, no retry | Fresh Verify; strict shrink | authorized/pending |
| 2 | EG2-R3B | 2/3, no retry | Fresh Verify; strict shrink | blocked on Slice 1 |
| 3 | EG2-R3C | 3/3, no retry | Fresh Verify + Review; empty set | blocked on Slice 2 |

- Maximum launches: `3`; consumed: `0`; remaining: `3`.
- No new human approval is needed while continuation conditions hold.
- Override expires after Slice 3 or immediately on any hard stop.

### Continuation rules

After each modifying slice, registry evidence must record exact before/after B-B1–B-B7 manifests, evidence references, generated hash, changed paths, baseline classification, and fresh Verify result. Continue only on a strictly smaller set, no new finding/regression, and no security/scope/generated drift. A next slice may address planned targets plus only the exact carried remainder.

### Baseline and hard-stop rules

Only the exact three established stale `scripts/prepare-release.test.ts` failures may be quarantined when names and stale metadata evidence are unchanged. Binary-doctor timeout/failure is not pre-approved and blocks unless separately proven/classified without repair credit. Any unclassified broad failure blocks.

Immediate hard stop: unchanged/expanded set; secret leakage/digest influence; unsafe security/critical/high progress; path-dependent identity; collision inflation; cross-reference/revision corruption; legacy/API regression; generated drift; Batch C/later scope; excluded WIP; unrelated path; or unclassified new broad failure.

### Scope and transition

Allowed scope is exactly R3A, then conditionally R3B, then conditionally R3C in `tasks.md`, using corrective Design files and preserving partial EG2-R2 work. Prohibited: per-slice retry, parallel slices, other source/tests, new capability/dependency, Batch C/later work, generated/canonical-skill/build-info changes, historical or prior-evidence rewrite, excluded WIP, unrelated paths, or Git reset/restore/clean/discard.

Governed transition: `active/replan` → R3A → Verify/shrink → R3B → Verify/shrink → R3C → final Verify+Review/empty set. Any failed gate ends the override; accepted final gate unblocks Batch C.

### Slice 1 execution — EG2-R3A launch 1/3

- Launch 1/3 is consumed with no retry. A package-root public matrix draft was added and run before any production edit.
- Baseline result was `1 pass / 5 fail`; exact RED evidence exists for several parser/path/evidence boundaries, but the matrix remained incomplete because every parser × mutation category did not execute independently with an exact error oracle.
- Mandatory pre-edit gate failed. No trust-kernel, builder, parser, delta, dossier, export, generated, adapter, prompt, registry-runtime, Batch C, dependency, or unrelated production change was made.
- Exact current failure manifest remains `{B-B1, B-B2, B-B3, B-B4, B-B5, B-B6, B-B7}` (`7 → 7`, not strictly shrinking). B-B1 corpus aggregate was advisory green only; no finding receives closure credit.
- Hard stop is active. Fresh Verify is not ready; R3B/R3C and Batch C remain blocked. No `repair.batch-b.r3a.implemented` event is authorized.

### Explicit remaining-launch continuation override

- Exact authorization: `Autorizo usar los dos Apply launches restantes de Batch B: el primero debe completar la matriz y reducir el failure set; el segundo debe cerrarlo en cero y pasar Verify y Review.`
- The original adaptive cap remains exactly `3`; this authorization adds no launch and does not retry R3A.
- Accounting: R3A launch 1/3 consumed; launches consumed `1`; launches remaining `2`.
- Same General Apply owner resumes causal context and preserves `batch-b-r3a-public-matrix.test.ts` plus all partial EG2-R2/R3A work; no reset, discard, or restart.
- State: `active/replan`; active slice `EG2-R3B`.

#### Launch 2/3 — EG2-R3B

1. Complete the independently executing full public parser×mutation/security/path/evidence matrix before further production edits and classify every B-B1–B-B7 case.
2. Then finish the shared recursive trust kernel, secret/path policy, authoritative context, identity/dedup, and leaf builders/parsers.
3. Fresh independent Verify must record an exact strict shrink from 7 with no new/unclassified finding and no secret, security, scope, generated, API, legacy, or unrelated regression.
4. Failure to shrink or any hard stop consumes launch 2 and expires the override.

#### Launch 3/3 — EG2-R3C

1. Close the exact R3B remainder through delta/risk algebra and dossier/reference/revision integrity.
2. Finish exact public exports and legacy compatibility.
3. Run complete corrective matrix, affected checks, broad verification with wall timeout at least 15 minutes, generated hash/drift, and scope audit.
4. Fresh independent Verify and Review must report zero B-B and zero new blocking findings before Batch B completion.

#### Baseline and expiration

Only the exact unchanged three stale `prepare-release.test.ts` failures may be quarantined. Binary-doctor timeout/failure is not pre-approved and blocks unless independently proven pre-existing without repair credit. Any nonzero/expanded/unclassified final set hard-stops. No per-launch retry or further automatic override exists; this continuation expires after launch 3 or any hard stop.

### Slice 2 execution — EG2-R3B launch 2/3

- Launch 2/3 is consumed with no retry. The package-root matrix moved from pre-edit `5 pass / 1 fail` to post-edit `14 pass / 0 fail` with 183 assertions.
- Kernel/path/secret, FailureManifest issued-wire identity, authorization, and registry-intent leaf boundaries were corrected; delta/dossier/final export closure was not implemented.
- Contracts `124/124`, sdd-runtime `310/310`, core `1474/1474`, workspace typecheck, and Serena diagnostics passed. Generated hash remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- Apply-classified failure manifest strictly shrank from all seven findings to `{B-B2, B-B3}`. Fresh independent Verify must confirm before R3C eligibility.

### Slice 3 execution — EG2-R3C launch 3/3

- Final launch 3/3 is consumed with no retry. Short-JWT RED was reproduced in four protected placements and moved GREEN; focused matrix `18/18`, delta/dossier `13/13`, and contracts `128/128` passed.
- Dossier nested authority validation was strengthened, but the complete independently named delta/dossier corruption matrix was not completed.
- Static matrix audit still reports aggregate loops and three broad `toThrow()` assertions and lacks independently named FailureDelta/ExecutionDossier rows. B-B7 therefore remains open and hard-stops both verification cycles.
- Exact final Apply failure manifest is `{B-B2, B-B3, B-B7}`. Broad verification was not run after the cycle-1 gate failed. No R3C implemented/completion event, Verify, Review, Batch B completion, or Batch C authorization is permitted.

### Slice 2 fresh Verify — failed hard stop

- Fresh independent Verify reproduced the original enumerated B-B1 corpus as safe and closed B-B4, B-B5, and the nine leaf-boundary B-B6 probes, but found a new related security fingerprint: a shorter JWT-like compact credential is accepted and persisted by `buildFailureManifestV1` in summary, remediation, excerpt, and result-code placements.
- The mandatory public matrix remains incomplete: `parseFailureDeltaV1` and `parseExecutionDossierV1` are not classified, broad no-message `toThrow()` assertions remain, and aggregate loops can hide later parser/mutation failures. B-B7 therefore remains open.
- Verified exact manifest is `{B-B1, B-B2, B-B3, B-B7}`. The observed `7 → 4` shrink does not satisfy the required exact `{B-B2, B-B3}` set and cannot authorize continuation because a security hard stop occurred.
- Launch 2/3 remains consumed. The continuation override is expired; the arithmetically unused launch 3/3 is not eligible and EG2-R3C, EG3-T1, Batch C, and Batch B completion remain blocked.
- Evidence artifact: `verify-batch-b-r3b.md`. Event: `verify.batch-b.r3b.failed`.

### Explicit final-launch reactivation override

- Exact authorization: `Autorizo reactivar el Apply launch 3/3 exclusivamente para cerrar B-B1, B-B2, B-B3 y B-B7, con aceptación solo si Verify y Review reportan cero findings bloqueantes.`
- This reactivates only EG2-R3C launch 3/3. Maximum remains `3`; consumed `2`; remaining/authorized `1`; no retry or further override is implied.
- Same General Apply owner resumes existing partial work and causal context.
- State: `active/replan`; active exact manifest: `{B-B1, B-B2, B-B3, B-B7}`.

#### Final authorized scope

- B-B1: short JWT-like credential plus complete protected-placement corpus; zero raw or secret-derived persisted/digest influence.
- B-B2: exact complete delta buckets/risk vectors/related-baseline rules/zero baseline credit/2x regression penalty/reopened/reclassified/safety precedence.
- B-B3: recursive dossier/nested contract/digest/reference/revision integrity with no silent digest repair.
- B-B7: public matrix rows for `parseFailureDeltaV1` and `parseExecutionDossierV1`; individually named exact assertions replacing broad `toThrow()` and aggregate loops; exact exports and legacy matrix.
- Integrated affected checks, typecheck, broad wall timeout ≥900000 ms, generated hash/drift, and changed-scope audit.

#### Final acceptance gate

Fresh independent Verify and fresh independent Review run independently in registry-deferred mode. Each writes only its R3C report plus immutable registry intent. Orchestrator reconciles the registry only when both report zero blocking findings and consistent exact evidence. Batch B completion and Batch C unblocking require that reconciliation.

#### Final hard stops

Any nonzero/expanded/unclassified finding set; secret influence; unsafe progress; dossier/reference/revision corruption; incomplete matrix; API/legacy regression; generated drift; excluded or Batch C/later scope; unrelated path; broad timeout or unapproved failure; or registry inconsistency is final. Only the exact three unchanged stale `prepare-release.test.ts` failures may be quarantined; binary-doctor remains unapproved.

## Direct Recovery Override — Batch B

- Exact human direction: `Quiero que soluciones ya, estoy cansado de qu no hayan soluciones, de tanto problema, prevismente eso es lo que estamos tratando de mejorar en el sistema`.
- Interpretation: explicit higher-level authorization to stop micro-slicing and execute one direct recovery for the exact remaining manifest `{B-B2, B-B3, B-B7}`.
- Operating mode: automatic direct recovery with one fresh General Apply owner retaining the official artifacts and current partial implementation as causal context.
- Authorized scope: complete delta/risk algebra, dossier/reference/revision integrity, exact public FailureDelta/Dossier matrix rows, removal of broad `toThrow()` and aggregate-loop acceptance oracles, exact exports/legacy evidence, affected and broad verification.
- Apply budget: one direct-recovery launch; the owner may iterate implementation and focused tests within that launch until the authorized acceptance matrix is green.
- Verification budget: one affected cycle and one broad cycle with wall timeout at least 900000 ms, followed by fresh independent Verify and Review in registry-deferred mode.
- Acceptance: zero blocking findings from both Verify and Review, with no generated drift, scope expansion, secret influence, unsafe progress, reference corruption, API/legacy regression, or unapproved broad failure.
- This override supersedes the exhausted micro-slice continuation policy for the exact remaining manifest only. It does not authorize Batch C or later work.

## Direct Recovery Gate Repair

- Trigger: fresh independent Verify and Review both rejected the first direct-recovery result.
- Human authority: the recorded direction to solve the problem now remains the higher-level mandate; no new product scope is introduced.
- Combined exact manifest:
  - `B-B2-RISK-PRECEDENCE-OMITS-MEDIUM-LOW-v1`
  - `B-B2-DELTA-PARSER-OPTIONAL-AUTHORITY-v1`
  - `B-B2-BASELINE-PERSISTENT-BUCKET-v1`
  - `B-B3-REVISION-CHAIN-STOPS-AT-TWO-v1`
  - `B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1`
- Initial decision: `repair`; all findings are within the already authorized Batch B trust-boundary scope.
- Operating mode: automatic combined gate repair with one fresh General Apply owner.
- Apply budget: one combined repair launch; the owner may iterate focused implementation/tests within the launch.
- Verification budget: one affected cycle and one broad cycle, followed by one fresh registry-deferred Verify+Review gate.
- Acceptance: zero blocking findings from both gates, exact three-failure baseline only, stable generated hash, and no Batch C/later or unrelated scope.
- Hard stop: unchanged/expanded combined manifest, new security/authorization/data-loss/Git-safety finding, generated drift, API/legacy regression, excluded WIP, unrelated scope, or unapproved broad failure.

## Direct Recovery Gate Repair 2

- Trigger: the second fresh Verify+Review gate independently reduced the implementation defects to three exact local invariants plus one exact test-oracle split.
- Human authority: the recorded directive to solve the problem now remains the standing higher-level override for this unchanged Batch B scope.
- Fingerprint: `INC-BATCH-B-FINAL-LOCAL-INVARIANTS-v1`.
- Exact manifest:
  - `B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1`
  - `B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1`
  - `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1`
  - `B-B7-COMBINED-PLACEMENT-CASE-v1`
- Initial decision: `repair`; no Spec/Design or scope change is required.
- Apply budget: one fresh combined repair launch with internal focused iteration.
- Verification budget: one affected cycle, one broad cycle, then one fresh registry-deferred Verify+Review gate.
- Acceptance: same-identity relationship transition rejects explicitly; append-only histories cannot truncate; protected placement cases are individually named; public Batch B export oracle compares the exact complete key set; both final gates report zero blocking findings.
- Hard stop: unchanged/expanded manifest, new protected-risk defect, generated drift, API/legacy regression, excluded/unrelated scope, or unapproved broad failure.

## Direct Recovery Gate Repair 3

- Trigger: final gate-repair-2 Verify/Review reduced the exact remainder to prior-decision reorder enforcement/evidence and exact root export equality.
- Human authority: latest explicit direction `Continua`, under the standing mandate to solve the Batch B problem.
- Fingerprint: `INC-BATCH-B-FINAL-TWO-ORACLES-v1`.
- Exact manifest:
  - `B-B3-PRIOR-DECISION-REORDER-ACCEPTED-v1`
  - `B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1`
  - `B-B7-PUBLIC-EXPORT-ORACLE-REMAINS-SUBSET-v1`
- Initial decision: `repair`; this is the same authorized Batch B scope.
- Apply budget: one focused repair launch with internal test iteration.
- Verification: affected and broad checks followed by one fresh registry-deferred Verify+Review gate.
- Acceptance: issue/parse paths reject reordered/truncated/mutated prior-decision prefixes at depth 3+ with individually named exact tests; package-root export keys equal the complete approved 57-key surface exactly; both final gates have zero blockers.

## Direct Recovery Gate Repair 4

- Trigger: Gate Repair 3 closed relationship and export findings but fresh gates retained exact history-validation evidence, test type errors, and one unapproved environment-sensitive broad failure.
- Human authority: explicit `Continua` remains active for this unchanged Batch B closure.
- Fingerprint: `INC-BATCH-B-HISTORY-TYPES-BROAD-CLOSURE-v1`.
- Exact manifest:
  - `B-B3-PARSER-REGISTRY-TRUNCATION-ORACLE-MISSING-v1`
  - `B-B3-UNSAFE-HISTORY-SLICING-v1`
  - `TYPECHECK-BATCH-B-DIRECT-RECOVERY-DIGEST-TYPES-v1`
  - `BROAD-UNAPPROVED-PREPARE-RELEASE-SHA256-FAILURE-v1`
- Initial decision: `repair` for Batch B history/test typing; diagnose and prove the broad environment failure without unrelated source changes or repair credit.
- Apply budget: one combined launch with internal focused iteration.
- Final gate: fresh registry-deferred Verify+Review with zero blockers.

### Gate Repair 4 final result

- Apply blocking set: empty.
- Fresh Verify: PASS; all B-B1–B-B7 closed; 25/25 independent reproducers; typecheck passed; broad 3409/3409.
- Fresh Review: PASS; zero blocking findings; security, delta/risk, dossier/revision, parsers/API/legacy, tests, maintainability, and scope accepted.
- Generated skill SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- Final state: `resolved/review-accepted`; Batch B is complete and Batch C is unblocked.

## Batch C Direct Recovery

- Trigger: fresh independent Batch C Verify and Review both failed after Batch C Apply.
- Human authority: the user's standing Automatic approval and repeated instruction to continue and solve the system issue authorize one coherent recovery of the exact Batch C manifest.
- Fingerprint: `INC-BATCH-C-DECISION-BOUNDARY-PRODUCTION-SAFETY-v1`.
- Exact combined manifest:
  - `C-C1-HIGH-RISK-SHRINK-REPAIRS-v1`
  - `C-C2-PRODUCTION-CALLER-DISCONNECTED-v1`
  - `C-C3-BATCH-C-TEST-ORACLE-INCOMPLETE-v1`
  - `C-B1`
  - `C-B2`
  - `C-B3`
  - `C-B4`
  - `C-B5`
  - `C-B6`
- Initial decision: `repair`; the Spec/Design already require the missing behavior and no product-scope decision is open.
- Operating mode: automatic direct recovery with one fresh General Apply owner; do not create micro-slices or a new task family.
- Apply budget: one coherent repair launch with focused iteration until all exact public/production boundary cases are green.
- Verification: affected checks plus one broad check, followed by fresh registry-deferred Verify and Review.
- Required closure: exact high-risk/floor precedence; fail-closed authority/shadow/effect boundary; canonical frozen decision-input digest and replay; actual production composition caller; legacy/no-dossier/shadow compatibility projection; complete exact decision/safety/mode/table test matrix.
- Hard stop: any remaining combined finding, new security/authorization/data-loss/Git-safety defect, generated drift, Batch D/later scope, excluded WIP, legacy/API regression, unapproved broad failure, or registry inconsistency.

### Batch C Host-Boundary Gate Result

- The Batch D host bridge handoff is correctly deferred and is not a Batch C blocker.
- Fresh gates retained four exact Batch C defects: self-asserted capability digest, unsafe/forged replay identity, malformed shadow/terminal composition, and synthetic test rows that do not execute public boundary behavior.
- Direct repair decision: one coherent Batch C security-and-oracle repair using the independent reproducers. No Batch D scope, no test catalog filler, no synthetic decision expectation helper.

### Batch C Direct Recovery Gate Result

- Fresh Verify and Review both rejected the first direct recovery.
- Implementation defects remain for authority/Git defaults, data-loss routing, safe invalid-input identity, mandatory shadow/legacy composition, and exact safety coverage.
- Production-caller reachability is a Design/tasks sequencing contradiction: no authorized EG3 caller can receive per-execution dossiers/effect capabilities; the real runner-host bridge belongs to Batch D.
- Replan decision: keep Batch C responsible for a production-ready, fail-closed control-plane boundary and move actual runner-host reachability to Batch D, where the runner bridge and invocation authorization are authorized.
- This is not a reduction of safety: Batch C must still fully close its fail-closed, canonical replay, legacy/shadow, and exact test obligations before Batch D can consume the boundary.

### Direct recovery implementation result

- Attempt `1/1` consumed for `INC-BATCH-C-DECISION-BOUNDARY-PRODUCTION-SAFETY-v1`; the exact Apply blocking set is `[]`.
- Focused RED/GREEN repaired all normalized C-C1/C-C2/C-C3 and C-B1–C-B6 findings: risk precedence, connected production composition, deny-by-default narrow effect capability, frozen canonical replay, terminal legacy compatibility projection, and exact boundary tests.
- Affected verification passed: focused `69/69`, sdd-runtime `379/379`, core `1474/1474`, and workspace typecheck; Serena diagnostics are clean.
- Broad verification completed under the required 900000 ms allowance: `3418 pass / 0 fail` across 192 files. Generated skill SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- Next stage: fresh independent registry-deferred Verify and Review. This result does not record Batch C completion or authorize Batch D.

### Direct recovery implementation result

- The single authorized launch completed the exact `{B-B2, B-B3, B-B7}` manifest. Apply-classified failure set is now `{}`.
- B-B2 delta/risk algebra and B-B3 dossier/reference/revision integrity were completed at their public parsers/builders. B-B7 now has individually named package-root FailureDelta/Dossier cases, exact errors, and no aggregate-loop or broad-throw acceptance oracle.
- Affected cycle passed: direct matrix `19/19`, Batch B files `45/45`, contracts/delta `144/144`, sdd-runtime `329/329`, core `1474/1474`, typecheck, and Serena diagnostics.
- Broad cycle used a 900000 ms wall timeout and produced `3365 pass / 3 fail`; the only failures are the exact unchanged approved stale prepare-release cases. No binary-doctor or unclassified failure occurred.
- Generated hash remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; scope audit found no direct-recovery expansion.
- Next stage is fresh independent registry-deferred Verify and Review. This entry does not claim Batch B completion or authorize Batch C.

## Batch C Host-Boundary Repair Governance

### Repair scope and decision

- Fingerprint: `INC-BATCH-C-DECISION-BOUNDARY-PRODUCTION-SAFETY-v1`
- Additive Spec repair: `spec-repair-batch-c.md` (`spec-repair-batch-c.md:1-358`)
- Additive Design repair: `design-repair-batch-c.md` (`design-repair-batch-c.md:1-691`)
- Authoritative Verify: `verify-batch-c-direct-recovery.md`
- Authoritative Review: `review-batch-c-direct-recovery.md`
- Combined C-R1…C-R6 findings from both gates
- Initial decision: `repair`
- State: `active/repair`

### Resolution of C-R1 / C-C2 / C-B1

C-R1 (circular wrapper) and C-C2-PRODUCTION-CALLER-DISCONNECTED-v1 / C-B1 (no non-test production caller) are NOT Batch C safety defects — they are a sequencing contradiction. No authorized EG3 scope can contain the runner-native host bridge; that belongs to Batch D. These findings are deferred to Batch D via `HO-BC-TO-BD-HOST-REACHABILITY-v1` (`spec-repair-batch-c.md §3`). The structural test documents the gap without falsely closing it.

### C-R2…C-R6 Batch C repair obligations

| Finding | REQ-CBC | Exact obligation |
|---|---|---|
| C-R2 / C-B2 | REQ-CBC-003 | Mandatory discriminated authority/Git states; no boolean shorthands/defaults; missing/invalid distinct `stop` rationale; capability/Git descriptor matching at plan and effect boundaries |
| C-R3 / C-B3 | REQ-CBC-004 | One shared protected-risk classifier including data-loss; positive shrink with any protected dimension forbids `targeted_repair` |
| C-R4 / C-B4 | REQ-CBC-002, REQ-CBC-005 | Total bounded invalid classifier; fixed classification identity; no raw/raw-derived hash; canonical deeply frozen replay record and pure replay function |
| C-R5 / C-B5 | REQ-CBC-006 | Mandatory legacy input in every mode; explicit legacy/shadow/active result union; legacy authoritative in shadow; terminal mapping restrictive-only; narrow pre-bound targeted-repair capability |
| C-R6 / C-B6 | REQ-CBC-007 | Exhaustive 68-row exact test matrix, every row individually named, no aggregate loops or broad `toThrow` |

### One coherent repair launch — EG3-R1

- One General Apply owner carries full causal context through all phases.
- No micro-slices. No new task family. No Batch D implementation scope.
- Apply budget: one coherent repair launch with internal focused iteration.
- Affected cycle + broad cycle with 900000 ms wall timeout.
- Then fresh independent registry-deferred Verify and fresh independent registry-deferred Review.
- Acceptance: zero blocking findings from both gates, exact evidence, unchanged generated hash.

### Batch D host-reachability handoff

- `HO-BC-TO-BD-HOST-REACHABILITY-v1` is mandatory for EG4-T2 completion.
- OpenCode and Pi real host bridges must call the Batch C boundary on a non-test, non-prompt-only execution path.
- Test/export wrappers, renamed helpers, and indirect unit tests are insufficient evidence.
- EG4-T2 remains incomplete until `RQH-BC-001`–`RQH-BC-003` are satisfied.

### Hard stops

- Any remaining C-R2…C-R6 reproducer after EG3-R1.
- Secret influence, unsafe progress, dossier/reference corruption, incomplete matrix.
- API/legacy regression, generated drift, Batch D/later scope before Batch C closes.
- Excluded WIP, unrelated path, or registry inconsistency.
- Binary-doctor failure is not pre-approved.

### Transition

`active/repair` → EG3-R1 attempt 1/1 → affected + broad → fresh Verify + fresh Review. Batch D unblocks only after both gates report zero blocking findings and Orchestrator reconciles the registry.

### EG3-R1 current implementation evidence (not closure)

- The host-facing composition, fail-closed authority/Git types, shared protected-risk classifier, fixed invalid-input identity, frozen replay record, and descriptor-bound effect port are implemented in the authorized Batch C paths.
- Focused `packages/sdd-runtime/src` verification is green (`387 pass / 0 fail`); root TypeScript compilation and Serena diagnostics are green.
- Retry accounting remains active for `INC-BATCH-C-DECISION-BOUNDARY-PRODUCTION-SAFETY-v1`: no success/closure is recorded because only 17 individually named Batch C cases currently exist, while C-R6/C-B6 requires all 68 rows.
- Next verification stage is `targeted`; broad verification and independent Verify/Review are blocked until the exact matrix is complete.
- C-R1/C-C2/C-B1 remain deferred exclusively to `HO-BC-TO-BD-HOST-REACHABILITY-v1`; no Batch D bridge scope was implemented.

### EG3-R1 matrix-completion follow-up

- The terminal guard is now captured at control-plane ingress and replayed from the frozen record; composition passes the declared governance context to planning.
- A 68-ID literal scenario catalog and a shared full-contract assertion helper were added. Focused verification passed `112/112`; SDD runtime `442/442`; core `1474/1474`; legacy/export/registry `33/33`; root typecheck; and broad `3481/3481` under the 900000 ms allowance.
- The generated skill SHA-256 remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- This is not closure: the catalog audit does not make every existing named matrix test invoke the helper with literal complete expectations. The exact retained Apply blocking set is `{C-R6, C-B6}`; next verification stage remains `targeted`.

### EG3-R1 exact matrix completion

- All 68 catalog IDs are now individually named execution tests and each calls `assertBatchCContract()` with literal full-contract expectations. The static catalog audit remains additional enforcement only.
- Focused verification passed `202/202`; SDD runtime `510/510`; core `1474/1474`; TypeScript typecheck passed; broad verification under the 900000 ms allowance passed `3549/3549`.
- Generated SHA-256 remains `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no prohibited scope was changed.
- Exact Apply blocking set is now `[]`. Next stage is fresh independent Verify and Review; Batch C completion is not recorded.

### EG3-R1 security-and-oracle repair follow-up

- Attempted fingerprints: `BC-HBR-01`, `BC-HBR-02`, and `BC-HBR-03` have source-level repairs with targeted (`103/103`), affected SDD-runtime (`510/510`), root typecheck, and broad (`3549/3549`) evidence. Their next stage is `affected_area` pending independent reproduction.
- `BC-HBR-04` remains active: the existing 68 matrix names are synthetic and do not meet the required real-public-boundary oracle contract. Its next stage remains `targeted`.
- The exact active Apply blocking set is `{ BC-HBR-04 / C-R6 }`. No Batch C completion and no new implementation-complete registry event is recorded. Batch D handoff remains deferred and unimplemented.

### Combined direct-recovery gate-repair result

- Attempt `1/1` completed for the exact five-finding gate manifest; Apply-classified blocking set is `{}`.
- Exact RED reproduced `5` failures before product edits. GREEN repaired full six-dimension risk precedence and positive-progress conjunction, mandatory manifest authority and complete delta recomputation, unrelated-baseline universe isolation, depth-3+ validated dossier history, and package-root public acceptance quality.
- Affected cycle passed: direct matrix `27/27`, Batch B acceptance `66/66`, contracts/delta/dossier/public matrix `165/165`, sdd-runtime `350/350`, core `1474/1474`, typecheck, and clean Serena diagnostics.
- Broad cycle passed `3386` tests and reported only the exact three approved unchanged stale prepare-release failures. Binary-doctor and unclassified failures were absent.
- Generated SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; generated/build-info drift and scope expansion were absent.
- Next verification stage: one fresh independent registry-deferred Verify+Review gate. This result does not record Batch B completion and does not authorize Batch C/later.

### Gate-repair-2 implementation result

- Attempt `1/1` completed for fingerprint `INC-BATCH-B-FINAL-LOCAL-INVARIANTS-v1`; Apply-classified blocking set is `[]`.
- B-B2: added same-identity relationship transition guards to `computeFailureDeltaV1` in `packages/sdd-runtime/src/orchestrator/failure-delta.ts`. Exact error `invalid-evidence: finding relationship transition` rejects both `unrelated_baseline → batch_related` and `batch_related → unrelated_baseline` transitions.
- B-B3: added append-only prefix guards to both `reviseExecutionDossierV1` and `parseDossierRevisionV1` in `packages/sdd-runtime/src/contracts/execution-dossier.ts`. Exact errors `invalid-evidence: registry intent prefix` and `invalid-evidence: decision digest prefix` validate length ≥ previous before prefix comparison.
- B-B7 subset export: replaced subset/count evidence in `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts` with exact function-by-function assertions over all 25 supported Batch B V1 public exports plus internal-helpers exclusion.
- B-B7 combined placement: split the single combined placement test into four individually named package-root tests with exact error assertions.
- Affected cycle passed: target tests `43/43`, Batch B contracts `173/173`, sdd-runtime `359/359`, core `1474/1474`, typecheck clean, Serena diagnostics clean.
- Broad cycle passed `3398/0` across 190 files; zero quarantine failures; zero unclassified failures.
- Generated SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`; no gate-repair-2 generated or build-info drift.
- Apply blocking set: `[]`. Next stage: fresh independent registry-deferred Verify and Review. Batch B completion and Batch C authorization are deferred pending those gates.

### Gate-repair-3 implementation and closure evidence

- Attempt `1/1` completed for fingerprint `INC-BATCH-B-FINAL-TWO-ORACLES-v1`; Apply-classified blocking set is `[]`.
- B-B3 prior-decision order: `reviseExecutionDossierV1` validates `previous` using only its expected predecessor count, fixing the revision-N-with-N-history-items case while preserving existing revision-2 callers. Prior-decision truncation/reorder remains rejected by length and element-wise prefix validation.
- B-B3 parser oracle: individually named depth-3 tests cover valid registry-intent append, valid prior-decision append, issuance truncation rejection, prior-decision reorder rejection, parser-side forged truncation rejection, and parser-side forged prefix mutation/order rejection; parser-side prefix guards remain in `parseDossierRevisionV1`.
- B-B7 exact export oracle: `batch-b-replacement.test.ts` compares `Object.keys(publicApi).sort()` against the complete literal 57-key package-root surface, replacing subset/count evidence.
- Affected verification passed: direct Batch B tests `49/49`, contracts `179/179`, sdd-runtime `365/365`, core `1474/1474`, TypeScript clean.
- Broad verification completed with `bun test --timeout 30000` under a `900000 ms` wall timeout: `3401 pass / 3 fail / 3404 total`, `11881` expectations across `190` files. The only failures are the three approved stale `scripts/prepare-release.test.ts` cases caused by build-info commit `652a9b0` not matching HEAD `f88a538e493a2792076f084234054bb8904f655b`; no binary-doctor or unclassified failure occurred.
- Generated audit: `packages/core/src/skills/external/content.generated.ts` remains SHA-256 `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` and is correctly classified as the earlier authorized Batch A canonical generated change, not Gate Repair 3 drift. `apps/cli/src/runtime/build-info.generated.ts` was not edited.
- Scope audit: Gate Repair 3 changed paths are limited to the official artifacts and Batch B contract/test files recorded in `apply-progress.md`; no Batch C/later, adapter, registry coordinator, lane/prompt, dependency, generated output, build-info, historical OpenSpec archive, excluded WIP, or unrelated path was added.
- State: `verify-review-required-gate-repair-3`. Next stage remains fresh independent registry-deferred Verify and Review. Batch B completion and Batch C authorization are not recorded.

### Gate-repair-4 implementation result

- Attempt `1/1` completed for fingerprint `INC-BATCH-B-HISTORY-TYPES-BROAD-CLOSURE-v1`; Apply-classified blocking set is `[]`.
- B-B3 registry parser oracle: added exact, individually named parser-side revision-3 tests for registry-intent truncation, reorder, and inserted/mutated prefix using forged self-hashed wire dossiers and exact `invalid-evidence: registry intent prefix` assertions.
- B-B3 history contract: `reviseExecutionDossierV1` no longer slices oversupplied histories. Issuance now requires exactly `previous.revision - 1` ordered ancestors; parsing requires exactly `revision - 1` ordered predecessors; all entries are recursively validated with exact earlier subchains.
- Typecheck: digest literals in the direct-recovery test now use a local template-literal `Digest` helper and typed `hash()` output. Root `bunx tsc --noEmit` passed; no production type weakening, blanket `any`, or `ts-ignore` was used.
- Prepare-release diagnosis: the isolated `--sha256-file` failure is stale build-info gating before SHA calculation, not the separate nightly invalid-channel test. With `--skip-staleness-check`, the SHA-256 path exits `0` and prints the expected hash for a temporary proof file. No build-info or release source/test file was edited.
- Affected verification passed: direct/export `54/54`, Batch B acceptance `86/86`, contracts `184/184`, sdd-runtime `370/370`, core `1474/1474`, and root typecheck.
- Broad verification completed with `bun test --timeout 30000` under a `900000 ms` wall timeout: `3406 pass / 3 fail / 3409 total`, `11886` expectations across `190` files. The only failures are established stale build-info `prepare-release` cases; no binary-doctor or unclassified failure occurred.
- Generated/scope audit: `content.generated.ts` remains SHA-256 `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` and is prior Batch A generated state; build-info remained tracked-clean and unmodified. Gate Repair 4 scope is limited to dossier contract/tests and active OpenSpec artifacts.
- State: `verify-review-required-gate-repair-4`. Next stage remains fresh independent registry-deferred Verify and Review. Batch B completion and Batch C authorization are not recorded.
