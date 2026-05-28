# Review Report: SDD Idempotency, Profiles, and Pipeline Isolation

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: backend, integration
**Files Reviewed**: 9

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Shared runner contract out of sync with adapters; phaseOverrides type too loose |
| Security | ⚠️ Adequate | Path traversal risk in standaloneSkills; profile inner values not validated |
| Scalability | ✅ Strong | Counting is O(n); file reads already exist; no new I/O overhead |
| Maintainability | ⚠️ Adequate | "added" status in filter but not in type; missing JSDoc on profile types |
| Code Quality | ⚠️ Adequate | Inconsistent status casting; inline require instead of injected dep |
| Backend | ⚠️ Adequate | Runner contract not updated; profile context not propagated to content registry |
| Frontend | N/A | |
| Integration | ⚠️ Adequate | Shared runner capability type missing new count fields |

## Findings

### BLOCKER
- **Architecture**: Shared runner capability contract `DeveloperTeamApplyResult` missing `changedCount` and `unchangedCount`.
  - **File**: `packages/core/src/runner-capability.ts` — lines 434-436
  - **Evidence**: `DeveloperTeamApplyResult = { results: readonly DeveloperTeamApplyAgentResult[] }` — no count fields.
  - **Recommendation**: Add `changedCount: number` and `unchangedCount: number` to `DeveloperTeamApplyResult` to match PI/OpenCode adapter implementations and Design artifact contract table.

### MAJOR
- **Architecture / Code Quality**: PI adapter count filter references non-existent `"added"` status.
  - **File**: `packages/adapter-pi/src/developer-team-install.ts` — line 465
  - **Evidence**: `allResults.filter((r) => (r.status as string) === "created" || r.status === "updated" || (r.status as string) === "added").length`. `BundleApplyResult.status` type is `"created" | "unchanged" | "updated"` (line 74) — no `"added"`.
  - **Recommendation**: Either add `"added"` to `BundleApplyResult.status` union, or remove the dead `"added"` branch from the filter to match the actual type system.

- **Security**: Path traversal risk in `standaloneSkills` via unsanitized `skillId`.
  - **File**: `packages/adapter-pi/src/developer-team-install.ts` — line 332-335; `packages/adapter-opencode/src/developer-team-install.ts` — line 315-318
  - **Evidence**: `const relativePath = \`.pi/skills/${skill.skillId}/SKILL.md\`;` and `join(projectRoot, relativePath)`. A `skillId` of `"../../etc/passwd"` would escape the intended directory.
  - **Recommendation**: Sanitize `skillId` before path construction (reject `..`, `/`, `\\`); or validate against a safe pattern like `/^[a-z0-9_-]+$/i`.

- **Maintainability**: `PhaseOverrides` inner shape is `Record<string, unknown>` — opaque and not self-documenting.
  - **File**: `packages/core/src/config/deck-config.ts` — line 68
  - **Evidence**: `export type PhaseOverrides = Partial<Record<SDDPhase, Record<string, unknown>>>;`
  - **Recommendation**: Define a more specific `PhaseConfig` interface (even if it starts as `Record<string, unknown>` with documented expected keys) so the schema is discoverable.

### MINOR
- **Code Quality**: OpenCode adapter uses inline `require("node:fs")` instead of injected dependency.
  - **File**: `packages/adapter-opencode/src/developer-team-install.ts` — line 382
  - **Evidence**: `renameFile: (from, to) => require("node:fs").renameSync(from, to)`
  - **Recommendation**: Accept `renameFile` in `options` parameter, consistent with `writeFile`, `readFile`, `exists`, etc.

- **Architecture**: Orchestrator phase map only covers 3 audit types, limiting profile override applicability.
  - **File**: `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — lines 174-178
  - **Evidence**: `const phaseMap: Record<AuditType, string> = { spec: "spec", design: "design", tasks: "tasks" };`
  - **Recommendation**: Audit `AuditType` union and map all values, or document why only these three support profile overrides.

- **Code Quality**: Inconsistent status casting in PI adapter count filter.
  - **File**: `packages/adapter-pi/src/developer-team-install.ts` — line 465
  - **Evidence**: Some comparisons use `(r.status as string)`, others use `r.status === "updated"` directly.
  - **Recommendation**: Use consistent comparison style; if type narrowing is needed, extract a helper `isChangedStatus(status: string): boolean`.

### NIT
- **Maintainability**: Missing JSDoc on exported profile types.
  - **File**: `packages/core/src/config/deck-config.ts` — lines 52-75
  - **Recommendation**: Add JSDoc to `SDDPhase`, `ProfileStrategy`, `PhaseOverrides`, `Profile` explaining their purpose and valid values.

- **Integration**: Content registry not receiving profile context despite Design artifact stating it should.
  - **File**: `packages/core/src/teams/developer/content-registry.ts`
  - **Evidence**: No `profile` field in `ContentRegistryOptions` or `ContentRegistryResultOptions`.
  - **Recommendation**: Either implement profile context propagation (Design artifact requirement) or update Design to reflect the decision to defer this.

- **Backend**: Missing test coverage for runner-capability type alignment.
  - **File**: `packages/core/src/runner-capability.ts`
  - **Recommendation**: Add a type-level test or runtime check ensuring `DeveloperTeamApplyResult` fields match adapter results.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  1. **Shared runner contract not updated**: Design says "Add changedCount / unchangedCount to PI, OpenCode, and shared runner apply result contracts" but `runner-capability.ts` was not modified.
  2. **Content registry profile context not implemented**: Design says "Content registry accepts profile context for session/prompt context only" but no profile field was added to registry options.
  3. **"added" status mismatch**: Design says counts include "created", "updated", and future-compatible "added", but the actual type definitions don't include "added".

## Open Questions

1. Should `AuditType` include values beyond `spec`, `design`, `tasks` that need phase mapping for profile overrides?
2. Is the `"added"` status intentionally reserved for future use, or should it be removed from the count filter to avoid confusion?
3. Should `standaloneSkills` skillId validation be added in this change or deferred to a security-focused follow-up?

> None of the blockers represent an unrecoverable flaw, but the runner capability contract misalignment is significant enough to warrant a fix before Archive.
