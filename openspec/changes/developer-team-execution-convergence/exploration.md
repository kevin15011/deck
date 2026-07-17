# Exploration: Developer Team Execution Convergence

## Outcome

Deck has most low-level ingredients needed for a faster, convergent Developer Team, but they are split between prompt guidance and additive runtime helpers that are not connected to a production execution path. The smallest coherent solution is an incremental control-plane architecture in `packages/sdd-runtime`: immutable execution contracts, normalized findings, a deterministic delta-based decision kernel, and one registry writer. Adapters should supply invocation context and execute decisions; prompts should explain intent but must not own safety or state transitions.

This is an actionable diagnosis and is ready for Proposal. It does not require a big-bang rewrite, and it must not touch or resume `runner-capability-standardization` at commit `8c6d167`.

## Goal and Scope

Investigate the complete improvement program required to make Developer Team execution materially faster, more assertive, and more convergent while retaining:

- OpenSpec authority and backward-compatible registry history;
- explicit modification authorization and destructive Git protection;
- independent Verify and Review, including security and architecture review;
- staged verification and fresh final review after an incident;
- bounded budgets as a final safety net rather than the primary convergence mechanism.

The official case study is evidence only. Its active files, branch, commit, and registry history are outside this change's modification scope.

## Verified Current State

### 1. Apply batching is prose, not an executable shared contract

`packages/core/src/teams/developer/orchestrator-content.ts` instructs the Orchestrator to group related tasks, preserve dependency order, and fan out only independent work. No `ApplyBatchContract` type, validator, immutable identifier, or shared Apply/Verify/Review consumption API exists in current main. Consequently, downstream agents reconstruct scope from prose and artifacts rather than verifying the exact authorized batch.

The execution contract should be runtime-enforced. Prompt text should only explain why the contract exists and how agents report against it.

### 2. Failure data exists, but Verify and Review do not share one normalized manifest

`packages/sdd-runtime/src/contracts/repair-incident.ts` defines `RepairIncident`, `RepairFailureEntry`, evidence, attempts, fingerprints, lifecycle, budgets, and staged-verification fields. This is useful prior art, but it is incident-oriented and does not establish one stable, phase-neutral failure manifest emitted by both Verify and Review.

The archived `bounded-developer-team-repair-loops` change explicitly required a structured failure manifest, staged verification, retry history, generated-artifact classification, and optional repair telemetry. Compatibility lessons are strong: keep new artifacts optional, create incidents lazily, tolerate legacy changes, and never make runner-local logs authoritative.

### 3. Repair governance is implemented but disconnected from production orchestration

`evaluateRepairIncident()` in `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts` returns `continue`, `repair`, `checkpoint`, `replan`, `escalate`, or `block`. Graph and Serena reference analysis found only test callers in `repair-loop-governance.test.ts`; it is not exported from `packages/sdd-runtime/src/index.ts` and has no production caller.

The helper prioritizes incident/runtime budgets, per-fingerprint attempt limits, and repeated fingerprints. It does not compare previous and current normalized failure sets, identify resolved/new/persistent failures, or select a root-cause action from that delta. This confirms that current governance limits loops but does not itself drive convergence.

### 4. A runtime orchestration foundation exists, but the user-facing workflow remains prompt-led

`packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` composes audit validation, risk scoring, quality routing, loop breaking, and outcome generation. `risk-scorer.ts` and `quality-router.ts` already provide configurable scoring and check selection. These are the best extension points for lane selection and deterministic execution decisions.

However, production Developer Team phase sequencing, batching, registry reconciliation, and repair response remain primarily encoded in `orchestrator-content.ts` and specialist role content. The current architecture therefore has two control planes: executable helpers and procedural prompt instructions.

### 5. Apply authorization is optional prompt-generation input, not invocation-scoped authority

`ModificationAuthorization` and `renderApplyAuthorizationCard()` live in `packages/core/src/teams/developer/orchestrator-invariants.ts`. `composeApplyAgentPrompt()` prepends a delegation gate and marker-based card. OpenCode's `buildPromptGenerationPlan()` accepts optional `authorization` and writes it into generated apply-agent prompt content. Tests explicitly verify that absent authorization leaves only a static placeholder and that supplied authorization appears in the generated prompt.

This is a prompt installation/generation boundary, not a per-delegation capability. `composeApplyAgentPromptWithAuth()` has no callers. Pi builds team system prompts and installs static team content but has no equivalent verified invocation-scoped authorization path. The source itself documents the architectural limitation: core content is assembled at build/load time and full enforcement requires an adapter runtime composition path.

Required correction: issue a short-lived, invocation-scoped authorization envelope bound to change ID, batch ID, role, allowed/blocked targets, task artifact digest, and user authorization provenance. Validate it immediately before a modifying tool-capable invocation. Do not persist raw authorization or secrets in diagnostics.

### 6. Prompt composition duplicates role and mandatory skill material

`packages/core/src/teams/developer/content-registry.ts` composes role bodies, invariants, language policy, context authority, and capability instruction bundles. OpenCode `buildPromptContent()` then prepends a mandatory skill-loading gate, appends provider instructions, and appends a skill reference. The loaded skill repeats substantial role, safety, package, memory, and workflow material.

Measured source sizes confirm the cost surface: role-content sources are roughly 11–20 KB for most specialists and 52.8 KB for the Orchestrator; installed Developer Team skill files are substantially larger (for example Apply role skills are about 28–30 KB). This supports the retrospective's estimated 12.7k–18.8k static-token burden before task context, even though exact token count varies by provider tokenizer and enabled bundles.

Generated-source constraint: never hand-edit `packages/core/src/skills/external/content.generated.ts`. Change canonical role/skill fragments or the generator, then regenerate and verify deterministic output.

### 7. Freshness is broad prompt policy rather than a causal-context policy

Current Orchestrator content requires fresh-context review before commits/PRs and fresh reviewers after implementation, conflict resolution, or incidents. No typed freshness policy or context-retention envelope was found. A blanket fresh-agent approach can erase prior failure causality and force expensive rediscovery.

Recommended policy: preserve the same execution dossier across Apply and targeted repair; require independence for Verify and Review; require a fresh final Review after a security/architecture incident or material repair; refresh only when role independence, context contamination, or risk justifies it.

### 8. Registry mutation remains distributed despite available state primitives

Each phase skill is instructed to write `state.yaml` and `events.yaml`, with `registry-deferred` exceptions for parallel phases and later Orchestrator reconciliation. Historical artifacts show drift and extensive reconciliation notes.

`packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` provides CAS, idempotency, capability validation, and conflict guidance, but Serena found only test/scenario callers. `packages/core/src/spec-registry/events.ts` creates typed events but likewise has only test callers. Current official registry files are still directly written YAML artifacts.

The runtime should become the sole registry mutation authority. Specialists return immutable phase results and registry intents; one coordinator validates and serializes state plus event updates atomically/idempotently. Existing YAML schemas and legacy files remain readable.

### 9. Risk routing foundations exist, but named execution lanes do not

Current triage is prompt-defined as Direct, Specialist(s), Recommend SDD, or Run SDD. `computeRiskScore()` and `routeQuality()` provide executable risk/quality primitives but do not select Fast Lane, Guarded Lane, or Full SDD.

Lane selection should be deterministic and explainable:

- **Fast Lane**: bounded low-risk work with explicit acceptance; one coherent Apply batch; focused checks; independent lightweight Verify; Review only where policy/risk requires, while never bypassing security controls.
- **Guarded Lane**: medium-risk or multi-file work; concise requirements/acceptance contract; staged Verify; independent Review; no unnecessary phase-agent churn.
- **Full SDD**: high-risk, cross-cutting, security-sensitive, architecture/migration/public-API work; full OpenSpec phases and independent Verify/Review.

User choice or project policy may raise the lane. Automatic routing must never silently lower explicit Full SDD or mandatory security/architecture gates.

## Relevant Runtime Boundaries and Public APIs

| Surface | Current role | Compatibility requirement |
|---|---|---|
| `packages/sdd-runtime/src/index.ts` | Public barrel for contracts and orchestration helpers | Add exports; do not remove or reinterpret existing exports. Note that repair governance is currently not exported. |
| `contracts/repair-incident.ts` | Additive `repair-incident-v1` parser/types | Preserve parser behavior and optional incident semantics; adapt rather than replace abruptly. |
| `orchestrator/repair-loop-governance.ts` | Budget/fingerprint governance | Preserve current decisions for legacy callers/tests; compose behind a new kernel or add a versioned evaluator. |
| `orchestrator/orchestrator-pipeline.ts` | Executable audit/risk/quality/loop pipeline | Extend additively with optional execution dossier and lane/decision stages. |
| `risk-scorer.ts`, `quality-router.ts` | Existing risk tiers/check routing | Reuse; version lane thresholds and record evidence. |
| `artifact-state/artifact-state-manager.ts` | CAS/idempotent state adapter boundary | Supply a production YAML registry adapter; preserve adapter interface and conflict semantics. |
| `packages/core/src/spec-registry/*` | YAML types, event helpers, validator, paths | Maintain `spec-registry-v1` and legacy compatibility; new fields/event names should be optional first. |
| `orchestrator-invariants.ts` | Safety and authorization rendering | Keep user authorization and Git safety; move authoritative validation into runtime while retaining prompt defense-in-depth. |
| OpenCode prompt generation | Installs static prompt files | Stop treating installed authorization as authority; add invocation bridge without breaking installation APIs. |
| Pi team profile/install | Static system prompt/team installation | Add the same invocation contract through a runner-neutral core port; avoid adapter-specific semantics in core. |

## Smallest Coherent Architecture

Introduce one versioned `ExecutionDossier` aggregate in `packages/sdd-runtime`, assembled from additive contracts:

1. **`ApplyBatchContractV1`**: immutable batch ID; change ID; task IDs; owner; ordered dependencies; allowed/blocked targets; acceptance obligations; verification plan; artifact digests; authorization reference; creation provenance.
2. **`FailureManifestV1`**: normalized findings from Verify and Review with stable ID/fingerprint, source phase, severity, category, requirement/task/batch references, evidence, affected targets, security flag, status, and safe remediation hint.
3. **`FailureDeltaV1`**: resolved, new, persistent, regressed, and reclassified sets plus severity/risk movement.
4. **`ExecutionDecisionV1`**: selected action, root-cause class, target batch, required verification stage, freshness requirement, lane, rationale codes, budget state, and registry intents.
5. **`InvocationAuthorizationV1`**: short-lived signed/digested envelope scoped to one Apply invocation; no raw credentials or unrestricted user prose.
6. **`RegistryIntentV1`**: validated mutation request consumed only by a single runtime registry coordinator.

The deterministic decision kernel consumes the dossier and produces an action. Budget/fingerprint governance remains a terminal guard. It must not infer success from a reduced count alone: criticality, security classification, requirement coverage, and regression status dominate raw count.

### Runtime-enforced versus prompt guidance

| Runtime-enforced | Prompt guidance |
|---|---|
| Contract parsing/versioning/digests | Why batches should be coherent |
| Batch target/task/acceptance validation | How to summarize progress clearly |
| Invocation authorization and expiry | Reminder to avoid unrelated edits |
| Finding normalization and safe redaction | Review heuristics and domain prompts |
| Failure-set delta and deterministic decision | Explanation of decision rationale |
| Lane floor and mandatory gates | Suggested workflow ergonomics |
| Registry single-writer/CAS/idempotency | Artifact writing format guidance |
| Staged verification transition rules | Recommended focused commands |
| Security/Git hard stops and final budget stop | Human-readable warnings |
| Freshness/independence policy | Context handoff summary style |

## Recommended Vertical Slices and Ordering

### Slice 0 — Contract fixtures and compatibility harness

- Add versioned fixtures for legacy/no-contract, normal pass, Verify failure, Review failure, security incident, shrinking failure set, expanding failure set, and unchanged fingerprint.
- Lock existing `RepairIncident`, registry, prompt-generation, and pipeline behavior before modification.
- Establish telemetry vocabulary and redaction tests.

This is the TDD foundation and should land first.

### Slice 1 — Batch contract plus unified failure manifest

- Add parsers/validators and stable canonicalization in `packages/sdd-runtime/src/contracts/`.
- Adapt existing repair failures into the unified manifest.
- Teach Apply result, Verify, and Review return contracts to reference the same batch and manifest versions.
- Initially observe/report contract violations; enforce after adapter coverage is proven.

### Slice 2 — Failure delta and decision kernel wired into the existing pipeline

- Add pure `computeFailureDelta()` and `decideNextExecutionAction()` functions.
- Compose existing `evaluateRepairIncident()` as terminal budget/fingerprint policy.
- Wire the kernel into `runOrchestratorPipeline()` or a versioned successor; add a production caller rather than another standalone helper.
- Emit rationale codes and safe telemetry.

### Slice 3 — Invocation-scoped authorization

- Add a runner-neutral authorization contract and validator in runtime/core.
- OpenCode and Pi adapters construct the invocation payload immediately before Apply delegation.
- Keep static authorization-card rendering only as defense-in-depth and compatibility output.
- Default-deny modifying invocation when the envelope is absent, expired, mismatched, or broader than the batch.

### Slice 4 — Central registry coordinator

- Implement a filesystem/YAML `ArtifactStoreAdapter` or a narrower registry adapter using existing parser/validator/path utilities.
- Specialists return `RegistryIntentV1`; only the coordinator writes state/events.
- Preserve existing `state.yaml`/`events.yaml`; add optional schema fields/events warning-first.
- Eliminate routine `registry-deferred` specialist exceptions after rollout, while still accepting historical records.

### Slice 5 — Staged verification and freshness policy

- Encode targeted → affected-area → broad gates and explicit skip/deferral reasons.
- Preserve independent Verify/Review.
- Retain causal dossier for repair Apply; require fresh final Review after incidents and high-risk changes.
- Never accept generated-file drift without canonical regeneration evidence.

### Slice 6 — Risk-based route selection

- Extend existing scorer/router with Fast, Guarded, and Full SDD outputs, lane floors, and policy override evidence.
- Pilot in shadow mode, compare recommendation against current triage, then enable Automatic routing.
- Explicit Full SDD requests remain Full SDD.

### Slice 7 — Prompt de-duplication and rollout completion

- Make canonical invariant fragments single-source and reference concise skills instead of duplicating full policies in role prompts.
- Keep the mandatory skill-loading gate but reduce role prompt to identity, invocation contract, task context, and non-negotiable safety summary.
- Generate, do not hand-edit, derived skill content; add parity and prompt-size regression tests.

This ordering avoids a risky rewrite: contracts and pure decisions land before adapter enforcement; registry and authorization migrate behind compatibility bridges; prompt compression happens last after runtime guarantees exist.

## Feature Flags, Migration, and Rollback

Use additive, versioned configuration with safe defaults:

- `executionContracts`: `off | observe | enforce` (start `observe`);
- `decisionKernel`: `legacy | shadow | active` (start `shadow`);
- `invocationAuthorization`: `static-compatible | invocation-required` (enable per adapter after conformance);
- `registryWriter`: `distributed-compatible | centralized` (dual-read, single-write; never dual-write);
- `routePolicy`: `legacy-triage | shadow-risk-lanes | risk-lanes`;
- `promptProfile`: `legacy | compact`.

Existing changes without new contracts continue through legacy adapters. Existing `repair-incident.md`, registry artifacts, and event history remain valid. New schema keys and event types should be optional/warning-first until all shipped adapters consume them.

Rollback is flag-based per slice: return decision and routing to legacy behavior, revert adapter invocation enforcement, or select legacy prompts while leaving additive artifacts readable. Never delete new registry history during rollback. Security hard stops, explicit authorization, Git protection, and OpenSpec authority are not flaggable off.

## Telemetry and Success Metrics

Telemetry must contain IDs, enums, counts, durations, hashes, and redacted paths only; never raw prompts, credentials, secret-bearing findings, or unrestricted diagnostic context.

Measure before and after by lane and risk tier:

- time to first valid Apply batch and time to accepted completion;
- phase/agent launches, total turns, prompt bytes/tokens, and tool calls;
- number of Apply attempts, Verify cycles, Review cycles, replans, and registry reconciliations;
- failure-set convergence: resolved/new/persistent/regressed counts and weighted severity delta per cycle;
- repeated-fingerprint rate and cycles with no positive delta;
- authorization self-rejection/mismatch rate;
- registry conflict/drift/reconciliation rate;
- focused/affected/broad verification duration and pass rates;
- escaped security/architecture findings, post-archive regressions, and rollback count;
- lane recommendation overrides and false-fast-lane incidents.

Primary success is not fewer loops alone. It is faster reduction of weighted unresolved requirements with no increase in escaped critical findings.

## Test Strategy

Strict TDD applies.

1. **Contract tests**: version parsing, canonical hashing, immutability, unknown-version rejection, legacy adaptation, deterministic fingerprints, redaction.
2. **Kernel table tests**: all failure deltas, severity transitions, security dominance, no-progress replan, progress continuation, budget hard stop, and deterministic replay.
3. **Pipeline integration**: one dossier flows Apply → Verify → Review → repair → final Review with stable IDs and decisions.
4. **Authorization tests**: scope, expiry, change/batch mismatch, adapter parity, no static-card authority, absent-envelope refusal, safe diagnostics.
5. **Registry tests**: CAS conflict, idempotent replay, state/event atomicity, legacy schema, warning-first fields, crash/retry recovery, exactly one writer.
6. **Lane tests**: boundary tables, explicit Full SDD floor, security/public-API/migration floors, project-policy escalation, shadow/active parity.
7. **Prompt tests**: invariant parity, mandatory safety retention, generated-source regeneration, provider filtering, size budgets, no duplicated full sections.
8. **End-to-end fixtures**: runner-neutral mocked invocations for OpenCode and Pi; no network, no real installs, no user filesystem writes beyond isolated fixtures.

Current coverage is mostly unit-level: repair governance, artifact-state CAS, scenarios, invariants, content composition, and OpenCode prompt generation. Missing coverage is precisely the production wiring across decision kernel, invocation authorization, registry coordinator, and adapter invocation.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| New control plane duplicates current prompt workflow | Make runtime decisions authoritative and progressively delete only redundant prompt procedure after parity tests. |
| Contract/schema rollout breaks active or archived changes | Version contracts; dual-read legacy/new; optional registry additions; fixture historical artifacts. |
| Fast Lane weakens quality | Lane floors, explicit acceptance, independent Verify, security/architecture escalation, measured shadow rollout. |
| Central writer becomes a bottleneck | Small append/merge intents, idempotency, CAS, batched event commit; correctness before optimization. |
| Authorization envelope becomes replayable or leaks detail | Short expiry, nonce/idempotency key, digest binding, least scope, redacted telemetry, no raw secret material. |
| Finding fingerprints hide semantic changes | Include requirement/category/location identity and explicit reclassification; compare safe structured fields, not message text alone. |
| Prompt compression removes safety | Runtime enforcement first; golden invariant tests; compact safety summary retained in every modifying role. |
| Freshness policy compromises independence | Separate causal-context retention from role independence; final Review remains fresh after incidents. |
| Generated output drift | Modify canonical generators only; deterministic generation and clean-tree assertions. |

## Options and Tradeoffs

1. **Prompt-only optimization**
   - Pros: low implementation effort; immediate token reduction.
   - Cons: cannot guarantee authorization, convergence, registry consistency, or deterministic routing; repeats the current failure mode.
   - Effort: Low.

2. **Big-bang workflow engine replacement**
   - Pros: clean conceptual model.
   - Cons: high migration and regression risk; invalidates useful existing contracts, adapters, and OpenSpec compatibility.
   - Effort: Very high.

3. **Incremental runtime control plane with compatibility bridges — recommended**
   - Pros: reuses current risk, quality, repair, state, registry, and adapter foundations; enables measurable vertical delivery and rollback.
   - Cons: temporary legacy/new coexistence and feature-flag complexity.
   - Effort: High overall, Medium per slice.

## Decisions and Defaults for Proposal/Spec/Design

No unresolved question blocks Proposal. Use these compatibility-preserving defaults unless maintainers override them during Design:

- contracts use explicit `v1` discriminants and canonical hashes;
- the unified failure manifest is an auxiliary artifact/reference, not a new SDD phase;
- the decision kernel is pure and deterministic; adapters perform effects;
- one runtime coordinator owns registry writes;
- Full SDD is the floor for security, public API, migration, cross-package architecture, destructive operations, and explicit user requests;
- Verify and Review remain independent; fresh final Review is mandatory after incidents;
- OpenCode and Pi must pass the same conformance suite before invocation authorization becomes mandatory;
- rollout starts in observe/shadow modes and uses additive schema changes;
- raw diagnostic or secret-bearing context is never persisted in manifests or telemetry.

Design must choose the exact filesystem transaction strategy for atomically updating two YAML files and the exact cryptographic/non-cryptographic authorization envelope appropriate to local runners. These are Design decisions, not Proposal blockers.

## Relevant Files

- `packages/sdd-runtime/src/contracts/repair-incident.ts` — existing incident/failure contract and parser.
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts` — disconnected budget/fingerprint evaluator.
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — executable orchestration extension point.
- `packages/sdd-runtime/src/orchestrator/risk-scorer.ts` — risk scoring foundation.
- `packages/sdd-runtime/src/orchestrator/quality-router.ts` — quality-check routing foundation.
- `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` — CAS/idempotency state boundary without production caller.
- `packages/sdd-runtime/src/index.ts` — public runtime exports.
- `packages/core/src/spec-registry/{types,events,validator,paths,yaml}.ts` — registry API and compatibility surface.
- `packages/core/src/teams/developer/orchestrator-invariants.ts` — authorization and safety invariants.
- `packages/core/src/teams/developer/orchestrator-content.ts` — current procedural workflow, batching, triage, freshness, and registry guidance.
- `packages/core/src/teams/developer/content-registry.ts` — role/invariant/capability composition.
- `packages/core/src/teams/developer/*-content.ts` — canonical specialist role prompt sources.
- `packages/core/src/teams/developer/instruction-bundles/` — capability prompt bundles.
- `packages/adapter-opencode/src/prompt-generation.ts` — static prompt generation and optional authorization injection.
- `packages/adapter-opencode/src/developer-team-install.ts` — OpenCode install boundary.
- `packages/adapter-pi/src/pi-team-profile.ts` — Pi static team prompt boundary.
- `packages/adapter-pi/src/developer-team-install.ts` — Pi install boundary.
- `packages/core/src/skills/external/content.generated.ts` — generated output; never hand-edit.
- `openspec/registry-schema.md` — authoritative registry compatibility rules.
- `openspec/config.yaml` — strict TDD, testing, and security constraints.
- `openspec/archive/bounded-developer-team-repair-loops/` — prior contract, staged verification, migration, telemetry, and rollback lessons.

## Actionable Diagnosis

**Yes.** Deck's convergence problem is an authority-boundary problem: procedural prompts currently carry responsibilities that should be executable runtime contracts and deterministic decisions. Implement the incremental runtime control plane, beginning with the batch/failure contracts and production-wired failure-delta kernel.

## Ready for Proposal

**Yes.** Proposal should authorize the complete seven-slice program while requiring incremental flags, adapter parity, compatibility fixtures, independent verification, and measurable convergence gates.
