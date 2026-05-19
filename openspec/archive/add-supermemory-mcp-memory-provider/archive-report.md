# Archive Report: Add Supermemory MCP Memory Provider

## Change Summary

**Change**: add-supermemory-mcp-memory-provider
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/add-supermemory-mcp-memory-provider/`

### Lifecycle
- **Proposal**: 2026-05-19 — Add Supermemory MCP as a selectable adaptive-memory provider with Pi-first integration
- **Spec + Design**: 2026-05-19 — Parallel, both completed with Pi MCP credential handoff resolution
- **Tasks**: 2026-05-19 — 15 tasks created across Shared/Contracts (5), Backend (5), Frontend (3), General (2)
- **Apply**: 2026-05-20 — 15/15 tasks completed + review remediation pass
- **Verify**: 2026-05-20 — PASS (331/331 focal, 722/722 full, tsc clean)
- **Review**: 2026-05-20 — APPROVED WITH CHANGES (0 blockers, 2 non-blocking follow-ups)
- **Archive**: 2026-05-19 — Archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-SPS-001 | Task 11, 13 | ✅ CLI/TUI offer Supermemory option | ✅ PASS | ✅ Strong |
| REQ-SPS-002 | Task 12 | ✅ Single active provider enforced | ✅ PASS | ✅ Strong |
| REQ-SPS-003 | Task 4 | ✅ Provider persisted in `.deck/config.json` | ✅ PASS | ✅ Strong |
| REQ-SPS-004 | Task 13 | ✅ TUI confirms active provider after setup | ✅ PASS | ✅ Strong |
| REQ-SIT-001 | Task 13 | ✅ TUI prompts for token during install | ✅ PASS | ✅ Strong |
| REQ-SIT-002 | Task 4, 13, 15 | ✅ Token never in `.deck/config.json`; Pi MCP config only | ✅ PASS | ✅ Adequate |
| REQ-SIT-003 | Task 4 | ✅ Non-secret settings in `.deck/config.json` | ✅ PASS | ✅ Strong |
| REQ-SIT-004 | Task 4, 13 | ✅ `userId` required and validated | ✅ PASS | ✅ Strong |
| REQ-SIT-005 | Task 13 | ✅ `teamId`/`orgId` optional, scopes limited when absent | ✅ PASS | ✅ Strong |
| REQ-SIT-006 | Task 13 | ✅ Invalid/missing inputs produce actionable error | ✅ PASS | ✅ Strong |
| REQ-SPI-001 | Task 9 | ✅ Pi runtime is the first supported target | ✅ PASS | ✅ Strong |
| REQ-SPI-002 | Task 9 | ✅ Pi sessions can request Supermemory context | ✅ PASS | ✅ Adequate |
| REQ-SPI-003 | — | ✅ Non-Pi runtimes not required | ✅ PASS | ✅ Strong |
| REQ-AMP-001 | Task 6, 12 | ✅ Exactly one provider loaded | ✅ PASS | ✅ Strong |
| REQ-AMP-002 | Task 2, 6 | ✅ Provider-neutral contract with equivalent operations | ✅ PASS | ✅ Strong |
| REQ-AMP-003 | Task 9 | ✅ Provider failure does not block workflow | ✅ PASS | ✅ Strong |
| REQ-AMP-004 | Task 10 | ✅ Absence of adaptive memory visible when unavailable | ✅ PASS | ✅ Strong |
| REQ-AMP-005 | Task 6 | ✅ Switching providers preserves OpenSpec artifacts | ✅ PASS | ✅ Strong |
| REQ-AMP-006 | Task 1 | ✅ Real MCP validation completed before runtime use | ✅ PASS | ✅ Adequate |
| REQ-SAC-001 | Task 8 | ✅ Supermemory provides advisory context | ✅ PASS | ✅ Adequate |
| REQ-SAC-002 | Task 8 | ✅ Context scoped to available user/project/team/org | ✅ PASS | ✅ Adequate |
| REQ-SAC-003 | Task 8 | ✅ Profile + targeted recall supported | ✅ PASS | ✅ Adequate |
| REQ-SAC-004 | Task 8, 10 | ✅ Failure results in safe fallback, no blocking | ✅ PASS | ✅ Strong |
| REQ-SPCA-001 | Task 5, 10 | ✅ OFFICIAL/ADAPTIVE sections rendered | ✅ PASS | ✅ Strong |
| REQ-SPCA-002 | Task 5 | ✅ Authority rule stated: OpenSpec authoritative, memory advisory | ✅ PASS | ✅ Strong |
| REQ-SPCA-003 | Task 5 | ✅ OpenSpec context ranked above adaptive memory | ✅ PASS | ✅ Strong |
| REQ-SPCA-004 | Task 5, 10 | ✅ Absence indicator when no adaptive context | ✅ PASS | ✅ Strong |
| REQ-AMG-001 | Task 3, 8 | ✅ Personal/project/team/org scope separation | ✅ PASS | ✅ Adequate |
| REQ-AMG-002 | Task 3, 8 | ✅ Short scoped container tags | ✅ PASS | ✅ Adequate |
| REQ-AMG-003 | Task 3 | ✅ Tag length/character validation | ✅ PASS | ✅ Adequate |
| REQ-AMG-004 | Task 3 | ✅ Required metadata fields enforced | ✅ PASS | ✅ Strong |
| REQ-AMG-005 | Task 3 | ✅ Only high-signal learnings saved | ✅ PASS | ✅ Strong |
| REQ-AMG-006 | Task 3 | ✅ Max 7, min 3 high-signal per session | ✅ PASS | ✅ Strong |
| REQ-AMG-007 | Task 3 | ✅ No specs/tasks/chats/secrets in memory | ✅ PASS | ✅ Strong |
| REQ-AMG-008 | Task 3, 8 | ✅ Team memories = candidate unless approved | ✅ PASS | ✅ Adequate |
| REQ-AMG-009 | Task 3, 8 | ✅ Scope/container/metadata filters applied | ✅ PASS | ✅ Adequate |
| REQ-AMG-010 | Task 3 | ✅ Audit info for automatic commits | ✅ PASS | ✅ Adequate |
| REQ-OAA-001 | Task 5, 6 | ✅ OpenSpec remains authoritative | ✅ PASS | ✅ Strong |
| REQ-OAA-002 | Task 5 | ✅ Memory cannot modify OpenSpec alone | ✅ PASS | ✅ Strong |
| REQ-OAA-003 | Task 3 | ✅ Derived learnings may be saved as memory | ✅ PASS | ✅ Strong |
| REQ-OAA-004 | — | ✅ No Engram migration in this change | ✅ PASS | ✅ Strong |
| REQ-SW-001 | Task 5, 6 | ✅ Workflow unchanged except advisory context | ✅ PASS | ✅ Strong |
| REQ-SW-002 | Task 9, 10 | ✅ Workflow functional without adaptive memory | ✅ PASS | ✅ Strong |

## Verification

**Result**: ✅ PASS
**Critical Findings**: 0
**Warnings**: 2
- `.deck/config.json` remains untracked; decide before commit whether to track or keep local
- Supermemory remains fail-closed until authenticated runtime health plumbing is implemented (non-blocking per Review)

## Review

**Rating**: ✅ APPROVED WITH CHANGES (after 2 remediation passes)
**Blockers**: 0
**Major Findings**: 2 (non-blocking)
1. No production path yet to convert authenticated Supermemory health validation into provider availability
2. `mcpServerName` is interpolated into Pi tool frontmatter without a conservative identifier allowlist

## Follow-ups

- **Medium**: Authenticated availability plumbing — add an injectable health probe or TTL/fingerprint cache to transition Supermemory from degraded to available after setup. Suggested owner: backend/general apply.
- **Medium**: `mcpServerName` format validation — validate with conservative allowlist (`^[A-Za-z0-9_-]{1,64}$`) in Deck config and Pi MCP writer; add rejection tests for unsafe characters. Suggested owner: backend apply.
- **Low**: Extract central redactor — move Pi MCP redaction logic to a shared Deck-controlled diagnostic redactor. Suggested owner: general apply.

> All non-blocking; change is fully closed for this cycle.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Supermemory MCP exposes only `execute` and `search_docs` tools** — not the provisional `context`/`recall`/`memory` tools. This was validated against the real endpoint at `https://supermemory-new.stlmcp.com`.
- **Pi global MCP config at `~/.pi/agent/mcp.json`** is the approved external secret boundary for Supermemory credentials; `.deck/config.json` must remain non-secret and reject token-like fields recursively.
- **Single active provider model** enforced at resolution time (CLI > `.deck/config.json` > `none`) prevents provider conflicts and simplifies governance.
- **OpenSpec authority separation** requires explicit `OFFICIAL CONTEXT` vs `ADAPTIVE CONTEXT` sections in all phase prompts, with the rule that OpenSpec artifacts are authoritative and memory is advisory.
- **Container tag governance** limits tags to 100 chars, `[A-Za-z0-9_:-]`, with scoped prefixes (`u:`, `p:`, `team:`, `o:`).
