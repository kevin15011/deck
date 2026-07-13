# Review Report: Fix Runner Model Discovery Regression

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: backend, frontend, integration  
**Files Reviewed**: 26 changed code/test/fixture files, plus 4 official OpenSpec artifacts  
**Fresh-Context Method**: Two independent risk slices were completed: (A) backend/security and (B) TUI/compatibility. Adaptive memory was loaded only as advisory context; the listed OpenSpec artifacts and current working-tree diff remained authoritative.

The implementation establishes useful runner-neutral contracts, exact model lookup, runner-key parsing, and text-based TUI states. It is not ready to approve. The production adapter does not actually retain the five-minute cache or wire the LKG, its fingerprint omits required runtime identity, subprocess limits are not hard, and several UI/persistence paths still consult legacy static reasoning logic or mutate unchanged assignments. The focused tests are hermetic but do not exercise most of the required failure, concurrency, persistence, and full-state-flow matrix.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ❌ Weak | Cache/LKG components exist but are not composed into the production adapter; dynamic variant authority is bypassed by a legacy resolver. |
| Correctness | ❌ Weak | Async results can arrive out of order, successful empty discovery is routed away from its empty state, and selected runner variants can be silently discarded. |
| Security / Privacy | ❌ Weak | Process termination and output bounds are not hard; LKG validation is not an allowlist. |
| Scalability / Performance | ❌ Weak | Every production request creates a new cache and can start another expensive runner process; in-flight coalescing is therefore ineffective. |
| Maintainability | ⚠️ Adequate | Module boundaries are promising, but mutable adapter-wide plan state and misleading legacy test commentary increase coupling and review cost. |
| Code Quality | ⚠️ Adequate | Most names are clear, but compact one-line lifecycle code obscures resource-state distinctions. |
| Backend | ❌ Weak | Discovery, cache, fingerprint, LKG, and unchanged-assignment invariants are incomplete. |
| Frontend | ❌ Weak | State rendering is readable and text-based, but sequencing and model/variant transition behavior are unsafe. |
| Integration | ❌ Weak | The dynamic inventory contract is not consistently authoritative through TUI selection, plan construction, and persistence. |
| Test Quality / Hermeticity | ❌ Weak | Tests avoid live runner/home/network access, but the required adversarial matrix is largely absent. |
| Backward Compatibility | ❌ Weak | An unchanged native `variant` assignment can gain a legacy `reasoningEffort` field. |
| Scope Control | ⚠️ Adequate | Production changes are related to the change; stale cache-authority tests/comments remain and obscure the intended authority boundary. |
| Economy / Critical Judgment | ⚠️ Adequate | The large replacement is justified by the security and compatibility surface, but several abstractions are currently dead or disconnected in production. |

## Slice A — Backend and Security

### Inspected Risk Areas

- Literal shell-free command vector and executable resolution.
- Timeout, termination, stdout/stderr, record, block, ID, and variant bounds.
- Whole-result parser rejection and exact runner variant keys.
- Fingerprint secret handling and invalidation inputs.
- Five-minute cache, LRU, rescan, in-flight coalescing, failed-rescan behavior, and 24-hour LKG.
- LKG content shape, permissions, atomic replacement, and compatibility checks.
- Exact changed-assignment validation, apply-time revalidation, native `variant` writes, and unchanged assignment preservation.
- Pi isolation and integration with overlapping model-effort behavior.

### Result

**Changes requested.** Exact model lookup and basic all-or-nothing parsing are sound, and no shell interpolation is used. However, production composition bypasses the intended cache/LKG architecture, process bounds can hang or overrun, LKG shape validation is permissive, and unchanged native assignments are not preserved byte-for-value.

## Slice B — TUI and Compatibility

### Inspected Risk Areas

- Loading, ready, empty, stale, and blocked transitions.
- Retry/Back keyboard reachability and text-not-color status communication.
- Concurrent/rescan result ordering and state closure freshness.
- Exact model-specific variants and zero-variant behavior.
- Unavailable model versus unavailable variant labels.
- Dirty-agent tracking, stale write blocking, and pre-apply validation.
- Persisted native/legacy assignment compatibility and Pi isolation.

### Result

**Changes requested.** The new screens provide clear terminal text, keyboard-selectable Retry/Back actions, stale timestamps, distinct unavailable labels, and a clear zero-variant message. The full flow is still unsafe: discovery has no request-generation guard, empty success is routed away from the empty screen, and the chosen live variant is passed through static cache/catalog reasoning logic before persistence.

## Findings

### Critical

None.

### High — Blocking

1. **Architecture / Performance — The production adapter recreates the cache for every discovery and never wires the LKG or a complete fingerprint.**
   - **File / Symbol**: `packages/adapter-opencode/src/runner-adapter.ts` — `OpenCodeRunnerAdapterImpl.constructor`; `packages/adapter-opencode/src/model-inventory.ts` — `discoverModelInventory`.
   - **Evidence**: The default adapter calls `discoverModelInventory` without a shared `ModelInventoryCache`, `readLastKnownGood`, or `writeLastKnownGood`. `discoverModelInventory` consequently constructs `new ModelInventoryCache(...)` per call. Its default fingerprint contains only literal `"opencode"`, workspace, and environment-name presence; it omits resolved/real executable identity, stat/version, config, auth, and plugin state.
   - **Impact**: The five-minute TTL, eight-entry LRU, in-flight coalescing, compatible 24-hour LKG, and immediate identity invalidation do not operate in production. Every validation/open/rescan can launch another 15-second process.
   - **Repair**: Own one cache and LKG store per adapter/service scope; resolve and fingerprint real executable path/stat/version plus safe config/auth/plugin/environment-presence signals; inject the same instances into every discovery; wire LKG read/write at the specified private cache location. Add production-composition tests, not only unit tests of disconnected classes.

2. **Security / Resource Bounds — Subprocess timeout and output limits are not hard.**
   - **File / Symbol**: `packages/adapter-opencode/src/opencode-models-cli.ts` — `nodeOpenCodeCommandRunner`, `discoverOpenCodeModels`.
   - **Evidence**: Timeout only sends `SIGTERM`; there is no bounded grace period or `SIGKILL` escalation, so a process that ignores SIGTERM leaves the Promise pending indefinitely. Data handlers test the buffer size before appending and do not immediately terminate/classify the chunk that crosses the bound. Any SIGTERM/SIGKILL is later classified as `timeout`, including an output-limit termination or a runner's own signal exit.
   - **Impact**: A faulty/plugin-influenced child can exceed the 15,000 ms contract, retain resources indefinitely, and blur output-limit failures into timeout diagnostics.
   - **Repair**: Track explicit termination reason, reject/stop appending on the first crossing chunk, settle deterministically, send SIGTERM once, escalate to SIGKILL after a short bounded grace period, and ensure close/error races settle once. Use `StringDecoder` or buffered byte accumulation for UTF-8. Test exact-deadline timeout, ignored SIGTERM, one termination request, oversized single/multiple chunks, stderr limits, and signal/error races with an injected fake process/clock.

3. **Integration / Correctness — Live runner variants are silently passed through legacy static reasoning resolution.**
   - **File / Symbol**: `apps/cli/src/tui/app.tsx` — model-selection and `agent-model-assignment` handlers around lines 1885–1953; `packages/adapter-opencode/src/runner-adapter.ts` — `resolveThinking`; `packages/adapter-opencode/src/model-config.ts` — `resolveThinkingForOpenCodeModel`.
   - **Evidence**: The picker correctly obtains exact keys from `getThinkingLevels`, but both defaulting and commit call `adapter.resolveThinking`. OpenCode delegates that call to `resolveThinkingForOpenCodeModel`, which determines support from the legacy static cache/catalog. A runner-only model, or a model whose static metadata disagrees, can show a valid runner variant and then persist it as unset.
   - **Impact**: Runner authority is lost at the final UI-to-write boundary without an error; users can select a key that is silently discarded.
   - **Repair**: For OpenCode, commit the exact selected key from the current ready inventory without legacy canonicalization/default mapping. Keep Pi's fixed resolver separate. Derive summary support from live variant presence. Add an interaction test using a runner-only model and non-canonical key that asserts the exact key reaches validation and native persistence.

4. **Backward Compatibility / Data Safety — Unchanged native assignments can be mutated with a legacy field.**
   - **File / Symbol**: `packages/adapter-opencode/src/developer-team-install.ts` — `buildAgentEntry`; `packages/adapter-opencode/src/config-merge.ts` — `mergeConfig`.
   - **Evidence**: For every unchanged agent, `buildAgentEntry` may emit `reasoningEffort` from `thinkingAssignments`; `mergeConfig` spreads this over the existing entry while preserving an existing `variant`. Only changed agents take the native-variant branch that deletes `reasoningEffort`.
   - **Impact**: An unrelated save can change `{ variant: "max" }` into `{ variant: "max", reasoningEffort: "max" }`, violating assignment-field byte-for-value preservation and creating ambiguous persisted configuration.
   - **Repair**: Do not emit any assignment fields for unchanged agents; merge model/variant changes only for `changedAgentIds`. Preserve the raw prior `model`, `variant`, and `reasoningEffort` fields untouched for all others. Add merge-level tests for native-only, legacy-only, both-field, unavailable-model, and unavailable-variant unchanged assignments.

5. **Frontend / Concurrency — Async discovery has no latest-request guard and can overwrite newer state.**
   - **File / Symbol**: `apps/cli/src/tui/app.tsx` — `detectOpenCodeModelInventoryForTui`, `startOpenCodeModelDiscovery`.
   - **Evidence**: Every completion unconditionally writes discovery, provider, model, assignment, cursor, and screen state. There is no request generation/token, cancellation, mounted check, or comparison against the active project/runtime. Because the production cache is also recreated, repeated `r` requests can run concurrently rather than coalescing.
   - **Impact**: An older stale/blocked/ready response can replace a newer response and route the user to the wrong screen or display an obsolete variant domain.
   - **Repair**: Maintain a monotonically increasing request generation (or AbortController where supported), apply results only for the latest generation/runtime/project, and coalesce at the adapter. Compute assignment state from explicit assignment snapshots passed to the request rather than render-closure values. Add deferred-Promise tests resolving requests in both orders.

6. **Frontend / Empty-State Correctness — Successful empty discovery does not remain on the explicit empty screen.**
   - **File / Symbol**: `apps/cli/src/tui/app.tsx` — `startOpenCodeModelDiscovery`, `OpenCodeModelDiscoveryScreen` render mapping.
   - **Evidence**: `buildTuiInventoryFromDiscoveryResult` returns `kind: "empty"`, but `startOpenCodeModelDiscovery` routes only `ready`/`stale` and leaves cursor/screen behavior dependent on the current discovery screen. The render call also contains an impossible `ready -> empty` coercion instead of directly handling `empty`. In entry flows, zero-provider success is not routed through the established no-provider or explicit-empty transition consistently.
   - **Impact**: The successful zero-model case can leave users on a loading/discovery route with inconsistent navigation rather than presenting a stable, actionable empty state.
   - **Repair**: Make `empty` an explicit transition that remains on `opencode-model-discovery` with Retry/Back, remove the `ready -> empty` coercion, and test the full DeckApp transition from deferred loading to empty plus Retry and Back.

7. **Security / Privacy — LKG validation accepts non-allowlisted fields and incomplete compatibility state.**
   - **File / Symbol**: `packages/adapter-opencode/src/model-inventory-cache.ts` — `isNormalizedInventory`, `LastKnownGoodStore.read/write`.
   - **Evidence**: `isNormalizedInventory` checks a few required fields but permits arbitrary extra properties at inventory, provider, and model levels. It does not re-normalize to a safe schema, validate canonical/provider/model relationships and bounds, reject future timestamps, or verify directory privacy. `mkdir(..., 0o700)` and `writeFile(..., 0o600)` do not repair existing permissive paths; the deterministic temporary name can collide under concurrent writes.
   - **Impact**: A malformed, future-dated, or accidentally secret-bearing snapshot can be accepted and returned. Once production LKG wiring is added, this becomes a privacy and integrity boundary.
   - **Repair**: Parse into a closed allowlisted DTO, reject unknown fields or reconstruct only safe fields, rerun parser-equivalent bounds/identity checks, reject timestamps outside `[now-24h, now]`, verify/repair directory and file modes without following unsafe links, and use unique same-directory temporary files with cleanup and atomic rename. Add fake-filesystem tests for every case.

8. **Test Quality — The hermetic suite omits the P0 adversarial and integration matrix.**
   - **Files**: `packages/adapter-opencode/src/opencode-models-cli.test.ts`, `model-inventory-cache.test.ts`, `model-inventory.test.ts`, `runner-adapter.inventory.test.ts`, `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx`.
   - **Evidence**: Parser/process coverage has four broad tests and no exact timeout/kill/output/key/count/block/version cases. Cache coverage has two tests and no LRU, in-flight, failed-rescan, LKG, mode, privacy, or atomicity cases. TUI tests render isolated components/helpers rather than deferred full-flow state transitions. Assignment tests do not cover unchanged native-field preservation or runner-only variant persistence. These gaps directly allowed Findings 1–7.
   - **Impact**: Security, concurrency, compatibility, and transition regressions are not protected despite the tests being deterministic and free of live runner/network/home access.
   - **Repair**: Implement the Design's deterministic matrix with injected clocks/processes/filesystems and full TUI deferred-Promise interaction tests. Preserve the current hermetic boundaries.

### Medium — Advisory

1. **Architecture / Concurrency — Adapter-wide mutable “last plan” state is unsafe for overlapping consumers.**
   - **File / Symbol**: `packages/adapter-opencode/src/runner-adapter.ts` — `#lastNativePlan`, `#lastInstallValidation`, `buildDeveloperTeamInstallPlan`, `applyDeveloperTeamInstall`.
   - **Evidence**: Building a second plan replaces both fields; apply ignores `input.plan` and consumes whichever native plan was built last.
   - **Impact**: Two callers or re-entrant workflows can validate/apply the wrong assignment set or project plan.
   - **Repair**: Return an opaque/native payload in the plan or key stored plan state by immutable plan ID; apply the plan supplied in `input` and bind validation evidence to it.

2. **Correctness — Chunk-by-chunk `String(chunk)` decoding can corrupt valid UTF-8 across stream boundaries.**
   - **File / Symbol**: `packages/adapter-opencode/src/opencode-models-cli.ts` — `nodeOpenCodeCommandRunner` data handlers.
   - **Evidence**: Each arbitrary Buffer chunk is converted independently to a string.
   - **Impact**: A split multi-byte character in a model display name or JSON string can become replacement characters and cause false malformed output or changed display data.
   - **Repair**: Count bytes from Buffers and decode through `StringDecoder` only after bounded accumulation; add a split-multibyte fixture.

### Low — Advisory

1. **Maintainability / Scope Clarity — Reconciled tests still describe cache authority and stale requirement IDs.**
   - **File**: `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` — comments and legacy fixture around lines 540–546 and 663–725.
   - **Evidence**: The prose says configured-provider cache is authoritative and labels cache-origin records, contradicting the new runner-only source decision even though the helper itself is generic.
   - **Impact**: Future maintainers can reintroduce the regression by following obsolete test documentation.
   - **Repair**: Replace the fixture/comments with runner-resolved records and current requirement names, or move generic shape-mapping coverage to a runner-neutral test.

## Positive Evidence

- `discoverOpenCodeModels` uses a resolved absolute executable, literal `['models', '--verbose']`, `shell: false`, and no user/provider interpolation.
- The parser rejects duplicate IDs, provider mismatch, malformed/trailing records, non-object variants, and whole-result failures; it splits canonical IDs at the first slash and preserves variant-key order.
- Exact model and case-sensitive variant membership is used by `validateModelAssignments`; suffix matching and nearest-level mapping are absent there.
- Stale/blocked discovery cannot directly validate changed writes, and apply performs a second validation pass.
- TUI status is communicated in text rather than color alone; Retry and Back are keyboard-selectable; unavailable model and unavailable variant have distinct copy; zero variants have explicit copy.
- Pi keeps its optional-port isolation and fixed level path in the reviewed changes.
- Tests are hermetic with respect to the real runner, network, home directory, and uncontrolled clock where those seams are used.

## Design Fidelity

- **Aligned**: Partially.
- **Aligned areas**: runner-neutral optional async contracts, shell-free command vector, isolated strict parser, exact model lookup, arbitrary variant-key types, stale/blocked result types, dirty-agent evidence, native variant branch for changed agents, text-based TUI states, and Pi optional-port isolation.
- **Material deviations**: no production cache/LKG composition; incomplete fingerprint; non-hard subprocess deadline/output enforcement; static catalog remains in the dynamic variant write path; unchanged assignment mutation; no latest-request guard; incomplete empty-state transition; permissive LKG schema; and substantially incomplete deterministic matrix.

## Scope and Economy Assessment

The high-volume diff is directionally justified: replacing cache authority requires coordinated core, adapter, persistence, TUI, and test changes. No new dependency was added, and the parser/cache modules are reasonable boundaries. The main economy problem is not raw size; it is disconnected code (`LastKnownGoodStore` and per-call cache), duplicate static/dynamic reasoning paths, and tests that document superseded behavior. Repair should connect or remove dead paths rather than add another abstraction layer.

## Open Questions

1. Should the adapter become explicitly instance-scoped per process/project, or should cache/LKG coordination be a shared service keyed by the complete fingerprint? Either can work, but the lifetime must be explicit and testable.
2. Is concurrent plan construction an officially supported adapter behavior? If not, the interface should still fail closed with a plan identity rather than silently applying mutable last-built state.

## Review Decision

**Status**: changes-requested  
**Blocking Findings**: 8  
**Repair Required**: yes  
**Registry Write**: deferred  
**Registry Intent**: phase `review`, status `changes-requested`, event `review-changes-requested`, artifact `openspec/changes/fix-runner-model-discovery-regression/review-report.md`

---

# Repair Review Cycle 1

## Cycle Summary

**Incident**: `verify-review-blockers-round-1`  
**Phase**: `review-repair-cycle-1`  
**Scope**: backend/security and TUI/compatibility  
**Overall Rating**: REQUEST CHANGES — GOVERNANCE BLOCKED  
**Status**: changes-requested  
**Registry Mode**: deferred

Fresh source review finds that five of eight original High findings, both original Medium findings, and none of the one original Low finding are fully resolved. The TUI/compatibility blocking slice passes. The backend/security slice does not pass because the production fingerprint remains incomplete and the subprocess Promise can remain pending beyond the 15-second hard deadline. The original regression-matrix blocker also remains because its tests encode the overlong deadline and do not exercise production adapter composition or the full DeckApp transition boundary.

Under `evaluateRepairIncident()` priority semantics, recurrence of any exhausted fingerprint is a hard-stop condition that dominates the configured soft checkpoint. This cycle identifies three exhausted original fingerprint recurrences and no genuinely new fingerprint. Operating mode is interactive and no override was supplied; therefore the decision is `blocked`, and another automatic repair attempt is not permitted.

## Ratings by Dimension

| Dimension | Rating | Evidence |
|---|---|---|
| Architecture | ❌ Weak | Adapter-scoped memory cache is now connected, but production fingerprint/LKG scope composition remains incomplete. |
| Security | ❌ Weak | Secret values are not hashed, but relevant config/auth/plugin state is not represented, permitting stale authority reuse. |
| Scalability | ⚠️ Adequate | Adapter-lifetime TTL/LRU/in-flight coalescing is present; irrelevant environment-name changes can over-invalidate. |
| Maintainability | ⚠️ Adequate | Boundaries are clearer, but production composition lacks a test seam and stale cache wording remains. |
| Code Quality | ⚠️ Adequate | Core paths are readable and diagnostics report no source warnings; comments/tests misstate exact deadline behavior. |
| Backend | ❌ Weak | Two original backend blockers recur and the production integration matrix remains incomplete. |
| Frontend | ✅ Strong | Exact variants, latest-request identity guards, empty-state routing, and keyboard actions are correctly isolated. |
| Integration | ⚠️ Adequate | Persistence and immutable-plan boundaries are repaired; production discovery invalidation is not. |
| Economy / Critical Judgment | ✅ Strong | No avoidable dependency or extra abstraction was introduced; the remaining issue is under-implementation, not excess code. |

## Original Finding Disposition

| Original finding | Result | Source-level evidence |
|---|---|---|
| High 1 — production cache/LKG/fingerprint composition | **Not resolved; exhausted recurrence** | `packages/adapter-opencode/src/runner-adapter.ts:136-194` now owns one cache and LKG per adapter, but production `configState` and `pluginState` contain only existence booleans, `authState` recognizes only three environment names, all present environment names are included indiscriminately, and the LKG scope hash is a constant rather than runner-realpath/project scoped. Config content/stat changes, auth-file changes, and plugin-file changes therefore do not invalidate the fingerprint as designed. `runner-adapter.inventory.test.ts:12-45` always injects `inventoryDiscovery`, so production composition is untested. Fingerprint: `discovery-runtime-cache-fingerprint-lkg-unwired`. |
| High 2 — hard process lifecycle/output bounds | **Not resolved; exhausted recurrence** | `packages/adapter-opencode/src/opencode-models-cli.ts:141-207` sends SIGTERM at the deadline but settles only on child close or 250 ms later after SIGKILL. In production, `runner-adapter.ts:165-178` also performs a separate version process before starting the 15-second verbose process. Consequently the discovery attempt can wait about 15.25 seconds after the verbose spawn and more than 17 seconds end-to-end, contrary to the 15-second stop-waiting contract. Output byte accounting, termination classification, settle-once behavior, and `StringDecoder` handling are otherwise repaired. The test at `opencode-models-cli.test.ts:207-240` explicitly waits the extra 250 ms while naming the behavior “exactly at” 15,000 ms. Fingerprint: `opencode-timeout-not-hard-bounded`. |
| High 3 — legacy static variant resolution | **Resolved** | `apps/cli/src/tui/app.tsx:1908-1967` uses exact runner inventory levels directly on the OpenCode path and reserves `resolveThinking` for Pi. `runner-adapter.ts:616-650` returns and validates exact case-sensitive keys; runner-only persistence is covered in `runner-adapter.inventory.test.ts:27-45` and `developer-team-install.test.ts`. |
| High 4 — unchanged assignment mutation | **Resolved** | `packages/adapter-opencode/src/developer-team-install.ts:402-449` emits model/variant fields only for IDs in `changedAgentIds`; `config-merge.ts:111-159` removes legacy `reasoningEffort` only when the incoming changed entry owns `variant`. Existing assignment fields for unchanged agents remain untouched. |
| High 5 — stale async response overwrite | **Resolved** | `apps/cli/src/tui/opencode-discovery.ts:24-51` applies a completion only when its monotonic generation and active runtime/project identity still match. `app.tsx:2615+` snapshots assignments at request time. Deferred tests cover both completion orders and project-identity rejection. |
| High 6 — successful empty-state routing | **Resolved** | `opencode-discovery.ts:14-20` exposes stable Retry/Back actions for every non-loading state; `developer-team-screens.tsx:379-415` renders the empty state with text and the same keyboard-selectable actions. `opencode-discovery.test.ts` covers successful empty Retry and Back behavior. |
| High 7 — permissive/private/atomic LKG | **Resolved** | `model-inventory-cache.ts:59-104` reconstructs a closed allowlisted DTO with identity and bounds checks; lines 121-158 reject unsafe/private-mode reads, enforce age/fingerprint compatibility, use random adjacent temporary files with `0600`, repair directory mode to `0700`, atomically rename, and clean up. The remaining scope-key defect is counted under High 1 rather than duplicated here. |
| High 8 — missing deterministic adversarial/integration matrix | **Not resolved; exhausted recurrence** | Parser/cache/LKG/coordinator coverage is substantially improved and hermetic. However, `runner-adapter.inventory.test.ts:12-45` bypasses the default production composition, no test exercises two immutable install plans through build/apply, and `opencode-discovery.test.ts` tests the extracted coordinator rather than a full DeckApp transition. Most importantly, `opencode-models-cli.test.ts:207-240` blesses settlement at 15,250 ms instead of catching High 2. The matrix therefore still cannot detect two recurring production blockers. Fingerprint: `required-regression-matrix-incomplete`. |
| Medium 1 — mutable last-plan state | **Resolved** | `runner-adapter.ts:657-712` binds native plan and validation evidence to the returned plan object in a `WeakMap`, retrieves by the exact supplied `input.plan`, and fails closed for foreign plans. No adapter-wide “last plan” slot remains. |
| Medium 2 — split UTF-8 corruption | **Resolved** | `opencode-models-cli.ts:153-194` counts Buffer bytes and uses independent UTF-8 `StringDecoder` instances for stdout/stderr. The split-euro test at `opencode-models-cli.test.ts:207-240` proves boundary-safe decoding. |
| Low 1 — stale cache-authority test terminology | **Not resolved** | `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx:468` still says “OpenCode returns from cache,” and comments around lines 536 and 651 contain literal `\\n` escape text rather than normal comment lines. The main fixture authority language is improved, but the original cleanup is incomplete. This advisory item did not consume a fingerprint retry budget. |

## Fresh Backend and Security Slice

**Result: FAIL**

- **Production cache/LKG/fingerprint composition**: adapter-lifetime cache and LKG wiring exist, but complete production invalidation and per-runner/project LKG scope do not.
- **Hard lifecycle/output/UTF-8**: output limits, explicit reasons, SIGTERM/SIGKILL, settle-once, and UTF-8 decoding are present; the Promise still waits beyond the hard 15-second contract.
- **Closed private atomic LKG**: passes at the DTO, privacy, temporary-file, rename, and cleanup boundary; production scope composition remains part of High 1.
- **Unchanged assignment preservation**: passes.
- **Immutable plan binding**: implementation passes source review, but deterministic two-plan apply coverage is still absent.
- **Deterministic adversarial coverage**: improved but does not protect production composition or the actual hard deadline.

## Fresh TUI and Compatibility Slice

**Result: PASS**

- Exact live runner variant keys persist without legacy static resolution.
- Latest-request generation plus active runtime/project identity prevents stale completion writes.
- Request-time assignment snapshots prevent closure drift.
- Successful empty discovery remains on the explicit state with Retry and Back.
- Text labels communicate loading, stale, blocked, and empty states without color-only meaning; Retry/Back remain keyboard selectable. This is appropriate minimal terminal accessibility behavior.
- Pi keeps its fixed resolver and remains outside OpenCode-specific discovery authority. Shared optional-port tests preserve runner isolation.
- One original Low terminology cleanup remains, but it is non-blocking and does not invalidate this slice.

## Remaining Findings

### High

1. **Architecture / Security — Production discovery fingerprint and LKG scope remain incomplete.**  
   Recommendation: fingerprint real global/workspace config candidate stats/digests, auth-file stat state, referenced plugin file stats/digests, and only relevant credential environment-name/presence signals; derive the LKG scope from runner realpath plus project root; add a hermetic default-composition seam and test.

2. **Security / Resource Bounds — Discovery does not stop waiting at 15 seconds.**  
   Recommendation: enforce one absolute 15,000 ms budget across version and verbose execution. At deadline, classify timeout and settle immediately while performing process reaping/escalation independently; prove the public Promise is settled at 15,000 ms, not 15,250 ms.

3. **Test Quality — The matrix misses production composition and encodes the deadline defect.**  
   Recommendation: test default adapter composition with injected filesystem/environment/process seams, two independently built plans applied out of order, and DeckApp-level deferred transitions; change the timeout assertion to require Promise settlement at exactly 15,000 ms.

### Low

1. **Maintainability — Original stale cache terminology cleanup is incomplete.**  
   Recommendation: replace the remaining cache-origin statement and convert literal `\\n` comment escapes to normal multiline comments.

No Critical or Medium finding remains. No genuinely new fingerprint was identified.

## Governance Evaluation

- Apply batches used: `3/3`.
- Verification cycles used after this cycle: `1/2`.
- Soft checkpoint: reached after this Verify + Review cycle.
- Exhausted original fingerprint recurrences: `discovery-runtime-cache-fingerprint-lkg-unwired`, `opencode-timeout-not-hard-bounded`, `required-regression-matrix-incomplete`.
- New fingerprints: none.
- `evaluateRepairIncident()` implication: per-fingerprint hard repair-attempt exhaustion dominates the soft checkpoint. Interactive mode has no automatic override path, and no explicit override was supplied.
- Decision: `blocked`.
- Repair permitted automatically: `no`.

## Repair Cycle 1 Decision

**Status**: changes-requested  
**Original High Findings Resolved**: 5/8  
**Original Medium Findings Resolved**: 2/2  
**Original Low Findings Resolved**: 0/1  
**Critical Findings**: 0  
**High Findings**: 3  
**Medium Findings**: 0  
**Low Findings**: 1  
**Registry Write**: deferred  
**Registry Intent**: phase `review-repair-cycle-1`, status `changes-requested`, event `repair-review-cycle-1-changes-requested`, artifact `openspec/changes/fix-runner-model-discovery-regression/review-report.md`

---

# Final Review Cycle 2

## Cycle Summary

**Incident**: `verify-review-blockers-round-1`  
**Phase**: `review-repair-cycle-2`  
**Scope**: backend/security and TUI/compatibility  
**Overall Rating**: REQUEST CHANGES — FINAL GATE BLOCKED  
**Status**: blocked  
**Registry Mode**: deferred

Fresh source review resolves the absolute-deadline fingerprint, but finds two scoped fingerprint recurrences. The production discovery context still does not retain the required non-secret semantic config values in its sanitized digest, so same-stat changes to model/provider/plugin/path/control values can reuse a stale memory/LKG fingerprint. The required mounted `DeckApp` transition matrix is also still absent: the new mounted test renders only the initial home screen, while deferred transitions remain coordinator-only unit tests. The original terminology cleanup remains incomplete.

Under the Human Override Replan's `evaluateRepairIncident()` semantics, any scoped recurrence or failed final review cycle must return `block`. This is cycle 2/2; no further automatic repair is permitted.

Adaptive memory was loaded as advisory context only. Official OpenSpec artifacts, source, tests, and the current full diff remained authoritative.

## Ratings by Dimension

| Dimension | Rating | Evidence |
|---|---|---|
| Architecture | ❌ Weak | Default composition and scoped LKG wiring exist, but the production fingerprint projection omits required non-secret semantic values. |
| Security | ⚠️ Adequate | Secret values are not retained or fingerprinted; closed-schema private LKG handling remains intact. The over-redaction creates an integrity/invalidation defect rather than a secret exposure. |
| Scalability | ✅ Strong | Adapter-lifetime TTL/LRU/in-flight cache behavior remains bounded; subprocess output and caller time are bounded. |
| Maintainability | ⚠️ Adequate | Boundaries are injectable and localized, but required production-transition tests are missing and literal `\\n` escapes remain in test comments. |
| Code Quality | ⚠️ Adequate | Core paths are readable and diagnostics are clean; the sanitized projection is too coarse for its contract. |
| Backend | ❌ Weak | One scoped backend/security fingerprint recurs. |
| Frontend / TUI | ⚠️ Adequate | Existing state rendering, keyboard actions, latest-request coordination, and Pi behavior remain intact, but mounted integration proof is incomplete. |
| Integration | ❌ Weak | The required mounted `DeckApp` loading/result/action/project-transition matrix is not exercised. |
| Economy / Critical Judgment | ✅ Strong | The repair remains localized and uses existing seams without new dependencies or speculative abstraction. |

## Original Finding Disposition

| Original finding | Result | Fresh source evidence |
|---|---|---|
| High 1 — production cache/LKG/fingerprint composition | **Not resolved; scoped recurrence** | `model-discovery-context.ts:47-51` replaces every string value with the constant `"string"`; `safeFileState` hashes that projection. This omits the Design-required non-secret provider/model/plugin/path/control values. `runner-adapter.inventory.test.ts:11-47` proves only stat-driven config/auth/plugin invalidation and does not exercise same-stat semantic config changes or relevant credential-presence changes. Cache lifetime and runner/project/workspace LKG scoping are otherwise repaired by `runner-adapter.ts:164-200` and `model-inventory-cache.ts:42-44`. Fingerprint: `discovery-runtime-cache-fingerprint-lkg-unwired`. |
| High 2 — hard process lifecycle/output bounds | **Resolved** | `opencode-models-cli.ts:141-211` settles once at timeout before independent SIGTERM/SIGKILL reaping. `runner-adapter.ts:164-200` captures one absolute deadline before executable/version/context/verbose work and propagates remaining budget plus one abort signal. `runner-adapter.inventory.test.ts:51-67` requires public settlement at exactly 15,000 ms; `opencode-models-cli.test.ts:207-240` separately proves cleanup escalation. |
| High 3 — legacy static variant resolution | **Resolved; remains intact** | OpenCode uses exact runner-resolved variants; Pi retains its runner-specific fixed path. Focused TUI tests continue to cover model-specific and non-canonical variants. |
| High 4 — unchanged assignment overwrite / native-field loss | **Resolved; remains intact** | Changed-agent validation and native variant persistence remain isolated; unchanged assignments are not revalidated or rewritten. |
| High 5 — stale/latest request and empty routing defects | **Resolved; remains intact** | `opencode-discovery.ts:23-51` rejects stale generations and changed runtime/project identities. Empty discovery remains actionable through Retry and Back. |
| High 6 — mutable/current plan used instead of supplied plan | **Resolved; remains intact** | `runner-adapter.ts:689-745` binds immutable validation/native-plan data in a `WeakMap`. `developer-team-install.test.ts:1399-1416` applies independently built plans B then A and observes the correct model each time. |
| High 7 — LKG schema/privacy/atomicity defects | **Resolved; remains intact** | `model-inventory-cache.ts:64-164` reconstructs a closed allowlisted DTO, validates identity/bounds/age, rejects unsafe or permissive reads, uses random adjacent `0600` temporary files, repairs directory mode, atomically renames, and cleans up. |
| High 8 — missing adversarial/integration matrix | **Not resolved; scoped recurrence** | Backend deadline/default-composition and reverse-plan tests were added, but `app.opencode-discovery.test.tsx:5-15` only calls `renderToString` on the initial home screen. It does not run effects, enter discovery, resolve deferred ready/empty/stale/blocked states, exercise Retry/Back, or change project identity. Those checks remain helper/coordinator units in `opencode-discovery.test.ts:5-63`, contrary to the explicit mounted-`DeckApp` requirement. Fingerprint: `required-regression-matrix-incomplete`. |
| Medium 1 — assignment persistence/compatibility | **Resolved; remains intact** | Runner-only variant persistence and unchanged native field behavior remain covered. |
| Medium 2 — scope-control / Pi compatibility | **Resolved; remains intact** | OpenCode-only discovery changes do not alter Pi's fixed levels or unrelated runner paths. |
| Low 1 — stale cache terminology / escaped comments | **Not resolved** | Cache-authority wording is gone, but `developer-team-screens-effort.test.tsx:651` still contains literal `\\n` escapes inside a line comment instead of normal multiline comments. |

## Findings

### Critical

None.

### High — Blocking

1. **Architecture / Security Integrity — The schema-2 production fingerprint over-redacts semantic configuration values.**
   - **File / Symbol**: `packages/adapter-opencode/src/model-discovery-context.ts:47-51`, `75-91`, `96-132` — `canonical`, `safeFileState`, `collectOpenCodeDiscoveryContext`.
   - **Evidence**: `canonical()` converts every string not under a recognized secret key to `"string"`. Consequently, changes such as one model ID, provider ID, plugin reference, environment-name declaration, or non-secret control/path value to another same-shaped string produce the same `safeDigest` when stat identity is unchanged. The Design explicitly requires those non-secret semantic values and environment names to remain in the sanitized projection. JSONC candidates also fall into `digestDisposition: "unavailable"` because they are passed directly to `JSON.parse`, reducing coverage of an explicitly supported candidate format.
   - **Impact**: The adapter can return a memory or compatible LKG inventory for a materially changed production configuration. This is a recurrence of the authorized production fingerprint/LKG fingerprint and a final-gate spec violation.
   - **Recommendation**: Build a typed redaction projection that preserves allowlisted non-secret provider/model/plugin/path/control strings and referenced environment names while replacing credential-bearing fields/provider option values with type/presence markers. Parse supported JSONC safely. Add same-stat semantic-change, JSONC, relevant-presence, and irrelevant/value-only non-invalidation tests through the default factory.

2. **Integration / Test Quality — The required mounted `DeckApp` production-boundary transition matrix is absent.**
   - **Files**: `apps/cli/src/tui/app.opencode-discovery.test.tsx:5-15`; `apps/cli/src/tui/opencode-discovery.test.ts:5-63`.
   - **Evidence**: The only mounted-component test synchronously renders the initial home screen and asserts its title. It cannot run `useEffect`, navigate into OpenCode discovery, or observe deferred state updates. Loading → ready/empty/stale/blocked, Retry, Back, latest-result, and project-identity behavior is tested only in isolated helpers/coordinator units, even though the override explicitly rejected coordinator units alone.
   - **Impact**: Composition regressions between `DeckApp`, its injected adapter/project root, coordinator, screen routing, and keyboard actions remain undetectable. This is a recurrence of `required-regression-matrix-incomplete` and blocks final resolution.
   - **Recommendation**: Mount `DeckApp` with an effect-capable Ink test renderer and injected deferred discovery. Drive navigation and keyboard input, and assert each required transition/action plus reverse completion and project-identity changes at the actual component boundary.

### Medium

None.

### Low

1. **Maintainability — Terminology cleanup is still incomplete.**
   - **File**: `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx:651`.
   - **Evidence**: A three-line fixture explanation is encoded as one source line containing literal `\\n` sequences.
   - **Recommendation**: Convert it to three ordinary line comments.

## Scoped Fingerprint Review

| Scoped fingerprint | Result |
|---|---|
| `discovery-runtime-cache-fingerprint-lkg-unwired` | **Recurred** — wiring/scope/privacy are repaired, but required semantic fingerprint inputs remain incomplete. |
| `opencode-timeout-not-hard-bounded` | **Resolved** — one absolute 15,000 ms caller deadline spans version and verbose discovery; cleanup is independent. |
| `required-regression-matrix-incomplete` | **Recurred** — default composition/deadline/reverse-plan coverage improved, but mounted `DeckApp` transition evidence is missing. |

**Scoped Fingerprints Resolved**: 1/3  
**New Fingerprints**: none

## Preserved Behavior Assessment

- **TUI / compatibility**: Existing loading/ready/empty/stale/blocked rendering, Retry/Back action mapping, unavailable assignment labels, exact variant ordering, latest-request coordination, and changed-project rejection remain coherent in source and unit coverage. The required mounted composition proof is nevertheless missing.
- **Persistence**: Changed-only validation and runner-native variant writes remain intact; reverse-order independent plans are now directly covered.
- **UTF-8 and process bounds**: `StringDecoder`, byte-count limits, deterministic termination classification, settle-once behavior, and independent reap escalation remain intact.
- **LKG schema/privacy**: Closed schema, bounded identity, age validation, private modes, symlink rejection, random atomic temporary writes, and cleanup remain intact. No secret value is stored in the context or snapshot.
- **Pi**: Pi's fixed thinking levels and runner-specific behavior remain unchanged.
- **Scope control**: Changes remain within the authorized OpenCode discovery boundary; no new dependency or unrelated implementation surface was introduced.
- **Accessibility guidance**: The text-based states and keyboard-reachable Retry/Back controls remain appropriate for the Ink TUI. No new visual-only status or inaccessible interaction was introduced.
- **Diagnostics**: Serena reported no error/warning diagnostics in the reviewed production discovery, process, TUI coordination, mounted-test, or app files.

## Design Fidelity

**Aligned**: Partially.

The absolute deadline, independent cleanup, default factory injection, private scoped LKG, immutable plan binding, and coordinator architecture align with the Human Override Replan. The config projection violates the required secret-safe semantic retention, and the mandated mounted `DeckApp` proof was not implemented.

## Governance Evaluation

- Human override R1 batches used: `1/1`.
- Verification cycles used after this review: `2/2`.
- Scoped fingerprint recurrences: `discovery-runtime-cache-fingerprint-lkg-unwired`, `required-regression-matrix-incomplete`.
- New fingerprints: none.
- `evaluateRepairIncident()` equivalent action: `block`.
- Final hard-stop reason: scoped recurrences and failed Review Cycle 2.
- Automatic repair permitted: `no`.
- Decision: `blocked`; escalate for explicit human disposition. No further automatic Apply/Verify/Review repair cycle is authorized.

## Final Review Cycle 2 Decision

**Status**: blocked  
**Original High Findings Resolved**: 6/8  
**Original Medium Findings Resolved**: 2/2  
**Original Low Findings Resolved**: 0/1  
**Scoped Fingerprints Resolved**: 1/3  
**Critical Findings**: 0  
**High Findings**: 2  
**Medium Findings**: 0  
**Low Findings**: 1  
**Registry Write**: deferred  
**Registry Intent**: phase `review-repair-cycle-2`, status `changes-requested`, event `repair-review-cycle-2-changes-requested`, artifact `openspec/changes/fix-runner-model-discovery-regression/review-report.md`

## Artifact Self-Verification

- Prior report content is preserved above this appended section.
- Only `review-report.md` was intentionally modified by this review.
- The appended heading is exactly `Final Review Cycle 2`.
- Registry state/events were not modified; registry intent is returned for serialized handling.

---

# Final Closure Exception Review

## Closure Summary

**Incident**: `verify-review-blockers-round-1`  
**Change**: `fix-runner-model-discovery-regression`  
**Phase**: `final-closure-review`  
**Scope**: backend/security and TUI/compatibility  
**Overall Rating**: REQUEST CHANGES — FINAL HARD STOP  
**Status**: blocked  
**Registry Mode**: deferred

Fresh source review resolves the remaining literal-comment cleanup, but the other two closure items remain blocking. The semantic fingerprint projection is still heuristic rather than a closed typed projection: it suppresses all provider `options`, including non-secret model/path/control values, while inherited semantic mode can retain unrecognized credential values in a value-derived digest. It also omits environment and plugin references supplied through `OPENCODE_CONFIG_CONTENT`. The mounted `DeckApp` suite now exercises real effects and the principal result states, but it does not exercise the discovery-screen Back action or the required reverse completion order in which the latest request completes before an older request and remains authoritative.

Under `evaluateRepairIncident()` semantics, the closure Apply batch and final verification cycle are exhausted. Any remaining High finding or specification violation is a final hard stop. This review therefore returns `block`; no automatic repair is permitted and the change cannot archive.

Adaptive context was not loaded. Official OpenSpec artifacts, source, tests, and current source state were authoritative.

## Ratings by Dimension

| Dimension | Rating | Evidence |
|---|---|---|
| Architecture | ❌ Weak | The production context is composed at the correct adapter boundary, but its projection uses inherited regex flags instead of a closed, field-aware DTO. |
| Security | ❌ Weak | Known secret-key names are redacted, but unknown credential fields under semantic containers can influence the persisted fingerprint hash, contrary to the no-value-derived-secret contract. |
| Scalability | ✅ Strong | Existing bounded cache, LKG, process-output, and absolute-deadline behavior remains localized and bounded. |
| Maintainability | ⚠️ Adequate | The closure changes are localized, but the projection rules are difficult to reason about and mounted transition assertions overstate their exercised paths. |
| Code Quality | ⚠️ Adequate | The literal-comment cleanup is complete and diagnostics are clean; test names do not precisely match the completion/action paths exercised. |
| Backend | ❌ Weak | Same-stat semantic invalidation and secret-safe projection remain incomplete in default production composition. |
| Frontend / TUI | ❌ Weak | Mounted state rendering is materially improved, but required Back and reverse/latest-result transition evidence is absent. |
| Integration | ❌ Weak | Two of the three closure items remain unresolved at their public production boundaries. |
| Economy / Critical Judgment | ✅ Strong | The changes reuse existing seams and add no dependency or speculative abstraction. |

## Closure Item Disposition

| Closure item | Result | Fresh evidence |
|---|---|---|
| Typed secret-safe semantic fingerprint projection, JSONC, same-stat invalidation, relevant environment presence, and default production composition | **Not resolved — High** | `model-discovery-context.ts:47-70` propagates `semantic` through whole subtrees but redacts every `options`/`headers` subtree. A same-stat change such as `providers.openai.options.baseURL` or another non-secret option therefore cannot alter the digest. Conversely, an unrecognized credential field below `providers` inherits semantic mode and can affect the digest, violating the prohibition on value-derived secret hashes. `model-discovery-context.ts:167-172` fingerprints virtual `OPENCODE_CONFIG_CONTENT` but does not add its parsed value to environment-name or plugin-reference extraction. The focused test at `model-discovery-context.test.ts:30-62` covers only top-level `model` and recognized `apiKey`; the default-composition test changes several semantic fields at once and does not isolate these cases. Default factory wiring itself remains present in `runner-adapter.ts:164-200`; JSONC comments/trailing commas are handled for the covered inputs. |
| Mounted `DeckApp` deferred transitions | **Not resolved — High** | `app.opencode-discovery.test.tsx:76-139` mounts effect-capable `DeckApp` and covers loading, ready, empty, stale, blocked, Retry, and a project-root change. However, the first test resolves request A before request B, so it does not prove the required reverse order where B completes and then late A cannot overwrite B. The empty/stale test invokes Escape only after stale auto-routes to `agent-model-config-list`; that exercises generic `goBack()` rather than selecting the discovery screen's Back item through `getOpenCodeDiscoveryAction()`. The standalone coordinator tests cannot replace this mounted evidence under the controlling Design. |
| Remaining literal `\\n` comment cleanup | **Resolved** | No literal escaped-newline comment remains in `developer-team-screens-effort.test.tsx`; the closure Apply converted the fixture comment to ordinary comments. |

## Regression Safety

- **Exact runner variants**: pass — exact `exact/runner-key` validation and native persistence coverage remains present.
- **Hard 15-second deadline**: pass — default discovery retains one caller-visible 15,000 ms race; process cleanup remains independent.
- **LKG privacy and scope**: pass for retained behavior — private closed-schema storage and runner/project/workspace scope-key derivation remain present. The fingerprint-content defect above still makes authority invalidation unsafe.
- **Unchanged assignments**: pass — existing merge and idempotency coverage remains intact.
- **Immutable plans**: pass — reverse B→A plan-binding coverage remains present.
- **Pi compatibility**: pass — no Pi discovery or fixed-level behavior was changed by the closure patch.
- **TUI accessibility**: pass for the rendered controls — loading/error states include text, and Retry/Back remain keyboard-selectable `MenuList` items. The blocker is missing mounted action evidence, not a newly observed accessibility defect.

## Findings

### Critical

None.

### High

1. **Security / Backend — The production fingerprint projection is neither complete for non-secret semantics nor closed against value-derived secrets.**
   - **Files**: `packages/adapter-opencode/src/model-discovery-context.ts:47-70, 167-172`; `packages/adapter-opencode/src/model-discovery-context.test.ts:30-62`; `packages/adapter-opencode/src/runner-adapter.inventory.test.ts:36-55`
   - **Evidence**: `providerOptionKey` replaces every `options` subtree with one marker, so non-secret semantic option changes collide. Inherited `semantic` mode preserves strings under unrecognized keys, including potential credentials, in the hash input. Virtual config content is not included in relevant environment/plugin extraction.
   - **Impact**: same-stat changes can reuse stale memory/LKG authority, while credential values outside the regex vocabulary can influence a persisted fingerprint. This recurs `discovery-runtime-cache-fingerprint-lkg-unwired` and violates the closure's security/invalidation contract.
   - **Recommendation**: human escalation or a separately authorized change must replace regex inheritance with a closed typed projection that explicitly keeps required semantic fields, emits only `{name,present}` for credential references, recursively redacts secret-bearing fields, and applies the same extraction to virtual config content.

2. **Integration / TUI — Mounted transition evidence omits reverse completion and the discovery Back action.**
   - **Files**: `apps/cli/src/tui/app.opencode-discovery.test.tsx:76-139`; `apps/cli/src/tui/app.tsx:1986-1991, 2623-2645`
   - **Evidence**: request A is resolved before request B; no mounted test resolves B and then late A while asserting B remains displayed. Escape is sent after stale auto-navigation to the agent list, bypassing the discovery screen's cursor-1 Back action.
   - **Impact**: the controlling mounted `DeckApp` matrix remains incomplete, recurring `required-regression-matrix-incomplete`.
   - **Recommendation**: human escalation or a separately authorized change must add mounted assertions for both completion orders and select Back from empty or blocked discovery state, proving the expected destination.

### Medium

None.

### Low

None.

## Governance Evaluation

- Closure Apply batch used: `1/1`; retries remaining: `0`.
- Closure verification cycle: `1/1`; final.
- Closure scope resolved: `1/3`.
- Scoped recurrences: `discovery-runtime-cache-fingerprint-lkg-unwired`, `required-regression-matrix-incomplete`.
- New fingerprints: none.
- `evaluateRepairIncident()` equivalent action: `block`.
- Automatic repair permitted: `no`.
- Archive ready: `no`.
- Decision: `blocked`; escalate for human disposition or a separately authorized change.

## Final Closure Exception Decision

**Status**: blocked  
**Critical Findings**: 0  
**High Findings**: 2  
**Medium Findings**: 0  
**Low Findings**: 0  
**Blocking Findings**: 2  
**Registry Write**: deferred  
**Registry Intent**: phase `final-closure-review`, status `changes-requested`, event `final-closure-review-changes-requested`, artifact `openspec/changes/fix-runner-model-discovery-regression/review-report.md`

## Artifact Self-Verification

- All prior report content remains above this separator.
- Only `review-report.md` was intentionally modified by this review.
- The appended heading is exactly `Final Closure Exception Review`.
- Registry state/events, code, tests, and other artifacts were not modified.

---

# Separately Authorized Corrective Review

## Summary

**Change**: `fix-runner-model-discovery-regression`  
**Phase**: `separately-authorized-corrective-review`  
**Scope**: backend/security and TUI/compatibility  
**Overall Rating**: REQUEST CHANGES  
**Status**: changes-requested  
**Registry Mode**: deferred

Fresh source review finds that the mounted `DeckApp` evidence and release-check isolation corrections are now sound. The latest project-B request settles first, late project-A completion is rejected, the discovery Back menu item is selected through the mounted Ink boundary, all required states/actions are represented, and release-check behavior is injected through a narrow production-defaulted dependency rather than a process-wide module mock.

The fingerprint correction is materially safer but remains incomplete. Its closed projection recognizes environment references only when they appear under fields named `env`, `environment`, `environmentVariable`, or `environmentVariables`. OpenCode configurations in this repository use interpolation inside credential-bearing values, for example `Authorization: "Bearer {env:SUPERMEMORY_API_KEY}"`. Because every `headers` subtree and every unknown credential field is replaced directly by a marker, those referenced names are never added to `credentialEnvironment`. Relevant credential presence therefore cannot invalidate the production fingerprint for this supported configuration form. This is a High security/correctness finding and a specification violation, so archive remains blocked.

Adaptive context was not loaded. Official OpenSpec artifacts and current source were authoritative. Review used read-only Serena inspection; test execution is Verify's responsibility.

## Ratings by Dimension

| Dimension | Rating | Evidence |
|---|---|---|
| Architecture | ⚠️ Adequate | Projection is localized and production composition remains correctly injected, but reference extraction is not yet complete at the credential boundary. |
| Security | ❌ Weak | Secret values are not retained, but credential environment references embedded in redacted strings are discarded before their names/presence can be projected. |
| Scalability | ✅ Strong | Projection, sorting, hashing, request coordination, and mounted seams remain bounded and local. |
| Maintainability | ⚠️ Adequate | Explicit allowlists are easier to reason about than inherited semantic mode; the JSONC trailing-comma regex still creates a subtle parsing edge case. |
| Code Quality | ✅ Strong | Names and focused tests clearly express the corrective intent; diagnostics report no warnings/errors in the four principal files. |
| Backend | ❌ Weak | Relevant credential presence is incomplete for supported interpolation syntax. |
| Frontend / TUI | ✅ Strong | Mounted effects prove latest-result authority, actual Back selection, Retry, state rendering, and project identity. |
| Integration | ⚠️ Adequate | TUI and release-check boundaries are repaired; fingerprint-to-runtime invalidation remains incomplete. |
| Economy / Critical Judgment | ✅ Strong | The correction is localized, reuses existing seams, and adds no dependency or speculative abstraction. |

## Corrective Scope Disposition

| Corrective item | Result | Fresh evidence |
|---|---|---|
| Closed field-aware semantic fingerprint projection | **Not resolved — High** | `model-discovery-context.ts:103-111` extracts only direct environment-name field values. `projectProviderOptions`, `projectProviderConfig`, and `projectRootConfig` replace `headers` and unknown credential fields with markers before scanning interpolation. Repository-supported config uses `Bearer {env:SUPERMEMORY_API_KEY}` in headers (`opencode-mcp-config.ts:25, 339, 420`). Thus the secret stays redacted, but its relevant environment name/presence is absent from `credentialEnvironment`. File and virtual config use the same projection, so both miss this form in default production composition. |
| Mounted `DeckApp` effectful evidence | **Resolved** | `app.opencode-discovery.test.tsx:87-116` changes project A→B, settles B first, renders B, settles A late, and proves A cannot overwrite B. Separate mounted cases cover loading→ready, empty, Retry with `mode: "rescan"`, stale, blocked, and the actual empty-state Back menu action selected with Down+Enter. Request records prove project identity is retained. |
| Release-check mock isolation | **Resolved** | `app.opencode-discovery.test.tsx:47-84` passes `runReleaseCheck` directly to mounted `DeckApp`; no `mock.module` remains. `app.tsx:505-515, 678-691` defaults that optional seam to `runReleaseCheckWithTimeout`, preserving production behavior without process-wide module mutation. Source-level isolation removes the prior six-test leakage mechanism. |

**Corrective Scope Resolved**: 2/3.

## Regression Safety

- **Exact variants**: pass — the corrective files do not alter exact runner-key validation or native variant persistence.
- **Absolute deadline**: pass — no deadline/process-runner path was changed; the established one-budget 14,999/15,000 ms behavior remains intact.
- **LKG privacy**: pass for storage/schema/privacy; blocked for authority completeness because a relevant credential-presence transition can reuse the old fingerprint.
- **Unchanged assignments**: pass — assignment merge/write paths are untouched.
- **Immutable plans**: pass — plan construction/application paths are untouched and prior reverse-order evidence remains applicable.
- **Pi compatibility**: pass — no Pi source or six-level behavior changed.
- **Accessibility**: pass — loading/error/empty information remains textual; Retry and Back are keyboard-selectable menu items, and the mounted test exercises Back through the same keyboard path available to users.
- **Scope control**: pass for the focused correction reviewed: field projection/tests plus narrow `DeckApp` dependency/test changes; no new dependency, persistence schema, core contract, Pi behavior, or visual contract was introduced.

## Findings

### Critical

None.

### High

1. **Security / Backend — Redaction discards supported embedded environment references before relevant-presence extraction.**
   - **Files**: `packages/adapter-opencode/src/model-discovery-context.ts:103-111, 128-179`; `packages/adapter-opencode/src/model-discovery-context.test.ts:54-63`; `packages/adapter-opencode/src/runner-adapter.inventory.test.ts:36-70`; `packages/adapter-opencode/src/opencode-mcp-config.ts:25, 339, 420`
   - **Evidence**: environment names are collected only from dedicated environment fields. Header trees and unknown credential fields become type/presence markers without scanning strings for the repository's supported `{env:NAME}` interpolation. Existing virtual/default-composition tests use an artificial direct `env` field and therefore do not catch the omission.
   - **Impact**: changing a referenced credential from absent to present can leave the fingerprint unchanged, allowing five-minute memory or compatible LKG authority to survive a runtime-relevant authentication transition. The secret value itself remains protected, but REQ-DISC-003/004 relevant-presence invalidation is not fully satisfied.
   - **Recommendation**: extract only syntactically valid environment **names** from credential-bearing strings before redacting their values, including nested headers/options and both file-backed and virtual JSONC. Project `{name,present}` only; never retain surrounding strings or values. Add isolated same-stat and default-composition tests using `Bearer {env:TOKEN}` and an option such as `apiKey: "{env:TOKEN}"`, proving absence/presence invalidates while value-only changes do not.

### Medium

1. **Correctness / Maintainability — Trailing-comma removal is not string-aware.**
   - **File**: `packages/adapter-opencode/src/model-discovery-context.ts:185-211`
   - **Evidence**: comments are removed with a quote-aware scanner, but trailing commas are subsequently removed by `withoutComments.replace(/,(\s*[}\]])/g, "$1")`. That regex also rewrites `,}` or `,]` occurring inside a valid JSON string.
   - **Impact**: uncommon but valid model/path/command/plugin strings can be silently changed before projection, causing an incorrect digest or reference resolution.
   - **Recommendation**: remove trailing commas during the existing quote-aware scan (or use an existing project parser) so commas inside strings remain byte-for-byte semantic data. Add a JSONC test containing string literals with `,}` and `,]`.

### Low

None.

## Decision

**Status**: changes-requested  
**Critical Findings**: 0  
**High Findings**: 1  
**Medium Findings**: 1  
**Low Findings**: 0  
**Blocking Findings**: 1  
**Backend/Security Result**: Relevant-presence extraction remains incomplete for supported embedded environment interpolation; changes requested.  
**TUI/Compatibility Result**: Pass — mounted transition/action evidence and release-check isolation are sound at source level.  
**Archive Ready**: no  
**Registry Write**: deferred  
**Registry Intent**: phase `separately-authorized-corrective-review`, status `changes-requested`, event `corrective-review-changes-requested`, artifact `openspec/changes/fix-runner-model-discovery-regression/review-report.md`

## Artifact Preservation

- All prior `review-report.md` content is preserved above the separator.
- The appended heading is exactly `Separately Authorized Corrective Review`.
- Only `review-report.md` was intentionally modified.
- Registry state/events, code, tests, and other artifacts were not modified.

---

# Corrective Retry Final Review

## Summary

**Change**: `fix-runner-model-discovery-regression`  
**Phase**: `corrective-retry-final-review`  
**Scope**: backend/security and TUI/compatibility  
**Overall Rating**: REQUEST CHANGES  
**Status**: changes-requested  
**Registry Mode**: deferred

Fresh source review confirms that the corrective implementation now extracts exact embedded `{env:NAME}` references from parsed JSON, JSONC, and virtual `OPENCODE_CONFIG_CONTENT` before redaction. The resulting discovery context retains only sorted names and Boolean presence, never environment values or value-derived digests. Presence changes invalidate the fingerprint while value-only changes remain stable. The closed, field-aware projection still marks unapproved and credential-bearing values rather than retaining them.

The mounted `DeckApp` tests also retain the repaired latest-first ordering, late-result suppression, keyboard Back behavior, and release-check isolation through an injected production-defaulted dependency. Existing exact-variant, absolute-deadline, LKG, immutable-plan/persistence, Pi, and accessibility paths are outside the localized corrective changes and remain supported by the preserved focused evidence.

Archive is nevertheless blocked because obsolete cache-authority prose remains in `apps/cli/src/tui/app.tsx:348-352`. It says `getModelInventory()` reads a configured-provider cache and that `opencode models` is merely a fallback, contradicting the runner-resolved inventory boundary and the Design's explicit stale-module-comment cleanup.

Adaptive context was not loaded; this fresh review used official OpenSpec artifacts, current source, tests, and Serena diagnostics only.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Runtime boundaries are sound, but the stale TUI module contract documents the superseded authority model. |
| Security | ✅ Strong | Embedded references are collected without retaining secret values; unsafe fields remain marker-only. |
| Scalability | ✅ Strong | Recursive config scanning is bounded by parsed configuration size and adds no external work. |
| Maintainability | ❌ Weak | The authoritative module comment contradicts the implementation and approved design. |
| Code Quality | ⚠️ Adequate | Corrective code and tests are focused; one explicitly targeted stale comment remains. |
| Backend | ✅ Strong | Presence/value invalidation and closed semantic projection are correctly separated. |
| Frontend | ⚠️ Adequate | Mounted behavior and accessibility evidence are sound; nearby architectural prose is misleading. |
| Integration | ⚠️ Adequate | Adapter/TUI behavior aligns, but the TUI's documented source-of-truth contract does not. |
| Economy / Critical Judgment | ✅ Strong | The retry is localized, dependency-free, and does not introduce speculative abstractions. |

## Corrective Retry Disposition

| Review item | Result | Fresh evidence |
|---|---|---|
| Embedded `{env:NAME}` extraction for JSON/JSONC/virtual config | **Pass** | `collectEmbeddedEnvironmentReferences` recursively scans parsed values before `projectRootConfig`; `projectInlineConfig` uses the same path. Focused tests cover raw JSON, JSONC headers, and `OPENCODE_CONFIG_CONTENT`. |
| Names/presence only; no secret-derived digest | **Pass** | `credentialEnvironment` emits only `{ name, present }`; config projection marks secret fields. Tests prove serialized contexts omit secret values and value-only changes preserve the fingerprint. |
| Presence/value invalidation | **Pass** | Tests prove present→absent changes the fingerprint and present value A→B does not, for file and virtual config. |
| Closed field-aware semantic projection | **Pass** | Approved fields retain bounded semantic values; headers and unknown fields become type/presence markers. The pre-projection reference scan does not add raw values to the projection. |
| Mounted latest-first and Back behavior | **Pass** | The mounted test settles project B before project A and proves A cannot overwrite B; the empty-state test selects Back with keyboard input. |
| Release-check isolation | **Pass** | `DeckApp` receives `runReleaseCheck` through a narrow optional dependency with the production default preserved; the mounted test uses injection and contains no process-wide module mock. |
| Cache-authority wording removal | **Fail — High / blocking** | `apps/cli/src/tui/app.tsx:348-352` still claims configured-provider cache authority and CLI fallback behavior. |
| Original behavior preservation | **Pass** | The retry is confined to discovery-context extraction/tests and corrective comments; exact variants, absolute deadline, LKG storage/privacy, immutable assignment persistence, Pi isolation, and keyboard/text accessibility contracts remain unchanged. |

## Findings

### Critical

None.

### High

1. **Maintainability / Integration — Obsolete cache-authority contract remains in the TUI module.**
   - **File**: `apps/cli/src/tui/app.tsx:348-352`
   - **Evidence**: The comment states that `getModelInventory()` “reads the configured-provider cache,” rejects `opencode models` as authoritative, and describes CLI output as fallback-only. Current design and implementation use runner-resolved discovery with cache/LKG only as freshness and fallback mechanisms; Design explicitly names this stale module comment for removal.
   - **Impact**: This is a direct corrective-scope/spec violation and gives future maintainers a false source-of-truth contract, making reintroduction of the original regression likely.
   - **Recommendation**: Replace the block with concise runner-resolved wording that describes `adapter.getModelInventory()` as the TUI boundary without asserting configured-provider cache authority or a deprecated CLI fallback path. Re-run the focused source scan and affected TUI matrix.

### Medium

None.

### Low

None.

## Regression Safety

- **Exact variants and persistence**: pass; no assignment, variant, or immutable-plan path changed.
- **Absolute deadline**: pass; the one-budget 14,999/15,000 ms path is untouched.
- **LKG**: pass; fingerprint inputs are secret-safe and presence-sensitive, while storage/schema/privacy behavior is untouched.
- **Pi compatibility**: pass; no Pi source or six-level behavior changed.
- **Accessibility**: pass; loading/error/empty information remains textual and Retry/Back remain keyboard-operable.
- **TUI concurrency**: pass; mounted reverse completion retains latest-result authority.
- **Release checks**: pass; test injection avoids process-wide module mocking.

## Design Fidelity

- **Aligned**: Partially.
- **Deviation**: Runtime behavior aligns, but the stale `app.tsx` module comment violates the Design's explicit cleanup requirement and misstates the inventory authority boundary.

## Review Decision

**Status**: changes-requested  
**Critical Findings**: 0  
**High Findings**: 1  
**Medium Findings**: 0  
**Low Findings**: 0  
**Blocking Findings**: 1  
**Archive Ready**: no  
**Blocker**: remove the obsolete configured-provider-cache/CLI-fallback wording in `apps/cli/src/tui/app.tsx:348-352`.

**Registry Write**: deferred  
**Registry Intent**: phase `corrective-retry-final-review`, status `changes-requested`, event `corrective-retry-review-changes-requested`, artifact `openspec/changes/fix-runner-model-discovery-regression/review-report.md`

## Artifact Preservation

- All prior report content remains above this separator.
- The appended heading is exactly `Corrective Retry Final Review`.
- Only `review-report.md` was intentionally modified.
- Registry state/events, code, tests, and other artifacts were not modified.

---

# Final Mechanical Cleanup Review

## Summary

**Change**: `fix-runner-model-discovery-regression`  
**Phase**: `final-mechanical-review`  
**Scope**: TUI helper comments and directly associated tests  
**Overall Rating**: APPROVE  
**Status**: passed  
**Registry Mode**: deferred

Fresh-context inspection confirms that the obsolete cache-authority wording previously reported at `apps/cli/src/tui/app.tsx:348-352` is gone. The replacement correctly states that the TUI consumes the adapter's resolved runner inventory and that cache/catalog metadata may only enrich runner-reported entries, never create provider, model, or variant availability.

This description matches the current boundary: `resolveOpenCodeModelDiscovery` delegates to `adapter.getModelInventory`, `buildTuiInventoryFromDiscoveryResult` maps only that returned inventory, and `buildTuiInventoryFromAdapterInventory` preserves its provider/model membership and variants. At the adapter layer, live inventory is runner-resolved; optional metadata enrichment is intersection-only and cannot add cache-only models or variants.

A focused source scan found no equivalent configured-provider-cache, cache-as-source-of-truth, or CLI-fallback-only claim in the directly changed TUI helper comments or their tests. The associated test comments consistently describe runner-resolved membership with metadata-only presentation enrichment.

The correction changes comments only. It does not alter executable statements, types, control flow, state, data boundaries, dependencies, or test behavior, so it introduces no code, security, scalability, or integration risk.

Adaptive context was not loaded; this review used current official source, tests, the preserved review artifact, and Serena read-only inspection.

## Final Mechanical Cleanup Disposition

| Review item | Result | Fresh evidence |
|---|---|---|
| Obsolete wording removed | **Pass** | `apps/cli/src/tui/app.tsx:348-352` now describes runner-resolved inventory and metadata-only enrichment; the former configured-provider-cache/CLI-fallback statement is absent. |
| Replacement matches behavior | **Pass** | The TUI delegates discovery to `adapter.getModelInventory` and maps only the returned inventory; adapter enrichment is intersection-only and runner membership/variants remain authoritative. |
| No equivalent nearby claim | **Pass** | Focused scans of `app.tsx` and `developer-team-screens-effort.test.tsx` found no cache-as-authority or runner-output-as-fallback wording. |
| Mechanical edit risk | **Pass** | The edited region is a module comment block only; no executable or type-level behavior changed. |

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

None.

## Review Decision

**Status**: passed  
**Critical Findings**: 0  
**High Findings**: 0  
**Medium Findings**: 0  
**Low Findings**: 0  
**Blocking Findings**: 0  
**Archive Ready**: yes  
**Blockers**: none  
**Registry Write**: deferred  
**Registry Intent**: phase `final-mechanical-review`, status `passed`, event `final-mechanical-review-passed`, artifact `openspec/changes/fix-runner-model-discovery-regression/review-report.md`

## Artifact Preservation

- All prior report content remains above this separator.
- The appended heading is exactly `Final Mechanical Cleanup Review`.
- Only `review-report.md` was intentionally modified.
- Registry state/events, code, tests, and other artifacts were not modified.