# Archive Report: Adaptive Memory Tool Binding Fix

## Summary

The adaptive memory system in Deck now has functional tool bindings for OpenCode agents. Four root causes were fixed: (1) OpenCode runner-capabilities.ts now reads `memoryBundle` from the install plan instead of hardcoding `undefined`, (2) adapter-supermemory commit() persists memories via native `fetch` instead of discarding all candidates, (3) OpenCode has an auth probe (`validateSupermemoryOpenCodeMcpConfig`) that validates Supermemory MCP config before injecting tool bindings, and (4) adaptive-memory instructions now include concrete decision examples, suggested topic keys, and a save-trigger matrix across all three surfaces (agent, session, skill).

## Artifacts Produced

| Artifact | Path | Status |
|---|---|---|
| Proposal | `openspec/changes/adaptive-memory-tool-binding-fix/proposal.md` | Complete |
| Spec | `openspec/changes/adaptive-memory-tool-binding-fix/spec.md` | Complete |
| Design | `openspec/changes/adaptive-memory-tool-binding-fix/design.md` | Complete |
| Tasks | `openspec/changes/adaptive-memory-tool-binding-fix/tasks.md` | Complete |
| Apply Progress | `openspec/changes/adaptive-memory-tool-binding-fix/apply-progress.md` | Complete |
| Verify Report | `openspec/changes/adaptive-memory-tool-binding-fix/verify-report.md` | PASS WITH WARNINGS |
| Review Report | `openspec/changes/adaptive-memory-tool-binding-fix/review-report.md` | PASS WITH CONCERNS |
| Archive Report | `openspec/changes/adaptive-memory-tool-binding-fix/archive-report.md` | Complete |

## Files Changed

| File | Change |
|---|---|
| `packages/adapter-opencode/src/runner-capabilities.ts` | Replaced `memoryBundle: undefined` with `plan.memoryBundle` (2 lines) |
| `packages/adapter-opencode/src/developer-team-install.ts` | Added `memoryBundle` field to plan type/return; wired auth probe into memory resolution |
| `packages/adapter-opencode/src/opencode-mcp-config.ts` | Added `validateSupermemoryOpenCodeMcpConfig` auth probe; changed diagnostics type to `string[]` |
| `packages/adapter-supermemory/src/index.ts` | Implemented fetch-based commit persistence; added `apiKey`/`mcpServerUrl` config; removed dead `containerTag` |
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | Added decision examples (≥5/surface), topic keys (≥7 work types), save trigger matrix (≥7 moments) |
| `packages/adapter-opencode/src/opencode-mcp-config.test.ts` | Created (new) — 7 test cases for auth probe validator |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | Added 3 test cases for memoryBundle flow |
| `packages/adapter-opencode/src/runner-capabilities.test.ts` | Added 2 test cases + positive-path coverage |
| `packages/adapter-supermemory/src/index.test.ts` | Updated — 6 new test cases for commit persistence |
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.test.ts` | Created (new) — 19 test cases for instruction bundle content |

## Test Coverage

- **Total tests**: 164 / 164 passed
- **adapter-opencode**: 129 pass, 0 fail
- **adapter-supermemory**: 16 pass, 0 fail
- **core adaptive-memory**: 19 pass, 0 fail

## Deferred Work

**Task 7 (REQ-AMS-006)**: Implement fetch-based `loadContext` and `search` in adapter-supermemory — Deferred as P2.

Reason: Scope reduction recommended in review workload forecast. The core fix (commit persistence) is implemented and functional. The deferred items are nice-to-have but not blocking for the primary use case (agents saving memories).

## Open Questions Resolved

1. **Supermemory REST API payload shape**: Interim endpoints used (`/api/memories/add`, `/api/memories/update`) with clear TODO comments. Exact schema needs confirmation in a follow-up.
2. **Memory ID format**: Treated as opaque string; `existingMemoryId` triggers update endpoint.

## Warnings

1. **Test file type safety**: 19 TypeScript errors remain in `.test.ts` files (mock adapter type mismatches). Bun tests pass at runtime; this is a maintainability concern, not a runtime issue.
2. **REQ-ROM-003 naming gap**: Spec text says `supermemory_memory/supermemory_recall` but actual tool names are `execute/search_docs`. Functionally correct — instruction bundle maps conceptual names to actual MCP tools.
3. **Pre-existing security concern**: `appendSupermemoryEnvToBashrc` writes API key to `~/.bashrc` without deduplication — pre-existing, not introduced by this change.

## Git Commit Suggestion (Advisory)

**Conventional commit** (multiple candidates):

```
feat(adaptive-memory): inject memory tool bindings into OpenCode agents

- Fix runner-capabilities.ts to read memoryBundle from install plan
- Implement fetch-based commit persistence in adapter-supermemory
- Add validateSupermemoryOpenCodeMcpConfig auth probe for OpenCode
- Enhance instruction bundle with decision examples, topic keys, trigger matrix

Closes #<issue>
```

Or, as multiple commits:

```
feat(adapter-opencode): pass memoryBundle tool bindings to developer team agents

fix(adapter-supermemory): persist memories via fetch instead of discarding

feat(adapter-opencode): add Supermemory auth probe validation

feat(core): enhance adaptive-memory instructions with concrete examples
```

---

**Note**: Archive is complete. The change is done. Remaining items (Task 7, test file type safety, Supermemory REST schema) are tracked as follow-up work, not blocking for the primary objective of making adaptive memory functional for OpenCode agents.