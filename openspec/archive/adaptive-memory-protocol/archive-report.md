# Archive Report: Adaptive Memory Protocol

## Change Summary

**Change**: adaptive-memory-protocol
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/adaptive-memory-protocol/`

### Lifecycle
- **Proposal**: 2026-05-21 — Provider-agnostic adaptive memory protocol, stale routing file cleanup, project-level auto-scoping from git
- **Spec + Design (v1)**: 2026-05-22 — Initial versions (AGENTS.md injection model)
- **Exploration**: 2026-05-21 — Investigated package instruction system, determined Package Instruction model is correct approach
- **Spec + Design (v2)**: 2026-05-22 — Rewritten for Package Instruction model
- **Tasks (v2)**: 2026-05-22 — 8 tasks across 5 groups (Contracts, Registration, Tests, Cleanup, Verification)
- **Apply**: 2026-05-22 — All 8 tasks implemented
- **Apply-fix**: 2026-05-22 — Fixed 4 test failures from incomplete test updates
- **Verify**: 2026-05-22 — 143 tests pass, 0 failures, TypeScript compiles cleanly
- **Review**: 2026-05-22 — NEEDS_FIX for spec-level routing concern, but all implementation dimensions PASS
- **Archive**: 2026-05-22 — archived

## Files Changed

### Created
| File | Lines | Purpose |
|---|---|---|
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | 119 | Provider-agnostic behavioral memory protocol bundle |
| `packages/core/src/utils/git.ts` | 64 | Git remote URL → project name extraction utility |
| `packages/core/src/utils/git.test.ts` | ~80 | Tests for URL parsing (SSH, HTTPS, local paths, edge cases) |

### Modified
| File | Change Type | Purpose |
|---|---|---|
| `packages/core/src/teams/developer/instruction-bundles/index.ts` | Registry update | Added adaptive-memory package, removed context-mode/rtk |
| `packages/core/src/config/deck-config.ts` | Schema update | Updated PACKAGE_INSTRUCTION_PACKAGE_IDS, defaults |
| `apps/cli/src/tui/pi-runner-dashboard/state.ts` | TUI update | Updated CANONICAL_INSTRUCTION_PACKAGE_IDS |
| `.deck/config.json` | Config update | Added projectId="deck", enabled adaptive-memory package |
| `packages/core/src/teams/developer/instruction-bundles/index.test.ts` | Test update | Replaced stale package IDs with adaptive-memory |
| `packages/core/src/config/deck-config.test.ts` | Test update | Replaced stale package IDs with adaptive-memory |
| `apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts` | Test fix | Fixed assertion for manualSteps vs automaticInstalls |
| `apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts` | Test fix | Fixed cursor index for pi-hud position |
| `packages/core/src/teams/developer/manifest.test.ts` | Test fix | Changed "Context Mode" to "Adaptive Memory" in assertion |
| `packages/core/src/teams/developer/content-registry.test.ts` | Test fix | Changed "Context Mode" to "Adaptive Memory" in assertion |

### Deleted
| File | Reason |
|---|---|
| `packages/core/src/teams/developer/instruction-bundles/context-mode.ts` | Stale bundle replaced by unified adaptive-memory |
| `packages/core/src/teams/developer/instruction-bundles/rtk.ts` | Stale bundle replaced by unified adaptive-memory |
| `~/.config/opencode/instructions/codebase-memory-routing.md` | Stale routing file (external, not in repo) |
| `~/.config/opencode/instructions/context-mode-routing.md` | Stale routing file (external, not in repo) |
| `~/.config/opencode/instructions/rtk-routing.md` | Stale routing file (external, not in repo) |

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-BUNDLE-001 | Task 1 | ✅ buildAdaptiveMemoryInstructionBundle() created | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-002 | Task 1 | ✅ 2 fragments (agent, skill) | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-003 | Task 1 | ✅ 7 proactive save triggers documented | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-004 | Task 1 | ✅ What/Why/Where/Learned format | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-005 | Task 1 | ✅ Reactive + proactive search triggers | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-006 | Task 1 | ✅ Session-close summary format | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-007 | Task 1 | ✅ Authority rule documented | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-008 | Task 1 | ✅ Fail-open rule documented | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-009 | Task 1 | ✅ Zero provider names in markdown | ✅ PASS | ✅ Strong |
| REQ-BUNDLE-010 | Task 1 | ✅ Topic keys guidance included | ✅ PASS | ✅ Adequate |
| REQ-BUNDLE-011 | Task 1 | ✅ Session limit of 7 documented | ✅ PASS | ✅ Adequate |
| REQ-BUNDLE-012 | Task 1 | ✅ Scope hierarchy documented | ✅ PASS | ✅ Adequate |
| REQ-ROUTE-001 | Design | ✅ Existing MemoryInjectionBundle handles routing | ✅ PASS | ⚠️ Architecture decision |
| REQ-ROUTE-002 | Design | ✅ Routing generated from activeProvider config | ✅ PASS | ⚠️ Architecture decision |
| REQ-ROUTE-003 | Design | ✅ Protocol active when provider is "none" | ✅ PASS | ⚠️ Architecture decision |
| REQ-ROUTE-004 | Design | ⚠️ Routing in MemoryInjectionBundle, not package instruction | ⚠️ Spec gap | ⚠️ Needs spec clarification |
| REQ-REG-001 | Task 3 | ✅ CapabilityInstructionPackageId updated | ✅ PASS | ✅ Strong |
| REQ-REG-002 | Task 3 | ✅ PACKAGE_BUILDERS["adaptive-memory"] registered | ✅ PASS | ✅ Strong |
| REQ-REG-003 | Task 3 | ✅ PACKAGE_ORDER: codebase-memory → adaptive-memory | ✅ PASS | ✅ Strong |
| REQ-REG-004 | Task 4 | ✅ PACKAGE_INSTRUCTION_PACKAGE_IDS updated | ✅ PASS | ✅ Strong |
| REQ-REG-005 | Task 5 | ✅ CLI TUI CANONICAL_INSTRUCTION_PACKAGE_IDS updated | ✅ PASS | ✅ Strong |
| REQ-REG-006 | Task 4 | ✅ Defaults include adaptive-memory: false | ✅ PASS | ✅ Strong |
| REQ-SCOPE-001 | Task 7 | ✅ projectId="deck" in config | ✅ PASS | ✅ Strong |
| REQ-SCOPE-002 | Task 2 | ✅ SSH/HTTPS/local path parsing supported | ✅ PASS | ✅ Strong |
| REQ-SCOPE-003 | Task 2 | ✅ Fallback to directory basename | ✅ PASS | ✅ Strong |
| REQ-SCOPE-004 | Task 2 | ✅ getProjectFallbackName() function | ✅ PASS | ✅ Strong |
| REQ-SCOPE-005 | Task 7 | ✅ projectId passed to provider tags | ✅ PASS | ✅ Adequate |
| REQ-SCOPE-006 | Task 7 | ✅ Manual override supported in config | ✅ PASS | ✅ Adequate |
| REQ-CLEANUP-001 | Task 3 | ✅ context-mode.ts and rtk.ts deleted | ✅ PASS | ✅ Strong |
| REQ-CLEANUP-002 | Task 3 | ✅ Imports removed from index.ts | ✅ PASS | ✅ Strong |
| REQ-CLEANUP-003 | Tasks 3,4,5 | ✅ All stale IDs removed from constants | ✅ PASS | ✅ Strong |
| REQ-CLEANUP-004 | Task 3 | ✅ Type union exactly 2 values | ✅ PASS | ✅ Strong |
| REQ-CLEANUP-005 | Task 8 | ✅ Zero stale references in source | ✅ PASS | ✅ Strong |
| REQ-COMPAT-001 | Task 8 | ✅ Skill language compatible | ✅ PASS | ✅ Strong |
| REQ-COMPAT-002 | Task 1 | ✅ Authority rule consistent with renderer | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS
**Critical Findings**: 0
**Warnings**: 0

- 143 tests pass, 0 failures
- TypeScript compiles cleanly (`bun run tsc --noEmit`)
- No stale references remain in source code
- Config validates correctly
- Protocol markdown contains zero provider-specific names

## Review

**Rating**: NEEDS_FIX (spec-level concern, implementation is correct)
**Blockers**: 0 (implementation blockers)
**Major Findings**: 1

### Review Findings Summary

| Dimension | Status | Notes |
|---|---|---|
| Architecture | ✅ PASS | Bundle pattern correct; provider routing delegated to MemoryInjectionBundle |
| Security | ✅ PASS | No secrets; config validation robust |
| Maintainability | ✅ PASS | Clean code; comprehensive tests; clear separation |
| Scalability | ✅ PASS | URL parsing covers all formats; type system strict |
| Spec Alignment | ⚠️ NEEDS_FIX | REQ-ROUTE-004 routing documentation in package instruction not satisfied; routing handled by MemoryInjectionBundle |

The review identified a spec-level gap: REQ-ROUTE-004 requires routing information documenting scope tags in the package instruction bundle, but the chosen architecture delegates routing to the existing `MemoryInjectionBundle` pipeline. This is a sound architectural decision but creates a spec-implementation gap. The spec should be updated to clarify that routing is handled by the MemoryInjectionBundle, not the package instruction bundle.

## Key Decisions Made

1. **Protocol delivery via Package Instruction bundle** — The adaptive-memory protocol is a `CapabilityInstructionBundle`, not an AGENTS.md edit. This follows Deck's existing package instruction pattern.

2. **Provider routing via MemoryInjectionBundle pipeline** — The behavioral protocol (WHEN to save/search) lives in the package instruction bundle. Provider routing (HOW/WHICH tool) lives in the existing `MemoryInjectionBundle` pipeline via `adapter-supermemory` and `adapter-engram`. This separation of concerns is correct but not fully documented in the spec.

3. **Zero-argument builder function** — Consistent with existing pattern; no config parameters at bundle-build time.

4. **projectId auto-detection cached in config** — Git remote parsing runs at install time, not every session. Manual override supported via config field.

5. **Immediate stale bundle deletion** — No deprecation period; clean removal is safer given no external consumers.

6. **projectId stored in supermemory config block** — Schema already had this field; moving to top-level would be breaking with no benefit.

## Known Issues / Follow-ups

1. **REQ-ROUTE-004 spec clarification needed** — The spec states routing information must document scope tags in the package instruction. The implementation delegates routing to `MemoryInjectionBundle`. Recommend: update spec to align with architecture.

2. **Config migration for stale package IDs** — Users with `context-mode: true` or `rtk: true` in existing configs will get `DECK_CONFIG_UNKNOWN_FIELD` validation error. Recommend: add migration step in installer to auto-strip unknown package keys, or document this as manual cleanup required.

3. **Context-mode/RTK behavioral instruction disposition** — The spec's open question #5 asks what happened to behavioral instructions from deleted bundles. The design states they were redundant, but this should be explicitly documented in the spec for clarity.

### Priority Classification

| Priority | Follow-up | Suggested Owner |
|---|---|---|
| Medium | Update spec REQ-ROUTE-004 to clarify routing in MemoryInjectionBundle | Spec agent |
| Low | Add config migration for stale package keys in installer | Installer agent |
| Low | Document context-mode/RTK behavioral instruction disposition | Spec agent |

## Diff Context for Git Commit

### Conventional Commit Type
`feat` — new package instruction capability added

### Scope
- `instruction-bundles` — core capability system
- `deck-config` — schema updates
- `cli-tui` — dashboard package IDs

### Key Changes (Suggested Commit Message)

```
feat(instruction-bundles): add adaptive-memory package instruction

- Create provider-agnostic behavioral memory protocol bundle
- Add git.ts utility for projectId auto-detection from remote URLs
- Register adaptive-memory package, remove stale context-mode/rtk
- Update config schema with new package ID and projectId field
- Update CLI TUI with canonical package IDs
- Fix 4 test failures from incomplete stale package ID updates

Protocol defines when agents save/search/summarize memories,
including save triggers, format (What/Why/Where/Learned),
session summaries, topic keys, scope hierarchy, authority rule,
and fail-open behavior. Provider routing handled separately by
MemoryInjectionBundle pipeline.
```

### Ambiguity Notes
The change includes cleanup (deleting stale bundles) which could warrant `refactor` scope, but the primary intent is adding a new capability, so `feat` is appropriate. The commit could alternatively be `feat(instruction-bundles,deck-config)` with multiple scopes.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

1. **Package Instruction pattern is canonical for behavioral protocols** — Deck uses `CapabilityInstructionBundle` for behavioral guidance injected into agent/skill/session files. AGENTS.md is not the injection mechanism; the bundle/composition pipeline handles delivery.

2. **Two parallel injection systems exist** — Package Instructions (config-toggled, behavioral rules) and Adaptive Memory (provider-built, tool bindings + session context) coexist. Routing concerns belong to Adaptive Memory; behavioral concerns belong to Package Instructions.

3. **Type union updates require cascading test fixture changes** — When `CapabilityInstructionPackageId` changes, all test fixtures referencing stale IDs must be updated mechanically. Missing updates cause failures in unrelated test files (manifest, content-registry, reducer, input-handler).

4. **Git remote parsing supports SSH, HTTPS, file://, and local paths** — The regex-based extraction handles all common formats with graceful fallback to directory basename. Query params and fragments are stripped; `.git` suffix removed; trailing slashes cleaned.

---

## Archive Metadata

**Archived by**: deck-developer-archive
**Archive timestamp**: 2026-05-22T05:00:00Z
**Model**: glm-5
**Source artifacts preserved**: proposal, spec, design, tasks, exploration, verify-report, review-report