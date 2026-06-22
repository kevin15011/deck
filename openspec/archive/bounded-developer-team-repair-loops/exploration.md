# Exploration: Bounded Developer Team Repair Loops

## Background and Problem Statement

The prior release-gate repair effort exposed a slow Developer Team Apply → Verify → repair loop. The read-only audit context reported one loop lasting about 4.6 hours, with roughly five Verify-style sessions and twelve Apply/repair sessions, associated with `openspec/changes/fix-release-gate-general-apply-failures/` and OpenCode session `ses_1282a7132ffegsibiDM8Vn1MAD`.

The problem is not a single failing test. It is an SDD workflow control issue: repeated repair attempts can continue without a clear budget, without a structured failure manifest, without staged verification boundaries, and without a durable repair incident record that explains when to continue, replan, escalate, or stop.

The desired change should improve runner-agnostic Deck behavior for Developer Team repair loops while preserving OpenSpec as the official authority and avoiding runner-specific assumptions.

## Evidence from the Prior Loop

- `openspec/changes/fix-release-gate-general-apply-failures/state.yaml` records multiple Apply provenance entries on 2026-06-21, all updating the same `apply-progress.md` artifact.
- `openspec/changes/fix-release-gate-general-apply-failures/events.yaml` records four Apply completion events for the same change and artifact, including repeated release-gate blocker repairs.
- `openspec/changes/fix-release-gate-general-apply-failures/apply-progress.md` lists several independent blocker classes: project-root fallback behavior, stale generated build target, initialized-state expectation drift, purity audit allowlist drift, TUI/dashboard Supermemory action flow failures, stale internal package count, expired quality-router override date, and remaining provider-resolution failures.
- The Apply progress artifact shows a broad verification matrix rather than a staged failure manifest. It records pass/fail evidence, but it does not provide a canonical machine-readable queue of failure fingerprints, owner routing, retry counts, or stop/escalation criteria.
- The prior repair work included a generated host-specific artifact issue: `apps/cli/src/runtime/build-info.generated.ts` had a stale `darwin-arm64` target committed and then corrected to `linux-x64`. This demonstrates that generated artifacts need explicit policy in repair loops.
- Some remaining failures were classified as pre-existing in prose, but there is no clear repair incident workflow tying that classification to loop budgets, Verify staging, and next action.

## Current Deck Surfaces Likely Affected

- `packages/core/src/teams/developer/orchestrator-content.ts` — primary Developer Team orchestration instructions. It already requires Explorer-first evidence, artifact and registry checks, Apply preconditions, and phase advancement verification. It is the likely home for runner-agnostic loop handoff rules and repair incident workflow language.
- `packages/adapter-opencode/src/command-generation.ts` — OpenCode command generation for SDD phases. It gates `sdd-apply` and `sdd-verify`, but currently delegates generic phase tasks rather than a bounded repair-loop protocol. Any command wording changes must remain adapter-local and consistent with core instructions.
- `packages/sdd-runtime/src/orchestrator/loop-breaker.ts` — existing runtime primitive for repeated failure detection. It has fingerprint fields and thresholds for continue/repair/replan/escalate, but the current SDD artifacts do not appear to feed a structured failure history into it.
- `packages/sdd-runtime/src/orchestrator/budget-watchdog.ts` — existing runtime primitive for soft and hard budget checks across tokens, turns, time, and tool calls. It is generic, but not visibly integrated into Developer Team repair-loop phase contracts.
- `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` — existing state-update boundary with CAS/idempotency/event-lock expectations. It is relevant if repair incidents or manifests become structured OpenSpec artifacts that need safe updates.
- `openspec/registry-schema.md` and `docs/prompt-methodology-modules.md` — official registry and methodology references. They define required artifact/registry behavior and registry-deferred mode; any new repair-loop artifact or event convention should align with these documents.

## Candidate Approaches

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| Prompt-only bounded repair protocol | Update Developer Team instructions/skills to require retry budgets, failure manifest sections, staged Verify, and escalation criteria in Apply/Verify handoffs. | Fastest; runner-agnostic; can improve behavior without new runtime APIs. | Harder to enforce; risks drift if agents omit sections; telemetry remains mostly prose. | Medium |
| Structured OpenSpec repair incident artifact | Introduce a `repair-incident.md` or equivalent artifact convention with failure fingerprints, budgets, staged checks, owner routing, attempts, stop conditions, and generated-artifact decisions. | Durable, auditable, runner-agnostic; improves Apply/Verify handoff quality; compatible with OpenSpec authority. | Requires schema/contract decisions; more phase complexity; must avoid over-bureaucracy for small repairs. | Medium-High |
| Runtime-backed repair loop enforcement | Wire existing `loop-breaker` and `budget-watchdog` concepts into orchestration/runtime contracts and require manifests that can be checked by code/tests. | Strongest enforcement; uses existing primitives; enables telemetry and deterministic stop/replan behavior. | Higher implementation effort; may require adapters, tests, and migration of phase contracts; risks coupling if not designed carefully. | High |
| Minimal Verify staging only | Require Verify to run targeted checks first, then broader gates only after targeted pass, with explicit residual-failure classification. | Directly attacks long verify cycles; relatively easy to explain. | Does not solve repeated Apply attempts, budget exhaustion, or incident telemetry alone. | Low-Medium |

## Risks and Non-Goals

### Risks

- Over-constraining repair loops could stop productive fixes too early unless budgets include explicit override/escalation paths.
- A new artifact can become paperwork if it is not tied to phase gates and return contracts.
- Runner-specific session telemetry must not leak into core behavior. The change should define runner-agnostic semantics and let adapters supply optional evidence.
- Generated-artifact policy must distinguish legitimate checked-in generated sources from host-specific or stale generated outputs.
- If Verify staging is too narrow, it may miss cross-cutting regressions; if too broad, it recreates the slow loop.

### Non-Goals

- Do not fix the historical release-gate failures again.
- Do not create runner-specific OpenCode-only behavior in core Developer Team rules.
- Do not replace the OpenSpec registry with adaptive memory or external telemetry.
- Do not create Proposal, Spec, Design, Tasks, Apply, Verify, Review, or Archive artifacts during this Explorer phase.
- Do not change product code in this phase.

## Recommended Change Scope

The Proposal should define a bounded repair-loop capability with three layers:

1. **Repair loop budgets** — per incident and per failure fingerprint budgets for attempts, elapsed time, and verification cycles; soft checkpoint and hard stop behavior should map to continue, repair, replan, escalate, or blocked.
2. **Structured failure manifest** — a required repair handoff format that records normalized failure fingerprints, owner/routing, evidence command, failing contract, changed files, generated-artifact involvement, prior attempts, and next check.
3. **Staged verification protocol** — targeted check first, affected-area check second, broad release gate last; each stage should record evidence and residual-failure classification.
4. **Repair incident workflow and telemetry** — an OpenSpec-backed incident artifact or registry-compatible event convention that captures when a loop starts, retries, escalates, replans, or stops.
5. **Generated-artifact policy** — explicit classification and handling rules for generated files during repair loops, including host-specific generated outputs and regeneration evidence.
6. **Apply/Verify handoff contract** — Verify should return a structured failure manifest; Apply should consume it and update attempts instead of starting from prose-only summaries.

## Open Questions for Proposal

- Should the repair incident be a new OpenSpec artifact (`repair-incident.md` or `repair-manifest.md`), an extension of `apply-progress.md`/`verify-report.md`, or both?
- What default budgets are appropriate for interactive mode versus automatic mode?
- Which fields must be machine-readable now, and which can remain markdown until runtime enforcement is implemented?
- Should failure fingerprints align exactly with `FailureFingerprint` in `packages/sdd-runtime/src/orchestrator/loop-breaker.ts`, or should Proposal define a higher-level OpenSpec schema first?
- How should generated artifacts be classified when they are intentionally committed but environment-sensitive?
- What telemetry is mandatory in core artifacts versus optional runner adapter metadata?

## Actionable Diagnosis

Yes. The prior loop shows insufficient bounded repair-loop controls and prose-heavy Apply/Verify handoffs. The next phase should propose a runner-agnostic repair incident protocol that combines budgets, failure manifests, staged verification, generated-artifact policy, and escalation behavior.
