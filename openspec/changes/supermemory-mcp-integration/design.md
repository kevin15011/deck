# Design: Fix Supermemory Adaptive Memory Adapter

## Source

- Proposal: supermemory-mcp-integration proposal artifact
- Capabilities affected: Adaptive memory injection, tool binding generation, health reporting
- Spec status: not yet available

## Current Architecture Context

The `@deck/adapter-supermemory` package exports `createSupermemoryMemoryProvider(config)` which returns an `AdaptiveMemoryProvider`.

Current behavior in `packages/adapter-supermemory/src/index.ts`:

- `buildInjection()` checks `normalized.authenticatedRuntimeValidated` and **throws** if `false`. This blocks ALL content generation — instruction fragments and tool bindings are unreachable.
- `health()` returns `"degraded"` when `authenticatedRuntimeValidated` is false, with a diagnostic. It does not perform or reflect any external probe; it merely mirrors the config flag at creation time.
- `createFragments()` and the tool binding creation logic are correct but unreachable in the unauthenticated state.
- The adapter methods (`loadContext`, `search`, `commit`) return empty stub responses with diagnostics, which is acceptable for a pure content-generator adapter.
- `resolveMemoryInjection()` in `@deck/core` catches the throw from `buildInjection()` and converts it into a `"memory_provider_unavailable"` diagnostic, resulting in **no bundle and no tool bindings**.

`hasAuthenticatedSupermemoryToolBindings()` in `@deck/adapter-pi` inspects `bundle.toolBindings` and checks `metadata.authenticatedRuntimeValidated === true` to decide whether to route MCP calls. If the bundle is never produced (due to the throw), no bindings exist and the runner cannot authenticate or route.

## Proposed Architecture

Separate content generation from auth validation. The adapter's `buildInjection()` must be a pure function of valid config, always producing `MemoryInstructionFragment[]` and `MemoryToolBinding[]`. Auth state is managed separately via `health()` and updated through the standard `configure()` contract.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/adapter-supermemory/src/index.ts` | Pure content generator: fragments + tool bindings. Internal auth state. `buildInjection` always succeeds. | modified |
| `packages/core/src/memory/adaptive-memory-contract.ts` | Extend `AdaptiveMemoryConfigureRequest` with `providerState?: Record<string, unknown>` to allow adapter-specific state updates without core contract changes. | modified |
| `packages/adapter-pi/src/developer-team-install.ts` | Consume tool bindings; no structural change, but bindings will now always be present (though metadata may flag them as unauthenticated). | unchanged |

### Data Flow

1. **Initialization**: Runner creates provider via `createSupermemoryMemoryProvider({ userId, ... })` with `authenticatedRuntimeValidated` defaulting to `false`.
2. **Injection**: Runner calls `provider.buildInjection({ teamId: "developer-team" })`.
   - Always returns `MemoryInjectionBundle` with instruction fragments for `session`, `agent`, `skill` surfaces.
   - Returns `MemoryToolBinding[]` with metadata:
     - `endpoint`: `SUPERMEMORY_MCP_SERVER_URL`
     - `requiresAuthenticatedExecuteProbe: true`
     - `authenticatedRuntimeValidated: false` (initially)
     - `serverQualifiedToolNamesRequired: true`
     - `serverQualifiedToolNames: ["supermemory.execute", "supermemory.search_docs"]`
3. **Composition**: `composeAdaptiveMemory()` injects fragments into prompts. Agent receives instructions that tools require authenticated runtime validation.
4. **Auth Probe**: Runner (or installer) uses the tool bindings metadata to route an MCP `execute` read-only probe (e.g., `client.profile`) via the actual MCP client.
5. **State Update**: On probe success, runner calls `provider.adapter!.configure({ providerId: "supermemory", providerState: { authenticatedRuntimeValidated: true } })`.
   - Adapter updates its internal closure state.
6. **Health**: Runner may call `provider.health()` or `provider.adapter!.health()`.
   - Returns `"available"` if `authenticatedRuntimeValidated` is now `true`.
   - Returns `"degraded"` with a diagnostic if still `false`.
7. **Tool Routing**: `hasAuthenticatedSupermemoryToolBindings()` now sees `bundle.toolBindings` with `authenticatedRuntimeValidated: true` and enables full MCP routing.

### API / Contract Implications

| Interface | Change | Backward Compatible |
|---|---|---|
| `AdaptiveMemoryProvider.buildInjection()` | No longer throws for auth; always returns bundle if config valid. | yes (callers that expected throw will no longer catch; previous behavior was broken) |
| `AdaptiveMemoryAdapter.health()` | Returns status based on internal mutable auth state, not just config flag at creation. | yes |
| `AdaptiveMemoryAdapter.configure()` | Accepts optional `providerState` bag to update `authenticatedRuntimeValidated`. | yes (new optional field) |
| `MemoryToolBinding.metadata` | Adds `serverQualifiedToolNames: string[]` for explicit routing hints. | yes (new optional metadata field) |

### State / Persistence Implications

None. The `authenticatedRuntimeValidated` flag moves from immutable config to mutable closure state inside the adapter. No external persistence changes.

### Migration / Backward Compatibility

None. Existing code that catches the throw from `buildInjection()` will simply no longer hit that path. The tool bindings were previously absent; they will now be present but with `authenticatedRuntimeValidated: false`, which `hasAuthenticatedSupermemoryToolBindings()` already handles correctly by returning `false`.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/adapter-supermemory/src/index.ts` | modify | Remove throw from `buildInjection`; make auth state mutable via closure; update tool binding metadata; update `health()` to reflect mutable state; update `configure()` to read `providerState`. |
| `packages/core/src/memory/adaptive-memory-contract.ts` | modify | Add optional `providerState?: Record<string, unknown>` to `AdaptiveMemoryConfigureRequest` to enable adapter-specific state updates without core type pollution. |

## Testing Strategy

- **Unit tests** in `packages/adapter-supermemory`:
  - `buildInjection()` returns non-empty instructions and bindings when `authenticatedRuntimeValidated` is `false`.
  - `buildInjection()` returns same bundle shape when `authenticatedRuntimeValidated` is `true`.
  - `health()` returns `"degraded"` when internal state is `false`.
  - `configure()` with `providerState: { authenticatedRuntimeValidated: true }` updates state; subsequent `health()` returns `"available"`.
  - Tool binding metadata includes `serverQualifiedToolNames`.
- **Integration test**: Verify `resolveMemoryInjection()` no longer emits `"memory_provider_unavailable"` for unauthenticated Supermemory provider; instead returns a valid bundle.

## Observability / Error Handling

- `health()` diagnostics continue to report auth status with `ADAPTIVE_MEMORY_HEALTH_UNKNOWN` when degraded.
- No new logging or metrics required.

## Security / Performance / Accessibility Considerations

None specific to this change.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Health probe strategy | **Option B**: `health()` returns degraded by default unless a previous external probe succeeded and updated state via `configure()`. | **Option A**: `health()` makes an HTTP call itself. Rejected because the adapter is a pure content generator; it must not make HTTP calls. **Option C**: Remove health dependency entirely. Rejected because runners need a signal to know when tool routing is safe. | Respects the adapter's role as instruction generator, not client. |
| How to update auth state | Extend `AdaptiveMemoryConfigureRequest` with `providerState` bag; adapter reads `providerState.authenticatedRuntimeValidated` in `configure()`. | Add a provider-specific setter outside the standard interface. Rejected because it breaks interface uniformity and complicates runner logic. | Keeps adapter behind standard contract; `providerState` is a clean extension point for all adapters. |
| `buildInjection` failure mode | Always succeed if config is valid, regardless of auth status. | Keep throw for unauthenticated. Rejected because it blocks instruction content that agents need to know *how* to authenticate. | Instructions must be available so the agent knows which tools to use and that auth is pending. |
| Tool naming in bindings | Keep short names (`execute`, `search_docs`) in `toolNames`; add `serverQualifiedToolNames` to metadata. | Replace `toolNames` with fully qualified names. Rejected because `hasAuthenticatedSupermemoryToolBindings()` and other consumers expect short names; changing them would break consumers. | Backward compatible; metadata provides routing hint without breaking existing filters. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agent attempts to use MCP tools before auth is validated | Medium | Medium | Instruction fragments explicitly state that tools require authenticated runtime validation. Tool binding metadata flags `requiresAuthenticatedExecuteProbe: true` and `authenticatedRuntimeValidated: false`. Runner should only route tool calls after `health()` returns available. |
| `buildInjection` always succeeds but runner never calls `health()` or `configure()`, leaving bindings permanently marked unauthenticated | Medium | Low | The runner's capability plan already consumes `hasAuthenticatedSupermemoryToolBindings()`; if state is never updated, tools simply won't be routed, and the agent falls back to the diagnostic behavior (no worse than today). |
| Extending `AdaptiveMemoryConfigureRequest` with `providerState` could encourage abuse | Low | Low | Document `providerState` as an opaque extension point for adapter-specific configuration; core should never interpret its contents. |

## Open Decisions

- **Probe orchestrator responsibility**: Which runner component (CLI installer, `pi-launch-command`, or `developer-team-install`) is responsible for performing the initial MCP `execute` probe and calling `adapter.configure()` with the success result? This is outside adapter scope but required for end-to-end auth flow. **Decision owner**: Task Agent / Implementer, in coordination with runner architecture.

## Dependencies

- None external. Internal dependency on `@deck/core` types.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.

## Mermaid Summary Source

```mermaid
graph TD
    A[Runner creates provider<br/>authenticatedRuntimeValidated=false] --> B[buildInjection]
    B --> C[Returns MemoryInjectionBundle<br/>instructions + toolBindings<br/>metadata: requiresAuth=true, authValidated=false]
    C --> D[composeAdaptiveMemory<br/>injects into agent prompt]
    D --> E[Agent sees instructions:<br/>tools require auth validation]
    E --> F[Runner routes MCP execute probe<br/>via tool binding metadata]
    F --> G[Probe succeeds]
    G --> H[adapter.configure<br/>providerState: {authenticatedRuntimeValidated: true}]
    H --> I[health returns available]
    I --> J[hasAuthenticatedSupermemoryToolBindings<br/>returns true → full routing enabled]
```
