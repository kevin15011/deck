# Proposed required integration gate

Status: REJECTED by the user on 2026-11-01. The user explicitly declined changing the timing requirements in AGENTS.md. This document is retained only as proposal history, not implementation authority. The existing2s/file and90s total limits remain binding. No test classification, CI command, limit or source has been changed.

## Evidence and recommendation

Timing diagnosis36 measured417 SQLite commits consuming13.638s of a21.006s pipeline execution. The same filtered pipeline still took2.948s on tmpfs, which also does not supply equivalent power-loss evidence. Native refresh planning consumed1.976s of a3.604s run. Micro-optimization is not established as a sufficient path to the current2s/file limit.

Keep the fast gate at2s/file and90s total. Add a separately required integration gate for the exact21 files below, without changing their assertions, corpus sizes, SQLite synchronization, process-death recovery, native isolation or disk-backed storage. This is classification by their full-composition/durable/native integration scope, not a quarantine or skipped-test ledger.

Proposed integration limits:120s per file,600s total, maximum2 concurrent workers, external deadline termination of process groups. These are finite proposed limits informed by observed75s composition cases, not a proven future pass. Preserve credential-cleared synthetic test environments and fake providers. No tmpfs substitution, no automatic retry with larger allowances. Any failure or deadline fails the required gate.

## Concrete implementation

- Add an explicit versioned file inventory under `tests/` and shared discovery validation: every discovered non-quarantined test belongs to exactly one required gate; missing or duplicate entries fail.
- Retain `bun run test` as the fast gate and add `bun run test:integration` for the explicit inventory. Reuse runner deadline/process cleanup and generated-web preparation; avoid a new general test framework.
- Update `scripts/test.ts` and its affected tests, `package.json`, `.github/workflows/ci.yml`, `AGENTS.md` and `CONTRIBUTING.md` so both gates plus types are required before commit/CI acceptance. Give CI enough bounded time for both gates (proposed job timeout15minutes).
- Keep guard.test.ts and v5-compatibility.test.ts in the fast gate. No production memory, installer planning or authority code changes are needed for this classification.
- Run both required gates and types on the final candidate. Prior partial results do not substitute for this check. Report all limits and failures honestly; no automatic commit on a partial result.

## Explicit integration inventory

- `benchmarks/memory-live/adaptive-processing.test.ts`
- `benchmarks/memory-live/budget-proposals.test.ts`
- `benchmarks/memory-live/cost-guard.test.ts`
- `benchmarks/memory-live/native-regression.test.ts`
- `benchmarks/memory-live/pipeline.test.ts`
- `benchmarks/memory-live/processing-background.test.ts`
- `benchmarks/memory-live/processing-boundaries.test.ts`
- `benchmarks/memory-live/processing-forecast.test.ts`
- `benchmarks/memory-live/processing-gate.test.ts`
- `benchmarks/memory-live/processing-identity.test.ts`
- `benchmarks/memory-live/processing-monitor.test.ts`
- `benchmarks/memory-live/processing-policy.test.ts`
- `benchmarks/memory-live/processing-receipts.test.ts`
- `benchmarks/memory-live/processing-timeouts.test.ts`
- `benchmarks/memory-live/quality-regression.test.ts`
- `benchmarks/memory-live/rereview.test.ts`
- `benchmarks/memory-live/run-authority-sidecars.test.ts`
- `benchmarks/memory-live/run-authority.test.ts`
- `benchmarks/memory-live/shared-account.test.ts`
- `benchmarks/memory-live/supervision.test.ts`
- `packages/adapter-codex/src/refresh-concurrency.test.ts`

## Alternative and decision boundary

Retaining the existing policy requires a broader test/composition redesign with an explicit oracle-equivalence map. Its cost and ability to fit2s are not established. The recommended classification preserves the existing integration coverage and makes its cost visible. This proposal grants no paid evaluation or cleanup authorization.
