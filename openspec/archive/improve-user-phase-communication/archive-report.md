# Archive Report: improve-user-phase-communication

## Change Identity

- **Change ID**: `improve-user-phase-communication`
- **Name**: Improve User Phase Communication
- **Archive date**: 2026-07-22
- **Role / instance**: `deck-developer-archive` (centralized mode), `minimax-coding-plan/MiniMax-M2.5-highspeed`
- **Destination**: `openspec/archive/improve-user-phase-communication/`
- **Source**: `openspec/changes/improve-user-phase-communication/` (pending coordinator cleanup)

---

## Delivery Summary

The change delivered the approved Proposal in full. All 8 capabilities, 38 requirements, and 32 Given/When/Then scenarios from `spec.md` were implemented across 15 target files (11 canonical prompt-content sources, 4 tests including the new contract test) and verified through targeted, affected-area, and broad test stages with no blocking findings.

The implementation extended existing Developer Team prompt content in `packages/core/src/teams/developer/` with the following contracts:

| Capability | Primary targets | Mode |
|---|---|---|
| `orchestrator-intake-and-confirmation` | `orchestrator-invariants.ts`, `orchestrator-content.ts` | 40 byte-verbatim + 27 semantic-constrained EIIs |
| `orchestrator-phase-communication` | `orchestrator-content.ts` | Phase matrix; Apply low-noise |
| `proposal-collaborative-agreement` | `proposal-content.ts` | Collaborative draft; explicit human approval gate |
| `design-exact-implementation-instructions` | `design-content.ts` | EII section with BV/SC mode per target |
| `task-and-apply-fidelity` | `task-content.ts`, all Apply content | EII chain; stop-on-ambiguity |
| `verify-review-failure-explanation` | `verify-content.ts`, `review-content.ts` | Plain-language failure; no auto-retry |
| `personality-styling` | `orchestrator-content.ts` | Base-first overlay; content-preserving |
| `cross-phase-compatibility-and-budget` | All 11 sources, 4 tests | Compact budget; adapter pass-through |

---

## Phase-by-Phase Delivery

| Phase | Status | Key evidence |
|---|---|---|
| Explore | completed | `exploration.md`; 4 defaults confirmed by user before Proposal |
| Proposal | approved | `proposal.md`; explicit human approval "Procede" recorded in registry |
| Spec | completed | `spec.md`; 8 capabilities, 38 requirements, 32 scenarios, 10 validation rules, 8 error contracts |
| Design | completed | `design.md`; EII section, 67 EIIs, BV/SC safe-mode split (40/27), 12 byte-verbatim blocks verified by source import audit |
| Tasks | approved | `tasks.md`; 15 tasks, 3 execution groups; `preconditions.md` PC-1 satisfied by non-destructive handoff from `developer-team-execution-convergence` |
| Apply | passed_with_warnings | `apply-progress.md`; 15 targets implemented; deterministic replay proved RED→GREEN with 15/15 hash equivalence |
| Verify | passed_with_warnings | `verify-report.md`; targeted 12/12 checks pass; affected-area all pass; broad all pass; all 38 requirements mapped to evidence |
| Review | passed_with_warnings | `review-report.md`; APPROVE WITH WARNINGS; 1 Low finding; 0 blocking; 5-axis engineering review passed |

---

## Verification Evidence

### Test results

| Stage | Command | Result |
|---|---|---|
| Targeted (UPC contract) | `bun test packages/core/src/teams/developer/user-phase-communication.test.ts` | PASS: 12 pass, 0 fail |
| Targeted (orchestrator invariants) | `bun test packages/core/src/teams/developer/orchestrator-invariants.test.ts` | PASS: 70 pass, 0 fail |
| Targeted (orchestrator content) | `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` | PASS: 124 pass, 0 fail |
| Targeted (prompt profile) | `bun test packages/core/src/teams/developer/prompt-profile.test.ts` | PASS: 8 pass, 0 fail |
| Affected-area (all role content) | `bun test` across 9 adjacent role test files | PASS: 425 pass, 0 fail |
| Affected-area (registry/manifest) | `bun test content-registry.test.ts manifest.test.ts` | PASS: 117 pass, 0 fail |
| Affected-area (OpenCode adapter) | `bun test adapter-opencode/**` | PASS: 117 pass, 0 fail |
| Affected-area (Pi adapter) | `bun test adapter-pi/**` | PASS: 94 pass, 0 fail |
| **Broad (repository)** | `bun test --timeout 30000` | **PASS: 3,845 pass, 0 fail** |

### TypeScript

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `bunx tsc --noEmit` | PASS: exit 0, no diagnostics |

### Compact profile budget

| Metric | Value |
|---|---:|
| Legacy bytes | 384,067 |
| Compact bytes | 175,666 |
| Byte ratio | 0.4574 (ceiling: 0.70) |
| Legacy lexical tokens | 82,620 |
| Compact lexical tokens | 34,565 |
| Token ratio | 0.4184 (ceiling: 0.70) |
| Compact is default | true |

### Scope audit

No generated output, adapter implementation, runtime authorization contract, Spec Registry schema, CLI/TUI, `developer-team-execution-convergence` artifacts/history, or `runner-capability-standardization` scope was modified. Changed-path set: 14 tracked source/test files + 12 untracked OpenSpec artifacts. Freshness anchors match from Review through broad Verify: Git HEAD `664cbaa7`, 15-target bundle SHA-256 `e200c9736698c2bf17782eec3ac0509bab45b8a6be625ca31873eaca37544855`.

---

## Residual Warnings

Both warnings are preserved from the Review's `passed_with_warnings` disposition and were not resolved, relabeled, or dismissed by this archive step.

### Warning 1 — Apply process: original contemporaneous RED not captured

- **Label**: `missing-red-evidence`
- **Origin**: Original Apply phase did not record the RED (failing tests before source edits) at the time of implementation.
- **Resolution**: A bounded deterministic replay against an isolated git archive of baseline `664cbaa7` reproduced expected RED (1 pass / 11 fail for UPC assertions), then GREEN (214 pass / 0 fail) after byte-equivalent patch overlay. Hash equivalence: 15/15 targets byte-identical to current workspace.
- **Preserved because**: The replay is labeled as such and is not claimed as original chronology. Deterministic replay proves RED/GREEN equivalence and byte-equivalence but does not rewrite the original chronology. Both Verify and Review independently confirmed this warning is non-blocking and not a code defect.
- **Impact on this archive**: None. The implementation correctness is proven independently. The warning is a process-observability gap, not a functional gap.

### Warning 2 — Review finding: `UPC-SCOPE-01` weak/no-op filesystem scaffolding

- **Label**: `REV-LOW-001`
- **Severity**: Low
- **Disposition**: Non-blocking
- **Location**: `packages/core/src/teams/developer/user-phase-communication.test.ts`, symbol `UPC-SCOPE-01`
- **Evidence**: The test imports `createHash`, `readdirSync`, and `relative` but silences them with `void`. The `forbidden` list is also only silenced. The test checks that allowlist entries are strings and expected files exist, but it does not compare actual changed paths, so a forbidden changed path would not make this unit test fail.
- **Impact**: The test gives future readers false confidence about repository-scope enforcement. Current acceptance impact is zero: Verify's independent `affected.scope-generated-safety` check and the Review's fresh status audit both found zero forbidden paths.
- **Recommended future action**: In a focused test cleanup, remove the no-op imports/variables and either assert the exact local import/allowlist manifest, or move the claim to an explicit repository changed-path check. Do not add Git subprocess coupling merely to satisfy the test name.
- **Preserved because**: Independent scope audits passed; fixing is a future optional cleanup outside this change's scope.

---

## Rollback

The Proposal defines the rollback approach:

1. Revert the canonical prompt/instruction changes (11 source files in `packages/core/src/teams/developer/`) and their focused regression assertions (`user-phase-communication.test.ts`, `orchestrator-content.test.ts`, `orchestrator-invariants.test.ts`, `prompt-profile.test.ts`) as one coherent change.
2. Rematerialize derivative outputs through existing canonical generators.
3. No data or schema migration requires reversal.
4. Preserve all OpenSpec artifacts, approval/rollback evidence, and registry history. Do not rewrite prior registry history or drop recorded human approvals/rejections.
5. Rollback must not touch `runner-capability-standardization` and must not use destructive Git operations without the protected confirmation flow.

Rollback evidence: `REQ-COMPAT-006`; no destructive Git command was run during Apply, Verify, or Review. The `git-safety.ts` protected discard confirmation flow remains in force.

---

## Handoff History

| Phase | Agent | Timestamp | Key note |
|---|---|---|---|
| Explore | deck-developer-explorer | 2026-07-22T14:29:32Z | Exploration reconciled; user approved 4 defaults |
| Proposal | deck-developer-proposal | 2026-07-22T14:38:43Z | Draft created; human approval pending |
| Proposal | human-user | 2026-07-22T15:07:09Z | Explicit "Procede" approval recorded |
| Spec | deck-developer-spec | 2026-07-22T00:00:00Z | 8 capabilities, 38 requirements, 32 scenarios |
| Design | deck-developer-design | 2026-07-22T15:42:26Z | EII section; 67 EIIs; safe-mode split |
| Design | human-user | 2026-07-22T15:49:12Z | Confirmed technical direction |
| Tasks | deck-developer-task | 2026-07-22T16:09:34Z | 15 tasks, 3 groups |
| Tasks | human-user | 2026-07-22T16:21:35Z | Approved task plan; authorized handoff |
| Tasks | deck-developer-task | 2026-07-22T16:23:17Z | PC-1 satisfied; non-destructive handoff |
| Apply | deck-developer-apply-general | 2026-07-22T16:46:02Z | `passed_with_warnings`; deterministic replay RED/GREEN |
| Verify | deck-developer-verify | 2026-07-22T16:56:09Z | Targeted/affected-area passed; broad deferred |
| Review | deck-developer-review | 2026-07-22T17:12:49Z | APPROVE WITH WARNINGS; 1 Low |
| Verify (broad) | deck-developer-verify | 2026-07-22T17:25:35Z | Broad passed; 3,845 tests; 0 fail |

---

## Reusable Learnings

These observations are advisory for future changes and do not modify any specification, requirement, or approved design.

### Design → Task → Apply EII chain

The conditional `## Exact Implementation Instructions` section in Design, with explicit `byte-verbatim` vs `semantic-constrained` mode per target, proved effective at preventing downstream redesign. The chain was clear and enforceable: Design defines, Tasks preserve, Apply executes without reinterpretation, and ambiguity stops with a stable reason code. Future prompt-governed changes should adopt this pattern.

### Deterministic replay for process-observability gaps

When an original Apply lacks contemporaneous RED evidence, bounded deterministic replay against an isolated git archive provides an acceptable alternative for proving RED→GREEN equivalence — provided the replay is labeled as such and is not claimed as original chronology. This approach closes an evidence gap without rewriting history. It is not a substitute for good process discipline, but it is a valid safety net.

### Incremental intake confirmation

Extending the existing intake model with bounded read-only discovery, a restatement confirmation gate, and a separate modification authorization gate is a lower-risk pattern than introducing a competing gate. The trivial direct edit exemption kept routine work unblocked. The three-iteration revision bound before escalation prevented auto-confirmation without creating friction for genuine collaboration.

### Conditional scope tests require independent verification

A scope test (`UPC-SCOPE-01`) with allowlist/denylist scaffolding that does not compare actual changed paths can give false confidence. Pairing unit-level scope assertions with independent Verify/Review changed-path audits is the correct pattern: the unit test documents intent, the independent audit proves reality. Neither should be removed, but neither is sufficient alone.

### Personality as presentation overlay

Composing invariant content first and applying personality styling as a subsequent presentation overlay — never as a content filter — kept the substantive communication contract stable across `guia` and `pragmatica` variants. Both personality overlays and all supported profiles shared the same behavioral invariants; only the presentation form differed.

### Non-destructive handoff from overlapping changes

When two changes share overlapping target ownership, a non-destructive rebase/handoff to a known-good baseline — with explicit human authorization and preserved history for the donor change — is a viable sequencing pattern. No destructive Git operation was required; all prior artifacts and history were preserved.

---

## Artifact Digest

This archive report is committed at the phase when all verification gates are complete. No source or test file changed after the Review freshness anchors (Git HEAD `664cbaa7`, bundle SHA-256 `e200c9736698c2bf17782eec3ac0509bab45b8a6be625ca31873eaca37544855`).

The canonical `RegistryIntentV1` for this archive transition is built, parsed, and dry-applied using `buildRegistryIntentV1` / `parseRegistryIntentV1` from `@deck/sdd-runtime`. The intent carries the digest of this file and the post-Review registry base digests. No self-referential artifact digest is embedded in this file.

---

*This archive report was produced by `deck-developer-archive` in centralized registry mode. The coordinator owns the registry write and the directory cleanup. Do not move or delete the source directory until the coordinator confirms the registry commit.*
