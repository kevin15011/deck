# Archive Report: Streamline Project Documentation

## Change Summary

**Change**: `streamline-project-documentation`
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/streamline-project-documentation/`
**Archived on**: 2026-07-13

### Lifecycle

| Phase | Agent | Date | Outcome |
|---|---|---|---|
| Proposal | deck-developer-proposal | 2026-07-12 | Completed — five entry points, authority boundaries, safe migration/deletion |
| Spec | deck-developer-spec | 2026-07-12 | Completed — 31 requirements, 29 acceptance scenarios |
| Design | deck-developer-design | 2026-07-12 | Completed — seven curated docs, two thin wrappers, focused governance test |
| Tasks | deck-developer-task | 2026-07-12 | Completed — 12 tasks (Tasks 1–8, 9, 9R, 10, 11) |
| Apply | deck-developer-apply-general | 2026-07-12/13 | Completed with repairs — all tasks finished |
| Verify | deck-developer-verify | 2026-07-13 | PASS WITH WARNINGS — 31/31 requirements, 29/29 scenarios, 12/12 tasks |
| Review | deck-developer-review | 2026-07-13 | APPROVE — 0 blockers, 0 majors, 0 minors |
| Archive | deck-developer-archive | 2026-07-13 | Archived |

### Change Description

Replaced the repository's fragmented documentation surface with a small, durable system for users, contributors, AI agents, architecture readers, and release maintainers. The change introduced five maintained entry points, two thin local skill wrappers, one focused Bun governance test, migration of durable knowledge, evidence-backed debt disposition, and safe deletion of five obsolete snapshots. Canonical repository identity was normalized to `kevin15011/deck` throughout. No product runtime behavior, generated output, or historical OpenSpec artifact was changed.

---

## Delivered Documentation Architecture

Seven maintained documents and two thin local skill wrappers:

| Document | Audience | Authority class | Purpose |
|---|---|---|---|
| `README.md` | Users | Normative procedure | Purpose, supported install/use paths, first run, command summary, navigation |
| `CONTRIBUTING.md` | Contributors | Normative procedure | Setup, exact commands, verification tiers, OpenSpec workflow, generated-file rules |
| `AGENTS.md` | AI agents | Explanatory navigation | Compact authority order, safety boundaries, generated-file prohibitions, OpenSpec authority |
| `CHANGELOG.md` | Users, maintainers | Historical record | Release history only; not a roadmap or operational manual |
| `docs/architecture.md` | Contributors, maintainers, agents | Explanatory navigation | Stable package boundaries and major control/materialization flows |
| `docs/maintainers/releasing.md` | Maintainers | Normative procedure | Release procedure, root-version authority, descriptor workflow, verification, rollback |
| `docs/release-descriptor.md` | Release producers/integrators | Compatibility reference | Concise descriptor purpose, authority chain, minimal shape, kind summary |
| `.agents/skills/deck-release-publish/SKILL.md` | Project-local agents | Explanatory navigation | Thin release trigger/safety wrapper delegating to `releasing.md` |
| `.agents/skills/openspec-retrospective-audit/SKILL.md` | Project-local agents | Explanatory navigation | Thin read-only audit wrapper delegating to OpenSpec authority |

All nine surfaces include an `Audience / Authority / Maintainer / Evidence` role block, progressive disclosure, and authoritative links to executable sources.

---

## Traceability Matrix

| REQ-ID | Task(s) | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-ENTRY-001 | T2, T3 | ✅ Created 7 maintained entry points with role blocks | ✅ PASS | ✅ Strong |
| REQ-ENTRY-002 | T2 | ✅ README user quick path with verified command summary | ✅ PASS | ✅ Strong |
| REQ-ENTRY-003 | T2 | ✅ No copied version/inventory; volatile facts linked to source | ✅ PASS | ✅ Strong |
| REQ-ENTRY-004 | T2, T3 | ✅ Progressive disclosure; audience-first first section | ✅ PASS | ✅ Strong |
| REQ-GUIDE-001 | T2, T5 | ✅ CONTRIBUTING owns exact executable commands; validation passes | ✅ PASS | ✅ Strong |
| REQ-GUIDE-002 | T2, T6 | ✅ AGENTS is compact, authority-ordered, source-linked | ✅ PASS | ✅ Strong |
| REQ-GUIDE-003 | T2, T6 | ✅ No phase prompt duplication, roster copy, or absent-registry claim | ✅ PASS | ✅ Strong |
| REQ-GUIDE-004 | T7, T8, T10 | ✅ Git-safety/no-op behavior remains after roadmap deletion | ✅ PASS | ✅ Strong |
| REQ-OPS-001 | T3 | ✅ Architecture describes stable seams, not line-number inventory | ✅ PASS | ✅ Strong |
| REQ-OPS-002 | T3, T4 | ✅ Release guide consistent with workflow/scripts; confirmation gates | ✅ PASS | ✅ Strong |
| REQ-OPS-003 | T4 | ✅ Descriptor retained at path; schema/fixture remain authoritative | ✅ PASS | ✅ Strong |
| REQ-OPS-004 | T6 | ✅ Both wrappers are English thin delegates; no nonexistent commands | ✅ PASS | ✅ Strong |
| REQ-GOV-001 | T2–T6 | ✅ Authority hierarchy consistently applied across all surfaces | ✅ PASS | ✅ Strong |
| REQ-GOV-002 | T1–T6 | ✅ All 9 surfaces declare Audience/Authority/Maintainer/Evidence | ✅ PASS | ✅ Strong |
| REQ-GOV-003 | T2–T6 | ✅ No live test counts, copied versions, local paths, or roster copies | ✅ PASS | ✅ Strong |
| REQ-GOV-004 | T1, T5, T11 | ✅ Generated outputs unchanged; ownership markers preserved | ✅ PASS | ✅ Strong |
| REQ-GOV-005 | T1 | ✅ No docs site, portal, inventory, or competing authority introduced | ✅ PASS | ✅ Strong |
| REQ-ID-001 | T1, T4, T5 | ✅ `kevin15011/deck` in maintained docs and 3 canonical fixtures | ✅ PASS | ✅ Strong |
| REQ-ID-002 | T5 | ✅ arbitrary-host/file-URL parser fixtures remain scoped test data | ✅ PASS | ✅ Strong |
| REQ-ID-003 | T4 | ✅ CHANGELOG is history-only; delegates operational questions | ✅ PASS | ✅ Strong |
| REQ-MIGRATE-001 | T9, T9R | ✅ 9 debt topics (D-01–D-09) each have a permitted disposition | ✅ PASS | ✅ Strong |
| REQ-MIGRATE-002 | T7, T8, T10 | ✅ Roadmap deleted; invariant tests pass without it | ✅ PASS | ✅ Strong |
| REQ-MIGRATE-003 | T10 | ✅ OpenSpec archives/specs/fixtures preserved unchanged | ✅ PASS | ✅ Strong |
| REQ-MIGRATE-004 | T1, T9 | ✅ Historical OpenSpec excluded from live-link crawl | ✅ PASS | ✅ Strong |
| REQ-MIGRATE-005 | T10 | ✅ 5 snapshots deleted; no compatibility stub | ✅ PASS | ✅ Strong |
| REQ-VALIDATE-001 | T1–T6, T10 | ✅ `tests/documentation-governance.test.ts` validates entry points, links, commands, identity, boundaries | ✅ PASS | ✅ Strong |
| REQ-VALIDATE-002 | T1, T11 | ✅ Failures identify source file and offending reference | ✅ PASS | ✅ Strong |
| REQ-VALIDATE-003 | T1, T11 | ✅ No network access, machine-local paths, or exhaustive source crawl | ✅ PASS | ✅ Strong |
| REQ-VALIDATE-004 | T1–T6 | ✅ Claims agree with source/metadata/workflow/scripts/schema/fixtures | ✅ PASS | ✅ Strong |
| REQ-LANG-001 | T2–T6, T10 | ✅ All maintained docs and wrappers are English | ✅ PASS | ✅ Strong |
| REQ-LANG-002 | T10 | ✅ Historical evidence retained unchanged | ✅ PASS | ✅ Strong |

---

## Requirements Summary

- **Total requirements**: 31 (REQ-ENTRY-001–004, REQ-GUIDE-001–004, REQ-OPS-001–004, REQ-GOV-001–005, REQ-ID-001–003, REQ-MIGRATE-001–005, REQ-VALIDATE-001–004, REQ-LANG-001–002)
- **All satisfied**: 31/31

## Tasks Summary

- **Total tasks**: 12 (Tasks 1–8, 9, 9R, 10, 11)
- **All completed**: 12/12

---

## Verification

**Result**: PASS WITH WARNINGS
**Requirements**: 31/31 PASS
**Scenarios**: 29/29 PASS
**Tasks**: 12/12 PASS
**Focused gates**: 314 passed, 0 failed
**Typecheck**: PASS — `bunx tsc --noEmit` exit 0, 0 errors
**Full suite**: 3296 passed, 1 fail (exact maintained Binary smoke doctor baseline)
**Critical findings**: 0
**Warnings**: 1 (known baseline, not a change regression — see Known Warnings)

---

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major findings**: 0
**Minor findings**: 0
**Optional nits**: 1 (non-blocking wording nit in `docs/maintainers/releasing.md:29`)

---

## File Summary

### Created (5)

| File | Purpose |
|---|---|
| `CONTRIBUTING.md` | Contributor operating guide — setup, exact commands, verification tiers, OpenSpec workflow |
| `AGENTS.md` | Compact AI-agent authority/safety map |
| `docs/architecture.md` | Stable package boundaries and major control/materialization flows |
| `docs/maintainers/releasing.md` | Human release procedure, descriptor workflow, verification, rollback |
| `tests/documentation-governance.test.ts` | Focused Bun governance test — entry points, links, commands, identity, generated boundaries, deletion absence |

### Updated (14)

| File | Change |
|---|---|
| `README.md` | Rewritten as concise English user entry point; removed copied version and obsolete links |
| `CHANGELOG.md` | Limited to release history; normalized canonical repository link |
| `docs/release-descriptor.md` | Shortened to concise compatibility reference; authority links corrected |
| `.agents/skills/deck-release-publish/SKILL.md` | Thin English wrapper; removed nonexistent commands and stale policy |
| `.agents/skills/openspec-retrospective-audit/SKILL.md` | Shortened English wrapper; delegates to OpenSpec authority |
| `packages/core/src/teams/developer/git-safety.test.ts` | Removed roadmap-presence assertion; retained all behavior/source/coverage tests |
| `packages/core/src/teams/developer/no-op-skill-absence.test.ts` | Removed roadmap authority citation; preserved typed catalog and absence checks |
| `apps/cli/src/upgrade-command/release-descriptor.ts` | Corrected stale contract comment to archived spec |
| `apps/cli/src/upgrade-command/__tests__/release-descriptor.test.ts` | Corrected stale contract comment; tests unchanged |
| `scripts/prepare-release.ts` | Corrected source/help authority path comment |
| `scripts/prepare-release.test.ts` | Corrected stale contract comment; tests unchanged |
| `apps/cli/src/upgrade-command/__fixtures__/release-fixture.json` | Normalized Deck URLs to `kevin15011/deck` |
| `apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-no-upgrade.json` | Normalized release-notes identity to `kevin15011/deck` |
| `apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-upgrade.json` | Normalized release-notes identity to `kevin15011/deck` |
| `openspec/baseline-health.yaml` | Refreshed to exact current Binary smoke doctor fingerprint (maintained ledger) |

### Deleted (5)

| File | Disposition |
|---|---|
| `docs/tool-references.md` | Consumer-safe; durable upstream links moved to CONTRIBUTING and AGENTS |
| `docs/prompt-methodology-modules.md` | Consumer-safe; stable concepts moved to architecture.md |
| `docs/skills-integration-roadmap.md` | Consumer-safe after T7/T8 invariant migration; D-01 disposition resolved |
| `docs/deuda-tecnica.md` | Deleted after D-01–D-09 evidence-backed dispositions (D-01: resolved; D-02: deferred `test-suite-baseline-recovery`; D-03–D-04: covered by `artifact-state-contracts`/`hexagonal-architecture-memory-refactor`; D-05–D-06: resolved; D-07–D-08: covered by `fix-install-upgrade-regressions`/`hexagonal-architecture-memory-refactor`; D-09: deferred `large-file-boundary-refactor`) |
| `docs/openspec-retrospective-audit-2026-06-12.md` | Consumer-safe; lineage preserved in OpenSpec/Git history |

### Unchanged (protected)

- All `openspec/archive/**` artifacts
- All `openspec/changes/**` artifacts (active and other)
- All `openspec/specs/**` promoted specifications
- `packages/core/src/skills/external/content.generated.ts`
- `apps/cli/src/runtime/build-info.generated.ts`
- All `packages/core/src/skills/external/**` handwritten distributable inputs
- All workspace package manifests and workflows

---

## Deletion Safety

- Pre-deletion consumer search found zero maintained consumers for all five snapshot candidates.
- All nine debt topics extracted from `docs/deuda-tecnica.md` have exactly one permitted disposition recorded in `apply-progress.md` (D-01 through D-09).
- `openspec/changes/**` and `openspec/archive/**` hits were classified as historical provenance, not active consumers.
- Exactly five approved snapshots deleted; no stub created.
- Git-safety and no-op tests pass without consuming any deleted document.
- Historical OpenSpec artifacts and generated outputs are untouched.

---

## Repair and Override History

| Cycle | Trigger | Findings resolved | Budget used |
|---|---|---|---|
| Repair 1 | Missing authorization card fingerprint (Task 9) | Authorized-card retry succeeded | 1/2 Apply retries; 1/1 fingerprint |
| Repair 2 | Debt-disposition replan for `docs/deuda-tecnica.md` | Task 9R: 9 evidence-backed dispositions recorded | 1/2 Apply retries; 1/1 fingerprint |
| Repair 3 | Review: 6 majors + 1 changelog minor | Bounded documentation, governance, and ledger refresh | 1/2 Apply retries; 2/2 fingerprints |
| Override 1 | Human-authorized: release/descriptor truth, command governance, baseline | Release accuracy, baseline suite field, partial command governance | 1/1 override; 3/3 findings |
| Override 2 (final narrow) | Human `Proceed`: Bun command governance only | Command-governance predicate (existing target requirement + invalid inline extraction) | 1/1 narrow Apply; 1/1 fingerprint; 1/1 Verify/Review cycle |

All repair and override budgets are exhausted. No further Apply is authorized.

---

## Known Warnings

### Binary smoke doctor baseline warning (NOT a change regression)

The repository-wide suite reports one failure: `Binary smoke tests > doctor runs and reports diagnostics` in `apps/cli/src/__tests__/binary-smoke.test.tsx`. This is the **exact maintained Binary smoke doctor baseline** fingerprint as recorded in `openspec/baseline-health.yaml`:
- **File**: `apps/cli/src/__tests__/binary-smoke.test.tsx` — unchanged by this change
- **Suite**: `Binary smoke tests` — unchanged
- **Test name**: `doctor runs and reports diagnostics` — unchanged
- **Error signature**: `bun-test-timeout-5000ms; killed 1 dangling process` — environment-sensitive subprocess timeout, unrelated to documentation
- **Counts**: 3296 passed, 1 fail across 174 files — matches ledger exactly

This is an **environment-sensitive subprocess termination** (exit code 143 after dangling-process kill), not a behavioral change introduced by this change. The baseline ledger was refreshed by the authorized Apply repair with current evidence. The ledger policy permits `PASS WITH WARNINGS` when the exact known fingerprint is reproduced and documented. **This warning does not represent a change regression.**

### Registry warning (legacy event-name compatibility)

The canonical single-change validator reports 15 warning-only diagnostics: 14 `events.event.name_mismatch` compatibility warnings (which include the `archive.completed` event among their set) plus 1 `repair_incident.artifact.missing` warning. These are mechanical reconciliation concerns, not engineering defects. The validator confirms `ok: true` with 0 errors.

---

## Optional Follow-ups

| Priority | Follow-up | Owner |
|---|---|---|
| Low (optional) | Remove "when applicable" qualifier from `docs/maintainers/releasing.md:29` to mirror the two current workflow paths verbatim. Lines 20 and 28 already state the actual behavior accurately; no repair is required by this change. | Maintainer |

---

## Rollback Summary

**Rollback mechanism**: Normal Git revert commit or targeted restoration commit.
**Scope of rollback**: Documentation files, focused governance test, fixture normalization, test comment corrections, and `openspec/baseline-health.yaml` ledger refresh.
**Product runtime**: Unchanged; rollback targets only prose, fixtures, test comments, and the ledger.
**Generated outputs**: Not rollback targets (never manually edited).
**Historical OpenSpec**: Not rollback targets (not modified by implementation).

If a deleted snapshot has a demonstrated active consumer after rollback:
1. Restore only that file temporarily from Git history.
2. Mark it non-authoritative.
3. Repair/migrate the consumer.
4. Remove in a follow-up commit.

Do **not** use `git reset --hard` or `git restore` to discard committed work without explicit user confirmation.

---

## Project AI Notes

**Phase 5 — Deferred.** Project AI notes under `.deck/ai-notes/` are a planned Phase 5 feature. Not yet active; this step is skipped.

---

## Change Artifact Preservation

All following artifacts are preserved in full in the archive directory:

| Artifact | Lines | Purpose |
|---|---|---|
| `proposal.md` | 237 | Intent, scope, audience boundaries, safe migration/deletion approach |
| `spec.md` | 445 | 31 requirements, 29 Given/When/Then scenarios, validation rules |
| `design.md` | 353 | Target architecture, file tree, ownership boundaries, focused test design |
| `tasks.md` | 463 | 12 ordered tasks with dependency graph, traceability, verification plan |
| `preconditions.md` | — | No external/user/environment preconditions; Task 9 internal deletion gate |
| `apply-progress.md` | 288 | Task execution evidence, deletion safety gates, 9-row debt-disposition table, repair history |
| `verify-report.md` | 242 | Final narrow PASS WITH WARNINGS; full requirements/scenarios/tasks matrix; baseline comparison |
| `review-report.md` | 151 | Final APPROVE; command-governance resolution matrix; 0 blockers/majors/minors; optional nit |
| `state.yaml` | 150 | Full phase/event history with all repair/override provenance |
| `events.yaml` | 421 | Complete event log including repair starts, resolutions, escalations, overrides |
| `archive-report.md` | This file | Final traceability, delivery, and closure summary |

---

## Registry State

The change `streamline-project-documentation` completed with:
- **Phase**: `archive`
- **Status**: `archived`
- **Event**: `archive.completed`
- **Artifact**: `archive-report.md`
- **Archive target**: `openspec/archive/streamline-project-documentation/`

All prior phase events, repair/override events, and failure/recovery cycles are preserved in `state.yaml` and `events.yaml`.

---

## Registry Validation Summary

- **Single-change validator**: `ok: true`, 0 errors, 15 warning-only diagnostics (14 `events.event.name_mismatch` compatibility + 1 `repair_incident.artifact.missing`)
- **Warning diagnostics**: legacy event-name compatibility (non-blocking) + optional repair-incident linkage (non-blocking)
- **No mechanical registry blockers**

---

## Diff Context (Working Tree — Advisory for Git Suggestions)

```
Modified (17 files):
  .agents/skills/deck-release-publish/SKILL.md       thin English wrapper
  .agents/skills/openspec-retrospective-audit/SKILL.md thin English wrapper
  CHANGELOG.md                                         release-history-only repair
  README.md                                            user quick path rewrite
  apps/cli/src/upgrade-command/__fixtures__/release-fixture.json          identity normalization
  apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-*.json identity normalization
  apps/cli/src/upgrade-command/__tests__/release-descriptor.test.ts     comment correction
  apps/cli/src/upgrade-command/release-descriptor.ts                    comment correction
  docs/release-descriptor.md                           shortened, authority-corrected
  openspec/baseline-health.yaml                       refreshed ledger fingerprint
  packages/core/src/teams/developer/git-safety.test.ts roadmap assertion removed
  packages/core/src/teams/developer/no-op-skill-absence.test.ts roadmap citation removed
  scripts/prepare-release.test.ts                     comment correction
  scripts/prepare-release.ts                          authority path correction
  tests/documentation-governance.test.ts               NEW focused governance test
  + docs/architecture.md                              NEW stable boundary docs
  + docs/maintainers/releasing.md                     NEW release procedure
  + CONTRIBUTING.md                                   NEW contributor guide
  + AGENTS.md                                         NEW agent map
Deleted (5 files):
  docs/deuda-tecnica.md                               D-01–D-09 dispositions recorded
  docs/openspec-retrospective-audit-2026-06-12.md    historical lineage preserved
  docs/prompt-methodology-modules.md                  stable concepts → architecture
  docs/skills-integration-roadmap.md                  invariants migrated to canonical tests
  docs/tool-references.md                            durable links → maintained docs
Unchanged (protected):
  All openspec/archive/**, openspec/changes/**, openspec/specs/**,
  packages/core/src/skills/external/content.generated.ts,
  apps/cli/src/runtime/build-info.generated.ts,
  all workspace manifests, all workflows
```

**Net change**: +135 / −3002 lines; 20 files changed.
