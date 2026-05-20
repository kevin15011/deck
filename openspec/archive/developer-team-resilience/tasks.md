# Tasks: Developer Team Resilience

## Source

- Spec: developer-team-resilience spec artifact
- Design: developer-team-resilience design artifact
- Capabilities affected: adaptive-quality-control, runner-orchestration-resilience, artifact-state-contracts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 800–1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Contracts+Scorer+Router → PR 2: Loop+Runner+State → PR 3: Budget+Integration+Tests |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Maintainer-approved size exception: delivery_strategy is exception-ok; forecast exceeds 400-line budget. Proceed with full implementation in logical work units.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Contracts + risk scorer + quality router | PR 1 | Foundation layer; TDD tests included |
| 2 | Loop breaker + runner recovery + state manager | PR 2 | Core resilience; TDD tests included |
| 3 | Budget watchdog + integration wiring + discovery + migration + scenario tests | PR 3 | Full pipeline wiring + verification |

## Phase 1: Contracts / Types

- [x] 1.1 Create `<sdd-runtime>/contracts/self-audit.ts` — audit field types for Spec/Design/Tasks (invariants, boundaries, ambiguity, risk signals, confidence). RED: validation rejects missing required fields.
- [x] 1.2 Create `<sdd-runtime>/contracts/risk.ts` — risk score (0..100), tier, signals array, thresholds, overrides, recommended checks.
- [x] 1.3 Create `<sdd-runtime>/contracts/outcome.ts` — phase outcome status (success|partial|failed|transport_unknown|budget_exceeded), artifact refs, hashes, validation result.
- [x] 1.4 Create `<sdd-runtime>/contracts/state-update.ts` — structured update types (baseVersion, operation, patch/events, writerId, idempotencyKey).

## Phase 2: Core Components

- [x] 2.1 Create `<sdd-runtime>/orchestrator/risk-scorer.ts` — compute risk from universal + discovered signals; adapt weights to detected capabilities. RED: threshold boundary table tests.
- [x] 2.2 Create `<sdd-runtime>/orchestrator/quality-router.ts` — invoke quality agents only above threshold; log skip decisions for auditability. RED: low-risk skip test.
- [x] 2.3 Create `<sdd-runtime>/orchestrator/loop-breaker.ts` — normalized failure fingerprints, cycle detection; 2→repair, 3→replan, 4→escalation. RED: similar-cycle detection test.
- [x] 2.4 Create `<sdd-runtime>/runner/runner-recovery.ts` — classify transport vs implementation failure; validate artifact structure, freshness, hash; retry/resume from latest valid. RED: artifact-present-valid resume test.
- [x] 2.5 Create `<sdd-runtime>/artifact-state/artifact-state-manager.ts` — structured updates with optimistic version checks; single-writer or event-sourced adapter; reject stale with conflict details + retry guidance. RED: stale version rejection test.
- [x] 2.6 Create `<sdd-runtime>/orchestrator/budget-watchdog.ts` — configurable time/token/turn thresholds; soft→checkpoint prompt, hard→stop with budget-exceeded outcome. RED: hard-budget stops execution test.

## Phase 3: Integration / Wiring

- [x] 3.1 Wire orchestrator pipeline: producer audit → risk scorer → quality router → apply, with loop breaker intercepting fix cycles.
- [x] 3.2 Wire runner pipeline: recovery classifier → budgets → state manager for resumable phase execution.
- [x] 3.3 Add project discovery adapter: detected test/build/capabilities feed risk scoring and quality routing; degrade gracefully when absent or unknown.

## Phase 4: Tests (TDD — Scenario Coverage)

- [x] 4.1 Test: low-risk no-extra-quality — score <30 → no quality agent invoked, skip decision logged.
- [x] 4.2 Test: high-risk conditional quality — score ≥60 → quality gate enforced before Apply.
- [x] 4.3 Test: repeated loop replan — 3 similar failures trigger replan; different failures do not falsely loop.
- [x] 4.4 Test: transport error with artifact present-valid — resume from valid artifact, not relaunch duplicate work.
- [x] 4.5 Test: stale state update recovery — rejected with current version + retry guidance; refresh-retry succeeds.
- [x] 4.6 Test: budget escalation — soft budget → checkpoint prompt; hard budget → stop with budget-exceeded outcome.

## Phase 5: Migration / Compatibility

- [x] 5.1 Report-only mode: contracts optional, scoring logs warnings but does not gate phases.
- [x] 5.2 Enable conditional routing: thresholds gate quality invocation; state manager enforces version checks.
- [x] 5.3 Full enforcement: locks/events required; legacy writes readable with deprecation warnings.

## Dependency Graph

```
1.1–1.4 (Contracts)
  → 2.1 Risk Scorer → 2.2 Quality Router
  → 2.3 Loop Breaker
  → 2.4 Runner Recovery
  → 2.5 State Manager
  → 2.6 Budget Watchdog
  → 3.1–3.3 (Integration)
  → 4.1–4.6 (Scenario Tests)
  → 5.1–5.3 (Migration)
```

## Routing

All tasks: **General Apply** — core runtime contracts and infrastructure, not backend/frontend domain-specific.

## Open Questions / Blockers

None — tasks are ready for Apply. Default threshold values should ship conservative and calibrate from runner telemetry.
