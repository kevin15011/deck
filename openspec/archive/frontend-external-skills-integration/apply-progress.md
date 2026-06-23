# Apply Progress: Frontend External Skills Integration

## Completed Tasks

### Task 1: Register the 9 frontend skills in `STANDALONE_SKILLS`
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/skills/external/index.ts` — modified to add the 9 requested frontend skill IDs.

**Verification**
- Tests: pass — targeted external skill tests assert 29 total skills, uniqueness, and accessor resolution for all 9 new IDs.
- Build: skipped — broad binary build deferred to later full verification slice.
- Typecheck: pass — `bunx tsc --noEmit`.

**Notes**
- Public accessor signatures `getStandaloneSkill()` and `getStandaloneSkillBody()` were preserved.

### Task 2: Make the bundle generator derive its skill list from the canonical registry
**Status**: ✅ Complete

**Files Changed**
- `scripts/generate-skill-bundle.ts` — modified to derive `CANONICAL_SKILLS` from `STANDALONE_SKILLS`.

**Verification**
- Tests: pass — generated keys are protected by registry/bundle tests.
- Generator: pass — `bun scripts/generate-skill-bundle.ts` exits 0 and fails loudly for missing directories or missing `SKILL.md` through existing error handling.

**Notes**
- Existing recursive walk, system-artifact exclusions, POSIX path normalization, and `SKILL.md` package split were preserved.

### Task 3: Regenerate `content.generated.ts` for all 29 complete packages
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/skills/external/content.generated.ts` — regenerated deterministically by the generator.
- `.gitignore` — modified to unignore this required checked-in generated artifact while leaving other `*.generated.ts` files ignored.

**Verification**
- Generator: pass — regenerated all 29 standalone skill bundles.
- Integrity check: pass — bundle summary reports 29 skills, all 9 frontend IDs, representative support files, and no system artifacts.
- Idempotence: pass — rerunning the generator produced the same SHA-256 hash.

**Notes**
- The generated bundle includes support files for `frontend-design`, `web-quality-audit`, `design-lab`, and `playwright-cli`.

### Task 4: Update `packages/core/src/skills/external/index.test.ts` for count and new skill resolution
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/skills/external/index.test.ts` — updated expected count and added exact new-ID accessor assertions.

**Verification**
- Tests: pass — targeted external skill tests.

### Task 5: Add bundle/package completeness assertions for multi-file skills
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/skills/external/__tests__/content.test.ts` — added representative support-file assertions, single-file empty-map assertions, no-system-artifact coverage, and idempotence coverage.

**Verification**
- Tests: pass — targeted content bundle tests.

### Task 6: Generator determinism and integrity check
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/skills/external/__tests__/content.test.ts` — added generator idempotence test.

**Verification**
- Tests: pass — idempotence test runs the generator twice and confirms `content.generated.ts` remains unchanged.
- Manual check: pass — SHA-256 hash unchanged after generator rerun.

### Task 7: Extend core manifest to emit `{ skillId, body, files }`
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/teams/developer/manifest.ts` — now emits complete standalone packages with `files`.
- `packages/core/src/teams/developer/manifest.test.ts` — asserts 29 standalone skills, complete package fields, support files, and `{}` for a single-file skill.

**Verification**
- Tests: pass — targeted manifest tests.
- Typecheck: pass — `bunx tsc --noEmit`.

### Task 8: Extend runner-neutral install contract types to carry support files
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/runner-capability.ts` — added optional `files` to `DeveloperTeamManifestStandaloneSkill` and optional metadata to `DeveloperTeamInstallFile`.
- `packages/core/src/runner-adapter.ts` — added optional `files` to `DeveloperTeamAdapterInstallInput.standaloneSkills`.

**Verification**
- Typecheck: pass — existing body-only shapes remain valid because new fields are optional.

### Task 9: Update direct launch/install entry points to pass complete packages
**Status**: ✅ Complete

**Files Changed**
- `apps/cli/src/opencode-launch-command.ts` — forwards `{ skillId, body, files }` into the OpenCode install plan.
- `apps/cli/src/pi-launch-command.ts` — forwards `{ skillId, body, files }` into the Pi launch install refresh path when it builds a Developer Team install plan.

**Verification**
- Typecheck: pass — `bunx tsc --noEmit`.
- Tests: pass — targeted core tests; adapter-specific package expansion remains for later Tasks 10-15.


### Task 10: Update OpenCode native install to expand full packages
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/developer-team-install.ts` — modified to expand standalone packages into `SKILL.md` plus support files, validate safe skill IDs and relative POSIX package paths, create nested directories, verify exact support-file content, and include standalone package files in backup/rollback coverage.

**Verification**
- Tests: pass — targeted OpenCode adapter tests assert all 29 standalone skills, representative support files, unsafe path rejection, silent nested-file apply, verify failure on stale support files, and backup coverage.
- Typecheck: pass — `bunx tsc --noEmit`.

**Notes**
- Existing single-file standalone behavior remains valid because missing `files` is treated as an empty package map.

### Task 11: Update OpenCode adapter bridge and capability facade
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/runner-adapter.ts` — modified generic install files to carry standalone-skill metadata including `skillId` and `packagePath`.
- `packages/adapter-opencode/src/runner-capabilities.ts` — modified capability install, apply, and backup paths to preserve package metadata/files and replace hardcoded standalone-skill classification with metadata plus Developer Team skill-ID derived classification.

**Verification**
- Tests: pass — OpenCode runner capability tests assert all 29 standalone skill IDs flow through the capability install plan and support files are preserved.
- Typecheck: pass — `bunx tsc --noEmit`.

**Notes**
- No unmanaged OpenCode command files are generated by standalone skill installation.

### Task 12: OpenCode adapter parity and silent-install tests
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/developer-team-install.test.ts` — added full-package native plan/apply/verify/backup/path-safety/no-command coverage.
- `packages/adapter-opencode/src/runner-capabilities.test.ts` — added capability-path parity and package metadata assertions.

**Verification**
- Tests: pass — `bun test ./packages/adapter-opencode/src/developer-team-install.test.ts ./packages/adapter-opencode/src/runner-capabilities.test.ts ./packages/adapter-pi/src/developer-team-install.test.ts ./packages/adapter-pi/src/runner-capabilities.test.ts` (189 tests, 1130 assertions).
- Typecheck: pass — `bunx tsc --noEmit`.

### Task 13: Update Pi native install to expand full packages
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-pi/src/developer-team-install.ts` — modified native Pi plans to expand standalone packages into `SKILL.md` plus support files, validate safe skill IDs and relative POSIX package paths, create nested directories, verify exact support-file content, and include standalone package files in backup/rollback coverage.

**Verification**
- Tests: pass — targeted Pi adapter tests assert all 29 standalone skills, representative support files, unsafe path rejection, silent nested-file apply, verify failure on stale support files, and backup coverage.
- Typecheck: pass — `bunx tsc --noEmit`.

**Notes**
- Project-native plans write under `.pi/skills/<skillId>/...`; capability apply paths preserve Pi's existing `~/.pi/agent/skills/<skillId>/...` semantics.

### Task 14: Update Pi adapter bridge and capability facade
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-pi/src/runner-adapter.ts` — modified the class bridge to preserve package metadata and apply captured native plans through the `~/.pi/agent` path.
- `packages/adapter-pi/src/runner-capabilities.ts` — modified capability install, apply, and backup paths to preserve package metadata/files and replace hardcoded standalone-skill classification with metadata plus Developer Team skill-ID derived classification.

**Verification**
- Tests: pass — Pi runner capability tests assert all 29 standalone skill IDs flow through the capability install plan and support files are preserved.
- Typecheck: pass — `bunx tsc --noEmit`.

**Notes**
- No unmanaged command files, including SDD command files, are emitted by Pi standalone skill installation.

### Task 15: Pi adapter parity and silent-install tests
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-pi/src/developer-team-install.test.ts` — added full-package native plan/apply/verify/backup/path-safety coverage.
- `packages/adapter-pi/src/runner-capabilities.test.ts` — added capability-path parity and package metadata assertions.

**Verification**
- Tests: pass — `bun test ./packages/adapter-opencode/src/developer-team-install.test.ts ./packages/adapter-opencode/src/runner-capabilities.test.ts ./packages/adapter-pi/src/developer-team-install.test.ts ./packages/adapter-pi/src/runner-capabilities.test.ts` (189 tests, 1130 assertions).
- Typecheck: pass — `bunx tsc --noEmit`.

### Task 16: Add role-aware conditional frontend skill guidance to role content files
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/teams/developer/apply-frontend-content.ts` — added compact day-to-day UI routing guidance for `ui-skills-root`, focused UI skills, and browser QA.
- `packages/core/src/teams/developer/review-content.ts` — added UI review/audit guidance with `web-quality-audit` scoped to audit, predeploy, or broad quality review.
- `packages/core/src/teams/developer/verify-content.ts` — added UI verification/audit guidance with `web-quality-audit` scoped to audit, predeploy, or broad quality review.
- `packages/core/src/teams/developer/explorer-content.ts` — added conditional UI exploration guidance for `ui-skills-root`, `frontend-design`, and `design-lab` only for substantial redesign exploration.
- `packages/core/src/teams/developer/design-content.ts` — added conditional UI design guidance for `ui-skills-root`, `frontend-design`, and `design-lab` only for substantial redesign exploration.
- `packages/core/src/teams/developer/orchestrator-content.ts` — added compact UI routing guidance to system, agent, and skill content without weakening SDD gates.
- `packages/core/src/teams/developer/task-content.ts` — added conditional UI task-routing guidance with heavy/audit skills scoped to redesign or audit/predeploy work.
- `packages/core/src/teams/developer/proposal-content.ts` — added planning-only UI routing guidance.
- `packages/core/src/teams/developer/spec-content.ts` — added planning-only UI requirements guidance.

**Verification**
- Tests: pass — `bun test packages/core/src/teams/developer/frontend-external-skill-routing.test.ts --timeout 30000`.
- Prompt tests: pass — `bun test packages/core/src/teams/developer --timeout 30000`.
- Typecheck: pass — `bunx tsc --noEmit`.

**Notes**
- `ui-skills-root` is positioned as the UI router; downstream UI skills are not loaded unconditionally.
- `design-lab` remains substantial-redesign/exploration scoped and is absent from routine frontend Apply guidance.
- `web-quality-audit` remains audit/predeploy/broad-review scoped and is absent from routine frontend Apply guidance.

### Task 17: Update Developer Team prompt tests for routing presence and absence
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/teams/developer/frontend-external-skill-routing.test.ts` — added prompt coverage for affected roles, UI router guidance, heavy/audit scope boundaries, and absence of frontend-skill bloat in backend/general/archive roles.

**Verification**
- Tests: pass — `bun test packages/core/src/teams/developer/frontend-external-skill-routing.test.ts --timeout 30000` (6 tests, 121 assertions).
- Prompt suite: pass — `bun test packages/core/src/teams/developer --timeout 30000` (1065 tests, 3653 assertions).

**Notes**
- TDD evidence: the new routing test failed before content changes and passed after the role guidance updates.
- `no-op-skill-absence.test.ts` did not require modification because the 9 frontend skills are not part of the no-op catalog.

### Task 18: Run targeted tests, generator idempotence, typecheck, and full Bun test suite
**Status**: ✅ Complete

**Files Changed**
- Verification-only task; no source files changed specifically for Task 18.

**Verification**
- Targeted tests: pass — `bun test packages/core/src/skills/external packages/core/src/teams/developer packages/adapter-opencode/src packages/adapter-pi/src --timeout 30000` (1859 tests, 7252 assertions).
- Generator idempotence: pass — ran `bun scripts/generate-skill-bundle.ts` twice and confirmed unchanged SHA-256 `ec2e576efb6ed45c636a21ebd4f08739fd2802749e562481470b90e5f32806da`.
- Typecheck: pass — `bunx tsc --noEmit`.
- Canonical typecheck command: unavailable — `bun run typecheck` failed with `Script not found "typecheck"`; canonical project check is `bunx tsc --noEmit`.
- Full Bun suite: ran — `bun test --timeout 30000` completed with 3273 pass / 3 fail across 167 files. The failures are in `scripts/prepare-release.test.ts` and are caused by stale `build-info.generated.ts` commit metadata (`a8d4a90` vs current HEAD `7f2a044ecef91c7c3d0eeeed1bb79d01c5bbdcd8`), not by this role-guidance slice.

**Notes**
- No regressions attributable to Tasks 16-18 were observed in targeted prompt/content, adapter, external skill, generator, or typecheck verification.

## In-Progress Tasks

None in this slice.

## Blocked Tasks

None.

## Remaining Tasks

None.

## Verification Summary

- `bun test ./packages/adapter-opencode/src/developer-team-install.test.ts ./packages/adapter-opencode/src/runner-capabilities.test.ts ./packages/adapter-pi/src/developer-team-install.test.ts ./packages/adapter-pi/src/runner-capabilities.test.ts` — pass, 189 tests, 1130 assertions.
- `bunx tsc --noEmit` — pass.
- `bun test ./packages/core/src/skills/external/index.test.ts ./packages/core/src/skills/external/__tests__/content.test.ts ./packages/core/src/teams/developer/manifest.test.ts` — pass, 59 tests, 711 assertions.
- `bunx tsc --noEmit` — pass.
- `bun scripts/generate-skill-bundle.ts` — pass.
- Generator SHA-256 idempotence check — pass, unchanged hash `ec2e576efb6ed45c636a21ebd4f08739fd2802749e562481470b90e5f32806da`.
- `bun test packages/core/src/teams/developer/frontend-external-skill-routing.test.ts --timeout 30000` — pass, 6 tests, 121 assertions.
- `bun test packages/core/src/teams/developer --timeout 30000` — pass, 1065 tests, 3653 assertions.
- `bun test packages/core/src/skills/external packages/core/src/teams/developer packages/adapter-opencode/src packages/adapter-pi/src --timeout 30000` — pass, 1859 tests, 7252 assertions.
- `bunx tsc --noEmit` — pass.
- `bun test --timeout 30000` — ran, 3273 pass / 3 fail; failures are in `scripts/prepare-release.test.ts` due to stale `build-info.generated.ts` commit metadata, not attributable to this change.

## Repair Retry 1: Pi capability verify/backup standalone support-file parity

**Status**: ✅ Complete for the authorized repair scope

**Scope**
- Fixed only the Review blocker requiring Pi runner-capability verify and backup to cover standalone skill support files written under `~/.pi/agent/skills/<skillId>/...` by capability apply.
- Did not touch unrelated working tree changes under `.opencode`, `.agents`, or `skills-lock.json`.

**Files Changed**
- `packages/adapter-pi/src/runner-capabilities.ts` — modified capability verify/backup to reconstruct the same `~/.pi/agent` absolute install paths used by capability apply and include standalone package `skillResults`.
- `packages/adapter-pi/src/runner-capabilities.test.ts` — added focused regression tests proving capability verify fails on stale `~/.pi/agent/skills/web-quality-audit/scripts/analyze.sh` content and backup reads that support file from the real Pi capability install path.

**Verification**
- TDD red check: `bun test packages/adapter-pi/src/runner-capabilities.test.ts --timeout 30000` initially failed on the new verify/backup assertions.
- Focused test: pass — `bun test packages/adapter-pi/src/runner-capabilities.test.ts --timeout 30000` (19 pass / 0 fail).
- Affected Pi suite: pass — `bun test packages/adapter-pi/src/developer-team-install.test.ts packages/adapter-pi/src/runner-capabilities.test.ts --timeout 30000` (94 pass / 0 fail).
- Broader Pi adapter suite: pass — `bun test packages/adapter-pi/src --timeout 30000` (411 pass / 0 fail).
- Typecheck: pass — `bunx tsc --noEmit`.

**Notes**
- The repair preserves silent installation behavior: no prompt, flag, checkbox, or per-skill opt-in was added.
- Path-safety remains delegated to the existing Pi install-plan package path validation; this repair only remaps verified/backed-up package entries to the already-approved Pi capability destination root.
- Remaining Review blocker outside this authorized repair scope: unrelated local skill file changes in `.opencode`, `.agents`, and `skills-lock.json`.


## Install Repair Retry 1: OpenCode standalone frontend external skills

**Status**: ✅ Complete for the authorized install-repair scope

**Root Cause**
- The OpenCode TUI/RunnerAdapter install path built the Developer Team plan from `OpenCodeRunnerAdapterImpl.buildDeveloperTeamInstallPlan()` and forwarded only `input.standaloneSkills`. The dashboard caller does not pass standalone skills, so the adapter produced a plan with Developer Team agent skills/prompts but zero standalone external skills.
- The newer OpenCode launch and runner-capability paths already derive standalone skills from the complete core registry with `getStandaloneSkills()` + `getStandaloneSkill()`; the RunnerAdapter facade was the stale divergent path. Existing non-frontend external skills were present from earlier installations, while the 9 newly registered frontend skills had never been installed through the stale RunnerAdapter path.

**Files Changed**
- `packages/adapter-opencode/src/runner-adapter.ts` — modified the RunnerAdapter install plan to default to the complete standalone registry when callers do not provide `standaloneSkills`, while preserving explicit caller-provided overrides.
- `packages/adapter-opencode/src/runner-adapter.test.ts` — added focused regression coverage proving the OpenCode RunnerAdapter plan includes all standalone external skills by default, including the 9 frontend skills and representative support files.

**Installation Command / Path Run**
- Ran a bounded source installer through `createOpenCodeRunnerAdapter().buildDeveloperTeamInstallPlan()` + `backupDeveloperTeamFiles()` + `applyDeveloperTeamInstall()` + `verifyDeveloperTeamInstall()` against `/home/kevinlb/.config/opencode`.
- Result: pass; changedCount=26, unchangedCount=49, standaloneSkillCount=29, standaloneFileCount=46, all 9 frontend skill IDs present.

**Installed OpenCode Validation**
- `ui-skills-root`: pass, SKILL.md 1448 bytes, 1/1 files installed, hash parity pass.
- `frontend-design`: pass, SKILL.md 8260 bytes, 2/2 files installed, hash parity pass.
- `baseline-ui`: pass, SKILL.md 3419 bytes, 1/1 files installed, hash parity pass.
- `fixing-accessibility`: pass, SKILL.md 4718 bytes, 1/1 files installed, hash parity pass.
- `fixing-motion-performance`: pass, SKILL.md 5565 bytes, 1/1 files installed, hash parity pass.
- `fixing-metadata`: pass, SKILL.md 4439 bytes, 1/1 files installed, hash parity pass.
- `web-quality-audit`: pass, SKILL.md 7426 bytes, 2/2 files installed, hash parity pass.
- `playwright-cli`: pass, SKILL.md 11869 bytes, 11/11 files installed, hash parity pass.
- `design-lab`: pass, SKILL.md 30182 bytes, 2/2 files installed, hash parity pass.

**Support-File Validation**
- `frontend-design/LICENSE.txt`: installed, source/install hash parity pass.
- `web-quality-audit/scripts/analyze.sh`: installed, source/install hash parity pass.
- `playwright-cli/references/*.md`: all 10 reference files installed, source/install hash parity pass.
- `design-lab/DESIGN_PRINCIPLES.md`: installed, source/install hash parity pass.

**Verification**
- Focused OpenCode adapter tests: pass — `bun test packages/adapter-opencode/src/runner-adapter.test.ts packages/adapter-opencode/src/developer-team-install.test.ts packages/adapter-opencode/src/runner-capabilities.test.ts --timeout 30000` (exit 0).
- Typecheck: pass — `bunx tsc --noEmit` (exit 0).
- Local installed filesystem validation: pass — all 9 frontend external skills exist under `/home/kevinlb/.config/opencode/skills/<skillId>/` with non-empty `SKILL.md` and complete support-file parity.

**Notes**
- No prompts, flags, checkboxes, per-skill opt-ins, unmanaged command generation, or `sdd-*` command writes were added.
- Generated-file classification: `packages/core/src/skills/external/content.generated.ts` was not touched in this repair. The new test is not generated; the OpenCode installed skill files are managed runtime install outputs under the user OpenCode config directory.

## Code Economy Self-Check

- Simpler existing path considered: Yes — reused the existing standalone registry, generated bundle, manifest, and runner-neutral contract patterns.
- New dependency/abstraction added: No.
- Advisory budget exceeded: Yes — the overall change and this adapter slice touched more than 4 files because Tasks 1-15 intentionally span registry, generator, generated content, tests, manifest, contracts, direct launch entry points, and supported runner adapters.
- Quality override used: Yes — tests and generated artifact tracking were necessary to satisfy package completeness and determinism requirements.
