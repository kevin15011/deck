# Design: Stabilize the Repository BROAD Baseline

## Phase and authority

- **Change:** `stabilize-repository-broad-baseline`
- **Phase:** Design
- **Status:** Complete and reconciled with corrected Spec `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c`; ready for Tasks
- **Classification / mode:** Run SDD / Interactive
- **Risk:** Medium, primarily because descendant-process cleanup differs by operating system
- **Approved boundary:** the eight paths in the approved Proposal, and no others
- **Proposal approval decision:** `sha256:699b31b4fb51c700b1af7c5798c9e072126952e0a625b6545302cfeb265bff37`
- **Registry base supplied for final reconciliation:** state `sha256:77e75e31403ce2e560592e3df743b1b02f041526f20200873d5c8687200ad6b4`; events `sha256:c14a18b11f5f0c3a6cfef871d4c7c9abfc8f9304560926b5da7a8f3c37c45a00`
- **Implementation authority:** None. This artifact defines the implementation approach; it does not authorize source, test, ledger, registry, parent-change, or generated-output edits.

The initial Design was produced independently from the concurrent Spec. This revision reconciles all 34 requirements and 50 unique scenarios against the approved Proposal, Explore, current source/tests, baseline ledger, and parent BROAD report. The corrected Spec's capability totals match its materialized requirements and scenario rows without changing behavior or acceptance semantics. A new required path or requirement outside the approved Proposal remains an ambiguity stop, not permission to expand this Design.

## Goals and invariants

The smallest durable solution repairs the seven observed failures while retaining what mandatory BROAD proves.

1. Existing production calls, defaults, and result unions remain valid when no dependency override is supplied; the sole result-semantic correction is the Spec-mandated fail-closed outcome when a post-install Serena probe explicitly reports `unusable`.
2. Unit and harness tests do not use release network access, real installs, host-installed Serena/uv/pipx outcomes, user/global configuration, or generated-output writes.
3. A fixed delay, an unbounded Ink flush, subprocess code `124`, a dangling process, or a pass-with-warning ledger entry is never success evidence.
4. The repository-wide timeout policy remains `30_000` ms per test. Local helper deadlines reserve cleanup and diagnostic time within that policy rather than inflating it.
5. The parent `streamline-orchestrator-ownership-and-acceptance` candidate remains byte-identical at 17 files, HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`, subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`, and binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9` unless a separately authorized parent lifecycle action later supplies a fresh identity.
6. `runner-capability-standardization`, `deck-onboard`, unrelated WIP, archived history, generated files, dependencies, and registry YAML are outside this implementation.

## Spec reconciliation

All 34 requirements and 50 unique scenarios across the nine capability groups are covered. The requirement text and scenario tables are normative. Where the Spec's explanatory diagram shows only one BROAD after Review and before the ledger, REQ-LED-001 and REQ-LED-004 plus the approved ordering govern: Apply-local full-suite green first, ledger update second, then fresh independent targeted/affected/Review/final BROAD. A ledger entry never waives a failing final BROAD.

| Capability | Requirements / scenarios | Design anchors | Reconciliation |
|---|---:|---|---|
| Architecture Link Governance | 2 / 3 | AD-1; focused governance test; eight-path audit | Covered without governance-test edits. |
| Pi Serena Installer Behavior | 4 / 7 | AD-2; exact probe/install table; focused Pi/typecheck gates | Covered; existing four-position call form retained and post-install `unusable` is fail-closed. |
| OpenCode Discovery TUI Synchronization | 4 / 5 | AD-3; action boundary, absolute deadline, diagnostics, async cleanup | Covered; only fresh post-action output can satisfy success. |
| Binary Smoke Execution | 5 / 8 | AD-4; 20-second command/4-second cleanup budgets; local sandboxes; lifecycle oracles | Covered; every real CLI smoke exits zero and `124` is failure-only evidence. |
| Doctor Diagnostics Unit Isolation | 4 / 8 | AD-5; four proven dependency boundaries; retained integration suites | Covered with no real unit filesystem, PATH, subprocess, or release lookup. |
| Repository-Wide BROAD Pass | 4 / 5 | Apply-local full suite; independent final BROAD/typecheck/hygiene | Covered; zero failures, no unexpected writes, and no dangling processes are mandatory. |
| Baseline Ledger Transition | 5 / 7 | AD-6; sequence diagram; final-QA order | Covered in the required green → ledger → independent BROAD order. |
| Parent Change and Scope Protection | 3 / 4 | invariants; identity checks; rollout/hard stops | Covered; parent remains byte-identical and blocked until closure. |
| Rollback | 3 / 3 | rollback section; eight-path hard stop | Covered through separately authorized forward edits only. |

The five Spec open questions are resolved:

| Open question | Resolution |
|---|---|
| OQ-1 | `PiToolInstallDependencyOverrides` in the existing fourth position, with an exact retained function-runner overload; no fifth positional argument. |
| OQ-2 | `DoctorDiagnosticsDependencies` has the two required expensive boundaries plus only the two additional filesystem/PATH boundaries proven necessary by REQ-DOC-003. |
| OQ-3 | POSIX detached process group with TERM/KILL escalation; Windows ancestry plus absolute `taskkill /T /F`; 20-second command, 250 ms grace, 4-second cleanup. |
| OQ-4 | Capture an output-length boundary before each action and match state-specific text only in the post-boundary slice under one absolute deadline. |
| OQ-5 | Record the exact fresh pass count only if the complete Apply-local summary is unambiguous; otherwise omit `passed`. Always record `failed: 0` and no active fingerprint. |

Reconciliation corrected four initial Design mismatches: it removed the fifth Pi positional argument, made post-install Serena `unusable` fail closed, required exit zero for every real CLI smoke, and expanded doctor unit injection only enough to eliminate the remaining real filesystem/PATH reads. No scope path changed.

## Current and proposed boundaries

| Area | Current boundary and failure | Proposed boundary |
|---|---|---|
| Architecture links | `docs/architecture.md` points at active-change paths that no longer exist. | Change only the two link destinations to the maintained archive. Keep the governance test unchanged. |
| Pi install dispatch | `installPiTools` injects only its command runner; shared-binary and Serena paths bypass it and perform real host probes and uv/pipx attempts. | Preserve the existing fourth-position function-runner form and add a same-position typed object overload, resolve one private complete dependency set, and thread it through private dispatch/workers. Keep direct exported helper signatures and default behavior stable. |
| OpenCode discovery composition test | A 50 ms sleep is treated as progress, accumulated output can satisfy stale assertions, and `waitUntilRenderFlush()` can wait without a deadline. | Replace the local sleep with action-boundary, fresh-output predicates and a bounded Ink-render wait. Keep `DeckApp` unchanged. |
| Binary smoke | Nested `bun run` adds a process, a 5 second cap is too small under BROAD, timeout resolves before reaping/stream EOF, and two tests accept `124`. | Invoke the current Bun executable directly; use a structured bounded lifecycle; isolate release inputs; clean the process tree on every outcome; return only after exit and stream closure; reject `124` in real CLI smokes. |
| Doctor diagnostics | Thirteen unit scenarios still reach `runDeckChecks()`, release lookup, PATH/filesystem memory probes, and the user's OpenCode config despite mocking unrelated adapters. | Inject the four proven boundaries—`runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection`—through one optional/defaulted internal object. Keep dedicated integration coverage real. |
| Baseline ledger | The repository test entry records one active known timeout and permits warning-based acceptance. Counts and command text predate the current BROAD evidence. | After an Apply-local green full suite, record an improved/pass current state with zero failures and no active fingerprint; then require fresh independent final QA, including mandatory BROAD. |

Read-only dependencies remain `tests/documentation-governance.test.ts`, `packages/core/src/shared-binary-usability.ts`, doctor-check and release-descriptor source/tests/fixtures, installed Ink/Bun declarations, and parent artifacts. Evidence does not justify modifying any of them.

## Architecture decisions

### AD-1 — Correct the archive links, not governance or history

On the existing architecture sentence, replace both destinations:

- `../openspec/changes/agent-skill-registry-discovery/spec.md` → `../openspec/archive/agent-skill-registry-discovery/spec.md`
- `../openspec/changes/agent-skill-registry-discovery/design.md` → `../openspec/archive/agent-skill-registry-discovery/design.md`

The labels, surrounding architecture explanation, archived artifacts, and `tests/documentation-governance.test.ts` remain unchanged. Copying archive files back into active changes or excluding the links from validation would falsify lifecycle ownership.

### AD-2 — Resolve Pi dependencies through the existing fourth position

Do not add a fifth positional parameter. Preserve the current fourth-position function-runner call exactly and add a same-position object overload for the complete test seam. Use these internal contracts (names and members are fixed; they need not be re-exported):

```ts
type SharedBinaryUsabilityProbe = typeof checkSharedBinaryUsability;

type PiToolInstallDependencies = Readonly<{
  runInstallCommand: RunInstallCommand;
  checkSharedBinaryUsability: SharedBinaryUsabilityProbe;
  sharedBinaryUsabilityTimeoutMs: number;
}>;

type PiToolInstallDependencyOverrides = Readonly<
  Partial<PiToolInstallDependencies>
>;
```

The overloads and implementation input are fixed conceptually as follows:

```ts
export function installPiTools(
  command: string | undefined,
  plan: InstallablePiTool[],
  onResult: (result: PiToolInstallResult) => void,
  runInstallCommand?: RunInstallCommand,
): Promise<PiToolInstallResult[]>;

export function installPiTools(
  command: string | undefined,
  plan: InstallablePiTool[],
  onResult: (result: PiToolInstallResult) => void,
  overrides?: PiToolInstallDependencyOverrides,
): Promise<PiToolInstallResult[]>;

// Implementation input only; resolve immediately and do not expose a fifth slot.
RunInstallCommand | PiToolInstallDependencyOverrides | undefined
```

When the fourth value is a function, resolve it as `runInstallCommand` with the production probe and `5_000` ms timeout. When it is an object, nullishly fill all three members from production defaults. When omitted, dependency selection and command/probe sequencing are identical to the current production call. Thread the complete `PiToolInstallDependencies` through `dispatchInstallByKind` and private dependency-aware shared-binary/Serena workers. Keep exported `installSharedBinary(capabilityId, command, installFn)` and `installSerena()` as production-default wrappers with their existing signatures. Do not add a module-global setter, environment switch, `if (test)` branch, fifth argument, or alternate test-only behavior. The explicit post-install `unusable` branch is the one narrow semantic correction required by PI-001-S3; it applies equally to default and injected dependencies and does not change the result union.

Every probe receives `healthcheckArgs: ["--version", "--help"]` and the resolved timeout. The resolved command runner is the sole uv/pipx availability and execution boundary: thrown spawn errors or nonzero results mean that installer attempt is unavailable/failed. Do not add a second PATH probe.

Result semantics are exact:

| Serena observation | Commands | Result |
|---|---|---|
| initial `ready` | none | `reused`, success |
| initial `unusable` | none | `blocked`, failure |
| initial `missing`; uv exits zero; recheck `ready` | exactly `uv tool install serena` | `installed`, success |
| initial `missing`; uv unavailable/nonzero; pipx exits zero; recheck `ready` | uv then exactly `pipx install serena` | `installed`, success |
| initial `missing`; an installer exits zero; its recheck is `unusable` | attempted installer(s) only | `blocked`, failure; never `manual-verified` |
| initial `missing`; neither uv nor pipx executes successfully and no probe reports `unusable` | uv then pipx | existing `manual-verified`, success |

If a successful uv attempt rechecks as still `missing`, the existing pipx fallback may continue; any later explicit `unusable` result remains fail-closed. Shared-binary status mapping and Pi/npm package command/error behavior otherwise remain unchanged. Tests fixture every probe sequence and command result, assert exact calls/status/success, and never infer readiness from the host. The existing function-form fourth argument receives a compatibility test, and the prior ambiguous `manual-verified`-or-`reused` assertion becomes one exact fixture outcome.

### AD-3 — Synchronize the TUI test on fresh output under one absolute deadline

Keep all new helpers in `app.opencode-discovery.test.tsx`. Use these test-local concepts:

```ts
type OutputPredicate = (freshOutput: string, completeOutput: string) => boolean;

type OutputExpectation = Readonly<{
  description: string;
  boundary: number;
  predicate: OutputPredicate;
  timeoutMs?: number;
}>;
```

Set `RENDER_WAIT_TIMEOUT_MS = 5_000`. This is a synchronization ceiling, not a success delay: it is one sixth of the mandatory 30 second test budget and leaves at least 25 seconds for unmount and diagnostics if a transition never occurs.

The helper algorithm is fixed:

1. Capture `boundary = harness.output().length` immediately before the action.
2. Perform the input or deferred-resolution action.
3. Check only `harness.output().slice(boundary)` for the expected new frame. A pre-boundary match cannot satisfy the predicate.
4. Until the same absolute deadline, call `instance.waitUntilRenderFlush()` and race that promise against the remaining deadline. Recheck the fresh slice after each resolved flush. Never launch an unbounded flush and never treat a deadline as success.
5. On timeout, throw a message containing the expectation description, timeout, boundary, a capped fresh-output tail, and a capped complete-output tail. Cap each diagnostic tail at 2 KiB.

`press` must require an expectation instead of performing a generic sleep. Navigation in `mountDiscovery` observes, in order, a fresh home/menu frame, cursor redraws, `Select which runner/environment owns the model configuration.`, the OpenCode selection frame, `Select which team you want to configure for opencode-development.`, and finally `Reading models from OpenCode`. Deferred discovery actions use state-specific fresh predicates such as `request B`, `Select an agent to configure`, `OpenCode reported no available models.`, `Last known OpenCode models`, and `OpenCode model discovery is unavailable.`

The out-of-order request test treats the two actions separately: it first proves `request B` from B's post-action segment; after resolving older request A it performs a bounded render settlement and asserts that A is absent. It must not reuse an old `request B` match as evidence that A was handled correctly.

Return an async cleanup function from `mountDiscovery`. Every test calls it in `finally`; cleanup unmounts, bounds `waitUntilExit()`, removes the Ink instance, and closes/destroys harness streams/listeners. A cleanup deadline is a test failure. Current evidence does not justify a production `DeckApp` change.

### AD-4 — Make Binary smoke a structured subprocess lifecycle

Keep the subprocess helpers and lifecycle fixtures in `binary-smoke.test.tsx`; create no new file. Split a generic test-local command runner from the `runDeckCommand` wrapper. Use these constants:

```ts
const COMMAND_TIMEOUT_MS = 20_000;
const TERMINATION_GRACE_MS = 250;
const CLEANUP_TIMEOUT_MS = 4_000;
```

Twenty seconds retains the existing doctor/upgrade command allowance but applies it consistently to the direct process. Four seconds are reserved for forced cleanup and stream EOF, leaving at least six seconds inside the 30 second test budget for assertions and test-runner overhead. Increasing the test budget is not part of this design.

The result contract is test-local and completion-oriented:

```ts
type DeckCommandResult = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cleanupConfirmed: true;
}>;
```

`cleanupConfirmed: true` is returned only after root exit, stdout EOF, stderr EOF, and platform cleanup confirmation. Cleanup failure rejects the helper; it is never converted to a command result.

#### Launch and isolation

- Invoke `[process.execPath, "apps/cli/src/main.tsx", ...args]`; remove nested `bun run` and shell lookup.
- Use repository root as `cwd`, piped stdout/stderr, and ignored stdin.
- Build a minimal child environment: a per-test fixture `bin` directory before the current Bun directory in `PATH`; temporary `HOME`/`USERPROFILE`, XDG config/state/cache, and temp roots; platform-required `SystemRoot`/`ComSpec` on Windows; locale variables; `NO_COLOR=1`; and an absolute `DECK_RELEASE_CHECK_FIXTURE`. Do not forward credentials or unrelated user configuration.
- The fixture `bin` contains platform-appropriate deterministic executable shims for every binary required by doctor (`deck`, `opencode`, `pi`, `engram`, `supermemory`, and `serena`) plus a harmless installed runtime candidate. Each shim accepts only the version/package-inspection calls exercised by current diagnostics and emits the exact minimal fixture output; an unexpected invocation exits nonzero. Use the existing adapter test fixtures as the output authority. The test must not consult host PATH entries or run a real install.
- Seed only sandbox-local doctor inputs: an empty valid Deck manifest, readable config/state roots, deterministic OpenCode MCP configuration, and a valid Pi Supermemory MCP entry with a non-secret fixture header. The doctor child uses `release-fixture-no-upgrade.json`, exits `0`, and renders `Doctor Report`. Warnings are acceptable only when `hasCriticalErrors` remains false; missing fixture setup must fail the smoke rather than broaden PATH to the host.
- The upgrade child uses a test-created, schema-valid descriptor whose version/tag match `getBuildInfo().version` and whose `items` array is empty. Current source does not compare versions before staging/workflow, so the existing “no-upgrade” fixture is unsafe here because it contains a Linux binary item. The empty descriptor allows real dispatch/orchestration to complete with exit `0` while making binary download/replacement and runner-content installation impossible. All staging, backup, state, manifest, and history metadata must remain under the disposable XDG roots; assert that no payload/download/content output exists and no path outside the sandbox changes. No production upgrade source or maintained fixture change is authorized.
- Version and non-TTY TUI smokes remain real CLI entry-point executions and also receive a local fixture environment. None builds generated output, reaches release network, installs content, or writes user/global configuration.

#### Exit, timeout, streams, and cleanup

Start exit and both stream pumps immediately. Accumulate partial output while reading; do not wait to start a stream read until after exit. Race normal completion against the command deadline.

- On normal exit (`0` or nonzero), clear the command timer, perform the process-tree check/cleanup, and await both stream EOFs before returning the actual code.
- On timeout, set `timedOut: true`, terminate the tree, await root exit and both stream EOFs inside `CLEANUP_TIMEOUT_MS`, then return code `124` with captured partial output and a diagnostic. Every real CLI smoke explicitly requires `timedOut === false`, `cleanupConfirmed === true`, and `code === 0` before checking command-specific output.
- Code `124` is expected only in the dedicated short-deadline cleanup oracle. That oracle proves timeout classification and reaping; it is not accepted as CLI success.

On Linux/macOS, launch with `detached: true` so the child is its process-group leader. Probe/terminate `-pid`: `SIGTERM`, a 250 ms grace, then `SIGKILL` if the group remains. Confirm `ESRCH` for the group before returning; ignore only already-gone races, not permission or unknown errors.

On Windows, do not detach, preserving the process ancestry used by `%SystemRoot%\System32\taskkill.exe /PID <pid> /T /F`. Await `taskkill`, root exit, and stream EOF. A nonzero cleanup result is acceptable only when the root is already absent and every PID explicitly emitted by a lifecycle fixture is also absent; otherwise fail. The test file adds inline Bun scripts that spawn a long-lived descendant and cover parent success, parent nonzero failure, and timeout. Each script emits the descendant PID; after the helper settles, `process.kill(pid, 0)` (or its thrown not-found result) must prove that PID is gone. These are local test fixtures, not replacement smoke tests.

This supports descendants that stay in the Deck command's POSIX group or Windows ancestry. It does not claim control over a malicious process that deliberately re-sessions/reparents itself. Deck commands under test have no such daemon contract. If the lifecycle fixtures cannot prove cleanup on a platform where this suite is required, implementation stops; it must not add a platform skip or claim unsupported guarantees. The current release matrix builds Linux and macOS binaries; Windows behavior remains implemented and fail-closed rather than falsely labeled verified.

Real smoke assertions remain command-specific:

- `version`: exit `0` and version/commit/date/target/channel fields;
- `doctor`: exit `0` and a rendered Doctor report;
- no-argument non-TTY TUI: exit `0` and nonempty screen output;
- `upgrade` with the valid empty local descriptor: exit `0`, `Upgrade to <fixture-version> completed.`, and no binary/content payload side effect.

### AD-5 — Inject the four proven doctor boundaries

Two direct calls and two private helpers account for the remaining real unit side effects. Use one optional/defaulted internal object in `doctor-diagnostics.ts`:

```ts
type DoctorDiagnosticsDependencies = Readonly<{
  runDeckChecks: typeof runDeckChecks;
  fetchReleaseDescriptor: typeof fetchReleaseDescriptor;
  memoryBinaryAvailable: typeof memoryBinaryAvailable;
  readOpenCodeMcpSection: typeof readOpenCodeMcpSection;
}>;

const defaultDoctorDiagnosticsDependencies: DoctorDiagnosticsDependencies = {
  runDeckChecks,
  fetchReleaseDescriptor,
  memoryBinaryAvailable,
  readOpenCodeMcpSection,
};

export async function runDoctorDiagnostics(
  overrides: Partial<DoctorDiagnosticsDependencies> = {},
): Promise<DoctorDiagnosticsResult>
```

Resolve each member once with nullish fallback to its production default. Pass the resolved functions explicitly into private `checkMemoryProviders`, `checkOpenCodeMcp`, and `buildBinaryUpgradeCheck`; call the resolved deck-check function in step 5. Do not inject runtime detection, build info, XDG paths, adapter checks, redaction, or clocks: the existing test-local adapter/runtime mocks already own those concerns, and current source evidence proves no additional unmocked unit side effect.

The zero-argument CLI/TUI calls retain current behavior and error mapping. `runDeckChecks` rejection still becomes the existing redacted `Deck Checks` category. Descriptor return variants and thrown errors still produce the existing binary-upgrade reasons. The two new helper boundaries preserve the current PATH lookup and OpenCode-file parsing by default. No CLI output or exit contract changes.

The unit test defines one local dependency factory with deterministic defaults for all four members:

- an async deck-check stub returning `deck`, `binary`, and `runnerConfig` arrays;
- a local descriptor stub returning a typed non-upgrade/error variant;
- a binary-availability stub keyed by command; and
- an OpenCode MCP-section stub returning a local object or `null`.

Every unit scenario supplies the factory result, overrides only the branch it exercises, and asserts the relevant calls. No scenario writes `/tmp`, mutates `PATH`, reads the user's home, invokes a subprocess, or performs release/network lookup. Remove the `/tmp/engram` and PATH-mutation setup rather than wrapping it in broader mocks. Existing adapter/runtime mocks remain limited to their current concerns. Real behavior remains covered by `apps/cli/src/__tests__/doctor-checks.test.ts`, GitHub release tests, and the completed local-fixture Binary doctor smoke.

### AD-6 — Treat the ledger transition as evidence, not a waiver

The ledger update is the last Apply edit and has a two-step prerequisite:

1. With source/tests repaired but the ledger still recording the old failure, Apply runs focused/grouped checks, typecheck, and then a local full `bun test --timeout 30000`. Any failure or timeout stops; the ledger is not edited.
2. Only after exit `0`, update `repo-bun-test` to current `status: pass`, `failed: 0`, and no `fingerprints` key/list. The old timeout's disappearance is an `improved` comparison result; `improved` is not retained as an active failure classification.

Ledger field rules:

- Set `command` and the sole `source_commands` entry to the exact evidence command, `bun test --timeout 30000`.
- Set `captured_at`, top-level `updated`, and `source` to the actual Apply-local evidence date/source.
- Record `passed` only when the complete Bun summary provides one unambiguous count; use that exact observed value. If output is incomplete or count extraction is ambiguous, omit `passed` rather than copying `3997`, predicting the post-change total, or retaining `3296`.
- Keep `failed: 0` because exit-zero full-suite evidence and the complete summary must agree; a mismatch blocks the update.
- Remove the active Binary smoke fingerprint and known-failure-only reproduction text. A bounded note may identify the prior fingerprint as repaired and the transition as improved, but it must state that independent final QA remains required.
- Refresh the typecheck capture date/note only from the actual Apply-local `bunx tsc --noEmit` result; keep `error_count: 0` only when observed.
- Leave focused-command counts untouched unless those exact commands were freshly run and their counts were captured without ambiguity.
- Preserve the comparison schema. Change policy prose to “no active known repository test failures” and make every new failure blocking; do not preserve a pass-with-warning route for this gate.

The ledger does not make Apply evidence independent. After the ledger edit, a fresh Verify instance reruns targeted and affected checks, a fresh Review judges the candidate, and a fresh final Verify runs mandatory BROAD. Any final failure blocks and requires truthful ledger reconsideration; the pass entry cannot waive it.

## Data and control flow

```mermaid
sequenceDiagram
    participant A as Apply specialist
    participant L as Baseline ledger
    participant V as Independent Verify
    participant R as Independent Review
    participant P as Parent change

    A->>A: Capture per-class RED and focused GREEN
    A->>A: Run grouped checks and typecheck
    A->>A: Run local bun test --timeout 30000
    alt Local full suite fails or times out
        A-->>L: Leave known-failure entry unchanged
        A-->>P: Parent remains blocked and byte-identical
    else Local full suite exits 0
        A->>L: Record improved/pass, exact count if unambiguous, zero failures
        V->>V: Fresh targeted and affected-area checks
        R->>R: Fresh architecture/security/quality review
        V->>V: Fresh mandatory BROAD and typecheck
        alt Any independent gate fails
            V-->>L: Pass entry grants no waiver; reconcile truthfully
            V-->>P: Parent remains blocked
        else All gates pass
            V-->>P: Baseline change may close; parent may resume fresh verification
        end
    end
```

## State, persistence, migration, and dependencies

- **Runtime state:** no new runtime state, cache, service, feature flag, or environment contract.
- **Persistence:** only the maintained baseline ledger changes, after evidence. Test sandboxes are temporary and removed after confirmed process cleanup.
- **Migration:** none. Existing callers need no data or configuration migration.
- **Dependencies:** no package addition, upgrade, lockfile change, external service, install, or network requirement.
- **Generated output:** none is built or edited. `apps/cli/src/runtime/build-info.generated.ts` remains read-only.
- **Public compatibility:** existing Pi call positions, direct shared-binary/Serena signatures, doctor zero-argument calls, CLI output, and result unions remain compatible. Optional internal seams are additive and do not create a new product API; only the explicit post-install Serena `unusable` branch changes from false success to the Spec-required existing `blocked` failure value.

## Test isolation, performance, and security

### Isolation

- Pi tests own all probe and command outcomes and restore no global state because none is changed.
- TUI helpers use only their local harness and clean it in `finally`.
- Doctor unit tests pass four local function dependencies rather than touching filesystem/PATH or adding global subprocess/release mocks.
- Binary children receive local release fixtures and sandboxed home/XDG paths. Cleanup completes before sandbox deletion and before the test returns.

### Performance

Production Pi and doctor behavior adds only dependency selection and function indirection. No extra production probes, retries, loops, or subprocesses are introduced. Tests stop spending repeated 5 second healthcheck windows and release/deck-check work. TUI failure is bounded at 5 seconds per missing transition; Binary command plus forced cleanup is bounded below 25 seconds.

### Security and side effects

Tests execute no install command unless the command runner is an in-memory fixture. Release lookup is local-only. The upgrade smoke uses a valid empty-item descriptor, allows only orchestration metadata inside disposable XDG roots, and proves no download, binary replacement, or runner-content payload occurs. Timeout diagnostics expose only capped child/test output and never serialize the environment. No shell is used for the Deck CLI launch; Windows cleanup invokes the absolute system `taskkill.exe` with numeric PID arguments.

## Exact editable targets and estimated impact

No implementation target outside this table is allowed.

| # | Path | Change | Estimated impact |
|---:|---|---|---:|
| 1 | `docs/architecture.md` | Correct two archive destinations on one line. | 1 line |
| 2 | `packages/adapter-pi/src/install-tools.ts` | Add same-fourth-position overload/dependency resolution and thread it through dispatch/workers. | 50–90 lines |
| 3 | `packages/adapter-pi/src/install-tools.test.ts` | Replace host assumptions with exact probe/command fixtures, fail-closed outcomes, and compatibility assertions. | 70–110 lines |
| 4 | `apps/cli/src/tui/app.opencode-discovery.test.tsx` | Add bounded fresh-output/action helpers and async cleanup; update five scenarios. | 80–130 lines |
| 5 | `apps/cli/src/__tests__/binary-smoke.test.tsx` | Replace subprocess lifecycle; add doctor/empty-upgrade sandboxes and three cleanup oracles; require zero-exit real smokes. | 170–260 lines |
| 6 | `apps/cli/src/doctor-command/doctor-diagnostics.ts` | Add the four-member optional dependency seam and thread it through private helpers. | 30–50 lines |
| 7 | `apps/cli/src/__tests__/doctor-diagnostics.test.ts` | Supply four deterministic doctor dependencies and exact no-side-effect assertions. | 45–80 lines |
| 8 | `openspec/baseline-health.yaml` | Evidence-gated pass transition and policy/count correction. | 20–35 lines |

**File estimate:** exactly 8 modified files, 0 new implementation files, approximately 466–756 touched lines before formatting and deletions. If source evidence during Apply requires a ninth path, a production TUI change, an upgrade implementation change, a shared process utility, a maintained fixture edit, or a dependency/lockfile change, stop and return for Proposal/Design scope revision.

## Alternatives and tradeoffs

| Alternative | Decision and rationale |
|---|---|
| Raise global/test timeouts until BROAD happens to pass | Rejected. It retains host probes, stale output, and leaked processes. The selected bounds are derived from the 30 second policy and reserve cleanup time. |
| Keep fixed sleeps around Ink | Rejected. Elapsed time does not prove a state transition and becomes slower without becoming correct. Fresh post-action predicates are the success condition. |
| Call `waitUntilRenderFlush()` without a race | Rejected. Ink can await a future concurrent render or stdout callback indefinitely. Every flush shares an absolute deadline. |
| Global mock `@deck/core`, doctor-checks, or GitHub release modules | Rejected. Global mock state can leak under BROAD and obscure integration coverage. Use local explicit dependencies only at proven boundaries. |
| Production-only `NODE_ENV=test`, environment, or branch special cases | Rejected. Test mode must not change product behavior; defaults compose the existing implementations. |
| Skip flaky tests, accept `124`, or mark warning | Rejected. These erase the behavior mandatory BROAD is meant to prove. The dedicated timeout oracle may observe `124` only to prove cleanup and failure classification. |
| Bare `deck upgrade` with the maintained no-upgrade fixture | Rejected by current source evidence. The CLI stages before version comparison and that fixture contains a Linux binary item, so it can enter download/install behavior. Use a test-created valid empty-item descriptor in disposable XDG roots. |
| Invalid-descriptor upgrade smoke | Rejected. It exits `1`, contradicts REQ-BIN-001, and proves rejection rather than a completed usable command. |
| Replace real Binary smokes with inline fixture processes | Rejected. Inline scripts only prove lifecycle cleanup; all real CLI smokes remain. |
| Claim one portable process-group primitive | Rejected. POSIX groups and Windows process trees differ. Use explicit branches and fail if platform evidence cannot prove the bounded contract. |
| Preserve the old active fingerprint after green | Rejected. The ledger is current state, not permanent history; doing so creates an invalid pass-with-warning escape. |
| Split into multiple OpenSpec changes | Rejected. The parent remains blocked until all classes are green, and the ledger has one repository-wide truth. Atomic tasks may remain independent inside this one change. |

## TDD and verification strategy

### Apply RED

The parent BROAD run is authoritative pre-change RED evidence: `bun test --timeout 30000`, exit `1`, `3997 pass`, `7 fail`, `4004 tests across 222 files`, output `sha256:32acba62d480348bdb2083d2762f79f3fbe1894979316e6cfc002260d203bc5a`.

- Documentation: reproduce the maintained-link failure with the existing governance test before changing the links.
- Pi and doctor: first add exact dependency-fixture expectations, run each focused file, and retain the failing assertions before implementing the source seam.
- TUI and Binary: use the parent BROAD failures as RED. Do not manufacture timing failures through sleeps or load loops. The new lifecycle cleanup oracles must fail against the old early-resolving helper behavior before the replacement is accepted.

### Focused GREEN

```bash
bun test --timeout 30000 tests/documentation-governance.test.ts
bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts
bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts
bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx
bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts
```

GREEN is invalid if a Pi fixture reaches the host, a release call reaches network, the upgrade smoke downloads/installs payloads or writes outside its sandbox, any real CLI smoke exits nonzero or returns `124`, a cleanup oracle leaves its emitted PID alive, or a TUI predicate matches only pre-action output.

### Grouped, hygiene, type, and Apply-local full suite

```bash
bun test --timeout 30000 packages/adapter-pi/src
bun test --timeout 30000 tests/documentation-governance.test.ts apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts apps/cli/src/__tests__/binary-smoke.test.tsx apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts
bunx tsc --noEmit
bun test --timeout 30000
```

Also inspect exact eight-path diff hygiene, generated-output absence, temporary-directory cleanup, process/PID cleanup evidence, no skip/only/todo weakening, fixture-local release access, and the parent 17-file identity before and after commands. The Apply-local full suite must run before the ledger edit.

### Ledger transition and independent final QA

After the Apply-local full suite exits zero, update the ledger exactly as AD-6 defines. Then use fresh instances and fresh candidate bindings in this order:

1. independent targeted Verify, including every focused command, exact seam/default/error inspection, subprocess cleanup oracles, ledger semantics, diff allowlist, and OpenSpec validation;
2. independent affected-area Verify, including grouped commands and fresh `bunx tsc --noEmit`;
3. independent Review for architecture, security/side effects, cross-platform process handling, maintainability, and compatibility;
4. independent final BROAD: `bun test --timeout 30000`, followed on success by fresh typecheck, OpenSpec validation, allowlist/generated-output/global-write hygiene, parent identity, and ledger comparison.

Any required failure is blocking. There is no pass-with-warning. Apply evidence is prerequisite evidence, not independent proof.

## Rollout and rollback

Ship the eight-file repair as one patch only after independent targeted, affected, Review, and mandatory BROAD evidence is green. There is no feature flag, deployment, migration, install, or staged production rollout. The parent may resume only after this change closes; it must bind fresh evidence to its unchanged 17-file candidate and may not reuse this change's Verify as its own final judgment.

Rollback is a normal auditable forward fix or inverse commit limited to these eight paths. Revert Pi/doctor seams together with their deterministic tests, and replace TUI/Binary helpers only with another bounded strategy approved under the same path boundary. Do not restore stale architecture links unless archive ownership itself changes through a separate lifecycle action.

The ledger may return to `known-failures` only after a fresh mandatory run reproduces an exact active fingerprint; never copy the historical count/fingerprint merely because code was reverted. Rollback must preserve parent bytes, unrelated WIP, history, and registry files. No destructive Git discard, broad checkout, history rewrite, network/install action, or generated-output edit is part of rollback.

## Risks, hard stops, and open decisions

| Risk | Control |
|---|---|
| Optional seams become service locators | Exactly four source-proven doctor members and one same-position Pi dependency object; no unrelated dependency injection. |
| Fresh-output predicate is too broad | Require an action boundary and named state-specific text; cap and report both fresh and complete tails on timeout. |
| Cleanup resolves before descendants/streams | Structured completion awaits tree confirmation, root exit, and both EOFs on every outcome; dedicated success/failure/timeout descendant fixtures. |
| Windows semantics differ from POSIX | Preserve ancestry, use absolute `taskkill /T /F`, verify emitted descendant PIDs, and fail rather than skip or overclaim. |
| Local release fixture accidentally installs payloads | Doctor uses maintained no-upgrade data only for availability; upgrade uses a generated valid descriptor with `items: []`. Assert zero payload/download/content output and confine permitted metadata to sandbox XDG roots. |
| Ledger becomes aspirational | Apply-local green first; independent final gates afterward; any later failure blocks and forces truthful reconciliation. |
| Parent or unrelated WIP drifts | Recompute the canonical 17-file identity and inspect exact changed paths before/after each stage. |

Hard stops:

- any required edit outside the eight targets;
- any real install, release network access, user/global configuration mutation, generated write, or dependency change;
- any accepted timeout, fixed success sleep, unbounded wait, process/stream cleanup uncertainty, platform skip, or weakened assertion;
- any focused, grouped, typecheck, OpenSpec, independent Verify, Review, or BROAD failure;
- any parent candidate drift or modification to `runner-capability-standardization`, `deck-onboard`, registry YAML, archived artifacts, or unrelated WIP.

**Open design decisions:** none within the approved boundary. Cross-platform cleanup remains an implementation verification risk, not an unresolved design choice: the strategy above is selected, and inability to prove it is a hard stop. Final pass counts and timestamps are intentionally evidence-derived values, not Design-time choices.

## Exact Implementation Instructions

Not applicable. No Deck-owned prompt, skill, system instruction, generated prompt material, or capability instruction bundle is in scope. No EII should be invented.

## Provenance and registry coordination

- **Official context:** approved Proposal and approval registry event; Explore; current source/tests and installed local declarations; `openspec/config.yaml`; `openspec/baseline-health.yaml`; and the parent BROAD report/candidate identity.
- **Spec reconciliation:** corrected Spec `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c` was read after independent drafting; all 34 requirements, 50 unique scenarios, and OQ-1 through OQ-5 are reconciled above.
- **Adaptive context:** loaded as advisory only and consistent with the official failure map; it granted no authority and did not alter scope or decisions.
- **Skill discovery:** `.atl/skill-registry.md` status was `indeterminate`, reason `validate_command_returned_unexpected_interactive_menu`, active runner `opencode`, reminder `v1`. Bounded active-runner loading used only `deck-developer-design`, `using-agent-skills`, `api-and-interface-design`, and `debugging-and-error-recovery`. No registry validation, refresh, generation, or write occurred.

This specialist does not write `state.yaml` or `events.yaml`. Because final reconciliation changed this artifact, one helper-built, parse-validated `RegistryIntentV1` for `design.completed` is returned out of band with the final artifact digest to avoid a self-referential file hash. The coordinator must apply it only against the supplied final base pair and stop on conflict or recovery-required.
