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

---

# V2 Fresh Independent Verify — PASS

## V2 decision

V2 **PASSES**. R1 may proceed after the coordinator validates and serializes the ordered V2 registry intent. V1 remains preserved above as historical failed evidence and was not overwritten.

This V2 result is bound to checkpoint commit `3b5b22d` (`feat(developer-team): add skill discovery and safe OpenCode setup`). Immediate source/test drift after the checkpoint is absent: current worktree source/test digest for the 15 implementation targets equals the `3b5b22d` digest, and `git diff --name-only 3b5b22d` contains no `apps/`, `packages/`, or `docs/` path.

## V2 official bases and amendment

| Artifact | SHA-256 / evidence |
|---|---|
| `HEAD` | `3b5b22d` |
| `spec.md` | `007dacb13bacc4e891454dd11a7d9a2de4db229cf36656374202df4283c7846a` |
| `design.md` | `b52aa1174d4408f1132738a00cc630399ed0419ef8ce3192defb6ed83ae28465` |
| `tasks.md` | `fb06ccbafc96093bd891a5f24454f74991d30d9c4f18d6cdb90d3a7ebe4a7c50` |
| `apply-progress.md` | `19be2c95ef1d52fbd44b9f2b9677a6bccf7371d4d35eadd06afcc7b6d3c3c799` |
| `verify-report.md` before V2 append | `9a92279827a71d04795fa42ada466e3536910e3e81a742e7ff00a4b49d9aaae3` |
| `state.yaml` | `da9a9b1a754e7ae487402e283ef0ebdffb0588f23620fbcafa1e752bc265fa01` |
| `events.yaml` | `83ae544211848ec97621c0cadc42aa029f71665b504c77e44c5cd1195d71341c` |

Exact V2 amendment read from `tasks.md` lines 177-188: V2 depends on V1 historical failure, user-authorized commit `3b5b22d`, and a clean post-commit worktree; V2 must rerun every V1 behavioral/focused/affected/typecheck/build/diff/rooted-OpenSpec/static/freshness/disposable-sandbox check; preserve V1; bind source/test evidence to `3b5b22d`; reconcile the commit's complete path set against the archived `agent-skill-registry-discovery` allowlists and this change's 15-file allowlist; and block if any committed path lacks an authoritative owner or if any implementation file differs from the checkpoint.

## V2 check evidence

| Check ID | Command / method | Result |
|---|---|---|
| V2-FOCUSED-7 | `bun test packages/adapter-opencode/src/model-discovery-context.test.ts packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts packages/adapter-opencode/src/install-tools.test.ts packages/adapter-opencode/src/runner-adapter.test.ts apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` | PASS, exit `0`; `81 pass`, `0 fail`; `Ran 81 tests across 7 files` |
| V2-AFFECTED-4 | `bun test packages/adapter-opencode/src/context-mode-integration.test.ts packages/adapter-opencode/src/runner-capabilities.test.ts apps/cli/src/tui/runner-dashboard/action-runner.test.ts apps/cli/src/tui/runner-dashboard/render.test.tsx` | PASS, exit `0`; `49 pass`, `0 fail`; `Ran 49 tests across 4 files` |
| V2-TYPECHECK | `bunx tsc --noEmit` | PASS, exit `0`; `0` TypeScript diagnostics |
| V2-BUILD-DRY-RUN | `bun run build:dry-run` | PASS, exit `0`; dry run `linux-x64`; built `deck` |
| V2-DIFF-CHECK | `git diff --check` | PASS, exit `0`; no whitespace errors |
| V2-OPENSPEC-ROOTED | `bun run deck -- openspec validate --json --change opencode-package-install-running-binary-regression --root /home/kevinlb/deck` from `/home/kevinlb/deck` | PASS, exit `0`; `ok: true`; `validChanges: 1`; `totalErrors: 0`; `totalWarnings: 0` |
| V2-COVERAGE-34-51 | Parsed `spec.md` requirement/scenario headings and checked Design coverage matrix lines 472-513 | PASS; `34/34` requirements and `51/51` scenarios; first/last requirement `REQ-EVD-01` / `REQ-TST-04`; first/last scenario `EVD-01-S1` / `TST-04-S1` |
| V2-RED-INTEGRITY | Inspected `apply-progress.md` T1-T6 RED/GREEN blocks | PASS; T1-T6 each contain RED command, exit `1`, failure anchor(s), GREEN exit `0`, and pass/zero-fail result; T3 also contains supplemental RED evidence |
| V2-FRESHNESS | Hash 15 implementation files at `3b5b22d` and in current worktree | PASS; source/test digest `40509fe8bb7ca486e3d5ca4ee61d1e61e3501c07d7217133182f302dc0659d6a` at both points; no post-checkpoint source/test drift |
| V2-CURRENT-WORKTREE | `git status --short` before V2 append | PASS; only coordinator-owned successor artifacts were modified: `events.yaml`, `state.yaml`, `tasks.md` |
| V2-STATIC-PROHIBITION | Added-line scan of the 15 implementation targets in commit `3b5b22d` plus path audit | PASS; no `runner-capability-standardization`, dependency/lock/generated path, secret file, Git-state path, process-kill API, process enumeration/signaling invocation, binary staging/replacement, retry loop, or automated live-home/network fixture. Twelve lexical hits were reviewed as inert/allowed: `pgrep` appears only in sanitizer keyword text and an inert v0.9.0 stderr fixture; `https://example.test` appears only in fixtures; the `curl` line is the existing injected production installer seam and tests supply sentinels rather than network. |
| V2-COMMIT-PATH-OWNERSHIP | Enumerated `git diff-tree --no-commit-id --name-only -r 3b5b22d` | PASS; exactly `72` paths, `0` unknown, `0` forbidden/generated/dependency/Git-state/secret paths, `2` shared OPCR/ASRD paths explicitly accounted for |
| V2-DISPOSABLE-SANDBOX | Fresh `/tmp/deck-cbm-v2-*` sandbox with sandbox `HOME`, XDG roots, project root, and PATH; harness-owned fake `codebase-memory-mcp` v0.9.0 executable started as retained child PID; installer/download/shell sentinels injected | PASS; result `codebase-memory already-present`, `success: true`, `installerInvoked: false`; sentinel calls `0`; sentinel file absent; checksum unchanged `14ff81a61ea02bd5dd562a6c1a35e4e1526505b23ec7242a6f6aabda531ac924`; real user root snapshots unchanged; only harness PID `294621` was signaled for cleanup; sandbox root removed |

## 72-path ownership audit

Authoritative evidence anchors:

- Current change 15-file implementation allowlist: `tasks.md` lines 14-30 and `design.md` lines 394-418.
- Current change OpenSpec lifecycle artifacts: current change proposal/spec/design/tasks/apply-progress/verify/state/events/preconditions/exploration, with V2 allowing successor lifecycle artifacts as evidence/lifecycle files (`tasks.md` lines 177-188).
- Archived `agent-skill-registry-discovery` artifacts: `openspec/archive/agent-skill-registry-discovery/tasks.md` lines 254-576, 736-1017, 1029-1048, and archive lifecycle artifacts under `openspec/archive/agent-skill-registry-discovery/`.

| # | Path | Authoritative owner |
|---:|---|---|
| 1 | `apps/cli/src/cli-args.test.ts` | ASRD T7 |
| 2 | `apps/cli/src/cli-args.ts` | ASRD T7 |
| 3 | `apps/cli/src/main.tsx` | ASRD T7 |
| 4 | `apps/cli/src/skill-registry-command.test.ts` | ASRD T7 / T-RR-001i / T-RR-008 / T-RR-009 |
| 5 | `apps/cli/src/skill-registry-command.ts` | ASRD T7 / T-RR-008 / T-RR-009 |
| 6 | `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` | OPCR 15-file implementation allowlist |
| 7 | `apps/cli/src/tui/app.tsx` | OPCR 15-file implementation allowlist |
| 8 | `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts` | OPCR 15-file implementation allowlist |
| 9 | `apps/cli/src/tui/runner-dashboard/action-runner.ts` | OPCR 15-file implementation allowlist |
| 10 | `apps/cli/src/tui/screens/runner-dashboard-screens.tsx` | OPCR 15-file implementation allowlist |
| 11 | `docs/architecture.md` | ASRD T12 |
| 12 | `openspec/archive/agent-skill-registry-discovery/apply-progress.md` | ASRD archived lifecycle artifact |
| 13 | `openspec/archive/agent-skill-registry-discovery/archive-report.md` | ASRD archived lifecycle artifact |
| 14 | `openspec/archive/agent-skill-registry-discovery/design.md` | ASRD archived lifecycle artifact |
| 15 | `openspec/archive/agent-skill-registry-discovery/events.yaml` | ASRD archived lifecycle artifact |
| 16 | `openspec/archive/agent-skill-registry-discovery/exploration.md` | ASRD archived lifecycle artifact |
| 17 | `openspec/archive/agent-skill-registry-discovery/preconditions.md` | ASRD archived lifecycle artifact |
| 18 | `openspec/archive/agent-skill-registry-discovery/proposal.md` | ASRD archived lifecycle artifact |
| 19 | `openspec/archive/agent-skill-registry-discovery/repair-incident.md` | ASRD archived lifecycle artifact |
| 20 | `openspec/archive/agent-skill-registry-discovery/review-report.md` | ASRD archived lifecycle artifact |
| 21 | `openspec/archive/agent-skill-registry-discovery/spec.md` | ASRD archived lifecycle artifact |
| 22 | `openspec/archive/agent-skill-registry-discovery/state.yaml` | ASRD archived lifecycle artifact |
| 23 | `openspec/archive/agent-skill-registry-discovery/tasks.md` | ASRD archived lifecycle artifact |
| 24 | `openspec/archive/agent-skill-registry-discovery/verify-report.md` | ASRD archived lifecycle artifact |
| 25 | `openspec/changes/opencode-package-install-running-binary-regression/apply-progress.md` | OPCR lifecycle evidence artifact |
| 26 | `openspec/changes/opencode-package-install-running-binary-regression/design.md` | OPCR lifecycle artifact |
| 27 | `openspec/changes/opencode-package-install-running-binary-regression/events.yaml` | OPCR lifecycle artifact |
| 28 | `openspec/changes/opencode-package-install-running-binary-regression/exploration.md` | OPCR lifecycle artifact |
| 29 | `openspec/changes/opencode-package-install-running-binary-regression/preconditions.md` | OPCR lifecycle artifact |
| 30 | `openspec/changes/opencode-package-install-running-binary-regression/proposal.md` | OPCR lifecycle artifact |
| 31 | `openspec/changes/opencode-package-install-running-binary-regression/spec.md` | OPCR lifecycle artifact |
| 32 | `openspec/changes/opencode-package-install-running-binary-regression/state.yaml` | OPCR lifecycle artifact |
| 33 | `openspec/changes/opencode-package-install-running-binary-regression/tasks.md` | OPCR lifecycle artifact |
| 34 | `openspec/changes/opencode-package-install-running-binary-regression/verify-report.md` | OPCR lifecycle evidence artifact |
| 35 | `packages/adapter-opencode/src/capability-inventory.test.ts` | OPCR 15-file implementation allowlist |
| 36 | `packages/adapter-opencode/src/capability-inventory.ts` | OPCR 15-file implementation allowlist |
| 37 | `packages/adapter-opencode/src/install-tools.test.ts` | OPCR 15-file implementation allowlist |
| 38 | `packages/adapter-opencode/src/install-tools.ts` | OPCR 15-file implementation allowlist |
| 39 | `packages/adapter-opencode/src/model-discovery-context.test.ts` | OPCR 15-file implementation allowlist |
| 40 | `packages/adapter-opencode/src/model-discovery-context.ts` | OPCR 15-file implementation allowlist |
| 41 | `packages/adapter-opencode/src/prompt-generation.test.ts` | ASRD T10 |
| 42 | `packages/adapter-opencode/src/prompt-generation.ts` | ASRD T10 |
| 43 | `packages/adapter-opencode/src/required-tools.test.ts` | OPCR 15-file implementation allowlist |
| 44 | `packages/adapter-opencode/src/required-tools.ts` | OPCR 15-file implementation allowlist |
| 45 | `packages/adapter-opencode/src/runner-adapter.test.ts` | Shared: OPCR 15-file implementation allowlist; ASRD T5a / T-RR-001 / T-RR-006 |
| 46 | `packages/adapter-opencode/src/runner-adapter.ts` | Shared: OPCR 15-file implementation allowlist; ASRD T5a / T-RR-006 |
| 47 | `packages/adapter-pi/src/orchestrator-prompt.test.ts` | ASRD T11 |
| 48 | `packages/adapter-pi/src/pi-team-profile.test.ts` | ASRD T11 |
| 49 | `packages/adapter-pi/src/pi-team-profile.ts` | ASRD T11 |
| 50 | `packages/adapter-pi/src/registry-consumption.test.ts` | ASRD T11r |
| 51 | `packages/adapter-pi/src/runner-adapter.test.ts` | ASRD T5b / T-RR-001 |
| 52 | `packages/adapter-pi/src/runner-adapter.ts` | ASRD T5b |
| 53 | `packages/core/src/adapter-registry.test.ts` | ASRD T1 |
| 54 | `packages/core/src/index.ts` | ASRD T1 |
| 55 | `packages/core/src/runner-adapter.ts` | ASRD T1 |
| 56 | `packages/core/src/skill-discovery/contracts.ts` | ASRD T1 |
| 57 | `packages/core/src/skill-discovery/discovery.test.ts` | ASRD T2 / T-RR-001 / T-RR-002 / T-RR-007 |
| 58 | `packages/core/src/skill-discovery/discovery.ts` | ASRD T2 / T-RR-001 / T-RR-002 / T-RR-007 / T-RR-009 |
| 59 | `packages/core/src/skill-discovery/index.ts` | ASRD T1 |
| 60 | `packages/core/src/skill-discovery/persistence.test.ts` | ASRD T4 / T-RR-005 |
| 61 | `packages/core/src/skill-discovery/persistence.ts` | ASRD T4 / T-RR-005 |
| 62 | `packages/core/src/skill-discovery/registry.test.ts` | ASRD T3 / T-RR-003 / T-RR-008 / T-RR-009 |
| 63 | `packages/core/src/skill-discovery/registry.ts` | ASRD T3 / T-RR-003 / T-RR-008 / T-RR-009 |
| 64 | `packages/core/src/skills/bootstrap/deck-init-content.ts` | ASRD T8 |
| 65 | `packages/core/src/skills/bootstrap/index.test.ts` | ASRD T8 |
| 66 | `packages/core/src/teams/developer/content-registry.test.ts` | ASRD T6 |
| 67 | `packages/core/src/teams/developer/content-registry.ts` | ASRD T6 |
| 68 | `packages/core/src/teams/developer/orchestrator-content.test.ts` | ASRD T9 |
| 69 | `packages/core/src/teams/developer/orchestrator-content.ts` | ASRD T9 |
| 70 | `packages/core/src/teams/developer/prompt-profile.test.ts` | ASRD T9 |
| 71 | `packages/core/src/teams/developer/skill-discovery-content.test.ts` | ASRD T6 |
| 72 | `packages/core/src/teams/developer/skill-discovery-content.ts` | ASRD T6 |

Ownership summary: `72/72` paths have an evidence-backed owner. `2/72` are shared with explicit OPCR+ASRD ownership (`packages/adapter-opencode/src/runner-adapter.ts`, `packages/adapter-opencode/src/runner-adapter.test.ts`). `0/72` are unknown. `0/72` are generated, dependency/lock, secret, Git-state, or `runner-capability-standardization` paths.

## Current uncommitted path confirmation

Before this V2 append, `git status --short` showed only coordinator-owned successor lifecycle artifacts:

```text
M openspec/changes/opencode-package-install-running-binary-regression/events.yaml
 M openspec/changes/opencode-package-install-running-binary-regression/state.yaml
 M openspec/changes/opencode-package-install-running-binary-regression/tasks.md
```

After this append, the only additional authorized path is this report: `openspec/changes/opencode-package-install-running-binary-regression/verify-report.md`. No source/test/Apply/registry/config/Git/generated/dependency/user-home/process/archive path was modified by Verify.

## FailureManifestV1

None. V2 has no blocking failures.

## Ordered RegistryIntentV1 values

1. `registry-intent:v1:verify:opencode-package-install-running-binary-regression:v2:passed` — phase `verify`, status `passed`, actor `deck-developer-verify`, checkpoint `3b5b22d`, report base digest `sha256:9a92279827a71d04795fa42ada466e3536910e3e81a742e7ff00a4b49d9aaae3`, source/test digest `sha256:40509fe8bb7ca486e3d5ca4ee61d1e61e3501c07d7217133182f302dc0659d6a`, checks: focused `81/81`, affected `49/49`, typecheck/build/diff/OpenSpec/static/freshness/sandbox/path-ownership all passing.

## V2 provenance and blockers

- Role / instance: independent `deck-developer-verify`, fresh V2 after user-authorized clean commit checkpoint.
- Adaptive context: loaded as advisory only; official OpenSpec/source/test evidence controlled this result.
- Centralized mode: Verify did not write `state.yaml` or `events.yaml`.
- Git safety: no destructive Git command was run.
- Blockers: none.
- R1 readiness: **R1 may proceed** after coordinator intent validation/serialization.

# V2 Post-Restart Runtime Validation Addendum — PASS preserved

## Addendum decision

Independent post-restart validation preserves the V2 PASS. The current runtime evidence shows that OpenCode model discovery now completes successfully, the latest setup run intentionally skipped external installers because installed tools were positively detected, and the OpenCode configuration contains the expected enabled MCP/team shape. No contrary evidence was found.

## Addendum official bases and integrity checks

- `verify-report.md` pre-addendum SHA-256 matched the delegated V2 base: `51ffb50e841b82fcdef69367604984208363ec772d618c0635516f096538808e`.
- `state.yaml` SHA-256 matched the delegated base: `7c6af5ecdb6af933a64dfc8b7c6c18de6c4ccd956ef073e3c2ab558bf5508ece`.
- `events.yaml` SHA-256 matched the delegated base: `0a2dc625b9ff35524576d5457c6c88b91631fae39eb31dcfc3eec6aa293d9916`.
- `/tmp/deck-tui.log` SHA-256 matched the delegated base: `86889bbabb52773d5b54a041bbbf892b2d7dd02f50ded94c2a98c0f183ef45ab`.
- `/tmp/deck-install-debug.log` SHA-256 matched the delegated base: `edd1b92946f0e133a2bff476c109afb3f3a28515c6192a00a49e34c2e0de36e0`.

## Runtime evidence confirmed after OpenCode restart

| Check | Evidence | Result |
| --- | --- | --- |
| Latest setup duration and counters | `/tmp/deck-tui.log` lines 150-151: `duration=56ms`, `executed=6`, `failed=0`, `skipped=5`, `informational=1`. | PASS |
| Installed-tool detection and installer skip | `/tmp/deck-tui.log` lines 104-126: context-mode, codebase-memory, RTK, and Serena each returned `already-present`; lines 105, 114, 120, and 126 state `installer not run`. | PASS |
| MCP config writes and Developer Team apply | `/tmp/deck-tui.log` lines 127-142 show MCP config writes and Developer Team apply completed; lines 152-153 summarize executed config writes and five MCP servers after install: `codebase-memory`, `context-mode`, `context7`, `serena`, `supermemory`. | PASS |
| Current MCP config shape | Current `~/.config/opencode/opencode.json` contains five enabled MCP entries. The current config key set is `codebase-memory-mcp`, `context-mode`, `context7`, `serena`, and `supermemory`; this is the current config representation of the five post-install bindings and no secret/config values were inspected or recorded. | PASS |
| Developer Team entries and deck skills | Current OpenCode config contains 14 Deck agent entries with both `model` and `prompt` assignments: 12 `deck-developer-*` roles plus `deck-init` and `deck-onboard`. Current skill directories contain the corresponding 14 deck skills. | PASS |
| Current OpenCode model discovery | `opencode models --verbose` exited `0` after restart in `5973ms`; output summary only: `stdoutLines=8691`, `stdoutBytes=162655`, `stderrBytes=0`; no `OpenCode model discovery is unavailable` or timeout text was present. Model names/content were not recorded. | PASS |
| Installed executable versions | Current executable evidence: `opencode` at `/home/kevinlb/.opencode/bin/opencode`, version `1.18.5`; `codebase-memory-mcp` at `/home/kevinlb/.local/bin/codebase-memory-mcp`, version `0.9.0`; `rtk` at `/home/kevinlb/.local/bin/rtk`, version `0.43.0`; `serena` at `/home/kevinlb/.local/bin/serena`, version `1.5.3`. | PASS |

## Fact/inference boundary

- Fact: before restart, the user observed `OpenCode model discovery is unavailable` / timeout from both `bun run deck:run` and the previously installed Deck binary.
- Fact: after restarting OpenCode, the current `opencode models --verbose` command exits successfully without the unavailable/timeout error.
- Inference: the pre-restart failure is consistent with stale or transient OpenCode runtime state.
- Limitation: the available logs and current runtime evidence do not prove the exact root cause of the pre-restart timeout.
- Fact: the 56ms setup run is expected because installed tools were positively detected and external installers were intentionally skipped; it is not evidence of an incomplete setup.

## Addendum hygiene check

- `git diff --check` was run after appending this addendum and exited `0` with no stdout/stderr findings.
- Current uncommitted paths include pre-existing coordinator-owned OpenSpec state/task paths plus this report; this Verify invocation only modified `openspec/changes/opencode-package-install-running-binary-regression/verify-report.md`.

## Addendum FailureManifestV1

```json
[]
```

## Addendum RegistryIntentV1 values

```json
[]
```

## Addendum provenance and blockers

- Role/instance: independent Verify specialist, post-restart addendum invocation.
- Authorized write scope observed: only this `verify-report.md` addendum was appended.
- Adaptive context: loaded as advisory only; official OpenSpec/source/runtime evidence controlled this result.
- Centralized mode: Verify did not write `state.yaml` or `events.yaml`.
- Git safety: no destructive Git command was run.
- Blockers: none.
- R1 readiness: **R1 may proceed** after coordinator intent validation/serialization.
