# Operating Developer Team Execution

Developer Team installs seven adaptive roles plus the standalone Onboard and Archive skills. Runtime effect controls remain authoritative for protected writes, while Lead chooses the smallest safe route and activates Quality only for material or protected risk, uncertain evidence, release readiness, or explicit request.

> **Audience:** Contributors and maintainers changing or operating Developer Team execution.
> **Authority:** explanatory methodology; active OpenSpec requirements and runtime source remain authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runtime policy](../packages/sdd-runtime/src/execution/rollout-policy.ts), [safe telemetry](../packages/sdd-runtime/src/execution/telemetry.ts), [control plane](../packages/sdd-runtime/src/execution/execution-control-plane.ts), and [configuration](../packages/core/src/config/deck-config.ts).

## Safe path

1. Start with `executionContracts=observe`, `decisionKernel=shadow`, `routePolicy=legacy-triage`, `promptProfile=compact`, and `cohortPercent=0`.
2. Opt into `telemetry=local-safe` only when local evidence collection is intended. Keep telemetry off otherwise.
3. Aggregate comparable baseline and candidate observations by lane and risk tier.
4. Call `evaluateRolloutGateV1()` for exactly the next step: `0 -> 5 -> 25 -> 50 -> 100`.
5. Expand only when the decision is `eligible`. A `rollout-paused` result leaves the current cohort authoritative.
6. Install exactly seven agent/skill pairs plus Onboard and Archive lifecycle skills in every OpenCode, Pi, and Codex installation. Legacy IDs remain readable migration/history surfaces, never active aliases.

## Runtime boundaries

### Codex route classification

Codex interactive, exec, resume-by-ID, and resume-latest routes are all classified `static-compatible`:

| Classification | Meaning |
|---|---|
| `static-compatible` | Native roles, skills, instructions, and launch are available, but host-enforced execution controls are not proven for that route. |

Deck never changes Codex trust, sandbox, approval, provider, profile, or telemetry security settings. The public Codex adapter installs no hook asset/config and exposes no callback-based first-class promotion API.

Codex MCP configuration supports verified stdio and streamable HTTP entries. Context7 credentials remain environment references only. Supermemory uses credential-free project configuration: after Deck successfully applies and verifies its MCP entry, the user may run `codex mcp login supermemory` when ready. Deck never executes that command, opens a browser, captures a token, or stores OAuth credentials. Secret values do not enter project TOML, previews, diagnostics, or reports. Engram remains an explicit gap.

| Boundary | Rule |
|---|---|
| Host input | OpenCode and Pi resolve execution context through trusted runner hooks. Codex remains static-compatible and does not claim host-enforced execution authority. Agent-supplied context has no authority. |
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
- Every activated runner cohort represented with semantic parity; Codex routes count only when their trusted-hook binding is verified.
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
| Least privilege, invalid authorization, tamper, replay, and zero-effect rejection | `packages/sdd-runtime/src/execution/invocation-authorization-service.test.ts` and each active adapter's `developer-team-execution-bridge.test.ts` |
| Registry replay, conflict, all partial-write boundaries, and legacy history | `packages/sdd-runtime/src/artifact-state/registry-coordinator.test.ts` |
| Staged verification, bounded omission, causal context, and fresh judgment | `packages/sdd-runtime/src/orchestrator/staged-verification.test.ts`, `packages/sdd-runtime/src/orchestrator/freshness-policy.test.ts`, `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts` |
| Lane floors and escalation | `packages/sdd-runtime/src/orchestrator/execution-lane-router.test.ts` |
| Shadow, activation windows, pause, rollback, and telemetry redaction | `packages/sdd-runtime/src/execution/rollout-policy.test.ts`, `packages/sdd-runtime/src/execution/telemetry.test.ts` |
| Compact prompt parity and generated-source discipline | `packages/core/src/teams/developer/prompt-profile.test.ts`, adapter install/profile tests, generator idempotency tests |
| Anchored Review and excluded scope | `packages/core/src/teams/developer/review-content.test.ts`, host-boundary and core-purity tests |
| Integrated bridge-to-registry flow | `packages/sdd-runtime/src/execution/developer-team-convergence.e2e.test.ts` and both adapters' `developer-team-execution-bridge.test.ts` |

The shared integrated fixture runs through the active OpenCode and Pi adapter bridges, a real control plane, and a temporary registry pair without network access, real runner installation, or user-filesystem writes. Codex bridge fixtures are internal research tests and are not public production reachability evidence.

## Release interpretation

Compact prompts ship in the production build even while automatic runtime-effect rollout remains paused. A release gate proves code, tests, generated drift, and legacy readability; it does not manufacture runtime observation evidence. Do not claim active runtime cohort expansion until a real observation window passes `evaluateRolloutGateV1()`.
