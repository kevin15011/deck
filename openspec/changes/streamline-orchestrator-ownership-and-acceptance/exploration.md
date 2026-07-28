# Exploration: Streamline Orchestrator Ownership and Acceptance

## Exploration status

- **Phase:** Explore
- **Execution mode:** Interactive; stop after Explore
- **Change:** `streamline-orchestrator-ownership-and-acceptance`
- **Role:** `deck-developer-explorer`
- **Repository evidence baseline:** `main` at `552172640f3b4172e6a395a8314b3aac0b4d2e20`
- **Modification boundary:** this artifact only
- **Excluded target:** `runner-capability-standardization`
- **Adaptive context:** loaded and treated as advisory only; all findings below are grounded in current source, tests, Git history, and OpenSpec artifacts

## Question and confirmed intent

Investigate how Deck can stop delegating coordinator-owned mechanical work, add a natural functional-acceptance checkpoint after Apply, avoid full independent Verify/Review during user-directed adjustment iterations, and handle explicit commit-only requests proportionally. The final accepted implementation must still pass the independent Verify and Review gates and all mandatory risk floors.

This exploration does not approve a proposal, define final requirements, or authorize source/test changes.

## Executive finding

The reported overhead has two distinct causes:

1. **Delegation policy is internally contradictory and weighted toward eager delegation.** The expanded prompt permits bounded reads, atomic mechanical writes, and Git state inspection inline, but the critical `INV-002` invariant and several compact surfaces tell the Orchestrator to delegate specialist-owned work. Because compact content is the default and invariants are prepended at highest visibility, the permissive guidance is weaker and sometimes absent from the actual default surface.
2. **The lifecycle has no explicit post-Apply functional-acceptance checkpoint.** Prompt and convergence contracts advance from accepted Apply evidence toward independent verification. Apply skills also instruct implementors to run staged targeted/affected/broad checks, which blurs Apply-local proof with independent final quality gates and can spend broad-check effort before the user confirms the solution is functionally right.

The smallest viable direction is to replace the **pure delegator** invariant with a **coordinator ownership / specialist judgment** invariant, add a phase-internal post-Apply acceptance checkpoint, and narrow Apply checks to implementation-local proof before that checkpoint. Do not add a user-facing fast route or a new canonical SDD phase. Preserve the existing independent final sequence and freshness rules after acceptance.

## Verified facts

### 1. Eager delegation is mandated primarily by composed prompt content, not by a runtime delegation guard

| Evidence | Verified fact |
|---|---|
| `packages/core/src/teams/developer/orchestrator-invariants.ts:85-107` | `INV-002` is a critical-tier **Pure Delegator** invariant. Its condition is any task a specialist can handle; its required action is to delegate and not execute the work directly. |
| `openspec/archive/persistent-orchestrator-invariants/spec.md:13-36` | The archived authoritative spec explicitly requires pure delegation as a critical invariant and requires invariant injection into session, agent, and skill surfaces. A new change must deliberately supersede this narrow requirement; lower-priority prose cannot safely contradict it. |
| `packages/core/src/teams/developer/content-registry.ts:375-398,483-503,684-713` | Invariants are composed ahead of base content. The default prompt profile is `compact`, and compact invariants plus the runtime contract are prepended to the session and agent surfaces. |
| `packages/core/src/teams/developer/content-registry.test.ts:967-1042` | Tests require compact invariants at position zero and require `INV-002` in the default Orchestrator agent body. This is deterministic prompt composition, not a runtime decision about each delegation. |
| `packages/core/src/teams/developer/orchestrator-content.ts:75-127` | The expanded prompt says “Delegate everything” and “Never execute” specialist-capable tasks, but the same section allows 1–3-file decision reads, an atomic mechanical one-file write, and Git/GitHub state commands inline. It also says to avoid delegation for local one-file fixes, quick state checks, and understood mechanical edits. |
| `packages/core/src/teams/developer/orchestrator-content.ts:942-1006` | The default compact session prompt says to choose the smallest safe workflow and delegate each SDD phase, but it does not carry the expanded inline-operation table. |
| Graph call/reference evidence | No runtime function was found that rejects a direct coordinator-owned operation merely because a specialist exists. `INV-002` is injected and tested as content. Runtime controls instead enforce authorization, staged evidence, freshness, lanes, registry writes, and related safety boundaries. |

**Conclusion:** eager delegation is a prompt-level invariant with strong composition and test enforcement. It is not an effect-boundary runtime rule. Fixing only descriptive prose would be insufficient because `INV-002` remains critical and default compact content remains dominant.

### 2. Coordinator-owned operations already exist

Current authoritative source assigns these operations directly to the Orchestrator/coordinator:

- triage, bounded ambiguity-resolving read-only discovery, user restatement, phase synthesis, and decisions (`orchestrator-content.ts:174-202,942-975`);
- official artifact and registry verification before advancement, including mechanical repair only when unambiguous (`orchestrator-content.ts:232-246,795-830`);
- serialized shared registry reconciliation after parallel specialists return intents (`orchestrator-content.ts:236-246,791-803`);
- centralized intent commitment and conflict/recovery stop (`content-registry.ts:231-240`; `openspec/archive/deterministic-apply-verify-review-flow/spec.md:890-930`);
- read-only skill-discovery validation and bounded status projection (`orchestrator-content.ts:382-390,993-1001`);
- bounded Git state inspection in the expanded inline/delegate table (`orchestrator-content.ts:96-104`).

The current source also permits a Direct classification for local, low-risk, clear, or single-mechanical-artifact work (`orchestrator-content.ts:182-187,640-645`). The gap is therefore not absence of coordinator ownership; it is the lack of one precedence-safe rule defining when that ownership wins over specialist availability.

### 3. Minimal ownership rule that preserves specialist boundaries

A viable rule is:

> **The Orchestrator performs coordination-owned operations directly when the operation is bounded, mechanical, already authorized, and requires neither specialist implementation nor independent judgment. It delegates when the work changes product/system behavior, creates a specialist-owned phase artifact, requires domain implementation, requires independent Verify/Review judgment, runs heavy execution, or crosses an explicit risk/scope floor.**

Examples of direct coordinator ownership:

- bounded `git status`, `git diff`, and `git log` inspection;
- staging an explicit reviewed path set and executing an explicitly requested commit;
- deterministic artifact existence/count/digest checks;
- serialized `RegistryIntentV1` validation and registry updates;
- unambiguous metadata reconciliation;
- user-facing phase synthesis and acceptance questions.

Examples that remain delegated:

- Explore, Proposal, Spec, Design, Tasks, Apply, independent Verify, independent Review, and Archive judgments/artifacts;
- behavior-changing source implementation;
- broad codebase investigation;
- security, migration, public-API, data-loss, or architecture judgment;
- heavy tests/builds and any check whose independence is part of the evidence contract.

This rule changes ownership, not authority. Explicit user modification authorization, immutable target scope, runner authorization where supplied, Git discard protection, protected-risk floors, and blocked-target rules still apply.

### 4. Current Apply and final-quality choreography

Authoritative final-quality requirements are strong and should remain unchanged:

- Apply, Verify, and Review require distinct identities and independent judgments (`deterministic-apply-verify-review-flow/spec.md:296-334`).
- targeted Verify precedes affected-area Verify; Review is scheduled only after scoped verification accepts (`spec.md:338-382`).
- broad Verify follows stable Review and remains mandatory for Full-SDD and protected floors (`spec.md:404-430,832-866`).
- any modification invalidates stale current-generation evidence (`spec.md:432-472`).
- commit-ready registry intents require current accepted evidence (`spec.md:890-930`).
- current runtime convergence transitions encode `Apply -> targeted -> affected_area -> Review -> broad -> registry commit` (`packages/sdd-runtime/src/contracts/execution-convergence.ts:430-504`).

No current source or test contains a distinct user-facing “functionally correct” or “accepted candidate” checkpoint between Apply and targeted Verify. The convergence event `apply_result_accepted` is machine evidence acceptance, not user functional acceptance.

There is also a current ownership contradiction in Apply content:

- compact Apply skills tell Apply agents to run targeted, affected-area, and broad checks (`apply-general-content.ts:335-351`, `apply-backend-content.ts:331-347`, `apply-frontend-content.ts:344-360`);
- the runtime contract and archived deterministic requirements reserve final judgments for independent Verify and Review.

This should be resolved by distinguishing **Apply-local proof** from **independent final evidence**.

### 5. Natural acceptance checkpoint

The checkpoint can be inserted after a successful Apply result and minimal Apply-local checks, before the first independent targeted Verify:

1. Apply implements the authorized candidate and runs the smallest local checks needed to show the implementation is coherent (for example, changed-unit tests, a focused smoke check, formatting/type diagnostics where directly relevant).
2. The Orchestrator summarizes the functional result, material deviations, blockers, and any user action; then asks whether the implementation/solution is functionally correct.
3. If the user requests adjustment, the Orchestrator returns to Apply with a new bounded instruction. No independent Verify/Review/broad cycle is launched for that discarded candidate.
4. Each modifying adjustment creates a new candidate generation and invalidates any stale evidence exactly as current freshness rules require.
5. After explicit user acceptance, the Orchestrator launches the independent final sequence: targeted Verify -> affected-area Verify -> Review -> required broad Verify.
6. User acceptance never supplies Verify/Review evidence and never permits Archive/completion by itself.

This is a **phase-internal orchestration checkpoint**, not a new SDD phase and not a user-facing fast route. That is consistent with the anti-bureaucracy precedent in `exploration-lifecycle-states`, which prohibits auxiliary decisions from becoming canonical phases or Apply gates (`openspec/archive/exploration-lifecycle-states/spec.md:70,102-107,382`).

### 6. Prompt-only versus runtime enforcement

| Concern | Current enforcement | Required direction |
|---|---|---|
| Coordinator direct ownership | Prompt/invariant composition and tests | Change the critical invariant plus compact/legacy prompt and role-skill content. No separate runtime effect gate is needed because direct ownership never widens modification authority. |
| Post-Apply user acceptance question | No current contract; user conversation is prompt-driven | Prompt/content enforcement is sufficient for the human interaction if the checkpoint occurs before creating final Verify evidence. Add cross-profile content tests. |
| Apply-local check ceiling | Apply role content currently blurs local and staged checks | Change all three Apply role contents and tests so they prove their implementation locally but do not claim independent final stages. |
| Independent role identity/freshness | Runtime-backed (`freshness-policy-v1`) plus prompt defense | Preserve unchanged. |
| Final targeted/affected/Review/broad ordering | Runtime convergence contract plus prompt content | Preserve unchanged. Do not let the acceptance checkpoint create a completion bypass. |
| Broad/security/authorization/data-loss floors | Runtime lane/staged-verification controls plus authoritative specs | Preserve unchanged. |
| Explicit commit-only request | Agent policy and Git command execution; no commit-specific runtime API found | Prompt/content rule plus Git-safety and bounded staging checks. Do not invent a QA runtime gate solely for `git commit`. |
| Destructive Git confirmation | Canonical prompt rule; `PROMPT_RUNTIME_CONTROL_MAP_V1` marks Git safety as retained defense-in-depth rather than runtime-active | Preserve exact new-message/exact-command flow. |

**Runtime compatibility concern:** Deck currently exposes two sequencing models. `execution-convergence.ts` enforces Review before broad, while the older exported `scheduleExecutionRoleInvocationV1` / `consumeExecutionRoleResultV1` path and `execution-role-scheduler.test.ts:181-194` still schedule Review only after all staged verification (including broad) completes. Graph tracing found no non-test production caller for the role scheduler; its callers are tests and the convergence fixture. Design must classify this path as compatibility-only or reconcile it before claiming that every runtime entry point enforces the same final order. This is a pre-existing inconsistency, not authority to expand the change automatically.

### 7. Commit-only requests

Current facts:

- canonical Git safety classifies `git add` and `git commit` as non-discarding safe commands (`packages/core/src/teams/developer/git-safety.ts:36-46`);
- the expanded prompt allows Git state commands inline but requires a fresh-context review before commit/push/PR after code changes unless the diff is trivial docs/text (`orchestrator-content.ts:96-114,584-590`);
- post-Archive guidance forbids **automatic** Git mutation and offers advisory metadata only (`orchestrator-content.ts:360-369,854-863`; `optimize-sdd-apply-and-commit-suggestions/spec.md:39-59`);
- no rule says an explicit commit request itself must launch full SDD Verify/Review, but the PR rule and pure-delegator posture make that behavior easy to infer.

Recommended commit-only behavior:

1. Treat “commit these changes” as an explicit request to record repository state, not as a claim that the implementation is accepted, verified, reviewed, releasable, or archive-ready.
2. The Orchestrator directly runs bounded status/diff/recent-log inspection, identifies unrelated WIP, and confirms the intended path set if ambiguous.
3. Stage only the explicit intended paths; verify the staged diff/status; then commit with the requested or repository-consistent message.
4. Do not launch Verify or Review solely because `git commit` was requested.
5. If the request also asks to complete/accept/archive/release the SDD change, or an independent policy/risk floor is already applicable to that completion claim, run the required gates for that claim—not for the mechanical commit operation.
6. Never stage, discard, amend, or otherwise disturb unrelated WIP. Destructive operations still require the exact canonical confirmation flow.
7. Report when a commit is a snapshot without independent QA so repository history does not imply evidence that was never produced.

This narrows the current PR rule: risk-proportional review can still be recommended or required by an actual delivery/risk boundary, but a commit-only request does not manufacture an unrelated Verify/Review lifecycle.

## Relevant prior decisions and overlap

### `optimize-sdd-apply-and-commit-suggestions`

Despite being described as active in the investigation request, its authoritative `state.yaml` says `current_phase: closed`, `status: incomplete`, with closure on 2026-05-23 because implementation targeted generated `.pi/` output (`state.yaml:1-5`). Its successor `optimize-sdd-v2-core-implementation` is also closed and `abandoned` before Apply (`state.yaml:1-5`). Historical artifacts remain useful evidence but must not be reopened or rewritten.

Overlap:

- coherent Apply batching;
- role-based delegation;
- post-Archive advisory commit/PR metadata;
- canonical source location in `packages/core/src/teams/developer/`.

Difference/conflict:

- the prior delegation requirement says specialist delegation applies whenever registered rules trigger (`optimize.../spec.md:73-83`), while this request needs coordinator-owned operations to remain direct;
- the prior Git scope addresses advisory post-Archive suggestions and forbids automatic mutation, not execution of an explicit user-authorized commit-only request;
- it has no post-Apply functional-acceptance checkpoint;
- its source map predates the deterministic runtime convergence and compact prompt architecture now in the repository.

### `persistent-orchestrator-invariants`

This is the direct normative conflict. It requires pure delegation as a critical invariant. The new change must explicitly supersede or revise that specific invariant while preserving the invariant schema, ordering, injection, idempotency, and verification requirements.

### `deterministic-apply-verify-review-flow`

This is the primary quality-floor dependency. The new checkpoint may postpone final independent gates until the user accepts a candidate, but it must not remove, merge, parallelize, or waive them. Any accepted-candidate modification returns to Apply and invalidates stale evidence.

### `bounded-developer-team-repair-loops`

Its retry budgets and user decisions remain applicable once independent Verify/Review produces a failure and a repair loop starts. User-directed pre-Verify adjustments are not automatically Verify failure repair incidents and should not consume those independent-repair budgets unless they meet the existing incident definition.

### `exploration-lifecycle-states`

It establishes the useful precedent that a natural user decision can be represented without a new canonical phase, global status, or noisy ceremony.

## Options

### Option A — Prompt prose only

Add an acceptance paragraph and commit guidance only to `orchestrator-content.ts`.

- **Pros:** smallest edit.
- **Cons:** critical `INV-002` remains contradictory; default compact surfaces and Apply skills remain wrong; weak cross-runner behavior; high regression risk.
- **Assessment:** insufficient.

### Option B — Precedence-safe core content change, no new runtime state

Revise `INV-002`, compact and legacy Orchestrator content, all three Apply role contents, and composition/content tests. Treat acceptance as a phase-internal human checkpoint before final Verify evidence begins.

- **Pros:** addresses observed behavior at the actual default composition layer; preserves existing runtime safety/freshness/convergence; no new phase or user-facing abstraction; bounded implementation.
- **Cons:** conversation checkpoint is not a new machine state; session recovery semantics must be explicit; legacy role-scheduler inconsistency remains to classify.
- **Assessment:** recommended baseline.

### Option C — Add an `awaiting_user_acceptance` runtime/convergence state

Extend convergence contracts, scheduling, persistence, adapters, fixtures, and tests.

- **Pros:** strongest machine enforcement and restart visibility.
- **Cons:** large compatibility and migration surface; exact-key/digest contract impact; risks adding the bureaucracy the user rejected; production call graph does not currently show an automatic non-test scheduler that needs this state.
- **Assessment:** not justified unless Design proves a production host can schedule final Verify without going through prompt-driven user interaction.

## Recommended implementation surface

### Required canonical content

- `packages/core/src/teams/developer/orchestrator-invariants.ts`
  - replace “Pure Delegator” semantics with coordinator ownership / specialist judgment semantics;
  - preserve `INV-002` identity if compatibility favors semantic revision, or version/supersede it explicitly if Spec requires a new ID;
  - update compact summary without weakening specialist boundaries.
- `packages/core/src/teams/developer/orchestrator-content.ts`
  - align legacy and compact session/agent/skill surfaces;
  - define direct coordinator operations;
  - add the post-Apply functional-acceptance checkpoint and adjustment loop;
  - replace the unconditional pre-commit fresh-review trigger with proportional commit-only guidance;
  - preserve post-Archive no-automatic-Git-mutation wording.
- `packages/core/src/teams/developer/apply-general-content.ts`
- `packages/core/src/teams/developer/apply-backend-content.ts`
- `packages/core/src/teams/developer/apply-frontend-content.ts`
  - distinguish minimal Apply-local proof from independent final targeted/affected/Review/broad evidence.

### Required tests

- `packages/core/src/teams/developer/orchestrator-invariants.test.ts`
- `packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`
- `packages/core/src/teams/developer/content-registry.test.ts`
- `packages/core/src/teams/developer/manifest.test.ts`
- `packages/core/src/teams/developer/prompt-profile.test.ts` when cross-profile parity assertions fit there
- the three matching `apply-*-content.test.ts` files
- `packages/core/src/teams/developer/user-phase-communication.test.ts` for acceptance/failure communication boundaries

### Conditional runtime surface

Only if Design proves a production scheduler bypasses the prompt checkpoint:

- `packages/sdd-runtime/src/contracts/execution-convergence.ts` and tests;
- `packages/sdd-runtime/src/execution/execution-control-plane.ts` and `execution-role-scheduler.test.ts`;
- runner-host fixtures that bind candidate generation/freshness.

Do not modify generated outputs directly. Adapters consume core content; adapter edits are not indicated by current evidence unless parity tests prove a materialization gap.

## Test and acceptance matrix for a future Spec/Design

1. **Coordinator ownership:** bounded status/diff/log, deterministic registry reconciliation, and explicit staging/commit remain direct.
2. **Specialist boundary:** behavior implementation and every independent judgment remain delegated.
3. **Default profile:** compact session, agent, and skill surfaces contain the new ownership rule; legacy surfaces do not contradict it.
4. **Apply pause:** successful Apply plus local checks leads to one natural functional-correctness question before final independent Verify.
5. **Adjustment:** user correction returns to Apply without launching independent Verify/Review for the discarded candidate.
6. **Acceptance:** user acceptance launches targeted -> affected_area -> Review -> required broad.
7. **Freshness:** any later modification invalidates accepted-candidate evidence and requires a fresh final sequence.
8. **No substitution:** user acceptance cannot satisfy Verify, Review, broad, Archive, or registry commit-ready evidence.
9. **Commit only:** explicit commit request performs bounded Git preparation and commit with no automatic Verify/Review and no QA claim.
10. **Commit plus completion:** when the user asks to close/release/archive, existing mandatory gates still apply.
11. **Unrelated WIP:** staging excludes unrelated modified/untracked paths and never discards them.
12. **Risk floors:** security, destructive, data-loss, migration, authorization, public-API, cross-package, high/critical-risk, Full-SDD, registry-conflict, and excluded-target hard stops remain unchanged.
13. **Automatic mode:** behavior follows the approved decision on whether functional acceptance always pauses Automatic mode.

## Risks

- **Normative conflict:** changing `INV-002` without explicitly superseding `REQ-OIS-002` would leave official artifacts and current source semantically inconsistent.
- **Over-broad direct ownership:** vague “simple work” wording could let the Orchestrator absorb implementation or independent judgment. The rule must be defined by ownership and judgment, not only file count.
- **False acceptance:** users may interpret “functionally correct” as formal QA. The prompt must state that acceptance selects the candidate; it does not replace independent gates.
- **Under-testing Apply:** reducing Apply checks too far can hand obviously broken candidates to users. Apply still needs minimal local proof appropriate to the changed behavior.
- **Automatic-mode contradiction:** current Automatic mode promises back-to-back phases. A mandatory user acceptance pause changes that promise unless scoped to Interactive mode or explicitly defined as a non-waivable human gate.
- **Recovery ambiguity:** if acceptance is conversational only, a restarted session needs a reliable way to know whether the current Apply candidate was accepted. Reusing existing state/artifact notes may be sufficient; adding a new canonical phase is not.
- **Dual runtime sequencing:** the legacy role scheduler and additive convergence contract do not express the same Review/broad order. Ignoring that without classification could overstate runtime guarantees.
- **Commit semantics:** a snapshot commit can preserve unverified work; reporting must not imply final acceptance or release readiness.
- **Prompt-profile drift:** changing only legacy or only compact content will reproduce the current mismatch.
- **Generated/materialized parity:** canonical source changes may require normal deterministic regeneration checks, but generated files must not be hand-edited.

## Assumptions

- “Functional acceptance” means the user confirms that the candidate solves the intended problem from their perspective; it is not a compliance or engineering-quality verdict.
- The acceptance checkpoint is desired for SDD implementation iterations, not for read-only or commit-only requests.
- Apply-local checks are narrow implementation proof, while final targeted/affected/broad checks are independent Verify evidence.
- An explicit commit request authorizes the commit operation and intended staging scope when those are unambiguous; it does not authorize unrelated paths, amend, push, branch changes, destructive Git, or release claims.
- Current graph evidence is fresh at repository HEAD and shows no non-test production caller of `scheduleExecutionRoleInvocationV1`; Design should recheck before relying on that assumption.

## Open decisions

1. **Automatic mode:** must every SDD run pause for functional acceptance, or only Interactive mode? The confirmed intent sounds universal, but this changes the current Automatic contract and needs explicit approval.
2. **Durable acceptance evidence:** should the checkpoint be recorded minimally in `apply-progress.md` / an existing human approval event, or remain conversational until final Verify starts? A new canonical phase is not recommended.
3. **Direct-operation ceiling:** should the Spec use qualitative boundaries (mechanical/no specialist judgment) only, or add bounded numeric guidance for files/commands? Numeric rules are easy to game and should be secondary at most.
4. **Commit scope ambiguity:** when the user says only “commit,” should the Orchestrator infer all current intended work after inspection or always ask for exact paths when unrelated WIP exists? Recommended: infer only when the staged set is unambiguous; otherwise ask once.
5. **Legacy scheduler:** is `scheduleExecutionRoleInvocationV1` compatibility-only, or must this change reconcile its Review-after-broad behavior with the authoritative convergence order?
6. **Apply-local minimum:** define the smallest mandatory local proof by task type without recreating independent Verify inside Apply.

## Recommendation

Create this as a **new change**, not an extension of either closed historical optimize change. Reference and reuse their valid source-location and Git-advisory findings, but explicitly reconcile and supersede the conflicting delegation rule. Proceed with Option B:

1. revise the critical Orchestrator ownership invariant across default compact and legacy surfaces;
2. preserve specialist ownership of implementation and independent judgment;
3. add one phase-internal post-Apply functional-acceptance checkpoint;
4. return user-requested adjustments to Apply before independent QA;
5. run final independent targeted/affected/Review/broad only for the accepted candidate;
6. treat explicit commit-only requests as coordinator-owned bounded Git operations with no automatic QA lifecycle;
7. retain every existing authority, freshness, risk, broad, destructive-operation, and registry floor.

Do not add a fast-route abstraction. Do not add a canonical phase. Do not add runtime acceptance state unless Design demonstrates a real production bypass that prompt/content enforcement cannot cover.

## Confidence

- **High** that eager delegation is caused by a critical prompt invariant and cross-surface composition rather than a runtime delegation guard.
- **High** that current authoritative final Verify/Review/freshness floors must remain and can coexist with a pre-Verify acceptance checkpoint.
- **High** that both historical optimize changes are closed and should not be reopened.
- **Medium-high** that prompt/content enforcement is sufficient for the acceptance checkpoint, because current graph evidence shows no non-test production role-scheduler caller.
- **Medium** on whether the legacy role-scheduler inconsistency belongs in this change; that depends on its supported compatibility status.

## Evidence references

### Current source and tests

- `packages/core/src/teams/developer/orchestrator-content.ts:42-127,147-217,232-246,340-369,560-620,626-771,795-863,942-1098`
- `packages/core/src/teams/developer/orchestrator-invariants.ts:85-107,188-247,316-331,418-528`
- `packages/core/src/teams/developer/content-registry.ts:212-240,375-398,483-503,684-713`
- `packages/core/src/teams/developer/content-registry.test.ts:967-1071`
- `packages/core/src/teams/developer/orchestrator-content.test.ts:60-118,171-200,673-725`
- `packages/core/src/teams/developer/git-safety.ts:13-63`
- `packages/core/src/teams/developer/apply-general-content.ts:314-352`
- `packages/core/src/teams/developer/apply-backend-content.ts:310-348`
- `packages/core/src/teams/developer/apply-frontend-content.ts:323-361`
- `packages/sdd-runtime/src/contracts/execution-convergence.ts:420-504,523-650`
- `packages/sdd-runtime/src/orchestrator/staged-verification.ts:107-214`
- `packages/sdd-runtime/src/orchestrator/freshness-policy.ts:49-88`
- `packages/sdd-runtime/src/execution/execution-control-plane.ts:419-654`
- `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts:121-234`

### OpenSpec authority/history

- `openspec/archive/persistent-orchestrator-invariants/spec.md:9-70`
- `openspec/archive/deterministic-apply-verify-review-flow/spec.md:290-479,826-945`
- `openspec/archive/deterministic-apply-verify-review-flow/design.md`
- `openspec/archive/deterministic-apply-verify-review-flow/archive-report.md`
- `openspec/archive/bounded-developer-team-repair-loops/spec.md:27-96`
- `openspec/archive/exploration-lifecycle-states/spec.md:70-107,382`
- `openspec/changes/optimize-sdd-apply-and-commit-suggestions/spec.md:39-108`
- `openspec/changes/optimize-sdd-apply-and-commit-suggestions/state.yaml:1-5`
- `openspec/changes/optimize-sdd-v2-core-implementation/state.yaml:1-5,93-97`

### Git history

- `5ba2450`, `8cfebf8`: introduction/evolution of pure-delegator wording.
- `c9acfa9`: persistent orchestrator invariants.
- `f8a2d65`: historical seven orchestration improvements.
- `7bc4b36`: exploration lifecycle states.
- `66f6de4`: bounded repair loops.
- `15804c4`, `34aadac`, `664cbaa`: deterministic sequencing/authority and follow-up hardening.

## Scope and registry notes

- The supplied Skill Discovery Context was `indeterminate`; bounded direct discovery used only generic repository sources and active OpenCode capabilities. `.atl/skill-registry.md` was not read, repaired, regenerated, or modified.
- Pre-existing WIP in `openspec/changes/opencode-package-install-running-binary-regression/events.yaml` and `state.yaml` was observed by read-only Git status and not modified, staged, discarded, or otherwise disturbed.
- No source, test, generated, shared registry, or historical artifact was modified.
- No valid `RegistryIntentV1` can be materialized in this specialist context because no coordinator-issued batch/base state and events digests exist for the new change, and the allowlist forbids creating `state.yaml` or `events.yaml`. The coordinator must initialize/reconcile registry state and construct the digest-bound intent without inventing authority.
