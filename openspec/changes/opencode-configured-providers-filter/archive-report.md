# Abandoned Closure Report: OpenCode Configured Providers Filter

## Assessment

**Assessment date:** 2026-08-03  
**Disposition:** Abandoned closure, not Archive completion  
**Change:** `opencode-configured-providers-filter`

The available evidence supports closing this stale change as abandoned. This report does not claim Verify, independent Review, mandatory BROAD QA, rollout approval, or Archive completion.

## Official evidence reviewed

- `exploration.md`, recorded 2026-06-19: diagnosed that the adapter exposes all 145 cached providers, does not read `auth.json`, and has an `env`/`env_vars` mismatch; it also identified the TUI long-list rendering problem and proposed backend filtering plus `MenuList` windowing.
- `apply-progress.md`: records the frontend-only `MenuList` fix as complete, including its targeted test/typecheck evidence, and explicitly records that the backend `auth.json` reader, configured-provider filtering, and field-name fix remain undone.
- `state.yaml`: remains at `phase: apply`, `status: in_progress`, with the latest provenance dated 2026-06-21.
- `events.yaml`: records exploration completion and a frontend Apply event; it records no completed backend Apply, Verify, Review, or Broad QA event.
- Change-directory inventory: contains no proposal, spec, design, or tasks artifact. The preserved artifacts are `exploration.md`, `apply-progress.md`, `state.yaml`, and `events.yaml`.
- Current working tree inspection: no tracked diff and no source or test work-in-progress attributable to this change. The only untracked path is the unrelated `openspec/changes/auto-bootstrap-serena-prerequisites/` directory.
- User-provided context: the user does not remember actively working on this change and explicitly authorized abandoned closure when stale evidence supports it.

## Current implementation evidence

The frontend `MenuList` work is documented as completed in `apply-progress.md`: zero-width-space placeholders and defensive cursor clamping were added, with the recorded targeted tests and diagnostics passing. The backend scope was not completed: configured-provider discovery from `auth.json`, filtering of the model inventory, and the `env`/`env_vars` correction remain outstanding. Therefore the change does not represent a complete implementation of its diagnosed goal.

## Incomplete scope and residual risk

- OpenCode may still present providers from the complete cache catalog rather than only configured providers.
- Environment-variable provider detection may still be incomplete because the exploration identified the cache field-name mismatch.
- The frontend fix was not independently revalidated as part of this closure assessment; its evidence is preserved as historical Apply evidence only.
- No complete task/spec/design chain exists, and no Verify, independent Review, mandatory BROAD, or evaluator-bound quality evidence exists.
- Reactivation must reassess the current OpenCode cache/auth formats, environment-variable semantics, adapter contracts, and the broad impact of `MenuList` changes before implementation.

These are closure residuals, not accepted product risk for a shipped change.

## Closure reason and preservation

The change is stale: it has remained in Apply in progress since 2026-06-21, its backend scope is explicitly incomplete, no attributable source WIP is present, and the user authorized abandoned closure. All existing change artifacts and historical evidence remain in place. No rollback, deletion, move, destructive command, test run, installer run, or Git-state modification was performed.

## Future reactivation path

If the behavior is still needed, create or reactivate a new authorized implementation effort from the preserved exploration. Reconfirm requirements, produce the missing proposal/spec/design/tasks as appropriate, then implement and independently run the required Apply, Verify, Review, and mandatory BROAD gates against one immutable candidate. Reuse the frontend findings only as historical input; do not treat this closure as implementation approval.

## Recommended registry transition

The central coordinator alone should update registry YAML. No registry write was performed by this report.

Ordered `RegistryIntentV1` values, recommended but not persisted:

1. `currentPhase: closed`
2. `status: abandoned`
3. `closure_reason: stale incomplete Apply; backend configured-provider filtering was never implemented; user authorized abandoned closure`
4. `closed_at: 2026-08-03`
5. Preserve existing artifact and provenance references, and add this report as `archive_report: archive-report.md` without moving the change directory.

This is a canonical closed/abandoned transition, not an `archive` phase or `archived` status transition.

## FailureManifestV1

None. No new execution failure was produced. The missing backend implementation and missing lifecycle-gate evidence are closure blockers to claiming completion, not failures from a run performed during this assessment.

## Blockers

- **Blocking for Archive completion:** Verify, independent Review, mandatory BROAD QA, and evaluator-bound quality evidence are absent.
- **Blocking for implementation completion:** backend configured-provider filtering and the identified field-name correction remain undone.
- **Not a blocker to authorized abandoned closure:** no source WIP attributable to this change is present, and the user explicitly authorized this disposition.
