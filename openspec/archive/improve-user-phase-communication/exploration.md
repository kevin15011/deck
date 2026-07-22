# Exploration: Improve User Phase Communication

## Phase Result

- **Status**: Completed; registry reconciliation remains centralized.
- **Action**: Proceed to Proposal only after the Orchestrator records the Explore artifact/event and resolves the active-change sequencing decision below.
- **Role**: `deck-developer-explorer`
- **Instance**: `openai/gpt-5.6-sol`, 2026-07-22, read-only investigation plus this artifact.
- **Execution mode**: Interactive.
- **Artifact**: `openspec/changes/improve-user-phase-communication/exploration.md`
- **Official context**: Repository OpenSpec artifacts, source, tests, registry contracts, and Git history.
- **Adaptive context**: Loaded as advisory context; it agreed with the confirmed user intent and did not override official evidence.

## Confirmed Intent

Deck should align with the user before consequential work, communicate each phase at the right level of detail, make Proposal genuinely collaborative, and make Design—not Apply—the authority for exact Deck prompt/instruction modifications. Trivial direct edits remain exempt from the intake confirmation gate.

## Key Findings

### 1. The current intake controls do not implement the requested alignment gate

- `packages/core/src/teams/developer/orchestrator-content.ts:173-208` requires triage, Interactive phase pauses, Explorer-first evidence, and authorization before modifying work.
- `packages/core/src/teams/developer/orchestrator-invariants.ts:136-159` models this as `INV-004`, but it requires classification only. It does not require the Orchestrator to normalize scattered input, restate understanding, expose assumptions/open questions, and obtain confirmation for non-trivial work.
- `ORCHESTRATOR_AGENT_BODY` only asks for confirmation "when risk requires it" (`orchestrator-content.ts:539-543`). That is narrower than ambiguity-, definition-, and consequence-based intake alignment.
- Recommendation: extend the existing `INV-004` intake/triage responsibility rather than create a competing invariant. Keep modification authorization as a separate later gate.

### 2. User-facing phase communication is prompt-governed, not rendered by a dedicated runtime UI

- `ORCHESTRATOR_SYSTEM_PROMPT` says Interactive mode shows a summary and asks before proceeding (`orchestrator-content.ts:188-197`).
- The legacy skill requires Mermaid diagrams after Proposal, Spec, Design, and Tasks (`orchestrator-content.ts:785-798`), regardless of whether a diagram improves the user decision.
- The default compact session prompt says only to keep the conversation thin (`orchestrator-content.ts:884-914`).
- Pragmatica currently says phase completions get one line (`orchestrator-content.ts:424-434`). That conflicts with the need to surface key findings, risks, and open decisions when they matter.
- No production phase-summary formatter or approval state machine was found. The practical control surface is canonical Orchestrator/role content plus semantic regression tests.

### 3. Proposal is approval-ready, but not explicitly collaborative

- `proposal-content.ts:110-205` captures intent, scope, risks, open questions, and acceptance direction.
- Compact Proposal content calls the artifact "approval-ready" and surfaces approval questions (`proposal-content.ts:285-312`), but neither profile frames the user as client/system owner/domain authority/stakeholder or requires iterative agreement before approval.
- The registry already supports `approved` status and `human.approved` / `human.rejected` event types (`packages/core/src/spec-registry/types.ts:106-116`). A new registry schema is not required to record agreement.
- The Orchestrator must mediate collaboration because specialist returns are internal and English-only; the Orchestrator alone owns the user conversation.

### 4. Phase-role artifacts are intentionally more detailed than user summaries

- Explorer already returns evidence, risks, options, confidence, and open questions (`explorer-content.ts:254-281`).
- Spec preserves testable requirements and scenarios; Tasks preserves atomic, dependency-ordered execution details (`spec-content.ts:377-405`, `task-content.ts:486-523`).
- Therefore, "little Spec detail" and "general Tasks plan" should constrain the Orchestrator's user-facing synthesis, not weaken authoritative `spec.md` or `tasks.md`.
- Apply, Verify, and Review return internal evidence-rich results. The Orchestrator should present Apply as low-noise progress and translate Verify/Review failures into plain language: what failed, impact, and next decision/action.

### 5. Design currently lacks a stable boundary for exact prompt/instruction directions

- Legacy Design content provides a flexible Markdown template with Proposed Architecture, File Impact, testing, tradeoffs, risks, and open decisions (`design-content.ts:85-338`). Compact Design requires actionable boundaries and file impact but does not name exact implementation instructions (`design-content.ts:340-368`).
- Apply consumes Design as authoritative context, but current Apply prompts only say to preserve Design boundaries; they do not explicitly forbid redesigning Deck system prompts/instructions.
- Tasks promises to preserve Design constraints but may restate them while decomposing work. Without a stable Design section, exact wording can be diluted before Apply.

### 6. Existing `design.md` can safely carry the contract; no new artifact/schema is needed

- The Spec Registry maps `design` to `design.md` and validates artifact presence/status, not Markdown headings (`openspec/registry-schema.md:80-98`).
- No parser or validator was found that requires the existing Design headings. `DesignAudit` in `packages/sdd-runtime/src/contracts/self-audit.ts` is a separate structured runtime audit, not a parser for `design.md`.
- Recommendation: add a conditional, stable `## Exact Implementation Instructions` section to the existing Design contract for Deck-owned system prompts/instructions. Do not add a new artifact or registry field.
- The section should identify each canonical target and symbol, the exact replacement or constrained delta, required preserved clauses, whether wording is verbatim or semantically constrained, and focused regression assertions. Ambiguity must block Task/Apply rather than be redesigned downstream.

### 7. Canonical source and materialization paths are already centralized

- Canonical role/session content lives in `packages/core/src/teams/developer/*-content.ts` and is selected by `content-registry.ts`; compact is the default (`content-registry.ts:452-525`, `636-662`).
- OpenCode builds prompts and skill files from the registry (`packages/adapter-opencode/src/prompt-generation.ts:274-336`, `developer-team-install.ts:474-512`).
- Pi builds agent and skill files from the same registry (`packages/adapter-pi/src/developer-team-install.ts:1012-1133`).
- Adapter tests already prove compact-by-default and registry pass-through. Generated/materialized outputs are evidence only; no checked-in generated file should be edited directly for this change.

### 8. Existing tests provide the right regression layers

- Role content tests currently emphasize non-placeholder content and broad role differentiation, but do not enforce the requested phase communication semantics.
- `orchestrator-content.test.ts` and `orchestrator-invariants.test.ts` enforce triage wording and invariant composition.
- `prompt-profile.test.ts:69-200` proves compact default, dedicated role bodies, runtime-contract retention, legacy snapshots, and a 30% compact budget. Legacy edits require deliberate snapshot updates; compact additions must preserve the budget.
- OpenCode/Pi install tests already assert generated plans contain registry-provided compact agent/skill bodies. New behavior should be asserted primarily at canonical content/composition level, retaining adapter pass-through tests as integration coverage.

## Recommended Smallest Coherent Change Surface

| Area | Target | Required change |
|---|---|---|
| Intake gate | `orchestrator-content.ts`, `orchestrator-invariants.ts` | Extend triage/intake wording for non-trivial alignment and explicit confirmation; preserve the trivial direct-edit exemption and separate modification authorization. |
| Phase synthesis | `orchestrator-content.ts` | Add a phase communication matrix: Explore key findings/risks/decisions; Proposal collaborative agreement; Spec minimal highlights; Design technical-lead summary; Tasks general plan; Apply low-noise; Verify/Review plain-language failures. Apply personality styling after this invariant content. |
| Explorer | `explorer-content.ts` | Ensure the return highlights decision-relevant findings without removing full evidence from `exploration.md`. |
| Proposal | `proposal-content.ts` | Treat Proposal as a collaborative draft, expose agreement questions, and prevent advancement until user agreement is recorded by the Orchestrator. |
| Design authority | `design-content.ts` | Add the conditional exact-instructions section and require a concise technical-lead summary. |
| Handoff fidelity | `task-content.ts`; all three `apply-*-content.ts` files | Preserve/reference exact Design instructions without reinterpretation; Apply must stop on ambiguity and must not redesign. Keep `tasks.md` atomic even though its user summary is general. |
| Failure communication | `verify-content.ts`, `review-content.ts`, `orchestrator-content.ts` | Return and synthesize plain-language failure meaning, impact, and next action without dropping structured evidence. |
| Regression tests | Adjacent content tests, `orchestrator-invariants.test.ts`, `prompt-profile.test.ts` | Add semantic assertions across compact and legacy profiles/personality variants; retain prompt-budget and adapter pass-through coverage. |

No change is presently justified in Spec Registry schemas, `RegistryIntentV1`, runtime authorization contracts, adapter implementation, CLI/TUI, or generated files.

## Requirements and Artifact Placement

- **Proposal**: user problem, collaborative operating model, bounded scope, dependencies/conflicts, and approval questions.
- **Spec**: observable requirements for intake classification/confirmation, phase-specific summaries, Proposal agreement, Design authority, Apply fidelity, personality behavior, and failure explanations.
- **Design**: exact target-by-target prompt/instruction modifications, composition order, stable exact-instructions section, compatibility across compact/legacy profiles, and test assertions.
- **Tasks**: atomic internal implementation work; the Orchestrator presents only a general grouped plan to the user.
- **Tests**: semantic contract assertions, not full-prompt snapshots except the existing deliberate legacy baseline.

## Options and Tradeoffs

| Option | Benefit | Cost/Risk | Assessment |
|---|---|---|---|
| Stable conditional section inside `design.md` | Clear Design→Task→Apply authority; no schema migration | Requires prompt/test updates and disciplined references | **Recommended** |
| Use existing Design prose/impact sections only | Fewest source edits | Exact wording remains easy to dilute or redesign | Too weak for confirmed intent |
| New implementation-instructions artifact/schema | Strong mechanical separation | New lifecycle/schema/registry complexity; conflicts with convergence work | Disproportionate |

## Dependencies and Conflict Risks

1. **`developer-team-execution-convergence` — active, direct target overlap.** Its registry says `currentPhase: apply`, `status: passed_with_warnings`, and its Design includes late changes to `orchestrator-content.ts`, all Apply contents, Verify/Review contents, `content-registry.ts`, and prompt-profile tests. Commit `ccf0f66` introduced the compact profile and touched nearly every proposed target. Do not Apply both changes concurrently. Prefer sequencing this change after convergence is closed or obtaining an explicit target handoff/rebase point.
2. **`strengthen-triage-before-modification` — archived conceptual predecessor.** It established the current `INV-004` classification-before-modification clauses and warns against blocking legitimate Direct edits. Preserve its history and extend current source semantics without modifying that change.
3. **Compact prompt budget.** Adding user communication policy to every role can regress the 30% compact reduction. Keep phase synthesis centralized in the Orchestrator and add role text only where the handoff contract changes.
4. **Profile drift.** Updating only legacy or only compact content would produce different behavior because compact is the production default and legacy remains an explicit compatibility profile.
5. **Protected scope.** No investigated or recommended target intersects `runner-capability-standardization`.

## User Decisions Needed for Proposal

1. **Intake gate timing**: Must confirmation occur before any specialist investigation, or may the Orchestrator perform a bounded read-only Explore first and then present a better-informed restatement before Proposal? Recommendation: permit only bounded read-only clarification before confirmation; prohibit artifact creation, planning commitment, or modification until confirmed.
2. **Proposal approval evidence**: Should agreed Proposal approval be recorded as a centralized `human.approved` registry event, in addition to conversational confirmation? Recommendation: yes, when a registry exists.
3. **Exactness mode**: Should Design mark each instruction as byte-verbatim or semantically constrained, rather than requiring all prompt prose to be byte-identical? Recommendation: support both and require Design to declare the mode per target.
4. **Planning diagrams**: Should current mandatory Mermaid summaries become conditional when they aid a decision? Recommendation: make them conditional; mandatory diagrams conflict with low-noise Spec/Task communication.

## Confidence, Blockers, and Registry Intent

- **Confidence**: High (0.91) on architecture, composition paths, artifact compatibility, and minimum source/test surface; medium (0.78) on the preferred confirmation timing because it is a product interaction decision.
- **Implementation blocker**: Active overlapping ownership in `developer-team-execution-convergence` must be resolved before Apply.
- **Proposal blocker**: None after the four user decisions above are answered or explicitly accepted as recommended defaults.
- **FailureManifestV1**: None; no execution or verification failure occurred.
- **Ordered RegistryIntentV1 values**: `[]`. This new change has no `state.yaml`/`events.yaml`, and the Explorer was forbidden to create them. A digest-bound `RegistryIntentV1` cannot be validly constructed without the authoritative base pair. The centralized Orchestrator must bootstrap/re-read the pair, then record `explore.completed` for this artifact without asking the specialist to write shared registry files.
