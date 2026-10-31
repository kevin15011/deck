# Readiness cache correction working brief

## Intent and evidence

Avoid rebuilding an unchanged Codebase connection solely because another runner prepares a distinct compatible configuration for the same project. The verified two-spec reproduction and live evidence are in `live-preparation-review.md`. This is a follow-up implementation slice, separate from the already deployed measurement candidate.

## Acceptance and constraints

- Preserve the full exact reuse key, executable integrity verification, effective environment and credential isolation. Do not merge connections by content digest or log key/environment fingerprints.
- For unchanged independently verified binaries with equal effective environments, A → B → A should reuse A while capacity allows; each distinct spec retains its own process/runtime.
- Retain conservative supersession for credential/environment changes and executable identity changes at the same launch location. Do not treat a stale verified file as current.
- Bound retained warm connections explicitly (target two per project) and evict least-recently-used eligible entries; active leases and initialization operations must never be disposed early. Document transient overflow from active leases and prune after release/completion. Avoid unbounded dead entry retention.
- Preserve negative-cache behavior, concurrent initialization coalescing, cancellation, fresh-runtime recovery after a failed warm probe, and shutdown/drain semantics.
- Add deterministic regression tests before implementation: alternating specs, active leases, capacity overflow/drain, credential rotation, executable replacement, cancellation and cleanup as affected. Tests use fake processes, no network or model calls.
- Do not expand to context handling, runner startup architecture, install path consolidation, daemon activation or new telemetry. If a safe bounded correction conflicts with existing requirements, return the exact conflict before changing policy.

## Ownership and verification

Apply Deep owns the readiness implementation and focused tests. Lead owns OpenSpec persistence. Independent review is required before activation because process lifetime and credential boundaries are involved. Verify focused readiness and composition tests plus type checking; broaden only if evidence requires it. Improvement claims require measured post-activation evidence; synthetic spawn-count reduction alone is not a measured latency reduction.

Implementation task: `task-4bf761c7-5484-4e8b-931d-99698645e3c2`, owner `apply-deep`; attempt 1 completed and reviewed as a candidate (result 13449 / ended 13450). Changes are confined to readiness service and tests. The candidate retains distinct compatible binaries, uses a two-connection retention target with lease-aware pruning, preserves environment/location supersession, and bounds negative entries. Implementer reports RED→GREEN, 101 tests passing, typecheck and whitespace passing; independent verification remains pending.

Independent review: `task-42242c04-39b4-4a34-a996-c6f54bf9e0c9`, owner `quality`, tasked with concurrency, cancellation, shutdown, resource bounds and credential isolation review. The candidate is not installed or active; the daemon still runs the measurement build.

Review attempt 1 (result 14546 / ended 14547): **request changes** for a lifecycle acceptance gap. A pending warm probe can lose its retired connection when the previous native consumer releases its last lease: `release` checks consumers but not pending probe ownership. Reviewer reproduced two spawns/zero drains becoming three spawns/one drain; this also occurs on HEAD, so it is inherited rather than introduced by the candidate. Lead checked the corresponding source and accepted the finding. Preserve probe ownership through settlement and add the regression before activation.

Independent validation passed 99 tests with `bun test --timeout 30000 apps/cli/src/session-codebase-readiness.test.ts apps/cli/src/session-shared-services.test.ts apps/cli/src/session-service.test.ts`, `bunx --no-install tsc --noEmit --incremental false`, and candidate whitespace checks. These passing checks do not cover the newly reproduced race. No additional credential-isolation or lifecycle-policy conflict was reported. The same implementation owner receives the correction; the same reviewer will assess the resulting delta.

Implementation attempt 2 (result 15411 / ended 15412) adds connection-to-entry ownership so last-lease release preserves a pending probe and unpublished admissions, including superseded entries removed from the reuse map. A failed probe detaches its generation before retirement. Lead inspected the production delta and four regression cases (completion, failure, cancellation, shutdown), plus logs showing four RED failures, four GREEN passes, and 103 passing tests across the same three suites. Evidence: `/tmp/deck-readiness-p2-production.patch`, `/tmp/deck-readiness-p2-red.log`, `/tmp/deck-readiness-p2-green.log`, `/tmp/deck-readiness-p2-suites.log`. Typecheck and whitespace passed per implementer. Same-owner independent delta review is pending; no installation or activation has occurred.

Final independent review attempt 2 (result 16072 / ended 16073): **approve**, no blocking findings. The reviewer reran the original reproduction: two spawns, zero early drains, same runtime reused, both processes drained on shutdown. All 40 readiness tests passed independently, including the four new lifecycle cases; typecheck and scoped whitespace passed. Injected retirement failure rejected admission and shutdown without an observed unhandled rejection. The reviewer inspected the 103-pass composition log without duplicating unaffected suites and confirmed unchanged candidate hashes. Lead accepted this review. The implementation is ready for a local canary build; real latency improvement remains unmeasured.

Follow-up after activation: broader web tests exposed a cancellation fixture race. Apply Deep attempt 3 (result 20936 / ended 20937) compared current code and extracted baseline `eaa82bc`; both expired the 50 ms cold deadline before the test submitted cancellation. Only `apps/web/src/session-codebase-availability.test.tsx` changed: synchronize at verification start and use the preparation command's returned ID before making a web read. Existing timeouts and availability assertions remain, with an added `preparation-cancelled` assertion. Lead inspected both diagnosis logs and `/tmp/deck-readiness-cancel-suites.log` (117 passed). This is a test correction, not a production cache regression or runtime change. Independent review is included with the compaction candidate.

Quality attempt 3 (result 23002 / ended 23003) independently approved the fixture correction: synchronization cancels at verifier entry, preserves deadlines and strengthens the assertion without masking a cache regression. No production change is required for this follow-up.

Rollback is a code reversal of this isolated cache slice; no persistent-state migration is intended. Deployment is separate from producing the reviewed candidate.
