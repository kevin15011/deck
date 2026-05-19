# Apply Progress: Adaptive Memory Adapter with Engram Injection

## Completed Tasks

### Task 1: Create adaptive memory injection contract types and compositor
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory.ts` — create
- `packages/core/src/index.ts` — modify
- `packages/core/package.json` — modify

**Verification**
- Tests: pass — `bun test packages/core/src/memory/adaptive-memory.test.ts packages/core/src/teams/developer/content-registry.test.ts`
- Build: skipped — no project build script is defined in `package.json`
- Typecheck: pass — `bunx tsc --noEmit`

**Notes**
Added provider-neutral adaptive memory types, provider interface, bundle/tool binding contract, and `composeAdaptiveMemory()` helper. The compositor appends `## Adaptive Memory (provider-injected)` only when instruction fragments match the requested surface/context and returns provider tool bindings unchanged when a bundle is supplied.

### Task 2: Write core compositor unit tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory.test.ts` — create

**Verification**
- Tests: pass
- Build: skipped
- Typecheck: pass

**Notes**
Covered disabled/default behavior, single provider injection, session/agent/skill filtering, tool binding pass-through, and the mandatory auxiliary-memory/OpenSpec authority policy in composed output.

### Task 3: Remove Engram-specific content from core Developer Team prompts
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify

**Verification**
- Tests: pass
- Build: skipped
- Typecheck: pass
- Grep: pass — non-test developer content files contain no `engram`/`Engram` matches

**Notes**
Removed the provider-specific Engram example from the core orchestrator prompt while preserving provider-neutral auxiliary memory guidance.

### Task 4: Create Engram adapter package with provider implementation
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-engram/package.json` — create
- `packages/adapter-engram/src/index.ts` — create

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Created the `@deck/adapter-engram` package implementing `AdaptiveMemoryProvider`. The provider produces session, agent, and skill instruction fragments for the developer-team, with the auxiliary-memory policy stating OpenSpec remains authoritative. Tool binding metadata maps neutral capabilities (memory.search, memory.read, memory.write) to `memory_*` prefixed Engram MCP tool names under the `engram` server. Generic aliases (`read`, `write`, `search`) are intentionally excluded to avoid collisions with built-in runtime tools. Provider is marked experimental with a clear disclaimer. No Engram names leak into core.

### Task 5: Write Engram adapter tests
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-engram/src/index.test.ts` — create

**Verification**
- Tests: pass — 17 tests
- Build: pass
- Typecheck: pass

**Notes**
Tests cover: provider id/displayName, fragment surfaces, auxiliary policy presence, safety guidance prohibiting secrets/PII, tool binding metadata structure, experimental marker, rejection patterns for unsupported-provider content, teamId filtering, Engram MCP tool usage instructions with memory_* prefix, absence of generic aliases (`read`, `write`, `search`) in command listings, and integration with centralized `resolveMemoryInjection` for supported/unsupported provider ID validation.

### Task 6: Extend Pi adapter install and profile with memory composition
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/developer-team-install.ts` — modify
- `packages/adapter-pi/src/pi-team-profile.ts` — modify
- `packages/adapter-pi/src/pi-team-profile.test.ts` — modify
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify

**Verification**
- Tests: pass — 35 tests including new regression tests
- Build: pass
- Typecheck: pass

**Notes**
Extended `buildDeveloperTeamInstallPlan` with optional `memoryProvider`/`memoryInjection` options. Uses centralized `resolveMemoryInjection` from `@deck/core` with provider ID validation. When provided, the compositor injects Adaptive Memory sections per surface (agent, skill) and adds Engram tool names to Pi frontmatter `tools:` line. Extended `buildTeamSystemPrompt` to return `{ content, memoryDiagnostics }`. Extended `materializeTeamProfile` to accept `memoryProvider`/`memoryInjection`. Default (undefined) produces byte-equivalent output. Added fail-closed diagnostics for unsupported provider IDs (`unsupported_memory_provider`) and unavailable providers (`memory_provider_unavailable`). Tool bindings are now scoped to surfaces that have matching instruction fragments.

### Task 7: Extend OpenCode adapter install with memory composition
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/developer-team-install.ts` — modify
- `packages/adapter-opencode/src/developer-team-install.test.ts` — modify

**Verification**
- Tests: pass — 25 tests including new regression tests
- Build: pass
- Typecheck: pass

**Notes**
Extended `buildOpenCodeDeveloperTeamInstallPlan` with optional `memoryProvider`/`memoryInjection` options. Uses centralized `resolveMemoryInjection` from `@deck/core`. Fail-closed on invalid/unsupported providers. When provided, compositor injects Adaptive Memory sections per surface and adds memory tool names to OpenCode `tools:` frontmatter. Added regression tests for unsupported provider ID rejection (REQ-AMI-003).

### Task 8: Wire CLI/TUI provider selection into Pi Developer Team flow
**Status**: ✅ Complete (with fixes)
**Files Changed**
- `apps/cli/src/cli-args.ts` — modify
- `apps/cli/src/cli-args.test.ts` — modify
- `apps/cli/src/main.tsx` — modify
- `apps/cli/src/pi-launch-command.ts` — modify
- `apps/cli/src/pi-launch-command.test.ts` — modify

**Verification**
- Tests: pass — 28 tests including new regression tests
- Build: pass
- Typecheck: pass

**Notes**
Added `--memory=engram` CLI flag with validation against `SUPPORTED_MEMORY_PROVIDERS`. `main.tsx` resolves the provider and adds an experimental warning. `runPiLaunch` now also calls `buildDeveloperTeamInstallPlan` + `applyDeveloperTeamInstall` when a memory provider is provided, ensuring `--memory=engram` guarantees runtime binding metadata for agent/skill content, not just the session profile (fixes REQ-AMI-002 gap). The `resolveMemoryProvider` function in `main.tsx` also validates against `SUPPORTED_MEMORY_PROVIDER_IDS` from core. Added `PiLaunchResult.error.memoryDiagnostics` field for consistent diagnostic access across all result branches.

## Fix Round: Verify FAIL + Review REQUEST CHANGES

### Fix 1: `--memory=engram` must guarantee runtime binding metadata (Critical/Major)
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/pi-launch-command.ts` — modify

**Notes**
When a memory provider is provided, `runPiLaunch` now also calls `buildDeveloperTeamInstallPlan` + `applyDeveloperTeamInstall` to materialize Developer Team agent and skill files with memory tool bindings. This ensures that `--memory=engram` guarantees runtime binding metadata for agent/skill content, not just the session profile. Fixes the scenario: "Selected provider is injected" from REQ-AMI-002.

### Fix 2: Unsupported/unavailable providers must produce observable diagnostics and not silently inject (Critical/Major)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory.ts` — modify
- `packages/adapter-pi/src/developer-team-install.ts` — modify
- `packages/adapter-pi/src/pi-team-profile.ts` — modify
- `packages/adapter-opencode/src/developer-team-install.ts` — modify
- `apps/cli/src/main.tsx` — modify

**Notes**
Added `SUPPORTED_MEMORY_PROVIDER_IDS`, `MemoryDiagnostic` type, and centralized `resolveMemoryInjection()` to core. All adapters now import and use the centralized resolver. Provider IDs are validated against the supported set — unknown IDs produce `unsupported_memory_provider` diagnostics and no injection content. `composeAdaptiveMemory` now returns empty `toolBindings` when no fragments match the target surface, preventing tool bindings from being added to surfaces that don't receive memory guidance. The `resolveMemoryProvider` in `main.tsx` also validates against `SUPPORTED_MEMORY_PROVIDER_IDS`.

### Fix 3: Remove placeholder/generic Engram MCP tool names and gate as experimental (Major)
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-engram/src/index.ts` — modify
- `packages/adapter-engram/src/index.test.ts` — modify
- `apps/cli/src/cli-args.ts` — modify
- `apps/cli/src/main.tsx` — modify

**Notes**
Removed generic tool name aliases (`search`, `read`, `write`) from Engram tool bindings, keeping only `memory_*` prefixed names (`memory_search`, `memory_read`, `memory_write`). Updated instruction fragments to reference only `memory_*` commands. Added `Experimental` marker to `displayName` and to all fragment headings. Added clear experimental disclaimer in the provider JSDoc. `main.tsx` prints an experimental warning when `--memory=engram` is used. CLI help text notes experimental status.

### Fix 4: Add memory safety guidance prohibiting secrets/sensitive data (Major)
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-engram/src/index.ts` — modify
- `packages/adapter-engram/src/index.test.ts` — modify

**Notes**
Added `MEMORY_SAFETY_POLICY` constant to Engram adapter with explicit guidance: "Never store secrets, API keys, credentials, tokens, private keys, raw customer/PII data, or other sensitive information in Engram. Store only redacted summaries and non-sensitive context." This policy is appended to all three instruction fragments (session, agent, skill). Added test verifying `never store` appears in all fragments.

### Fix 5: Centralize memory provider resolution and use actual target team ID (Minor)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory.ts` — modify (added `resolveMemoryInjection`)
- `packages/adapter-pi/src/developer-team-install.ts` — modify (replaced local resolver)
- `packages/adapter-pi/src/pi-team-profile.ts` — modify (replaced local resolver, import from developer-team-install)
- `packages/adapter-opencode/src/developer-team-install.ts` — modify (replaced local resolver)

**Notes**
Centralized `resolveMemoryInjection()` function in `@deck/core/memory/adaptive-memory.ts`. All three adapters now delegate to this centralized resolver, which includes provider ID validation against `SUPPORTED_MEMORY_PROVIDER_IDS`. The `resolvePiMemoryInjection` wrapper preserves the Pi-specific import point for future extension. Pi profile imports `MemoryDiagnostic` from `developer-team-install.ts` to avoid duplicate re-exports. The centralized resolver uses `context.teamId` from `buildInjection` (still defaults to `"developer-team"` when called from the resolver).

### Fix 6: Make tool binding scope explicit (Minor)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory.ts` — modify

**Notes**
Modified `composeAdaptiveMemory()` to return empty `toolBindings` when no matching fragments are found for the target surface. Previously, tool bindings were returned even when no fragments matched, which could result in memory tool names appearing in agent frontmatter without corresponding guidance. Now tool bindings are only propagated when at least one instruction fragment matches, ensuring bindings are scoped to surfaces that actually receive memory guidance.

### Fix 7: Align diagnostic naming and test names (NIT)
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify
- `packages/adapter-opi/src/pi-team-profile.test.ts` — modify
- `packages/adapter-opencode/src/developer-team-install.test.ts` — modify
- `apps/cli/src/pi-launch-command.test.ts` — modify

**Notes**
Renamed test from "reports unsupported_memory_provider diagnostic when provider throws" to "reports memory_provider_unavailable diagnostic when provider buildInjection throws" in pi-launch-command test, matching the actual diagnostic code. Aligned all adapter tests to use `id: "engram"` for broken-but-supported provider tests and separate `id: "unknown-provider"` for unsupported ID tests. Updated `MemoryDiagnostic` type to be imported consistently from core across all adapters.

## Verification Summary

- **Full test suite**: 626 pass / 0 fail / 2455 expect() calls
- **Typecheck**: pass — `bunx tsc --noEmit`
- **Core Engram-free**: verified — `grep -ri "engram" packages/core/src/teams/developer/*.ts` returns no results (excluding test files)
- **Engram tool bindings**: verified — only `memory_*` prefixed names, no generic aliases (`read`, `write`, `search`)
- **Safety guidance**: verified — `MEMORY_SAFETY_POLICY` present in all Engram fragments with "Never store secrets" language
- **Experimental marker**: verified — `displayName` includes "Experimental", fragment headings include "Experimental"
- **Unsupported provider rejection**: verified — `resolveMemoryInjection` returns `unsupported_memory_provider` for unknown IDs
- **`--memory=engram` guarantees bindings**: verified — `runPiLaunch` materializes agent/skill files when provider is passed
- **Tool binding scoping**: verified — `composeAdaptiveMemory` returns empty `toolBindings` when no fragments match

## In-Progress Tasks

None.

## Blocked Tasks

None.

## Remaining Tasks

None — all assigned tasks and fix round are complete.
## Fix Round 2: Remaining Review MAJOR Findings

### Fix Round 2.1: Core provider-neutrality
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/memory/adaptive-memory.ts` — modify
- `packages/core/src/memory/adaptive-memory.test.ts` — modify
- `packages/adapter-engram/src/index.test.ts` — modify
- `packages/adapter-pi/src/developer-team-install.ts` — modify
- `packages/adapter-pi/src/pi-team-profile.ts` — modify
- `packages/adapter-opencode/src/developer-team-install.ts` — modify
- `apps/cli/src/main.tsx` — modify
- `apps/cli/src/pi-launch-command.ts` — modify

**Verification**
- Backend Tests: pass — focused backend tests and full `bun test` (627 pass / 0 fail)
- Build: skipped — no project build script is defined in `package.json`
- Typecheck: pass — `bunx tsc --noEmit`

**Notes**
Removed the concrete Engram provider ID/allowlist from non-test `packages/core/src`. `resolveMemoryInjection()` now remains provider-neutral and validates provider IDs against a caller-injected `supportedProviderIds` registry, failing closed when no registry is supplied. Pi/OpenCode/CLI surfaces own or inject their provider allowlists outside core. Verified `grep -RIn --exclude='*.test.ts' --exclude='*.spec.ts' -i 'engram' packages/core/src` returns no results.

### Fix Round 2.2: Preserve Pi model/thinking config during memory launch materialization
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/pi-launch-command.ts` — modify
- `apps/cli/src/pi-launch-command.test.ts` — modify

**Verification**
- Backend Tests: pass — focused `apps/cli/src/pi-launch-command.test.ts` and full `bun test` (627 pass / 0 fail)
- Build: skipped — no project build script is defined in `package.json`
- Typecheck: pass — `bunx tsc --noEmit`

**Notes**
`runPiLaunch()` now reads existing Developer Team model/thinking assignments from `.pi/agents` before materializing memory bindings and passes both assignment maps into `buildDeveloperTeamInstallPlan()`. Added a regression test with a pre-existing orchestrator model/thinking assignment; `--memory=engram` now preserves the frontmatter and launch args while adding memory bindings.

## Verification Summary — Fix Round 2

- **Focused tests**: pass — `bun test packages/core/src/memory/adaptive-memory.test.ts packages/adapter-engram/src/index.test.ts apps/cli/src/pi-launch-command.test.ts packages/adapter-pi/src/developer-team-install.test.ts packages/adapter-pi/src/pi-team-profile.test.ts packages/adapter-opencode/src/developer-team-install.test.ts` (118 pass / 0 fail)
- **Full test suite**: pass — `bun test` (627 pass / 0 fail)
- **Typecheck**: pass — `bunx tsc --noEmit`
- **Build**: skipped — no project build script is defined in `package.json`
- **Core Engram-free**: pass — non-test `packages/core/src` contains no `engram` matches

## Remaining Tasks — Fix Round 2

None — the two assigned remaining Review MAJOR findings are complete.
