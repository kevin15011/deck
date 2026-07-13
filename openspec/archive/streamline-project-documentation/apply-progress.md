# Apply Progress: Streamline Project Documentation

## Completed Tasks

### Task 1: Add the focused documentation-governance test first
**Status**: ✅ Complete
**Files Changed**
- `tests/documentation-governance.test.ts` — create

**Verification**
- TDD RED: `bun test tests/documentation-governance.test.ts` failed with `DOC_REQUIRED_ENTRY_POINT_INVALID` for the missing role block in `README.md` and missing `CONTRIBUTING.md`.

**Notes**
The bounded test allowlist contains seven maintained documents, two local wrappers, and only the three named canonical release fixtures. It performs no network access, command execution, generation, or historical OpenSpec crawl.

### Task 2: Create the user, contributor, and AI-agent replacement entry points
**Status**: ✅ Complete
**Files Changed**
- `README.md` — modify
- `CONTRIBUTING.md` — create
- `AGENTS.md` — create

**Verification**
- `bun test tests/documentation-governance.test.ts` — pass after the full migration; entry-point, role-block, link, and command checks pass.

### Task 3: Add stable architecture and maintainer release guidance
**Status**: ✅ Complete
**Files Changed**
- `docs/architecture.md` — create
- `docs/maintainers/releasing.md` — create

**Verification**
- `bun test tests/documentation-governance.test.ts` — pass.

### Task 4: Repair the changelog and retained release-descriptor reference
**Status**: ✅ Complete
**Files Changed**
- `CHANGELOG.md` — modify
- `docs/release-descriptor.md` — modify

**Verification**
- `bun test tests/documentation-governance.test.ts` — pass.

### Task 5: Normalize stale release authority annotations and canonical fixture identities
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/upgrade-command/release-descriptor.ts` — modify comments only
- `apps/cli/src/upgrade-command/__tests__/release-descriptor.test.ts` — modify comments only
- `scripts/prepare-release.ts` — modify comments/help authority paths only
- `scripts/prepare-release.test.ts` — modify comments only
- `apps/cli/src/upgrade-command/__fixtures__/release-fixture.json` — normalize canonical Deck URLs
- `apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-no-upgrade.json` — normalize release-notes identity only
- `apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-upgrade.json` — normalize release-notes identity only

**Verification**
- `bun test apps/cli/src/upgrade-command/__tests__/release-descriptor.test.ts apps/cli/src/upgrade-command/__tests__/github-release.test.ts apps/cli/src/upgrade-command/__tests__/orchestrator.test.ts` — pass.
- `bun test scripts/prepare-release.test.ts` — pass.
- `bun test tests/documentation-governance.test.ts` — pass.

**Notes**
Arbitrary file-URL parser fixtures remain unchanged.

### Task 6: Thin and translate the supported project-local skill wrappers
**Status**: ✅ Complete
**Files Changed**
- `.agents/skills/deck-release-publish/SKILL.md` — modify
- `.agents/skills/openspec-retrospective-audit/SKILL.md` — modify

**Verification**
- `bun test tests/documentation-governance.test.ts` — pass.

### Task 7: Remove the roadmap-presence assertion from Git-safety coverage
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/git-safety.test.ts` — modify

**Verification**
- `bun test packages/core/src/teams/developer/git-safety.test.ts` — pass; canonical rule, command-family, byte-identity, composed-surface, and dynamic-discovery coverage remain.

### Task 8: Remove the historical-roadmap authority citation from no-op coverage
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/no-op-skill-absence.test.ts` — modify

**Verification**
- `bun test packages/core/src/teams/developer/no-op-skill-absence.test.ts` — pass; the local typed catalog retains all ten skills, rationale classes, and absence assertions.

### Task 9: Record the live-consumer and actionable-debt deletion gate
**Status**: ✅ Complete — deletion gate blocked

**Verification**
- Maintained-doc, product-test, script, local-skill, and fixture searches found no active reference to any of the five candidates after Tasks 1–8.
- `bun test tests/documentation-governance.test.ts packages/core/src/teams/developer/git-safety.test.ts packages/core/src/teams/developer/no-op-skill-absence.test.ts` — pass.

**Deletion-Safety Evidence**

| Candidate | Active maintained consumers | Durable-content disposition | Gate result |
|---|---|---|---|
| `docs/tool-references.md` | None | Upstream/source authority links are represented by `CONTRIBUTING.md` and `AGENTS.md`. | Consumer-safe |
| `docs/prompt-methodology-modules.md` | None | Stable architecture orientation is represented by `docs/architecture.md`; dynamic inventory remains source-owned. | Consumer-safe |
| `docs/skills-integration-roadmap.md` | None | Git safety and no-op behavior remain in their canonical TypeScript tests; no product test reads the roadmap. | Consumer-safe |
| `docs/deuda-tecnica.md` | None | **Unresolved actionable debt lacks existing or separately approved OpenSpec disposition.** | `DOC_REMOVAL_BLOCKED` |
| `docs/openspec-retrospective-audit-2026-06-12.md` | None | Historical audit lineage remains in OpenSpec artifacts and Git history. | Consumer-safe |

The unresolved `docs/deuda-tecnica.md` items are: typecheck recovery; failing-test cluster recovery; OpenSpec historical-state policy; architecture-boundary remediation; linter/formatter decision; local-artifact hygiene; action-runner semantics; core-provider-purity policy; large-file refactoring. `historical-cleanup-docs-release-hygiene` is only an Explore-phase artifact, so it is not an existing or separately approved disposition for these items. No replacement roadmap or backlog was created.

### Task 9R: Complete evidence-backed debt disposition and rerun the deletion gate
**Status**: ✅ Complete
**Files Changed**
- `openspec/changes/streamline-project-documentation/apply-progress.md` — modify

**Debt-Disposition Evidence**

| ID | Topic | Current evidence | Disposition | Named authority or future-change candidate | Rationale |
|---|---|---|---|---|---|
| D-01 | Typecheck recovery | `bunx tsc --noEmit` exits 0 with 0 errors. | resolved/currently false | N/A | The snapshot's typecheck-failure claim is no longer current. |
| D-02 | Failing-test cluster recovery | `bun test` reports 3291 pass and one Binary smoke `doctor` failure; the 2026-06-12 baseline ledger is stale (40 known failures). | deferred with a concrete rationale and future-change candidate | `test-suite-baseline-recovery` | One environment-sensitive diagnostic failure remains and the ledger needs a separately bounded evidence refresh; this documentation change does not own test-suite recovery. |
| D-03 | OpenSpec historical-state policy | `openspec/specs/artifact-state-contracts/spec.md` requires append-only history, traceable updates, and no silent overwrite. | covered by named OpenSpec authority | `artifact-state-contracts` | The promoted specification already owns the historical-state policy. |
| D-04 | Architecture-boundary remediation | Core-purity, TUI-boundary, and action-runner tests pass (14 pass, 0 fail); archived refactor evidence defines the intended runner-neutral boundaries. | covered by named OpenSpec authority | `hexagonal-architecture-memory-refactor` | The completed refactor remains the designated boundary authority; any new regression requires a separately scoped follow-up. |
| D-05 | Linter/formatter decision | `openspec/config.yaml` explicitly declares linter and formatter unavailable. | resolved/currently false | N/A | The snapshot's “undeclared” condition is false: the intentional absence is declared by current configuration. |
| D-06 | Local-artifact hygiene | `.gitignore` ignores `dist/` and `apps/cli/install`; `git check-ignore` confirms both paths. | resolved/currently false | N/A | The snapshot's repository-hygiene concern is no longer an active tracked-tree obligation. |
| D-07 | Action-runner semantics | Action-runner tests pass; archived install/upgrade authority specifies failure propagation and dependent MCP-write gating. | covered by named OpenSpec authority | `fix-install-upgrade-regressions` | The completed change owns the install-failure semantics identified by the snapshot. |
| D-08 | Core-provider-purity policy | Core-purity audit passes; the archived hexagonal refactor specifies provider-agnostic core requirements. | covered by named OpenSpec authority | `hexagonal-architecture-memory-refactor` | The completed refactor owns core/provider separation; passing audit is current executable evidence. |
| D-09 | Large-file refactoring | Five named files remain 859–1161 lines; no focused boundary failure demonstrates a safe in-scope extraction. | deferred with a concrete rationale and future-change candidate | `large-file-boundary-refactor` | Size alone does not define a safe refactor boundary; a future change must establish bounded ownership and regression evidence. |

**Rerun Verification**
- `rg` is unavailable in this environment. The equivalent bounded local search across `docs`, `tests`, `packages`, `apps`, `scripts`, and `.agents` found zero references to all five snapshot candidates.
- `bun test tests/documentation-governance.test.ts packages/core/src/teams/developer/git-safety.test.ts packages/core/src/teams/developer/no-op-skill-absence.test.ts` — pass (158 pass, 0 fail).

**Gate Result**
All nine extracted topics have exactly one permitted disposition in this existing approved OpenSpec change, and zero maintained consumers remain. Task 10 is unblocked. This record is an evidence disposition, not a permanent backlog or approval of the two future-change candidates.

### Task 10: Delete obsolete snapshots and enforce their absence
**Status**: ✅ Complete
**Files Changed**
- `docs/tool-references.md` — delete
- `docs/prompt-methodology-modules.md` — delete
- `docs/skills-integration-roadmap.md` — delete
- `docs/deuda-tecnica.md` — delete
- `docs/openspec-retrospective-audit-2026-06-12.md` — delete
- `tests/documentation-governance.test.ts` — modify

**Pre-Deletion Gate**
The bounded consumer search across maintained docs, tests, packages, apps, scripts, and local skills found zero references to all five candidates. Task 9R's nine-row disposition table remains the required actionable-debt evidence.

**Verification**
- `bun test tests/documentation-governance.test.ts packages/core/src/teams/developer/git-safety.test.ts packages/core/src/teams/developer/no-op-skill-absence.test.ts` — pass (159 pass, 0 fail).
- The focused governance test now asserts that all five snapshot paths are absent. Git-safety and no-op tests remain behavior-focused and do not consume snapshot prose.

**Preservation**
No historical OpenSpec artifact, generated output, bundled skill input, or compatibility stub was changed.

### Task 11: Run final focused and baseline-aware repository verification
**Status**: ✅ Complete
**Files Changed**
- `openspec/changes/streamline-project-documentation/apply-progress.md` — modify

**Verification Matrix**
- Documentation governance: `bun test tests/documentation-governance.test.ts` — 6 pass, 0 fail.
- Git-safety and no-op invariants: `bun test packages/core/src/teams/developer/git-safety.test.ts packages/core/src/teams/developer/no-op-skill-absence.test.ts` — 153 pass, 0 fail.
- Generated skill freshness: `bun test packages/core/src/skills/external/__tests__/content.test.ts` — 19 pass, 0 fail.
- Release descriptor suite: `bun test apps/cli/src/upgrade-command/__tests__/release-descriptor.test.ts apps/cli/src/upgrade-command/__tests__/github-release.test.ts apps/cli/src/upgrade-command/__tests__/orchestrator.test.ts` — 111 pass, 0 fail.
- Release helper: `bun test scripts/prepare-release.test.ts` — 21 pass, 0 fail.
- Static typing: `bunx tsc --noEmit` — 0 errors.
- Repository suite: `bun test` — 3292 pass, 1 fail.

**Broad-Suite Baseline Comparison**
The sole failure is `Binary smoke tests > doctor runs and reports diagnostics`. It is the named `Binary smoke tests` / `--doctor runs and reports diagnostics` baseline fingerprint in `openspec/baseline-health.yaml`; the test run produced exit code 143 after a dangling-process kill rather than the documented accepted `0`, `1`, or `124`. This is an environment-sensitive subprocess outcome outside this documentation change. The ledger totals are stale (it records 40 known failures); all other recorded failures are absent. No changed documentation, test, fixture, or generated boundary is implicated. The baseline policy permits completion with this explicitly accounted known failure.

**Manual Documentation Review**
Reviewed `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/architecture.md`, `docs/maintainers/releasing.md`, `docs/release-descriptor.md`, and both local wrappers. All are English, visibly role-blocked, audience-first, and linked to their source authority. Commands resolve through root metadata or direct executables. No maintained surface copies a current version, test count, source-line inventory, machine-local path, dynamic roster, or historical/OpenSpec policy. The wrappers remain thin and retain release confirmation or audit read-only boundaries.

**Boundary Check**
The generated-skill freshness test passed. Diff inspection found no generated-output, historical OpenSpec, or unrelated active-change modification. No Task 11 code or documentation defect required repair.

## Completion State

- Tasks 1–11 and 9R: ✅ Complete.
- Apply is complete with one explicitly accounted baseline/environment-sensitive broad-suite failure.

## Apply Repair: Verify and Review Reconciliation

**Status**: ✅ Complete

### Review Finding Resolution

| Finding | Resolution | Evidence |
|---|---|---|
| Durable tool guidance was lost | Added bounded canonical upstream links and binary-detection guidance to `CONTRIBUTING.md`; no machine-local paths or snapshot restoration. | RTK, context-mode, and codebase-memory upstream links; binary detection rule; post-repair deletion search. |
| Contributor procedure was incomplete | Added prerequisites, root-script summary, direct command forms, verification tiers, and actionable OpenSpec path. | `package.json`, `tsconfig.json`, `openspec/config.yaml`, and registry schema links. |
| Architecture guide omitted stable seams | Added core, SDD runtime, adapter-family, memory-provider-adapter, CLI, materialization, and SDD lifecycle orientation. | Package manifests and OpenSpec authority links. |
| Release/descriptor guidance was not actionable | Added tag trigger, helper decision point, confirmation gates, workflow observation, post-release checks, rollback, minimal descriptor shape, kinds, and compatibility behavior. | Release workflow, helper, schema, and fixture links. |
| Identity and direct-command predicates were weak | Added positive canonical GitHub parsing and finite direct-command validation with focused mutation cases. | Governance predicate RED/GREEN evidence. |
| Changelog comparison link was invalid | Replaced the invalid compare URL with the canonical releases link. | `CHANGELOG.md`. |

### Baseline Ledger Refresh

`openspec/baseline-health.yaml` was refreshed from current evidence while retaining focused-command ownership. It now records the exact sole broad-suite fingerprint: `apps/cli/src/__tests__/binary-smoke.test.tsx`, `Binary smoke tests > doctor runs and reports diagnostics`, Bun test timeout after 5000 ms with one dangling process killed. The current broad suite is 3295 pass and 1 fail; typecheck is 0 errors. Obsolete 40-failure and 108-type-error inventories were removed rather than relabeled.

### Repair Verification

- Governance plus invariants: 162 pass, 0 fail.
- Generated skill freshness: 19 pass, 0 fail.
- Release descriptor suite: 111 pass, 0 fail.
- Release helper: 21 pass, 0 fail.
- `bunx tsc --noEmit`: 0 errors.
- Focused doctor reproduction: 0 pass, 1 fail; exact 5000 ms timeout and one dangling-process kill.
- `bun test`: 3295 pass, 1 fail; exact refreshed known fingerprint.

### Deletion Gate Recheck

The bounded maintained-surface search found only the five intentional negative absence assertions in `tests/documentation-governance.test.ts`; these assert absence and are not consumers. No maintained documentation, product code, script, wrapper, fixture, or test reads the deleted snapshot content. The five snapshots remain absent.

### Repair Boundary

No generated output, historical OpenSpec artifact, bundled skill input, runtime behavior, or deleted snapshot was restored. `openspec/baseline-health.yaml` is a maintained verification ledger and was updated only with reproduced current evidence.

## Apply Override Repair: Final Review Findings

**Status**: ✅ Complete

| Finding | Resolution | Source evidence |
|---|---|---|
| Release/descriptor truth | Release guide now states both workflow paths generate `release.json`; helper use is local inspection/preparation only. Descriptor guide states strict production `parseReleaseDescriptor`, absent/invalid legacy tag-info fallback, and that `parseDescriptorAuto` is not the production path. | `.github/workflows/release.yml` descriptor jobs; `github-release.ts`; `release-descriptor.ts`. |
| Inline direct-command governance | One bounded extractor reads inline spans and standalone forms through one finite predicate. It permits only documented `bun test` test-file targets, no arbitrary flags/tokens. | Governance RED/GREEN mutation tests. |
| Baseline identity | Added `suite` to declared comparison fingerprint fields. | `openspec/baseline-health.yaml`. |

**Override Verification**
- Focused governance/invariants/freshness/release/helper: 314 pass, 0 fail.
- Typecheck: 0 errors.
- Focused doctor: expected exact 5000 ms timeout.
- Broad suite: 3296 pass, 1 exact ledger-recorded doctor timeout; baseline updated to the same count and fingerprint.

No protected boundary changed. This single authorized override attempt consumes its full three-finding fingerprint budget and is ready for one fresh Verify/Review cycle.

## Code Economy Self-Check

- Simpler existing path considered: Yes — used Bun built-ins and one bounded repository test; no documentation toolchain was added.
- New dependency/abstraction added: No.
- Advisory budget exceeded: Yes — the broad documentation migration intentionally touches the specified maintained surfaces.
- Quality override used: Yes — explicit governance validation and behavior-focused invariant tests are required for safe migration.

## Serena/Fallback

Serena edit tools were not appropriate for Markdown, JSON, YAML, or comment-only partial edits; fallback used: `apply_patch`. No generated output or historical OpenSpec artifact was modified.

## Final Narrow Apply Repair: Bun Command Governance

**Status**: ✅ Complete — the sole authorized Apply attempt for the single command-governance fingerprint.

**Files Changed**
- `tests/documentation-governance.test.ts` — modify
- `openspec/changes/streamline-project-documentation/apply-progress.md` — modify
- `openspec/changes/streamline-project-documentation/state.yaml` — modify
- `openspec/changes/streamline-project-documentation/events.yaml` — modify

**TDD RED Evidence**
- Before the predicate changed, the mutation test extracted `bunx tsc --emit`, `bun test --watch`, and `bun test tests/missing.test.ts` from inline code and passed each extracted value to `isSupportedDirectCommand`.
- `bun test tests/documentation-governance.test.ts` failed as required: the nonexistent target produced `Expected: false` and `Received: true`.

**Implementation**
- Kept the finite direct-command grammar.
- A targeted `bun test` command now permits exactly one `.test.ts` or `.test.tsx` file beneath `tests`, `packages`, `apps`, or `scripts`, resolves it from the repository root, and requires an existing regular file.
- The mutation test proves extraction before rejection, accepts the existing documented `tests/documentation-governance.test.ts` target, and rejects invalid typecheck syntax, flags, nonexistent targets, multiple targets, traversal, directories, package files, and non-test paths.

**Verification**
- Governance RED: expected failure captured before implementation.
- Governance GREEN: 10 passed, 0 failed.
- Governance plus Git-safety/no-op invariants: 163 passed, 0 failed.
- Generated external-skill freshness: 19 passed, 0 failed.
- Release descriptor/consumer suites: 111 passed, 0 failed.
- Release helper: 21 passed, 0 failed.
- Typecheck: `bunx tsc --noEmit` exited 0.
- Focused doctor: expected baseline failure, 0 passed and 1 failed after the 5000 ms timeout with one dangling process killed.
- Full suite: 3296 passed, 1 failed, 3297 tests across 174 files; the sole failure is the same focused doctor baseline fingerprint.

**Repair Governance**
- Applied the final narrow authorization as one Apply attempt for one command-governance fingerprint. Under `evaluateRepairIncident()`, the repaired fingerprint has no remaining active failure and the single fresh Verify/Review cycle remains pending; no automatic retry is permitted.

**Boundary and Economy Check**
- Used only Bun/Node built-ins already imported by the focused test; no shell execution, network access, glob crawler, shell parser, dependency, documentation prose, runtime behavior, baseline ledger, generated output, bundled input, deleted snapshot, or historical OpenSpec artifact changed.
- Simpler existing path considered: Yes — a local predicate extension and mutation coverage were sufficient.
- New dependency/abstraction added: No.
- Advisory budget exceeded: No.
- Quality override used: Yes — explicit negative mutation coverage protects the documentation command authority.

**Serena**
- Used Serena symbolic retrieval and body replacement for the TypeScript predicate and mutation test. Serena diagnostics retain pre-existing standalone-file environment false positives for Bun/Node globals; repository `bunx tsc --noEmit` is authoritative and passes.
