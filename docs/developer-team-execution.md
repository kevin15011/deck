# Operating Developer Team Execution

Developer Team installs dedicated compact agent and skill bodies for all 14 catalog roles by default. Runtime effect controls still ship behind additive observe/shadow gates; missing rollout evidence keeps those automatic effects non-authoritative without reverting prompt content to legacy.

> **Audience:** Contributors and maintainers changing or operating Developer Team execution.
> **Authority:** explanatory methodology; active OpenSpec requirements and runtime source remain authoritative.
> **Evidence:** [runtime policy](../packages/sdd-runtime/src/execution/rollout-policy.ts), [safe telemetry](../packages/sdd-runtime/src/execution/telemetry.ts), [control plane](../packages/sdd-runtime/src/execution/execution-control-plane.ts), and [configuration](../packages/core/src/config/deck-config.ts).

## Safe path

1. Start with `executionContracts=observe`, `decisionKernel=shadow`, `routePolicy=legacy-triage`, `promptProfile=compact`, and `cohortPercent=0`.
2. Opt into `telemetry=local-safe` only when local evidence collection is intended. Keep telemetry off otherwise.
3. Aggregate comparable baseline and candidate observations by lane and risk tier.
4. Call `evaluateRolloutGateV1()` for exactly the next step: `0 -> 5 -> 25 -> 50 -> 100`.
5. Expand only when the decision is `eligible`. A `rollout-paused` result leaves the current cohort authoritative.
6. Install dedicated compact agent and skill bodies for all 14 roles in every OpenCode and Pi Developer Team installation. Legacy profile APIs and old receipts remain readable compatibility surfaces, not production selection gates.

## Runtime boundaries

| Boundary | Rule |
|---|---|
| Host input | OpenCode and Pi resolve execution context through trusted runner hooks. Agent-supplied context has no authority. Before activation, `static-compatible` removes untrusted context but preserves legacy delegation when no provider/evidence exists; after `invocation-required`, the same gap fails closed. |
| Dossier revisions | Revision 1 is standalone. Later revisions must carry the complete validated predecessor chain through host, composition, replay, role scheduling, and registry consumption. |
| Modification | A process-local, one-use authorization envelope must match invocation, role, batch, task artifact, action, target, and receipt. |
| Shadow | Legacy effects remain authoritative. Shadow computes the same V1 decision semantics but causes no V1 effects. |
| Registry | Centralized mode uses one pair-CAS writer with WAL recovery. It never dual-writes or rewrites prior history. |
| Verification | Targeted, affected-area, and broad stages advance only on bound evidence. Guarded and Full-SDD lanes retain broad and fresh-review floors. |
| Prompts | Compact content is the production default because runtime mapping, adapter, invariant, provider-filter, generator, and size gates have passed. Runtime cohort telemetry does not select installed prompt bytes. |
| Telemetry | Metrics are evidence, never execution authority. A write failure drops telemetry unless evidence is required to prove expansion. |

## Rollout gate

Expansion requires all mandatory evidence at once:

- At least 100 eligible candidate executions.
- At least 14 trailing consecutive observation days.
- At least seven days at each active step before the next expansion.
- Both OpenCode and Pi represented with semantic parity.
- Frozen baseline, readable legacy behavior, and additive history retention.
- 100% deterministic replay, batch continuity, broad-check compliance, and fresh-review compliance.
- Zero authorization bypass, registry loss/duplication, silent lane downgrade, adapter divergence, or routing-attributable escaped critical finding.
- No increase in escaped security or architecture findings.
- No median accepted-completion regression greater than 5% in any risk tier.

Efficiency remains visible but does not override safety. Reports include the Spec value target of at least 10% improvement in accepted-completion time or phase launches, plus the Design targets for completion time, launches, no-positive-delta cycles, registry conflicts, and local control-plane p95.

## Pause and rollback

A gate refusal returns `rollout-paused` for the requested expansion. Missing observation time or volume leaves an otherwise safe active cohort unchanged. A mandatory active safety stop disables affected automatic effects, moves the cohort back one step, and rolls the responsible control back one state where safe. Invocation authorization is never silently weakened after it becomes required.

Centralized registry writing remains paused in `centralized` mode until deterministic journal recovery is proven. Only then may the control return to `distributed-compatible`; this prevents a legacy writer from racing an unrecovered pair transaction.

Rollback preserves:

- Explicit Full-SDD escalation.
- Fresh independent review requirements.
- Git safety.
- Required invocation authorization.
- Dossier, telemetry, registry, and rollout history.
- Legacy readers and compatibility paths.

## Local telemetry

`local-safe` writes allowlisted JSONL to `.deck/runtime/execution-telemetry/v1.jsonl`. The sink rotates before exceeding 10 MiB, expires the active log and prunes rotated files at the configured retention bound of at most 30 days, and performs no network I/O. Serialization drops unknown fields and rejects invalid IDs, enums, counts, durations, or outcome values.

Allowed rollout observations contain only runner, phase, risk tier, lane, closed outcome enums, counts, durations, and an integer observation day. Raw prompts, credentials, authorization proofs, unrestricted diagnostics, finding text, and absolute user paths are not serialized.

## Prompt profile

`evaluateCompactPromptActivationV1()` remains available as compatibility evidence for the parity and size checks that preceded activation. Compact output retains the permanent safety, scope, Git, provider-filter, verification, and Review invariants while removing duplicated procedure.

OpenCode, Pi, their CLI launch paths, and the canonical content registry resolve to `compact` without a receipt. Missing, paused, or malformed historical receipts cannot downgrade an installation to `legacy`. Explicit legacy content remains available only as a compatibility surface for tests, readers, and deliberate rollback tooling.

## Acceptance evidence

| Scenario group | Executable evidence |
|---|---|
| Immutable batch, normalized findings, delta routing, terminal guard, deterministic replay | `packages/sdd-runtime/src/contracts/execution-v1-contracts.test.ts`, `packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts`, `packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts` |
| Least privilege, invalid authorization, tamper, replay, and zero-effect rejection | `packages/sdd-runtime/src/execution/invocation-authorization-service.test.ts`, both adapters' `developer-team-execution-bridge.test.ts` |
| Registry replay, conflict, all partial-write boundaries, and legacy history | `packages/sdd-runtime/src/artifact-state/registry-coordinator.test.ts` |
| Staged verification, bounded omission, causal context, and fresh judgment | `packages/sdd-runtime/src/orchestrator/staged-verification.test.ts`, `packages/sdd-runtime/src/orchestrator/freshness-policy.test.ts`, `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts` |
| Lane floors and escalation | `packages/sdd-runtime/src/orchestrator/execution-lane-router.test.ts` |
| Shadow, activation windows, pause, rollback, and telemetry redaction | `packages/sdd-runtime/src/execution/rollout-policy.test.ts`, `packages/sdd-runtime/src/execution/telemetry.test.ts` |
| Compact prompt parity and generated-source discipline | `packages/core/src/teams/developer/prompt-profile.test.ts`, adapter install/profile tests, generator idempotency tests |
| Anchored Review and excluded scope | `packages/core/src/teams/developer/review-content.test.ts`, host-boundary and core-purity tests |
| Integrated bridge-to-registry flow | `packages/sdd-runtime/src/execution/developer-team-convergence.e2e.test.ts` and both adapters' `developer-team-execution-bridge.test.ts` |

The shared integrated fixture runs through both adapter bridges, a real control plane, and a temporary registry pair without network access, real runner installation, or user-filesystem writes. Adapter reachability tests separately load each generated runner-native bundle and prove trusted-hook invocation.

## Release interpretation

Compact prompts ship in the production build even while automatic runtime-effect rollout remains paused. A release gate proves code, tests, generated drift, and legacy readability; it does not manufacture runtime observation evidence. Do not claim active runtime cohort expansion until a real observation window passes `evaluateRolloutGateV1()`.
