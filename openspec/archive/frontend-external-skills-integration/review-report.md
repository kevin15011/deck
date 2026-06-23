# Review Report: Frontend External Skills Integration

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general, backend, frontend, integration
**Files Reviewed**: 31 changed code/test files, generated frontend skill package paths, OpenSpec artifacts, OpenCode install validation evidence, current working tree scope, and registry context
**Verdict**: pass-with-warnings

The OpenCode install repair is technically sound. The root cause explanation matches the repaired code path: `OpenCodeRunnerAdapterImpl.buildDeveloperTeamInstallPlan()` previously forwarded only optional `input.standaloneSkills`; dashboard/TUI callers omitted that field, so the RunnerAdapter facade built Developer Team guidance without standalone external skill packages. The fix now defaults omitted `standaloneSkills` to the complete standalone external skill registry using `getStandaloneSkills()` and `getStandaloneSkill()`, while preserving explicit caller-provided overrides.

The repair fits the approved architecture. It does not introduce a second skill system, prompt, TUI checkbox, CLI flag, per-skill opt-in, manual-copy flow, or unmanaged command generation. It reuses the existing registry, generated bundle, manifest package data, and OpenCode native install plan expansion. Local installed OpenCode validation now shows all 9 frontend external skills and their support files present with source/install hash parity.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | The stale RunnerAdapter default is corrected by deriving from the complete standalone registry; no parallel loader or runner-specific registry was added. |
| Security | ✅ Strong | The repaired path continues to delegate package expansion to existing OpenCode install-plan validation for `skillId` and package paths. |
| Scalability | ✅ Strong | Registry-derived defaults scale with future standalone skills and avoid the former caller-dependent omission. |
| Maintainability | ⚠️ Adequate | The fix is localized and clear; existing legacy install/verify surfaces still warrant follow-up consolidation to reduce future drift. |
| Code Quality | ✅ Strong | The implementation is small, readable, and preserves explicit override semantics. |
| Backend | ✅ Strong | Adapter facade behavior now aligns with native OpenCode install-plan behavior and has focused regression coverage. |
| Frontend | ✅ Strong | Frontend skill routing remains conditional and compact; this repair only restores installation availability. |
| Integration | ✅ Strong | TUI/RunnerAdapter, native install, and installed filesystem outcomes now align for all 29 standalone skills. |
| Economy / Critical Judgment | ✅ Strong | Minimal repair, no new dependency, no new abstraction, and targeted test coverage for the exact stale path. |

### Economy / Critical Judgment

The repair is appropriately small: one RunnerAdapter default plus a focused test file for the omitted-`standaloneSkills` regression. The broader working tree remains large because the original change intentionally spans registry, generated bundles, prompt routing, OpenCode/Pi adapter parity, and tests. This repair does not add avoidable abstractions or duplicate the existing skill architecture.

## Findings

### BLOCKER

- None.

### MAJOR

- None.

### MINOR

- **Maintainability / Integration**: Legacy Developer Team install/verify surfaces remain a drift risk even though this repair fixed the current OpenCode RunnerAdapter path.
  - **File**: `packages/adapter-opencode/src/runner-adapter.ts`; related prior warning in `packages/adapter-pi/src/runner-capabilities.ts`.
  - **Evidence**: The bug existed because one facade path defaulted omitted standalone skills differently from newer launch/capability paths. The repair now uses the complete registry by default, but the prior Pi warning also showed package-aware behavior had to be repaired in a separate surface.
  - **Recommendation**: Follow up by consolidating Developer Team install-plan construction behind a single package-aware helper per runner, or add cross-surface parity tests that compare native, RunnerAdapter, launch, and capability defaults.

- **Maintainability**: The current `opencode-install-validation.md` remains a pre-repair failed validation artifact.
  - **File**: `openspec/changes/frontend-external-skills-integration/opencode-install-validation.md`.
  - **Evidence**: The artifact records `Outcome: failed` and `Frontend skills present: 0 / 9`, while `apply-progress.md` and direct review validation now show all 9 installed with hash parity after repair.
  - **Recommendation**: If the Orchestrator needs a canonical post-repair validation artifact before Archive, rerun Verify/install-validation so the validation artifact reflects the repaired installed filesystem state. This is not a code-quality blocker because the repair evidence is present and independently rechecked during Review.

### NIT

- None.

## Design Fidelity

- **Aligned**: Yes.
- **Aligned areas**:
  - Defaults derive from the complete standalone external skill registry instead of a caller-maintained list.
  - Explicit `input.standaloneSkills` remains honored, preserving backward-compatible override behavior.
  - The repaired RunnerAdapter path delegates to `buildOpenCodeDeveloperTeamInstallPlan()`, which already expands complete packages into `SKILL.md` plus support files.
  - Silent install behavior is preserved: no prompts, flags, checkboxes, per-skill opt-ins, or unmanaged command files were introduced.
  - No frontend skill source content, generated bundle content, or role guidance was unnecessarily rewritten during this repair.
- **Deviations**: None blocking. The stale pre-repair install-validation artifact should be refreshed by Verify if a post-repair canonical validation artifact is required.

## Root Cause Assessment

- **Assessment**: Correct.
- **Evidence**:
  - `packages/adapter-opencode/src/runner-adapter.ts:651-654` now computes `standaloneSkills = input.standaloneSkills ?? getStandaloneSkills().map(...)`, proving the repaired default targets the omitted-input case.
  - `packages/adapter-opencode/src/runner-adapter.ts:656-663` forwards that resolved package list into `buildOpenCodeDeveloperTeamInstallPlan()`.
  - `packages/adapter-opencode/src/runner-adapter.test.ts:19-55` calls `buildDeveloperTeamInstallPlan()` without `standaloneSkills` and asserts every frontend skill ID plus representative support files are present in standalone-skill files.
  - `apply-progress.md:293-304` documents the stale RunnerAdapter path and records a bounded source install with `standaloneSkillCount=29`, `standaloneFileCount=46`, and all 9 frontend skill IDs present.

## Prompt Bloat and Silent Installation Assessment

- No prompt, TUI checkbox, CLI flag, per-skill opt-in, or manual copy instruction was added.
- No unmanaged command generation was introduced; existing no-op command-generation expectations remain covered by tests.
- The repair does not affect role prompt routing or make heavy frontend skills daily defaults.

## Test Coverage Assessment

- The new RunnerAdapter regression test is meaningful because it exercises the exact omitted-`input.standaloneSkills` case that failed in the dashboard/TUI path.
- The test asserts all 9 frontend skill IDs are present and checks representative support files for `web-quality-audit`, `playwright-cli`, and `design-lab`.
- Existing OpenCode install-plan tests cover all 29 standalone skills, package expansion, support-file writes, path-safety rejection, verify/backup behavior, and absence of unmanaged command generation.
- Review reran the focused OpenCode adapter test command successfully: `bun test ./packages/adapter-opencode/src/runner-adapter.test.ts ./packages/adapter-opencode/src/developer-team-install.test.ts ./packages/adapter-opencode/src/runner-capabilities.test.ts --timeout 30000`.

## Working Tree Scope Assessment

- Current working tree scope is acceptable for this OpenSpec change after the prior user-requested commit.
- `git status --short` no longer shows `.opencode`, `.agents`, `skills-lock.json`, or command-file changes.
- Remaining changed/untracked paths are attributable to the OpenSpec change: core standalone skill registry/bundle, frontend skill package folders, Developer Team role guidance/tests, OpenCode/Pi adapter code/tests, launch forwarding, generator, and OpenSpec artifacts.

## Verification Evidence

- Read OpenSpec artifacts: `spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, `opencode-install-validation.md`, `state.yaml`, and `events.yaml`.
- Inspected `packages/adapter-opencode/src/runner-adapter.ts` and `packages/adapter-opencode/src/runner-adapter.test.ts`.
- Inspected OpenCode install-plan tests and relevant package-expansion/path-safety coverage in `packages/adapter-opencode/src/developer-team-install.test.ts`.
- Ran focused OpenCode adapter tests: pass.
- Performed direct installed-filesystem validation for `/home/kevinlb/.config/opencode/skills/<skillId>/` against `packages/core/src/skills/external/<skillId>/`: all 9 frontend skills passed complete file count and SHA-256 content parity.
- Captured registry hashes before report update for deferred-mode safety: `state.yaml` SHA-256 `167026203665e1262bee211d533dbb44fbdbafa1710ce87f22ac314c57fcd0f6`; `events.yaml` SHA-256 `05aeba030ba83e23aa7740eb985f7f5f9bbff64deeef5eaa958bd7465bc17607`.

## Open Questions

- None.
