# Apply Progress: Deck as Installer Runner-Agnostic

## Summary

All 26 tasks completed. Runner-specific paths and config references replaced with runner-agnostic phrasing across 36 files (12 `.opencode/skills`, 12 `.pi/skills`, 12 prompts).

## Completed Tasks

### Skills Cleanup (Tasks 1–12)

| Task | Skill | Status |
|------|-------|--------|
| 1 | deck-developer-orchestrator | ✅ Complete |
| 2 | deck-developer-explorer | ✅ Complete |
| 3 | deck-developer-proposal | ✅ Complete |
| 4 | deck-developer-spec | ✅ Complete |
| 5 | deck-developer-design | ✅ Complete |
| 6 | deck-developer-task | ✅ Complete |
| 7 | deck-developer-apply-backend | ✅ Complete |
| 8 | deck-developer-apply-frontend | ✅ Complete |
| 9 | deck-developer-apply-general | ✅ Complete |
| 10 | deck-developer-verify | ✅ Complete |
| 11 | deck-developer-review | ✅ Complete |
| 12 | deck-developer-archive | ✅ Complete |

**Changes applied:**
- P1: `/home/kevinlb/deck/` → `~/.config/opencode/` (skill file path references)
- P2: `.deck/config.json` → `the runner's native package instruction system`
- P3: `adaptiveMemory.activeProvider` → `the configured memory provider`

### Prompts Cleanup (Tasks 13–24)

| Task | Prompt | Status |
|------|---------|--------|
| 13 | deck-developer-orchestrator | ✅ Complete |
| 14 | deck-developer-explorer | ✅ Complete |
| 15 | deck-developer-proposal | ✅ Complete |
| 16 | deck-developer-spec | ✅ Complete |
| 17 | deck-developer-design | ✅ Complete |
| 18 | deck-developer-task | ✅ Complete |
| 19 | deck-developer-apply-backend | ✅ Complete |
| 20 | deck-developer-apply-frontend | ✅ Complete |
| 21 | deck-developer-apply-general | ✅ Complete |
| 22 | deck-developer-verify | ✅ Complete |
| 23 | deck-developer-review | ✅ Complete |
| 24 | deck-developer-archive | ✅ Complete |

**Changes applied:**
- P1: `/home/kevinlb/deck/` → `~/.config/opencode/` (skill file path references)
- P2: `.deck/config.json` → `the runner's native package instruction system`
- P3: `adaptiveMemory.activeProvider` → `the configured memory provider`

### Sync & Verification (Tasks 25–26)

| Task | Description | Status |
|------|-------------|--------|
| 25 | Sync `.pi/skills` from `.opencode/skills` | ✅ Complete |
| 26 | Verify zero patterns across all 36 files | ✅ Complete |

## Verification Results

**Grep-zero verification:** PASS — zero matches for all 3 forbidden patterns across all 36 files

**Diff .pi sync:** PASS — all 12 `.opencode/skills` ↔ `.pi/skills` pairs are byte-identical

**Directory count:** 12 skill directories confirmed under `.opencode/skills/deck-developer-*`

## Files Changed

### `.opencode/skills/` (12 files)
- `deck-developer-orchestrator/SKILL.md`
- `deck-developer-explorer/SKILL.md`
- `deck-developer-proposal/SKILL.md`
- `deck-developer-spec/SKILL.md`
- `deck-developer-design/SKILL.md`
- `deck-developer-task/SKILL.md`
- `deck-developer-apply-backend/SKILL.md`
- `deck-developer-apply-frontend/SKILL.md`
- `deck-developer-apply-general/SKILL.md`
- `deck-developer-verify/SKILL.md`
- `deck-developer-review/SKILL.md`
- `deck-developer-archive/SKILL.md`

### `.pi/skills/` (12 files — copied from `.opencode/skills/`)
- Same 12 skill directories, byte-identical content

### Prompts (~/.config/opencode/prompts/deck-developer/) (12 files)
- All 12 prompt files updated with runner-agnostic phrasing

## Additional Fixes Applied (Core Source + Adapter Install Paths)

After initial SDD apply phase, discovered that core TS source files were NOT cleaned — only materialized artifacts were. Regeneration would have reintroduced deck-specific references. Additional fixes applied directly:

### Core TS Source Files Fixed

| File | Changes |
|------|---------|
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | P2/P3: `.deck/config.json` → `runner's configured memory system`, `adaptiveMemory.activeProvider` → `configured memory provider` (all 3 fragment surfaces) |
| `packages/core/src/teams/developer/instruction-bundles/index.ts` | P2: `.deck/config.json` → `runner's native package instruction system` in composeCapabilityInstructions |
| `packages/core/src/teams/developer/orchestrator-content.ts` | Same P2/P3 patterns removed |
| `packages/adapter-opencode/src/prompt-generation.ts` | `join(projectRoot, ".opencode", "skills", ...)` → `join(configDir, "skills", ...)` |

### Tests Updated

| File | Change |
|------|--------|
| `packages/core/src/teams/developer/instruction-bundles/bundle-parity.test.ts` | Baseline hashes refreshed for adaptive-memory (agent/session/skill) |
| `packages/core/src/teams/developer/instruction-bundles/index.test.ts` | `.deck/config.json` assertion → `runner's native package instruction system` |
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.test.ts` | Same P2/P3 wording updates |
| `packages/adapter-opencode/src/prompt-generation.test.ts` | Path assertions updated: `.opencode/skills/` removed, new test for runner-stable paths |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | Test name + assertion updated for `configDir/skills/` |
| `packages/adapter-pi/src/developer-team-install.test.ts` | `.deck/config.json` assertion → `runner' |

### Adapter Install Paths Fixed

| Adapter | Before (WRONG) | After (CORRECT) |
|--------|---------------|-----------------|
| OpenCode `developer-team-install.ts` | `skillsDir = join(projectRoot, ".opencode", "skills")` | `skillsDir = join(configDir, "skills")` |
| OpenCode `runner-capabilities.ts` `applyTeamInstall` | hardcoded `projectRoot/.opencode/skills` | `join(configDir, "skills")` |
| OpenCode `runner-capabilities.ts` `applyTeamInstallFromPlan` | hardcoded `projectRoot/.opencode/skills` | `join(configDir, "skills")` |
| Pi `runner-capabilities.ts` `applyTeamInstall` | hardcoded `projectRoot/.pi/skills` | `join(homeDir, ".pi", "agent", "skills")` |
| Pi `runner-capabilities.ts` `applyTeamInstallFromPlan` | hardcoded `projectRoot/.pi/skills` | `join(homeDir, ".pi", "agent", "skills")` |

### Architecture Alignment (gentle-ai reference model)

gentle-ai writes embedded skills via `adapter.SkillsDir(homeDir)` → `~/.config/opencode/skills/`. Deck now does the same via `configDir` parameter. Key insight from gentle-ai:
- Adapter knows its own config dir layout (no projectRoot coupling)
- Skills go to runner config, not installer project
- Plans pass `files: [{path, content}]` — runner resolves actual paths

## Notes

- P2/P3 contextual replacements applied with sentence-level judgment (not blind find-replace)
- Orchestrator skill had duplicate Supermemory/Engram sections (two complete Adaptive Memory blocks) — both updated
- Skill file path references in prompts updated from `/home/kevinlb/deck/.opencode/skills/` to `~/.config/opencode/skills/`
- Task 25 created `.pi/skills/` directory structure and synced all 12 skills
- **Critical**: Original SDD Apply only cleaned materialized artifacts (`.opencode/skills/`, prompts). Core TS source was NOT cleaned. User insisted on fixing canonical source. This means deck now correctly generates runner-agnostic content from source, not just cleaning output.