# Design: Supermemory Runtime Validation

## Source

- Proposal: `supermemory-runtime-validation` proposal artifact
- Capabilities affected: `supermemory-authenticated-runtime-validation`, `supermemory-pi-runtime-integration`, `adaptive-memory-provider`, `supermemory-adaptive-context`
- Spec status: not yet available

## Current Architecture Context

- `apps/cli/src/pi-launch-command.ts`
  - `runPiLaunch()` is currently synchronous.
  - It resolves CLI/config memory selection with `resolveActiveMemoryProvider()`.
  - For Supermemory it validates only static Pi MCP config via `validateSupermemoryPiMcpConfig()` and then constructs `createSupermemoryMemoryProvider({ authenticatedRuntimeValidated: false })`.
  - It passes the provider separately into:
    - `materializeTeamProfile()` for session prompt adaptive context.
    - `buildDeveloperTeamInstallPlan()` for Developer Team agent/skill tool bindings.
  - It aggregates diagnostics from all three phases, which can surface equivalent Supermemory unavailable warnings more than once.
- `packages/adapter-supermemory/src/index.ts`
  - `createSupermemoryMemoryProvider()` intentionally fails closed: `buildInjection()` throws unless `authenticatedRuntimeValidated` is true.
  - Successful injection emits only validated tool bindings: `execute` and `search_docs`, with metadata `authenticatedRuntimeValidated: true`.
  - Health reports `degraded` until authenticated runtime validation is known.
- `packages/adapter-pi/src/pi-mcp-config.ts`
  - Owns Pi global MCP config path, Supermemory endpoint/header constants, static read/write validation, and redacted diagnostics.
  - Static validation proves shape, endpoint, transport, and non-empty credential header only; it does not prove reachability/authentication/tool availability.
- `packages/adapter-pi/src/pi-team-profile.ts`
  - `buildTeamSystemPrompt()` resolves a provider/injection bundle and renders an adaptive-context unavailable section only when a provider/injection was supplied but produced no bundle.
- `packages/adapter-pi/src/developer-team-install.ts`
  - `resolvePiMemoryInjection()` delegates to core `resolveMemoryInjection()`.
  - For Supermemory provider-built bundles it revalidates static Pi MCP config and requires binding metadata `authenticatedRuntimeValidated === true` before adding Pi tools.
  - If passed a trusted `memoryInjection`, it bypasses provider resolution and returns the bundle directly.

## Proposed Architecture

Centralize Supermemory availability resolution in the Pi launch path and treat runtime validation as the single gate before any MCP-backed injection is built.

1. Add an adapter-pi runtime validator that composes static Pi MCP validation with a bounded authenticated MCP probe.
2. Make the CLI launch flow asynchronous so it can run the network probe before profile/install materialization.
3. On Supermemory success, construct the provider with `authenticatedRuntimeValidated: true`, build one launch-scoped `MemoryInjectionBundle`, and pass that bundle (not the provider) to profile and Developer Team install materialization.
4. On Supermemory failure, do not construct/pass an injectable provider. Return one redacted launch diagnostic and optionally pass an unavailable reason to session profile rendering so adaptive context absence remains explicit without triggering downstream duplicate diagnostics.
5. Keep Supermemory credential storage unchanged. Credentials are read only from the existing Pi MCP config for the probe and are never included in returned results, diagnostics, or logs.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/adapter-pi/src/pi-mcp-runtime-validation.ts` | New bounded authenticated Supermemory MCP runtime validator; owns fetch/probe orchestration and redacted runtime diagnostics. | new |
| `packages/adapter-pi/src/pi-mcp-config.ts` | Continue static config validation; expose or share a private helper for runtime validator to read the validated server URL/headers without exposing headers in result objects. | modified |
| `packages/adapter-pi/src/index.ts` | Export the new runtime validation API for the CLI. | modified |
| `apps/cli/src/pi-launch-command.ts` | Async launch orchestration; centralizes Supermemory static+runtime validation, constructs authenticated provider only on success, builds one bundle, deduplicates diagnostics. | modified |
| `apps/cli/src/main.tsx` | Await the async launch result before reporting diagnostics and spawning Pi. | modified |
| `packages/adapter-pi/src/pi-team-profile.ts` | Accept launch-owned `memoryInjection` on success and optional `memoryUnavailableReason` on failure without re-resolving Supermemory. | modified |
| `packages/adapter-pi/src/developer-team-install.ts` | Reuse existing `memoryInjection` precedence for success; retain direct-call fail-closed guards for provider-based Supermemory injection. | unchanged or minimally modified |
| `packages/adapter-supermemory/src/index.ts` | Continue enforcing `authenticatedRuntimeValidated` in provider construction/buildInjection. | unchanged |
| `packages/core/src/memory/adaptive-memory.ts` | Provider-neutral resolution/composition remains unchanged. | unchanged |

### Data Flow

Success path:

1. `runPiLaunch()` resolves active memory provider from CLI/config.
2. For `supermemory`, it verifies non-secret Deck config (`userId`, server name, search settings).
3. `validateSupermemoryPiMcpRuntime()` runs:
   - static config validation through `validateSupermemoryPiMcpConfig()`;
   - validated server extraction from `~/.pi/agent/mcp.json` or override path;
   - bounded authenticated MCP `initialize` and `tools/list` probe using the configured headers;
   - expected tool check for `execute` and `search_docs`.
4. If runtime validation succeeds, CLI constructs `createSupermemoryMemoryProvider({ ..., authenticatedRuntimeValidated: true })`.
5. CLI builds one `MemoryInjectionBundle` from that provider and passes it as `memoryInjection` to:
   - `materializeTeamProfile()` for session instructions;
   - `buildDeveloperTeamInstallPlan()` for Developer Team agent/skill tool frontmatter.
6. Downstream materializers do not emit Supermemory validation diagnostics because they receive a trusted bundle, not an unvalidated provider.

Failure path:

1. Static config, network, authentication, malformed response, or missing expected tools failures produce a `memory_provider_unavailable` launch diagnostic.
2. The diagnostic message is redacted and actionable; details may include path/server/tool names/status class, never credential/header values.
3. CLI does not pass a Supermemory provider to downstream materializers.
4. Session profile may receive `memoryUnavailableReason` to render `ADAPTIVE CONTEXT` as unavailable without asking the provider to build injection.
5. Developer Team install receives no memory bundle and therefore emits no duplicate Supermemory warning.

### API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| `runPiLaunch(options)` | Becomes async (`Promise<PiLaunchResult>`) or gains an async wrapper used by `main.tsx`; adds injected runtime validator/timeout options for tests. | partial |
| `RunPiLaunchOptions` | Add optional `supermemoryRuntimeValidator?: (...) => Promise<SupermemoryRuntimeValidationResult>` and `supermemoryValidationTimeoutMs?: number`. | yes |
| `validateSupermemoryPiMcpRuntime(options)` | New exported adapter-pi function returning redacted `{ ok, path, serverName, authenticatedRuntimeValidated, diagnostics, toolNames? }`. | new |
| `MaterializeTeamProfileOptions` / `BuildTeamSystemPromptOptions` | Add optional `memoryUnavailableReason?: string` for launch-owned unavailable rendering without provider resolution. | yes |
| `buildDeveloperTeamInstallPlan()` | No required API change; continue accepting `memoryInjection` as trusted input. If implementation needs explicit suppression, add optional launch-owned validation context without changing defaults. | yes |

Runtime validation result shape should avoid secrets:

```ts
type SupermemoryRuntimeValidationResult =
  | {
      ok: true;
      authenticatedRuntimeValidated: true;
      path: string;
      serverName: string;
      endpoint: string;
      toolNames: readonly string[];
      diagnostics: readonly SupermemoryRuntimeValidationDiagnostic[];
    }
  | {
      ok: false;
      authenticatedRuntimeValidated: false;
      path: string;
      serverName: string;
      endpoint?: string;
      diagnostics: readonly SupermemoryRuntimeValidationDiagnostic[];
    };
```

### State / Persistence Implications

None. Validation is launch-scoped and in-memory only. No credential storage, `.deck/config.json`, or Pi MCP config persistence changes.

### Migration / Backward Compatibility

- No data migration required.
- CLI call sites/tests must await the launch result if `runPiLaunch()` becomes async.
- Existing fail-closed behavior remains for direct provider usage and direct `buildDeveloperTeamInstallPlan({ memoryProvider })` calls unless callers pass a validated bundle/provider.
- Rollback is simple: remove runtime validator use and construct Supermemory with `authenticatedRuntimeValidated: false`, returning to current fail-closed behavior.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/adapter-pi/src/pi-mcp-runtime-validation.ts` | create | Encapsulate authenticated Supermemory MCP runtime probe and redacted result types. |
| `packages/adapter-pi/src/pi-mcp-config.ts` | modify | Share static validation constants/redaction and expose validated runtime server extraction without leaking headers in public results. |
| `packages/adapter-pi/src/index.ts` | modify | Export runtime validation API. |
| `apps/cli/src/pi-launch-command.ts` | modify | Run validation after static/config resolution, construct authenticated provider on success, build/pass one bundle, dedupe diagnostics. |
| `apps/cli/src/main.tsx` | modify | Await async Pi launch preparation. |
| `packages/adapter-pi/src/pi-team-profile.ts` | modify | Render launch-owned adaptive unavailable reason without invoking provider resolution. |
| `apps/cli/src/pi-launch-command.supermemory.test.ts` | modify | Cover validation success, validation failure, single diagnostic, and redaction. |
| `apps/cli/src/pi-launch-command.test.ts` | modify | Await async launch result and preserve non-Supermemory behavior. |
| `packages/adapter-pi/src/pi-mcp-runtime-validation.test.ts` | create | Unit-test runtime probe success/failure/redaction/timeout/tool checks with fake fetch. |
| `packages/adapter-pi/src/pi-team-profile.test.ts` | modify | Cover explicit adaptive-context unavailable rendering from launch-owned reason. |
| `packages/adapter-pi/src/developer-team-install.test.ts` | modify | Preserve direct-call fail-closed behavior and success via trusted bundle. |

## Testing Strategy

- Unit tests for `validateSupermemoryPiMcpRuntime()` with injected fetch and temp MCP config:
  - static config missing/malformed/conflicting;
  - 401/403 unauthenticated;
  - timeout/network failure;
  - malformed JSON/SSE response;
  - `tools/list` missing `execute` or `search_docs`;
  - success with credential present but not leaked.
- CLI launch tests:
  - valid Deck config + valid Pi MCP config + successful probe enables Supermemory session/agent/skill injection and emits no unavailable diagnostic;
  - failed probe emits exactly one redacted `memory_provider_unavailable` diagnostic;
  - CLI `none` and `engram` overrides do not run Supermemory validation.
- Adapter-pi profile/install tests:
  - profile unavailable reason renders explicit `ADAPTIVE CONTEXT` unavailable section;
  - Developer Team install still fails closed for direct unvalidated Supermemory provider calls;
  - trusted validated bundle path does not revalidate or duplicate warnings.

## Observability / Error Handling

- Use existing memory diagnostic channel: CLI prints `[memory] memory_provider_unavailable: ...` once per startup condition.
- Runtime validator classifies failures into redacted diagnostic codes such as runtime unavailable, unauthenticated, invalid response, or missing tools.
- Use bounded timeout via `AbortController`; timeout degrades to unavailable adaptive memory, not process failure.
- Add final launch-level diagnostic deduplication by `(code, providerId, normalized message)` as a safety net.

## Security / Performance / Accessibility Considerations

- Security:
  - Never include `x-supermemory-api-key`, authorization headers, bearer values, or token-like text in diagnostics/results.
  - Runtime headers remain local variables used only for the probe request.
  - Do not write validation health or credentials to `.deck/config.json`.
- Performance:
  - One runtime probe per launch, before profile/install materialization.
  - Default timeout should be short and bounded (recommended 2–5 seconds); failure degrades adaptive memory only.
- Accessibility: None specific to this change.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Runtime validation owner | `adapter-pi` validator orchestrated by CLI | Put HTTP probing inside `adapter-supermemory` | The probe depends on Pi MCP config shape/path/headers; adapter-supermemory should remain provider/injection focused. |
| Downstream sharing | Build one validated `MemoryInjectionBundle` in launch path and pass it downstream | Pass an authenticated provider to each downstream resolver | A single bundle avoids duplicate provider build attempts, duplicate diagnostics, and duplicate network validation. |
| Failure handling | Do not pass an unvalidated Supermemory provider downstream; emit one launch diagnostic | Let profile and install each fail closed independently | Independent failures preserve safety but cause duplicate/noisy startup warnings. |
| Validation persistence | Launch-scoped in-memory result only | Persist non-secret health metadata with expiry | Avoids new state, invalidation complexity, and stale authenticated-health assumptions. |
| Probe sequence | Bounded MCP `initialize` + `tools/list` verifying `execute`/`search_docs` | Trust static header presence | Static config cannot prove endpoint reachability, token validity, or expected tool availability. |
| Async launch | Use async launch preparation | Block synchronously or skip online validation | Network validation is naturally async; blocking/shelling out would be brittle and harder to test. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Supermemory MCP HTTP response format differs from simple JSON-RPC JSON | Medium | Medium | Parser should support standard JSON and `text/event-stream` `data:` frames; keep probe isolated behind injected fetch tests. |
| `tools/list` is not sufficient to prove auth if endpoint lists tools anonymously | Medium | High | Confirm Supermemory MCP auth behavior; if needed extend validator with a safe read-only `execute` profile/search probe before marking success. |
| Startup latency increases | Medium | Medium | Single bounded probe with short timeout; fail closed only for adaptive memory. |
| Duplicate diagnostics remain through an unplanned direct call path | Low | Medium | Centralize CLI flow on launch-owned bundle and keep final diagnostic dedupe. |
| Secret leakage from thrown fetch/protocol errors | Low | High | Redact all error text through existing redaction helper before returning diagnostics. |
| Async API conversion breaks tests or internal callers | Medium | Low | Update all `runPiLaunch()` call sites/tests; optionally provide a named async wrapper if preserving sync symbol is important. |

## Open Decisions

- Confirm with Supermemory MCP contract whether `initialize` + authenticated `tools/list` is auth-enforced and sufficient, or whether a safe read-only `execute` probe (for example profile/read-only search) is required before setting `authenticatedRuntimeValidated: true`.
- Decide the default timeout value and whether it should be configurable only in tests/options or also via a user-facing CLI/config setting.

## Dependencies

- Existing Pi global MCP config at `~/.pi/agent/mcp.json` or supplied override path.
- Network access to `https://supermemory-new.stlmcp.com` during launch.
- Supermemory MCP tool contract exposing `execute` and `search_docs`.
- Runtime `fetch`/`AbortController` availability in the CLI environment.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.
