# Apply Progress: Add Supermemory MCP Memory Provider

## Completed Tasks

### Task 1: Validate Real Supermemory MCP Tool Behavior
**Status**: ✅ Complete
**Files Changed**
- `openspec/changes/add-supermemory-mcp-memory-provider/mcp-validation-report.md` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/apply-progress.md` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/state.yaml` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/events.yaml` — modify

**Verification**
- Tests: skipped — report/registry-only task; no product code changed.
- Build: skipped — no product code changed.
- Typecheck: skipped — no TypeScript changed.

**Notes**
- Recorded authenticated Supermemory MCP validation completion without exposing the token/header value.
- Confirmed `~/.pi/agent/mcp.json` exists, is valid JSON, has restrictive `0600` permissions, contains `mcpServers.supermemory`, uses URL `https://supermemory-new.stlmcp.com`, and has a non-empty `x-supermemory-api-key` header.
- Confirmed `.deck/config.json` active provider is `supermemory` and does not contain secret-like keys or the Supermemory API key.
- Confirmed MCP `initialize` with the configured header returned HTTP 200 and a session id.
- Confirmed MCP `tools/list` with the configured header returned HTTP 200 and tools `execute` and `search_docs` only; provisional `context`/`recall`/`memory` tools remain absent.
- Confirmed authenticated read-only `execute` probe passed using `client.search.memories({ q: 'deck health check', containerTag: 'u:kevin', limit: 1, searchMode: 'memories' })`.
- No Supermemory token was printed, copied into artifacts, or persisted in repository files.

### Task 2: Adaptive Memory Contract Types
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory-contract.ts` — create
- `packages/core/src/memory/adaptive-memory-contract.test.ts` — create
- `packages/core/src/index.ts` — modify
- `packages/core/package.json` — modify

**Verification**
- Tests: pass — `bun test packages/core/src/memory/adaptive-memory-contract.test.ts`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Added provider-neutral contracts for provider identity, diagnostics, scope references, context/search/commit/configure/health operations, metadata, container tags, and commit policy.
- Kept Supermemory-specific MCP tool names out of the core contract module; provider-specific tool mappings remain adapter-owned.
- Exported the new contract module from `@deck/core` and direct package exports for downstream adapter/CLI consumers.

### Task 3: Adaptive Memory Governance Module
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory-governance.ts` — create
- `packages/core/src/memory/adaptive-memory-governance.test.ts` — create
- `packages/core/src/index.ts` — modify
- `packages/core/package.json` — modify

**Verification**
- Tests: pass — `bun test packages/core/src/memory/adaptive-memory-governance.test.ts`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Added validators for personal/project/team/org scopes, container tag format and length, required metadata, confidence range, promotion status, forbidden content, session commit limits, team candidate enforcement, search filters, and commit audit summaries.
- Tests cover REQ-AMG-001 through REQ-AMG-010, including high-signal enforcement, max-7 session commits, no active specs/tasks/raw chats/secrets/sensitive code/unapproved requirements/experimental deltas/Engram migration payloads, and audit output without memory content.

### Task 4: Deck Config Module
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/config/deck-config.ts` — create
- `packages/core/src/config/deck-config.test.ts` — create
- `packages/core/package.json` — modify
- `packages/core/src/index.ts` — modify

**Verification**
- Tests: pass — `bun test packages/core/src/config/deck-config.test.ts`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit`

**Notes**
- Implemented `.deck/config.json` read/write/validation with absent-file defaults (`activeProvider: "none"`).
- Added provider resolver precedence: CLI override > config file/config object > `none` default.
- Enforced Supermemory `userId` when Supermemory is the resolved active provider.
- Added recursive secret-like field rejection for token/credential/secret/API key/password/auth-style fields before writing or resolving config. No Supermemory token is stored or retrieved by this module.
- Kept `projectId` optional and passive; the module does not derive or invent project identifiers.

### Task 5: SDD Context Authority Rendering Helper
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-context-renderer.ts` — create
- `packages/core/src/memory/adaptive-context-renderer.test.ts` — create
- `packages/core/src/memory/adaptive-memory.ts` — modify
- `packages/core/src/teams/developer/content-registry.ts` — modify
- `packages/core/src/index.ts` — modify
- `packages/core/package.json` — modify

**Verification**
- Tests: pass — `bun test packages/core/src/memory/adaptive-context-renderer.test.ts`
- Tests: pass — `bun test packages/core/src/memory`
- Tests: pass — `bun test packages/core/src/teams/developer/content-registry.test.ts packages/core/src/teams/developer/orchestrator-content.test.ts`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Added a core renderer for explicit `OFFICIAL CONTEXT` and `ADAPTIVE CONTEXT` sections with the authority rule that OpenSpec artifacts/Spec Registry entries are authoritative and adaptive memory is advisory.
- `composeAdaptiveMemory()` now uses the renderer when provider fragments match while preserving fail-closed no-injection behavior and existing provider-injected adaptive memory heading for compatibility with adapter tests/materialization.
- Developer Team prompt content returned by the content registry now includes shared Context Authority guidance instead of duplicating the same text in every `*-content.ts` source constant.
- Empty adaptive-context rendering is safe and explicit via the renderer; disabled/no-matching provider composition still leaves existing content unchanged to preserve current runtime behavior.


### Task 6: Extend Adaptive Memory Provider Resolution and Composition
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory.ts` — modify
- `packages/core/src/memory/adaptive-memory.test.ts` — modify
- `apps/cli/src/pi-launch-command.ts` — modify

**Verification**
- Backend Tests: pass — `bun test packages/core/src/memory/adaptive-memory.test.ts`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Extended provider resolution to accept exactly one active provider candidate, recognize caller-allowlisted `supermemory`, fail closed on multiple active providers, and expose provider health diagnostics without hardcoding Supermemory MCP tool names in core.
- Preserved Engram compatibility through caller-provided supported provider IDs and existing injection behavior.

### Task 7: Engram Adapter Conformance to Common Contract
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-engram/src/index.ts` — modify
- `packages/adapter-engram/src/index.test.ts` — modify

**Verification**
- Backend Tests: pass — `bun test packages/adapter-engram`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Added common-contract adapter identity, health, context/search/commit/configure methods while preserving existing Engram fragments and `memory_*` tool bindings.
- Unsupported operations return safe no-op diagnostics; no Engram-to-Supermemory migration path was added.

### Task 8: Supermemory Adapter Package
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-supermemory/package.json` — create
- `packages/adapter-supermemory/src/index.ts` — create
- `packages/adapter-supermemory/src/index.test.ts` — create
- `bun.lock` — modify

**Verification**
- Backend Tests: pass — `bun test packages/adapter-supermemory`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Added `createSupermemoryMemoryProvider(config)` with required `userId`, optional `teamId`/`orgId`, provider identity, advisory injection fragments, validated Pi MCP tool bindings limited to `execute` and `search_docs`, scoped container/metadata guidance, candidate team-memory policy, max-7 commit guidance, and fail-closed health diagnostics until authenticated runtime validation is known.
- Governance validators are used for container tags, scoped requests, search filters, and commit candidates. No Supermemory token is accepted, stored, printed, or persisted by the adapter.


### Task 9: Pi Developer Team Install — Supermemory Provider Support
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/developer-team-install.ts` — modify
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify
- `packages/adapter-pi/src/pi-mcp-config.ts` — modify

**Verification**
- Backend Tests: pass — `bun test packages/adapter-pi/src/developer-team-install.test.ts`
- Backend Tests: pass — `bun test packages/adapter-pi`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Pi Developer Team install now allowlists `supermemory` alongside Engram.
- Supermemory injection is gated by the Task 15 Pi global MCP config validator before tool names are materialized into generated Pi agent frontmatter.
- When the Pi MCP config is missing, malformed, or lacks a valid Supermemory HTTP server entry/header, install planning fails closed with redacted diagnostics and omits adaptive-memory instructions/tool bindings.
- Valid Supermemory plans bind only the validated `execute` and `search_docs` tools. Provisional `context`, `recall`, and `memory` tools are not bound.
- No Supermemory token/header value is written into generated agent/skill content, diagnostics, or tests.

### Task 10: Pi Team Profile — Supermemory Adaptive Context
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/pi-team-profile.ts` — modify
- `packages/adapter-pi/src/pi-team-profile.test.ts` — modify

**Verification**
- Backend Tests: pass — `bun test packages/adapter-pi/src/pi-team-profile.test.ts`
- Backend Tests: pass — `bun test packages/adapter-pi`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Pi team profile prompt materialization now accepts Supermemory provider instances by default while preserving Engram behavior.
- Supermemory session guidance is composed through the shared context renderer, producing explicit `OFFICIAL CONTEXT` and `ADAPTIVE CONTEXT` sections and the OpenSpec-authoritative/adaptive-advisory rule.
- When a requested provider is unavailable, the profile safely renders an adaptive-context absence indicator and continues with official context only.

### Task 11: CLI Arguments — Accept --memory=supermemory
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/cli-args.ts` — modify
- `apps/cli/src/cli-args.test.ts` — modify

**Verification**
- Frontend Tests: pass — `bun test apps/cli/src/cli-args.test.ts`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Added `supermemory` to the CLI parser's supported memory provider list while preserving `engram`, explicit `none`, unsupported-provider errors, and absent-flag default behavior.
- Updated CLI tests to cover `--memory=supermemory` alone and with `--continue`, plus existing `engram`, `none`, unsupported value, and no-flag cases.
- No Supermemory credential/token handling was added in this task.

### Task 12: CLI Main and Launch — Provider Resolution and Construction
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/main.tsx` — modify
- `apps/cli/src/pi-launch-command.ts` — modify
- `apps/cli/src/pi-launch-command.supermemory.test.ts` — create
- `apps/cli/package.json` — modify
- `bun.lock` — modify

**Verification**
- Frontend Tests: pass — `bun test apps/cli`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- `runPiLaunch()` now resolves the active provider using CLI override > `.deck/config.json` > `none`, constructs Engram or Supermemory providers, and preserves legacy preconstructed-provider support while rejecting double-provider resolution.
- Supermemory launch is gated by required non-secret config (`userId`) and the Task 15 Pi MCP config validator before any session/agent/skill adaptive-memory injection is materialized.
- Missing/incomplete Supermemory config, missing/malformed Pi MCP config, unsupported provider IDs, or double-provider input fail closed with redacted diagnostics and continue with OpenSpec-only launch.
- CLI main now passes the parsed `--memory` override into launch resolution instead of constructing providers directly.
- Tests cover CLI/config/default precedence, no double-provider injection, Supermemory construction, Pi MCP fallback, and token/header redaction. No Supermemory token was stored, printed, or persisted in repo files.

### Task 13: TUI Provider Selection and Supermemory Setup
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — modify
- `apps/cli/src/tui/developer-team-flow.test.tsx` — modify

**Verification**
- Frontend Tests: pass — `bun test apps/cli/src/tui`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Replaced the prior Supermemory credential handoff stub with the Task 15 Pi MCP config writer integration.
- Supermemory setup still prompts for token, required `userId`, optional `teamId`, and optional `orgId`.
- The token is passed only to `writeSupermemoryPiMcpConfig()` for the external Pi global MCP config (`~/.pi/agent/mcp.json`) and is not persisted to `.deck/config.json`.
- The writer configures the default `supermemory` server entry with `https://supermemory-new.stlmcp.com` and the `x-supermemory-api-key` header; UI status/error text redacts the credential value.
- `.deck/config.json` persistence occurs only after the Pi MCP writer succeeds for Supermemory, so a failed writer surfaces an actionable setup error instead of marking Supermemory active.
- Added TUI tests for real temp-path Pi MCP writer invocation, external-file header persistence, status redaction, mocked writer failure handling, and non-secret Deck config serialization.

### Task 14: Documentation — Pi Agent Installation
**Status**: ✅ Complete
**Files Changed**
- `docs/pi-agent-installation.md` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/apply-progress.md` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/state.yaml` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/events.yaml` — modify

**Verification**
- Documentation review: pass — `docs/pi-agent-installation.md` covers Pi-first Supermemory setup, external `~/.pi/agent/mcp.json` credential boundary, required `userId`, optional `teamId`/`orgId`, fallback behavior, active-provider switching, no Engram migration, team-candidate status, and OpenSpec authority.
- Tests: skipped — documentation/registry-only task; no product code changed.
- Build: skipped — no product code changed.
- Typecheck: skipped — no TypeScript changed.

**Notes**
- Added a dedicated Supermemory MCP adaptive-memory setup section to the Pi installation documentation.
- Documented that the Supermemory token must not be stored in `.deck/config.json`, OpenSpec artifacts, generated repo files, logs, tests, or AI memory.
- Documented fail-closed behavior: if Supermemory config/validation is unavailable, Pi sessions continue with OpenSpec-only context and a redacted adaptive-memory absence warning.

### Task 15: Pi Global MCP Config Writer for Supermemory
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/pi-mcp-config.ts` — create
- `packages/adapter-pi/src/pi-mcp-config.test.ts` — create
- `packages/adapter-pi/src/index.ts` — modify

**Verification**
- Backend Tests: pass — `bun test packages/adapter-pi/src/pi-mcp-config.test.ts`
- Build: skipped — no project build script is defined for this workspace.
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- Added `writeSupermemoryPiMcpConfig()` / `configureSupermemoryPiMcpConfig()` to create, merge, validate, and atomically write the external Pi global MCP config at `~/.pi/agent/mcp.json` by default.
- The writer adds or updates only the configured server entry (`supermemory` by default) with HTTP URL `https://supermemory-new.stlmcp.com` and header `x-supermemory-api-key` containing the caller-supplied token.
- The approved secret boundary is the local Pi runner installation config (`~/.pi/agent/mcp.json`), not the project, OpenSpec, generated prompts, or AI memory.
- Unrelated MCP servers and unrelated top-level config fields are preserved; malformed JSON and conflicting unmergeable shapes fail closed without partial writes.
- Directory/file permission hardening is attempted on a best-effort basis (`0700` parent directory, `0600` config file where supported), returning redacted warnings if unsupported.
- Diagnostics and redaction helpers do not expose the token or header value. Tests use a sentinel token and assert it appears only in the temp external MCP config fixture.
- Exported the module from `packages/adapter-pi/src/index.ts` for follow-up TUI/launch integration.

## Review Remediation Pass

**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/developer-team-flow.test.tsx` — modify
- `apps/cli/src/pi-launch-command.ts` — modify
- `packages/adapter-pi/src/pi-mcp-config.ts` — modify
- `packages/adapter-pi/src/pi-mcp-config.test.ts` — modify
- `packages/adapter-pi/src/developer-team-install.ts` — modify
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify
- `packages/adapter-supermemory/src/index.ts` — modify
- `packages/adapter-supermemory/src/index.test.ts` — modify
- `packages/core/src/config/deck-config.ts` — modify
- `docs/pi-agent-installation.md` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/apply-progress.md` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/state.yaml` — modify
- `openspec/changes/add-supermemory-mcp-memory-provider/events.yaml` — modify

**Verification**
- Tests: pass — `bun test packages/adapter-pi/src/pi-mcp-config.test.ts packages/adapter-pi/src/developer-team-install.test.ts`
- Tests: pass — `bun test packages/adapter-supermemory`
- Tests: pass — `bun test apps/cli/src/tui/developer-team-flow.test.tsx apps/cli/src/pi-launch-command.supermemory.test.ts`
- Typecheck: pass — `bunx tsc --noEmit --pretty false`

**Notes**
- TUI Supermemory setup now constructs a Supermemory provider for the immediate Developer Team install after the external Pi MCP writer succeeds, while still persisting only non-secret `.deck/config.json` settings.
- Launch no longer marks local/static Pi MCP config validation as authenticated runtime validation; Supermemory health remains degraded until an online runtime probe has passed, and tool injection fails closed without authenticated runtime validation.
- Pi MCP diagnostics now redact quoted JSON secrets, token/API key fields, authorization values, bearer tokens, and env-style `SUPERMEMORY_API_KEY` values.
- Supermemory tool materialization preserves the configured server name for generic MCP tools by generating server-qualified names such as `supermemory.execute` / `supermemory.search_docs` or `customSupermemory.execute` / `customSupermemory.search_docs` in Pi frontmatter.
- Search modes were aligned to the adapter-supported `memories`/`documents` set, the Task 14 setup flow docs were reordered to persist `.deck/config.json` only after external MCP writer success, and the Developer Team install effect now depends on `memoryProvider`.
- The previously blocking `.backups/pi-agent-before-agent-discovery-20260515-155018` secret-bearing backup directory was removed by the orchestrator before this remediation pass.
- A generated `.deck/pi/sessions` directory containing sensitive session logs was also removed by the orchestrator after Verify identified it as a generated ignored repo artifact.

## In-Progress Tasks

None.

## Blocked Tasks

None.

## Remaining Tasks

None.
