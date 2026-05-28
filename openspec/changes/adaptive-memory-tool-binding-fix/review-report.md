# Review Report: Adaptive Memory Tool Binding Fix

## Summary

**Overall Rating**: PASS WITH CONCERNS
**Scope**: backend, integration
**Files Reviewed**: 9

The change successfully fixes the four root causes identified in the proposal: (1) `memoryBundle` now flows from plan to manifest, (2) OpenCode has a synchronous auth probe for Supermemory, (3) `commit()` persists via native `fetch` with per-candidate fail-open semantics, and (4) instruction bundles include concrete examples, topic keys, and a save trigger matrix. Architecture boundaries are respected, fail-open semantics are robust, and the changes are additive and backward compatible.

Two concerns prevent a clean pass:
1. **Missing test file**: `opencode-mcp-config.test.ts` does not exist despite `apply-progress.md` claiming 7 passing test cases for Task 8.
2. **Adjacent security risk**: The modified `opencode-mcp-config.ts` contains a pre-existing function (`appendSupermemoryEnvToBashrc`) that writes raw API keys to `~/.bashrc` in plaintext without deduplication checks.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Boundaries respected: auth probe stays in runner-specific adapter; core remains agnostic. Optional `memoryBundle` field preserves backward compatibility. |
| Security | ⚠️ Adequate | API keys are not stored in `.deck/config.json`. Env-var interpolation is validated. Concern: raw token written to `~/.bashrc` by adjacent pre-existing code. |
| Scalability | ✅ Strong | Fail-open per-candidate: one failing `fetch` does not block others. One fetch per candidate is acceptable for ≤7 memories/session. |
| Maintainability | ⚠️ Adequate | Clear TODOs for interim REST endpoints. Instruction additions are strictly additive. Concern: missing dedicated auth-probe unit tests and dead code in `commit()`. |
| Code Quality | ✅ Strong | Naming is clear, comments explain non-obvious decisions, redaction is used in diagnostics. |
| Backend | ⚠️ Adequate | Fetch-based persistence is pragmatic. Error handling and governance gating are correct. Minor dead code and missing positive-path manifest test. |
| Frontend | N/A | No frontend changes. |
| Integration | ✅ Strong | `memoryBundle` flows correctly from provider → plan → manifest → agent/skill entries. Graceful degradation when auth fails. |

## Findings

### MAJOR

- **Maintainability / Testing**: Missing `opencode-mcp-config.test.ts` despite claimed coverage
  - **File**: `packages/adapter-opencode/src/opencode-mcp-config.ts` (validator function)
  - **Evidence**: `apply-progress.md` states "`opencode-mcp-config.test.ts` | Task 8 (auth probe) | ✅ 7 cases". A glob search of `packages/adapter-opencode/src/**/*.test.ts` confirms the file does not exist.
  - **Recommendation**: Create `packages/adapter-opencode/src/opencode-mcp-config.test.ts` with the 7 cases from Task 8: valid config, missing file, malformed JSON, missing server entry, empty auth header, custom serverName, and redaction verification. Mock `existsSync` and `readFileSync` to keep tests hermetic.

- **Security**: Pre-existing `appendSupermemoryEnvToBashrc` writes raw API key to `~/.bashrc` without deduplication or permissions checks
  - **File**: `packages/adapter-opencode/src/opencode-mcp-config.ts` — lines 162–176
  - **Evidence**: `appendFileSync(bashrcPath, exportLine)` appends `export SUPERMEMORY_API_KEY="<rawToken>"\n` unconditionally. No check for existing entries, no file permission restrictions, and no redaction.
  - **Recommendation**: Add a deduplication check before appending (e.g., read `~/.bashrc` and skip if the export line already exists). Consider a more secure storage mechanism (e.g., prompt user to add to their shell profile manually, or use a dedicated secrets file with restricted permissions). At minimum, document the risk.

### MINOR

- **Code Quality**: Dead code in `commit()` — `containerTag` variable is computed but never used
  - **File**: `packages/adapter-supermemory/src/index.ts` — lines 103–110
  - **Evidence**: The `containerTag` local is mapped from `candidate.scope.scope` but the payload (line 121) uses `candidate.containerTag` directly. Since governance already validates `candidate.containerTag`, the computed variable is redundant and confusing.
  - **Recommendation**: Remove the unused `containerTag` computation or use it in the payload for consistency.

- **Maintainability / Testing**: `runner-capabilities.test.ts` does not test the positive `memoryBundle` flow
  - **File**: `packages/adapter-opencode/src/runner-capabilities.test.ts` — lines 103–144
  - **Evidence**: Both tests in the `memoryBundle flow` describe block assert `memoryBundle === undefined`. The comment says the non-null case is "tested indirectly" via `developer-team-install.test.ts`, but there is no direct assertion that `buildDeveloperTeamManifest` propagates a non-null bundle to agents/skills.
  - **Recommendation**: Add a test that passes `memoryInjection: preBuiltBundle` through the manifest input and asserts `manifest.agents[0].memoryBundle` is non-null with the expected tool bindings.

- **Code Quality**: Type-unsafe access to `existingMemoryId` and `topicKey`
  - **File**: `packages/adapter-supermemory/src/index.ts` — lines 116, 125
  - **Evidence**: `(candidate as unknown as { existingMemoryId?: string }).existingMemoryId` and similar for `topicKey`. This bypasses the type system because the core types don't declare these fields.
  - **Recommendation**: Extend the core `AdaptiveMemoryCandidate` type (or its metadata) to optionally include `existingMemoryId` and `topicKey`, or at least add a typed helper function instead of repeated `unknown` casts.

### NIT

- **Code Quality**: Significant duplication across agent/session/skill instruction surfaces
  - **File**: `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`
  - **Recommendation**: This follows the existing pattern in the file, but consider extracting the duplicated tables (Decision Examples, Suggested Topic Keys, Save Trigger Matrix) into shared fragments or a template helper in a future refactor to reduce maintenance burden when updating examples.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes — with minor deviations noted below.
- **Deviations**:
  1. **Task 7 (loadContext/search) deferred**: The design anticipated potential deferral. The apply-progress confirms it was deferred as P2. Acceptable per scope reduction recommendation.
  2. **No `opencode-mcp-config.test.ts`**: The design explicitly lists this test file in the File Impact Estimate and Testing Strategy. Its absence is a deviation from the planned test coverage.
  3. **Interim REST endpoints**: The design noted the exact endpoint is an open question. The implementation uses `/api/memories/add` and `/api/memories/update` with clear TODO comments. This matches the recommended handling.

## Open Questions

1. **Exact Supermemory REST schema**: The TODO in `commit()` acknowledges the endpoint is interim. When will the correct endpoint/payload be confirmed and the TODO resolved?
2. **MCP URL mismatch**: The adapter defaults to `https://supermemory-new.stlmcp.com` while OpenCode config uses `https://mcp.supermemory.ai/mcp`. Are these the same service? If not, the default `mcpServerUrl` may need to change.
3. **Pi adapter `memoryBundle`**: The design notes Pi has the same hardcoding bug but it's out of scope. Should a follow-up change fix Pi's `runner-capabilities.ts` as well?

> If none, write "None."
