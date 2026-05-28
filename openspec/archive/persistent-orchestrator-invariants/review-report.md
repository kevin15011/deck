# Review Report: Persistent Orchestrator Invariants (Re-Review)

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general, backend, integration
**Files Reviewed**: 12

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Core/adaptor boundary clean. Verifier duplication in adapters remains a DRY violation but is justified by documented runtime/import constraints and covered by passing tests. |
| Security | ✅ Strong | No external inputs; static data. No injection or exposure risks. |
| Scalability | ✅ Strong | Deterministic string ops; negligible perf impact. |
| Maintainability | ⚠️ Adequate | Verifier duplication drift risk when INV-006+ is added. Doc `sourceRefs` line-number refs will drift. Retained prose increases token overhead. |
| Code Quality | ✅ Strong | All prior minor findings (dead import, incomplete test, typo, Pi adapter type error) are resolved. |
| Backend | ✅ Strong | Backward-compatible API. Ordering now aligned with updated spec (invariants before authority). All tests pass. |
| Frontend | N/A | No frontend changes. |
| Integration | ⚠️ Adequate | Adapter verification works via inline copies. Functional parity with core verifier for current 5 critical IDs. Risk of future drift is tracked. |

## Findings

### MAJOR

- **Architecture**: Adapter inline verifier duplicates core helper instead of importing it.
  - **File**: `packages/adapter-opencode/src/developer-team-install.ts` (lines 12–49) and `packages/adapter-pi/src/developer-team-install.ts` (similar inline block)
  - **Evidence**: Both adapters define a local `verifyInvariantPresence()` that hard-codes the five critical IDs (`["INV-001", …, "INV-005"]`) and re-implements the header/ID check. The core export `verifyOrchestratorInvariantPresence` exists but is commented out with `// TODO: restore import when @deck/core exports are fully typed`.
  - **Disposition**: **Acceptable follow-up** for this change. The duplication is documented, functionally equivalent for the current invariant set, and all adapter tests pass. However, it must be resolved before adding INV-006+ to avoid manual sync across adapters.
  - **Recommendation**: Schedule a follow-up task to resolve `@deck/core` export typing and replace inline copies with direct imports. Alternatively, expose a thin runtime-compatible wrapper from core, or add a build-time code-generation step that pins the ID list into adapters from the canonical `ORCHESTRATOR_INVARIANTS` array.

### MINOR

- **Maintainability**: Documentation `sourceRefs` use line-number ranges that will drift.
  - **File**: `docs/prompt-methodology-modules.md` (multiple sections) and `packages/core/src/teams/developer/orchestrator-invariants.ts` (`sourceRefs` fields)
  - **Evidence**: References such as `orchestrator-content.ts:161-168` and `lines 146-159, 432-452` are accurate today but will silently become wrong after any edit to `orchestrator-content.ts`.
  - **Recommendation**: Add a lightweight CI check or a test that verifies `sourceRefs` line ranges still resolve to non-empty content. Alternatively, switch to section/heading anchors (e.g. `## Execution Mode`) instead of line numbers.

### NIT

- None. All prior NIT findings (typo, dead import, incomplete test) are resolved.

## Resolved Findings (from prior review)

| Finding | Severity | Status | Evidence |
|---|---|---|---|
| Invariant ordering contradicts spec | MAJOR | ✅ Resolved | Spec updated (REQ-OIS-004, REQ-IBC-001/002) to place invariants before context-authority. Implementation (`content-registry.ts` lines 342, 522-525) and tests now aligned. |
| Dead import in content registry | MINOR | ✅ Resolved | `verifyOrchestratorInvariantPresence` import removed from `content-registry.ts`. |
| Incomplete test (no assertion) | MINOR | ✅ Resolved | `orchestrator-invariants.test.ts` line 246 now has `expect(result.pass).toBe(true)`. |
| Typo "Invairants" | NIT | ✅ Resolved | Fixed to "Invariants" in `orchestrator-invariants.ts` line 55. |
| Pi adapter type error | MAJOR | ✅ Resolved | Calls changed from `verifyInvariantPresence(content, { surface })` to `verifyInvariantPresence(content, "agent"/"skill")` at lines 593, 630. |

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**:
  1. **Adapter verification**: The Design says "Adapters only call core verification and surface diagnostics." Implementation uses inline copies to avoid an import issue. This is a justified workaround tracked for follow-up cleanup.
  2. **Prose retention**: Design allows additive extraction with optional later dedupe; implementation retains all original prose. Acceptable per REQ-BC-004, but increases token overhead.

## Constraint Verification

- **No separate "documentation triage" introduced**: ✅ Confirmed. `docs/prompt-methodology-modules.md` contains an explicit constraint line: "This document does NOT create a separate 'documentation triage' concept." No module or process named "documentation triage" exists.

## Open Questions

1. When will the `@deck/core` export typing issue be resolved so adapters can import `verifyOrchestratorInvariantPresence` directly?
2. Should a follow-up change deduplicate the retained prose in `orchestrator-content.ts` now that invariant verification is in place?
3. Should `docs/prompt-methodology-modules.md` line-number references be replaced with heading anchors to reduce drift risk?

> None of the above are blockers for this change; they can be addressed in follow-up tasks.
