# V1 Verify Report — `opencode-package-install-running-binary-regression`

## Verdict

**Status:** FAIL — blocking scope/prohibition audit failure.

All executed behavioral, type, build, OpenSpec, and disposable sandbox checks passed. However, the mandatory changed-path gate did **not** pass because the current worktree contains changed source/documentation paths outside the exact 15-file implementation allowlist. Because V1 is required to prove an exact implementation allowlist, R1 **MUST NOT** proceed until the coordinator provides a clean scoped worktree or an authorized reconciliation that separates unrelated baseline changes from this OpenSpec change.

## Provenance

| Field | Value |
|---|---|
| Role | `deck-developer-verify` |
| Invocation | V1 independent Verify |
| Change | `opencode-package-install-running-binary-regression` |
| Working directory | `/home/kevinlb/deck` |
| Date | 2026-07-24 |
| Authorized write target | `openspec/changes/opencode-package-install-running-binary-regression/verify-report.md` only |
| Adaptive context | Loaded as advisory only; OpenSpec artifacts and source/test evidence remained authoritative. |

## Official dependency digests

All supplied immutable bases matched before and after verification.

| Artifact | Expected / observed SHA-256 |
|---|---|
| `spec.md` | `007dacb13bacc4e891454dd11a7d9a2de4db229cf36656374202df4283c7846a` |
| `design.md` | `b52aa1174d4408f1132738a00cc630399ed0419ef8ce3192defb6ed83ae28465` |
| `tasks.md` | `088b4223cd83891d0980144732cdd2dc5ba550cd29b0480a4d35c535bcc2f7a2` |
| `apply-progress.md` | `19be2c95ef1d52fbd44b9f2b9677a6bccf7371d4d35eadd06afcc7b6d3c3c799` |
| `state.yaml` | `f8383a682eb01c83c4b60ea3c6814d9035da65c919cb2fc31c6d03ecb10f118d` |
| `events.yaml` | `616e2f11f07c84c145d985ea636162734f3bd5dbbd82266e2a5028061f58dbf5` |

## Freshness digests

| Scope | Before | After | Result |
|---|---:|---:|---|
| 15 implementation source/test files | `a5191c58ede609c1e518d9830b5f83c7e1f0bf590d4e77c5f3bf5c7551f71a82` | `a5191c58ede609c1e518d9830b5f83c7e1f0bf590d4e77c5f3bf5c7551f71a82` | Stable |

## Task and RED evidence validation

| Task | Obligation anchors | RED evidence in `apply-progress.md` | Fresh V1 result |
|---|---|---|---|
| T1 | Tasks lines 38-53: shared OpenCode local config source/JSONC parser, no duplicate scanner/parser, no live-home fixture. | Lines 3-9: exit 1, `0 pass`, `1 fail`, missing `enumerateOpenCodeConfigCandidates`, test-only scope. | Covered by focused command and model-discovery per-file pass `10/10`. |
| T2 | Tasks lines 55-70: strict usable/declared/broken/absent/indeterminate evidence, exact package mapping, config precedence, no declaration promotion. | Lines 19-25: exit 1, `0 pass`, `3 fail`, `1 error`, missing `resolveOpenCodeInstalledEvidence` plus inventory false/true failures. | Covered by focused command, required-tools `8/8`, capability-inventory `2/2`. |
| T3 | Tasks lines 72-88: idempotent outcomes, rechecks, single-flight, cancellation, raw boundary, sanitizer bounds, no process ops/retry/network tests. | Lines 36-50: initial exit 1 with `8 pass`, `6 fail`; supplemental exit 1 with `18 pass`, `1 fail`; no production edit before RED scopes. | Covered by focused command, install-tools `19/19`, custom raw/bounds audit, and sandbox no-installer proof. |
| T4 | Tasks lines 90-105: Core status compatibility, truthful direct adapter outcomes, project scope, raw streams dropped. | Lines 61-67: exit 1, `8 pass`, `3 fail`, project-scope and already-present/failure mapping failures. | Covered by focused command, runner-adapter `11/11`, status union audit, custom adapter audit. |
| T5 | Tasks lines 107-122: exact tool ID projection, satisfied already-present skip, ordinary skipped unsatisfied, exact matching dependents, bounded diagnostics. | Lines 95-101: exit 1, `7 pass`, `4 fail`, missing/unknown/duplicate ID and raw-boundary failures. | Covered by focused command, contract `11/11`, affected action-runner, and custom adapter/raw audit. |
| T6 | Tasks lines 124-139: existing views only, identified inline causes, final-five behavior, text/symbol accessibility, bounded one-cause rendering. | Lines 111-117: exit 1, `16 pass`, `4 fail`, missing action IDs/inline causes and hostile-cause fixture. | Covered by focused command, e2e `20/20`, affected render suite. |

RED evidence is genuine for T1-T6 because each RED records a failing exit, failure anchors, and scope before corresponding production implementation. No stale RED evidence was used for V1 pass claims.

## Scheduled command evidence

### Focused command — Design lines 424-432

Command:

```text
bun test packages/adapter-opencode/src/model-discovery-context.test.ts packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts packages/adapter-opencode/src/install-tools.test.ts packages/adapter-opencode/src/runner-adapter.test.ts apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx
```

Result: exit `0`; `81 pass`, `0 fail`, `286 expect() calls`; `Ran 81 tests across 7 files`.

Per-file counts from the same focused file set:

| File | Pass | Fail | Expect calls |
|---|---:|---:|---:|
| `packages/adapter-opencode/src/model-discovery-context.test.ts` | 10 | 0 | 31 |
| `packages/adapter-opencode/src/required-tools.test.ts` | 8 | 0 | 19 |
| `packages/adapter-opencode/src/capability-inventory.test.ts` | 2 | 0 | 6 |
| `packages/adapter-opencode/src/install-tools.test.ts` | 19 | 0 | 66 |
| `packages/adapter-opencode/src/runner-adapter.test.ts` | 11 | 0 | 57 |
| `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts` | 11 | 0 | 35 |
| `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` | 20 | 0 | 72 |
| **Total** | **81** | **0** | **286** |

### Affected command — Design lines 450-455

Command:

```text
bun test packages/adapter-opencode/src/context-mode-integration.test.ts packages/adapter-opencode/src/runner-capabilities.test.ts apps/cli/src/tui/runner-dashboard/action-runner.test.ts apps/cli/src/tui/runner-dashboard/render.test.tsx
```

Result: exit `0`; `49 pass`, `0 fail`, `177 expect() calls`; `Ran 49 tests across 4 files`.

### Additional V1 commands

| Command | Exit | Evidence |
|---|---:|---|
| `bunx tsc --noEmit` | 0 | Zero TypeScript diagnostics. |
| `bun run build:dry-run` | 0 | Completed dry-run build; reported `deck_v0.2.4_linux-x64.tar.gz` checksum `97f2bf821df86be6dfbe4c56143ed7f1b0b48a62dcc3fc3642d14c29a78dcbd7`. |
| `git diff --check` | 0 | No whitespace errors. |
| `bun run deck openspec validate --json --change opencode-package-install-running-binary-regression --root /home/kevinlb/deck` | 0 | `ok: true`; no issues reported for the rooted change validation. |

## Disposable Linux sandbox evidence

Protocol anchors: Tasks V1 lines 141-151 and Design lines 466-470.

| Proof | Evidence |
|---|---|
| Fresh sandbox root | `/tmp/deck-cbm-eBGsEB` |
| Source executable copied only into sandbox | `/home/kevinlb/.local/bin/codebase-memory-mcp` SHA-256 `8d019ca9372e5e0d60650648f3740673db7f84d1e38fd14fa4b0e823ee7220dc` copied to sandbox binary with the same digest. |
| Harness-owned child | PID `258698`; `alreadyRunningBeforeAction: true`; cleanup check later confirmed PID not alive. Cleanup targeted only that exact PID. |
| Runner Setup action | Direct OpenCode Runner action `capability.codebase-memory.install` in sandbox project/root/env. |
| Already-present outcome | `status: skipped`; message `Install codebase-memory already present; installer not run.`; raw `{ id: "codebase-memory", outcome: "already-present" }`. |
| Installer sentinel calls | `0` |
| Sandbox binary unchanged | Before/after SHA-256 both `8d019ca9372e5e0d60650648f3740673db7f84d1e38fd14fa4b0e823ee7220dc`. |
| No implicit upgrade / no target write | Proved by zero sentinel calls plus unchanged sandbox binary checksum. |
| Real user roots untouched | Metadata digest before/after for `/home/kevinlb/.config/opencode`, `/home/kevinlb/.local/share/opencode`, `/home/kevinlb/.cache/opencode`, and `/home/kevinlb/.local/bin/codebase-memory-mcp`: `416027fffc419678b11cec5eb681b0852c987cc20e1866f87a5139154b4aea85`, entries `616`, bytes `270310408`; unchanged. |

No network fetch, live installation, live process enumeration, live process mutation, or user-root mutation was used. The only process cleanup targeted the exact harness PID retained by V1.

## Requirement and scenario mapping

Spec parsing found the authoritative **34 requirements / 51 scenarios**. Every requirement/scenario is mapped to fresh V1 checks below.

| Requirement | Scenario count | Scenario IDs | Fresh check coverage |
|---|---:|---|---|
| REQ-EVD-01 | 2 | EVD-01-S1, EVD-01-S2 | Focused required-tools/capability-inventory/model-discovery tests; sandbox PATH already-present proof. |
| REQ-EVD-02 | 3 | EVD-02-S1, EVD-02-S2, EVD-02-S3 | Focused required-tools tests for non-executable, directory, unrelated, exact executable evidence. |
| REQ-EVD-03 | 2 | EVD-03-S1, EVD-03-S2 | Focused required-tools and capability-inventory tests for declaration-only vs usable evidence. |
| REQ-EVD-04 | 2 | EVD-04-S1, EVD-04-S2 | Focused model-discovery/required-tools tests for JSONC config precedence and config parsing. |
| REQ-RCK-01 | 1 | RCK-01-S1 | Focused install-tools tests and sandbox no-sentinel proof. |
| REQ-RCK-02 | 1 | RCK-02-S1 | Focused install-tools tests for effect-time second recheck. |
| REQ-APO-01 | 2 | APO-01-S1, APO-01-S2 | Focused install-tools outcome tests and custom failed-outcome audit. |
| REQ-APO-02 | 2 | APO-02-S1, APO-02-S2 | Focused runner-adapter and TUI contract tests; Core status union audit. |
| REQ-FAL-01 | 2 | FAL-01-S1, FAL-01-S2 | Focused install-tools/runner-adapter/TUI contract tests; custom no-hidden-success audit. |
| REQ-FAL-02 | 1 | FAL-02-S1 | Focused install-tools genuine failure/nonzero preservation tests; custom failed-outcome audit. |
| REQ-FAL-03 | 1 | FAL-03-S1 | Focused runner-adapter/TUI tests and affected action-runner tests for matching dependent gating. |
| REQ-DIA-01 | 2 | DIA-01-S1, DIA-01-S2 | Focused TUI contract/e2e and custom sanitizer audit for bounded safe diagnostics. |
| REQ-DIA-02 | 2 | DIA-02-S1, DIA-02-S2 | Focused e2e render tests and custom redaction audit. |
| REQ-DIA-03 | 1 | DIA-03-S1 | Focused contract/e2e tests for raw capture drop before callbacks/state. |
| REQ-MIS-01 | 1 | MIS-01-S1 | Focused required-tools tests for absent config and missing executable. |
| REQ-MIS-02 | 1 | MIS-02-S1 | Focused required-tools tests for malformed/broken config not becoming readiness. |
| REQ-PCV-01 | 1 | PCV-01-S1 | Focused required-tools/capability-inventory tests for plugin/config-only compatibility. |
| REQ-PCV-02 | 1 | PCV-02-S1 | Focused required-tools tests for pure mode executable-only evidence. |
| REQ-PAG-01 | 2 | PAG-01-S1, PAG-01-S2 | Focused install-tools tests for per-package isolation and exact tool IDs. |
| REQ-PAG-02 | 1 | PAG-02-S1 | Focused e2e tests for progress/final-five rendering. |
| REQ-SAF-01 | 1 | SAF-01-S1 | Focused install-tools tests and static prohibition audit for no process command/API. |
| REQ-SAF-02 | 1 | SAF-02-S1 | Focused install-tools tests and sandbox checksum proof for no binary overwrite/staging. |
| REQ-SAF-03 | 1 | SAF-03-S1 | Focused install-tools tests/static audit for no retry loops. |
| REQ-SAF-04 | 1 | SAF-04-S1 | Focused adapter/TUI tests for no unsafe raw result exposure. |
| REQ-SAF-05 | 1 | SAF-05-S1 | Focused sanitizer/render tests and custom redaction audit. |
| REQ-CTO-01 | 1 | CTO-01-S1 | Focused install-tools tests for same-scope single-flight. |
| REQ-CTO-02 | 1 | CTO-02-S1 | Focused install-tools tests for TOCTOU second recheck. |
| REQ-CAN-01 | 1 | CAN-01-S1 | Focused install-tools cancellation tests. |
| REQ-MPI-01 | 1 | MPI-01-S1 | Focused install-tools and TUI contract tests for multiple package isolation. |
| REQ-TST-01 | 2 | TST-01-S1, TST-01-S2 | Focused command, affected command, custom audit, source/test digest stability. |
| REQ-TST-02 | 1 | TST-02-S1 | Focused model-discovery/required-tools injected fixtures; no live-home fixtures required. |
| REQ-TST-03 | 2 | TST-03-S1, TST-03-S2 | RED evidence validation plus fresh GREEN commands. |
| REQ-TST-04 | 1 | TST-04-S1 | Disposable Linux sandbox proof. |
| REQ-ROL-01 | 1 | ROL-01-S1 | No source rollback needed; V1 evidence-only write plus blocker intent. |

## Independent compatibility and safety audit

| Audit item | Evidence | Result |
|---|---|---|
| Public Core action-status compatibility | `RunnerActionRunResult.status` remains exactly `"executed" | "informational" | "skipped" | "failed"`; no `already-present` public status member. | PASS |
| Already-present satisfied skip | Adapter custom audit returned `status: skipped`, message includes `already present; installer not run`, raw outcome `already-present`, sentinel `0`. | PASS |
| Ordinary skipped unsatisfied / no hidden success | Focused TUI contract tests passed and custom failed outcome remained `outcome: failed`, `success: false`, `installerInvoked: true`. | PASS |
| Exact-ID integrity | Focused TUI contract tests cover missing, unknown, duplicate, and inconsistent IDs; all passed. | PASS |
| Failure isolation | Focused install-tools and TUI contract tests cover per-package isolation and matching dependent gating; all passed. | PASS |
| Config precedence | Focused model-discovery and required-tools tests cover layer order, JSONC, pure mode, PATH/canonical evidence, and broken-config retention; all passed. | PASS |
| Raw-data non-enumerability/drop | Custom audit: raw present internally but `rawEnumerable: false`, diagnostic `original` non-enumerable, JSON output contains no secret/path. Adapter result diagnostics empty for already-present. | PASS |
| Secret/path/control redaction | Custom audit with hostile stdout/stderr: `jsonHasSecret: false`; e2e render hostile-cause tests passed. | PASS |
| Exact bounds | Custom audit: diagnostic lines `2`, cause bytes `63`, max line bytes `35`; raw stdout captured `70039` bytes with `stdoutTruncated: true`; focused bounds tests passed. | PASS |
| Cancellation/single-flight/TOCTOU | Focused install-tools tests passed; resolver called twice in custom failure path, confirming preflight plus second recheck. | PASS |
| No hidden success | Nonzero installer audit remained failed; no failure redeemed by post-hoc evidence. | PASS |

## Changed-path and static prohibition audit

### Implementation allowlist result

Mandatory allowlist from Tasks lines 14-30 contains exactly 15 implementation source/test paths. V1 observed the 15 allowlist files present in the working tree, but the full worktree was not limited to those paths.

| Category | Count | Result |
|---|---:|---|
| Allowed implementation paths observed in changed/untracked state | 15 | Expected for Apply output. |
| Staged changes | 0 | PASS |
| Tracked changed paths outside exact implementation allowlist | 22 | **FAIL** |
| Untracked paths outside exact implementation allowlist / V1 report target | 35 | **FAIL** |

Tracked changed paths outside the implementation allowlist:

- `apps/cli/src/cli-args.test.ts`
- `apps/cli/src/cli-args.ts`
- `apps/cli/src/main.tsx`
- `docs/architecture.md`
- `packages/adapter-opencode/src/prompt-generation.test.ts`
- `packages/adapter-opencode/src/prompt-generation.ts`
- `packages/adapter-pi/src/orchestrator-prompt.test.ts`
- `packages/adapter-pi/src/pi-team-profile.test.ts`
- `packages/adapter-pi/src/pi-team-profile.ts`
- `packages/adapter-pi/src/registry-consumption.test.ts`
- `packages/adapter-pi/src/runner-adapter.test.ts`
- `packages/adapter-pi/src/runner-adapter.ts`
- `packages/core/src/adapter-registry.test.ts`
- `packages/core/src/index.ts`
- `packages/core/src/runner-adapter.ts`
- `packages/core/src/skills/bootstrap/deck-init-content.ts`
- `packages/core/src/skills/bootstrap/index.test.ts`
- `packages/core/src/teams/developer/content-registry.test.ts`
- `packages/core/src/teams/developer/content-registry.ts`
- `packages/core/src/teams/developer/orchestrator-content.test.ts`
- `packages/core/src/teams/developer/orchestrator-content.ts`
- `packages/core/src/teams/developer/prompt-profile.test.ts`

Untracked paths outside the implementation allowlist / V1 report target:

- `apps/cli/src/skill-registry-command.test.ts`
- `apps/cli/src/skill-registry-command.ts`
- `openspec/archive/agent-skill-registry-discovery/apply-progress.md`
- `openspec/archive/agent-skill-registry-discovery/archive-report.md`
- `openspec/archive/agent-skill-registry-discovery/design.md`
- `openspec/archive/agent-skill-registry-discovery/events.yaml`
- `openspec/archive/agent-skill-registry-discovery/exploration.md`
- `openspec/archive/agent-skill-registry-discovery/preconditions.md`
- `openspec/archive/agent-skill-registry-discovery/proposal.md`
- `openspec/archive/agent-skill-registry-discovery/repair-incident.md`
- `openspec/archive/agent-skill-registry-discovery/review-report.md`
- `openspec/archive/agent-skill-registry-discovery/spec.md`
- `openspec/archive/agent-skill-registry-discovery/state.yaml`
- `openspec/archive/agent-skill-registry-discovery/tasks.md`
- `openspec/archive/agent-skill-registry-discovery/verify-report.md`
- `openspec/changes/opencode-package-install-running-binary-regression/apply-progress.md`
- `openspec/changes/opencode-package-install-running-binary-regression/design.md`
- `openspec/changes/opencode-package-install-running-binary-regression/events.yaml`
- `openspec/changes/opencode-package-install-running-binary-regression/exploration.md`
- `openspec/changes/opencode-package-install-running-binary-regression/preconditions.md`
- `openspec/changes/opencode-package-install-running-binary-regression/proposal.md`
- `openspec/changes/opencode-package-install-running-binary-regression/spec.md`
- `openspec/changes/opencode-package-install-running-binary-regression/state.yaml`
- `openspec/changes/opencode-package-install-running-binary-regression/tasks.md`
- `packages/adapter-opencode/src/capability-inventory.test.ts`
- `packages/core/src/skill-discovery/contracts.ts`
- `packages/core/src/skill-discovery/discovery.test.ts`
- `packages/core/src/skill-discovery/discovery.ts`
- `packages/core/src/skill-discovery/index.ts`
- `packages/core/src/skill-discovery/persistence.test.ts`
- `packages/core/src/skill-discovery/persistence.ts`
- `packages/core/src/skill-discovery/registry.test.ts`
- `packages/core/src/skill-discovery/registry.ts`
- `packages/core/src/teams/developer/skill-discovery-content.test.ts`
- `packages/core/src/teams/developer/skill-discovery-content.ts`

### Static prohibition result inside the 15 implementation files

Diff-added-only scan of the 15 implementation files found `3380` added lines. The inert v0.9.0 `pgrep` warning fixture is present only as text. No added `runner-capability-standardization`, dependency/lockfile, generated-file, live network test, binary staging/replacement, retry loop, `process.kill`, `pkill`, or `kill` API was found in the implementation allowlist. Two added `process.env.HOME` references are used as redaction inputs in TUI boundaries, not as live-home fixtures.

## FailureManifestV1

```yaml
version: FailureManifestV1
status: blocking
change: opencode-package-install-running-binary-regression
phase: V1 Verify
failed_check_id: V1-SCOPE-ALLOWLIST
what_failed: >-
  The mandatory changed-path/prohibition audit could not verify an exact 15-file
  implementation allowlist because the current worktree contains 22 tracked
  changed paths and 35 untracked paths outside the implementation allowlist and
  V1 report target.
why_it_matters: >-
  This change is scoped to a tightly bounded installer regression. Extra source,
  prompt, registry, Pi, CLI, architecture, archived-history, and skill-discovery
  paths prevent V1 from proving that Apply modified only the authorized targets.
blocking: true
next_decision_or_action: >-
  Coordinator must provide a clean scoped worktree or an explicit authorized
  reconciliation separating unrelated baseline changes before rerunning V1.
```

## RegistryIntentV1 values

The coordinator owns centralized registry writes. V1 returns intent only.

1. `registry-intent:v1:verify:opencode-package-install-running-binary-regression:v1:failed:blocking-scope-allowlist`

## R1 readiness

R1 may proceed: **No**. The blocking changed-path/prohibition failure must be resolved or formally reconciled before independent Review.
