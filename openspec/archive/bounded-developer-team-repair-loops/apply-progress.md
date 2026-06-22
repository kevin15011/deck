# Apply Progress: Bounded Developer Team Repair Loops

## Status

- **Phase**: Apply
- **Status**: completed
- **Recorded by**: deck-developer-orchestrator
- **Reason for manual progress record**: The first Apply delegation returned a partial free-form summary instead of the required Apply return contract and did not create `apply-progress.md` or update the Spec Registry.

## Boundary Clarification: No Deck-Owned sdd-* Commands

Per the user clarification received before Apply, this artifact (along with the design and tasks artifacts) was repaired before Apply to enforce the following boundary:

- Deck does NOT own, install, generate, or manage OpenCode commands named `sdd-*` (including `sdd-apply`, `sdd-verify`, and `sdd-continue`).
- Deck does NOT treat SDD skills as Deck install artifacts.
- Deck retains Developer Team subagents and skills (`deck-developer-apply-*`, `deck-developer-verify`, `deck-developer-archive`, `deck-developer-orchestrator`, etc.) as Deck-owned content.
- Existing installed user files (for example, previously installed `sdd-*` command files in a user's `${configDir}/commands/`) are not deleted by Deck as part of this fix. Deck simply stops producing or managing them going forward.
- Any cleanup of legacy installed files is user/manual or a separately authorized change.

Artifacts were repaired before Apply:

- `design.md`: replaced the earlier `Stage 4 — Adapter surfacing` prescription with an adapter-boundary row, removed the `OpenCode commands` API/contract implication row, replaced the `command-generation.ts` rows in the Component/Module Boundaries, File Impact Estimate, and Staging Strategy tables with boundary assertions, updated the Testing Strategy bullet, and added a Boundary Clarification section near the top of the document.
- `tasks.md`: replaced Task 10 (formerly "Update OpenCode adapter command generation to surface repair-incident context") with a boundary correction task ("Enforce Developer Team install boundary — no `sdd-*` command generation"). Updated Task 11 to drop the adapter `sdd-*` integration dependency, updated the dependency graph, parallelization plan, responsibility contracts, complexity summary, review workload forecast, Open Questions, and Mermaid diagram to reflect the boundary.
- `state.yaml`: set `currentPhase: tasks`, `status: repaired`, and appended a new provenance entry recording the boundary repair while preserving all prior provenance.
- `events.yaml`: appended a `tasks.boundary_repaired` event while preserving all prior events.

Per the constraint that this repair must not modify product code, tests, package files, installed OpenCode files, or git state, and must not delete any installed files, the repair is limited to OpenSpec artifacts and registry files only. No product code, tests, or installed files were changed or deleted by this repair.

## Apply Attempt 1 Summary

The first General Apply attempt completed only the runtime foundation slice. It did not complete the full 11-task implementation plan.

### Completed Tasks

| Task | Status | Evidence |
|---|---|---|
| Task 1: Define `RepairIncident` runtime contract and validator | Complete | Apply agent reported completion; new files exist under `packages/sdd-runtime/src/contracts/`. |
| Task 2: Implement `evaluateRepairIncident` governance helper | Complete | Apply agent reported completion; new files exist under `packages/sdd-runtime/src/orchestrator/`. |

### Pending Tasks

| Task | Status | Next Apply Slice |
|---|---|---|
| Task 3: Extend registry schema with optional `repair_incident` key and known events | Pending | Slice A2 |
| Task 4: Update registry validator + types to accept repair telemetry (warning-first) | Pending | Slice A2 |
| Task 5: Document registry schema and methodology for repair loops | Pending | Slice A2 |
| Task 6: Update orchestrator content with repair-loop launch, checkpoint, hard-stop, escalation, and registry reconciliation | Pending | Slice B |
| Task 7: Update Verify content with staged verification and structured failure manifest | Pending | Slice B |
| Task 8: Update Apply content (general, backend, frontend) with repair-incident consumption, scoped retries, and generated-artifact evidence | Pending | Slice B |
| Task 9: Update Task content with repair-replan guidance | Pending | Slice B |
| Task 10: Update OpenCode adapter command generation to surface repair-incident context | Pending | Slice C |
| Task 11: Add fixture-driven integration tests and cross-module coverage | Pending | Slice C |

## Files Changed by Apply Attempt 1

### Runtime Contracts

- `packages/sdd-runtime/src/contracts/repair-incident.ts`
- `packages/sdd-runtime/src/contracts/repair-incident.test.ts`

### Runtime Orchestration

- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts`
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts`

### Runtime Exports

- `packages/sdd-runtime/src/index.ts`

## Implementation Notes from Apply Attempt 1

- Root cause found during implementation: prior failures were not being counted because the governance helper used `flatMap(f => f.attempts.history.map(() => fp))`; entries with empty `attempts.history` produced no prior fingerprint records.
- Fix applied: prior failures are now derived by mapping each prior failure entry to its normalized fingerprint directly.
- Test correction: `similarCount` is one-indexed (`current + prior`), so three assertions were updated accordingly.
- Placeholder policy used: existing loop/budget defaults remain the first implementation fallback per `preconditions.md` and `tasks.md`.

## Verification Reported by Apply Attempt 1

| Command / Scope | Result | Notes |
|---|---|---|
| Runtime contract/helper tests | Pass (reported) | Apply agent reported all targeted tests passing. |
| TypeScript | Pass (reported) | Apply agent reported clean TypeScript. |
| Aggregate scoped tests | Pass (reported) | Apply agent reported 252 tests passing across 18 files. |

> Note: These results were reported by the Apply agent. The Orchestrator has not independently re-run these commands in this progress repair step.

## Apply Contract Deviation

The Apply attempt did not satisfy the requested return contract:

- It did not complete Tasks 3-11.
- It did not create `apply-progress.md`.
- It did not update `state.yaml` or append an Apply event to `events.yaml`.
- It did not provide the required fields: tasks completed count, grouped changed files, verification command list, Serena edit-tool report, blockers, residual risks, and next phase readiness.

Likely contributing factor: the user observed that the Apply session compacted multiple times, which may have caused the agent to lose the original delegation instructions and required return contract. This is plausible but not treated as proven official evidence unless corroborated by session telemetry.

## Current Blockers

- None blocking continuation, but Apply must continue in smaller slices rather than one large broad delegation.

## Recommended Continuation Plan

Proceed with smaller General Apply slices:

1. **Slice A2 — Registry and docs**: Tasks 3-5.
2. **Slice B — Core Developer Team content**: Tasks 6-9.
3. **Slice C — Adapter and integration tests**: Tasks 10-11.

Each slice must update this `apply-progress.md` before returning and must preserve Spec Registry history.

## Next Phase Readiness

- **Verify readiness**: not ready.
- **Reason**: Apply is partial; only Tasks 1-2 of 11 are complete.

## Apply Slice A2 Started

- Timestamp: 2026-06-22
- Agent: General Apply
- Scope: Tasks 3-5 only.
- Status: in_progress

## Apply Slice A2

**Status**: ✅ Complete
**Agent**: General Apply
**Scope**: Tasks 3-5 only

### Tasks Attempted / Completed

- Task 3: Extend registry schema with optional `repair_incident` key and known events — Complete.
- Task 4: Update registry validator + types to accept repair telemetry (warning-first) — Complete.
- Task 5: Document registry schema and methodology for repair loops — Complete.

### Files Changed

- `packages/core/src/spec-registry/schema.ts` — added `REPAIR_INCIDENT_ARTIFACT_KIND`, `REPAIR_LIFECYCLE_EVENTS`, exported `KNOWN_EVENT_NAMES`, artifact kind support, and repair warning rule.
- `packages/core/src/spec-registry/schema.test.ts` — added constant export coverage.
- `packages/core/src/spec-registry/validator.ts` — accepts `repair.*` auxiliary events, ignores them for phase advancement, warns when repair events lack `artifacts.repair_incident`, and errors when an Apply/Verify repair incident reference points to a missing file.
- `packages/core/src/spec-registry/validator.test.ts` — added repair lifecycle acceptance and warning/error behavior coverage.
- `packages/core/src/spec-registry/types.ts` — added public `repair-incident` artifact kind.
- `packages/core/src/spec-registry/types.test.ts` — added public artifact kind coverage.
- `openspec/registry-schema.md` — documented optional repair incident artifact, auxiliary repair events, and warning-first policy.
- `docs/prompt-methodology-modules.md` — added Bounded Repair Loop methodology module.
- `openspec/changes/bounded-developer-team-repair-loops/apply-progress.md` — recorded Slice A2 start and completion.
- `openspec/changes/bounded-developer-team-repair-loops/state.yaml` — preserved prior provenance and recorded Slice A2 progress.
- `openspec/changes/bounded-developer-team-repair-loops/events.yaml` — preserved prior events and appended `apply.slice_a2_completed`.

### Verification Commands and Results

- `bun test packages/core/src/spec-registry/` — Pass. 77 tests passed, 0 failed, 220 assertions across 5 files.
- Manual docs consistency review — Pass. `repair_incident` and the seven repair events match the schema constants.

### Serena Edit-Tool Usage / Fallback

Serena edit tools unsuitable; fallback used: `apply_patch` and a Node artifact update script. The implementation changed exported constants, validator control flow, tests, Markdown documentation, and YAML/progress artifacts rather than a single symbol body/refactor.

### Blockers / Residual Risks

- Blockers: none.
- Residual risks: broader TypeScript/build validation was not run in this slice; targeted registry tests passed.

### Code Economy Self-Check

- Simpler existing path considered: Yes — reused existing registry constants, validator issue structure, and warning-first patterns.
- New dependency/abstraction added: No.
- Advisory budget exceeded: Yes — touched more than four files because the slice explicitly includes schema, validator, public types, tests, and docs.
- Quality override used: Yes — targeted tests and documentation updates were required by Tasks 3-5.

### Next Slice Readiness

Ready for Slice B (Tasks 6-9). Tasks 1-5 of 11 are complete; Tasks 6-11 remain pending.


## Apply Slice B Started

- Timestamp: 2026-06-22
- Agent: General Apply
- Scope: Tasks 6-9 only.
- Status: in_progress


## Apply Slice B

**Status**: ✅ Complete
**Agent**: General Apply
**Scope**: Tasks 6-9 only

### Tasks Attempted / Completed

- Task 6: Update orchestrator content with repair-loop launch, checkpoint, hard-stop, escalation, and registry reconciliation — Complete.
- Task 7: Update Verify content with staged verification and structured failure manifest — Complete.
- Task 8: Update Apply content (general, backend, frontend) with repair-incident consumption, scoped retries, generated-artifact evidence, redaction, and accessibility preservation — Complete.
- Task 9: Update Task content with repair-replan guidance — Complete.

### Files Changed

- `packages/core/src/teams/developer/orchestrator-content.ts` — added bounded repair-loop governance instructions for launch, checkpoints, hard stops, registry reconciliation, and `evaluateRepairIncident()`.
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — added repair governance content assertions.
- `packages/core/src/teams/developer/verify-content.ts` — added staged repair verification and structured failure manifest instructions.
- `packages/core/src/teams/developer/verify-content.test.ts` — added staged sequencing, manifest field, and residual classification assertions.
- `packages/core/src/teams/developer/apply-general-content.ts` — added repair incident consumption, retry accounting, generated-artifact evidence, redaction, and next-stage instructions.
- `packages/core/src/teams/developer/apply-general-content.test.ts` — added general Apply repair behavior assertions.
- `packages/core/src/teams/developer/apply-backend-content.ts` — added shared Apply repair behavior plus backend runtime fingerprint guidance.
- `packages/core/src/teams/developer/apply-backend-content.test.ts` — added backend Apply repair behavior and fingerprint assertions.
- `packages/core/src/teams/developer/apply-frontend-content.ts` — added shared Apply repair behavior plus accessibility-preservation guidance.
- `packages/core/src/teams/developer/apply-frontend-content.test.ts` — added frontend Apply repair behavior and accessibility assertions.
- `packages/core/src/teams/developer/task-content.ts` — added repair-replan handling for loop decisions and soft checkpoints.
- `packages/core/src/teams/developer/task-content.test.ts` — added repair-replan guidance assertions.
- `openspec/changes/bounded-developer-team-repair-loops/apply-progress.md` — recorded Slice B start and completion.
- `openspec/changes/bounded-developer-team-repair-loops/state.yaml` — preserved prior provenance and recorded Slice B progress.
- `openspec/changes/bounded-developer-team-repair-loops/events.yaml` — preserved prior events and appended `apply.slice_b_completed`.

### Verification Commands and Results

- `bun test packages/core/src/teams/developer/orchestrator-content.test.ts packages/core/src/teams/developer/verify-content.test.ts packages/core/src/teams/developer/apply-general-content.test.ts packages/core/src/teams/developer/apply-backend-content.test.ts packages/core/src/teams/developer/apply-frontend-content.test.ts packages/core/src/teams/developer/task-content.test.ts` — Pass. 354 tests passed, 0 failed, 663 assertions across 6 files.

### Serena Edit-Tool Usage / Fallback

Serena edit tools unsuitable; fallback used: scripted precise file edits. These modules are large exported template-string content surfaces and tests where insertion of prompt sections and content assertions was safer than replacing symbol bodies wholesale.

### Blockers / Residual Risks

- Blockers: none.
- Residual risks: broad project build/typecheck was not run in this slice; targeted Developer Team content tests passed. Tasks 10-11 remain out of scope and pending.

### Code Economy Self-Check

- Simpler existing path considered: Yes — reused existing content module pattern and substring-based content tests.
- New dependency/abstraction added: No.
- Advisory budget exceeded: Yes — touched more than four files because Task 8 explicitly spans three Apply content modules and tests, alongside Orchestrator, Verify, and Task content.
- Quality override used: Yes — targeted tests and explicit prompt guidance were required for Tasks 6-9.

### Next Slice Readiness

Ready for Slice C (Tasks 10-11). Tasks 1-9 of 11 are complete; Tasks 10-11 remain pending.
## Apply Slice C Started

Slice C (Tasks 10-11) started by General Apply on 2026-06-22. Scope is limited to OpenCode adapter repair-incident context surfacing, fixture-driven integration/cross-module coverage, and required registry/apply-progress updates.

## Apply Slice C

**Status**: ✅ Complete
**Agent**: General Apply
**Scope**: Tasks 10-11 only

### Tasks Attempted / Completed

- Task 10: Update OpenCode adapter command generation to surface repair-incident context — Complete.
- Task 11: Add fixture-driven integration tests and cross-module coverage — Complete.

### Files Changed

- `packages/adapter-opencode/src/command-generation.ts` — added optional repair incident command context for `/sdd-apply`, `/sdd-verify`, and `/sdd-continue` only; wording is handoff evidence only and does not define core repair semantics.
- `packages/adapter-opencode/src/command-generation.test.ts` — added assertions for present/absent repair incident wording and no adapter-defined core repair semantics.
- `packages/sdd-runtime/src/__tests__/fixtures/repair-incident/valid.md` — added valid fixture with two failure entries, attempt history, and generated-artifact classification.
- `packages/sdd-runtime/src/__tests__/fixtures/repair-incident/invalid.md` — added invalid fixture with missing fingerprint/id, invalid status, and missing next verification fields.
- `packages/sdd-runtime/src/contracts/repair-incident.ts` — tightened failure-entry required field validation for deterministic fixture errors.
- `packages/sdd-runtime/src/contracts/repair-incident.test.ts` — added fixture parse success/failure coverage.
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` — added fixture-driven continue, repair, checkpoint, and replan governance coverage.
- `packages/core/src/spec-registry/validator.test.ts` — added repair incident reference plus `repair.resolved` canonical validation coverage.
- `openspec/changes/bounded-developer-team-repair-loops/apply-progress.md` — recorded Slice C start and completion.
- `openspec/changes/bounded-developer-team-repair-loops/state.yaml` — preserved prior provenance and marked Apply completed.
- `openspec/changes/bounded-developer-team-repair-loops/events.yaml` — preserved prior events and appended `apply.slice_c_completed` and `apply.completed`.

### Verification Commands and Results

- `bun test ./packages/adapter-opencode/src/command-generation.test.ts` — Pass. 12 tests passed, 0 failed, 288 assertions.
- `bun test ./packages/sdd-runtime/src/contracts/repair-incident.test.ts ./packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts ./packages/core/src/spec-registry/validator.test.ts` — Pass. Targeted fixture/runtime/registry tests passed.
- `bun test ./packages/adapter-opencode/src` — Pass. 360 tests passed, 0 failed, 1797 assertions across 21 files.
- `bun test ./packages/sdd-runtime/src/contracts ./packages/sdd-runtime/src/orchestrator ./packages/core/src/spec-registry` — Pass. 274 tests passed, 0 failed, 692 assertions across 19 files.

### Serena Edit-Tool Usage / Fallback

- Serena edit tools used: `serena_replace_symbol_body` for `parseRepairIncidentYAML` required-field validation.
- Serena edit tools unsuitable; fallback used: `apply_patch` for adapter command strings, tests, fixtures, and OpenSpec/registry artifacts because these are non-symbolic or multi-location text updates.

### Blockers / Residual Risks

- Blockers: none.
- Residual risks: broad full-repository build/typecheck was not run; scoped aggregate tests for touched modules passed.

### Code Economy Self-Check

- Simpler existing path considered: Yes — reused existing command generation options, repair incident parser, governance helper, and registry validator tests.
- New dependency/abstraction added: No.
- Advisory budget exceeded: Yes — Task 11 explicitly required fixture-driven cross-module coverage across runtime contracts, governance, and registry tests.
- Quality override used: Yes — deterministic fixture validation required tightening parser field checks and adding cross-module tests.

### Final Apply Readiness

Tasks 1-11 are complete. Apply is ready for Verify/Review.
## Apply Fix Pass Started

- Started focused Apply repair pass for Verify/Review findings only.
- Scope: `bounded-developer-team-repair-loops` Verify FAIL and Review REQUEST CHANGES findings, registry updates, and worktree hygiene documentation.
## Apply Fix Pass

**Status**: ✅ Complete
**Scope**: Verify/Review fixes only after Verify FAIL and Review REQUEST CHANGES.

### Fixes Completed

1. Fixed TypeScript Verify blocker in `packages/core/src/spec-registry/validator.ts` by narrowing known repair/registry event sets through `ReadonlySet<string>` aliases before `.has(...)` checks, preserving event validation.
2. Enforced per-fingerprint repair attempt limits in `evaluateRepairIncident()`:
   - hard repair-attempt limit returns `block` unless explicit automatic-mode override is present, then `checkpoint`;
   - soft repair-attempt limit returns `checkpoint`;
   - one-entry attempt history can drive repair/replan decisions without requiring duplicate manifest entries.
3. Expanded `parseRepairIncidentYAML()` nested schema validation with deterministic field paths for root fields, budgets, `createdFrom`, runtime budgets, evidence, attempts/history, generated artifacts, lifecycle entries, and array/string field shapes.
4. Made OpenCode command repair-incident context effective in generated `/sdd-apply`, `/sdd-verify`, and `/sdd-continue` commands even when no active incident path is known at install time; wording remains generic and evidence-only.
5. Validated referenced `artifacts.repair_incident` existence independently of repair lifecycle events while preserving warning-first behavior for repair events without a state artifact reference.
6. Updated generated-artifact wording for `untracked_build_output` to allow evidence that it remains untracked/ignored or was removed.
7. Removed the unused `countFailureEvents()` helper.

### Files Changed in Fix Pass

**Runtime governance and contract validation**
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts`
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts`
- `packages/sdd-runtime/src/contracts/repair-incident.ts`
- `packages/sdd-runtime/src/contracts/repair-incident.test.ts`

**Spec registry validation**
- `packages/core/src/spec-registry/validator.ts`
- `packages/core/src/spec-registry/validator.test.ts`

**OpenCode adapter command generation**
- `packages/adapter-opencode/src/command-generation.ts`
- `packages/adapter-opencode/src/command-generation.test.ts`

**Developer Team Apply content wording**
- `packages/core/src/teams/developer/apply-general-content.ts`
- `packages/core/src/teams/developer/apply-general-content.test.ts`
- `packages/core/src/teams/developer/apply-backend-content.ts`
- `packages/core/src/teams/developer/apply-backend-content.test.ts`
- `packages/core/src/teams/developer/apply-frontend-content.ts`
- `packages/core/src/teams/developer/apply-frontend-content.test.ts`

**OpenSpec registry/progress artifacts**
- `openspec/changes/bounded-developer-team-repair-loops/apply-progress.md`
- `openspec/changes/bounded-developer-team-repair-loops/state.yaml`
- `openspec/changes/bounded-developer-team-repair-loops/events.yaml`

### Verification

| Command | Result | Notes |
|---|---|---|
| `bun test --timeout 30000 packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` | Pass | 27 tests passed. |
| `bun test --timeout 30000 packages/sdd-runtime/src/contracts/repair-incident.test.ts` | Pass | 12 tests passed. |
| `bun test --timeout 30000 packages/core/src/spec-registry/validator.test.ts packages/core/src/spec-registry/schema.test.ts` | Pass | 35 tests passed. |
| `bun test --timeout 30000 packages/adapter-opencode/src/command-generation.test.ts` | Pass | 12 tests passed. |
| `bun test --timeout 30000 packages/core/src/teams/developer/apply-general-content.test.ts packages/core/src/teams/developer/apply-backend-content.test.ts packages/core/src/teams/developer/apply-frontend-content.test.ts` | Pass | 164 tests passed. |
| `bunx tsc --noEmit` | Pass | Requested TypeScript gate now exits cleanly. |

### Serena Usage / Fallback

- Serena symbolic edit tools were not used because the required changes were concentrated in tests, fixtures, command strings, OpenSpec artifacts, and multi-function validation logic where precise file patches were safer and more direct.
- Fallback used: targeted `apply_patch` file edits plus read-only status/test commands.

### Worktree Hygiene / Unrelated Isolation Notes

- Read-only status inspection was performed with no staging, commits, cleanup, restore, reset, or destructive git actions.
- Existing unrelated/noise paths observed and left untouched for later Archive/commit guidance: `.opencode/skills/deck-release-publish/SKILL.md` deletion, `.agents/`, root path `4`, and `skills-lock.json`.
- Previously modified files from earlier Apply slices remain present in the worktree and are not discarded; Archive/commit should review the full change set for this OpenSpec change separately.

### Blockers / Residual Risks

- Blockers: none.
- Residual risks: broad full-repository test was not run in this focused repair pass; targeted Verify/Review blocker coverage and TypeScript were run successfully.

### Readiness

- Ready for Verify/Review rerun.

## Apply Final Review Fix Started

Final focused Apply repair pass started for remaining Review rerun findings. Scope is limited to repair-loop governance precedence, loopBreakerConfig API mismatch, and required OpenSpec registry/progress updates.

## Apply Final Review Fix

**Status**: ✅ Complete
**Scope**: Remaining Review rerun fixes only.

### Recovery Note

- Resumed after an interrupted final Apply pass and inspected the current source, tests, `apply-progress.md`, `state.yaml`, and `events.yaml` before editing.
- Partial source edits were present: `evaluateRepairIncident()` already had hard per-fingerprint attempt precedence above soft checkpoint checks, and the test file contained a corrupted duplicate block from the interruption. This pass repaired the corrupted test file and added the missing regression coverage required by Review.
- The existing `## Apply Final Review Fix Started` section was preserved and not duplicated.

### Fixes Completed

1. **Hard-stop precedence regression coverage** — Added a combined regression test where `attempts.count >= repairAttemptsHard` and incident lifecycle also reaches `verifyCyclesSoft`; the decision is `block` without override and `checkpoint` with explicit hard-stop override, with the summary remaining tied to the fingerprint hard limit.
2. **`loopBreakerConfig` public API mismatch** — Strengthened the custom `loopBreakerConfig` test so incident thresholds produce `continue`, while a custom loop-breaker threshold changes the decision to `repair`, proving the public override drives `checkLoopCondition()` behavior rather than only summary text.

### Files Changed

**Runtime governance tests**
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` — removed interrupted duplicate/corrupted test block and added meaningful regression coverage for hard/soft precedence and custom loop-breaker thresholds.

**OpenSpec registry/progress artifacts**
- `openspec/changes/bounded-developer-team-repair-loops/apply-progress.md` — recorded final Apply repair completion.
- `openspec/changes/bounded-developer-team-repair-loops/state.yaml` — preserved prior provenance and marked Apply completed for final Review fixes.
- `openspec/changes/bounded-developer-team-repair-loops/events.yaml` — preserved prior events and appended `apply.final_review_fixes_completed`.

### Verification Commands and Results

| Command | Result | Notes |
|---|---|---|
| `bun test --timeout 30000 packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` | Fail (path filter only) | Bun reported no matches without `./` or an absolute path in this environment; no tests ran. |
| `bun test --timeout 30000 /home/kevinlb/deck/packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` | Pass | 29 tests passed, 0 failed, 74 assertions. |
| `bun test --timeout 30000 /home/kevinlb/deck/packages/sdd-runtime/src/orchestrator` | Pass | 114 tests passed, 0 failed, 293 assertions across 9 files. |
| `bunx tsc --noEmit` | Pass | TypeScript check completed with no output/errors. |

### Serena Usage / Fallback

- Serena read tool used: `serena_get_symbols_overview` and `serena_find_symbol` inspected `evaluateRepairIncident()` and confirmed the existing partial source edit already placed per-fingerprint hard attempt checks before soft checkpoint checks.
- Serena edit tools were not used for this pass because the remaining work was test-block repair plus artifact/YAML updates, which are non-symbolic text edits. Fallback used: precise `apply_patch` edits.

### Worktree Hygiene / Unrelated Isolation Notes

- Read-only status inspection was performed after edits.
- No staging, commits, cleanup, restore, reset, or destructive git actions were run.
- Existing unrelated/noise paths remain untouched and still require Archive/commit pathspec discipline: `.opencode/skills/deck-release-publish/SKILL.md`, `.agents/`, root path `4`, and `skills-lock.json`.

### Blockers / Residual Risks

- Blockers: none.
- Residual risks: none for the remaining Review rerun fixes. Archive/commit still needs to isolate unrelated worktree noise.

### Readiness

- Ready for Verify/Review rerun.

## Apply Boundary Fix: No Deck-Owned sdd-* Commands

**Status**: ✅ Complete
**Agent**: General Apply
**Scope**: Focused boundary correction for OpenCode Developer Team install after user clarification.

### Fixes Completed

1. Stopped future Deck OpenCode Developer Team installs from generating, writing, or managing `commands/sdd-*.md` files.
2. Converted command generation into an explicit no-op boundary: `buildCommandGenerationPlan()` returns an empty plan and `applyCommandGeneration()` performs no file writes.
3. Removed active adapter-side repair-incident wording from generated command content by eliminating generated command content from the active command generation surface.
4. Updated Developer Team install tests to assert an empty `commandGenerationPlan`, no `commands/sdd-*.md` writes, and preservation of pre-existing user-owned `sdd-*` command files.
5. Kept Developer Team agents, prompt files, skills, standalone skills, language policy propagation, dynamic tool policy, and `opencode.json` config behavior intact.
6. Confirmed existing installed OpenCode command files were not deleted or touched; this pass only modified repository source, tests, and OpenSpec registry/progress artifacts.

### Files Changed

**OpenCode adapter command boundary**
- `packages/adapter-opencode/src/command-generation.ts` — replaced active `sdd-*` command generation with an explicit no-op boundary.
- `packages/adapter-opencode/src/command-generation.test.ts` — replaced legacy 14-command expectations with no-command/no-write assertions.
- `packages/adapter-opencode/src/developer-team-install.ts` — documented that the install command write path is intentionally empty and leaves user command files untouched.
- `packages/adapter-opencode/src/developer-team-install.test.ts` — updated install-plan/apply/runner-isolation assertions and added pre-existing `sdd-*` preservation coverage.

**OpenSpec registry/progress artifacts**
- `openspec/changes/bounded-developer-team-repair-loops/apply-progress.md` — recorded this boundary fix.
- `openspec/changes/bounded-developer-team-repair-loops/state.yaml` — preserved prior provenance and recorded phase `apply`, status `completed`.
- `openspec/changes/bounded-developer-team-repair-loops/events.yaml` — preserved prior events and appended `apply.boundary_fix_completed`.

### Verification Commands and Results

| Command | Result | Notes |
|---|---|---|
| `bun test ./packages/adapter-opencode/src/command-generation.test.ts` | Pass | 3 tests passed; command generation plan is empty and apply is no-op. |
| `bun test ./packages/adapter-opencode/src/developer-team-install.test.ts` | Pass | 67 tests passed; Developer Team agents/prompts/skills/config remain covered, no `sdd-*` commands or SDD skills are generated/written, and pre-existing user command files are preserved. |
| `bun test ./packages/adapter-opencode/src` | Pass | 353 tests passed across 21 files. |
| `bunx tsc --noEmit` | Pass | TypeScript check completed with no errors. |

### Serena Usage / Fallback

- Serena edit tools were not used for this pass because the change was a small adapter boundary rewrite plus test/artifact updates rather than a symbol-level refactor.
- Fallback used: precise `apply_patch` file edits and targeted test/typecheck commands.

### Installed Files

- No installed OpenCode files were deleted, modified, staged, or touched.
- Existing installed `/home/kevinlb/.config/opencode/commands/sdd-*.md` files were intentionally left outside this Apply scope.

### Blockers / Residual Risks

- Blockers: none.
- Residual risks: none for the OpenCode Developer Team install boundary. Legacy helper types remain for compatibility, but the active plan/write path emits no command files.

### Readiness

- Ready for Verify/Review rerun of the boundary fix.
