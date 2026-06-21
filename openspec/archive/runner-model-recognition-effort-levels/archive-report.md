# Archive Report: Runner Model Recognition and Model-Aware Effort Levels

## Change Summary

**Change**: `runner-model-recognition-effort-levels`
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/runner-model-recognition-effort-levels/`

### Lifecycle
- **Proposal**: 2026-06-18 — Add adapter-driven OpenCode model inventory + per-model effort variant support.
- **Spec + Design**: 2026-06-18 — Spec and Design completed in one pass with plugin cache/source-open decisions captured.
- **Tasks**: 2026-06-18 — 15 tasks created (including pre- and post-repair safety tracks).
- **Apply**: 2026-06-19 — 15/15 original tasks completed; initial and final blockers repaired.
- **Verify**: 2026-06-19T03:30:00Z — PASS WITH WARNINGS.
- **Review**: 2026-06-19T03:30:00Z — APPROVE WITH WARNINGS.
- **Archive**: 2026-06-19T04:00:00Z — Change moved to OpenSpec archive.

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-INV-001 | T1, T4, T8, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-INV-002 | T4, T8 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-INV-003 | T4, T8, T15 | ✅ Implemented | ✅ PASS | ✅ Adequate |
| REQ-INV-004 | T1, T4, T7, T8, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-INV-005 | T1, T3, T4, T9 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-OCSRC-001 | T4, T5, T8, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-OCSRC-002 | T4, T8, T7, T10, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-OCSRC-003 | T4, T8, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-EFFORT-001 | T4, T5, T7, T8, T13, T14 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-EFFORT-002 | T5, T8, T14 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-EFFORT-003 | T1, T7, T8, T10 | ✅ Implemented | ✅ PASS | ⚠️ Adequate |
| REQ-EFFORT-004 | T7, T14, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-EFFORT-005 | T6, T10, T7 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SAFE-001 | T2, T7, T8, T14, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SAFE-002 | T7, T14, T10, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SAFE-003 | T10, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CLEAN-001 | T7, T10, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CLEAN-002 | T14, T10, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CLEAN-003 | T10, T15, T7 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TUI-001 | T8, T13, T14 | ✅ Implemented | ✅ PASS | ✅ Adequate |
| REQ-TUI-002 | T14, T10 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TUI-003 | T13, T14 | ✅ Implemented | ✅ PASS | ✅ Adequate |
| REQ-TEST-001 | T3, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TEST-002 | T4, T5, T15, T14, T3 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TEST-003 | T3, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-COMPAT-001 | T12, T13, T14, T10 | ✅ Implemented | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 3 categories

- `bunx tsc --noEmit` reports 93 pre-existing workspace diagnostics (final blocker scopes clean).
- Full TUI suite has 11 unrelated pre-existing failures outside this change's model inventory/variant persistence flow.
- Review notes remain: stale comments/type duplication and one optional plugin lifecycle hardening item.

## Review

**Rating**: APPROVE WITH WARNINGS
**Blockers**: 0
**Major Findings**: 0
**Minor Findings**: 3 (all non-blocking)

## Follow-ups

- **High**: Centralize variant validation/check logic across read/resolve/write/TUI paths to reduce future drift; currently duplicated in multiple adapter and boundary files. — Suggested owner: Backend + Frontend
- **High**: Replace OpenCode variant-cache plugin `require.main === module` guard in `packages/adapter-opencode/assets/opencode/plugins/model-variants.ts` with an ESM-safe pattern or remove direct-run behavior. — Suggested owner: Backend
- **Medium**: Decouple deck-owned variant plugin lifecycle logic from Mermaid status handling so plugin status and lifecycle can be tracked independently. — Suggested owner: Backend
- **Medium**: Extend follow-up tests with at least one confirmed non-standard variant (e.g., `xhigh`) through write-path assertions and one DeckApp Pi-reach regression flow. — Suggested owner: Backend + Frontend
- **Low**: Address pre-existing full-TUI debt and stale diagnostics in a dedicated cleanup wave before declaring future full-suite green as a hard gate. — Suggested owner: Orchestrator QA/Frontend

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- Model-specific effort support is now enforceable only through adapter-supplied confirmed variants; fallback hardcoded global OpenCode levels must remain deprecated and guarded.
- OpenCode persistence safety requires two confirmation channels (`runner`-owned model inventory and `Deck` variant cache) with fail-closed behavior when neither confirms the selected variant.
- Pi compatibility is sensitive to shared resolver/type changes: restoring `detectPiModelInventoryForTui()` and separate call-site paths avoided regressions.
