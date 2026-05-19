# Tasks: Supermemory Runtime Validation

## Source

- Spec: `supermemory-runtime-validation` spec artifact
- Design: `supermemory-runtime-validation` design artifact
- Capabilities affected: `supermemory-authenticated-runtime-validation`, `supermemory-pi-runtime-integration`, `adaptive-memory-provider`, `supermemory-adaptive-context`

## Task Groups

### Group: Shared / Contracts

#### Task 1: Define runtime validation result and diagnostic types
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: Yes
**Depends on**: none

**Description**
Create the `SupermemoryRuntimeValidationResult` discriminated union type and `SupermemoryRuntimeValidationDiagnostic` type in `packages/adapter-pi/`. The result type must have `ok: true | false`, `authenticatedRuntimeValidated`, `path`, `serverName`, `endpoint` (omitted on failure), `toolNames` (omitted on failure), and `diagnostics`. The diagnostic type must carry a redacted `code`, `message`, and optional `detail` — never secrets or header values. Place these types in the new `pi-mcp-runtime-validation.ts` file or a co-located types file. This task is standalone type definition only; no runtime logic.

**Files**
- `packages/adapter-pi/src/pi-mcp-runtime-validation.ts` — create

**Verification**
TypeScript compiles without error. Types match the design's result shape. No secret-bearing fields exist on result or diagnostic types.

---

#### Task 2: Modify pi-mcp-config to expose validated server extraction safely
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: Yes
**Depends on**: none

**Description**
In `packages/adapter-pi/src/pi-mcp-config.ts`, add or expose a helper that reads the validated Pi MCP config and returns the Supermemory server URL and endpoint without including any header/credential values in the result object. The helper should compose with the existing `validateSupermemoryPiMcpConfig()`. If a private extraction function already exists, refactor to allow the runtime validator to call it without leaking header strings into a public return type. Keep the existing public API unchanged.

**Files**
- `packages/adapter-pi/src/pi-mcp-config.ts` — modify

**Verification**
Existing `pi-mcp-config` tests still pass. The exposed helper returns server URL and endpoint but no header/credential values. TypeScript compiles.

---

### Group: Backend

#### Task 3: Implement authenticated Supermemory MCP runtime validator
**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Task 1 and Task 2
**Depends on**: Task 1, Task 2

**Description**
Implement `validateSupermemoryPiMcpRuntime(options)` in `packages/adapter-pi/src/pi-mcp-runtime-validation.ts`. The function must:
1. Run static config validation via `validateSupermemoryPiMcpConfig()`. If static validation fails, return `ok: false` with a configuration-invalid diagnostic (no secrets).
2. Extract the validated server URL and auth headers from the Pi MCP config path (using the helper from Task 2). Headers stay local — never included in the result.
3. Send a bounded MCP `initialize` request using `fetch` with an `AbortController` timeout (default 3000ms, configurable via options). If the request times out or fails, return `ok: false` with a runtime-unreachable or timeout diagnostic.
4. If `initialize` fails with auth errors (401/403), return `ok: false` with an unauthenticated diagnostic (redacted, no header/token values).
5. Send a bounded `tools/list` request with the same auth headers. If it fails, return `ok: false` with a runtime-unavailable or missing-tools diagnostic.
6. Verify `execute` and `search_docs` appear in the returned tool list. If either is missing, return `ok: false` with a missing-tools diagnostic.
7. On full success, return `ok: true` with `authenticatedRuntimeValidated: true`, `endpoint`, `toolNames`, and empty diagnostics.
8. All diagnostic messages must be redacted through the existing or shared redaction helper. Probe sequence: `initialize` then `tools/list`. Do not execute any `execute`/search operations during validation (REQ-SARV-005).

The function must accept an injected `fetch` and `AbortController` via options for testability.

**Open decision handling**: Use `initialize + tools/list` as the baseline probe. If `tools/list` proves unauthenticated in future MCP contract negotiation, a follow-up safe read-only `execute` probe can be added. This does not block implementation.

**Files**
- `packages/adapter-pi/src/pi-mcp-runtime-validation.ts` — modify (add implementation to type-only file from Task 1)

**Verification**
TypeScript compiles. Function signature matches design's `validateSupermemoryPiMcpRuntime(options)`. No secrets in any result path. Timeout is bounded and default is 3000ms.

---

#### Task 4: Export runtime validation API from adapter-pi
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: No — depends on Task 3
**Depends on**: Task 3

**Description**
Add exports for `validateSupermemoryPiMcpRuntime` and `SupermemoryRuntimeValidationResult` from `packages/adapter-pi/src/index.ts`. Also export any public types needed by CLI consumers. Keep existing exports intact.

**Files**
- `packages/adapter-pi/src/index.ts` — modify

**Verification**
`validateSupermemoryPiMcpRuntime` is importable from `@anthropic/adapter-pi` (or the actual package name). Existing adapter-pi exports unchanged.

---

#### Task 5: Convert runPiLaunch to async and integrate runtime validation
**Owner**: General Apply
**Priority**: P0
**Complexity**: High
**Parallel**: No — depends on Task 4
**Depends on**: Task 4

**Description**
In `apps/cli/src/pi-launch-command.ts`:
1. Convert `runPiLaunch()` to return `Promise<PiLaunchResult>` (or add an async wrapper).
2. Add `supermemoryRuntimeValidator` and `supermemoryValidationTimeoutMs` to `RunPiLaunchOptions` (both optional; defaults use the real validator and 3000ms).
3. When the active memory provider is `supermemory`, orchestrate:
   a. Resolve CLI/config memory selection (existing).
   b. Verify non-secret Deck config (`userId`, server name, search settings) (existing).
   c. Call `validateSupermemoryPiMcpRuntime()` with the configured options.
   d. On success: construct `createSupermemoryMemoryProvider({ ..., authenticatedRuntimeValidated: true })`, build one `MemoryInjectionBundle`, and pass it as `memoryInjection` to `materializeTeamProfile()` and `buildDeveloperTeamInstallPlan()`.
   e. On failure: do NOT construct a Supermemory provider. Emit exactly one redacted `memory_provider_unavailable` launch diagnostic. Pass `memoryUnavailableReason` (not a provider) to `materializeTeamProfile()`. Do not pass a memory bundle to `buildDeveloperTeamInstallPlan()`.
4. Centralize diagnostic deduplication: aggregate all launch diagnostics and deduplicate by `(code, providerId, normalizedMessage)` — emit at most one equivalent diagnostic per condition.
5. For `none` and `engram` providers: skip Supermemory validation entirely. No behavior change.
6. Ensure no Supermemory credential/header values appear in any diagnostic output.

This task is flagged as High complexity because it modifies the central CLI orchestration flow and must coordinate async validation, provider construction, bundle building, and diagnostic deduplication across three downstream consumers.

**Files**
- `apps/cli/src/pi-launch-command.ts` — modify

**Verification**
- `runPiLaunch()` returns a Promise and can be awaited.
- Supermemory validation runs on `supermemory` provider only.
- On validation success: one authenticated provider is constructed, one bundle is built and passed downstream, no `memory_provider_unavailable` diagnostic.
- On validation failure: no provider constructed, exactly one redacted `memory_provider_unavailable` diagnostic, `memoryUnavailableReason` passed to profile.
- `none` and `engram` providers are unaffected.

---

#### Task 6: Update main.tsx to await async Pi launch
**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: No — depends on Task 5
**Depends on**: Task 5

**Description**
In `apps/cli/src/main.tsx`, update the call site that invokes `runPiLaunch()` to `await` the result. If other callers exist, update them too. Ensure the diagnostic reporting and Pi spawn logic works with the resolved `PiLaunchResult`.

**Files**
- `apps/cli/src/main.tsx` — modify

**Verification**
CLI startup completes. Async launch result is properly awaited. Diagnostics are printed correctly. No regression in non-Supermemory startup flows.

---

#### Task 7: Update pi-team-profile to accept memoryUnavailableReason
**Owner**: General Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: Yes — only depends on Task 1 types (not on Task 5)
**Depends on**: Task 1

**Description**
In `packages/adapter-pi/src/pi-team-profile.ts`, add an optional `memoryUnavailableReason?: string` field to `MaterializeTeamProfileOptions` / `BuildTeamSystemPromptOptions`. When `memoryUnavailableReason` is present and no `memoryInjection` is provided, render the adaptive-context section as explicitly unavailable using the given reason — without invoking provider resolution. This satisfies REQ-SAC-002 (explicit unavailability) and REQ-AMP-003 (no duplicate warnings). When `memoryInjection` is provided (success path), behavior is unchanged.

**Files**
- `packages/adapter-pi/src/pi-team-profile.ts` — modify

**Verification**
When `memoryUnavailableReason` is present and `memoryInjection` is absent, `buildTeamSystemPrompt()` renders an explicit unavailable adaptive-context section. When `memoryInjection` is present, behavior is unchanged. TypeScript compiles.

---

#### Task 8: Verify developer-team-install fail-closed behavior is preserved
**Owner**: General Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: Yes
**Depends on**: none

**Description**
Audit `packages/adapter-pi/src/developer-team-install.ts` to confirm that:
1. Direct unvalidated Supermemory provider calls still fail closed (existing `authenticatedRuntimeValidated === true` guard in `resolvePiMemoryInjection()`).
2. When a trusted `memoryInjection` bundle is passed (from the CLI launch path after validation), it is used directly without re-validation or duplicate diagnostics.
3. If a `memoryProvider` is passed directly without `authenticatedRuntimeValidated: true`, the existing fail-closed guard still applies.
4. No code changes are needed beyond potentially adding a suppression path for launch-owned validation context (optional, per design note).

This task is primarily an audit/verification with at most minimal modification.

**Files**
- `packages/adapter-pi/src/developer-team-install.ts` — unchanged or minimally modified

**Verification**
Existing tests for fail-closed behavior still pass. Trusted bundle path passes without re-validation or duplicate warnings. No new unvalidated paths introduced.

---

### Group: Tests

#### Task 9: Unit tests for pi-mcp-runtime-validation
**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Task 3
**Depends on**: Task 3

**Description**
Create `packages/adapter-pi/src/pi-mcp-runtime-validation.test.ts` with unit tests covering all validation outcomes using injected fake fetch:
1. Static config missing/malformed → `ok: false` with configuration diagnostic.
2. Network timeout → `ok: false` with timeout diagnostic.
3. 401/403 response → `ok: false` with unauthenticated diagnostic (no secret values in output).
4. Malformed JSON/SSE response → `ok: false` with invalid-response diagnostic.
5. `tools/list` missing `execute` or `search_docs` → `ok: false` with missing-tools diagnostic.
6. Full success (initialize + tools/list with both required tools) → `ok: true` with `authenticatedRuntimeValidated: true`.
7. No secret/header values appear in any result or diagnostic across all cases.
8. AbortController timeout boundary is respected.

**Files**
- `packages/adapter-pi/src/pi-mcp-runtime-validation.test.ts` — create

**Verification**
All tests pass. Coverage includes every failure path and success path. No test leaks secrets into assertion messages.

---

#### Task 10: Update pi-launch-command Supermemory integration tests
**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depends on Task 5
**Depends on**: Task 5

**Description**
Update `apps/cli/src/pi-launch-command.supermemory.test.ts` (or equivalent) to cover the new validation-integrated launch flow:
1. Valid Deck config + valid Pi MCP config + successful probe → Supermemory injection enabled, no `memory_provider_unavailable` diagnostic.
2. Static config failure → exactly one redacted `memory_provider_unavailable` diagnostic, no provider constructed.
3. Runtime auth failure → exactly one redacted `memory_provider_unavailable` diagnostic, no provider constructed.
4. Timeout/network failure → exactly one redacted diagnostic.
5. Injected mock validator overrides work for test isolation.

**Files**
- `apps/cli/src/pi-launch-command.supermemory.test.ts` — modify

**Verification**
All Supermemory integration tests pass. Each scenario emits exactly one or zero unavailable diagnostics. No test reveals secrets.

---

#### Task 11: Update pi-launch-command general tests for async
**Owner**: General Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depends on Task 5
**Depends on**: Task 5

**Description**
Update `apps/cli/src/pi-launch-command.test.ts` to await the async `runPiLaunch()` result. Verify non-Supermemory behavior (`none`, `engram` providers) is unchanged. Ensure no regressions in general launch flow.

**Files**
- `apps/cli/src/pi-launch-command.test.ts` — modify

**Verification**
All existing general launch tests pass. Async await is correct. Non-Supermemory paths are unaffected.

---

#### Task 12: Update pi-team-profile tests for memoryUnavailableReason
**Owner**: General Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depends on Task 7
**Depends on**: Task 7

**Description**
Update `packages/adapter-pi/src/pi-team-profile.test.ts` to cover:
1. When `memoryUnavailableReason` is provided and no `memoryInjection` → explicit adaptive-context unavailable section in system prompt.
2. When `memoryInjection` is provided (success path) → existing behavior preserved.
3. Unavailable section text is actionable and does not contain secrets.

**Files**
- `packages/adapter-pi/src/pi-team-profile.test.ts` — modify

**Verification**
New and existing profile tests pass. Unavailable rendering is tested. No secret values in test assertions or output.

---

#### Task 13: Update developer-team-install tests to preserve fail-closed behavior
**Owner**: General Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depends on Task 8
**Depends on**: Task 8

**Description**
Update `packages/adapter-pi/src/developer-team-install.test.ts` to verify:
1. Direct unvalidated Supermemory provider call → injection still fails closed.
2. Trusted validated bundle passed → injection succeeds without re-validation or duplicate warnings.
3. No breakdown in the fail-closed guard from the new launch path.

**Files**
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify

**Verification**
Fail-closed tests still pass. Trusted bundle path is tested and passes.

---

## Dependency Graph

```
Task 1 (Types) ─────────────────────────────────┐
Task 2 (pi-mcp-config helper) ──────────┐       │
                                        │       │
Task 3 (Runtime validator) ←── T1, T2 ─┘───────┘
  │
Task 4 (adapter-pi export) ←── T3
  │
Task 5 (runPiLaunch async + integration) ←── T4
  │
Task 6 (main.tsx async await) ←── T5
  │
Task 7 (pi-team-profile memoryUnavailableReason) ←── T1
Task 8 (developer-team-install audit) ─── no deps
  │
Task 9 (Runtime validator tests) ←── T3
Task 10 (Supermemory integration tests) ←── T5
Task 11 (General launch async tests) ←── T5
Task 12 (Profile tests) ←── T7
Task 13 (Install tests) ←── T8
```

## Parallelization Plan

| Phase | Tasks | Can Run in Parallel |
|---|---|---|
| 1 — Shared types and config | Task 1, Task 2, Task 7, Task 8 | Yes (all independent) |
| 2 — Runtime validator | Task 3 | No — depends on T1, T2 |
| 3 — Export + CLI integration | Task 4, then Task 5 | No — sequential dependency |
| 4 — Main.tsx + Profile | Task 6 | No — depends on T5 |
| 5 — Tests | Task 9, Task 10, Task 11, Task 12, Task 13 | Partially — each depends on its source task |

## Responsibility Contracts

| Contract / Boundary | Owner | Consumers | Notes |
|---|---|---|---|
| `SupermemoryRuntimeValidationResult` + `SupermemoryRuntimeValidationDiagnostic` types | General Apply (Task 1) | Backend (Tasks 3, 5, 7, 9) | Discriminated union must stay secret-free |
| `validateSupermemoryPiMcpRuntime()` function | General Apply (Task 3) | Backend (Tasks 5, 9, 10) | Accepts injected fetch/AbortController for testability; returns redacted result only |
| `pi-mcp-config` server extraction helper | General Apply (Task 2) | Backend (Task 3) | Must not expose header/credential values in return type |
| `RunPiLaunchOptions` async + validation options | General Apply (Task 5) | Backend (Task 6, 10, 11) | Breaking API change: `runPiLaunch()` becomes async |
| `memoryUnavailableReason` in team profile | General Apply (Task 7) | Backend (Task 12) | Optional field; backward-compatible |

## Complexity Summary

| Complexity | Count | Task Numbers |
|---|---|---|
| Low | 9 | 1, 2, 4, 6, 7, 8, 11, 12, 13 |
| Medium | 3 | 3, 9, 10 |
| High | 1 | 5 |

## Flagged for Splitting

- **Task 5**: High complexity. Modifies the central CLI orchestration flow (`runPiLaunch`) — converting it to async, adding validation orchestration, building one bundle, deduplicating diagnostics, and coordinating three downstream consumers. If the implementer finds this exceeding a single session, it should be split into: (a) async conversion of `runPiLaunch()` + `RunPiLaunchOptions`, (b) Supermemory validation integration + provider/bundle construction, (c) diagnostic deduplication. However, these are tightly coupled in one function, so splitting requires careful interface boundaries.

## Review Workload Forecast

| Signal | Value |
|---|---|
| Estimated changed lines | 400-800 |
| 400-line budget risk | Medium |
| Scope reduction recommended | No |
| Sequential work slices recommended | Yes — for Task 5 if needed |
| Decision needed before Apply | Yes (2 open decisions, both allowed-with-stub) |

**Rationale**: The change touches ~11 files with both new modules and modifications to core orchestration paths. Task 5 (launch integration) is the highest-risk task as a single function modification with async conversion, validation orchestration, and diagnostic deduplication. Total estimated lines are moderate but concentrated in the CLI launch path. The two open decisions (probe sequence and timeout default) can proceed with safe defaults: `initialize + tools/list` probe (with documented risk that `tools/list` may not be auth-gated) and 3000ms default timeout.

## Open Questions / Blockers

1. **Probe sequence depth** — *allowed-with-stub*: The design chose `initialize + tools/list` as the probe. Risk: if `tools/list` is not auth-gated, authentication is proven only by `initialize`. Implementation should proceed with `initialize + tools/list` and document this as a known gap. A follow-up safe read-only `execute` probe can be added if the Supermemory MCP contract confirms `tools/list` is unauthenticated. Not implementation-blocking.

2. **Default timeout value** — *allowed-with-stub*: Proceed with 3000ms default, configurable via `RunPiLaunchOptions.supermemoryValidationTimeoutMs`. Not implementation-blocking.

3. **Diagnostic deduplication owner** — *non-blocking*: The spec and design both call for at most one equivalent `memory_provider_unavailable` diagnostic per startup condition. Task 5 implements deduplication in the CLI launch path. If future call paths bypass the launch flow, the deduplication guarantee should move to a lower layer. Not implementation-blocking for this change.

> No implementation-blocking open questions. All decisions can proceed with safe defaults/stubs.