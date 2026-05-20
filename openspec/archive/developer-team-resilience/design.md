# Design: Developer Team Resilience

## Source

- Proposal: `developer-team-resilience` proposal artifact
- Capabilities affected: `adaptive-quality-control`, `runner-orchestration-resilience`, `artifact-state-contracts`
- Spec status: not yet available
- Scope: general SDD/runtime architecture; project discovery supplies stack/tool specifics.

## Current Architecture Context

Existing SDD flows produce phase artifacts and registry events, but quality routing, runner outcome recovery, artifact mutation, and budget handling are mostly convention-driven. The design therefore adds reusable contracts and manager interfaces around any SDD orchestrator instead of requiring project-specific paths, tools, or agent names.

## Proposed Architecture

Add a resilience layer between producer phases, quality phases, runners, and artifact stores.

```text
Spec/Design/Tasks ── self-audit ──> Risk Scorer ──> Quality Router ──> Apply
        │                               │                  │
        └──── Artifact State Manager <──┴── Loop Breaker <─┘
                        │
                 Runner Recovery + Budgets
```

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `selfAuditContract` | Required machine-readable sections for Spec, Design, Tasks. | new |
| `riskScorer` | Convert universal + discovered signals into `0..100` risk and routing tier. | new |
| `qualityRouter` | Invoke focused quality checks only above threshold. | new |
| `loopBreaker` | Detect repeated/similar failures, force repair/replan/escalation. | new |
| `runnerRecovery` | Classify transport/timeout/budget/artifact outcomes and resume safely. | new |
| `artifactStateManager` | Structured updates, versions, locks/events, adapter boundary. | new |
| `budgetWatchdog` | Phase budgets, checkpoint prompts, stop/replan reports. | new |

## Contracts

| Contract | Required fields |
|---|---|
| Spec self-audit | invariants, boundaries, external contracts, sensitive data, test direction |
| Design self-audit | risk surface per decision, state mutation, compatibility, rollback, observability |
| Tasks self-audit | task readiness, splitability, boundary tests, rollback step, blockers/placeholders |
| Risk result | `score`, `tier`, `signals[]`, `thresholds`, `overrides[]`, `recommendedChecks[]` |
| Phase outcome | `status: success|partial|failed|transport_unknown|budget_exceeded`, artifact refs, hashes, validation result |
| State update | `baseVersion`, `operation`, `patch/events`, `writerId`, `idempotencyKey` |

## Risk Scoring and Routing

Universal signals: changed public contracts, state mutation, secret/auth/payment handling, concurrency, data migration, destructive operations, cross-boundary integration, missing tests, blocked/placeholder tasks, large task count, prior loop history. Project-discovery inputs: detected architecture boundaries, test commands, ownership rules, artifact store capabilities, quality tools, deployment/rollback support.

Default thresholds: `<30` standard flow; `30..59` boundary/contract quality check; `60..79` boundary + security/integration checks before Apply; `>=80` require replan or explicit user override before Apply. Overrides must be named, time-bounded, logged in the registry, and never disable runner recovery or state validation.

## Loop Breaker / Recovery / Budgets

Loop similarity uses normalized failure fingerprints: phase, task group, failing contract, error class, changed file/component set, and reviewer/verify finding text hashes. Two similar failures trigger task repair; three trigger replan artifact; four stop and require user override. Replan records failure clusters, proposed split, scope reduction, and new risk score.

Runner recovery validates artifacts after ambiguous exits: required sections, parseability, schema/version, hash/idempotency key, and registry event consistency. Classifications distinguish agent failure, transport lost before start, transport lost after artifact write, timeout, budget exhaustion, and stale-write conflict. Retries resume from latest valid artifact; unsafe conflicts stop for replan.

Budgets are configured per phase for time, tokens, turns, tool calls, and artifact size. Soft limits request checkpoint/compaction; hard limits produce `partial` plus a budget report and route to split, replan, or user escalation.

## State / Persistence Implications

All artifact stores sit behind adapters: filesystem, memory, database, or hosted store. The manager enforces single-writer per artifact or transactional event sourcing, optimistic `baseVersion` checks, idempotency keys, and append-only event history. Stores without native locks emulate leases; stale leases require recovery validation before takeover.

## Migration / Backward Compatibility

Existing flows continue if audits are absent: missing sections default to conservative risk signals and warnings. Direct writes remain readable; new writes should go through the state manager. Rollout: introduce contracts as optional, score in report-only mode, enable conditional routing, then enforce locks/version checks.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `openspec/changes/developer-team-resilience/design.md` | create | Design artifact. |
| `<sdd-runtime>/contracts/*` | create | Portable schemas for audits, risk, outcomes, updates. |
| `<sdd-runtime>/orchestrator/*` | modify/create | Risk scoring, quality routing, loop breaker, budgets. |
| `<sdd-runtime>/artifact-state/*` | create | Adapter-backed state manager. |
| `<sdd-runtime>/runner/*` | modify/create | Recovery classification and resumability. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | scoring thresholds, overrides, similarity, budget transitions | table/property tests |
| Contract | audit schemas, outcome/state-update validation | fixture compatibility tests |
| Integration | ambiguous transport with artifact present, stale version, lock expiry | fake store + fake runner |
| Regression | legacy artifacts without audits still run with warnings | migration fixtures |

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Quality routing | Threshold-based focused checks | Always-on agents | Preserves speed/cost for low-risk work. |
| State mutation | Manager + versions/events | Free-form text edits | Prevents stale anchors and concurrent corruption. |
| Loop handling | Similarity + replan | Counter only | Fixes root causes before stopping. |
| Store support | Adapter boundary | One canonical backend | Keeps adoption project-agnostic. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Score miscalibration | Medium | Medium | Report-only rollout and configurable thresholds. |
| Manager complexity | Medium | High | Minimal interface, adapter tests, event audit trail. |
| Overriding unsafe stops | Low | High | Logged, explicit, scoped user override only. |

## Open Decisions

- Exact default numeric budgets should be calibrated from runner telemetry; ship conservative configurable defaults.

## Dependencies

- Agreement on common schemas for audit sections, risk results, phase outcomes, and state updates.

## Next Steps

Ready for Task (`deck-developer-task`) to combine with Spec and break into implementation tasks.
