# Exploration: OpenCode Package Install Running-Binary Regression

## Phase Contract

- **Change ID:** `opencode-package-install-running-binary-regression`
- **Mode:** Automatic
- **Phase:** Explore
- **Role:** `deck-developer-explorer`
- **Status:** Completed
- **Modification boundary:** This phase creates only this `exploration.md`. It does not modify source, tests, configuration, user-home state, Git state, shared registry YAML, or the archived `agent-skill-registry-discovery` change.
- **Next normal handoff:** Proposal

## Question Investigated

Why did the OpenCode runner package action `capability.codebase-memory.install` fail while installing the checksum-verified `codebase-memory-mcp` 0.9.0 release, what relationship does that failure have to the just-archived `agent-skill-registry-discovery` change, and what is the smallest robust Deck correction?

## Context Authority

### Official context

OpenSpec is initialized: `openspec/config.yaml` has `schema: spec-driven` and `initialized: true` (`openspec/config.yaml:1-3`). The archived registry record identifies `agent-skill-registry-discovery` as `currentPhase: archive` and `status: archived` (`openspec/archive/agent-skill-registry-discovery/state.yaml:1-5`). The archived artifacts were inspected read-only and remain unchanged.

The current worktree, source, tests, runtime logs, and repository history are runtime evidence. At exploration time:

- branch: `main`
- HEAD: `e906b99691f5d0b446315d236e63a829025db0f2`
- the archived change and its source/test implementation are still Git-visible worktree changes/untracked paths rather than commits;
- no commit touches `openspec/archive/agent-skill-registry-discovery`;
- the package-install pipeline files listed below have no worktree delta from HEAD, except that `packages/adapter-opencode/src/runner-adapter.ts` has additive skill-discovery work outside its existing `runAction` package-install method.

### Adaptive context

Adaptive context was loaded as advisory evidence. It corroborated that `agent-skill-registry-discovery` completed and was archived, but it did not override OpenSpec, source, tests, logs, or Git evidence.

## Executive Findings

1. **The immediate failure is upstream release 0.9.0 behavior.** The downloaded candidate runs `pgrep -x codebase-memory-mcp`. Linux process-name matching is limited to 15 characters, so `pgrep` emits the observed warning and finds no process. The still-running executable then causes the candidate's direct `fopen(dst, "wb")` replacement to fail on Linux, producing `error: failed to copy binary to ...`.
2. **Deck reports the external failure honestly but too opaquely.** The installer result is `success: false`, the action remains `failed`, and dependent work can be gated. However, `runPackageInstall` replaces the useful installer message with `Package install reported a failure.`; the completion screen renders only that generic message and ignores the already-carried diagnostics.
3. **The archived change did not introduce the faulty installer or Deck package-install path.** Its approved scope explicitly excluded installing/upgrading/synchronizing skills and replacing runner catalogs. Its implementation allowlist does not include `install-tools.ts`, `installation-plan.ts`, `capability-plan.ts`, the TUI action runner, or dashboard screens. Those paths predate the archived change and are byte-identical to HEAD.
4. **The archived change is, at most, correlated trigger context.** It may make codebase-memory discovery/use more visible in an active OpenCode session, but no inspected archived artifact or diff starts, installs, stops, or owns the MCP process. The evidence does not prove that the archived change caused the process to be active or caused the install action to be planned.
5. **Deck has a separate integration weakness that can schedule unnecessary reinstall attempts.** `reviewOpenCodeTools` returns every tool as missing when both of its default user-level config files are absent, before checking PATH. It inspects only those default files plus PATH names. An MCP can therefore be configured or running through another effective OpenCode configuration/absolute command while Deck still plans an install. The runtime log proves the plan classified `codebase-memory` for installation, but it does not expose which detector branch produced that classification.
6. **The current Deck plan already runs installs before its own config writes and team application.** Reordering within `runRunnerReviewPlan` cannot stop an MCP process that was started earlier by the parent OpenCode host.
7. **Current upstream `main` contains a substantially safer transactional/cohort-based activation implementation, but the latest published release is still v0.9.0.** The mutable `main/install.sh` currently downloads the latest release candidate, so it still obtains the affected 0.9.0 binary. A true forced reinstall while sessions are active therefore remains upstream-blocked until a fixed release is published.

## Verified Runtime Trace

### Plan and catalog

1. `FULL_OPENCODE_CAPABILITY_CATALOG["codebase-memory"]` declares detector command `codebase-memory-mcp`, tool ID `codebase-memory`, and install kind `shell-script` (`packages/adapter-opencode/src/capability-catalog.ts:75-86`).
2. `OPENCODE_INSTALLABLE_TOOLS` maps `codebase-memory` to `https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh` (`packages/adapter-opencode/src/installation-plan.ts:39-49`).
3. When inventory says the capability is missing, `addCapabilityActions` creates `capability.codebase-memory.install`, kind `install-opencode-plugin`, source/tool ID `codebase-memory` (`packages/adapter-opencode/src/capability-plan.ts:194-210`).
4. The real log records selected capability keys, an inventory containing `codebase-memory`, seven automatic installs, and execution of that exact action (`/tmp/deck-tui.log:19-26,48,63-68`).

### Deck execution and normalization

5. `runRunnerReviewPlan` runs automatic installs/manual steps first, records failed capability prefixes, then processes config writes and gates matching MCP config writes (`apps/cli/src/tui/runner-dashboard/action-runner.ts:119-253`).
6. `runRunnerAction` routes `install-opencode-plugin`, `npm-install`, and Pi package actions to `runPackageInstall`, preserving thrown errors as failed action messages (`action-runner.ts:255-296`).
7. `runPackageInstall` passes the catalog ID to the injected package installer. Empty results fail explicitly. A returned `success: false` becomes action status `failed`; the external message is retained in `diagnostics` and `raw`, but the top-level message becomes only `Package install reported a failure.` (`action-runner.ts:298-344`).
8. `DeckApp.runDashboardInstall` maps the package ID back to `OPENCODE_INSTALLABLE_TOOLS` and calls `installOpenCodeTools` (`apps/cli/src/tui/app.tsx:969-1225`, especially 1043-1135).
9. For `shell-script`, `installOpenCodeTools` downloads the mutable script with `curl -fsSL`, pipes it to the platform shell, captures stdout/stderr, and returns failure when the shell exits nonzero (`packages/adapter-opencode/src/install-tools.ts:70-170`). It does not itself replace or kill the MCP binary.
10. The real installer log records script download success, mandatory checksum success, verified candidate `codebase-memory-mcp 0.9.0`, shell exit 1, the `pgrep` warning, and failed copy (`/tmp/deck-install-debug.log:69-96`).
11. The plan continues after the failed action and finishes with 12 results: 9 executed, 1 failed, 1 skipped, and 1 informational (`/tmp/deck-tui.log:106-107`). There is no hidden success.

### Dashboard rendering

12. `InstallProgressScreen` and `DashboardCompleteScreen` render only `RunnerActionRunResult.message`; the completion screen lists generic failed messages and never renders `diagnostics` (`apps/cli/src/tui/screens/runner-dashboard-screens.tsx:258-304`). This exactly explains why the user saw only `Package install reported a failure.`.

## Why the Running Linux Binary Fails to Replace

The v0.9.0 candidate source at tag commit `b637e3330c96cfe452da623db068c241aaa3ec01` establishes the complete mechanism:

1. `cbm_kill_other_instances` runs `pgrep -x codebase-memory-mcp` and sends `SIGTERM` to every returned PID except self (`src/cli/cli.c:3033-3063`).
2. On Linux, `pgrep -x` matches the process name (`comm`), which is limited to 15 characters. `codebase-memory-mcp` is longer, so the observed `pgrep` implementation warns and returns no match.
3. Installation then calls `cbm_copy_binary_to_target(self_path, bin_target)` (`src/cli/cli.c:3801-3847`).
4. That helper delegates to `cbm_copy_file`, which opens the existing destination directly with `fopen(dst, "wb")` (`src/cli/cli.c:319-352,378-395`). Linux refuses this direct writable open for an executing file (`ETXTBSY`, commonly “Text file busy”). The helper loses the OS error detail and returns a generic copy failure.
5. The v0.9.0 focused tests cover copying an absent target, overwriting a stale non-running target, and same-inode self-copy. They do not cover replacement while the destination executable is running (`tests/test_cli.c:1149-1223`).

Changing only `pgrep -x` to `pgrep -f` is not an acceptable Deck fix. Full-command matching can match unrelated commands, wrapper shells, test invocations, or the installer command itself. The v0.9.0 code also kills every matching process other than self without proving which host/session owns it. Deck must not copy that behavior or kill by ambiguous process name.

## Causality Assessment

### Verified facts

- The archived proposal excludes installing, upgrading, deleting, synchronizing, or distributing skills and excludes replacement of runner catalogs/loading mechanisms (`openspec/archive/agent-skill-registry-discovery/proposal.md:74-87`).
- The archived design says skill-discovery bindings expose no installer, loader, command executor, writer, or authorization field (`design.md:207`).
- The archived task allowlist changes OpenCode `runner-adapter.ts` only for a read-only skill-discovery provider and changes prompt materialization separately. It does not authorize edits to the package installer, plan, action runner, or dashboard.
- Current Git diff inspection found no change from HEAD in `install-tools.ts`, `installation-plan.ts`, `capability-plan.ts`, `app.tsx`, `action-runner.ts`, or `runner-dashboard-screens.tsx`.
- Git blame places the package shell installer, catalog/plan, action normalization/sequencing, and dashboard rendering in May/June 2026 commits, before `agent-skill-registry-discovery`.
- The archived change's `runner-adapter.ts` worktree delta is additive skill-discovery logic; the pre-existing `OpenCodeRunnerAdapterImpl.runAction` package-install method is not changed by that diff.

### Inference

- **High-confidence conclusion:** `agent-skill-registry-discovery` did not introduce the root defect.
- **Moderate-confidence trigger conclusion:** the failure surfaced during the first observed runner setup after that change while the codebase-memory MCP was active. Increased discovery/use may have made that state more likely, but this is correlation; no artifact proves a causal startup edge.
- **Moderate-confidence Deck contribution:** Deck likely scheduled an unnecessary install because installed-state detection did not observe the effective running/configured binary. The plan log does not include the detector reason, so this exact branch remains unproven.

### Causality label

**Pre-existing upstream replacement defect, exposed by a pre-existing Deck detection/diagnostic gap; not introduced by the archived change.**

## Existing Detection Gap

`reviewOpenCodeTools` currently:

- returns all tools missing immediately when neither the default `~/.config/opencode/package.json` nor `~/.config/opencode/opencode.json` exists;
- therefore skips PATH detection in that branch;
- otherwise recognizes only package names, MCP/plugin keys in that one config file, and PATH names;
- does not record a structured evidence source/reason for “installed” or “missing”;
- uses a colon-only PATH split and checks existence rather than executable permission (`packages/adapter-opencode/src/required-tools.ts:34-103`).

This is compatible with the observation that a process can already be running while the dashboard still schedules installation. It is not proof of the user's exact configuration path, which was intentionally not read or modified in this phase.

## Existing Test Evidence

The focused current suite passed unchanged:

```text
bun test \
  packages/adapter-opencode/src/install-tools.test.ts \
  packages/adapter-opencode/src/required-tools.test.ts \
  apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts \
  apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx

33 pass, 0 fail, 86 expect() calls
```

Coverage presently proves npm/external/MCP/Python installer branches, config/PATH package detection, install-before-config ordering, failed-install MCP gating, empty-result failure, and basic progress/complete rendering. It does **not** prove:

- shell-script behavior when a target binary is already running;
- a skip/already-present guard after a plan becomes stale;
- effective binary/config detection outside the one default user config;
- bounded installer-stderr normalization;
- dashboard rendering of a useful sanitized failure cause;
- ownership-safe process handling.

## Upstream Volatile Evidence

External evidence was retrieved on **2026-07-24** and is advisory/volatile:

| Evidence | Identity |
|---|---|
| Current installer script | `https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh`; Git blob `423464159ada2fe3684085cf5affc0d916c9a0d7`; SHA-256 `6f0277f1921c2327556f39e14db2c7a12fdf0a000c7075f4689ed4c73ea45ec5`; 9,604 bytes |
| Current upstream main | commit `97ce23f9827177fff3858831156e9795c6832b18`; `src/cli/cli.c` SHA-256 `553a53f67f8e4dacd7210b14096fdb8137c1e0d646d7f02ab3c2b1a3e5fb4e3f` |
| Latest release | `v0.9.0`, published 2026-07-08; tag commit `b637e3330c96cfe452da623db068c241aaa3ec01` |
| Linux portable asset | `codebase-memory-mcp-linux-amd64-portable.tar.gz`; release API digest `sha256:8459d5c9d1457f2c82de3de307ffc7641ecbba2dde893427be1e62eca8ef9b25` |
| v0.9.0 candidate source | `src/cli/cli.c` SHA-256 `8aedb88dae4a40e03bb0c1855f856eb4fff0a9ce9f6dd33c6af22fbdcf3dee38` |

Current upstream `main` stages and validates a candidate, uses version-cohort quiescence/lifetime coordination, and commits through an activation transaction rather than the v0.9.0 direct overwrite (`src/cli/cli.c` at current main around lines 585-820 and 1324-1348). This is materially safer than name-based killing. It is not yet the published candidate obtained by the current installer script.

## Repair Options

| Option | Benefit | Limitation / risk | Assessment |
|---|---|---|---|
| Run installs before MCP startup | Avoids a running target in a standalone bootstrap | Deck already runs installs before its own config/team actions; the parent OpenCode host can have started MCPs before `bun run deck:run` begins | Insufficient as a local reorder; reject as primary fix |
| Deck stops/restarts the MCP | Could unblock a direct overwrite | Deck has no trustworthy PID ownership or host restart contract; name/command matching can kill unrelated sessions and disrupt the invoking agent | Reject |
| Change to `pgrep -f` | Finds long commands | Ambiguous full-command matches; does not establish ownership; remains kill-based | Reject |
| Deck implements its own atomic binary updater | Can replace a running Unix executable by same-directory stage + rename | Duplicates upstream release/checksum/platform/signing/config behavior and creates long-term security ownership in Deck | Do not choose for this bounded change |
| Blind retry | Simple | Deterministically fails while the same target remains active; obscures cause and wastes time | Reject; classify as retryable only after the user/host closes the owning session |
| Skip when the desired package is already present/configured | Prevents an installation-only setup from becoming an accidental reinstall/upgrade | Requires precise evidence and an explicit outcome; must not skip a genuinely absent/broken install | Recommended Deck prevention |
| Upstream-only fix | Correct owner for true running-binary replacement | Does not repair Deck false-missing planning or opaque dashboard; fixed source is not yet released | Necessary for forced reinstall/upgrade, insufficient alone |
| Surface sanitized stderr | Makes the actionable cause visible without changing outcome | Must strip ANSI/progress/control text, secrets, and private absolute paths and must be bounded | Recommended Deck UX correction |

## Recommended Smallest Robust Correction

Treat runner setup as **installation/desired-state convergence, not an implicit upgrade**:

1. **Create one reusable installed-evidence check for OpenCode tools.** For codebase-memory, accept only bounded, positive evidence such as a configured MCP entry whose command resolves to a regular executable, a regular executable in PATH, or the canonical sandboxable install target. Do not return all tools missing before command/config evidence is evaluated. Record the evidence source internally so tests can distinguish configured, PATH, canonical-target, and absent states.
2. **Re-check immediately before launching the shell installer.** Plans can become stale and detector scope can differ from the effective runtime. If codebase-memory is already positively present, do not fetch or execute the installer. Return an explicit structured outcome/message such as `already-present; installer not run`, rather than silently claiming a fresh install.
3. **Keep true failures failed.** If the package is absent and the installer exits nonzero, preserve `failed`; do not convert it to success merely because an older target still exists.
4. **Normalize a bounded user-safe cause.** Strip ANSI/control/progress output, retain meaningful final `error:`/warning lines, replace the current home path with `~` (or a generic install target), apply existing secret redaction, and impose strict line/character bounds.
5. **Render the cause with the failed action.** The dashboard should show the package/action identity plus the normalized cause, while retaining the concise summary and full redacted diagnostics in debug evidence.
6. **Leave process shutdown and running-binary activation to upstream.** Deck must not enumerate/kill by process name, PID guess, or command substring. A future explicit upgrade/reinstall path should require a published upstream release with the transactional activation behavior or a separately designed ownership-safe host protocol.

This recommendation prevents the observed failure when setup mistakenly attempts to reinstall an already-running installed capability, improves truthfulness, and avoids making Deck an unsafe process manager. It does not pretend to solve a genuine forced upgrade against v0.9.0; that remains an upstream release concern.

## Likely File Impact for Proposal/Design

Likely minimum production/test surfaces, subject to Proposal and Design:

| File | Likely responsibility |
|---|---|
| `packages/adapter-opencode/src/required-tools.ts` | Correct installed-evidence evaluation and remove premature all-missing return |
| `packages/adapter-opencode/src/required-tools.test.ts` | PATH/config/canonical-target/absent/effective-config fixtures using injected paths only |
| `packages/adapter-opencode/src/install-tools.ts` | Immediate pre-execution already-present guard and bounded shell diagnostic normalization, if this remains the installer boundary |
| `packages/adapter-opencode/src/install-tools.test.ts` | Prove no downloader/shell call when already present; prove nonzero remains failure; ANSI/progress/path/secret bounds |
| `apps/cli/src/tui/runner-dashboard/action-runner.ts` | Preserve an explicit package outcome and user-safe diagnostic without generic-message loss |
| `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts` and/or existing action-runner tests | Outcome mapping, no hidden success, failed-install gating, safe diagnostic propagation |
| `apps/cli/src/tui/screens/runner-dashboard-screens.tsx` | Render failed action identity plus one bounded cause |
| `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` | Render-only proof for sanitized package failure and explicit already-present outcome |

`installation-plan.ts`, `capability-plan.ts`, and `app.tsx` should remain unchanged unless Design concludes that an additive structured package outcome or detector metadata must cross those boundaries. No change is justified in the archived change, shared registry schemas, user configuration, Git state, or `runner-capability-standardization`.

## Proposed Test and Acceptance Matrix

### Automated tests: no network, no live user state

All tests must use an injected detector/runner and a fresh temporary HOME/XDG tree. They must not read or write the user's real OpenCode config, execute the mutable upstream script, or kill processes.

1. Default config files absent, executable positively present through injected PATH evidence: tool is not classified missing.
2. PATH omits the executable, but a sandboxed canonical target and matching sandboxed MCP config are valid: desired state is already present.
3. Config points to a missing/non-file/non-executable target: no skip; install remains required.
4. Plan says install, but the binary appears before execution: downloader/shell invocation count remains zero and result explicitly says installer was not run.
5. Installer returns the observed `pgrep` and copy failure: result remains failed; normalized cause retains both meaningful facts but no ANSI progress, token, or absolute home path.
6. Failure continues to gate only the matching dependent config; unrelated actions continue under the existing policy.
7. Dashboard progress and completion screens identify `capability.codebase-memory.install` (or its display label) and show the bounded cause.
8. No production or test code invokes `pgrep`, `pkill`, `kill`, process-name matching, Git discard, or user-home cleanup.

### Real sandbox/manual reinstall path

Use a disposable Linux container when available; otherwise use a dedicated `/tmp` HOME in a single subshell:

- set `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, and PATH to directories below one fresh `/tmp/deck-cbm-*` root;
- seed only the published v0.9.0 release into the sandbox target;
- start the sandbox binary as a child whose exact PID is owned by the harness;
- run the installer/Deck flow only with the sandbox environment;
- record the child PID directly and terminate only that exact harness-owned child during cleanup;
- verify the real user config and `~/.local/bin` digests are unchanged before/after;
- with the Deck correction, an already-present installation-only setup must skip the shell installer explicitly;
- a separate upstream-current/manual lane may verify transactional replacement, but it must not be represented as a Deck automated test or mutate live configuration.

## Safety Constraints

- Never kill by process name, command substring, port guess, or unverified PID.
- Never stop/restart a process Deck cannot prove it owns and later restore safely.
- Never use Git discard operations or user-home cleanup as test setup/teardown.
- Never hide a failed installer behind an existing stale target.
- Never expose raw unbounded stderr, credentials, ANSI/control sequences, download progress, or private absolute home paths in the dashboard.
- Preserve the existing policy that unrelated actions may continue while the failed action remains visibly failed.

## Risks

1. **False skip:** weak evidence could suppress a needed install. Mitigate with regular-file/executable/config consistency checks and an execution-time re-check.
2. **Semantic ambiguity:** `executed` can falsely imply a fresh install when the installer was skipped. Prefer an additive outcome or an explicit message/status agreed in Design.
3. **Config scope mismatch:** OpenCode may have project, user, JSON/JSONC, or runner-resolved configuration surfaces. Design must use the existing adapter-resolved configuration authority rather than inventing another path scan.
4. **TOCTOU:** the target can change between evidence check and installer execution. Re-check at the effect boundary; never infer process ownership from presence.
5. **Diagnostic leakage:** upstream stderr can contain paths or future secrets. Normalize and bound before presentation, with raw debug handling remaining redacted and access-limited.
6. **Upstream drift:** the mutable script and latest release can change independently. Record content identities in incident evidence and do not encode v0.9.0 text matching as the sole classifier.
7. **Cross-platform behavior:** POSIX rename semantics do not imply Windows replacement safety. Deck prevention/detection must be cross-platform; true activation remains upstream-owned.

## Assumptions

- Runner setup is intended to install missing capabilities, not silently upgrade every existing capability.
- The observed process was launched before or independently of this package action; the exact owning host/PID was not inspected.
- Existing action continuation and matching-capability config gating are intentional behavior.
- The user's live OpenCode/home configuration is outside automated-test scope and was not read for causality.

## Open Decisions for Proposal

1. Confirm whether runner setup is strictly install-if-missing or also an upgrade/reinstall surface.
2. Choose the explicit result vocabulary for `already-present; installer not run` (`skipped`, `informational`, or an additive package outcome while preserving action status compatibility).
3. Identify the authoritative adapter-resolved OpenCode config/effective-command source, including JSONC/project-level behavior if supported.
4. Decide whether the dashboard shows one normalized cause inline or offers a bounded details view.
5. Decide whether Deck should block explicit codebase-memory upgrade/reinstall until a post-v0.9.0 transactional upstream release exists, or merely fail with actionable restart guidance.
6. Decide whether an upstream issue/release dependency should be recorded formally in Proposal.

## Confidence

- **Immediate upstream root cause:** High (runtime stderr exactly matches v0.9.0 source and release identity).
- **Deck result/dashboard trace:** High (direct source trace plus real log counters).
- **Archived-change non-introduction:** High (official exclusions, exact allowlists, worktree diff, and prior blame/history).
- **Exact reason Deck classified the active capability missing:** Medium-Low (the detector has a proven gap, but the real plan log lacks detector-source/reason telemetry and live config was intentionally not inspected).
- **Recommended Deck prevention:** Medium-High, pending the install-vs-upgrade product decision and authoritative config-resolution choice.

## Evidence References and Digests

### Official archived evidence

- `openspec/archive/agent-skill-registry-discovery/exploration.md` — SHA-256 `7c93abd533ed2240deae311d1085cc9e726ba86200dd5b523cceccec964215a1`
- `openspec/archive/agent-skill-registry-discovery/proposal.md` — SHA-256 `773031ad35abce4412179cb0d53f87e9f669947b2abcbfa5b66baa2e439292b5`
- `openspec/archive/agent-skill-registry-discovery/design.md` — SHA-256 `ce9c6c277acd98602df2c9214ebedce0fa15dddcbabe654056637f0fcc32d791`
- `openspec/archive/agent-skill-registry-discovery/tasks.md` — SHA-256 `da80c532b2f1332b4587e7532374242d591c3ce79024730a60b7e1f4dfb294bf`
- `openspec/archive/agent-skill-registry-discovery/state.yaml` — SHA-256 `820fea5c68a05ce4aafaec557f95ebae387cd5229c95dcdf37d0a74b5d1c594a`

### Runtime evidence

- `/tmp/deck-tui.log` — SHA-256 `5b747d3561616442695d7b7e66db65079aca59ec14c1d197274acc94bf902c41`
- `/tmp/deck-install-debug.log` — SHA-256 `edd1b92946f0e133a2bff476c109afb3f3a28515c6192a00a49e34c2e0de36e0`

### Current source/test evidence

- `packages/adapter-opencode/src/required-tools.ts:27-103`
- `packages/adapter-opencode/src/capability-catalog.ts:61-152`
- `packages/adapter-opencode/src/installation-plan.ts:28-58`
- `packages/adapter-opencode/src/capability-plan.ts:134-328`
- `packages/adapter-opencode/src/install-tools.ts:70-170`
- `apps/cli/src/tui/app.tsx:969-1225`
- `apps/cli/src/tui/runner-dashboard/action-runner.ts:119-344,850-882`
- `apps/cli/src/tui/screens/runner-dashboard-screens.tsx:258-304`
- `packages/adapter-opencode/src/required-tools.test.ts:4-65`
- `packages/adapter-opencode/src/install-tools.test.ts:7-197`
- `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts:30-229`
- `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx:207-324`

## Registry Coordination

- **Ordered RegistryIntentV1 values:** `[]`
- **Reason:** This is a new change and no authoritative `state.yaml` / `events.yaml` base pair exists under `openspec/changes/opencode-package-install-running-binary-regression/`. This specialist is prohibited from creating or updating those centralized registry files. A valid digest-bound `RegistryIntentV1` cannot be constructed without the authoritative base pair.
- **Coordinator action:** Bootstrap or read the authoritative registry pair, validate this artifact digest, then construct/rebase and serialize the Explore completion intent atomically. Stop on conflict or recovery-required outcomes.

## Blockers

1. Registry serialization is blocked on coordinator-owned creation/read of the new change's authoritative `state.yaml` and `events.yaml` pair.
2. Proposal must resolve whether runner setup includes upgrades; without that decision, “skip existing” versus “replace existing” cannot be specified completely.
3. A true active-session forced reinstall remains dependent on a published upstream release containing the transactional activation behavior; current latest release v0.9.0 remains affected.
