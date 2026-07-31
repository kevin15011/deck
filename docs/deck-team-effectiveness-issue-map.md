# Deck Team Effectiveness Issue Map

Deck should operate as an effective engineering team, not as a rigid workflow engine. This document records the main effectiveness problems observed in Deck sessions so they remain visible while the system evolves.

> **Audience:** Deck maintainers and contributors improving Developer Team behavior.
> **Status:** Living issue map. It records evidence and priorities, but is not an implementation specification.
> **Evidence:** The July 2026 Deck session audit, current prompt and runtime source, and a read-only audit of 12 external repositories with OpenSpec histories.

## North star

**Deck is a team, not a flow.**

The Orchestrator is the team lead. It should understand intent, select the smallest useful process, coordinate specialists, remove routine blockers, preserve quality, and help the team finish. It should not behave like a phase checklist that transfers every ambiguity or internal failure back to the user.

Deck should provide stronger quality and engineering discipline than a general Plan or Build agent while remaining similarly direct for ordinary work.

Every phase, delegation, artifact, and approval must earn its cost. The Orchestrator should prefer the most direct path that preserves the required quality and safety.

## Desired behavior

- Start useful work quickly when intent and scope are clear.
- Add coordination only when its expected benefit exceeds its cost.
- Prefer a more direct path when it can preserve the same required quality and safety.
- Scale ceremony and evidence to risk, not to the mere existence of an OpenSpec change.
- Adapt the process as evidence changes instead of committing to a fixed sequence at intake.
- Allow multiple independent changes and sessions to coexist.
- Treat planned path overlap as coordination information, not an automatic lock.
- Continue bounded diagnosis and authorized repair without routine user pauses.
- Preserve explicit hard stops for security, authorization, secrets, data loss, destructive operations, registry recovery, and Git discard operations.
- Keep quality checks independent, current, and proportional.
- Make incomplete closure, abandonment, parking, and supersession normal lifecycle outcomes.
- Distinguish candidate regressions from repository debt, environment failures, and harness failures.
- Optimize for accepted outcomes, not phase completion.

## Leadership proportionality test

Before adding a phase, delegation, artifact, approval, or repair cycle, the Orchestrator should answer:

1. What uncertainty will this resolve?
2. What decision will this enable?
3. What material risk will this reduce?
4. Is its expected benefit greater than its coordination cost?
5. Is there a more direct way to achieve the result with the same required quality and safety?

If the work does not provide enough value, the Orchestrator should skip it, combine it with existing work, or downshift to a lighter operating mode. This judgment must never weaken the explicit invariants for security, authorization, secrets, data loss, destructive operations, registry recovery, true write conflicts, or Git discard operations.

## Observed impact

The Deck repository audit found:

| Signal | Observed value |
|---|---:|
| Directories under `openspec/changes/` | 43 |
| Directories with `state.yaml` | 38 |
| Directories missing `state.yaml` | 5 |
| Canonical terminal records still under `changes/` | At least 10 |
| Terminal records including legacy forms | 17 |
| Stale exploration records without disposition | 12 |
| Stale later-phase records | 7 |
| Verify events in the 15 most recent changes | 44 |
| Review events in the 15 most recent changes | 22 |
| Failed events in the 15 most recent changes | 21 |

One audited change accumulated 29 Verify events, 9 Review events, and 11 failures before remaining blocked by repository-wide OpenSpec validation. In that run, candidate tests, TypeScript, isolated builds, and scoped OpenSpec validation passed, while unrelated repository validation reported 875 errors and 732 warnings.

The external audit covered 12 repositories and approximately 69 normalized OpenSpec changes spanning documentation, storefront UI, platform integration, backend services, security, data migrations, and legacy SDD conventions.

| Cross-project signal | Observed value |
|---|---:|
| External repositories with meaningful OpenSpec evidence | 12 |
| Normalized changes reviewed | Approximately 69 |
| Legacy records without current `state.yaml` and `events.yaml` | 37 |
| Events in the deduplicated `custom-shopify-app` histories | 427 |
| OpenSpec lines across 9 audited storefront changes | 22,902 |
| Verify and Review events across those storefront changes | 146 |

The audit found both strong quality outcomes and disproportionate process costs. Independent Review caught material security, data-integrity, API, cache, lifecycle, accessibility, and business-rule defects. At the same time, low-risk work could generate more process material than product work, repeated repairs invalidated too much evidence, late platform discovery transferred integration work to the user, and several useful outcomes never reached an honest terminal lifecycle state.

One documentation session produced 16,964 words of OpenSpec process before the requested 4,186-word deliverable. The direct delivery path produced the first usable draft in about five minutes. This is evidence for proportionality and outcome-first leadership, not a rule for any specific document type.

## Issue map

| ID | Priority | Problem | Effect | Primary layer |
|---|---|---|---|---|
| DTE-001 | P0 | Directory location is treated as lifecycle state | Terminal and stale records are considered active and affect new sessions | Registry/runtime |
| DTE-002 | P0 | Canonical incomplete or abandoned closure cannot be serialized | Failed or unwanted changes cannot end cleanly | Registry/runtime |
| DTE-003 | P0 | Planned path overlap is treated as exclusive ownership | Independent or governance work is blocked without a real write conflict | Prompt/governance |
| DTE-004 | P0 | Governance repairs must pass the broken governance they modify | Fixes enter recursive deadlocks | Prompt/runtime |
| DTE-005 | P0 | BROAD execution and candidate causality are conflated | Historical, global, environment, and harness failures become candidate blockers | QA/runtime |
| DTE-006 | P0 | QA failures force routine user pauses and renewed authorization | Automatic execution stops after the first failure | Prompt |
| DTE-007 | P0 | QA ordering has conflicting authorities | Prompts and convergence use Review before BROAD while the exported scheduler uses BROAD before Review | Runtime/prompt |
| DTE-008 | P1 | Archive choreography is internally inconsistent | Archive can require a report before creating it and may reference removed source paths | Prompt/runtime |
| DTE-009 | P1 | Registry intent chains are not atomic | Partial QA or lifecycle state may be persisted | Registry/runtime |
| DTE-010 | P1 | Explorer evidence can be required before Explorer runs | The first SDD phase can block itself | Prompt |
| DTE-011 | P1 | Verify and Review parallelism remains in a shared invariant | Stale instructions contradict current sequencing and freshness rules | Prompt |
| DTE-012 | P1 | Prompt tests verify strings rather than cross-layer semantics | Contradictory behaviors can each have passing tests | Test architecture |
| DTE-013 | P1 | Current prompt WIP risks a `qualityDisposition` dependency cycle | Review may require disposition while disposition requires Review | Prompt/runtime |
| DTE-014 | P1 | Global validation failures automatically expand repair scope | A focused change turns into repository cleanup | QA/orchestration |
| DTE-015 | P1 | Process depth is not justified against expected value | Coordination and artifact cost can exceed the uncertainty or risk being reduced | Triage/prompt |
| DTE-016 | P1 | The Orchestrator behaves as a gatekeeper more than a lead | The user coordinates the team and resolves internal process failures | Role design |
| DTE-017 | P2 | Multiple active changes are treated as exceptional | New sessions inherit unrelated historical state | Session model |
| DTE-018 | P2 | Non-success lifecycle outcomes are incomplete | Parking, supersession, abandonment, and incomplete closure are not operationally coherent | Registry/runtime |
| DTE-019 | P2 | Safe parallelism is underused or inconsistently defined | Latency grows without a corresponding quality benefit | Scheduling |
| DTE-020 | P2 | Effectiveness is not measured from the user's perspective | Phase and evidence success can hide failure to finish useful work | Telemetry/product |
| DTE-021 | P3 | Historical OpenSpec residue is not routinely reconciled | Duplicates, stale records, and incomplete moves accumulate | Repository hygiene |
| DTE-022 | P1 | Explicit approvals are not consumed durably and idempotently | Users repeat decisions or wait while an already-approved transition remains idle | Orchestration/registry |
| DTE-023 | P0 | Evidence invalidation is not impact-aware | Small or unrelated changes force complete and expensive QA restarts | QA/runtime |
| DTE-024 | P0 | Independent Review does not consistently converge findings | Partial finding batches create repeated Apply and QA cycles | Review/prompt |
| DTE-025 | P1 | Critical environment and platform contracts are validated too late | Large implementation batches complete before basic integration constraints are known | Triage/Apply |
| DTE-026 | P0 | Quality evidence is not always bound to an immutable candidate | Later source drift makes historical acceptance impossible to reconstruct | QA/registry |
| DTE-027 | P0 | Protected requirements can change during Apply without formal reconciliation | Tests and implementation may certify behavior that contradicts approved requirements | Spec/Apply |
| DTE-028 | P1 | Execution-mode handoffs do not preserve one authoritative outcome | Direct recovery can deliver the result while OpenSpec remains stale or contradictory | Orchestration/lifecycle |
| DTE-029 | P1 | Legacy OpenSpec histories lack honest discovery and registry genesis | Current tooling rejects or ignores useful historical evidence | Registry/migration |

## Current implementation evidence

The July 30 implementation is intentionally split between behavioral prompts,
deterministic runtime contracts, registry persistence, and production runner
reachability. No prompt statement by itself is considered sufficient evidence.

| Findings | Implemented boundary | Primary evidence |
|---|---|---|
| DTE-001, DTE-002, DTE-017, DTE-018, DTE-021, DTE-029 | Semantic active/parked/terminal selection, honest non-success closure, successor lifecycle intents, and observed-byte legacy genesis without fabricated events | `packages/core/src/spec-registry/lifecycle.ts`, `packages/sdd-runtime/src/contracts/session-change-selection.ts`, `registry-lifecycle-intent.ts`, `legacy-genesis.ts`, and lifecycle/validator tests |
| DTE-003, DTE-019 | Coordination is based on attributable modifying effects, stale bases, generated-output conflicts, and recovery state rather than directory or filename overlap | `packages/sdd-runtime/src/orchestrator/coordination-assessment.ts` and Orchestrator parallelism tests |
| DTE-004, DTE-006, DTE-014, DTE-015, DTE-016 | The Orchestrator chooses the smallest safe process, repairs routine governance and QA failures internally, keeps authorization bounded, and asks the user only for consequential decisions | `developer-team-leadership.ts`, `process-posture.ts`, `governance-recovery.ts`, and the canonical Orchestrator/Apply prompt surfaces |
| DTE-005, DTE-007, DTE-009, DTE-011, DTE-012, DTE-013, DTE-023, DTE-024, DTE-026, DTE-027 | One candidate-bound `targeted → affected_area → Review → broad` authority, causal BROAD disposition, atomic registry chains, impact invalidation, consolidated Review, and protected-requirement snapshots | QA authority/convergence contracts, quality readiness, verification-stage executor, execution control plane, registry coordinator, OpenCode/Pi reachability tests, and cross-layer authoritative matrices |
| DTE-008 | Archive consumes current accepted evidence and creates its report without circular pre-existence requirements | Archive prompt contract and `archive-content.test.ts` |
| DTE-010, DTE-025 | Explorer-first applies only after Run SDD is selected; critical assumptions receive candidate-bound preflight before large Apply work | INV-006, `qa-authority.ts`, and `developer-team-leadership.ts` |
| DTE-020 | Aggregate-only user-value telemetry covers time to useful/accepted results, interventions, repair cycles, verification reruns, honest closure, product/process work, and missed direct paths without retaining prompts or individual traces | `packages/sdd-runtime/src/execution/telemetry.ts` |
| DTE-022 | Explicit approval is immutable, candidate/transition-bound, consumed once, replay-idempotent, and persisted in registry provenance/events across handoffs | `approval-receipt.ts`, `registry-intent.ts`, registry serializer/validator, and approval persistence tests |
| DTE-028 | Direct, specialist, and SDD handoffs reconcile to one authoritative outcome; protected-requirement drift remains blocking | `authoritative-outcome.ts` and leadership handoff tests |

The user-facing acceptance scenarios are locked by behavioral tests rather than
phase-count assertions: direct small work, same-file disjoint work, unrelated
global warnings, bounded repair, selective invalidation, convergent Review,
parked/terminal selection, durable approval replay, authoritative mode handoff,
and concise continuous deltas all have executable coverage. The repository-wide
test suite, TypeScript check, generated runner assets, and binary dry-run are the
final integration checks for the exact candidate.

### Final candidate evidence

The integrated worktree candidate was exercised on 2026-07-30/31 with:

- the full repository test command, which completed successfully;
- the affected Developer Team, registry, SDD runtime, and adapter suite, with
  2,114 tests passed and zero failures;
- strict TypeScript validation with zero errors;
- the release dry-run, including the Linux x64 archive and checksums;
- regenerated OpenCode and Pi execution assets plus their production
  reachability tests;
- strict per-change OpenSpec validation for
  `streamline-orchestrator-ownership-and-acceptance`,
  `project-init-skill-registry-and-session-baseline`, and
  `causal-broad-qa-governance`, each with zero errors and zero warnings.

The repository-wide OpenSpec scan still reports 875 errors and 731 warnings
across 93 historical changes. Those findings are preserved as global legacy
debt: they were not repaired, hidden, or relabeled, and they do not invalidate
the current candidate's scoped checks, full code test suite, type check, or
build. The three partial formal histories in scope are closed as superseded by
this integrated outcome while preserving their original failed, incomplete, or
pre-QA evidence; no missing lifecycle events were invented.

## Improvement themes

### 1. Make every process step earn its cost

Use the leadership proportionality test before adding work. Process depth should follow uncertainty, risk, reversibility, and coordination value. The Orchestrator must be able to skip, combine, escalate, or downshift phases as evidence changes.

### 2. Make lifecycle semantic

Determine whether a change is active, parked, terminal, or malformed from authoritative state rather than directory location. Terminal changes must release inferred scope without deleting history.

### 3. Make coordination conflict-based

Allow multiple changes by default. Stop only for proven incompatible modifying effects, stale bases, unattributed dirty target bytes, protected generated-output conflicts, or registry recovery conflicts.

### 4. Restore Orchestrator leadership

The Orchestrator should choose the smallest process that preserves required quality. It should resolve routine coordination internally, delegate with judgment, and ask the user only for product decisions, meaningful tradeoffs, scope expansion, protected risk, or irreversible actions.

### 5. Make quality proportional, causal, and impact-aware

Run required checks, but evaluate whether findings are new, worsened, related, protected, historical, environmental, or caused by the harness. Unrelated global debt must not automatically become current-change repair scope. A modification should invalidate only evidence that depends on the changed behavior, files, environment, or authority.

### 6. Preserve bounded autonomy

Failure blocks unsafe advancement, not diagnosis. Existing authorization should permit bounded in-scope repair and fresh verification until scope, risk, or repair budgets change.

### 7. Make Review converge

Review should apply its complete relevant checklist before requesting repair and return one consolidated finding set for the frozen candidate. Later Review cycles should focus on repaired and invalidated areas without rediscovering unrelated issues one at a time.

### 8. Validate critical assumptions early

Before a large Apply batch, validate the environment, platform contracts, toolchain, dependency availability, and smallest representative integration path that could invalidate the plan. Preflight depth should remain proportional to the cost of discovering the constraint later.

### 9. Use safe parallelism

Start with independent checks inside one Verify stage and join all results before the stage verdict. Keep final Review independent. Broader cross-role parallelism should require explicit frozen-candidate and final-join semantics.

### 10. Preserve authority across handoffs

Changes in agent, mode, or execution strategy must preserve one authoritative outcome. A direct recovery path should reconcile the delivered result, decisions, and evidence rather than leaving competing OpenSpec and product histories.

### 11. Protect requirement authority

Implementation and repair work must not silently replace approved security, authorization, destructive-operation, data, public-interface, or other protected requirements. Material changes require explicit reconciliation and fresh judgment.

### 12. Support honest historical compatibility

Discover and classify legacy histories without fabricating events or treating missing modern metadata as proof of invalid work. Registry genesis and migration should preserve observed artifacts, confidence, source layout, and provenance.

### 13. Test the system as one control plane

Add parity scenarios across prompts, scheduler, convergence, registry, Review, BROAD, closure, and Archive. Avoid relying primarily on exact prompt strings or isolated unit expectations.

## Recommended priority

| Order | Outcome |
|---|---|
| 1 | The Orchestrator applies the proportionality test and can change process depth during execution |
| 2 | New sessions can start independently and terminal changes no longer hold scope |
| 3 | Changes can close incomplete or abandoned without claiming acceptance |
| 4 | Advisory overlap is separated from real write conflicts |
| 5 | Routine failure diagnosis and authorized repair no longer require repeated pauses |
| 6 | One runtime authority enforces QA order, candidate binding, and impact-aware freshness |
| 7 | Review converges findings and BROAD receives candidate-relative causal disposition |
| 8 | Early validation and safe parallelism reduce avoidable latency |
| 9 | Direct handoffs and legacy histories reconcile without competing authority |
| 10 | Historical residue is cleaned only after it stops blocking current work |

## Effectiveness metrics

Future audits should collect:

- Time from request to first useful artifact or implementation change.
- Number of user confirmations before first useful work.
- Number of phase launches, retries, and registry recovery loops.
- Number of times a user switches from Deck to Plan or Build agents to finish.
- Percentage of changes that reach a terminal lifecycle state.
- Percentage of BROAD failures attributable to the candidate.
- Number of findings that cause unplanned scope expansion.
- Accepted completion time by risk tier and task type.
- Ratio of product work to process-only artifact work.
- User interventions required to resolve internal team coordination.
- Estimated coordination cost versus the uncertainty, decision value, or risk reduced.
- Frequency with which a more direct path was available but not selected.
- Findings returned per Review cycle and percentage discovered only after prior repair loops.
- Evidence rerun because of actual dependency invalidation versus blanket freshness reset.
- Time spent waiting for approvals that had already been provided.

## Cross-project audit coverage

The July 2026 external audit covered:

- `giftcard-protocol`
- `custom-shopify-app`
- `chevignon-col`
- `unblended`
- `gco-commos-components`
- `custom-data-service`
- `ng_consulta_cedulas`
- `gentle-ai`
- `cyberpunk-plugin`
- `nafnaf-col`
- `esprit-projects/commons-components`
- `prueba-sdd`

The evidence confirms that the main opportunities are project-independent. Future audits should test whether the issue frequencies improve after changes to Orchestrator leadership, lifecycle, QA causality, evidence freshness, and compatibility. Project-specific incidents should remain evidence for general capabilities rather than becoming hardcoded workflow rules.
