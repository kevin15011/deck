# Review Report: Bounded Developer Team Repair Loops Boundary Rerun

## Summary

**Overall Rating**: APPROVE WITH CHANGES  
**Verdict**: PASS WITH WARNINGS  
**Scope**: general, integration  
**Mode**: registry-deferred  
**Files Reviewed**: 14

This boundary rerun reviewed the focused OpenCode install correction after the user clarification that Deck must not own, install, generate, write, or manage OpenCode commands named `sdd-*`, including `sdd-apply`, `sdd-verify`, and `sdd-continue`. The implementation now makes adapter command generation an explicit no-op, preserves Developer Team skill/prompt installation, and keeps repair-loop governance in Developer Team content rather than in generated `sdd-*` commands.

Registry updates are intentionally deferred. This Review pass wrote only this `review-report.md` artifact and did not edit `state.yaml` or `events.yaml`.

## Boundary Review

- **PASS** — No active Deck-owned OpenCode `sdd-*` command generation remains in `packages/adapter-opencode/src/command-generation.ts`; `buildCommandGenerationPlan()` returns `[]` and `applyCommandGeneration()` is an explicit no-op.
- **PASS** — The active OpenCode Developer Team install plan now carries an empty `commandGenerationPlan`, and the install tests assert no `sdd-apply.md`, `sdd-verify.md`, or `sdd-continue.md` files are produced.
- **PASS** — Pre-existing user-owned `sdd-*` command files are not deleted or overwritten; tests preserve an existing `commands/sdd-apply.md` file through install.
- **PASS** — Developer Team subagents, skills, prompt files, standalone allowed skills, language policy propagation, dynamic tool policy, and `opencode.json` config behavior remain in the install path.
- **PASS** — SDD command/skill surfaces are not installed as Deck OpenCode artifacts; catalog entries remain `deck-developer-*`, `deck-init`, and `deck-onboard`, and install tests reject `sdd-*` skills.
- **PASS** — Repair-loop guidance remains in Developer Team content/tests for Orchestrator, Verify, Apply, and Task agents, rather than in generated `sdd-*` command content.
- **PASS WITH WARNING** — The apply-layer command write loop remains generic and would write any command entries manually inserted into `plan.commandGenerationPlan`. The active generated plan is empty, so current product behavior is acceptable; a follow-up should harden this layer by removing the loop or delegating to the no-op `applyCommandGeneration()`.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | The ownership boundary is now centralized in `command-generation.ts`; Developer Team installation remains scoped to agents, skills, prompts, and config. |
| Security | ✅ Strong | No new untrusted input or secret handling risk was introduced; standalone skill IDs retain path-traversal validation. |
| Scalability | ✅ Strong | The no-op command path removes unnecessary file generation work and does not add runtime cost. |
| Maintainability | ⚠️ Adequate | The boundary is readable, but the install apply function still contains a generic command write loop and an unused `applyCommandGeneration` import. |
| Code Quality | ⚠️ Adequate | The fix is simple and localized; minor cleanup would reduce ambiguity around the command boundary. |
| Backend | N/A | No backend service/API/database scope. |
| Frontend | N/A | No frontend UI scope. |
| Integration | ✅ Strong | Adapter/core separation and Developer Team content integration remain coherent. |
| Economy / Critical Judgment | ✅ Strong | The boundary fix deletes complexity by making command generation a no-op and avoids new dependencies or abstractions. |

## Findings

### BLOCKER

None.

### MAJOR

None.

### MINOR

- **Maintainability**: The install apply layer still contains a generic command-file write loop, so the no-`sdd-*` boundary is enforced by plan generation rather than by both generation and application.
  - **File**: `packages/adapter-opencode/src/developer-team-install.ts` — lines 700-716
  - **Evidence**: The comment says command generation is intentionally empty, but the loop still writes every entry in `plan.commandGenerationPlan` if a caller supplies one.
  - **Recommendation**: In a follow-up cleanup, remove this loop or replace it with `applyCommandGeneration(plan.commandGenerationPlan, ...)`, whose implementation is an explicit no-op. Add a regression test with a synthetic non-empty command plan to prove the apply layer never writes `commands/sdd-*.md`.

### NIT

- **Code Quality**: `applyCommandGeneration` is imported into `developer-team-install.ts` but is not used by the active install path.
  - **File**: `packages/adapter-opencode/src/developer-team-install.ts` — line 68
  - **Recommendation**: Either remove the unused import or use it to make the apply-layer command boundary explicit.

## Evidence Paths

- `openspec/changes/bounded-developer-team-repair-loops/spec.md` — official requirements context.
- `openspec/changes/bounded-developer-team-repair-loops/design.md` — design context for bounded repair-loop governance and adapter boundary.
- `openspec/changes/bounded-developer-team-repair-loops/tasks.md` — boundary clarification and Task 10 no-`sdd-*` command-generation scope.
- `openspec/changes/bounded-developer-team-repair-loops/apply-progress.md` — boundary fix record, including no-op command generation and pre-existing command preservation.
- `openspec/changes/bounded-developer-team-repair-loops/verify-report.md` — prior/current Verify context, PASS WITH WARNINGS at time of review.
- `packages/adapter-opencode/src/command-generation.ts` — explicit no-op command generation boundary.
- `packages/adapter-opencode/src/command-generation.test.ts` — tests for empty generation and no-op application.
- `packages/adapter-opencode/src/developer-team-install.ts` — active Developer Team install plan/apply path.
- `packages/adapter-opencode/src/developer-team-install.test.ts` — tests for no `sdd-*` command output, user-owned command preservation, non-`sdd-*` skills, and install behavior.
- `packages/adapter-opencode/src/runner-adapter.ts` — active runner adapter uses the native generated install plan.
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — repair-loop governance remains in Developer Team Orchestrator content.
- `packages/core/src/teams/developer/verify-content.test.ts` — staged repair verification content coverage.
- `packages/core/src/teams/developer/apply-general-content.test.ts` — repair incident Apply behavior coverage.
- `packages/core/src/teams/developer/task-content.test.ts` — repair replan guidance coverage.

## Test Evidence Reviewed

Review reran the focused adapter tests:

| Command | Result |
|---|---:|
| `bun test --timeout 30000 packages/adapter-opencode/src/command-generation.test.ts` | PASS — 3 pass, 0 fail |
| `bun test --timeout 30000 packages/adapter-opencode/src/developer-team-install.test.ts` | PASS — 67 pass, 0 fail |

## Design Fidelity

Does the implementation match the Design and repaired Task artifacts?

- **Aligned**: Yes.
- **Deviations**:
  - The original adapter command-handoff concept was superseded by the user's boundary clarification. The repaired tasks and apply-progress now correctly state that Deck does not own or generate OpenCode `sdd-*` commands, and repair guidance belongs in Developer Team content/skills.
  - The remaining apply-layer command loop is a defensive-hardening gap, not an active behavior deviation because generated plans are now empty.

## Required Fixes

None for this Review rerun.

## Residual Risks / Follow-ups

- Harden the apply layer so even a synthetic, stale, or manually constructed non-empty `commandGenerationPlan` cannot write `sdd-*` command files through `applyOpenCodeDeveloperTeamInstall()`.
- Archive/commit preparation should isolate unrelated worktree noise reported by Verify and current read-only status inspection, including `.opencode/skills/deck-release-publish/SKILL.md`, `.agents/`, root path `4`, and `skills-lock.json`.
- Existing user-owned OpenCode `sdd-*` command files remain outside Deck ownership; any cleanup should remain manual or separately authorized.

## Open Questions

None.

## Registry Deferred Intent

Registry write is deferred to the Orchestrator.

| Field | Intended Value |
|---|---|
| phase | `review` |
| status | `completed` |
| event | `review.completed` |
| artifact | `review-report.md` |

## Next Phase Readiness

Ready for Archive with warnings. The boundary correction is acceptable for the active Developer Team install path, and no Review-required fixes remain. Archive should preserve the boundary decision and use strict pathspec hygiene to avoid unrelated worktree noise.
