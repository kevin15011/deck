# Archive Report: Adaptive Memory Adapter with Engram Injection

## Change Summary

**Change**: adaptive-memory-adapter-engram
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/adaptive-memory-adapter-engram/`

### Lifecycle
- **Exploration**: 2026-05-18 — Investigated provider-neutral adaptive memory injection with Engram as first adapter; recommended Option 1 (generic contract + Engram provider package) with Option 4 (Spec Registry sync) as later extension.
- **Proposal**: 2026-05-18 — Defined scope: injectable memory guidance, Engram outside core, removal of Engram placeholders from core prompts.
- **Spec + Design**: 2026-05-19 — 8 requirements across 5 capabilities; design introduced `AdaptiveMemoryProvider` interface, `composeAdaptiveMemory` compositor, separate Engram adapter package.
- **Tasks**: 2026-05-19 — 8 tasks created across Shared (3) and Backend (5) groups.
- **Apply**: 2026-05-19 — 8/8 tasks completed across General and Backend Apply; two fix rounds addressed Verify failures and Review change requests.
- **Verify**: 2026-05-19 — PASS WITH WARNINGS (638/638 tests passed; typecheck passed; warning: no build script).
- **Review**: 2026-05-19 — APPROVE. All MAJOR findings resolved in fix rounds.
- **Archive**: 2026-05-19 — Archived with traceability report.

## Traceability Matrix

| REQ-ID | Task(s) | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-AMI-001 | Task 1, 2 | ✅ Core types/compositor produce no injection when no provider selected | ✅ PASS | ✅ Strong |
| REQ-AMI-002 | Task 1, 4, 6, 8 | ✅ Explicit provider selection injects only that provider's fragments/bindings; fix rounds guaranteed materialization and preserved Pi model/thinking | ✅ PASS | ✅ Strong |
| REQ-AMI-003 | Task 1, 6, 7, 8 | ✅ Centralized `resolveMemoryInjection` validates provider IDs; unsupported providers fail closed with `unsupported_memory_provider` diagnostic | ✅ PASS | ⚠️ Adequate |
| REQ-ENG-001 | Task 4 | ✅ `@deck/adapter-engram` package implements `AdaptiveMemoryProvider`; only injected when explicitly selected | ✅ PASS | ✅ Strong |
| REQ-ENG-002 | Task 4, 5 | ✅ Engram fragments state memory is auxiliary and OpenSpec/Spec Registry remains authoritative; safety guidance prohibits secrets/PII | ✅ PASS | ✅ Strong |
| REQ-DTC-001 | Task 3 | ✅ All Engram names/placeholders removed from core prompts; fix round 2 removed Engram provider ID from non-test core entirely | ✅ PASS | ✅ Strong |
| REQ-DRM-001 | Task 1, 6, 7 | ✅ Compositor only activates when provider selected; Pi materialization preserves non-memory behavior including model/thinking config | ✅ PASS | ✅ Strong |
| REQ-OSA-001 | Spec-level (architectural) | ✅ Guidance across all surfaces reiterates OpenSpec authority; no memory path replaces artifact requirements | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1 — Build verification could not be performed because no project build script exists (`bun run build` reports `Script not found "build"`). Tests and TypeScript typecheck pass.

### Test Results
- Full test suite: 634 automated + 4 manual compliance = 638 pass / 0 fail
- Typecheck: `bunx tsc --noEmit` — pass
- Core provider-neutrality: `grep -RIn --exclude='*.test.ts' --exclude='*.spec.ts' -i 'engram' packages/core/src` — 0 matches
- Unsupported provider probe: unknown provider → `unsupported_memory_provider` diagnostic, no content injection
- Pi memory preservation: existing model/thinking assignments preserved across `--memory=engram` rematerialization
- Engram safety/aliases: tools only `memory_search`, `memory_read`, `memory_write`; safety text prohibits secrets, API keys, credentials, tokens, PII

### Compliance Summary
| REQ-ID | Result |
|---|---|
| REQ-AMI-001 | ✅ PASS |
| REQ-AMI-002 | ✅ PASS |
| REQ-AMI-003 | ✅ PASS |
| REQ-ENG-001 | ✅ PASS |
| REQ-ENG-002 | ✅ PASS |
| REQ-DTC-001 | ✅ PASS |
| REQ-DRM-001 | ✅ PASS |
| REQ-OSA-001 | ✅ PASS |

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0
**Minor Findings**: 0

### Review Dimensions
| Dimension | Rating |
|---|---|
| Architecture | ✅ Strong |
| Security | ⚠️ Adequate |
| Scalability | ⚠️ Adequate |
| Maintainability | ⚠️ Adequate |
| Code Quality | ✅ Strong |
| Backend | ✅ Strong |
| Integration | ✅ Strong |

### NIT (noted, not blocking)
- Provider allowlist constants are repeated across adapter/CLI surfaces (acceptable for single-provider scope; consider shared provider registry when second provider introduced).

## Follow-ups

- **Medium**: Validate actual Engram MCP tool names (`memory_search`, `memory_read`, `memory_write`) against the Engram runtime. If confirmed correct, remove the experimental warning from provider `displayName`, fragment headings, and CLI warning. If names differ, update `@deck/adapter-engram` tool bindings accordingly. — Owner: Backend Apply (or runtime validation owner)
- **Low**: Build script absence is a project-level concern, not specific to this change. A root `build` script could be added in a separate change to enable CI build verification.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Provider-neutral core architecture**: The `AdaptiveMemoryProvider` interface + caller-injected provider allowlists pattern enables memory provider extensibility without coupling core to any specific provider. Provider IDs and allowlist constants live in adapter/CLI surfaces, not in core.
- **Fix round cadence**: This change demonstrated the value of fix rounds: initial apply → verify fail → review changes requested → fix → re-verify → re-review → approve. The pattern caught core-hardcoded Engram provider ID and launch-time model/thinking overwriting before final approval.
- **MCP tool name isolation**: Engram MCP tools are prefixed `memory_*` (`memory_search`, `memory_read`, `memory_write`) to avoid collision with built-in runtime tools like `read`, `write`, `search`. This naming convention should be considered for future memory providers.
- **Experimental gating**: Unvalidated runtime contracts (Engram MCP names) were clearly marked experimental in display name, fragments, CLI help, and runtime warnings. This pattern allows shipping provider infrastructure before final contract validation.

## Artifacts

| Artifact | Path |
|---|---|
| Archive Report | `openspec/changes/adaptive-memory-adapter-engram/archive-report.md` |
| State | `openspec/archive/adaptive-memory-adapter-engram/state.yaml` |
| Events | `openspec/archive/adaptive-memory-adapter-engram/events.yaml` |
| Exploration | `openspec/archive/adaptive-memory-adapter-engram/exploration.md` |
| Proposal | `openspec/archive/adaptive-memory-adapter-engram/proposal.md` |
| Spec | `openspec/archive/adaptive-memory-adapter-engram/spec.md` |
| Design | `openspec/archive/adaptive-memory-adapter-engram/design.md` |
| Tasks | `openspec/archive/adaptive-memory-adapter-engram/tasks.md` |
| Apply Progress | `openspec/archive/adaptive-memory-adapter-engram/apply-progress.md` |
| Verify Report | `openspec/archive/adaptive-memory-adapter-engram/verify-report.md` |
| Review Report | `openspec/archive/adaptive-memory-adapter-engram/review-report.md` |
