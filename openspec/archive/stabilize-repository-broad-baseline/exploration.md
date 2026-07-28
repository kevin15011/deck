# Exploration — stabilize-repository-broad-baseline

## Phase result

- **Phase:** Explore
- **Status:** Complete
- **Recommendation:** Proceed to Proposal as one bounded baseline-stabilization change, decomposed into independent repair tasks by failure class.
- **Implementation authorization:** None. This artifact does not authorize source, test, ledger, registry, or lifecycle-state modification.
- **Parent dependency:** `streamline-orchestrator-ownership-and-acceptance` remains `verify / failed` until this separate change is implemented, independently verified, reviewed, and its mandatory repository-wide BROAD gate is green.

## Question and scope

Investigate the smallest durable repair for the seven failures observed during the parent change's mandatory `bun test --timeout 30000` run, without:

- weakening assertions or treating timeouts as success;
- skipping or waiving mandatory BROAD;
- depending on arbitrary timeout inflation;
- performing network access or installation in tests;
- changing the accepted 17-file parent candidate;
- touching `runner-capability-standardization` or unrelated work;
- expanding into `deck-onboard`.

The candidate areas supplied for exploration were treated as investigative leads, not as an approved implementation allowlist.

## Authority and provenance

### Official context

- Repository HEAD observed by the code graph and Git: `552172640f3b4172e6a395a8314b3aac0b4d2e20`.
- OpenSpec is initialized: `openspec/config.yaml` has `initialized: true`.
- Parent BROAD evidence: `openspec/changes/streamline-orchestrator-ownership-and-acceptance/verify-report.md` records `3997 pass`, `7 fail`, `4004 tests across 222 files`, command `bun test --timeout 30000`, and output digest `sha256:32acba62d480348bdb2083d2762f79f3fbe1894979316e6cfc002260d203bc5a`.
- Parent candidate identity is supplied and authoritative for this exploration: HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`, subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`, binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`.
- Current worktree evidence showed the 17 parent candidate files, two unrelated WIP registry files under `opencode-package-install-running-binary-regression`, and the untracked parent change directory. None of the investigated failure sources was among the 17 candidate files.

### Adaptive context

Adaptive memory was loaded as advisory context. It was consistent with the official parent failure diagnosis for stale documentation, Pi host sensitivity, and CLI load sensitivity, but it did not grant scope or alter any conclusion.

### Skill discovery

- Registry context: `.atl/skill-registry.md`.
- Status: `indeterminate`.
- Reason: `validate_command_returned_unexpected_interactive_menu`.
- Active runner: `opencode`.
- Authority reminder: `v1`.
- No registry revalidation, refresh, or write was performed. Bounded active-runner discovery loaded only `deck-developer-explorer`, `using-agent-skills`, and `debugging-and-error-recovery`.

## Verified root-cause map

| Failure class | Verified cause | Smallest durable repair | Classification |
|---|---|---|---|
| Documentation governance | `docs/architecture.md:25` links to `../openspec/changes/agent-skill-registry-discovery/{spec,design}.md`, while both maintained targets now exist under `openspec/archive/agent-skill-registry-discovery/`. Git history identifies commit `3b5b22d9a47e79471c9a9f1e378ff427d85abf10` as the link introduction. | Retarget both relative links to the archived files. Do not change the governance test. | Documentation-only. |
| Pi Serena install tests | `installPiTools` accepts an injected `runInstallCommand`, but `dispatchInstallByKind` calls `installSerena()` without it. `installSerena()` calls real `checkSharedBinaryUsability("serena")`, with up to two 5-second healthchecks, and then real `runDefaultInstallCommand` for `uv`/`pipx`. The tests therefore describe mocks they do not actually control and permit host-dependent outcomes. | Add a backward-compatible, defaulted dependency seam that carries both install-command execution and shared-binary usability through `installPiTools` → dispatch → `installSerena`/shared-binary handling. Use exact fixture outcomes in tests; remove ambiguous acceptance such as “manual-verified or reused.” | Production dependency seam plus tests. Runtime defaults and public call behavior remain unchanged. |
| OpenCode discovery TUI | The local `flush()` is a fixed 50 ms sleep. It does not prove that React effects, Ink commit, stdout flush, or the expected state transition completed. `press()` then calls `instance.waitUntilRenderFlush()` without a deadline. Ink 7.0.4 can wait for a next concurrent render and for a stdout write callback; either can remain pending under contention. | Replace fixed success sleeps with a state/predicate-driven wait that observes expected output and uses Ink render flush as a signal. Bound the whole wait with a hard deadline and diagnostic failure. Wrap generic press flushes in the same bounded primitive. Always unmount in `finally`. | Test-only harness repair. No `DeckApp` behavior change is indicated. |
| Binary smoke | `runDeckCommand` launches nested `bun run`, defaults to a hard 5-second subprocess cap, calls `proc.kill()` without the promised explicit SIGKILL/process-group contract, resolves timeout before awaiting exit or stream completion, and allows background completion to continue. The version test hit this cap under BROAD. Doctor and upgrade currently accept code `124`, so timeout is treated as success rather than evidence of usable CLI behavior. | Use a deterministic local release fixture in child environments, invoke the current Bun executable directly, enforce a deadline derived from the repository's 30-second per-test policy with reserved cleanup time, terminate the process tree/platform-equivalent on timeout, await exit and output closure, and fail rather than accept `124`. Assert command-specific output for completed commands. | Test-only subprocess harness repair, with stronger coverage. |
| Doctor diagnostics unit suite | The test mocks runtime and adapter calls but not `runDeckChecks()` or `fetchReleaseDescriptor()`. Every one of 13 unit scenarios therefore repeats real manifest/state/config/PATH work, launches binary `--version` subprocesses through `checkBinaries`, and may execute synchronous release `curl` work through `buildBinaryUpgradeCheck`. The failing unit scenario is not about those integrations. | Add a small optional/defaulted dependency object to `runDoctorDiagnostics`/`buildBinaryUpgradeCheck` for `runDeckChecks` and release-descriptor retrieval. Unit tests provide deterministic results. Keep real doctor-check coverage in `doctor-checks.test.ts` and one completed binary-smoke doctor path using a local descriptor fixture. | Production dependency seam plus tests. Runtime defaults remain unchanged. |
| Baseline ledger | `openspec/baseline-health.yaml` is a current-state known-failure ledger, not permanent history. It records exactly one known Binary smoke doctor timeout and allows pass-with-warning only when that fingerprint recurs. Its comparison policy defines absence of a recorded failure as `improved`. | After the repair, remove the active doctor fingerprint, set the repository test expectation to pass/zero failures, retain the comparison policy, and note the repaired historical fingerprint in prose if useful. Do not retain `classification: improved` as an active failure. Verify should report the transition as improved. | Conditional maintained-artifact update; required if BROAD is expected green. |

## Detailed findings

### 1. Documentation

This is deterministic, pre-existing, and independent of runtime load. Both target files were confirmed at:

- `openspec/archive/agent-skill-registry-discovery/spec.md`
- `openspec/archive/agent-skill-registry-discovery/design.md`

The smallest repair is exactly two destination changes on the existing architecture line. Moving or duplicating archive artifacts would weaken lifecycle history and is not recommended.

### 2. Pi host detection

The issue is not that production detects the host; production must do so. The issue is that tests cannot replace that detection despite already supplying a command runner. A dependency seam can make tests deterministic without changing runtime behavior:

1. Preserve all existing positional arguments and defaults on exported functions.
2. Add one optional typed dependency parameter/object after existing arguments.
3. Default usability to `checkSharedBinaryUsability` and command execution to the current production runner.
4. Thread those dependencies through private dispatch.
5. In tests, fixture `ready`, `missing`, and `unusable` explicitly and assert exact install attempts and statuses.

This seam should cover all shared-binary/python-tool dispatch tests in the file, not only the two observed failures, because adjacent tests currently also infer host-installed binaries.

### 3. Bounded Ink synchronization

The replacement must distinguish a synchronization bound from a success delay:

- A fixed sleep says “assume success after N ms” and is load-sensitive.
- A bounded predicate wait says “succeed when the expected frame is observable; otherwise fail by a declared deadline.”

Recommended helper properties:

- accepts a description and output predicate/string;
- repeatedly gives Ink a render-flush opportunity;
- races any potentially unbounded Ink wait against the remaining deadline;
- reports the last bounded output on failure;
- is used after initial mount, input, and deferred discovery resolution;
- never catches a timeout and continues as success.

No production TUI change is justified by current evidence: isolated/grouped tests pass and the flaw is in synchronization.

### 4. Binary subprocess semantics

Meaningful smoke coverage requires command completion. Therefore:

- `124` must no longer be accepted for doctor or upgrade;
- the local `release-fixture-no-upgrade.json` path should prevent release network access and installation behavior;
- timeout must trigger cleanup, not immediate test resolution;
- cleanup must await the child/process group and output streams before returning;
- partial stdout/stderr should be preserved in the failure result;
- the timeout budget must be explicitly derived from the mandatory 30-second policy and leave cleanup margin, rather than merely increasing 5 seconds until the test happens to pass.

Platform handling is a design risk. POSIX can use a detached process group and group termination; Windows requires the supported equivalent or a proven direct-child-only structure. If process-tree cleanup cannot be demonstrated, the binary harness repair is blocked.

### 5. Doctor test boundaries

The minimum expensive boundaries are:

- `runDeckChecks` — real filesystem and PATH inspection plus binary version subprocesses;
- `fetchReleaseDescriptor` as consumed by `buildBinaryUpgradeCheck` — real release lookup/curl and possible cache effects.

Injecting these two boundaries is preferable to adding more global `vi.mock` state because the unit file already has multiple module mocks and BROAD sensitivity is the problem being repaired. The zero-argument production call remains valid through defaults. Integration coverage remains in:

- `apps/cli/src/doctor-command/doctor-checks.test.ts` for deck checks;
- `apps/cli/src/upgrade-command/__tests__/github-release.test.ts` fixture scenarios for descriptor parsing/fetch behavior;
- `apps/cli/src/__tests__/binary-smoke.test.tsx` for the assembled CLI doctor path, constrained to a local release fixture.

### 6. One change or several

One coherent change is recommended. The failures have different local causes, but they share one externally verifiable outcome: a deterministic, mandatory repository-wide baseline. Splitting them would leave the parent blocked after every partial change and create ambiguity about when the shared baseline ledger becomes truthful.

The one change should still use separate atomic implementation tasks/batches for documentation, Pi, TUI, binary, doctor, and ledger maintenance. A task must not use success in one class to waive failure in another.

### 7. `deck-onboard`

`deck-onboard` is unrelated. Its implementation/catalog surfaces are outside every failing path, caller trace, and recommended allowlist. It must remain out of scope.

## Recommended Proposal scope

### Exact implementation allowlist

Proposal should authorize no implementation paths beyond these eight:

1. `docs/architecture.md`
2. `packages/adapter-pi/src/install-tools.ts`
3. `packages/adapter-pi/src/install-tools.test.ts`
4. `apps/cli/src/tui/app.opencode-discovery.test.tsx`
5. `apps/cli/src/__tests__/binary-smoke.test.tsx`
6. `apps/cli/src/doctor-command/doctor-diagnostics.ts`
7. `apps/cli/src/__tests__/doctor-diagnostics.test.ts`
8. `openspec/baseline-health.yaml`

Read-only dependencies, not modification targets:

- `tests/documentation-governance.test.ts`
- `packages/core/src/shared-binary-usability.ts`
- `apps/cli/src/doctor-command/doctor-checks.ts`
- `apps/cli/src/doctor-command/doctor-checks.test.ts`
- `apps/cli/src/upgrade-command/github-release.ts`
- `apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-no-upgrade.json`
- Ink runtime/type declarations in the installed dependency tree
- parent change artifacts and candidate files

Normal future OpenSpec artifacts for this new change require their own phase authorization. This Explore phase authorized only this `exploration.md`.

### RED evidence and commands

The parent BROAD report is valid pre-change RED evidence for all seven observed failures and should be bound by digest rather than rerun during Proposal.

During Apply, after adding deterministic expectations but before production seam implementation where applicable, use these focused commands to capture RED:

```bash
bun test --timeout 30000 tests/documentation-governance.test.ts
bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts
bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts
```

For test-harness-only TUI and binary repairs, the authoritative parent BROAD failures are the RED evidence. Do not manufacture timing failures with sleeps or load loops.

### GREEN commands

```bash
bun test --timeout 30000 tests/documentation-governance.test.ts
bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts
bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts
bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx
bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/doctor-command/doctor-checks.test.ts
```

The binary command must run with only local fixture input. A GREEN result that performed release network access is invalid.

### Affected-area checks

```bash
bun test --timeout 30000 packages/adapter-pi/src
bun test --timeout 30000 tests/documentation-governance.test.ts apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts apps/cli/src/__tests__/binary-smoke.test.tsx apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/doctor-command/doctor-checks.test.ts
bunx tsc --noEmit
```

After Proposal, Spec, Design, Tasks, Apply, independent targeted/affected Verify, and fresh Review succeed, independent Verify must run the mandatory BROAD command once:

```bash
bun test --timeout 30000
```

No pass-with-warning is expected after this repair. Any failure remains blocking. OpenSpec validation for this change and diff/allowlist hygiene are also mandatory before closure.

## Acceptance characteristics Proposal should preserve

1. The documentation governance test passes because links resolve, not because the test excludes them.
2. Pi install tests are invariant to whether Serena, uv, pipx, RTK, context-mode, or codebase-memory are installed on the host.
3. Pi production calls retain current host detection and install semantics when no test dependency is supplied.
4. TUI tests synchronize on observable terminal states and have bounded failure; no fixed success sleep remains in this file.
5. Binary smoke tests complete their child commands, reject timeout code `124`, use no network, and leave no child or descendant process.
6. Doctor unit tests execute no real release lookup or binary healthcheck subprocess.
7. Doctor integration remains covered by dedicated doctor-check tests and the completed CLI smoke path.
8. The ledger contains no active known-failure fingerprint after a green repaired baseline.
9. The parent 17-file candidate remains byte-identical.
10. `deck-onboard`, `runner-capability-standardization`, generated output, global config, and unrelated WIP remain untouched.

## Rollback

Rollback should be path-bounded and non-destructive:

- restore the two architecture links to their prior destinations only if the archive lifecycle is separately reversed;
- remove the optional dependency parameters and corresponding deterministic fixtures together;
- restore the prior TUI/binary test harness only if a replacement bounded synchronization/cleanup strategy is approved;
- restore the ledger fingerprint only if a fresh mandatory BROAD run reproduces that exact failure again.

No Git discard command is part of rollback. Any rollback must be implemented as an explicit forward edit under separate authorization.

## Risks and hard stops

### Risks

- A broad dependency object could become a test-only service locator. Keep each seam minimal, typed, optional, and defaulted beside the function that owns the side effect.
- Predicate waits can produce false positives if they match stale historical terminal output. Predicates must identify the intended post-action state and, where needed, compare output captured after an action boundary.
- Process-group behavior differs across operating systems. Cleanup claims require platform-aware evidence.
- A local release fixture could accidentally describe an upgrade and trigger installation flow. Use the existing no-upgrade fixture and assert no install/network path.
- Updating the ledger before BROAD can make it aspirational. Verify must treat any fresh failure as blocking and must not use the new pass expectation to waive it.
- Global Bun module mocks may leak across tests. Prefer explicit function dependencies for the two expensive doctor boundaries.

### Hard stops

- Stop if any implementation path outside the eight-file allowlist is required; return to Proposal/Design for scope approval.
- Stop if a test reaches network, runs an install, writes global/user config, or depends on host-installed tools.
- Stop if any timeout or render deadline is converted into an accepted result.
- Stop if process timeout cleanup cannot prove child termination and stream closure.
- Stop if the parent candidate identity changes or unrelated WIP is modified.
- Stop on any mandatory focused, affected, typecheck, OpenSpec, Review, or BROAD failure.
- Never touch `runner-capability-standardization`.

## Assumptions

1. The supplied parent BROAD log and isolated/grouped diagnosis remain fresh enough to serve as RED evidence; this phase intentionally did not rerun BROAD.
2. The existing no-upgrade release descriptor fixture remains valid and local during implementation.
3. Adding optional/defaulted parameters to exported functions is acceptable only if TypeScript and caller checks prove existing calls unchanged.
4. The baseline ledger is maintained current state; historical details belong in change/verify artifacts rather than active failure fingerprints.

## Open decisions for Proposal/Design

1. Choose the exact typed shape/name of the Pi dependency object while preserving all existing call forms.
2. Choose the exact doctor dependency shape: the minimum recommended members are `runDeckChecks` and release-descriptor retrieval.
3. Define the platform-specific process-tree termination mechanism and the cleanup margin reserved inside the 30-second test policy.
4. Define TUI predicates carefully enough to exclude stale output while avoiding production changes.
5. Decide whether the ledger's fresh pass count should be recorded only after Verify or omitted as volatile; zero failures and absence of fingerprints are the required semantic state.

## Confidence

- **Root-cause confidence:** High for documentation, Pi, TUI synchronization, binary timeout cleanup, and doctor side effects; each is directly evidenced by source and caller traces.
- **Recommended-scope confidence:** High. The eight files contain all required change points, and related production boundaries can remain read-only.
- **Cross-platform subprocess design confidence:** Medium until the chosen process-group implementation is exercised on supported platforms.
- **Ledger representation confidence:** Medium-high. The current schema explicitly defines `improved`, but it has no prior example of a fully green repository entry.

## Evidence references

- `openspec/config.yaml`
- `openspec/baseline-health.yaml`
- `openspec/changes/streamline-orchestrator-ownership-and-acceptance/verify-report.md`
- `docs/architecture.md:25`
- `openspec/archive/agent-skill-registry-discovery/spec.md`
- `openspec/archive/agent-skill-registry-discovery/design.md`
- `packages/adapter-pi/src/install-tools.ts` — `installPiTools`, `dispatchInstallByKind`, `installSerena`, `installSharedBinary`, `runDefaultInstallCommand`
- `packages/adapter-pi/src/install-tools.test.ts`
- `packages/core/src/shared-binary-usability.ts` — `checkSharedBinaryUsability`
- `apps/cli/src/tui/app.opencode-discovery.test.tsx` — `flush`, `mountDiscovery`
- Ink 7.0.4 installed declarations/implementation — `waitUntilRenderFlush`
- `apps/cli/src/__tests__/binary-smoke.test.tsx` — `runDeckCommand`
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` — `runDoctorDiagnostics`, `buildBinaryUpgradeCheck`
- `apps/cli/src/doctor-command/doctor-checks.ts` — `runDeckChecks`, `checkBinaries`
- `apps/cli/src/__tests__/doctor-diagnostics.test.ts`
- `apps/cli/src/upgrade-command/github-release.ts` — `fetchReleaseDescriptor`

## Blockers

- No blocker to Proposal.
- Implementation remains unauthorized.
- The parent remains blocked until this change completes and a fresh mandatory BROAD run is green.

## Registry intent

No `RegistryIntentV1` is produced. Registry documents for this new change do not exist, and centralized registry history must not be invented during Explore.
