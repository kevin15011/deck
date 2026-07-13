# Verify Report: Runner-Resolved OpenCode Model Discovery

## Summary

**Overall Result**: FAIL  
**Requirements Verified**: 26 / 33  
**Scenarios Verified**: 26 / 36  
**Tasks Verified**: 6 / 10  
**Tasks Marked Complete**: 10 / 10  
**Focused Tests**: 259 passed, 0 failed  
**Relevant Broader Tests**: 578 passed, 0 failed  
**Package Test Script**: 3,256 passed, 0 failed  
**Repo-Wide Tests**: 3,255 passed, 1 failed; the only failure matches the existing `Binary smoke tests > --doctor runs and reports diagnostics` baseline fingerprint  
**Typecheck**: PASS  
**Build**: Not run because the delegated gate explicitly required typecheck/tests and prohibited writing any artifact other than this report; the repository build writes generated output.

The runner-only inventory, exact variants, assignment compatibility, TUI states, and Pi isolation paths pass their focused and broader tests. Verification fails because the default runtime path does not retain the five-minute cache, does not construct the required full discovery fingerprint, does not wire the implemented last-known-good store, and does not guarantee that a subprocess stops waiting at 15,000 ms. The required deterministic regression matrix is also materially incomplete.

## Execution Evidence

| Check | Result | Details |
|---|---|---|
| Exact focused matrix from Task 4.1 | PASS | `bun test packages/core/src/adapter-registry.test.ts packages/adapter-opencode/src/opencode-models-cli.test.ts packages/adapter-opencode/src/model-inventory-cache.test.ts packages/adapter-opencode/src/model-inventory.test.ts packages/adapter-opencode/src/runner-adapter.inventory.test.ts packages/adapter-opencode/src/model-config.test.ts packages/adapter-opencode/src/developer-team-install.test.ts packages/adapter-pi/src/runner-adapter.test.ts packages/adapter-pi/src/model-config.test.ts apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx apps/cli/src/tui/developer-team-flow.test.tsx` — 259 passed, 0 failed, 11 files |
| Relevant broader tests | PASS | `bun test packages/adapter-opencode/src apps/cli/src/tui` — 578 passed, 0 failed, 41 files |
| Typecheck | PASS | `bunx tsc --noEmit` — exit 0, no diagnostics; Serena also reported no warnings/errors in the principal changed runtime files |
| Package test script | PASS | `bun run test` — 3,256 passed, 0 failed, 170 files |
| Repo-wide tests | PASS WITH KNOWN BASELINE FAILURE | `bun test` — 3,255 passed, 1 failed, 170 files. Failure: `Binary smoke tests > doctor runs and reports diagnostics`, timed out after 5,000 ms. This is one of the two tests in the baseline's known `Binary smoke tests` fingerprint. No new failure fingerprint was observed. The baseline expected 2,854 passed / 40 failed; 39 prior failures are now absent, so the ledger totals are stale but the residual failure is known. |

## Task Completion

| Task | Artifact Status | Verification | Result |
|---|---|---|---|
| 0.1 Shared async discovery/write contracts | Complete | Core contracts and focused tests | PASS |
| 0.2 Hermetic fixtures and seams | Complete | Hermetic guard exists, but required fixture/matrix cases are missing | FAIL |
| 1.1 Bounded execution and strict parsing | Complete | Parser bounds exist; hard timeout/termination contract is not guaranteed or tested | FAIL |
| 1.2 Fingerprinted cache and 24-hour LKG | Complete | Components exist, but default runtime does not retain/wire them and coverage is incomplete | FAIL |
| 1.3 Runner-only normalization | Complete | Source inspection and focused tests | PASS |
| 2.1 Async adapter validation | Complete | Exact model/variant validation and ready-state checks | PASS |
| 2.2 Non-destructive persistence/native variants | Complete | Persistence/install focused tests | PASS |
| 2.3 Pi isolation | Complete | Pi adapter/config tests and six-level TUI assertions | PASS |
| 3.1 TUI states and local rescan | Complete | Loading/ready/stale/blocked/empty rendering and rescan tests | PASS |
| 4.1 Final deterministic matrix | Complete | Required matrix is incomplete despite all selected tests passing | FAIL |

## Requirement Compliance Matrix

| Requirement | Method | Result | Notes |
|---|---|---|---|
| REQ-INV-001 | Source + focused tests | PASS | Live parsed inventory is the selectable authority. |
| REQ-INV-002 | Source + focused tests | PASS | Providers derive from runner model IDs; cache-only IDs are excluded. |
| REQ-INV-003 | Parser/source + fixtures | PASS | No provider allowlist/auth membership filter is applied. |
| REQ-INV-004 | Focused test | PASS | Exit-zero empty output remains a ready empty inventory. |
| REQ-VAR-001 | Parser/source + focused tests | PASS | Variant key spelling and object-key order are preserved. |
| REQ-VAR-002 | Source + focused tests | PASS | No fallback/synthetic OpenCode levels are supplied. |
| REQ-VAR-003 | Adapter/TUI tests | PASS | Zero variants expose no choice; non-empty changed value is rejected. |
| REQ-VAR-004 | TUI tests | PASS | Variant options recompute from the selected model. |
| REQ-META-001 | Source + focused tests | PASS | Enrichment cannot add IDs/providers/variants. |
| REQ-META-002 | Source + focused tests | PASS | Optional metadata does not filter runner membership. |
| REQ-DISC-001 | Source inspection | FAIL | `nodeOpenCodeCommandRunner.run` sends `SIGTERM` at 15,000 ms but resolves only on `close`; a child that ignores or delays termination can keep the Promise pending beyond 15 seconds. No deterministic timeout/one-termination test exists. |
| REQ-DISC-002 | Source inspection | FAIL | `discoverModelInventory` creates a new `ModelInventoryCache` whenever the caller does not inject one, and the default adapter injects none. Normal runtime requests therefore do not reuse an in-process result for five minutes. |
| REQ-DISC-003 | Source inspection | FAIL | The default fingerprint uses literal `"opencode"`, workspace, and environment presence only. It omits resolved executable identity/path, runner version, and config/auth/plugin state. |
| REQ-DISC-004 | Source inspection + tests | FAIL | TTL/rescan behavior passes only on an isolated injected cache; the default runtime recreates the cache and cannot perform the promised fingerprint-driven invalidation behavior. |
| REQ-DISC-005 | Reference tracing | FAIL | `LastKnownGoodStore` is implemented but has no runtime references; the default adapter supplies neither `readLastKnownGood` nor `writeLastKnownGood`. |
| REQ-DISC-006 | Source inspection | FAIL | The orphaned store checks age/fingerprint/source, but structural validation does not reapply live parser invariants such as canonical/provider consistency and validated variant keys. No expired/incompatible/malformed store test exists. |
| REQ-DISC-007 | Source + tests | PASS | Command/malformed failures produce blocked state without inventory fallback. |
| REQ-DISC-008 | Adapter/TUI tests | PASS | Stale state is view-only and changed writes require ready inventory. |
| REQ-DISC-009 | Command vector + TUI tests | PASS | Discovery uses only `models --verbose`; explicit TUI retry sends local `mode: "rescan"`, not `--refresh`. |
| REQ-ASG-001 | Persistence tests | PASS | Persisted unavailable values are retained on reads. |
| REQ-ASG-002 | TUI source/tests | PASS | Model-unavailable and variant-unavailable states are distinct. |
| REQ-ASG-003 | Install tests | PASS | Validation is restricted to changed agent IDs. |
| REQ-ASG-004 | Adapter/apply source + tests | PASS | Changed model IDs require an exact ready-inventory match before write. |
| REQ-ASG-005 | Adapter/install tests | PASS | Variant matching is exact and case-sensitive; no nearest mapping. |
| REQ-ASG-006 | TUI/install tests | PASS | Model changes clear/reselect invalid variants; zero-variant changes write unset. |
| REQ-ADP-001 | Core contract test | PASS | Dynamic discovery/validation ports are adapter-optional. |
| REQ-ADP-002 | Pi focused tests | PASS | Pi behavior and all six fixed reasoning levels remain intact. |
| REQ-ADP-003 | TUI/Pi tests | PASS | OpenCode state does not alter Pi inventory/configuration. |
| REQ-REC-001 | Cross-cutting/TUI tests | PASS | Runner authority coexists with list windowing. |
| REQ-REC-002 | Cross-cutting/TUI tests | PASS | Existing model-specific UI consumes runner keys and zero sets. |
| REQ-REC-003 | Install-flow tests | PASS | Valid changed assignments propagate through review/install. |
| REQ-TEST-001 | Hermetic helper + source scan | PASS | Change-focused discovery tests inject command/clock/filesystem/environment seams and reject live runner, shell/network helpers, and real-home paths. |
| REQ-TEST-002 | Test inventory inspection | FAIL | Required timeout, process bounds, full fingerprint invalidation, LKG compatibility/malformed cases, and several required parser/provider fixtures are absent. |

## Scenario Compliance Matrix

| # | Scenario | Result | Evidence / reason |
|---:|---|---|---|
| 1 | Runner membership is exact | PASS | Runner/cache intersection test |
| 2 | All runner-resolved provider kinds are treated equally | PASS | Parser has no provider-kind filter |
| 3 | Successful empty runner inventory stays empty | PASS | Empty-output focused test |
| 4 | Exact per-model variant keys are selectable | PASS | Parser/TUI tests |
| 5 | Alias and plugin transforms remain final | PASS | Canonical header/first-slash parsing and plugin fixture |
| 6 | Model with no variants has no reasoning choice | PASS | Adapter/TUI tests |
| 7 | Changing models changes the variant domain | PASS | TUI effort tests |
| 8 | Matching metadata enriches without changing authority | PASS | Inventory enrichment test |
| 9 | Conflicting or malformed metadata is isolated | PASS | Authority fields are not copied from metadata |
| 10 | Authentication evidence does not filter availability | PASS | No auth membership filtering in runtime path |
| 11 | Fresh in-process inventory is reused within five minutes | FAIL | Default runtime recreates the cache per request |
| 12 | Five-minute boundary requires discovery | FAIL | Isolated cache unit passes, but the cache is not retained in the default runtime pipeline |
| 13 | Version or executable path change invalidates immediately | FAIL | Default fingerprint omits both resolved path and version |
| 14 | Workspace, configuration, authentication, or environment change invalidates immediately | FAIL | Workspace/environment presence are included, but config/auth/plugin state is not wired |
| 15 | Discovery times out deterministically | FAIL | Promise completion is tied to child `close`, not the 15,000 ms deadline |
| 16 | Command failure does not fail open | PASS | Blocked-state test |
| 17 | Malformed runner output is rejected as a whole | PASS | All-or-nothing parser test |
| 18 | Compatible last-known-good snapshot is shown stale | FAIL | Store is not connected to default runtime discovery |
| 19 | Last-known-good boundary and compatibility are enforced | FAIL | Store is disconnected and malformed structural cases are not fully validated/tested |
| 20 | Stale display cannot authorize changed writes | PASS | Adapter stale validation test |
| 21 | Successful rediscovery replaces stale state | FAIL | No integrated LKG/rescan pipeline or acceptance test |
| 22 | Normal TUI opening performs no network refresh | PASS | Literal command vector; no refresh flag |
| 23 | Explicit refresh remains explicit and bounded | FAIL | Explicit local rescan exists, but hard process deadline is not guaranteed |
| 24 | Persisted unavailable model is preserved | PASS | Read/TUI tests |
| 25 | Persisted unavailable variant is distinguished | PASS | Read/TUI tests |
| 26 | Unrelated save preserves stale assignments | PASS | Changed-agent-only install tests |
| 27 | Changed unavailable model is rejected atomically | PASS | Adapter/apply validation |
| 28 | Changed unsupported variant is rejected without mapping | PASS | Case-sensitive exact validation test |
| 29 | Model change resolves the previous variant explicitly | PASS | TUI/install tests |
| 30 | Pi behavior remains unchanged | PASS | Pi adapter/config and six-level tests |
| 31 | OpenCode failure does not affect Pi | PASS | Runner-isolation tests |
| 32 | Provider authority changes without list-navigation regression | PASS | Cross-cutting and MenuList broader tests |
| 33 | Existing model-specific effort UI consumes runner keys | PASS | TUI effort tests |
| 34 | Valid assignments still propagate through review and install | PASS | Developer-team install tests |
| 35 | Tests remain hermetic | PASS | Injected seams and explicit guard test |
| 36 | Regression matrix is executable deterministically | FAIL | The selected matrix executes, but required acceptance cases are absent |

## Findings

### CRITICAL

1. **Runtime cache/fingerprint/LKG pipeline is incomplete** (`REQ-DISC-002` through `REQ-DISC-006`).
   - Evidence: `packages/adapter-opencode/src/model-inventory.ts:46-48` creates a cache per call and constructs only a partial fingerprint; `packages/adapter-opencode/src/runner-adapter.ts:143-158` does not retain a cache or wire LKG read/write; `LastKnownGoodStore` has no references outside its declaration.
   - Repair: create adapter-lifetime cache/LKG dependencies, resolve and fingerprint the executable/version/config/auth/plugin/environment scope before cache lookup, and use the private store on successful live discovery/failure fallback. Revalidate persisted snapshots with the same normalized invariants as live parser output.

2. **15,000 ms is not a hard wait bound** (`REQ-DISC-001`).
   - Evidence: `packages/adapter-opencode/src/opencode-models-cli.ts:117-126` sends `SIGTERM` at the deadline but resolves only when the process emits `close`; it has no deadline settlement/forced termination path and can request termination again from output handlers.
   - Repair: settle/classify timeout at the hard deadline, request termination exactly once, add bounded escalation/cleanup, and add fake-runner/fake-clock tests for completion immediately before and at the 15,000 ms boundary.

3. **Required deterministic regression matrix is incomplete** (`REQ-TEST-002`; Tasks 0.2, 1.1, 1.2, and 4.1).
   - Evidence: `opencode-models-cli.test.ts` has four tests and no timeout/output-bound lifecycle cases; `model-inventory-cache.test.ts` has two tests and no LRU/coalescing/full fingerprint/LKG cases; the valid fixture covers only two records and omits several mandated parser cases.
   - Repair: add all cases enumerated by REQ-TEST-002 and Task 1.1, including built-in/custom/plugin/alias, nested/braced strings, all process/parser bounds, full fingerprint dimensions, in-flight/LRU behavior, LKG age/fingerprint/source/malformed/private-write behavior, rescan replacement, and integrated stale-to-ready behavior.

### WARNING

1. **Baseline totals are stale, although the residual repo-wide failure is known.** Current `bun test` has 3,255 passed / 1 failed rather than the ledger's 2,854 passed / 40 failed. The one residual `Binary smoke tests > doctor runs and reports diagnostics` timeout belongs to the ledger's known binary-smoke fingerprint; no new fingerprint was found. Re-capture the baseline separately from this deferred Verify phase.

### SUGGESTION

None.

## Failure Manifest

| Fingerprint | Contract | Latest evidence | Owner | Suspected scope | Changed files | Retry | Previous attempt | Generated artifact? | Next verification action |
|---|---|---|---|---|---|---:|---|---|---|
| `discovery-runtime-cache-fingerprint-lkg-unwired` | REQ-DISC-002..006 | Source/reference tracing; focused tests pass but do not exercise default integration | Backend Apply | Adapter-lifetime discovery dependencies | `model-inventory.ts`, `model-inventory-cache.ts`, `runner-adapter.ts`, related tests | 0 | Apply marked complete without integrated evidence | No | Run targeted integrated cache/fingerprint/LKG tests, then focused matrix |
| `opencode-timeout-not-hard-bounded` | REQ-DISC-001 | Source inspection of `nodeOpenCodeCommandRunner.run`; no deadline test | Backend Apply | Subprocess lifecycle | `opencode-models-cli.ts`, `opencode-models-cli.test.ts` | 0 | Apply asserted a 15-second bound from request shape only | No | Run fake process/clock tests at 14,999 ms and 15,000 ms, including ignored SIGTERM |
| `required-regression-matrix-incomplete` | REQ-TEST-002 | Test-file inventory versus spec/task matrix | General Apply with Backend Apply cases | Test fixtures and deterministic acceptance coverage | Discovery/cache/inventory/adapter/TUI/Pi tests | 0 | Selected suites pass but omit required cases | No | Add missing cases and rerun focused, broader, typecheck, package, and repo-wide gates |

## Registry and Artifact Check

- Official artifacts `spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, `preconditions.md`, `state.yaml`, and `events.yaml` exist.
- `state.yaml` records Apply completed with all 10 task IDs and no pending tasks.
- `events.yaml` contains 14 events through `apply-completed`.
- Registry mode is deferred. This agent did not modify `state.yaml` or `events.yaml`.
- Registry intent: phase `verify`, status `failed`, event `verify-failed`, artifact `verify-report.md`.

## Open Questions

None.

---

# Repair Verification Cycle 1

## Cycle Summary

**Incident**: `verify-review-blockers-round-1`  
**Phase**: `verify-repair-cycle-1`  
**Overall Result**: FAIL — BLOCKED  
**Requirements Verified**: 32 / 33  
**Scenarios Verified**: 35 / 36  
**Tasks Verified**: 8 / 10  
**Verification Cycles Used**: 1 / 2  
**Registry Write**: deferred  
**Registry Intent**: phase `verify`, status `failed`, event `repair-verify-cycle-1-failed`, artifact `verify-report.md`

The repair resolves nine of the ten original incident fingerprints. The original exhausted fingerprint `opencode-timeout-not-hard-bounded` recurs: the command runner sends `SIGTERM` at 15,000 ms but does not settle until close or a 250 ms `SIGKILL` grace timer. Production discovery also performs a separately bounded version command before starting the verbose discovery command. Deck therefore does not stop waiting for the discovery attempt when 15 seconds elapse, contrary to `REQ-DISC-001` and its acceptance scenario.

This is not a genuinely new fingerprint. The incident records one consumed repair attempt for this original fingerprint, and the configured fingerprint budget is one. Applying `evaluateRepairIncident()` priority semantics to an active failure at its hard per-fingerprint attempt limit yields `block` before the soft checkpoint. No automatic repair is permitted without an explicit override.

## Execution Evidence

| Gate | Result | Evidence |
|---|---|---|
| Full repaired focused matrix | PASS | `bun test ... apps/cli/src/tui/opencode-discovery.test.ts ...` — 272 passed, 0 failed, 12 files |
| Typecheck | PASS | `bunx tsc --noEmit` — exit 0, no diagnostics |
| Affected adapter/TUI suites | PASS | `bun test packages/adapter-opencode/src apps/cli/src/tui` — 591 passed, 0 failed, 42 files |
| Broader package test script | PASS | `bun run test` — 3,269 passed, 0 failed, 171 files |
| Repository-wide suite | BASELINE-MATCHING FAILURE | `bun test` — 3,268 passed, 1 failed, 1 error, 171 files; only `Binary smoke tests > doctor runs and reports diagnostics` timed out after 5,000 ms |
| Serena diagnostics | PASS | No warnings/errors in `opencode-models-cli.ts`, `model-inventory-cache.ts`, `runner-adapter.ts`, `developer-team-install.ts`, `opencode-discovery.ts`, or `app.tsx` |

### Exact Baseline Comparison

`openspec/baseline-health.yaml` records `bun test` as 2,854 passed / 40 failed and includes the `Binary smoke tests` / `--doctor runs and reports diagnostics` fingerprint. The current run is 3,268 passed / 1 failed. The sole current failure matches that recorded baseline suite/test/error class; 39 recorded failures are absent. No new repo-wide test fingerprint was introduced.

## Original Finding Disposition

| Original finding | Fingerprint | Result | Current evidence |
|---|---|---|---|
| Verify Critical / Review High: production cache, fingerprint, and LKG disconnected | `discovery-runtime-cache-fingerprint-lkg-unwired` | RESOLVED | `OpenCodeRunnerAdapterImpl.constructor` owns one adapter-lifetime `ModelInventoryCache` and `LastKnownGoodStore`, builds the non-secret executable/stat/version/workspace/config/auth/plugin/environment fingerprint, and injects the same cache/LKG into discovery. |
| Verify Critical / Review High: timeout not hard bounded | `opencode-timeout-not-hard-bounded` | **RECURRENT — EXHAUSTED** | `createNodeOpenCodeCommandRunner` calls `terminate("timeout")` at the deadline, sends `SIGTERM`, then waits up to 250 ms before `SIGKILL` and settlement. The focused test advances 15,000 ms and then another 250 ms before expecting resolution. This violates the stop-waiting-at-15-seconds contract. |
| Review High: live variant passed through static resolution | `runner-variant-static-resolution-leak` | RESOLVED | OpenCode selection/write paths retain exact runner variant keys; focused persistence/TUI tests pass. |
| Review High: unchanged assignment mutation | `unchanged-assignment-field-mutation` | RESOLVED | `buildAgentEntry` emits `model`/`variant` only when `changedAgentIds` contains the agent; unchanged native and legacy assignment fields are left to the existing merge unchanged. |
| Review High: stale async response overwrite | `async-discovery-stale-response-overwrite` | RESOLVED | `createOpenCodeDiscoveryCoordinator` uses a monotonic generation and active runtime/project identity guard; request-time assignment snapshots are passed to the result handler. Deferred tests cover both completion orders and identity change. |
| Review High: successful empty routing | `successful-empty-state-routing` | RESOLVED | Empty runner success remains a `ready` state with an empty inventory; non-loading discovery actions expose stable Retry/Back behavior, and empty-state TUI tests pass. |
| Review High: permissive/private/atomic LKG | `lkg-validation-privacy-integrity` | RESOLVED | `LastKnownGoodStore.read/write` normalize a closed DTO, enforce source/fingerprint/time constraints, require private parent/file modes, avoid unsafe links, use random same-directory temporary files, and atomically rename. |
| Verify Critical / Review High: adversarial matrix incomplete | `required-regression-matrix-incomplete` | RESOLVED | The repaired 272-test focused matrix now includes parser/process/cache/LKG, exact variants, persistence, Pi, latest-request, empty-routing, and TUI cases. The incorrect timeout expectation is classified under the original timeout fingerprint rather than split into a duplicate matrix fingerprint. |
| Review Medium: mutable last-plan state | `mutable-last-plan-cross-request-risk` | RESOLVED | `buildDeveloperTeamInstallPlan` binds immutable plan objects in `#planBindings`; apply retrieves only `input.plan`, rejects foreign plans, and revalidates the bound fingerprint/assignments before writing. |
| Review Medium: chunked UTF-8 corruption | `chunked-utf8-decoding-corruption` | RESOLVED | The process boundary counts bytes and uses independent UTF-8 `StringDecoder` instances; split-multibyte coverage passes. |
| Review Low: obsolete cache-authority terminology | advisory cleanup | RESOLVED | Repaired fixtures/comments use runner-resolved terminology; no stale `runner-cache` authority remains in the repaired focused evidence. |

## Source and Reference Trace

| Required trace | Result | Evidence |
|---|---|---|
| Production composition | PASS | `OpenCodeRunnerAdapterImpl.constructor` creates and closes over shared cache/LKG/fingerprint dependencies; `LastKnownGoodStore` references include production adapter composition and focused tests. |
| Hard timeout / kill | **FAIL** | `createNodeOpenCodeCommandRunner` schedules the deadline, but timeout settlement occurs only on child close/error or the 250 ms escalation timer. `SIGTERM` occurs at 15,000 ms; ignored children resolve at 15,250 ms. |
| LKG schema/privacy | PASS | Closed normalization plus private directory/file checks on read; normalized allowlisted write, random temporary path, private modes, atomic rename, and cleanup on write. |
| Exact variant write boundary | PASS | Changed OpenCode agents emit native `variant` directly; legacy static resolution is not used to authorize the selected live key. |
| Unchanged assignment preservation | PASS | `buildAgentEntry` omits all assignment fields for unchanged agents, preserving prior `model`, `variant`, and `reasoningEffort` values through merge. |
| Latest-request guard | PASS | Coordinator generation plus runtime/project identity matching blocks stale completion writes; references from `DeckApp` and deferred tests are present. |
| Empty routing | PASS | `getOpenCodeDiscoveryAction` provides Retry/Back for every non-loading state; ready-empty rendering and keyboard behavior are covered by repaired tests. |
| Immutable plan binding | PASS | `#planBindings` is keyed by the exact returned plan object; apply consumes `input.plan`, rejects unbound plans, and uses its bound validation/native plan. |
| UTF-8 decoding | PASS | `StringDecoder("utf8")` handles split stdout/stderr chunks after byte-bound checks; split `€` fixture passes. |

## Requirement Compliance Matrix

| Requirement | Result | Verification |
|---|---|---|
| REQ-INV-001 — Sole availability authority | PASS | Runner-only inventory tests and source trace |
| REQ-INV-002 — Exact inventory membership | PASS | Parser/inventory/TUI matrix |
| REQ-INV-003 — Provider-kind neutrality | PASS | Built-in/custom/plugin/alias fixtures |
| REQ-INV-004 — Valid empty inventory | PASS | Empty parser/inventory/TUI tests |
| REQ-VAR-001 — Exact final variant keys | PASS | Exact ordered arbitrary-key tests |
| REQ-VAR-002 — No synthetic or normalized levels | PASS | TUI/persistence/source trace |
| REQ-VAR-003 — Zero-variant behavior | PASS | Zero-variant picker/write tests |
| REQ-VAR-004 — Model-specific recomputation | PASS | TUI model-change tests |
| REQ-META-001 — Enrichment cannot expand authority | PASS | Metadata conflict/intersection tests |
| REQ-META-002 — Enrichment isolation | PASS | Malformed/conflicting metadata tests |
| REQ-DISC-001 — Discovery timeout | **FAIL** | Timeout waits 250 ms beyond the 15-second stop-waiting boundary; production version probing adds a prior wait |
| REQ-DISC-002 — In-process freshness window | PASS | Adapter-lifetime cache plus 4:59/5:00 tests |
| REQ-DISC-003 — Fingerprint coverage and secrecy | PASS | Production fingerprint trace and secret-safe tests |
| REQ-DISC-004 — Immediate invalidation triggers | PASS | Fingerprint/rescan/TTL tests |
| REQ-DISC-005 — Optional last-known-good eligibility | PASS | Exact-age/source/fingerprint tests |
| REQ-DISC-006 — Ineligible snapshot rejection | PASS | Expired/incompatible/malformed/privacy tests |
| REQ-DISC-007 — Safe blocked failure state | PASS | Timeout/failure/malformed blocked-state tests; timeout timing itself remains REQ-DISC-001 |
| REQ-DISC-008 — Stale inventory write safety | PASS | Stale/blocked changed-write tests |
| REQ-DISC-009 — Network refresh separation | PASS | Rescan-only TUI tests |
| REQ-ASG-001 — Non-destructive reads | PASS | Persistence tests |
| REQ-ASG-002 — Precise unavailable state | PASS | TUI assignment-state tests |
| REQ-ASG-003 — Validate only affected writes | PASS | Changed-agent merge tests |
| REQ-ASG-004 — Changed model validation | PASS | Exact model/fingerprint validation tests |
| REQ-ASG-005 — Changed variant validation | PASS | Case-sensitive exact variant tests |
| REQ-ASG-006 — Model-change variant transition | PASS | Model-change clearing tests |
| REQ-ADP-001 — Per-runner authority contract | PASS | Optional runner port/type tests |
| REQ-ADP-002 — Pi anti-regression | PASS | Pi focused tests |
| REQ-ADP-003 — Failure isolation | PASS | Cross-runner tests |
| REQ-REC-001 — Provider-filter reconciliation | PASS | Cross-cutting/list tests |
| REQ-REC-002 — Effort-level reconciliation | PASS | Exact runner-key/zero-key TUI tests |
| REQ-REC-003 — Assignment-flow reconciliation | PASS | Review/install propagation tests |
| REQ-TEST-001 — Hermetic test boundaries | PASS | Injected process/clock/filesystem fixtures; no live runner/network/home writes |
| REQ-TEST-002 — Required regression matrix | PASS | 272-test repaired focused matrix; timeout defect remains classified against REQ-DISC-001 |

## Scenario Compliance Matrix

| Scenario | Result | Verification |
|---|---|---|
| Runner membership is exact | PASS | Focused inventory matrix |
| All runner-resolved provider kinds are treated equally | PASS | Provider-kind fixtures |
| Successful empty runner inventory stays empty | PASS | Empty inventory/TUI tests |
| Exact per-model variant keys are selectable | PASS | Exact variant tests |
| Alias and plugin transforms remain final | PASS | Alias/plugin fixtures |
| Model with no variants has no reasoning choice | PASS | Zero-variant tests |
| Changing models changes the variant domain | PASS | TUI recomputation tests |
| Matching metadata enriches without changing authority | PASS | Enrichment tests |
| Conflicting or malformed metadata is isolated | PASS | Enrichment isolation tests |
| Authentication evidence does not filter availability | PASS | Fingerprint/authority tests |
| Fresh in-process inventory is reused within five minutes | PASS | Cache tests |
| Five-minute boundary requires discovery | PASS | Fake-clock boundary tests |
| Version or executable path change invalidates immediately | PASS | Fingerprint tests |
| Workspace, configuration, authentication, or environment change invalidates immediately | PASS | Fingerprint tests |
| Discovery times out deterministically | **FAIL** | Deck remains waiting through the 250 ms termination grace after 15 seconds |
| Command failure does not fail open | PASS | Blocked/LKG tests |
| Malformed runner output is rejected as a whole | PASS | Strict parser tests |
| Compatible last-known-good snapshot is shown stale | PASS | LKG/inventory tests |
| Last-known-good boundary and compatibility are enforced | PASS | LKG tests |
| Stale display cannot authorize changed writes | PASS | Validation tests |
| Successful rediscovery replaces stale state | PASS | Rescan tests |
| Normal TUI opening performs no network refresh | PASS | Request-shape tests |
| Explicit refresh remains explicit and bounded | PASS | Rescan-only tests; timeout timing failure is recorded above |
| Persisted unavailable model is preserved | PASS | Persistence tests |
| Persisted unavailable variant is distinguished | PASS | Assignment-state tests |
| Unrelated save preserves stale assignments | PASS | Merge tests |
| Changed unavailable model is rejected atomically | PASS | Apply validation tests |
| Changed unsupported variant is rejected without mapping | PASS | Exact validation tests |
| Model change resolves the previous variant explicitly | PASS | Model-change tests |
| Pi behavior remains unchanged | PASS | Pi tests |
| OpenCode failure does not affect Pi | PASS | Isolation tests |
| Provider authority changes without list-navigation regression | PASS | Cross-cutting TUI tests |
| Existing model-specific effort UI consumes runner keys | PASS | TUI effort tests |
| Valid assignments still propagate through review and install | PASS | Integration tests |
| Tests remain hermetic | PASS | Injected-seam matrix |
| Regression matrix is executable deterministically | PASS | 272 focused tests pass deterministically; the timeout contract defect is separately recorded |

## Task Completion

| Task | Result | Evidence |
|---|---|---|
| 0.1 Runner-neutral async/changed-write contracts | PASS | Core contract tests and typecheck |
| 0.2 Hermetic fixtures and seams | PASS | Fixture/process/filesystem/clock matrix |
| 1.1 Bounded command execution and strict parsing | **FAIL** | Parser and bounds pass, but the command Promise remains pending beyond 15,000 ms |
| 1.2 Fingerprinted memory cache and compatible LKG | PASS | Cache/LKG tests and production trace |
| 1.3 Runner-only inventory orchestration | PASS | Inventory matrix |
| 2.1 Async discovery and exact validation | PASS | Adapter integration tests |
| 2.2 Preserve stale reads/native changed writes | PASS | Persistence/merge tests |
| 2.3 Pi semantics and isolation | PASS | Pi tests |
| 3.1 Async TUI states/rescan | PASS | Deferred/TUI flow tests |
| 4.1 Complete deterministic reconciliation matrix | **FAIL** | The matrix executes, but its timeout case accepts settlement at 15,250 ms while describing 15,000 ms behavior |

## Findings

### CRITICAL

1. **Original exhausted fingerprint recurred: `opencode-timeout-not-hard-bounded`.**
   - Requirements: `REQ-DISC-001`.
   - Scenario: `Discovery times out deterministically`.
   - Tasks: 1.1 and 4.1.
   - Evidence command: full repaired focused matrix passes 272 tests, but source/reference tracing shows `createNodeOpenCodeCommandRunner` settles an ignored child only after the 250 ms escalation timer. Its dedicated test advances 15,000 ms, observes only `SIGTERM`, advances another 250 ms, and only then awaits resolution.
   - Latest result: contract FAIL despite green tests.
   - Classification: same original fingerprint; not new; repair attempt budget exhausted (1 / 1).
   - Next verification action: none automatically. An explicit governance override/replan is required before another Apply attempt.

### WARNING

1. Repository-wide `bun test` retains one known baseline binary-smoke timeout. It exactly matches the baseline ledger and is unrelated to this change; the baseline totals have improved from 40 failures to 1.

### SUGGESTION

None.

## Repair Governance Decision

| Field | Value |
|---|---|
| Operating mode | interactive |
| Apply batches used | 3 / 3 |
| Verification cycles used | 1 / 2 |
| Exhausted fingerprint recurrence | `opencode-timeout-not-hard-bounded` |
| New fingerprints | none |
| `evaluateRepairIncident()` equivalent action | `block` |
| Soft checkpoint | Superseded by the higher-priority exhausted-fingerprint hard stop |
| Automatic repair permitted | no |
| Decision | blocked; explicit override or replan/escalation required |

## Failure Manifest

| Fingerprint | Contract | Latest evidence | Owner hint | Suspected scope | Changed files | Retry | Previous attempt | Generated artifact? | Next verification action |
|---|---|---|---|---|---|---:|---|---|---|
| `opencode-timeout-not-hard-bounded` | REQ-DISC-001; timeout scenario; Tasks 1.1/4.1 | Source/reference trace plus 272-test focused run: timeout Promise resolves at 15,250 ms for ignored child, not at 15,000 ms | Backend Apply, only after explicit governance override | Process lifecycle and production discovery deadline composition | `packages/adapter-opencode/src/opencode-models-cli.ts`, `packages/adapter-opencode/src/opencode-models-cli.test.ts`, potentially adapter deadline composition | 1 / 1 exhausted | Batch 1 added SIGTERM/SIGKILL escalation and deterministic tests but retained the extra grace wait in the caller-visible Promise | No | Hard stop; obtain explicit override and redefine caller settlement versus child cleanup before any further repair |

## Artifact Preservation and Self-Check

- The original failed Verify report remains intact above this separator.
- This appended section is clearly labeled `Repair Verification Cycle 1`.
- Registry mode is deferred; `state.yaml`, `events.yaml`, code, tests, and other artifacts were not modified by Verify.
- Post-write existence and byte-size verification is required before return.

---

# Final Verification Cycle 2

## Cycle Summary

**Incident**: `verify-review-blockers-round-1`  
**Phase**: `verify-repair-cycle-2`  
**Overall Result**: FAIL — BLOCKED  
**Requirements Verified**: 32 / 33  
**Scenarios Verified**: 35 / 36  
**Tasks Verified**: 10 / 11  
**Scoped Fingerprints Resolved**: 2 / 3  
**Verification Cycles Used**: 2 / 2  
**Registry Write**: deferred  
**Registry Intent**: phase `verify`, status `failed`, event `repair-verify-cycle-2-failed`, artifact `verify-report.md`

All requested executable gates completed. The focused R1 matrix, typecheck, affected suites, and broader package suite pass. The repository-wide suite has exactly one failure, `Binary smoke tests > doctor runs and reports diagnostics`, matching the recorded baseline fingerprint; no new executable failure fingerprint appeared.

Final verification nevertheless fails because the authorized integration-evidence contract is not complete. `app.opencode-discovery.test.tsx` mounts `DeckApp` only at the initial splash and asserts `Your AI environment, configured.` It does not mount and drive deferred discovery through loading to ready/empty/stale/blocked, Retry, Back, either completion order, or project-identity changes. Those behaviors remain tested only against the extracted coordinator in `opencode-discovery.test.ts`, which the controlling Human Override Replan explicitly says cannot replace mounted `DeckApp` transition evidence. The default-production invalidation test also changes a relevant credential value while presence remains true, but never proves that relevant credential presence changes invalidate through the default adapter composition. This is a recurrence of scoped fingerprint `required-regression-matrix-incomplete`, not a new fingerprint.

Under `evaluateRepairIncident()` priority semantics, the final cycle reaches the incident hard verification limit and the recurring scoped fingerprint has exhausted its replacement attempt capacity. Both conditions resolve to `block` without another override. The Human Override Replan independently mandates the same final hard stop. No automatic repair is permitted.

## Execution Evidence

| Gate | Result | Exact evidence |
|---|---|---|
| R1 focused matrix | PASS | Required nine-file command: 140 passed, 0 failed, 657 expectations, 9 files, 2.61 s |
| Typecheck | PASS | `bunx tsc --noEmit`: exit 0; no diagnostics |
| Affected adapter/TUI suites | PASS | `bun test packages/adapter-opencode/src apps/cli/src/tui`: 596 passed, 0 failed, 2,640 expectations, 44 files, 6.12 s |
| Broader package suite | PASS | `bun run test`: 3,274 passed, 0 failed, 11,384 expectations, 173 files, 61.17 s |
| Repository-wide suite | BASELINE-MATCHING FAILURE | `bun test`: 3,273 passed, 1 failed, 11,383 expectations, 173 files, 57.46 s; only `Binary smoke tests > doctor runs and reports diagnostics`, timed out after 5,000 ms |
| Serena diagnostics | PASS | No warning/error diagnostics in `opencode-models-cli.ts`, `runner-adapter.ts`, or `app.tsx` |
| Build | NOT RUN | Not requested in the final command list; running the binary build could modify generated outputs, contrary to the instruction to modify only this report |

### Exact Baseline Comparison

`openspec/baseline-health.yaml` records `bun test` as 2,854 passed / 40 failed and explicitly includes suite `Binary smoke tests`, test `--doctor runs and reports diagnostics`, with error signature `binary smoke test`. The current repository-wide run has 3,273 passed / 1 failed. Its sole failure is that recorded suite/test/time-out class; 39 baseline failures are absent. No new or causally changed repository-wide failure fingerprint was observed.

## Scoped Fingerprint Disposition

| Scoped fingerprint | Result | Exact evidence |
|---|---|---|
| `discovery-runtime-cache-fingerprint-lkg-unwired` | RESOLVED | `OpenCodeRunnerAdapterImpl.constructor` defaults to `createDefaultOpenCodeInventoryDiscovery(productionDiscoveryDependencies)`. That factory owns one cache and scope-keyed LKG stores, invokes `collectOpenCodeDiscoveryContext`, hashes the schema-2 DTO, and derives LKG scope from runner realpath plus canonical project/workspace roots. The focused default-composition test exercises config, auth, plugin, workspace, runner, project, value-only credential, and LKG-path behavior. |
| `opencode-timeout-not-hard-bounded` | RESOLVED | `createNodeOpenCodeCommandRunner` settles before sending `SIGTERM`, while the 250 ms `SIGKILL` timer is cleanup-only. Its focused test is pending at 14,999 ms, resolves at 15,000 ms, and observes `SIGKILL` at 15,250 ms. `createDefaultOpenCodeInventoryDiscovery` captures one `deadlineAt`, passes remaining time to version and verbose work, races the entire composition against the absolute timer, aborts losing work, and suppresses late rejection/commit. |
| `required-regression-matrix-incomplete` | **RECURRENT — EXHAUSTED** | Deadline and reverse-plan tests pass, but the only mounted `DeckApp` test asserts the initial splash and performs no deferred transition or action. Coordinator-only tests cover latest result/project identity and empty Retry/Back, contrary to the replan rule that extracted coordinator tests supplement rather than replace mounted integration. Default composition also lacks a relevant credential presence-change invalidation assertion. |

**Scoped Fingerprint Recurrences**: `required-regression-matrix-incomplete`  
**New Fingerprints**: none

## Source and Reference Trace

| Required trace | Result | Evidence |
|---|---|---|
| Production composition | PASS | Constructor reference at `runner-adapter.ts:224-225` selects the default factory unless the explicit full-discovery override is supplied; the default factory directly calls context collection, fingerprinting, LKG scope construction, and inventory discovery. |
| Complete safe context | PASS | `collectOpenCodeDiscoveryContext` returns schema 2 with runner path/stat/version, canonical project/workspace roots, ordered config states, auth stat without digest, plugin states, control environment, and sorted credential `{name,present}` only. |
| Real scoped LKG | PASS | `buildLastKnownGoodScopeKey` hashes schema 2 plus runner realpath, project root, and workspace root; production factory uses that key under the configured cache root. |
| One public 15,000 ms deadline | PASS | Default factory captures `startedAt`/`deadlineAt` once, bounds version by `min(2,000, remaining)`, forwards the same signal/deadline to verbose discovery, and races all work against the original 15,000 ms timer. |
| Immediate settlement / independent cleanup | PASS | Process runner's timeout path calls `settle(null, "SIGTERM")`, then sends `SIGTERM`, then independently schedules `SIGKILL`; late close/error are settle-once. |
| Two-plan isolation | PASS | `developer-team-install.test.ts:1400+` builds plan A and plan B independently and applies B before A. Production methods bind immutable native plan/validation state in `#planBindings` and retrieve by exact plan object. |
| Mounted `DeckApp` transition integration | **FAIL** | `app.opencode-discovery.test.tsx:6-14` has one synchronous `renderToString` splash assertion. References to `DeckApp` from that file show no loading→ready/empty/stale/blocked, Retry/Back, completion-order, or identity transition. |
| Coordinator supplement | PASS, insufficient alone | `opencode-discovery.test.ts` proves both completion orders, project identity rejection, loading/latest-result behavior, and empty Retry/Back on the extracted coordinator/action helpers. |

## Task Completion

| Task | Result | Verification |
|---|---|---|
| 0.1 Runner-neutral discovery/write contracts | PASS | Prior completion retained; typecheck and full suites pass |
| 0.2 Hermetic fixtures/injected seams | PASS | Focused hermetic matrix passes |
| 1.1 Bounded command/parser | PASS | Exact deadline/process/parser tests pass |
| 1.2 Fingerprinted cache/LKG | PASS | Focused cache/LKG and source trace pass |
| 1.3 Runner-only normalization | PASS | Focused inventory matrix passes |
| 2.1 Async adapter/exact validation | PASS | Adapter/TUI suites pass |
| 2.2 Preserve reads/native variants | PASS | Persistence and install suites pass |
| 2.3 Pi isolation | PASS | Broader suites pass with no new fingerprint |
| 3.1 Async TUI states/rescan | PASS | Existing TUI/coordinator behavior passes |
| 4.1 Deterministic matrix | PASS | Original task's retained matrix passes |
| R1 Production-discovery boundary repair | **FAIL** | Required mounted `DeckApp` transition matrix and default-composition credential-presence invalidation proof are absent |

## Requirement Compliance Matrix

| Requirement | Result | Verification |
|---|---|---|
| REQ-INV-001 | PASS | Runner-only inventory tests/source trace |
| REQ-INV-002 | PASS | Exact parser/inventory membership matrix |
| REQ-INV-003 | PASS | Built-in/custom/plugin/alias fixtures |
| REQ-INV-004 | PASS | Valid empty inventory tests |
| REQ-VAR-001 | PASS | Exact ordered final-key tests |
| REQ-VAR-002 | PASS | No normalization/synthesis tests |
| REQ-VAR-003 | PASS | Zero-variant picker/write tests |
| REQ-VAR-004 | PASS | Model-domain recomputation tests |
| REQ-META-001 | PASS | Enrichment authority tests |
| REQ-META-002 | PASS | Malformed/conflicting metadata isolation |
| REQ-DISC-001 | PASS | 14,999/15,000 settlement and absolute outer deadline evidence |
| REQ-DISC-002 | PASS | Cache freshness boundary tests |
| REQ-DISC-003 | PASS | Schema-2 source trace includes required non-secret identity/context fields |
| REQ-DISC-004 | PASS | Production default-composition invalidation plus source trace |
| REQ-DISC-005 | PASS | Eligible LKG tests |
| REQ-DISC-006 | PASS | Ineligible/privacy/compatibility tests |
| REQ-DISC-007 | PASS | Timeout/failure/malformed blocked-state tests |
| REQ-DISC-008 | PASS | Stale changed-write rejection tests |
| REQ-DISC-009 | PASS | Rescan/network separation tests |
| REQ-ASG-001 | PASS | Non-destructive persistence tests |
| REQ-ASG-002 | PASS | Precise unavailable-state tests |
| REQ-ASG-003 | PASS | Changed-agent-only merge tests |
| REQ-ASG-004 | PASS | Exact changed-model validation |
| REQ-ASG-005 | PASS | Case-sensitive variant validation |
| REQ-ASG-006 | PASS | Model-change variant clearing |
| REQ-ADP-001 | PASS | Runner-neutral port/types |
| REQ-ADP-002 | PASS | Pi anti-regression suite |
| REQ-ADP-003 | PASS | Cross-runner isolation tests |
| REQ-REC-001 | PASS | Provider/list reconciliation tests |
| REQ-REC-002 | PASS | Exact runner effort-key tests |
| REQ-REC-003 | PASS | Review/install and reverse-plan tests |
| REQ-TEST-001 | PASS | Injected process/clock/filesystem/environment seams; hermetic focused run |
| REQ-TEST-002 | **FAIL** | Required mounted production-composition transition matrix is incomplete |

## Scenario Compliance Matrix

| Scenario | Result | Verification |
|---|---|---|
| Runner membership is exact | PASS | Focused inventory matrix |
| All runner-resolved provider kinds are treated equally | PASS | Provider-kind fixtures |
| Successful empty runner inventory stays empty | PASS | Empty inventory tests |
| Exact per-model variant keys are selectable | PASS | Exact-key tests |
| Alias and plugin transforms remain final | PASS | Alias/plugin fixtures |
| Model with no variants has no reasoning choice | PASS | Zero-variant tests |
| Changing models changes the variant domain | PASS | TUI recomputation tests |
| Matching metadata enriches without changing authority | PASS | Enrichment tests |
| Conflicting or malformed metadata is isolated | PASS | Isolation tests |
| Authentication evidence does not filter availability | PASS | Authority/context tests |
| Fresh inventory is reused within five minutes | PASS | Cache tests |
| Five-minute boundary requires discovery | PASS | Clock-boundary tests |
| Version or executable path change invalidates immediately | PASS | Context/fingerprint source and tests |
| Workspace/config/auth/environment change invalidates immediately | PASS | Production composition plus DTO source trace |
| Discovery times out deterministically | PASS | Exact deadline tests |
| Command failure does not fail open | PASS | Blocked-state tests |
| Malformed output is rejected as a whole | PASS | Parser/inventory tests |
| Compatible LKG is shown stale | PASS | LKG tests |
| LKG boundary/compatibility enforced | PASS | LKG tests |
| Stale display cannot authorize changed writes | PASS | Validation tests |
| Successful rediscovery replaces stale state | PASS | Discovery tests |
| Normal TUI opening performs no network refresh | PASS | Rescan tests |
| Explicit refresh remains explicit and bounded | PASS | Rescan/deadline tests |
| Persisted unavailable model is preserved | PASS | Persistence tests |
| Persisted unavailable variant is distinguished | PASS | TUI state tests |
| Unrelated save preserves stale assignments | PASS | Changed-agent merge tests |
| Changed unavailable model is rejected atomically | PASS | Validation tests |
| Changed unsupported variant is rejected without mapping | PASS | Exact-key validation tests |
| Model change resolves previous variant explicitly | PASS | Model-change tests |
| Pi behavior remains unchanged | PASS | Pi suite |
| OpenCode failure does not affect Pi | PASS | Cross-runner tests |
| Provider authority changes without navigation regression | PASS | List/provider tests |
| Existing effort UI consumes runner keys | PASS | TUI exact-key tests |
| Valid assignments propagate through review/install | PASS | Install/reverse-plan tests |
| Tests remain hermetic | PASS | Injected focused matrix |
| Regression matrix is executable deterministically | **FAIL** | Required mounted `DeckApp` integration cases are absent |

## Original Finding Disposition

All original findings remain resolved except the scoped regression-matrix finding. `discovery-runtime-cache-fingerprint-lkg-unwired`, `opencode-timeout-not-hard-bounded`, `runner-variant-static-resolution-leak`, `unchanged-assignment-field-mutation`, `async-discovery-stale-response-overwrite`, `successful-empty-state-routing`, `lkg-validation-privacy-integrity`, `mutable-last-plan-cross-request-risk`, `chunked-utf8-decoding-corruption`, and obsolete terminology all have passing executable/source evidence. `required-regression-matrix-incomplete` recurs for the exact integration-evidence gap described above.

## Failure Manifest

| Field | Value |
|---|---|
| Normalized fingerprint | `required-regression-matrix-incomplete` |
| Classification | same fingerprint |
| Failing contract | REQ-TEST-002; “Regression matrix is executable deterministically”; Task R1 step 4 and GREEN criteria |
| Latest evidence | Focused command passes 140/140, but Serena source/reference trace shows `app.opencode-discovery.test.tsx` contains only one splash mount assertion; coordinator transitions are isolated-unit evidence only |
| Owner/routing hint | Final hard stop; human escalation only |
| Suspected scope | Mounted `DeckApp` production-composition transition evidence and default-composition credential-presence invalidation assertion |
| Changed files when known | `apps/cli/src/tui/app.opencode-discovery.test.tsx`; likely existing injected seams in `apps/cli/src/tui/app.tsx`; `packages/adapter-opencode/src/runner-adapter.inventory.test.ts` |
| Retry count | Override attempt 1 / 1 consumed; verification cycle 2 / 2 consumed |
| Previous attempt summary | R1 added a mount smoke test, coordinator-unit tests, default composition tests, strict deadline tests, and reverse-plan coverage, but did not add the mandated mounted deferred transition matrix |
| Generated-artifact classification | not generated |
| Next verification action | None automatic. Escalate for explicit human decision/new authorization. |

## Findings

### CRITICAL

- `required-regression-matrix-incomplete` recurs. The mandatory mounted `DeckApp` deferred transition matrix is absent; extracted coordinator tests are expressly insufficient under the Human Override Replan.

### WARNING

None.

### SUGGESTION

None.

## Governance Decision

- Human override batch R1: 1 / 1 consumed.
- Additional scoped attempts: 0.
- Verification cycles: 2 / 2 consumed.
- `evaluateRepairIncident()` result: `block` (hard verification-cycle limit and exhausted scoped fingerprint; no further override).
- Decision: blocked; escalate to a human. Automatic repair is not permitted.

## Artifact Preservation and Self-Check

- All prior report content remains above this separator.
- This appended section is labeled exactly `Final Verification Cycle 2`.
- Registry mode is deferred; Verify did not modify `state.yaml` or `events.yaml`.
- Verify modified no code, tests, or other artifacts.
- Post-write existence and byte-size are checked before return.

---

# Final Closure Exception Verification

## Closure Summary

**Incident**: `verify-review-blockers-round-1`  
**Change**: `fix-runner-model-discovery-regression`  
**Phase**: `final-closure-verify`  
**Overall Result**: FAIL — BLOCKED  
**Requirements Verified**: 32 / 33  
**Scenarios Verified**: 35 / 36  
**Tasks Verified**: 10 / 11  
**Closure Scope Verified**: 1 / 3  
**Blocking Findings**: 3  
**Registry Write**: deferred  
**Registry Intent**: phase `final-closure-verify`, status `failed`, event `final-closure-verify-failed`, artifact `verify-report.md`  
**Repair Permitted Automatically**: no

The secret-safe semantic production fingerprint scope passes. The mounted `DeckApp` evidence remains incomplete because it does not exercise reverse completion with the latest result settling first, and the obsolete cache-authority comment remains. Mandatory broader and repo-wide gates also fail with six new release-check failures caused by the closure test's process-wide `mock.module("./release-check")`. Under the authorized final-closure exception and `evaluateRepairIncident()` hard-stop priority semantics, any blocking finding or failed gate returns `block`; no Apply retry or further closure verification cycle remains.

## Governance Evaluation

| Governance input | Observed result |
|---|---|
| Closure Apply batches | 1 / 1 consumed |
| Closure Apply retries | 0 remaining |
| Closure verification cycles | 1 / 1 consumed by this run |
| Blocking finding or failed gate | Present |
| `evaluateRepairIncident()` semantic outcome | `block` |
| Decision | `blocked` |

## Mandatory Gate Results

| Gate | Result | Evidence |
|---|---|---|
| Closure-focused tests | PASS | 10 passed, 0 failed across semantic context, default production composition, and mounted `DeckApp` files |
| Full repaired matrix | PASS | 143 passed, 0 failed across the exact nine-file R1 matrix |
| `bunx tsc --noEmit` | PASS | Exit 0; no diagnostics |
| `bun test packages/adapter-opencode/src apps/cli/src/tui` | **FAIL** | 593 passed, 6 failed |
| `bun run test` | **FAIL** | 3,271 passed, 6 failed |
| `bun test` | **FAIL — REGRESSION** | 3,270 passed, 7 failed: the known Binary smoke doctor timeout plus six new release-check failures |

### Exact Baseline Comparison

The recorded/current accepted repo baseline fingerprint is `Binary smoke tests > doctor runs and reports diagnostics`. It recurred at approximately 5 seconds. Six additional failures are not in that baseline:

1. `HomeScreen release-check banner (T3.3) > renders upgrade available banner with version and item summary when newer release is found`
2. `HomeScreen release-check banner (T3.3) > renders the upgrade banner with no binary for this platform when only a foreign-platform binary ships`
3. `TUI self-update integration (T3.6) > summarizeReleaseItems reports the right set of kinds and binary platform status`
4. `TUI self-update integration (T3.6) > runReleaseCheckWithTimeout returns available when the injected fetch returns a newer descriptor`
5. `TUI self-update integration (T3.6) > runReleaseCheckWithTimeout honors the timeout and returns network-error`
6. `TUI self-update integration (T3.6) > runReleaseCheckWithTimeout returns network-error when the injected fetch returns one`

Source/reference tracing ties all six to `apps/cli/src/tui/app.opencode-discovery.test.tsx:47-51`, which installs a process-wide `mock.module("./release-check")` returning constant stub behavior. The affected symbols are imported by `apps/cli/src/tui/__tests__/tui-integration.test.tsx` and `apps/cli/src/tui/screens/home-screen.tsx`; the broad suites observe the stub rather than the real release-check implementation. This is a new, closure-caused gate regression, not a baseline match.

## Closure Scope Matrix

| Closure item | Result | Verification |
|---|---|---|
| Secret-safe semantic production fingerprint projection | PASS | `canonical`, `safeFileState`, `parseJsonc`, and `collectOpenCodeDiscoveryContext` retain allowlisted semantic provider/model/plugin/path/control strings and environment names; redact secret keys and provider `options`/`headers`; parse JSONC; hash sanitized same-stat semantic changes; track relevant credential presence; and feed `buildDiscoveryFingerprint` through default adapter composition. Focused/default-composition tests passed. |
| Mounted effect-capable `DeckApp` transition evidence | **FAIL** | The Ink harness crosses `DeckApp`, runs effects, and covers loading to ready/empty/stale/blocked plus Retry, Back, and project identity. However, its two-request test resolves the older request before the latest request, so reverse completion/latest-result behavior is not proved at the component boundary. Its global release-check mock also breaks broader suites. Coordinator-only tests cannot fill this missing mounted case. |
| Remaining comment cleanup | **FAIL** | Literal `\\n` escapes are gone, but `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx:468` still states `OpenCode returns from cache (empty in test env)`, contrary to the required runner-resolved terminology cleanup. |

## Source and Reference Trace

| Trace | Result | Evidence |
|---|---|---|
| Production context entry | PASS | `createDefaultOpenCodeInventoryDiscovery` calls `collectOpenCodeDiscoveryContext`, then `buildDiscoveryFingerprint`; the adapter-lifetime cache/LKG path consumes that fingerprint. |
| Semantic projection | PASS | `canonical` propagates semantic treatment for model/provider/plugin/path/config/control keys and environment-name values while redacting secret keys and provider options/headers. |
| JSONC and same-stat changes | PASS | `safeFileState` hashes parsed/canonicalized config content independently of file stat; tests hold stat constant while changing the model and verify a changed digest. |
| Secret/provider option values | PASS | Secret-key values and complete provider option/header values project to typed presence markers; focused tests confirm credential strings are absent. |
| Relevant credential presence | PASS | Config-referenced environment names become sorted name/presence entries; default composition invalidates when referenced presence disappears and ignores unrelated environment value changes. |
| Mounted boundary | PARTIAL | `mountDiscovery` renders `DeckApp` using an interactive Ink harness and injected adapter/project-root seams. |
| Latest-request/reverse completion | **FAIL** | The mounted test resolves request 0, then request 1; it does not settle request 1 first and later prove request 0 cannot overwrite it. |
| Release-check references | **FAIL** | The closure test's global module mock replaces symbols used by home-screen and TUI integration tests in the same Bun process. |
| Comment cleanup | **FAIL** | One obsolete cache-authority comment remains at line 468 of the screen-effort test. |

## Requirement Compliance Matrix

| Requirement | Result | Method |
|---|---|---|
| REQ-INV-001 | PASS | Runner-only inventory/source and matrix tests |
| REQ-INV-002 | PASS | Exact membership parser/inventory tests |
| REQ-INV-003 | PASS | Built-in/custom/plugin/alias fixtures |
| REQ-INV-004 | PASS | Empty discovery mounted and unit tests |
| REQ-VAR-001 | PASS | Exact final-key tests |
| REQ-VAR-002 | PASS | No synthetic/static mapping tests |
| REQ-VAR-003 | PASS | Zero-variant UI/validation tests |
| REQ-VAR-004 | PASS | Model-specific variant recomputation tests |
| REQ-META-001 | PASS | Intersection-only enrichment tests |
| REQ-META-002 | PASS | Malformed/conflicting metadata isolation tests |
| REQ-DISC-001 | PASS | Absolute 15,000 ms focused tests |
| REQ-DISC-002 | PASS | Adapter-lifetime cache boundary tests |
| REQ-DISC-003 | PASS | Semantic production fingerprint source trace and tests |
| REQ-DISC-004 | PASS | Same-stat semantics and relevant presence invalidation tests |
| REQ-DISC-005 | PASS | Compatible private LKG stale tests |
| REQ-DISC-006 | PASS | LKG age/identity/schema/privacy rejection tests |
| REQ-DISC-007 | PASS | Timeout, command failure, malformed output tests |
| REQ-DISC-008 | PASS | Stale-write rejection and rediscovery tests |
| REQ-DISC-009 | PASS | Local rescan/no implicit network refresh tests |
| REQ-ASG-001 | PASS | Non-destructive persisted assignment tests |
| REQ-ASG-002 | PASS | Distinct unavailable model/variant rendering tests |
| REQ-ASG-003 | PASS | Changed-agent-only merge tests |
| REQ-ASG-004 | PASS | Atomic unavailable-model rejection tests |
| REQ-ASG-005 | PASS | Exact unsupported-variant rejection tests |
| REQ-ASG-006 | PASS | Model-change transition tests |
| REQ-ADP-001 | PASS | Runner-neutral contract tests |
| REQ-ADP-002 | PASS | Pi anti-regression tests |
| REQ-ADP-003 | PASS | Cross-runner isolation tests |
| REQ-REC-001 | PASS | Provider-list reconciliation tests |
| REQ-REC-002 | PASS | Runner-key effort UI tests |
| REQ-REC-003 | PASS | Review/install propagation tests |
| REQ-TEST-001 | PASS | Injected process/filesystem/environment/clock and mounted seams |
| REQ-TEST-002 | **FAIL** | Mounted reverse-completion evidence is absent and mandatory broad/repo gates regress by six tests |

## Scenario Compliance Matrix

| Scenario | Result |
|---|---|
| Runner membership is exact | PASS |
| All runner-resolved provider kinds are treated equally | PASS |
| Successful empty runner inventory stays empty | PASS |
| Exact per-model variant keys are selectable | PASS |
| Alias and plugin transforms remain final | PASS |
| Model with no variants has no reasoning choice | PASS |
| Changing models changes the variant domain | PASS |
| Matching metadata enriches without changing authority | PASS |
| Conflicting or malformed metadata is isolated | PASS |
| Authentication evidence does not filter availability | PASS |
| Fresh in-process inventory is reused within five minutes | PASS |
| Five-minute boundary requires discovery | PASS |
| Version or executable path change invalidates immediately | PASS |
| Workspace, configuration, authentication, or environment change invalidates immediately | PASS |
| Discovery times out deterministically | PASS |
| Command failure does not fail open | PASS |
| Malformed runner output is rejected as a whole | PASS |
| Compatible last-known-good snapshot is shown stale | PASS |
| Last-known-good boundary and compatibility are enforced | PASS |
| Stale display cannot authorize changed writes | PASS |
| Successful rediscovery replaces stale state | PASS |
| Normal TUI opening performs no network refresh | PASS |
| Explicit refresh remains explicit and bounded | PASS |
| Persisted unavailable model is preserved | PASS |
| Persisted unavailable variant is distinguished | PASS |
| Unrelated save preserves stale assignments | PASS |
| Changed unavailable model is rejected atomically | PASS |
| Changed unsupported variant is rejected without mapping | PASS |
| Model change resolves the previous variant explicitly | PASS |
| Pi behavior remains unchanged | PASS |
| OpenCode failure does not affect Pi | PASS |
| Provider authority changes without list-navigation regression | PASS |
| Existing model-specific effort UI consumes runner keys | PASS |
| Valid assignments still propagate through review and install | PASS |
| Tests remain hermetic | PASS |
| Regression matrix is executable deterministically | **FAIL** |

## Task Completion Matrix

| Task | Result | Evidence |
|---|---|---|
| 0.1 | PASS | Shared contracts and tests pass |
| 0.2 | PASS | Hermetic fixtures/seams pass |
| 1.1 | PASS | Bounded execution/parser tests pass |
| 1.2 | PASS | Cache/LKG/fingerprint tests pass |
| 1.3 | PASS | Runner-only orchestration tests pass |
| 2.1 | PASS | Async exact validation tests pass |
| 2.2 | PASS | Native/non-destructive persistence tests pass |
| 2.3 | PASS | Pi isolation tests pass |
| 3.1 | PASS | TUI discovery/state/action tests pass |
| 4.1 | PASS | Original reconciliation matrix passes |
| R1 | **FAIL** | Closure mounted reverse-order proof remains incomplete; broad/repo gates regress |

## Findings

### CRITICAL

1. **Mandatory broader and repo-wide gates fail with six new release-check regressions.** The mounted closure test installs a process-wide release-check module mock that leaks into unrelated tests in the same Bun process. This is not the recorded Binary smoke baseline.
2. **The required mounted reverse-completion/latest-result proof remains absent.** The mounted two-request case resolves the old request first and the latest request second; it does not prove that a later old completion cannot overwrite an already-rendered latest result.
3. **The authorized comment cleanup is incomplete.** The obsolete `OpenCode returns from cache` comment remains in the screen-effort test.

### WARNING

None.

### SUGGESTION

None. No repair is authorized in this verification phase.

## Structured Failure Manifest

| Fingerprint | Contract | Latest evidence | Classification | Owner / scope | Changed files | Retry count / prior summary | Next verification action |
|---|---|---|---|---|---|---|---|
| `required-regression-matrix-incomplete` | REQ-TEST-002; mounted reverse completion/latest result | Focused mounted tests pass, but source trace shows old→new settlement only | same fingerprint / blocker | Frontend Apply; mounted DeckApp test boundary | `apps/cli/src/tui/app.opencode-discovery.test.tsx` | Closure Apply 1/1 consumed; previous cycle lacked mounted effects entirely | Human disposition only; no automatic retry |
| `closure-test-release-check-mock-leak` | Mandatory broad/package/repo gates | 593/6, 3271/6, and 3270/7; six non-baseline release-check failures | new related fingerprint / blocker | Frontend Apply; test isolation | `apps/cli/src/tui/app.opencode-discovery.test.tsx` | First observed in the sole closure verification cycle | Human disposition only; no automatic retry |
| `literal-comment-cleanup-incomplete` | Authorized closure cleanup / Design file-impact requirement | Source line 468 retains cache-authority wording | blocker | Frontend Apply; test comment only | `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` | Closure Apply 1/1 claimed completion; stale wording remains | Human disposition only; no automatic retry |

All listed files are `not_generated`.

## Final Decision

**Status**: failed  
**Decision**: blocked  
**Registry Intent Event**: `final-closure-verify-failed`  
**Repair Permitted Automatically**: no  
**Blockers**: six new release-check gate regressions, incomplete mounted reverse-completion proof, and incomplete comment cleanup.

## Artifact Preservation and Self-Check

- The complete prior 52,504-byte report prefix is preserved with SHA-256 `9cea6f4a8cc47035f18f5baebe0eee580b14649458f7dbb41215289cd141ed9c`.
- This appended heading is exactly `Final Closure Exception Verification`.
- Registry mode is deferred; Verify did not modify `state.yaml` or `events.yaml`.
- Verify intentionally modified only `verify-report.md`; no code, tests, state, events, or other artifacts were changed.
- Post-write existence, byte size, prefix hash, changed-file scope, and appended-heading uniqueness are checked before return.
## Separately Authorized Corrective Verification

### Summary

**Phase**: `separately-authorized-corrective-verify`  
**Overall Result**: **FAIL**  
**Requirements Verified**: 33 / 33  
**Scenarios Verified**: 36 / 36  
**Tasks Verified**: 11 / 11  
**Corrective Scope Verified**: 2 / 3  
**Registry Write**: deferred  
**Registry Intent**: phase `separately-authorized-corrective-verify`, status `failed`, event `corrective-verify-failed`, artifact `verify-report.md`

Fresh executable verification passes every requested focused, mounted same-process, typecheck, affected-area, package, and repaired-matrix gate. Repository-wide `bun test` has exactly the known baseline failure, `Binary smoke tests > doctor runs and reports diagnostics`, and no new executable failure. Source tracing also confirms the default production fingerprint composition and the actual mounted `DeckApp` boundary.

Final verification nevertheless fails because the separately authorized third corrective item is incomplete: process-wide release-check mock leakage is gone, but `packages/adapter-opencode/src/runner-adapter.ts:106-109` still says production reads the “real OpenCode cache” through `loadModelInventory()`. That is the obsolete cache-authority wording this corrective scope required to remove. No code or artifact other than this appended report was modified.

### Mandatory Gate Results

| Gate | Result | Fresh evidence |
|---|---|---|
| Corrective focused backend tests | PASS | `bun test packages/adapter-opencode/src/model-discovery-context.test.ts packages/adapter-opencode/src/runner-adapter.inventory.test.ts` — 10 passed, 0 failed, 2 files |
| Mounted DeckApp + release-check/home-screen/TUI integration, same process | PASS | `bun test apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/screens/home-screen.test.tsx apps/cli/src/tui/__tests__/tui-integration.test.tsx` — 40 passed, 0 failed, 3 files |
| Full repaired focused matrix | PASS | Exact nine-file R1 command — 148 passed, 0 failed, 9 files |
| Typecheck | PASS | `bunx tsc --noEmit` — exit 0, no diagnostics |
| Broader adapter/TUI tests | PASS | `bun test packages/adapter-opencode/src apps/cli/src/tui` — 604 passed, 0 failed, 44 files |
| Package test script | PASS | `bun run test` — 3,282 passed, 0 failed, 173 files |
| Repository-wide tests | BASELINE-MATCHING FAILURE | `bun test` — 3,281 passed, 1 failed, 1 error, 173 files; only `Binary smoke tests > doctor runs and reports diagnostics`, timed out after 5,000 ms |
| Serena diagnostics | PASS | No warning/error diagnostics in `model-discovery-context.ts`, `runner-adapter.ts`, `app.tsx`, or `app.opencode-discovery.test.tsx` |

### Exact Baseline Comparison

`openspec/baseline-health.yaml` records the `Binary smoke tests` suite, test `--doctor runs and reports diagnostics`, and error signature `binary smoke test` as known. The fresh repository-wide run produced the same suite/test timeout class at 5,000 ms. The baseline ledger's old aggregate is 2,854 passed / 40 failed; the current run is 3,281 passed / 1 failed. All other recorded failures are absent, and no new failure fingerprint appeared.

### Corrective Scope

| Corrective item | Result | Evidence |
|---|---|---|
| 1. Closed typed secret-safe semantic fingerprint projection | PASS | `collectOpenCodeDiscoveryContext` emits schema 2 context from JSON/JSONC and virtual config projections; tests prove same-stat semantic changes, virtual environment/plugin references, relevant credential presence, and digest independence from credential values. Default production composition passes that context to `buildDiscoveryFingerprint`. |
| 2. Mounted effect-capable DeckApp reverse-completion/latest-result and Back evidence | PASS | `mountDiscovery` renders the actual imported `DeckApp` with interactive Ink input. The reverse-completion test resolves project B first and proves late project A cannot replace it. The mounted empty-state test selects Back and reaches `Select an agent to configure`. |
| 3. Release-check mock leakage and obsolete cache-authority wording removal | FAIL | Same-process mounted/release/home/TUI tests pass and no `mock.module(...release-check...)` remains in the mounted test. However, `runner-adapter.ts:106-109` still states that production reads the real OpenCode cache via `loadModelInventory()`. |

### Source and Reference Trace

1. `createDefaultOpenCodeInventoryDiscovery` in `packages/adapter-opencode/src/runner-adapter.ts` resolves the executable and version, calls `collectOpenCodeDiscoveryContext`, passes the result to `buildDiscoveryFingerprint`, derives the LKG scope from runner/project/workspace identity, and passes both `fingerprint` and `context` to `discoverModelInventory`.
2. Serena reference tracing finds the production call to `collectOpenCodeDiscoveryContext` at `runner-adapter.ts:185-186`; the only other reference is its focused test.
3. `collectOpenCodeDiscoveryContext` reads JSON and JSONC candidates, projects `OPENCODE_CONFIG_CONTENT`, resolves plugin references, records safe file state, strips auth digests, and records only credential environment names plus Boolean presence.
4. `mountDiscovery` dynamically imports and renders the actual `DeckApp` with an injected adapter, release-check function, project-root resolver, and effect-capable interactive Ink harness.
5. `DeckApp/startOpenCodeModelDiscovery` routes immediately to `opencode-model-discovery`, applies coordinator emissions, and advances only the applied latest ready/stale completion. The mounted reverse-order test confirms stale completion suppression at this component boundary.
6. The mounted Back test drives the empty discovery menu with keyboard input and verifies navigation back to the agent configuration list.

### Requirement Compliance Matrix

| Requirement | Result | Verification |
|---|---|---|
| REQ-INV-001 | PASS | Runner-only inventory tests and focused matrix |
| REQ-INV-002 | PASS | Exact membership/provider derivation tests |
| REQ-INV-003 | PASS | Built-in/custom/plugin/alias fixture coverage |
| REQ-INV-004 | PASS | Empty inventory and mounted empty-state coverage |
| REQ-VAR-001 | PASS | Exact ordered runner variant tests |
| REQ-VAR-002 | PASS | No synthetic/cache/hardcoded variant tests |
| REQ-VAR-003 | PASS | Zero-variant UI and persistence tests |
| REQ-VAR-004 | PASS | Model-specific recomputation tests |
| REQ-META-001 | PASS | Metadata enrichment authority tests |
| REQ-META-002 | PASS | Malformed/conflicting metadata isolation tests |
| REQ-DISC-001 | PASS | Exact 15,000 ms bounded timeout tests |
| REQ-DISC-002 | PASS | 4:59 reuse and 5:00 expiry tests |
| REQ-DISC-003 | PASS | Semantic secret-safe production context tests and source trace |
| REQ-DISC-004 | PASS | Runner/project/config/auth/plugin/credential-presence invalidation tests |
| REQ-DISC-005 | PASS | Eligible runner-origin LKG tests |
| REQ-DISC-006 | PASS | Expired/incompatible/malformed/non-runner LKG rejection tests |
| REQ-DISC-007 | PASS | Timeout/command/malformed blocked-state tests |
| REQ-DISC-008 | PASS | Stale changed-write rejection tests |
| REQ-DISC-009 | PASS | Normal-versus-explicit refresh tests |
| REQ-ASG-001 | PASS | Persisted stale assignment preservation tests |
| REQ-ASG-002 | PASS | Model-versus-variant unavailable-state tests |
| REQ-ASG-003 | PASS | Unchanged assignment field preservation tests |
| REQ-ASG-004 | PASS | Changed model atomic rejection tests |
| REQ-ASG-005 | PASS | Exact changed variant rejection tests |
| REQ-ASG-006 | PASS | Model-change variant transition tests |
| REQ-ADP-001 | PASS | Per-runner adapter contract tests |
| REQ-ADP-002 | PASS | Pi focused anti-regression tests |
| REQ-ADP-003 | PASS | Cross-runner failure isolation tests |
| REQ-REC-001 | PASS | Runner authority and long-list navigation tests |
| REQ-REC-002 | PASS | Exact/empty runner effort-key tests |
| REQ-REC-003 | PASS | Review/install propagation tests |
| REQ-TEST-001 | PASS | Injected command/clock/filesystem/environment/component seams |
| REQ-TEST-002 | PASS | Full repaired nine-file matrix plus mounted corrective evidence |

### Scenario Compliance Matrix

| Scenario | Result | Verification |
|---|---|---|
| Runner membership is exact | PASS | Focused inventory tests |
| All runner-resolved provider kinds are treated equally | PASS | Provider-kind fixtures |
| Successful empty runner inventory stays empty | PASS | Empty-state tests |
| Exact per-model variant keys are selectable | PASS | Variant tests |
| Alias and plugin transforms remain final | PASS | Alias/plugin fixtures |
| Model with no variants has no reasoning choice | PASS | Zero-variant tests |
| Changing models changes the variant domain | PASS | TUI model-change tests |
| Matching metadata enriches without changing authority | PASS | Metadata tests |
| Conflicting or malformed metadata is isolated | PASS | Metadata isolation tests |
| Authentication evidence does not filter availability | PASS | Runner/auth disagreement tests |
| Fresh in-process inventory is reused within five minutes | PASS | Cache boundary tests |
| Five-minute boundary requires discovery | PASS | Cache boundary tests |
| Version or executable path change invalidates immediately | PASS | Default composition tests |
| Workspace, configuration, authentication, or environment change invalidates immediately | PASS | Semantic context and default composition tests |
| Discovery times out deterministically | PASS | Deadline tests |
| Command failure does not fail open | PASS | Blocked-state tests |
| Malformed runner output is rejected as a whole | PASS | Parser/normalization tests |
| Compatible last-known-good snapshot is shown stale | PASS | LKG tests |
| Last-known-good boundary and compatibility are enforced | PASS | LKG rejection tests |
| Stale display cannot authorize changed writes | PASS | Validation tests |
| Successful rediscovery replaces stale state | PASS | Coordinator/discovery tests |
| Normal TUI opening performs no network refresh | PASS | Refresh-separation tests |
| Explicit refresh remains explicit and bounded | PASS | Rescan tests |
| Persisted unavailable model is preserved | PASS | Assignment read tests |
| Persisted unavailable variant is distinguished | PASS | Assignment state tests |
| Unrelated save preserves stale assignments | PASS | Install merge tests |
| Changed unavailable model is rejected atomically | PASS | Changed model tests |
| Changed unsupported variant is rejected without mapping | PASS | Exact variant validation tests |
| Model change resolves the previous variant explicitly | PASS | Model-transition tests |
| Pi behavior remains unchanged | PASS | Pi focused tests |
| OpenCode failure does not affect Pi | PASS | Isolation tests |
| Provider authority changes without list-navigation regression | PASS | Reconciliation/TUI tests |
| Existing model-specific effort UI consumes runner keys | PASS | Effort selector tests |
| Valid assignments still propagate through review and install | PASS | Install propagation tests |
| Tests remain hermetic | PASS | Injected seams and fixture-only execution |
| Regression matrix is executable deterministically | PASS | Fresh focused and broader runs |

### Task Completion

| Task | Result | Evidence |
|---|---|---|
| 0.1 | PASS | Shared runner inventory contract verified |
| 0.2 | PASS | Hermetic fixtures and injected seams verified |
| 1.1 | PASS | Runner discovery and timeout verified |
| 1.2 | PASS | Cache/fingerprint/LKG behavior verified |
| 1.3 | PASS | Runner-only normalization verified |
| 2.1 | PASS | Adapter inventory contract verified |
| 2.2 | PASS | Assignment preservation/native variant writes verified |
| 2.3 | PASS | Pi semantics and isolation verified |
| 3.1 | PASS | TUI discovery/assignment behavior verified |
| 4.1 | PASS | Reconciliation and regression matrix verified |
| R1 | PASS | Production boundary, timeout, plan binding, and mounted composition evidence verified |

### Findings

#### CRITICAL

1. **Corrective scope item 3 is incomplete.** `packages/adapter-opencode/src/runner-adapter.ts:106-109` retains obsolete cache-authority wording: production is said to read the “real OpenCode cache” via `loadModelInventory()`. This directly contradicts the separately authorized corrective scope and prevents Archive readiness. Remove or replace that wording, then rerun the requested verification gates.

#### WARNING

None.

#### SUGGESTION

None.

### Final Decision

**Status**: failed  
**New executable failures**: none  
**Known baseline failure**: `Binary smoke tests > doctor runs and reports diagnostics` only  
**Archive Ready**: no  
**Blocker**: incomplete removal of obsolete cache-authority wording in `runner-adapter.ts:106-109`

---

# Corrective Retry Final Verification

## Summary

**Phase**: `corrective-retry-final-verify`  
**Overall Result**: **PASS**  
**Requirements Verified**: 33 / 33  
**Scenarios Verified**: 36 / 36  
**Tasks Verified**: 11 / 11  
**Registry Write**: deferred  
**Registry Intent**: phase `verify`, status `passed`, event `corrective-retry-verify-passed`, artifact `verify-report.md`  
**Archive Ready**: yes

The separately authorized corrective retry resolves the final fingerprint gap and obsolete wording blocker. Fresh focused, repaired-matrix, typecheck, affected-area, package, and repository-wide verification introduced no new failure. The repository-wide result contains only the accepted baseline fingerprint, `Binary smoke tests > doctor runs and reports diagnostics`.

## Corrective Scope Results

| Corrective item | Result | Fresh evidence |
|---|---|---|
| Embedded `{env:NAME}` references are extracted from JSON before redaction | PASS | Focused source trace shows `projectConfig` invokes `collectEmbeddedEnvironmentReferences` before `projectRootConfig`; focused test passes. |
| Embedded references are extracted from JSONC before redaction | PASS | JSONC fixture with an embedded authorization reference yields normalized `JSONC_EMBEDDED_TOKEN`; focused test passes. |
| Embedded references are extracted from virtual config before redaction | PASS | `projectInlineConfig` parses `OPENCODE_CONFIG_CONTENT` through `projectConfig`; focused virtual-config test passes. |
| Fingerprint receives normalized names/presence, never secret values | PASS | Names are uppercased and validated by `normalizeEnvironmentName`; context emits sorted `{ name, present }` entries. Assertions prove all supplied secret values are absent from the context. |
| Presence changes invalidate; value-only changes do not | PASS | Focused tests prove present versus absent fingerprints differ and first-secret versus second-secret fingerprints match for file-backed and virtual config references. |
| Obsolete cache-authority comment is gone | PASS | Serena search finds no `real OpenCode cache`, `loadModelInventory()`, `cache-authority`, `cache authoritative`, or `cache authority` wording in `runner-adapter.ts`; the prior blocking comment is absent. |
| Previous fingerprint, TUI, mounted-coordinator, release-check mock, assignment, and Pi fixes remain intact | PASS | Full repaired matrix, affected adapter/TUI suite, package suite, and repository-wide baseline comparison all retain prior behavior without a new failure fingerprint. |

## Mandatory Gate Results

| Gate | Result | Fresh evidence |
|---|---|---|
| Corrective focused tests | PASS | `bun test packages/adapter-opencode/src/model-discovery-context.test.ts --test-name-pattern 'records embedded references'` — 2 passed, 0 failed, 1 file |
| Full repaired matrix | PASS | Exact required nine-file command — 151 passed, 0 failed, 9 files |
| Typecheck | PASS | `bunx tsc --noEmit` — exit 0, no diagnostics |
| Broader adapter/TUI tests | PASS | `bun test packages/adapter-opencode/src apps/cli/src/tui` — 607 passed, 0 failed, 44 files |
| Package tests | PASS | `bun run test` — 3,285 passed, 0 failed, 173 files |
| Repository-wide tests | BASELINE-MATCHING FAILURE | `bun test` — 3,284 passed, 1 failed, 173 files; only `Binary smoke tests > doctor runs and reports diagnostics`, timed out after 5,000 ms |

## Baseline Comparison

The sole repository-wide failure exactly matches the previously accepted binary-doctor timeout fingerprint. No release-check, TUI, OpenCode adapter, fingerprint, mock-isolation, assignment, or Pi failure appeared. Therefore the repository-wide non-zero exit is baseline-matching and introduces no new failure.

## Compliance Closure

All 33 requirements and all 36 acceptance scenarios remain verified by the existing compliance matrices plus the fresh corrective and broad-gate evidence above. All ten original tasks and Task R1 are complete. In particular, REQ-DISC-003 and REQ-DISC-004 now have direct executable evidence for embedded file-backed JSON/JSONC and virtual-config environment references, secret-safe normalized name/presence fingerprint inputs, immediate invalidation on presence change, and stability on value-only change. REQ-TEST-002 remains covered by the 151-test repaired matrix and the broader passing suites.

## Findings

### CRITICAL

None.

### WARNING

None.

### SUGGESTION

None.

## Final Decision

**Status**: passed  
**New Failures**: none  
**Known Baseline Failure**: `Binary smoke tests > doctor runs and reports diagnostics` only  
**Archive Ready**: yes  
**Blockers**: none
