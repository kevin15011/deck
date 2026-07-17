# Incident Review: EG1-R1 and Batch A Acceptance

## Review Identity

- Change: `developer-team-execution-convergence`
- Incident: `INC-BATCH-A-GEN-SKILL-SUPPORT-ORDER-v1`
- Scope: auxiliary fresh independent Review of EG1-R1 and Batch A only
- Verdict: **FAIL — HARD STOP**
- Review agent: `deck-developer-review`
- Date: `2026-07-15`
- Lifecycle effect: the SDD phase remains Apply; Batch A is not accepted and Batch B remains blocked.

## Summary

The generator repair, generated output, telemetry value validation, bounded recording path, and adapter-owned capability probes are technically sound. The current generated file has SHA-256 `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` and its diff is an ordering-only canonical result. The three release failures remain an unchanged and safely bounded stale-build-metadata baseline.

Batch A nevertheless cannot be accepted. Two required acceptance protections remain defective: the scenario test described as replacing label-only fixtures still asserts fixture literals rather than invoking legacy behavior, and the generated-bundle test no longer compares the first canonical generation with the tracked pre-test bytes. Both defects are directly anchored to EG1-R1 and REQ-VERIFY-005/REQ-ROLLOUT-001. Because attempt 1/1 and verification cycles 2/2 are consumed, the disposition is a hard stop rather than another automatic repair request.

## Ratings

| Dimension | Rating | Evidence |
|---|---|---|
| Architecture and boundaries | Adequate | Repair remains localized and adapter capability ownership is explicit, but one compatibility oracle is not connected to production behavior. |
| Security and redaction | Strong | Telemetry uses a closed projection, drops seeded secret/path/prompt fields, validates runtime vocabulary, and probes grant no authority. |
| Determinism and immutability | Strong | Locale-independent traversal, frozen capability/event results, canonical hash, and ordering-only generated delta are demonstrated. |
| Adapter parity and portability | Strong | OpenCode and Pi expose equivalent frozen false capability surfaces and produce identical fail-closed codes. |
| Maintainability | Adequate | Changes are localized and add no dependency, but misleading test naming and a weakened cleanliness oracle create future regression risk. |
| Test quality | Weak | Two acceptance tests cannot detect the defects they claim to guard. |
| Economy / critical judgment | Strong | Standard library operations and direct local changes were used without unnecessary abstraction. |

## Findings

### BLOCKER — Compatibility fixtures still validate labels rather than legacy behavior

- Category: Correctness / Maintainability
- Anchors: EG1-R1 description and completion signal in `tasks.md`; REQ-ROLLOUT-001 and REQ-ROLLOUT-005.
- Evidence: `packages/sdd-runtime/src/fixtures/execution-v1/baseline-harness.test.ts:9-22` reads `EXECUTION_V1_FIXTURES.scenarios` and asserts only literal fields and array relationships. It invokes no legacy runtime, Verify/Review, incident, or set-classification implementation for `legacyNoContract`, `pass`, `verifyFailure`, `reviewFailure`, `incident`, `unchangedSet`, `shrinkingSet`, or `expandingSet`.
- Impact: a production compatibility regression can occur while this test remains green. The original incident finding requiring strengthened label-only compatibility fixtures is therefore not closed.
- Evidence consistency: `apply-progress.md:15` and `apply-progress.md:99`, `repair-incident.md:79`, and `events.yaml` currently overstate that all five deficiencies are resolved.
- Disposition: hard stop. No modifying attempt remains; Batch A is not accepted and Batch B stays blocked pending explicit replanning/new authorization.

### MAJOR — Generated-bundle test restores bytes safely but no longer verifies tracked canonical cleanliness

- Category: Correctness / Test Quality
- Anchors: REQ-VERIFY-005; EG1-R1 verification and completion signals in `tasks.md:114-119`.
- Evidence: `packages/core/src/skills/external/__tests__/content.test.ts:188-203` snapshots and restores the tracked file in `finally`, but the former `expect(afterFirst).toBe(before)` assertion was removed. The remaining assertion checks only `afterSecond === afterFirst`.
- Reproduction: if the tracked generated file is stale or hand-edited, the first generator run repairs it, the second run matches, the test passes, and `finally` restores the stale bytes. The test therefore cannot enforce generated cleanliness or reject direct drift.
- Impact: deterministic generation is checked, but the checked-in generated-output oracle required by REQ-VERIFY-005 is weakened. A future non-canonical tracked delta can pass this test.
- Disposition: hard stop under the exhausted repair budget. This is not a preference request; it is a concrete false-negative acceptance path.

## Original Incident Closure

| Original finding | Result | Evidence |
|---|---|---|
| Runtime telemetry semantic/value validation | Closed | `telemetry.ts:28-45` validates schema, enum membership, closed outcome-code syntax, non-negative safe-integer count, and finite non-negative duration; invalid runtime values are tested. |
| Real bounded baseline recording | Closed | `recordBoundedBaseline()` validates each fixture execution, emits through the supplied bounded sink, and retains only the final capacity rows; the capacity-two test checks recorder and sink snapshots. |
| Adapter-owned probes | Closed | Both adapters expose frozen owned capability surfaces; adapter tests consume those surfaces and prove equivalent fail-closed static-compatible outcomes. |
| Strengthened label-only compatibility fixtures | **Open — BLOCKER** | The named scenario test still asserts fixture literals without invoking actual legacy behavior. |
| Locale-independent deterministic traversal | Closed | The sole recursive `readdirSync()` traversal sorts dirents with explicit `<`/`>` name comparison. |
| Test isolation cannot leave tracked output dirty | Closed for restoration; acceptance oracle defective | `try/finally` restores snapshotted bytes without Git discard, but the removed before/first equality creates the separate MAJOR finding above. |

## Generated Output Assessment

- Current file: `packages/core/src/skills/external/content.generated.ts`
- Byte count: 445,136
- SHA-256: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`
- Canonical-source audit: no external `SKILL.md` or other canonical external skill source is changed.
- Diff analysis: seven removed and seven added generated property lines normalize to the exact same entry multiset. Only property order and trailing-comma placement differ. No skill payload was added, removed, or semantically modified.
- Generator source: `scripts/generate-skill-bundle.ts` now orders every recursive dirent traversal with the explicit locale-independent comparator.
- Assessment: legitimate canonical generator-source repair, not a hand edit or prompt/skill semantic change.

## Baseline Quarantine Assessment

- The three cases remain exactly: non-interactive release JSON, `--help`, and `--sha256-file` in `scripts/prepare-release.test.ts`.
- The ignored `apps/cli/src/runtime/build-info.generated.ts` still records commit `1bba98b`; the audited HEAD used by verification is `652a9b0ed14efc995300b9c982950a70b7792e98`.
- Neither `scripts/prepare-release.test.ts`, build-info source/output, nor release behavior appears in the changed-path set.
- The failures are unchanged, unrelated to Batch A, bounded to exactly three, receive no repair credit, and are safely quarantined under REQ-DECISION-002.

## Scope Audit

- Complete changed/untracked inventory reviewed: 26 paths.
- No Batch B/EG2 contract implementation, EG7 prompt work, Developer Team canonical prompt source, build-info repair, `scripts/prepare-release.test.ts`, unrelated product path, historical OpenSpec path, or other OpenSpec change was modified.
- No `runner-capability-standardization` path, artifact, registry history, or commit `8c6d167` work was modified.
- The active change artifacts preserve the one-attempt/two-cycle budgets and correctly keep formal Batch A acceptance pending Review, but their statements that every original deficiency is resolved are contradicted by the findings above.

## Independent Evidence

- Fresh focused review run: 34 passed, 0 failed, 370 expectations across seven repair/compatibility/generator test files.
- Passing tests do not cure the two false-negative oracle defects described above.
- Worktree and generated hash were re-read after the focused run; tracked generated bytes remained at the stated canonical hash.

## Registry Disposition

- Incident state: `review-failed/hard-stop`
- Overall phase: `apply`
- Overall status: `blocked-repair-exhausted`
- Event: append `repair.review.failed` only.
- Batch A acceptance: rejected.
- Batch B readiness: blocked.
- Retry: none authorized; explicit replan/new authorization is required before any modifying work.
