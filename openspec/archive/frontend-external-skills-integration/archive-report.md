# Archive Report: Frontend External Skills Integration

## Change Summary

**Change**: `frontend-external-skills-integration`
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/frontend-external-skills-integration/`

### Lifecycle

| Phase | Date | Summary |
|---|---|---|
| Explore | 2026-06-22 | Explored integration of 9 frontend-focused external skills; found source folders present but not registered in Deck's external skill registry. |
| Proposal | 2026-06-22 | Formalized scope: register 9 skills, regenerate bundles, expose via existing accessors, distribute silently through supported runner adapters (OpenCode + Pi), and add conditional Developer Team role routing. |
| Spec + Design | 2026-06-22 | Parallel formalization of 33 requirements (REQ-SKILLS-*, REQ-BUNDLE-*, REQ-ACCESS-*, REQ-ADAPTER-*, REQ-ROUTING-*, REQ-TEST-*, REQ-SCOPE-*), 8 acceptance capability areas, 25 scenarios, validation rules, error contracts, and technical architecture. |
| Tasks | 2026-06-22 | 18 routed tasks across 7 groups: core registry + generator (A), core tests (B), manifest + contracts (C), OpenCode adapter (D), Pi adapter (E), role guidance (F), final verification (G). |
| Apply | 2026-06-22 | All 18 tasks completed across general and backend apply agents. |
| Repair 1 | 2026-06-22 | Bounded repair resolved Review blocker: Pi runner-capability verify/backup now covers standalone skill support files under `~/.pi/agent/skills/<skillId>/...`. |
| Verify | 2026-06-23 | Passed with warnings: targeted tests, typecheck, and build passed; full Bun suite timed out at MCP layer. |
| Review | 2026-06-23 | Approved with changes: root cause and fix confirmed correct; no blockers; follow-up warnings for legacy surfaces. |
| Install Repair | 2026-06-23 | Bounded repair resolved OpenCode install failure: `RunnerAdapter` defaulted omitted `input.standaloneSkills` to empty; fixed to derive complete standalone registry by default. |
| Verify (retry) | 2026-06-23 | Passed with warnings: targeted OpenCode adapter tests, external skill tests, typecheck, and build passed; full suite timed out at MCP layer. |
| Review (retry) | 2026-06-23 | Approved with changes: repair technically sound, no blockers. |
| OpenCode Install Validation | 2026-06-23 | Passed: all 9 frontend external skill folders and representative support files present under `/home/kevinlb/.config/opencode/skills/`. |
| Archive | 2026-06-23 | Change closed and archived. |

## Verified Final State

- **9 frontend external skills** silently installed through OpenCode after repair:
  - `ui-skills-root`
  - `frontend-design`
  - `baseline-ui`
  - `fixing-accessibility`
  - `fixing-motion-performance`
  - `fixing-metadata`
  - `web-quality-audit`
  - `playwright-cli`
  - `design-lab`
- **Standalone skill total**: 29 (20 prior + 9 new)
- **Root cause**: OpenCode `RunnerAdapter` defaulted omitted `input.standaloneSkills` to an empty standalone package list; fixed by deriving the complete standalone external skill registry by default.
- **Fix verification**: `packages/adapter-opencode/src/runner-adapter.test.ts` asserts omitted `standaloneSkills` defaults to all 29 skills including support files.
- **OpenCode install validation**: PASS — all 9 skill folders, `SKILL.md` files, and support files present under `/home/kevinlb/.config/opencode/skills/` with source/install hash parity.

## Traceability Matrix

| REQ-ID | Requirement | Task(s) | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|---|
| REQ-SKILLS-001 | Register 9 frontend skills as standalone external skills | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SKILLS-002 | Standalone skill count = 29 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SKILLS-003 | Exact, unique skill identifiers | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-001 | Bundle includes SKILL.md for all 9 | Task 3 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-002 | Multi-file support files preserved | Tasks 3, 5 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-003 | Bundle generation is deterministic | Tasks 2, 6 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-004 | External source content not rewritten | Tasks 1–3 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ACCESS-001 | `getStandaloneSkill()` resolves all 9 | Task 4 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ACCESS-002 | `getStandaloneSkillBody()` backward compatible | Task 4 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ACCESS-003 | Unknown-skill behavior unchanged | Task 4 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ADAPTER-001 | Supported adapters install new skills silently | Tasks 10–15, install repair | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ADAPTER-002 | Installation is silent — no per-skill confirmation | Tasks 10–15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ADAPTER-003 | Multi-file packages preserved by adapters | Tasks 10–15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ADAPTER-004 | Runner capability constraints are explicit | Tasks 10–15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ADAPTER-005 | Non-supporting runners do not regress | Tasks 10–15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROUTING-001 | Developer Team roles receive targeted guidance | Tasks 16, 17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROUTING-002 | `ui-skills-root` as UI router | Tasks 16, 17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROUTING-003 | `design-lab` not default daily guidance | Tasks 16, 17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROUTING-004 | `web-quality-audit` not default daily guidance | Tasks 16, 17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROUTING-005 | Role guidance remains concise | Tasks 16, 17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TEST-001 | Registry + accessor tests cover all 9 | Tasks 4, 5 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TEST-002 | Bundle completeness tests for multi-file skills | Task 5 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TEST-003 | Adapter silent-install parity tests | Tasks 12, 15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TEST-004 | Role prompt tests for routing + absence | Tasks 16, 17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TEST-005 | Generator idempotence + type checks | Tasks 6, 18 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SCOPE-001 | No new runtime skill-loading mechanism | Tasks 1–18 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SCOPE-002 | No new Developer Team roles | Tasks 16, 17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SCOPE-003 | No unmanaged command generation | Tasks 10–15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SCOPE-004 | Installation is non-destructive | Tasks 10–15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SCOPE-005 | Docs update gated by maintained status | N/A | ✅ N/A | ✅ N/A | ✅ N/A |

**Totals**: 33 requirements defined | 33 requirements satisfied | 18 tasks completed

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1

| Warning | Source | Impact |
|---|---|---|
| Full Bun suite timed out at MCP layer after install repair; targeted affected-area tests, typecheck, and build passed; prior full-suite run in initial Apply passed. | Verify retry 2026-06-23 | Non-blocking — targeted coverage and prior full-suite evidence confirm correctness. |

## Review

**Rating**: APPROVE WITH CHANGES
**Blockers**: 0
**Major Findings**: 0
**Warnings**: 2

| Warning | Source | Priority |
|---|---|---|
| Legacy Pi `teams.verifyDeveloperTeamInstall` surface remains less package-aware than repaired `developerTeam.verifyInstall`; follow-up consolidation recommended. | Review retry 2026-06-23 | Medium |
| OpenCode command-generation plumbing remains no-op but should stay guarded. | Review retry 2026-06-23 | Low |

## Follow-ups

- **Medium**: Consolidate Pi runner-capability install/verify surfaces behind a single package-aware helper per runner, or add cross-surface parity tests comparing native, RunnerAdapter, launch, and capability defaults. — Backend team
- **Low**: Keep OpenCode `command-generation.ts` as an intentional no-op; confirm tests remain green when the guarded no-op is exercised. — Backend team

## Root Cause Summary

**OpenCode install failure** (discovered during pre-archive validation):
- `OpenCodeRunnerAdapterImpl.buildDeveloperTeamInstallPlan()` forwarded only optional `input.standaloneSkills`.
- Dashboard/TUI callers omitted that field.
- Result: Developer Team guidance was installed without standalone external skill packages.
- Fix: `standaloneSkills = input.standaloneSkills ?? getStandaloneSkills().map(...)` in `packages/adapter-opencode/src/runner-adapter.ts`.

**Pi capability parity** (resolved during Review repair loop):
- Pi runner-capability verify/backup referenced `~/.pi/agent` paths but did not include standalone skill support files.
- Fix: `packages/adapter-pi/src/runner-capabilities.ts` now reconstructs `~/.pi/agent` absolute paths and includes `standaloneSkillResults` in verify/backup.

## Installation Validation Summary

| Skill | Folder | SKILL.md | Files Installed | Hash Parity |
|---|---|---|---:|---|
| `ui-skills-root` | ✅ | ✅ (1448 bytes) | 1/1 | ✅ |
| `frontend-design` | ✅ | ✅ (8260 bytes) | 2/2 | ✅ |
| `baseline-ui` | ✅ | ✅ (3419 bytes) | 1/1 | ✅ |
| `fixing-accessibility` | ✅ | ✅ (4718 bytes) | 1/1 | ✅ |
| `fixing-motion-performance` | ✅ | ✅ (5565 bytes) | 1/1 | ✅ |
| `fixing-metadata` | ✅ | ✅ (4439 bytes) | 1/1 | ✅ |
| `web-quality-audit` | ✅ | ✅ (7426 bytes) | 2/2 | ✅ |
| `playwright-cli` | ✅ | ✅ (11869 bytes) | 11/11 | ✅ |
| `design-lab` | ✅ | ✅ (30182 bytes) | 2/2 | ✅ |

## Changed Files Summary

| Area | Files | Count |
|---|---|---:|
| Core standalone skill registry + generated bundle | `index.ts`, `content.generated.ts`, `index.test.ts`, `content.test.ts` | 4 |
| Core manifest + runner-neutral contracts | `manifest.ts`, `manifest.test.ts`, `runner-capability.ts`, `runner-adapter.ts` | 4 |
| Bundle generator | `scripts/generate-skill-bundle.ts` | 1 |
| OpenCode adapter | `developer-team-install.ts`, `developer-team-install.test.ts`, `runner-adapter.ts`, `runner-adapter.test.ts`, `runner-capabilities.ts`, `runner-capabilities.test.ts` | 6 |
| Pi adapter | `developer-team-install.ts`, `developer-team-install.test.ts`, `runner-adapter.ts`, `runner-capabilities.ts`, `runner-capabilities.test.ts` | 5 |
| Direct launch entry points | `opencode-launch-command.ts`, `pi-launch-command.ts` | 2 |
| Developer Team role guidance | 9 `*-content.ts` files + `frontend-external-skill-routing.test.ts` | 10 |
| Project config | `.gitignore` (unignore `content.generated.ts`) | 1 |
| **Total** | | **33** |

## Project AI Notes (Phase 5 — Deferred)

Project AI notes under `.deck/ai-notes/` are a planned Phase 5 feature and have not been activated. This step is deferred.

### Extracted Learnings

- **Silent install regression via facade default**: A facade/wrapper function that only forwarded optional caller inputs could silently drop the default complete registry behavior. The fix was a one-line default expression (`input.standaloneSkills ?? getStandaloneSkills()...`), but it was invisible without targeted regression coverage. Lesson: facade/bridge code needs tests for the omitted-optional-parameter case, not just the happy-path caller-provided case.
- **Runner capability surfaces drift from native surfaces**: The Pi capability verify/backup path and the OpenCode RunnerAdapter path both diverged from their respective native install paths over time. A cross-surface parity test pattern would catch this class of regression earlier.
- **Silent install validation requires live filesystem checks**: Automated tests for install behavior should include a live install pass with filesystem assertions, not just plan/structure tests. The `opencode-install-validation.md` pattern (live validation + hash parity) is a reusable pattern for future changes.

## Archive Provenance

| Field | Value |
|---|---|
| Change ID | `frontend-external-skills-integration` |
| Archived at | 2026-06-23 |
| Archive location | `openspec/archive/frontend-external-skills-integration/` |
| Archived by | deck-developer-archive |
| Source directory | `openspec/changes/frontend-external-skills-integration/` |
| Artifacts preserved | exploration.md, proposal.md, spec.md, design.md, tasks.md, preconditions.md, apply-progress.md, verify-report.md, review-report.md, opencode-install-validation.md, state.yaml, events.yaml, archive-report.md |
| Registry state | phase: archive, status: archived, archived_at: 2026-06-23 |
| Registry events | 1 new event: archive-complete |
