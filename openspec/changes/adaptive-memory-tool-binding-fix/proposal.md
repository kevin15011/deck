# Proposal: Adaptive Memory Tool Binding Fix

## Intent

The adaptive memory system in Deck is currently non-functional for OpenCode agents. Four root causes have been identified:

1. **OpenCode does not inject memory tool bindings** — `runner-capabilities.ts` hardcodes `memoryBundle: undefined` for every agent (lines 219, 227), so no agent ever receives the `supermemory_memory` or `supermemory_recall` tool bindings.

2. **Supermemory authentication validation blocks all injection** — the adapter requires `authenticatedRuntimeValidated: true` before `health()` returns `available`, but OpenCode has no authenticated runtime probe equivalent to the Pi adapter's `validateSupermemoryPiMcpConfig` check. The adapter stays in `degraded` state and the runner skips injection.

3. **Adapter-supermemory does not persist memories** — `commit()` discards all candidates with reason "adapter does not persist memories directly" (line 77). Even if an agent knew the tools existed and tried to save, the adapter would reject every commit.

4. **Generic instructions lack actionable triggers** — the `adaptive-memory.ts` instruction bundle tells agents "save after architecture decisions" but provides no concrete examples of what qualifies, no suggested topic keys, and no decision matrix. Agents have no clear signal for when to call the memory tools.

Without fixing these four issues, agents cannot save or recall memories, rendering the entire adaptive memory subsystem useless.

## Goal

Enable real adaptive memory usage for OpenCode agents by: passing memory tool bindings through the runner manifest, making the Supermemory adapter actually persist commits, adding an OpenCode-side authentication probe, and making memory instructions concrete and actionable.

## Scope

### In Scope
- Fix `packages/adapter-opencode/src/runner-capabilities.ts` to resolve `memoryBundle` from the memory provider instead of hardcoding `undefined`
- Fix `packages/adapter-supermemory/src/index.ts` to implement real persistence in `commit()` via the MCP `execute` tool
- Add authenticated runtime probe for Supermemory in `packages/adapter-opencode/src/developer-team-install.ts` (mirroring the Pi adapter pattern)
- Enhance `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` with concrete decision examples, suggested topic keys, and a clearer save-trigger matrix

### Out of Scope
- Changing the memory provider model (Supermemory remains the active provider)
- Modifying OpenSpec artifact structure, Spec Registry schema, or the governance layer (`adaptive-memory-governance.ts`)
- Building a UI for memory review/promotion
- Migrating existing Engram memories
- Adding new memory providers

## Affected Capabilities

### New Capabilities
- `opencode-supermemory-auth-probe`: Runtime probe in OpenCode adapter that validates Supermemory MCP config before injecting tool bindings.

### Modified Capabilities
- `adaptive-memory-provider-supermemory`: `commit()` changes from "always discard" to "actually persist via MCP execute". `health()` may change interaction with `authenticatedRuntimeValidated`.
- `runner-opencode-manifest`: `buildDeveloperTeamManifest` changes to pass real `memoryBundle` values instead of `undefined`.
- `adaptive-memory-instructions`: The instruction bundle gains concrete examples and suggested topic keys.

### Unchanged Capabilities
- `adaptive-memory-governance`: Governance validators remain unchanged. The adapter must still pass validation before persisting.
- `adaptive-memory-composition`: `composeAdaptiveMemory` and `resolveMemoryInjection` in `@deck/core` remain provider-neutral.
- `pi-mcp-config`: The Pi adapter's Supermemory validation logic is used as a reference, not modified.

## Approach

1. **OpenCode runner-capabilities.ts**: Replace the hardcoded `memoryBundle: undefined` with a real resolution. The `buildDeveloperTeamManifest` function already calls `buildOpenCodeDeveloperTeamInstallPlan` with `supportedMemoryProviderIds`, and that function already resolves `memoryBundle` via `resolveOpenCodeMemoryInjection`. The manifest builder should read `memoryBundle` from `plan` and pass it into the `agents[]` and `skills[]` arrays instead of `undefined`.

2. **Adapter-supermemory commit()**: Replace the hardcoded discard logic with a real MCP `execute` call. After governance validation passes, for each candidate:
   - Call `execute` with `client.add` (or `client.memories.updateMemory` if the candidate has an existing ID)
   - Map the candidate's scope to the appropriate container tag
   - On success, mark `accepted: true`; on failure, mark `accepted: false` with the error as reason
   - Update `savedCount` and `discardedCount` accordingly
   - Wrap each call in try/catch to preserve fail-open semantics

3. **OpenCode developer-team-install.ts**: Add a `validateSupermemoryOpenCodeMcpConfig` helper (or reuse a shared helper if one exists) that checks the OpenCode MCP config for a Supermemory server entry with a valid API key. If validation passes and the binding metadata shows `authenticatedRuntimeValidated`, inject the bundle. If validation fails, emit a diagnostic and skip injection (same pattern as Pi adapter lines 160–202).

4. **Adaptive-memory instruction bundle**: Add to all three surfaces (agent, session, skill):
   - A "Decision Examples" table with 5–7 concrete scenarios (e.g., "User rejects a PR approach → save as `u:{user} preference: approach-rejected`")
   - A "Suggested Topic Keys" section mapping common work types to stable keys (e.g., `architecture/auth-model`, `performance/query-optimization`)
   - A "Save Trigger Matrix" that maps agent lifecycle moments to save actions

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Remove `authenticatedRuntimeValidated` gate entirely and always inject | Simplest fix, no probe needed | Removes the safety check that prevents injecting broken tool bindings. Pi adapter intentionally keeps this gate. |
| Let agents call raw MCP tools directly without adapter mediation | Bypasses the broken adapter entirely | Violates the adapter contract. Governance, container tag validation, and fail-open semantics would be bypassed. |
| Rewrite the entire memory subsystem with a different provider | Could avoid Supermemory-specific issues | Out of scope. The PRD chose Supermemory; switching providers is a separate change. |
| Add an in-memory cache for commits instead of real persistence | Faster, no network dependency | Not real adaptive memory. Cross-session continuity would not work. |
| Keep generic instructions and add a separate "examples" skill | Avoids modifying the canonical bundle | Fragmentation. Agents would need to read two documents to understand memory usage. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Changing the adapter `commit()` contract breaks existing tests | Medium | The adapter test file already tests the discard behavior. Update tests to mock MCP execute and assert real persistence paths. Preserve fail-open tests. |
| Authentication probe fails in some environments (missing config, bad key) | Medium | Probe follows the same fail-closed pattern as Pi: on failure, skip injection and emit a diagnostic. Agents continue working without memory — fail-open already exists. |
| Instruction changes confuse agents that were trained on the old text | Low | The new text is additive (examples + topic keys) and does not remove or contradict existing rules. |
| `memoryBundle` resolution in OpenCode picks up Engram instead of Supermemory | Low | `supportedMemoryProviderIds` is explicitly `["engram", "supermemory"]`; the core resolver already handles provider priority. |
| Commit via MCP `execute` fails silently and agents think memory was saved | Medium | Return per-candidate decisions with explicit `accepted` boolean and reason. Log diagnostics. Do not swallow errors. |

## Rollback Plan

1. Revert the four files to their pre-change state:
   - `packages/adapter-opencode/src/runner-capabilities.ts` — restore `memoryBundle: undefined`
   - `packages/adapter-supermemory/src/index.ts` — restore the discard-all `commit()` logic
   - `packages/adapter-opencode/src/developer-team-install.ts` — remove the auth probe helper and its call site
   - `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` — revert to the generic instruction text

2. If only one part fails, partial rollback is safe because the four fixes are independent:
   - Reverting only `runner-capabilities.ts` returns to the old no-injection behavior.
   - Reverting only `adapter-supermemory` returns to discard-all but preserves injection.
   - Reverting only the auth probe returns to unvalidated injection (functionally the same as before).
   - Reverting only instructions returns to the old text.

3. The existing fail-open behavior ensures that even with a partial or full rollback, agents continue working — they simply lose adaptive memory again.

## Dependencies

- The OpenCode MCP config (`opencode.json` or equivalent) must contain a valid Supermemory server entry for the auth probe to succeed. This is managed by the OpenCode runtime, not by this change.
- No new npm dependencies are expected. The adapter already references the MCP `execute` tool conceptually; this change only makes the call real.

## Open Questions

1. **Should `adapter-supermemory` use `client.add` directly, or is there another recommended endpoint for persisting memories?** The current instructions mention `client.add` and `client.memories.updateMemory`, but the exact SDK method for new memory creation needs confirmation.

2. **Should the OpenCode authentication probe be synchronous or async?** The Pi adapter's `validateSupermemoryPiMcpConfig` appears to be synchronous (reads a file). The OpenCode equivalent should follow the same pattern, but the install plan builder (`buildOpenCodeDeveloperTeamInstallPlan`) is currently synchronous. If config reading needs to be async, the signature may need to change.

3. **Does the `memoryBundle` object in `runner-capabilities.ts` need tool binding metadata to be serialized into the agent manifest, or does OpenCode's runner handle tool bindings separately?** The current manifest structure includes `memoryBundle: undefined` but the actual tool binding injection may happen via a different path.

4. **Should we update `loadContext` and `search` in `adapter-supermemory` to also perform real MCP calls, or only fix `commit` for now?** The Orchestrator's analysis focused on `commit` as the persistence blocker, but `loadContext` and `search` also return empty results.

## Acceptance Direction

- [ ] `buildDeveloperTeamManifest` returns agents and skills with non-undefined `memoryBundle` when a memory provider is configured and authenticated.
- [ ] `commit()` in `adapter-supermemory` returns `savedCount > 0` for valid candidates when the MCP execute call succeeds.
- [ ] `commit()` still returns `savedCount: 0` with diagnostics when governance validation fails (no regression).
- [ ] OpenCode developer team install emits a diagnostic when Supermemory MCP config is missing or invalid, instead of silently skipping injection.
- [ ] The adaptive-memory instruction bundle contains at least 5 concrete decision examples and a topic-key reference table.
- [ ] All existing adapter-supermemory tests pass after updating mocks to reflect real commit behavior.
- [ ] New tests cover: successful commit via MCP execute, failed commit with error propagation, and OpenCode auth probe pass/fail paths.
- [ ] No credentials are stored in `.deck/config.json`; tokens continue to live in OpenCode MCP config only.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.

## Mermaid Summary Source

```mermaid
flowchart TB
    subgraph OpenCode["@deck/adapter-opencode"]
        A[runner-capabilities.ts]
        B[developer-team-install.ts]
        C[auth probe]
    end
    subgraph Supermemory["@deck/adapter-supermemory"]
        D[commit() → MCP execute]
        E[health() + auth state]
    end
    subgraph Core["@deck/core"]
        F[adaptive-memory.ts instructions]
        G[resolveMemoryInjection]
    end
    subgraph Runtime["OpenCode Runtime"]
        H[opencode.json MCP config]
    end
    H -->|validates| C
    C -->|bundle + diagnostics| G
    G -->|memoryBundle| A
    A -->|agents/skills with bindings| B
    D -->|persist| SM[Supermemory MCP Server]
    F -->|concrete examples| A
```