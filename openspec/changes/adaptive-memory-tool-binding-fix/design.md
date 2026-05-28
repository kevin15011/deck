# Design: Adaptive Memory Tool Binding Fix

## Source

- Proposal: `adaptive-memory-tool-binding-fix` proposal artifact
- Capabilities affected:
  - `opencode-supermemory-auth-probe` (new)
  - `adaptive-memory-provider-supermemory` (modified)
  - `runner-opencode-manifest` (modified)
  - `adaptive-memory-instructions` (modified)
- Spec status: not yet available

## Current Architecture Context

### Memory injection pipeline

1. **CLI/TUI** creates an `AdaptiveMemoryProvider` (e.g., `createSupermemoryMemoryProvider(...)`) and passes it to the adapter's install-plan builder.
2. **Adapter install-plan builder** (`buildOpenCodeDeveloperTeamInstallPlan`) calls `resolveOpenCodeMemoryInjection`, which delegates to core `resolveMemoryInjection`. If a provider is supplied, `resolveMemoryInjection` calls `provider.buildInjection()` and returns a `MemoryInjectionBundle`.
3. **Adapter install-plan builder** uses the bundle to compose memory instructions into skill/agent content via `composeAdaptiveMemory`, but does **not** expose the bundle on the returned plan object.
4. **Adapter manifest builder** (`buildDeveloperTeamManifest` in `runner-capabilities.ts`) rebuilds the install plan internally but then hardcodes `memoryBundle: undefined` for every agent and skill in the manifest (lines 219, 227).
5. **Supermemory adapter** `commit()` always returns `savedCount: 0` with a discard reason, even after governance validation passes.
6. **OpenCode adapter** has no authenticated-runtime probe for Supermemory. Pi has `validateSupermemoryPiMcpConfig` in `pi-mcp-config.ts`; OpenCode has nothing equivalent.
7. **Instruction bundle** (`adaptive-memory.ts`) lists generic triggers ("save after architecture decisions") but gives no concrete examples, no suggested topic keys, and no decision matrix.

### Key files and their roles

| File | Role |
|---|---|
| `packages/adapter-opencode/src/runner-capabilities.ts` | Factory that composes all OpenCode `RunnerCapabilities`. `buildDeveloperTeamManifest` hardcodes `memoryBundle: undefined`. |
| `packages/adapter-opencode/src/developer-team-install.ts` | Builds the OpenCode install plan. Calls `resolveOpenCodeMemoryInjection` but does not expose the returned bundle on the plan. |
| `packages/adapter-supermemory/src/index.ts` | Supermemory provider factory. `commit()` discards all candidates. `health()` gates on `authenticatedRuntimeValidated`. |
| `packages/adapter-opencode/src/opencode-mcp-config.ts` | Writes Supermemory MCP config to `opencode.json`. No validation/read function exists. |
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | Canonical instruction fragments for all three surfaces (agent, session, skill). |
| `packages/adapter-pi/src/pi-mcp-config.ts` | Reference implementation: `validateSupermemoryPiMcpConfig` reads `~/.pi/agent/mcp.json` and validates structure + credentials. |

## Proposed Architecture

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/adapter-opencode/src/developer-team-install.ts` | Expose `memoryBundle` on `OpenCodeDeveloperTeamInstallPlan`; add auth-probe wrapper around `resolveOpenCodeMemoryInjection`. | Modified |
| `packages/adapter-opencode/src/runner-capabilities.ts` | Read `memoryBundle` from plan instead of hardcoding `undefined`. | Modified |
| `packages/adapter-opencode/src/opencode-mcp-config.ts` | Add `validateSupermemoryOpenCodeMcpConfig` (read + validate `opencode.json` MCP section). | Modified |
| `packages/adapter-supermemory/src/index.ts` | Add `apiKey` to config; implement real `fetch`-based persistence in `commit()`. | Modified |
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | Add concrete examples, topic keys, and save-trigger matrix to all three surfaces. | Modified |

### Data Flow

```
┌─────────────────┐     ┌──────────────────────────────┐     ┌─────────────────────────┐
│  CLI/TUI caller │────▶│ buildOpenCodeDeveloperTeam   │────▶│ resolveOpenCodeMemory   │
│ (passes provider│     │ InstallPlan                  │     │ Injection               │
│  + options)     │     │                              │     │                         │
└─────────────────┘     └──────────────────────────────┘     └─────────────────────────┘
                                                                        │
                                                                        ▼
                                                               ┌─────────────────────────┐
                                                               │ validateSupermemory     │
                                                               │ OpenCodeMcpConfig       │
                                                               │ (reads opencode.json)   │
                                                               └─────────────────────────┘
                                                                        │
                                                                        ▼
                                                               ┌─────────────────────────┐
                                                               │ MemoryInjectionBundle   │
                                                               │ (returned on plan)      │
                                                               └─────────────────────────┘
                                                                        │
                                                                        ▼
                                                               ┌─────────────────────────┐
                                                               │ buildDeveloperTeam      │
                                                               │ Manifest                │
                                                               │ (uses plan.memoryBundle)│
                                                               └─────────────────────────┘
```

For persistence:

```
Agent / Orchestrator ──▶ adapter.commit(request)
                              │
                              ▼
                    governance validation
                              │
                              ▼
                    for each candidate:
                      fetch(SUPERMEMORY_API_URL, {
                        method: "POST",
                        headers: { "x-supermemory-api-key": apiKey },
                        body: JSON.stringify({ ... })
                      })
                              │
                              ▼
                    per-candidate decision
                    (accepted: true/false + reason)
```

### API / Contract Implications

| Interface | Change | Backward Compatible |
|---|---|---|
| `OpenCodeDeveloperTeamInstallPlan` | Add optional field `memoryBundle?: MemoryInjectionBundle` | Yes — new optional field |
| `SupermemoryMemoryProviderConfig` | Add optional field `apiKey?: string` | Yes — new optional field |
| `SupermemoryMemoryProviderConfig` | Add optional field `mcpServerUrl?: string` (fallback for OpenCode vs Pi endpoints) | Yes — new optional field |
| `AdaptiveMemoryAdapter.commit()` | Returns `savedCount > 0` when persistence succeeds | Yes — callers already expect this; only tests need updating |

### State / Persistence Implications

- **No schema migrations.** The Supermemory adapter currently discards everything; after the change it will persist to the external Supermemory service. No local state changes.
- The `apiKey` is **not** stored in `.deck/config.json`. It is either passed at runtime from the caller (which reads it from the runner-specific MCP config) or read from the `SUPERMEMORY_API_KEY` environment variable.

### Migration / Backward Compatibility

- **Rollback**: Revert the four modified files. The four fixes are independent; partial rollback is safe.
- **Fail-open**: If the auth probe fails, injection is skipped and agents continue working without memory (same behavior as today).
- **Pi adapter**: Pi's `runner-capabilities.ts` has the same `memoryBundle: undefined` hardcoding, but fixing it is out of scope per the proposal.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/adapter-opencode/src/runner-capabilities.ts` | Modify | Replace hardcoded `memoryBundle: undefined` with `plan.memoryBundle` in agents and skills arrays. |
| `packages/adapter-opencode/src/developer-team-install.ts` | Modify | Add `memoryBundle` to `OpenCodeDeveloperTeamInstallPlan` type and return value; enhance `resolveOpenCodeMemoryInjection` with auth-probe logic for Supermemory. |
| `packages/adapter-opencode/src/opencode-mcp-config.ts` | Modify | Add `validateSupermemoryOpenCodeMcpConfig` function mirroring Pi's validator pattern. |
| `packages/adapter-supermemory/src/index.ts` | Modify | Add `apiKey`/`mcpServerUrl` to config; replace discard logic in `commit()` with `fetch`-based persistence. |
| `packages/adapter-supermemory/src/index.test.ts` | Modify | Update tests: mock `fetch`, assert successful persistence, assert error propagation, assert missing-key fallback behavior. |
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | Modify | Add concrete examples table, suggested topic keys, and save-trigger matrix to agent/session/skill fragments. |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | Modify | Add tests for auth-probe pass/fail paths in `resolveOpenCodeMemoryInjection`. |
| `packages/adapter-opencode/src/opencode-mcp-config.test.ts` | Create or modify | Add tests for `validateSupermemoryOpenCodeMcpConfig`. |

## Testing Strategy

| Layer | Test Type | Coverage |
|---|---|---|
| `adapter-supermemory` | Unit | Mock `fetch` globally. Test: (a) successful commit persists all candidates, (b) failed commit returns per-candidate errors, (c) missing `apiKey` falls back to env var, (d) governance rejection still returns `savedCount: 0`. |
| `adapter-opencode` developer-team-install | Unit | Mock `opencode.json` existence/content. Test: (a) valid MCP config → bundle returned, (b) missing config → bundle omitted with diagnostic, (c) invalid config → bundle omitted with diagnostic. |
| `adapter-opencode` runner-capabilities | Unit | Test `buildDeveloperTeamManifest` returns `memoryBundle` when plan includes one. |
| `adapter-opencode` opencode-mcp-config | Unit | Test validator against valid, missing, malformed, and wrong-URL configs. |
| Instruction bundle | Snapshot / string | Assert new sections (examples, topic keys, matrix) appear in all three surface fragments. |

## Observability / Error Handling

- **Auth probe failures**: Emit structured `MemoryDiagnostic` with `code: "memory_provider_unavailable"` and redacted path info. Never log the API key.
- **Commit failures**: Per-candidate `decision` includes the error message as `reason`. Adapter diagnostics include `code: "ADAPTIVE_MEMORY_OPERATION_UNSUPPORTED"` (or a new code if appropriate).
- **Health**: `health()` continues to return `degraded` until `authenticatedRuntimeValidated` is set to `true` by the auth probe.

## Security / Performance / Accessibility Considerations

- **Security**: API keys are never stored in `.deck/config.json`. The adapter accepts `apiKey` at runtime only. The OpenCode validator reads `opencode.json` but the actual key lives in the `SUPERMEMORY_API_KEY` env var (referenced via `{env:SUPERMEMORY_API_KEY}` interpolation). Redaction helpers from Pi (`redact`, `redactDiagnostic`) should be reused or mirrored.
- **Performance**: `commit()` makes one `fetch` per candidate. For typical sessions (≤7 candidates) this is negligible. No batch endpoint is known; if one exists, it can be adopted later.
- **Accessibility**: N/A — backend change only.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Adapter persistence mechanism | Native `fetch` to Supermemory HTTP endpoint | Add MCP client dependency to adapter | Adapter has no MCP client today. Adding one (e.g., `@modelcontextprotocol/sdk`) introduces a new dependency and coupling. Native `fetch` is sufficient for a single POST endpoint. |
| API key source | `config.apiKey` with `process.env.SUPERMEMORY_API_KEY` fallback | Read API key directly from Pi/OpenCode MCP config inside adapter | Adapter should remain runner-agnostic. Pi and OpenCode store credentials in different formats (raw header vs env-var interpolation). Pushing credential sourcing to the caller keeps the adapter clean. |
| Auth probe location | `opencode-mcp-config.ts` + `developer-team-install.ts` | Centralize in core | Core is runner-agnostic; probe logic is runner-specific (different config files, different schemas). Keeping it in the adapter mirrors the Pi pattern. |
| OpenCode validator scope | Structure validation only (can't extract key from `{env:...}` interpolation) | Also resolve env var inside validator | The validator's job is to confirm the MCP config is correctly set up. Key extraction happens at runtime (env var or caller-provided `apiKey`). This matches Pi's validator which validates structure + raw key presence. |
| `commit()` payload shape | Direct HTTP POST mimicking `client.add` | Actual MCP `execute` tool call | Adapter is not an MCP client. The exact REST schema for Supermemory `add` is TBD (open decision). Using a simple POST is the pragmatic interim. |
| Instruction enhancement | In-place additions to canonical bundle | Separate "examples" skill | Fragmentation would force agents to read two documents. In-place additions are additive (no existing rules removed) and keep instructions self-contained. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Exact Supermemory REST API for `add` is unknown | Medium | High — blocks implementation of `commit()` | Flag as open decision. Interim implementation can use a placeholder endpoint with a clear TODO; the architecture (per-candidate fetch, error handling, decision mapping) is independent of the exact URL/path. |
| `fetch`-based persistence fails in environments without network | Low | Medium | `commit()` is fail-open: wrap each call in try/catch, return `accepted: false` with error reason, and continue with remaining candidates. |
| Changing `commit()` contract breaks existing tests | Medium | Low | Tests already cover discard behavior. Update them to mock `fetch` (Bun has native `fetch` mocking patterns). Preserve governance-rejection tests as-is. |
| Auth probe fails on missing/bad OpenCode config | Medium | Low | Probe follows Pi's fail-closed pattern: skip injection, emit diagnostic, agents continue without memory. |
| `memoryBundle` resolution still returns undefined if no caller passes `memoryProvider` | Medium | Medium | The design exposes `memoryBundle` from the plan, but the plan only has a bundle when a provider is passed. This is documented; callers (CLI/TUI) already pass providers in the install path. The manifest path may need a follow-up to wire provider creation. |

## Open Decisions

1. **Exact Supermemory REST endpoint and payload for `client.add`/`client.memories.updateMemory`.** The proposal mentions these SDK methods but the underlying HTTP contract is not documented in the codebase. The Task Agent will need to either:
   - Inspect the Supermemory MCP server schema or documentation to determine the REST equivalent, OR
   - Implement against a known endpoint (e.g., `POST /api/memories/add`) with a documented TODO for correction.
   *Decision owner: Task Agent or domain expert with Supermemory API knowledge.*

2. **Should `mcpServerUrl` default differ for OpenCode vs Pi?** Pi uses `https://supermemory-new.stlmcp.com`; OpenCode's config writer uses `https://mcp.supermemory.ai/mcp`. The adapter hardcodes `SUPERMEMORY_MCP_SERVER_URL = "https://supermemory-new.stlmcp.com"`. If these are different services, the adapter needs a runtime override.
   *Decision owner: Task Agent with runtime validation.*

3. **Should Pi's `runner-capabilities.ts` also be fixed?** It has the identical `memoryBundle: undefined` hardcoding. Out of scope per proposal, but a one-line fix could be bundled.
   *Decision owner: Orchestrator / user.*

## Dependencies

- No new npm dependencies expected. The adapter will use native `fetch` (available in Bun/Node 18+).
- OpenCode MCP config (`~/.config/opencode/opencode.json`) must contain a valid `mcp.supermemory` entry for the auth probe to succeed. This is managed by the OpenCode runtime / TUI setup flow, not by this change.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.

## Mermaid Summary Source

```mermaid
flowchart TB
    subgraph CLI["CLI / TUI"]
        C1[createSupermemoryMemoryProvider<br/>with apiKey]
    end
    subgraph OpenCode["@deck/adapter-opencode"]
        A[runner-capabilities.ts<br/>buildDeveloperTeamManifest]
        B[developer-team-install.ts<br/>buildOpenCodeDeveloperTeamInstallPlan]
        P[opencode-mcp-config.ts<br/>validateSupermemoryOpenCodeMcpConfig]
    end
    subgraph Supermemory["@deck/adapter-supermemory"]
        D[commit() → fetch POST]
        E[health() + auth state]
    end
    subgraph Core["@deck/core"]
        F[adaptive-memory.ts<br/>instruction bundle]
        G[resolveMemoryInjection]
    end
    subgraph Runtime["OpenCode Runtime"]
        H[opencode.json<br/>mcp.supermemory]
    end

    C1 -->|memoryProvider| B
    B -->|calls| G
    G -->|if supermemory| P
    P -->|validates| H
    P -->|bundle + diagnostics| B
    B -->|memoryBundle on plan| A
    A -->|agents/skills with bindings| Manifest[DeveloperTeamManifest]
    D -->|HTTP POST| SM[Supermemory API]
    F -->|concrete examples| A
```
