# Review Report: Deck as Installer Runner-Agnostic

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general
**Files Reviewed**: 36 materialized + 5 canonical source

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Clean separation between canonical source and materialized artifacts. Three-replacement pattern (P1/P2/P3) is simple and sufficient. |
| Security | ✅ Strong | No secrets exposed. Removing absolute paths eliminates filesystem path leakage. |
| Scalability | ✅ Strong | Negligible impact; same file count and size. |
| Maintainability | ⚠️ Adequate | Materialized artifacts are clean, but canonical TS source in `packages/` was not updated. Next regeneration will regress. `.deck/ai-notes/` references remain. |
| Code Quality | ✅ Strong | Replacements are grammatical and readable. No logic changes. |
| Backend | N/A | — |
| Frontend | N/A | — |
| Integration | ✅ Strong | OpenCode and Pi skill copies are byte-identical. |

## Findings

### MAJOR
- **Maintainability**: `.deck/ai-notes/` references remain in materialized artifacts
  - **File**: `.opencode/skills/deck-developer-archive/SKILL.md:164`, `.opencode/skills/deck-developer-orchestrator/SKILL.md:194` (and corresponding `.pi/` and prompt copies)
  - **Evidence**: `grep -rn '\.deck/ai-notes'` returns 7 matches across skills and prompts
  - **Recommendation**: Replace with generic language (e.g., "a planned Phase 5 feature for shared, repo-owned knowledge") or remove entirely since the feature is deferred and the directory will not exist on runners. The spec validation rules require zero `.deck/` occurrences broadly, not just `.deck/config.json`.

- **Maintainability**: Canonical TypeScript source not cleaned
  - **File**: `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`, `packages/core/src/teams/developer/instruction-bundles/index.ts`, `packages/core/src/teams/developer/orchestrator-content.ts`, `packages/adapter-opencode/src/prompt-generation.ts`, `packages/adapter-opencode/src/developer-team-install.ts`
  - **Evidence**: `grep -rn '\.deck/config.json\|adaptiveMemory.activeProvider\|\.deck/ai-notes' packages/core/src/teams/developer/ packages/adapter-opencode/src/` returns 20+ matches in canonical source
  - **Recommendation**: Schedule a follow-up change to clean canonical source and add a regeneration step to CI so materialized artifacts are always derived from canonical source. This prevents silent regression on next install/regeneration.

### MINOR
- **Maintainability**: Semantic confusion in adaptive memory replacement
  - **File**: All skills and prompts containing the adaptive memory header
  - **Evidence**: "Adaptive memory is configured via the runner's native package instruction system. The configured memory provider injects its tool instructions into agent prompts."
  - **Recommendation**: The first sentence conflates two distinct concepts (adaptive memory config vs package instruction toggles). It should read "Adaptive memory is configured via the configured memory provider." per REQ-RA-006 intent.

### NIT
- **Maintainability**: Prompt skill paths use OpenCode-specific `~/.config/opencode/...`
  - **File**: `~/.config/opencode/prompts/deck-developer/*.md`
  - **Recommendation**: Acceptable — Pi runner is explicitly out of scope per proposal. A future Pi-specific install should generate Pi-native paths.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  1. Canonical source files listed in the design's "File Impact Estimate" table (`packages/core/src/teams/developer/instruction-bundles/*.ts`, `packages/adapter-opencode/src/prompt-generation.ts`, `packages/adapter-opencode/src/developer-team-install.ts`) were not modified. The design anticipated cleaning both canonical source and materialized artifacts.
  2. This deviation is documented in `tasks.md` Open Questions as "allowed-with-stub" and is justified because materialized cleanup is independently valuable. However, it introduces regression risk.

## Open Questions

- How will the installer ensure `.deck/ai-notes/` references are handled when Phase 5 is implemented? Will the installer create this directory, or will the feature be redesigned to use runner-agnostic locations?
- What is the timeline for cleaning the canonical TS source to prevent regression?

