# Repair Incident: Verify and Review Blocking Findings

**Change ID**: `fix-runner-model-discovery-regression`
**Incident ID**: `verify-review-blockers-round-1`

## Governance

- Operating mode: interactive
- Initial outcome: repair
- Decision: repair
- Apply batch budget: 3
- Fingerprint budget: 1 repair attempt per blocking fingerprint before replan/escalation
- Verification-cycle limit: 2
- Soft checkpoint: after the first post-repair Verify + Review cycle
- Hard stop: after the second failed verification cycle or recurrence of an exhausted fingerprint without explicit override

## Active Scope

### Batch 1 — Backend and security

- Production-lifetime cache, complete secret-safe fingerprint, and wired private LKG.
- Hard subprocess timeout, bounded output, deterministic termination reason, SIGTERM/SIGKILL escalation, and UTF-8-safe decoding.
- Closed-schema LKG validation, timestamp/identity bounds, private mode repair, unique atomic temporary files, and safe cleanup.
- Preserve unchanged assignments exactly and bind install validation to the supplied immutable plan.
- Add deterministic backend/security coverage for these fingerprints.

### Batch 2 — TUI and compatibility

- Persist exact runner-resolved variant keys without legacy static reasoning resolution.
- Guard async discovery with latest-request/runtime/project identity.
- Route successful empty discovery to a stable Retry/Back state.
- Add full-flow deferred-Promise and runner-only variant persistence tests.

### Batch 3 — Regression matrix and cleanup

- Complete remaining parser/process/cache/LKG/TUI/Pi adversarial matrix.
- Reconcile obsolete cache-authority comments and fixture naming.
- Run focused, broader, typecheck, package, and repo-wide baseline gates.

## Fingerprints

1. `discovery-runtime-cache-fingerprint-lkg-unwired`
2. `opencode-timeout-not-hard-bounded`
3. `runner-variant-static-resolution-leak`
4. `unchanged-assignment-field-mutation`
5. `async-discovery-stale-response-overwrite`
6. `successful-empty-state-routing`
7. `lkg-validation-privacy-integrity`
8. `required-regression-matrix-incomplete`
9. `mutable-last-plan-cross-request-risk`
10. `chunked-utf8-decoding-corruption`

## Current State

- Status: awaiting final verification
- Apply batches used: 3 / 3 plus override 1 / 1
- Verification cycles used: 1 / 2
- Override attempts consumed: one each for `discovery-runtime-cache-fingerprint-lkg-unwired`, `opencode-timeout-not-hard-bounded`, `required-regression-matrix-incomplete`
- New fingerprints: none
- Automatic repair permitted: no
- Next action: Verify + Review cycle 2

## Batch Results

### Batch 1 — Backend and Security

- Result: completed
- Attempted fingerprints: `discovery-runtime-cache-fingerprint-lkg-unwired`, `opencode-timeout-not-hard-bounded`, `unchanged-assignment-field-mutation`, `lkg-validation-privacy-integrity`, `mutable-last-plan-cross-request-risk`, `chunked-utf8-decoding-corruption`.
- Resolved fingerprints: all attempted fingerprints.
- Unresolved fingerprints: none in this batch scope.
- Evidence: closed-schema LKG RED test then focused adapter tests (35 passing) and `bunx tsc --noEmit` passed. No network, live runner authority, or real user filesystem writes were used by tests.
- Retry accounting: one repair attempt consumed for each attempted fingerprint; no recurrence was observed.
- Next verification stage: targeted, affected-area verification after Batch 2; Batch 3 owns broad gates.

### Batch 2 — TUI and Compatibility

- Result: completed
- Attempted fingerprints: `runner-variant-static-resolution-leak`, `async-discovery-stale-response-overwrite`, `successful-empty-state-routing`.
- Resolved fingerprints: all attempted fingerprints.
- Unresolved fingerprints: none in this batch scope.
- Evidence: the deferred coordinator tests cover both request completion orders and runtime/project identity matching; TUI discovery/assignment/flow tests passed (85); focused adapter/native-persistence tests passed (4); `bunx tsc --noEmit` passed. Tests used deferred promises, fixture inventory, and temporary test directories only.
- Retry accounting: one repair attempt consumed for each attempted fingerprint; no recurrence was observed.
- Next verification stage: targeted/affected-area verification is complete for Batch 2. Batch 3 owns broad gates and the remaining deterministic regression matrix.

### Batch 3 — Regression Matrix and Cleanup

- Result: completed
- Attempted fingerprints: `required-regression-matrix-incomplete`.
- Resolved fingerprints: `required-regression-matrix-incomplete`.
- Unresolved fingerprints: none in this batch scope.
- Advisory cleanup: replaced obsolete cache-authority fixture prose and `runner-cache` terminology with runner-resolved inventory language; reconciled old changed-write fixture expectations to native `variant` persistence.
- RED evidence: the new injected process-boundary seam initially failed to load because `createNodeOpenCodeCommandRunner` did not exist. The expanded LKG test then failed because a public LKG directory was accepted on read.
- GREEN evidence: hermetic parser/process/cache/LKG tests pass, including built-in/custom/plugin/alias entries, nested/braced/escaped records, split UTF-8, every parser/process bound, 14,999/15,000 ms timeout behavior, ignored SIGTERM/SIGKILL, coalescing/LRU/failure/rescan, fingerprint dimensions, and private atomic LKG compatibility.
- Gate evidence: focused matrix 272 passed; TypeScript passed; broader adapter/TUI 591 passed; `bun run test` 3,269 passed; `bun test` 3,268 passed with only the known Binary smoke doctor timeout.
- Retry accounting: one repair attempt consumed for `required-regression-matrix-incomplete`; no exhausted Batch 1 or Batch 2 fingerprint recurred. The advisory terminology cleanup required no retry budget.
- Next verification stage: broad gate complete; proceed to Verify + Review cycle 1.

## Verification Cycle 1

- Focused matrix: 272 passed
- Broader affected tests: 591 passed
- Package tests: 3,269 passed
- Repo-wide: 3,268 passed; one known baseline binary-doctor failure
- Requirements: 32 / 33
- Scenarios: 35 / 36
- Tasks: 8 / 10
- TUI/compatibility slice: passed
- Backend/security slice: changes requested

### Remaining exhausted recurrences

1. Production fingerprint/LKG scope omits complete config/auth/plugin state and a runner/project-derived scope.
2. Caller-visible timeout settles at 15,250 ms rather than the 15,000 ms contract; version probing also precedes verbose discovery.
3. Integration tests still bypass parts of default production composition and encode the timeout defect.

The hard-stop rule is active. No additional Apply retry may launch without an explicit user override or an approved replan.

## Human Override

- Authorized: yes
- Authorized by: user
- Timestamp: 2026-07-12T22:35:00Z
- Decision: escalated after final verification
- Scoped fingerprints: `discovery-runtime-cache-fingerprint-lkg-unwired`, `opencode-timeout-not-hard-bounded`, `required-regression-matrix-incomplete`
- Additional Apply budget: one focused batch
- Additional attempt budget: one attempt per scoped fingerprint
- Verification cycles remaining: zero
- Final hard stop: any scoped recurrence or failed Verify + Review cycle 2
- Override batch used: 1 / 1
- Attempts consumed: one per scoped fingerprint
- Status: escalated
- Next action: human disposition or separately authorized new change

## Final Verification Cycle 2

- Focused R1 tests: 140 passed
- Broader affected tests: 596 passed
- Package tests: 3,274 passed
- Repo-wide: 3,273 passed; one known baseline binary-doctor failure
- Requirements: 32 / 33
- Scenarios: 35 / 36
- Tasks: 10 / 11
- Absolute 15,000 ms deadline: resolved
- Final scoped recurrences: `discovery-runtime-cache-fingerprint-lkg-unwired`, `required-regression-matrix-incomplete`
- New fingerprints: none

### Final remaining blockers

1. The production fingerprint over-redacts non-secret semantic configuration values, so same-stat model/provider/plugin/path/control changes can reuse stale memory/LKG authority.
2. Mounted `DeckApp` deferred loading/ready/empty/stale/blocked, Retry/Back, latest-result, and project-identity transition coverage is still absent; coordinator-only tests do not satisfy R1.
3. A low-priority literal `\\n` comment cleanup remains.

All authorized Apply and verification budgets are exhausted. No additional automatic Apply, Verify, or Review cycle is permitted.

## Final Closure Exception

- Authorized: yes
- Authorized by: user
- Timestamp: 2026-07-12T23:35:00Z
- Additional Apply batches: one
- Additional verification cycles: one
- Scope: secret-safe semantic production fingerprint projection; mounted `DeckApp` deferred transition evidence; remaining literal-comment cleanup
- Out of scope: all already resolved behavior and any new feature work
- Hard stop: any blocking finding or failed final closure verification
- Apply batch used: 1 / 1
- Apply outcome: partial verification timeout after scoped code/tests were written
- Apply retries remaining: zero
- Next action: final closure Verify + Review

### Closure Apply evidence

- RED reproduced the semantic fingerprint collision and missing mounted loading route.
- GREEN passed semantic projection and mounted loading-to-ready coverage.
- The combined mandatory gate command exceeded the Apply agent execution window.
- Final Verify + Review owns broader gates and source-level closure evidence.

## Final Closure Verification

- Status: failed and escalated
- Closure Apply batches used: 1 / 1
- Closure verification cycles used: 1 / 1
- Closure scope verified: 1 / 3
- Requirements: 32 / 33
- Scenarios: 35 / 36
- Tasks: 10 / 11
- Archive ready: no
- Automatic repair permitted: no

### Final blockers

1. The fingerprint projection still suppresses some non-secret provider option semantics while allowing unknown credential-like values to influence the digest; virtual config references are incomplete.
2. Mounted `DeckApp` coverage still omits latest-request-first reverse completion and the discovery screen's Back action.
3. The closure test's process-wide `release-check` mock introduces six new broader-suite failures.

The final closure exception is exhausted. The change remains escalated and cannot archive.

## Separately Authorized Corrective Resolution

- Authorized by: user
- Backend semantic fingerprint correction: passed
- Mounted DeckApp transition and release-check isolation correction: passed
- Embedded environment-reference correction: passed
- Requirements: 33 / 33
- Scenarios: 36 / 36
- Tasks: 11 / 11
- Final Verify: passed
- Final Review: passed with zero findings
- Repo-wide result: 3,284 passed; one known Binary doctor baseline failure
- Status: resolved
- Archive ready: yes
