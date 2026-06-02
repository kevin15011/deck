# Archive Report: Add Self-Update System

## Change Summary

**Change**: add-self-update-system
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/add-self-update-system/`

### Lifecycle
- **Proposal**: 2026-06-01 — repo-agnostic self-update system with release descriptors, XDG migration, TUI integration
- **Spec + Design**: 2026-06-01 — parallel, both completed (64 requirements, 8 architecture decisions)
- **Tasks**: 2026-06-02 — 23 atomic tasks across G1 (5), G2 (12), G3 (6)
- **Apply**: 2026-06-02 — all groups completed, tests pass
- **Verify**: 2026-06-02 — PASS WITH WARNINGS (246/246 focused tests pass, 0 self-update type errors)
- **Review**: 2026-06-02 — APPROVED WITH FINDINGS (0 blockers, 3 warnings pre-existing baseline)
- **Archive**: 2026-06-02 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-RD-001 | T1.1, T2.1 | ✅ release-descriptor.ts schema + parsing | ✅ PASS | ✅ Strong |
| REQ-RD-002..011 | T1.1, T2.1, T2.2 | ✅ descriptor validation + legacy fallback | ✅ PASS | ✅ Strong |
| REQ-XDG-001..009 | T2.3 | ✅ XDG paths + migration in paths.ts | ✅ PASS | ✅ Strong |
| REQ-MIG-001..003 | T2.3 | ✅ xdg-migration.ts one-shot migration | ✅ PASS | ✅ Strong |
| REQ-TUI-001..008 | T3.1, T3.2, T3.3 | ✅ TUI release-check, banner, screens | ✅ PASS | ✅ Strong |
| REQ-ATM-001..012 | T2.4, T2.5, T2.6 | ✅ state/manifest/backup stores + rollback | ✅ PASS | ✅ Strong |
| REQ-SYNC-001..007 | T2.8 | ✅ runner-sync.ts content sync | ✅ PASS | ✅ Strong |
| REQ-RUN-001..003 | T2.9, T2.10 | ✅ RunnerAdapter.detectDeckInstall | ✅ PASS | ✅ Strong |
| REQ-RBK-001..005 | T2.6, T3.4, T3.5 | ✅ CLI + TUI rollback | ✅ PASS | ✅ Strong |
| REQ-USP-001..003 | T2.8 | ✅ config.json as source of truth | ✅ PASS | ✅ Strong |
| REQ-REL-001..003 | T1.2, T1.3, T1.5 | ✅ prepare-release.ts + release.yml + CHANGELOG | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 3
- 44 baseline errors in `apps/cli/src/tui/app.tsx` (runner-dashboard/app-flow) - pre-existing
- 81 baseline errors in other repo files - pre-existing, unrelated to self-update
- Repo-wide typecheck exits 2 due to known baseline debt

**Self-update focused**: 0 type errors in upgrade-command, runner-adapter tests, changed frontend files

## Review

**Rating**: APPROVED WITH FINDINGS
**Blockers**: 0
**Major Findings**: 0

## Follow-ups

None — change is fully closed.

> **Note on verification**: Verify passed_with_warnings due to known baseline typecheck errors outside self-update focused files. Self-update focused tests/type errors pass.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Release descriptor schema**: snake_case format (`tag_name`, `asset_name`, `sha256`, `content_kinds`, `successor_channel`) must match spec exactly — design camelCase was incompatible
- **RunnerAdapter detection**: optional `detectDeckInstall()` method added for filesystem-based runner detection; OpenCode implements it
- **XDG migration**: one-shot, fail-closed, backup-first pattern prevents data loss during config migration
- **Non-blocking TUI**: release check uses 5s timeout + Promise.race to never block home render
- **Atomic upgrade**: lock + backup + staging + atomic rename pattern ensures rollback safety

> If none, write "None — no new reusable learnings."

---

## Registry Summary

| Field | Value |
|---|---|
| Phase | archive |
| Status | archived |
| Artifact | archive-report.md |
| Event | archive-complete |
| Date | 2026-06-02 |
