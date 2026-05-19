# Proposal: Supermemory Runtime Validation

## Intent

Supermemory is configured as the active adaptive-memory provider and the user’s Pi MCP config appears structurally valid, but startup still reports `memory_provider_unavailable` because the Supermemory adapter requires authenticated runtime validation before MCP tool injection. The launch path currently never sets `authenticatedRuntimeValidated: true`, so Supermemory fails closed even when credentials are present. The same failure may be surfaced twice because both session profile assembly and Developer Team install materialization resolve memory injection independently.

## Goal

Enable Supermemory adaptive memory to become available only after an authenticated runtime MCP health probe succeeds, while preserving fail-closed behavior and reducing duplicate/noisy startup diagnostics.

## Scope

### In Scope
- Add an authenticated Supermemory runtime validation/probe in the Pi launch path before Supermemory MCP tool injection is enabled.
- Pass successful validation into Supermemory provider construction so `buildInjection()` may proceed with `authenticatedRuntimeValidated: true`.
- Preserve fail-closed behavior with redacted, actionable diagnostics when the MCP config is missing, incomplete, unauthenticated, or unhealthy.
- Coordinate or reuse validation/diagnostic results across session profile assembly and Developer Team install materialization to avoid duplicate startup warnings where appropriate.
- Update affected tests that currently assert pre-validation fail-closed behavior so they also cover successful authenticated validation and failure diagnostics.

### Out of Scope
- Changing Supermemory credential storage or exposing credential values.
- Replacing `.deck/config.json` non-secret provider settings or the existing Pi global MCP config location.
- Adding new Supermemory memory features beyond validating and enabling existing MCP-backed injection/search behavior.
- Engram migration, memory review UI, or non-Pi runtime support.

## Affected Capabilities

> This section is the contract between Proposal and Spec/Design phases.

### New Capabilities
- `supermemory-authenticated-runtime-validation`: Validate the configured Supermemory MCP server with authenticated runtime checks before treating the provider as available.

### Modified Capabilities
- `supermemory-pi-runtime-integration`: Pi launch should perform authenticated Supermemory validation and use the result when building memory injection.
- `adaptive-memory-provider`: Provider availability should distinguish static/local config validity from authenticated runtime availability, with fail-closed diagnostics on validation failure.
- `supermemory-adaptive-context`: Adaptive context should be injected only after authenticated Supermemory validation succeeds; unavailable context should remain explicit when validation fails.

### Unchanged Capabilities
- `supermemory-install-token-configuration`: Token capture/storage boundaries remain unchanged; no secrets should be written to `.deck/config.json` or exposed in diagnostics.
- `engram-provider`: Engram behavior is not part of this change.
- `openspec-artifact-authority`: OpenSpec artifacts remain authoritative and adaptive memory stays advisory.

## Approach

Introduce a Supermemory authenticated runtime validation step after static Pi MCP config validation in `apps/cli/src/pi-launch-command.ts`. The validator should use the configured `supermemory` Pi MCP server without exposing secrets, perform an online health check sufficient to prove authentication and expected tool availability, and return a redacted availability result. On success, construct the Supermemory provider with `authenticatedRuntimeValidated: true`; on failure, continue without adaptive memory and emit a single actionable diagnostic. Share or carry this validation result into `packages/adapter-pi/src/pi-team-profile.ts` and `packages/adapter-pi/src/developer-team-install.ts` so independent memory-injection resolution does not produce duplicate warnings for the same startup condition.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Trust static `~/.pi/agent/mcp.json` validation | The file has the expected server, URL, transport, and header key | It cannot prove the token is valid, the server is reachable, or expected tools are available. |
| Always set `authenticatedRuntimeValidated: true` when a header key is present | Minimal code change and would remove the warning | Unsafe; bypasses the adapter’s intentional fail-closed gate. |
| Keep current fail-closed behavior and document the warning | Avoids runtime network probing | Leaves configured Supermemory unusable and does not satisfy the user’s request for a complete fix. |
| Validate independently in every resolver | Localized implementation | Risks duplicate network calls and duplicate/noisy diagnostics during startup. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Runtime validation adds startup latency or transient network failures | Medium | Use a bounded probe and degrade to advisory-memory-unavailable without blocking OpenSpec workflow. |
| Probe has side effects if it executes the wrong Supermemory tool/action | Medium | Limit validation to initialize/tools/list and a safe read-only authenticated operation if required. |
| Duplicate diagnostics persist because multiple paths resolve memory independently | Medium | Carry, cache, or centralize the validation result for the launch session and deduplicate equivalent diagnostics. |
| Secrets leak through validation errors or logs | Low | Reuse/extend existing redaction behavior and never print header values or tokens. |
| Tests relying on fail-closed pre-validation behavior become ambiguous | Medium | Keep explicit tests for pre-validation failure, validation success, validation failure, redaction, and diagnostic deduplication. |

## Rollback Plan

Revert the runtime-validation changes and restore provider construction with `authenticatedRuntimeValidated: false`; Supermemory will return to the existing fail-closed unavailable behavior. Users can also switch `adaptiveMemory.activeProvider` to `none` or another supported provider in non-secret configuration to avoid the Supermemory startup path while retaining OpenSpec workflow execution.

## Dependencies

- Existing non-secret Supermemory settings in `.deck/config.json`.
- Existing Pi global MCP server configuration at `~/.pi/agent/mcp.json` with a Supermemory server entry and redacted credential handling.
- Network access to the Supermemory MCP endpoint during runtime validation.
- Current Supermemory MCP tool contract expected by the adapter/launcher.

## Open Questions

- What exact probe sequence should be considered sufficient: `initialize` plus `tools/list`, or also a safe read-only `execute`/search operation?
- Should validation results be cached only within a single launch, or persisted as non-secret health metadata with an expiry?
- Which component should own diagnostic deduplication: the CLI launch path, core `resolveMemoryInjection()`, or the Pi adapter call sites?

## Acceptance Direction

- [ ] With valid Supermemory Pi MCP configuration and authenticated runtime health, startup does not emit `memory_provider_unavailable` for Supermemory and adaptive memory injection is enabled.
- [ ] With missing, invalid, unauthenticated, or unhealthy Supermemory MCP configuration, startup fails closed, continues the OpenSpec workflow, and reports a redacted actionable unavailable reason.
- [ ] Duplicate/noisy Supermemory unavailable warnings are eliminated or reduced to one clear diagnostic per startup condition.
- [ ] Existing fail-closed tests remain covered, and new tests cover authenticated validation success, validation failure, redaction, and diagnostic deduplication.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.
