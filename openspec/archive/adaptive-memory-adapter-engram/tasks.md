# Tasks: Adaptive Memory Adapter with Engram Injection

## Source

- Spec: adaptive-memory-adapter-engram spec artifact
- Design: adaptive-memory-adapter-engram design artifact
- Capabilities affected: adaptive-memory-injection, engram-memory-adapter, developer-team-content, developer-team-runtime-materialization, openspec-artifacts, spec-registry-events

## Task Groups

### Group: Shared / Contracts

#### Task 1: Create adaptive memory injection contract types and compositor
**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: Yes
**Depends on**: none

**Description**
Create `packages/core/src/memory/adaptive-memory.ts` with the provider-neutral `AdaptiveMemoryProvider` interface, `MemoryInjectionBundle`, `MemoryInstructionFragment`, `MemoryToolBinding` types, and `composeAdaptiveMemory(base, bundle, context)` compositor helper. Export from `packages/core/src/index.ts`. The compositor appends a `## Adaptive Memory (provider-injected)` section only when fragments match the materialization surface. Update `packages/core/package.json` if needed for the new module path.

**Files**
- `packages/core/src/memory/adaptive-memory.ts` — create
- `packages/core/src/index.ts` — modify
- `packages/core/package.json` — modify (if needed)

**Verification**
TypeScript compiles; unit tests pass for: zero-provider produces no injection, single-provider fragments are composed per surface, tool bindings are preserved unchanged.

#### Task 2: Write core compositor unit tests
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: No — depends on Task 1
**Depends on**: Task 1

**Description**
Create `packages/core/src/memory/adaptive-memory.test.ts` covering: disabled/default (no provider), single Engram provider injection, fragment surface filtering (session vs agent vs skill), tool binding pass-through, enforced auxiliary-memory policy in composed output.

**Files**
- `packages/core/src/memory/adaptive-memory.test.ts` — create

**Verification**
All compositor tests pass; confirms REQ-AMI-001, REQ-AMI-002, REQ-AMI-003, REQ-DRM-001 boundaries.

#### Task 3: Remove Engram-specific content from core Developer Team prompts
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: Yes
**Depends on**: none

**Description**
Search all `packages/core/src/teams/developer/*-content.ts` files for Engram-specific names, MCP tool names, setup instructions, or placeholders (e.g., the "e.g., Engram" mention in `orchestrator-content.ts` line 122). Replace with provider-neutral wording or remove. Ensure the auxiliary-memory policy statement remains but carries no provider name. Verify `content-registry.ts` exports remain static and provider-neutral.

**Files**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify
- `packages/core/src/teams/developer/*-content.ts` — modify (if others contain Engram)
- `packages/core/src/teams/developer/content-registry.ts` — modify (only if needed)

**Verification**
`grep -ri "engram" packages/core/src/teams/developer/*.ts` returns no results (excluding test files); existing content-registry tests still pass. Covers REQ-DTC-001.

### Group: Backend

#### Task 4: Create Engram adapter package with provider implementation
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depends on Task 1
**Depends on**: Task 1

**Description**
Create `packages/adapter-engram/` with `package.json`, `src/index.ts` exporting `createEngramMemoryProvider(): AdaptiveMemoryProvider`, and Engram-specific instruction fragments (session, agent, skill surfaces) plus tool binding metadata (`memory.search`, `memory.read`, `memory.write` mapping to Engram MCP tools). Fragments must include the auxiliary-memory policy: memory is auxiliary, OpenSpec artifacts remain authoritative. Reference the actual Engram MCP server/tool names (to be validated against Engram runtime).

**Files**
- `packages/adapter-engram/package.json` — create
- `packages/adapter-engram/src/index.ts` — create

**Verification**
Package builds; `createEngramMemoryProvider().buildInjection({teamId: "developer-team"})` returns fragments with Engram instructions and tool bindings; fragments contain auxiliary policy; no Engram names leak into core.

#### Task 5: Write Engram adapter tests
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depends on Task 4
**Depends on**: Task 4

**Description**
Create `packages/adapter-engram/src/index.test.ts` asserting: provider id/displayName, fragment surfaces, auxiliary policy presence, tool binding metadata structure, and that no provider content matches unsupported-provider rejection patterns.

**Files**
- `packages/adapter-engram/src/index.test.ts` — create

**Verification**
Tests pass; covers REQ-ENG-001, REQ-ENG-002.

#### Task 6: Extend Pi adapter install and profile with memory composition
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depends on Task 1
**Depends on**: Task 1

**Description**
Modify `packages/adapter-pi/src/developer-team-install.ts` and `pi-team-profile.ts` to accept optional `memoryProvider` or `memoryInjection` parameter. When provided, call `composeAdaptiveMemory()` per surface (session/agent/skill) during materialization. Default (undefined) must produce byte-equivalent output to current. Map `MemoryToolBinding` entries to Pi frontmatter `tools` entries. If provider is invalid, emit observable diagnostic and skip injection (fail-closed).

**Files**
- `packages/adapter-pi/src/developer-team-install.ts` — modify
- `packages/adapter-pi/src/pi-team-profile.ts` — modify

**Verification**
Existing Pi install/profile tests pass unchanged (default path); new test with Engram provider produces injected content with `## Adaptive Memory` section and Pi tool bindings.

#### Task 7: Extend OpenCode adapter install with memory composition
**Owner**: Backend Apply
**Priority**: P2
**Complexity**: Medium
**Parallel**: No — depends on Task 1
**Depends on**: Task 1

**Description**
Modify `packages/adapter-opencode/src/developer-team-install.ts` to accept optional `memoryProvider` or `memoryInjection` and compose injection per surface using `composeAdaptiveMemory()`. Default must remain unchanged. Map `MemoryToolBinding` entries to OpenCode-specific tool format. Fail-closed on invalid/unsupported provider.

**Files**
- `packages/adapter-opencode/src/developer-team-install.ts` — modify

**Verification**
Default path unchanged; injected path includes `## Adaptive Memory` section and OpenCode tool bindings; invalid provider produces diagnostic, no partial injection.

#### Task 8: Wire CLI/TUI provider selection into Pi Developer Team flow
**Owner**: Backend Apply
**Priority**: P2
**Complexity**: Low
**Parallel**: No — depends on Task 4, Task 6
**Depends on**: Task 4, Task 6

**Description**
Modify `apps/cli/src/tui/app.tsx` to pass the selected/configured Engram provider (when explicitly chosen) into Pi Developer Team install and profile flows. If no provider is selected, pass nothing (default). Surface an `unsupported_memory_provider` diagnostic if an unrecognized provider string is provided.

**Files**
- `apps/cli/src/tui/app.tsx` — modify

**Verification**
CLI with no memory flag produces neutral output; CLI with Engram selection produces injected output; invalid provider produces observable error. Covers REQ-AMI-003.

### Group: Frontend

No frontend-specific tasks; CLI/TUI wiring is categorized as Backend given the current architecture.

## Dependency Graph

```
Task 1 (Shared: contract types + compositor)
  → Task 2 (Shared: compositor tests)
  → Task 4 (Backend: Engram adapter package)
    → Task 5 (Backend: Engram adapter tests)
  → Task 6 (Backend: Pi adapter memory composition)
  → Task 7 (Backend: OpenCode adapter memory composition)
Task 3 (Shared: remove Engram from core) — independent
Task 4 + Task 6
  → Task 8 (Backend: CLI wiring)
```

## Parallelization Plan

| Phase | Tasks | Can Run in Parallel |
|---|---|---|
| Shared | 1, 3 | Yes (independent of each other) |
| Shared | 2 | No — depends on Task 1 |
| Backend | 4, 6, 7 | Yes (after Task 1; independent adapters) |
| Backend | 5 | No — depends on Task 4 |
| Backend | 8 | No — depends on Tasks 4 and 6 |

## Responsibility Contracts

| Contract / Boundary | Owner | Consumers | Notes |
|---|---|---|---|
| `AdaptiveMemoryProvider` interface + `composeAdaptiveMemory` | General Apply (Task 1) | Backend Apply (Tasks 4, 6, 7, 8) | Interface is the contract boundary; Engram adapter implements it |
| Core content neutrality (no Engram names) | General Apply (Task 3) | All | REQ-DTC-001 boundary; verified by grep |
| Engram MCP tool names | Backend Apply (Task 4) | Backend Apply (Task 8) | Must validate against Engram runtime before enabling defaults |

## Complexity Summary

| Complexity | Count | Task Numbers |
|---|---|---|
| Low | 3 | 2, 3, 5, 8 |
| Medium | 4 | 1, 4, 6, 7 |
| High | 0 | — |

## Flagged for Splitting

- None — all tasks are within single-session scope.

## Review Workload Forecast

| Signal | Value |
|---|---|
| Estimated changed lines | 100-400 |
| 400-line budget risk | Low |
| Scope reduction recommended | No |
| Sequential work slices recommended | No |
| Decision needed before Apply | Yes |

**Rationale**: The change is well-scoped: 1 new module, 1 new package, and targeted modifications to ~5 existing files. Estimated 200-350 lines of new/modified code. Low risk of 400-line budget overflow. However, two open decisions (Engram MCP tool names, provider selection UX point) may need resolution before Tasks 4 and 8 are fully implementable.

## Open Questions / Blockers

- **Engram MCP contract**: Exact Engram MCP server/tool names must be validated against the Engram runtime before Task 4 can finalize tool binding metadata. If unavailable, Task 4 should use placeholder names and flag for update.
- **Provider selection UX decision**: Task 8 wires CLI selection, but the product decision on selection point (install flag, TUI prompt, config file) remains open. Implementation should use the minimal API option (explicit flag) and leave richer UX for a follow-up.
- **Injection scope**: Design supports session/agent/skill surfaces; initial scope should default to session-only unless product decides otherwise.