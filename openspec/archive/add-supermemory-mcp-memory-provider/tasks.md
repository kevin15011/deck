# Tasks: Add Supermemory MCP Memory Provider

## Source

- Spec: `add-supermemory-mcp-memory-provider` spec artifact
- Design: `add-supermemory-mcp-memory-provider` design artifact
- Capabilities affected: `supermemory-provider-selection`, `supermemory-install-token-configuration`, `supermemory-pi-runtime-integration`, `supermemory-adaptive-context`, `adaptive-memory-governance`, `adaptive-memory-provider`, `installer-memory-provider-configuration`, `sdd-phase-context-assembly`, `openspec-artifact-authority`, `sdd-phase-workflow`, `engram-provider`

## Task Groups

### Group: Shared / Contracts

#### Task 1: Validate Real Supermemory MCP Tool Behavior
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: No — authenticated runtime availability remains blocked pending a valid token; validated tool names unblock non-authenticated mapping decisions only
**Depends on**: none

**Description**
Maintain the Supermemory MCP validation report with confirmed server behavior. The report must record validated endpoint `https://supermemory-new.stlmcp.com`, actual tools `execute` and `search_docs`, absence of provisional `context`/`recall`/`memory`, unauthenticated initialize/tools-list behavior, and the remaining authenticated read-only `execute` probe blocker for runtime availability.

**Files**
- `openspec/changes/add-supermemory-mcp-memory-provider/mcp-validation-report.md` — create/modify

**Verification**
Validation report identifies `execute` and `search_docs` as the only exposed tools for implementation, documents auth behavior, and states authenticated runtime validation remains blocked until a valid token is supplied outside repo files.

#### Task 2: Adaptive Memory Contract Types
**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: Yes
**Depends on**: none

**Description**
Create provider-neutral adaptive-memory contract types for provider identity, diagnostics, context/search/commit/configure/health operations, scopes, metadata, container tags, and commit policy. Keep provider-specific MCP names out of core contracts.

**Files**
- `packages/core/src/memory/adaptive-memory-contract.ts` — create
- `packages/core/src/memory/adaptive-memory-contract.test.ts` — create
- `packages/core/src/index.ts` — modify

**Verification**
`bun test packages/core/src/memory/adaptive-memory-contract.test.ts` and `bunx tsc --noEmit` pass; contract has no Supermemory-specific tool names.

#### Task 3: Adaptive Memory Governance Module
**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Task 2
**Depends on**: Task 2

**Description**
Create governance validators for personal/project/team/org scopes, container tags (max 100 chars; letters/numbers/`_`/`:`/`-`), required metadata, confidence, promotion status, forbidden content, commit limits, and team-candidate enforcement.

**Files**
- `packages/core/src/memory/adaptive-memory-governance.ts` — create
- `packages/core/src/memory/adaptive-memory-governance.test.ts` — create

**Verification**
`bun test packages/core/src/memory/adaptive-memory-governance.test.ts` passes and covers REQ-AMG-001 through REQ-AMG-010.

#### Task 4: Deck Config Module
**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: Yes
**Depends on**: none

**Description**
Create/maintain `.deck/config.json` read/write/validate support for non-secret adaptive-memory settings: active provider (`none`/`engram`/`supermemory`), required Supermemory `userId`, optional `projectId`/`teamId`/`orgId`, server name, search defaults, max memories, and resolver precedence CLI > config > `none`. Recursively reject token/API-key/credential-like fields so the Supermemory token is never stored in Deck config.

**Files**
- `packages/core/src/config/deck-config.ts` — create/modify
- `packages/core/src/config/deck-config.test.ts` — create/modify
- `packages/core/package.json` — modify
- `packages/core/src/index.ts` — modify

**Verification**
`bun test packages/core/src/config/deck-config.test.ts` passes; secret-field rejection, required `userId`, absent-config default, and resolver precedence are covered.

#### Task 5: SDD Context Authority Rendering Helper
**Owner**: General Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depends on Task 2
**Depends on**: Task 2

**Description**
Add a core helper that renders explicit `OFFICIAL CONTEXT` and `ADAPTIVE CONTEXT` sections plus the authority rule that OpenSpec is authoritative and memory is advisory. Use it in Developer Team prompt content and adaptive-memory composition, including safe empty adaptive-context behavior.

**Files**
- `packages/core/src/memory/adaptive-context-renderer.ts` — create
- `packages/core/src/memory/adaptive-context-renderer.test.ts` — create
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify
- `packages/core/src/teams/developer/*-content.ts` — modify
- `packages/core/src/memory/adaptive-memory.ts` — modify

**Verification**
`bun test packages/core/src/memory/adaptive-context-renderer.test.ts` and `bun test packages/core/src/memory` pass; rendered prompts separate official/adaptive sections and include the authority rule.

#### Task 14: Documentation — Pi Agent Installation
**Owner**: General Apply
**Priority**: P2
**Complexity**: Low
**Parallel**: Yes
**Depends on**: Task 8, Task 12, Task 15

**Description**
Update Pi installation documentation for Pi-first Supermemory setup, external credential boundary, `~/.pi/agent/mcp.json`, required `userId`, optional `teamId`/`orgId`, fallback behavior, active-provider switching, no Engram migration, team-candidate status, and OpenSpec authority.

**Files**
- `docs/pi-agent-installation.md` — modify

**Verification**
Documentation covers the listed topics and does not instruct users to store Supermemory credentials in `.deck/config.json` or repo files.

### Group: Backend

#### Task 6: Extend Adaptive Memory Provider Resolution and Composition
**Owner**: Backend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Tasks 2 and 3
**Depends on**: Task 2, Task 3

**Description**
Extend `AdaptiveMemoryProvider`/`resolveMemoryInjection()` to recognize `supermemory`, enforce single active provider, include health diagnostics, use the contract/governance modules, and preserve Engram compatibility. Do not hardcode Supermemory MCP tool names in core.

**Files**
- `packages/core/src/memory/adaptive-memory.ts` — modify
- `packages/core/src/memory/adaptive-memory.test.ts` — modify

**Verification**
`bun test packages/core/src/memory/adaptive-memory.test.ts` passes; Supermemory provider ID, single-provider enforcement, diagnostics, and Engram compatibility are tested.

#### Task 7: Engram Adapter Conformance to Common Contract
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depends on Task 6
**Depends on**: Task 2, Task 6

**Description**
Update Engram adapter to conform to the evolved contract while preserving existing fragments/tool bindings. Implement unsupported operations as safe no-ops/diagnostics and do not add any Engram-to-Supermemory migration path.

**Files**
- `packages/adapter-engram/src/index.ts` — modify
- `packages/adapter-engram/src/index.test.ts` — modify

**Verification**
`bun test packages/adapter-engram` passes; existing Engram behavior is preserved and no migration path exists.

#### Task 8: Supermemory Adapter Package
**Owner**: Backend Apply
**Priority**: P0
**Complexity**: High
**Parallel**: No — depends on validated MCP mapping and shared contracts
**Depends on**: Task 1, Task 2, Task 3

**Description**
Create `packages/adapter-supermemory/` implementing `createSupermemoryMemoryProvider(config)`. Use only validated MCP tools `execute` and `search_docs`; do not expose provisional `context`, `recall`, or `memory`. Provide provider identity, injection fragments, Pi MCP tool bindings, scoped container/metadata guidance, advisory authority instructions, required `userId`, optional `teamId`/`orgId`, no invented `projectId`, team `candidate` status, max-7 high-signal commit guidance, and health diagnostics that require authenticated runtime validation before full availability.

**Files**
- `packages/adapter-supermemory/package.json` — create
- `packages/adapter-supermemory/src/index.ts` — create
- `packages/adapter-supermemory/src/index.test.ts` — create
- `bun.lock` — modify

**Verification**
`bun test packages/adapter-supermemory` and `bunx tsc --noEmit` pass; tests prove only `execute`/`search_docs` are bound, provisional tool names are absent, `userId` is required, governance rules are used, and authenticated availability can fail closed.

#### Task 9: Pi Developer Team Install — Supermemory Provider Support
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depends on Task 8
**Depends on**: Task 6, Task 8, Task 15

**Description**
Modify Pi install materialization to support active/valid Supermemory providers, include only validated `execute`/`search_docs` tool bindings when config/health checks pass, and omit injection with redacted diagnostics when unavailable. Preserve Engram support and ensure Pi MCP config presence is checked through Task 15 before tool injection.

**Files**
- `packages/adapter-pi/src/developer-team-install.ts` — modify
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify

**Verification**
`bun test packages/adapter-pi/src/developer-team-install.test.ts` passes; Supermemory bindings appear only for active valid config, and missing/malformed Pi MCP config falls back without token leakage.

#### Task 10: Pi Team Profile — Supermemory Adaptive Context
**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depends on Tasks 5 and 8
**Depends on**: Task 5, Task 8

**Description**
Update Pi profile materialization to accept Supermemory provider instances, include advisory context instructions when active/valid, use the context renderer for authority sections, and safely omit adaptive context with absence indicators when unavailable.

**Files**
- `packages/adapter-pi/src/pi-team-profile.ts` — modify
- `packages/adapter-pi/src/pi-team-profile.test.ts` — modify

**Verification**
`bun test packages/adapter-pi/src/pi-team-profile.test.ts` passes; official/adaptive context separation, absence behavior, and Engram compatibility are tested.

#### Task 15: Pi Global MCP Config Writer for Supermemory
**Owner**: Backend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on non-secret config schema and must land before final TUI/launch handoff
**Depends on**: Task 4

**Description**
Create `packages/adapter-pi/src/pi-mcp-config.ts` to read, merge, validate, and atomically write external Pi global MCP config at `~/.pi/agent/mcp.json`. Add/update only the `supermemory` server entry (or configured server name) with HTTP URL `https://supermemory-new.stlmcp.com` and header `x-supermemory-api-key` containing the prompted token; preserve unrelated servers; fail closed on malformed/conflicting config unless repair is unambiguous; prefer user-only parent directory permissions and `0600`-style file permissions where possible; return only redacted diagnostics. Treat this file as the runner-installation secret boundary: the token is outside the project and must not pass through AI memory, OpenSpec, generated prompts, `.deck/config.json`, logs, or tests. Add tests using temp-home fixtures for create/update/merge/malformed/redaction/permission best-effort behavior.

**Files**
- `packages/adapter-pi/src/pi-mcp-config.ts` — create
- `packages/adapter-pi/src/pi-mcp-config.test.ts` — create

**Verification**
`bun test packages/adapter-pi/src/pi-mcp-config.test.ts` passes; fixture output contains the actual token only in the temp external MCP config, not logs/snapshots; diagnostics redact `x-supermemory-api-key`; unrelated MCP servers are preserved; malformed config fails without partial writes; permissions are attempted where supported.

### Group: Frontend

#### Task 11: CLI Arguments — Accept --memory=supermemory
**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: Yes
**Depends on**: none

**Description**
Allow `--memory=supermemory` in addition to existing `engram` and `none`, preserving errors for unsupported values and default behavior when no flag is supplied.

**Files**
- `apps/cli/src/cli-args.ts` — modify
- `apps/cli/src/cli-args.test.ts` — modify

**Verification**
`bun test apps/cli/src/cli-args.test.ts` passes for `supermemory`, `engram`, `none`, unsupported values, and no flag.

#### Task 12: CLI Main and Launch — Provider Resolution and Construction
**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Tasks 4, 6, and 11
**Depends on**: Task 4, Task 6, Task 11, Task 15

**Description**
Resolve active provider using CLI > `.deck/config.json` > `none`, construct Engram or Supermemory provider, check Pi MCP config presence for Supermemory, and report active-provider diagnostics without credentials or memory content. If Supermemory config is incomplete, Pi MCP config is missing/malformed, or health validation fails, launch with no adaptive-memory injection and redacted warning.

**Files**
- `apps/cli/src/main.tsx` — modify
- `apps/cli/src/pi-launch-command.ts` — modify
- `apps/cli/src/pi-launch-command.test.ts` — modify

**Verification**
`bun test apps/cli` passes for relevant launch tests; precedence, no double-provider cases, Supermemory construction, Pi MCP config fallback, and token/header redaction are covered.

#### Task 13: TUI Provider Selection and Supermemory Setup
**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: High
**Parallel**: No — depends on Task 4 and final credential handoff from Task 15
**Depends on**: Task 4, Task 15

**Description**
Modify the TUI install/config flow to offer exactly one adaptive-memory provider (`None`, `Engram`, `Supermemory MCP`), prompt for Supermemory token and required `userId`, accept optional `teamId`/`orgId`, persist only non-secret settings to `.deck/config.json`, and call the Pi MCP config writer from Task 15 when Supermemory is selected. The server entry must be named `supermemory` by default, use `https://supermemory-new.stlmcp.com`, write header `x-supermemory-api-key` with the prompted token only to `~/.pi/agent/mcp.json`, and redact the token/header from TUI summaries, logs, tests, and apply progress. Show actionable errors for missing/invalid required inputs or failed MCP config write, and confirm the active provider after setup.

**Files**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — modify
- `apps/cli/src/tui/developer-team-flow.test.tsx` — modify

**Verification**
`bun test apps/cli/src/tui` passes; tests cover provider selection, token/userId prompts, optional team/org IDs, non-secret Deck config persistence, real Pi MCP config writer invocation, redacted summaries/snapshots, failed-writer errors, and active-provider confirmation.

## Dependency Graph

```text
Task 1 ─┐
Task 2 ─┼─ Task 3 ─┬─ Task 6 ── Task 7
        │          │           └─ Task 9
        └─ Task 5 ─┴─ Task 10
Task 4 ─┬─ Task 15 ─┬─ Task 13
        │           ├─ Task 12
        │           └─ Task 9
        └─ Task 12
Task 8 depends on Tasks 1, 2, 3; Task 9 depends on Tasks 6, 8, 15; Task 10 depends on Tasks 5, 8.
Task 11 ── Task 12
Task 14 depends on Tasks 8, 12, 15.
```

## Parallelization Plan

| Phase | Tasks | Can Run in Parallel |
|---|---|---|
| Shared | 1, 2, 4, 11 | Yes, except Task 1 remains a validation gate for authenticated availability |
| Shared follow-up | 3, 5, 15 | Partially — Tasks 3/5 depend on 2; Task 15 depends on 4 |
| Backend | 6, 7, 8, 9, 10 | Limited — 6 and 8 can proceed after shared gates; 9/10 wait on dependencies |
| Frontend | 12, 13 | Limited — both depend on Task 15; Task 12 also depends on 6/11 |
| Docs | 14 | Yes, after implementation contracts stabilize |

## Responsibility Contracts

| Contract / Boundary | Owner | Consumers | Notes |
|---|---|---|---|
| `AdaptiveMemoryAdapter` type contract | General Apply (Task 2) | Backend Apply (Tasks 6-8), Frontend Apply (Task 12) | Provider-neutral; no MCP-specific names. |
| Governance validation API | General Apply (Task 3) | Backend Apply (Task 8) | Enforces metadata, scope, container, commit, and forbidden-content rules. |
| Non-secret Deck config | General Apply (Task 4) | Frontend Apply (Tasks 12, 13), Backend Apply (Tasks 6, 15) | Must reject credentials recursively. |
| Pi global MCP config writer | Backend Apply (Task 15) | Frontend Apply (Task 13), Backend/Frontend launch (Tasks 9, 12) | Only approved token persistence path; external to repo; redacted diagnostics only. |
| Supermemory MCP tool mapping | Backend Apply (Task 8) | Backend Apply (Tasks 9, 10), Frontend Apply (Task 12) | Use `execute` and `search_docs` only. |
| Provider resolution precedence | Backend Apply (Task 6) + Frontend Apply (Task 12) | CLI/TUI/Pi runtime | CLI override > config > `none`; exactly one provider. |
| Token redaction boundary | Frontend Apply (Task 13) + Backend Apply (Task 15) | Logs, UI, tests, apply progress | Token/header never appear in Deck-controlled output or repo files. |

## Complexity Summary

| Complexity | Count | Task Numbers |
|---|---|---|
| Low | 4 | Task 1, Task 5, Task 11, Task 14 |
| Medium | 9 | Task 2, Task 3, Task 4, Task 6, Task 7, Task 9, Task 10, Task 12, Task 15 |
| High | 2 | Task 8, Task 13 |

## Flagged for Splitting

- Task 8: High complexity new package covering MCP mapping, instructions, health diagnostics, metadata, and governance.
- Task 13: High complexity TUI flow with token handling, writer integration, redaction, and config persistence.

## Review Workload Forecast

| Signal | Value |
|---|---|
| Estimated changed lines | 400-800 |
| 400-line budget risk | Medium |
| Scope reduction recommended | No |
| Sequential work slices recommended | Yes |
| Decision needed before Apply | Yes |

**Rationale**: Scope remains broad across core, adapters, CLI, TUI, docs, and a new Pi MCP config module. The resolved credential handoff removes the prior secret-storage blocker but adds external config writer/review risk; sequential slices are still recommended around shared contracts/config, Supermemory adapter, Pi MCP writer, and TUI/launch integration.

## Open Questions / Blockers

| # | Question | Classification | Handling |
|---|---|---|---|
| 1 | Authenticated Supermemory runtime behavior: can a real token complete read-only `execute` health probe plus metadata/container validation? | Implementation-blocking for full runtime availability | Task 1 remains blocked until a valid token is supplied outside repo files. Adapter/installer must fail closed and not claim full availability without this. |
| 2 | Exact Pi MCP JSON schema if Pi differs from design-level `mcpServers.supermemory.{transport,url,headers}` shape. | Allowed-with-stub | Task 15 isolates schema mapping in `pi-mcp-config.ts`; implement design-level shape and adjust inside that module if Pi validation requires different keys. |
| 3 | How is `projectId` derived? | Allowed-with-placeholder | Do not invent IDs; disable project-scoped containers or require explicit value until a product/domain decision is made. |
| 4 | Should Supermemory container prompts be configured automatically or documented for manual setup? | Non-blocking | Document current behavior; automatic configuration can follow later. |
| 5 | What is the exact fallback mode beyond non-blocking continuation when Supermemory credentials are missing, invalid, validation fails, or service is unavailable? | Non-blocking | Use OpenSpec-only context with redacted warning/absence indicator. |
| 6 | What audit logging depth is expected for automatically committed memories? | Non-blocking | Implement saved/discarded counts, scopes, sources, and decision reasons without sensitive content. |

Resolved/unblocked: the prior secret-storage open question is resolved by the approved external Pi global MCP config path `~/.pi/agent/mcp.json`; the token must not be written to `.deck/config.json` or repo files and must be redacted from Deck-controlled output.
