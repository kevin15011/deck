# Apply Progress: Runner-Resolved OpenCode Model Discovery

## Repair Record

- Incident: `apply-group0-auth-card`
- Attempt: 1 of 2
- Outcome: completed after the retry supplied the required Authorization Card.
- Scope: delegation metadata repair only; no task scope was expanded.

### Human Override R1: Production Discovery Boundary
**Status**: ✅ Complete

**Incident**: `verify-review-blockers-round-1` (override batch 1 of 1)

**Fingerprints attempted and resolved**
- `opencode-timeout-not-hard-bounded` — caller settlement now occurs at exactly 15,000 ms independently of SIGTERM/SIGKILL reaping; one absolute budget spans version and verbose discovery, and late work cannot commit cache/LKG state.
- `discovery-runtime-cache-fingerprint-lkg-unwired` — default composition now collects a schema-2, secret-safe runner/project/config/auth/plugin/credential-presence context; memory fingerprints and LKG scope derive from it.
- `required-regression-matrix-incomplete` — hermetic default-composition, deadline, reverse-plan, and mounted `DeckApp` injection evidence was added without changing runner authority, Pi, or existing TUI behavior.

**RED / GREEN / REFACTOR evidence**
- RED: the changed process test left the Promise pending at 15,000 ms until the 250 ms SIGKILL grace; the new context test could not resolve its absent collector. The initial RED command was terminated after 30 seconds with the strict deadline test still pending and the missing-module error preserved.
- GREEN: required focused matrix passed: 140 tests, 0 failures. It proves 14,999 ms pending / 15,000 ms caller settlement / later SIGKILL; default adapter invalidation for runner, project/workspace, config, auth, plugin, and credential presence; runner/project LKG-path separation; B→A immutable plan application; and injected `DeckApp` mounting.
- REFACTOR: isolated node process reaping from caller state, centralized production discovery context collection, and retained plan bindings in the existing WeakMap. All files are `not_generated`; fakes, fixture paths, temporary test directories, and injected timers/processes avoid live runners, network, home writes, and secrets.

**Verification**
- Focused R1: passed — 140 tests, 0 failures.
- Typecheck: `bunx tsc --noEmit` — passed.
- Affected adapter/TUI: `bun test packages/adapter-opencode/src apps/cli/src/tui` — 596 tests, 0 failures.
- Package: `bun run test` — 3,274 tests, 0 failures.
- Repo-wide baseline: `bun test` — 3,273 passed, 1 failed. The only failure is the recorded `Binary smoke tests > doctor runs and reports diagnostics` timeout; no new failure fingerprint was introduced.

**Next action**
Final Verify + Review cycle 2. The override batch and one additional attempt for each scoped fingerprint are consumed; any scoped recurrence or cycle-2 failure hard-stops further Apply.

### Repair Batch 1: Backend and Security
**Status**: ✅ Complete

**Incident**: `verify-review-blockers-round-1` (batch 1 of 3)

**Fingerprints repaired**
- `discovery-runtime-cache-fingerprint-lkg-unwired` — the production OpenCode adapter now owns one cache and one private LKG store, derives a secret-safe fingerprint from canonical executable/stat/version plus safe presence signals, and injects them into every discovery.
- `opencode-timeout-not-hard-bounded` — subprocess output is byte-bounded and UTF-8-safe; timeout/output termination is classified explicitly, SIGTERM is sent once, and SIGKILL settlement is bounded.
- `unchanged-assignment-field-mutation` — generated entries emit model/variant fields only for changed agents, preserving raw assignment fields for unchanged merges.
- `lkg-validation-privacy-integrity` — LKG reads use a closed allowlisted DTO, timestamp/fingerprint/identity bounds, private-mode checks, unsafe-link rejection, random same-directory temporary files, cleanup, and atomic rename.
- `mutable-last-plan-cross-request-risk` — native plans and validation evidence are held in a plan-keyed weak binding; apply/backup/verify use the supplied plan only.
- `chunked-utf8-decoding-corruption` — process streams use `StringDecoder` and byte accounting before decoding.

**TDD evidence**
- RED: `model-inventory-cache.test.ts` failed because a snapshot containing an unknown `leakedSecret` field was accepted.
- GREEN: the focused adapter test set passed after the closed DTO and production wiring repairs.
- REFACTOR: reduced assignment emission to the changed-agent branch and replaced mutable adapter-wide plan fields with immutable plan-keyed bindings.

**Verification**
- Focused tests: `bun test ./packages/adapter-opencode/src/model-inventory-cache.test.ts ./packages/adapter-opencode/src/opencode-models-cli.test.ts ./packages/adapter-opencode/src/model-inventory.test.ts ./packages/adapter-opencode/src/runner-adapter.inventory.test.ts ./packages/adapter-opencode/src/config-merge.test.ts` — passed (35 tests).
- Typecheck: `bunx tsc --noEmit` — passed.
- Build: not run; Batch 3 owns final gates.

**Generated-file classification**
- All touched files are `not_generated`; no generated or untracked build output was modified.

**Next action**
Proceed to Repair Batch 2 (TUI and compatibility). Verification cycles remain at 0 of 2.

### Repair Batch 2: TUI and Compatibility
**Status**: ✅ Complete

**Incident**: `verify-review-blockers-round-1` (batch 2 of 3)

**Fingerprints repaired**
- `runner-variant-static-resolution-leak` — OpenCode now selects and persists only the exact key in the live ready-inventory variant list. Static reasoning resolution/defaults are no longer used on the OpenCode path; Pi retains its fixed resolver.
- `async-discovery-stale-response-overwrite` — the DeckApp discovery coordinator assigns a monotonic generation and runtime/project identity to every request. Only the newest matching completion may update discovery, provider/model inventory, assignment status, cursor, or screen; assignment status is derived from the request-time assignment snapshot.
- `successful-empty-state-routing` — ready is no longer coerced to empty. Successful empty discovery remains on `opencode-model-discovery` with the native Retry and Back actions.

**TDD evidence**
- RED: the new deferred coordinator test initially failed to load because `createOpenCodeDiscoveryCoordinator` did not exist.
- GREEN: hermetic deferred-Promise tests now prove both completion orders, project identity rejection, and empty Retry/Back action routing. A runner-only model with `exact/runner-key` passes exact validation and persists as native `variant` without `reasoningEffort`.
- REFACTOR: extracted the small coordinator/action boundary from DeckApp so the generation/identity policy is independently testable while state application remains in DeckApp.

**Verification**
- TUI discovery/assignment/flow: `bun test apps/cli/src/tui/opencode-discovery.test.ts apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx apps/cli/src/tui/developer-team-flow.test.tsx` — 85 passed, 0 failed.
- Adapter/install: `bun test packages/adapter-opencode/src/runner-adapter.inventory.test.ts packages/adapter-opencode/src/developer-team-install.test.ts --test-name-pattern 'runner-only non-canonical variant|OpenCode adapter dynamic inventory'` — 4 passed, 0 failed, 73 unrelated installer cases filtered.
- Typecheck: `bunx tsc --noEmit` — passed.
- Build: not run; Batch 3 owns full gates.

**Accessibility**
- Retry and Back remain keyboard-selectable native `MenuList` items; loading, empty, stale, and blocked states provide text status rather than color-only meaning.

**Generated-file classification**
- All Batch 2 files are `not_generated`; no generated output, network access, live runner, or real user filesystem writes were used. Native-persistence evidence uses a temporary test directory.

**Next action**
Proceed to Repair Batch 3 (regression matrix and cleanup). Verification cycles remain at 0 of 2.

### Repair Batch 3: Regression Matrix and Cleanup
**Status**: ✅ Complete

**Incident**: `verify-review-blockers-round-1` (batch 3 of 3)

**Fingerprint repaired**
- `required-regression-matrix-incomplete` — completed deterministic parser, process, cache, LKG, persistence, TUI, and Pi evidence using hermetic fixtures, injected clocks, fake processes, and fake filesystems.

**Files Changed**
- `packages/adapter-opencode/src/opencode-models-cli.ts` — exposed an injected process/timer factory for deterministic deadline, termination, and chunk-decoding tests.
- `packages/adapter-opencode/src/opencode-models-cli.test.ts` — covers provider classes, nested/braced/escaped records, parser limits, split UTF-8, exact 14,999/15,000 ms timing, ignored termination, and output limits.
- `packages/adapter-opencode/src/model-inventory-cache.ts` — rejects LKG reads from a group/world-accessible directory.
- `packages/adapter-opencode/src/model-inventory-cache.test.ts` — covers in-flight coalescing, failure retry, LRU, rescan, complete non-secret fingerprints, LKG compatibility/privacy, and atomic persistence.
- `packages/adapter-opencode/src/developer-team-install.test.ts` — reconciles legacy changed-write expectations with exact native `variant` persistence while preserving unchanged assignments.
- `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` — replaces obsolete cache-authority fixture prose and naming with runner-resolved terminology.

**TDD Evidence**
- RED: the process-boundary test failed because `createNodeOpenCodeCommandRunner` was not exported; the expanded LKG compatibility test failed because a public directory was accepted.
- GREEN: added the smallest injectable process/timer seam and directory-private LKG read guard; focused matrix passed.
- REFACTOR: reconciled legacy fixture expectations and comments to runner-resolved authority without adding dependencies or changing unrelated runtime behavior.

**Verification**
- Focused matrix: Task 4.1 files plus `apps/cli/src/tui/opencode-discovery.test.ts` — 272 passed, 0 failed.
- Typecheck: `bunx tsc --noEmit` — passed.
- Broader adapter/TUI: `bun test packages/adapter-opencode/src apps/cli/src/tui` — 591 passed, 0 failed.
- Package tests: `bun run test` — 3,269 passed, 0 failed.
- Repo-wide baseline comparison: `bun test` — 3,268 passed, 1 failed. The sole failure is the existing `repo-bun-test` fingerprint `Binary smoke tests > doctor runs and reports diagnostics`; baseline totals remain intentionally unchanged.

**Hermeticity and Generated Files**
- All Batch 3 files are `not_generated`. Tests use fixture transcripts, fake process events/timers, injected clocks, and fake filesystems; no network, live runner, or real user filesystem authority is used.

**Code Economy Self-Check**
- Simpler existing path considered: Yes — the existing command runner was reused through a minimal injected factory.
- New dependency/abstraction added: No — only a local test seam.
- Advisory budget exceeded: No for Batch 3.
- Quality override used: Yes — explicit adversarial coverage is required by REQ-TEST-002.

**Next action**
Verify + Review cycle 1. Apply batches are exhausted at 3 of 3; verification cycles remain at 0 of 2.

## Completed Tasks

### Task 0.1: Define runner-neutral async discovery and changed-write contracts
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/runner-adapter.ts` — added runner-neutral asynchronous discovery, validation, variant-key, and changed-write evidence contracts.
- `packages/core/src/index.ts` — exported the new shared contract types.
- `packages/core/src/adapter-registry.test.ts` — added compile-backed behavioral coverage for ready results, arbitrary variant keys, changed-agent validation, and Pi omission.
- `packages/core/src/__tests__/runner-adapter-contract.test.ts` — aligned existing contract assertions with asynchronous discovery and arbitrary variant keys.
- `packages/adapter-opencode/src/runner-adapter.ts` — preserved the legacy facade behind a temporary cast; Group 2 owns implementation of the new asynchronous ports.
- `apps/cli/src/tui/app.tsx` — widened the local presentation return type to runner variant keys without changing TUI behavior.
- `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` — retained legacy fixture access explicitly while the Group 3 async migration remains pending.

**Verification**
- Tests: `bun test packages/core/src/adapter-registry.test.ts packages/core/src/__tests__/runner-adapter-contract.test.ts packages/adapter-opencode/src/opencode-models-cli.test.ts` — 31 passed.
- Typecheck: `bunx tsc --noEmit` — passed.
- Build: not run; not required for this focused Group 0 contract slice.

**Notes**
The core contract is intentionally runner-neutral. Pi omits the dynamic discovery and validation ports and retains fixed reasoning levels. The existing OpenCode facade remains behaviorally unchanged until Group 2 implements the new ports.

### Task 0.2: Establish hermetic OpenCode verbose fixtures and injected seams
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/opencode-models-cli.ts` — created adapter-local command, filesystem, clock, environment, and executable-resolution seam contracts.
- `packages/adapter-opencode/src/__tests__/opencode-models-cli-test-helpers.ts` — created controlled fixture dependencies that reject live runner, shell/network helper, real-user-path, write, and uncontrolled-clock access.
- `packages/adapter-opencode/src/__tests__/fixtures/opencode-models-verbose/opencode-1.17.18-valid.txt` — added a versioned valid verbose transcript fixture.
- `packages/adapter-opencode/src/__tests__/fixtures/opencode-models-verbose/opencode-1.17.18-invalid.txt` — added a versioned malformed verbose transcript fixture.
- `packages/adapter-opencode/src/opencode-models-cli.test.ts` — added fixture-driven hermeticity coverage.

**Verification**
- Tests: `bun test packages/adapter-opencode/src/opencode-models-cli.test.ts` — 2 passed.
- Hermeticity: the fake command runner rejects non-fixture executables, shells, network helpers, `--refresh`, `--pure`, and real-user paths; the fixture filesystem is read-only and the clock is injected.

**Notes**
No command execution, parser, cache, snapshot, or OpenCode orchestration behavior was implemented. Those remain owned by later groups.

### Task 1.1: Implement bounded command execution and strict verbose-record parsing
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/opencode-models-cli.ts` — implemented literal, shell-free `opencode models --verbose` execution boundary, 15,000 ms deadline, output limits, and all-or-nothing record parser.
- `packages/adapter-opencode/src/opencode-models-cli.test.ts` — added fixture-driven command-vector, final-key, empty-output, and malformed-record coverage.

**Verification**
- Tests: `bun test packages/adapter-opencode/src/opencode-models-cli.test.ts` — 4 passed.

**Notes**
The parser splits identifiers at the first slash, preserves final variant-key order, and rejects duplicate, trailing, provider-mismatched, malformed, or oversized runner output without exposing partial data or raw stderr.

### Task 1.2: Implement fingerprinted memory cache and compatible 24-hour LKG
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/model-inventory-cache.ts` — added secret-safe SHA-256 fingerprints, bounded five-minute LRU/coalescing cache, and private normalized LKG store.
- `packages/adapter-opencode/src/model-inventory-cache.test.ts` — added fake-clock TTL/rescan and secret-presence fingerprint tests.

**Verification**
- Tests: `bun test packages/adapter-opencode/src/model-inventory-cache.test.ts` — 2 passed.

**Notes**
Fingerprint input records environment variable names/presence only; it excludes environment values and raw runner/config/auth data. LKG storage accepts only normalized runner-origin inventory and uses private directory/file modes with atomic rename.

### Task 1.3: Replace cache-authoritative inventory orchestration with runner-only normalization
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/model-inventory.ts` — replaced cache authority with memory → live runner → matching LKG → blocked orchestration and intersection-only metadata enrichment.
- `packages/adapter-opencode/src/model-inventory.test.ts` — replaced cache-authority cases with runner-only, metadata-isolation, stale, blocked, and empty-inventory tests.

**Verification**
- Tests: `bun test packages/adapter-opencode/src/model-inventory.test.ts` — 3 passed.

**Notes**
Metadata cannot add models/providers or alter runner variants. Command failure and malformed output remain fail-closed.

### Task 2.1: Wire async OpenCode adapter discovery and exact changed-assignment validation
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/runner-adapter.ts` — implemented async inventory/validation ports, exact model and case-sensitive variant validation, ready-snapshot lookup, and fingerprint revalidation.
- `packages/adapter-opencode/src/runner-adapter.inventory.test.ts` — added ready/stale propagation and exact-assignment validation tests.

**Verification**
- Tests: `bun test packages/adapter-opencode/src/runner-adapter.inventory.test.ts` — 2 passed.
- Typecheck: `bunx tsc --noEmit` — passed.

**Notes**
OpenCode no longer performs suffix matching or static/catalog fallback for dynamic variants. A stale or blocked state cannot authorize changed writes.

### Task 2.2: Preserve stale reads and enforce native variant-only changed writes
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/model-config.ts` — reads native `variant` before legacy `reasoningEffort` and retains raw persisted assignments.
- `packages/adapter-opencode/src/model-config.test.ts` — added native-variant precedence/non-destructive-read coverage.
- `packages/adapter-opencode/src/developer-team-install.ts` — carries changed-agent metadata into native install plans.
- `packages/adapter-opencode/src/config-merge.ts` — preserves unchanged fields and removes legacy reasoning only for changed native-variant assignments.
- `packages/adapter-opencode/src/types.ts` — allows native arbitrary `variant` strings.

**Verification**
- Tests: `bun test packages/adapter-opencode/src/model-config.test.ts packages/adapter-opencode/src/developer-team-install.test.ts` — passed.

**Notes**
Apply-time validation occurs before install writes. Unchanged agent configuration remains merged from the pre-existing entry; changed agent variant fields use native OpenCode representation.

### Task 2.3: Lock Pi semantics and cross-runner failure isolation
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/runner-capabilities.ts` — maintained legacy capability type compatibility while dynamic OpenCode values stay adapter-owned.
- `packages/adapter-pi/src/runner-adapter.test.ts` — verified unchanged Pi assignment/config behavior.
- `packages/adapter-pi/src/model-config.test.ts` — verified unchanged Pi provider and six-level semantics.

**Verification**
- Tests: `bun test packages/adapter-pi/src/runner-adapter.test.ts packages/adapter-pi/src/model-config.test.ts` — 39 passed.
- Typecheck: `bunx tsc --noEmit` — passed.

**Notes**
Pi does not implement or consume OpenCode discovery, snapshot, stale-write, or arbitrary-variant rules. OpenCode failure states remain adapter-local.

### Task 3.1: Render async runner states and rescan without network refresh
**Status**: ✅ Complete

**Files Changed**
- `apps/cli/src/tui/app.tsx` — replaced the OpenCode CLI/cache fallback and sync probing with adapter-owned async discovery state, local rescan, dirty-agent validation, and validated-fingerprint plan evidence.
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — added terminal-readable loading, empty, stale, and blocked discovery views; preserved distinct unavailable model/variant labels; and hid reasoning choice for zero-variant models.
- `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` — added hermetic discovery-state, runner-only inventory, local-rescan, unavailable-assignment, and zero-variant rendering coverage; removed obsolete fallback assertions.

**Verification**
- RED: `bun test apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` — 44 passed, 4 failed as expected because Group 3 discovery helpers/screens and zero-variant copy did not exist.
- GREEN/REFACTOR Tests: `bun test apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx apps/cli/src/tui/developer-team-flow.test.tsx packages/adapter-opencode/src/runner-adapter.inventory.test.ts` — 84 passed, 0 failed.
- Typecheck: `bunx tsc --noEmit` — passed.
- Build: not run; not required for this focused Group 3 slice.

**Notes**
The TUI now starts OpenCode discovery with a visible loading state and consumes only the async adapter result. `r` and Retry use `{ mode: "rescan" }` only; no UI path invokes `--refresh`. Stale inventory remains inspectable but blocks changed writes, while ready inventory permits changed-agent-only validation. Pi retains its independent flow. All tests use render fixtures and injected adapter results; they do not invoke a runner, network, or user filesystem.

### Task 4.1: Reconcile overlapping change behavior and execute the complete deterministic matrix
**Status**: ✅ Complete

**Files Changed**
- `packages/adapter-opencode/src/__tests__/opencode-cross-cutting.test.ts` — replaced obsolete cache-authoritative assertions with runner-fixture reconciliation coverage.
- `packages/adapter-opencode/src/developer-team-install.ts` — prevents a changed OpenCode assignment from also emitting the legacy `reasoningEffort` field.
- `packages/adapter-opencode/src/developer-team-install.test.ts` — added native-variant-only changed-assignment regression coverage.

**RED Evidence**
- `bun test packages/adapter-opencode/src apps/cli/src/tui` initially failed three obsolete cache-authoritative assertions: `loads model inventory from fixture cache`, `readConfig clears stale variant not in confirmed set`, and `different models have different variant sets`.
- The new focused changed-assignment test initially failed because a valid native variant also emitted legacy `reasoningEffort` (`Received: "custom-fast"`).

**GREEN / REFACTOR Evidence**
- Replaced the conflicting cache tests with hermetic runner-only membership, exact-final-key/zero-variant, and non-destructive persisted-variant tests.
- Restricted legacy `reasoningEffort` emission to unchanged compatibility paths; changed OpenCode assignments now emit native `variant` only.
- `bun test packages/adapter-opencode/src/__tests__/opencode-cross-cutting.test.ts packages/adapter-opencode/src/developer-team-install.test.ts` — 76 passed, 0 failed.

**Verification**
- Focused matrix: the exact Task 4.1 command — 259 passed, 0 failed.
- Typecheck: `bunx tsc --noEmit` — passed.
- Broader adapter/TUI: `bun test packages/adapter-opencode/src apps/cli/src/tui` — 578 passed, 0 failed.
- Repository script: `bun run test` — 3,256 passed, 0 failed.
- Repository-wide: `bun test` — 3,255 passed, 1 known baseline failure: `Binary smoke tests > doctor runs and reports diagnostics` (the exact ledger fingerprint under `repo-bun-test` in `openspec/baseline-health.yaml`). No new failures.

**Reconciliation Notes**
- `opencode-configured-providers-filter`: retained its independent `MenuList` windowing/cursor behavior; runner fixtures now prove cache/auth-style metadata cannot supply availability.
- `fix-opencode-effort-levels-hardcoded`: runner final keys and empty variant sets remain authoritative; cache variants and hardcoded levels are not selectable authority.
- `tui-model-assignment-bug`: valid changed OpenCode assignments retain the existing review/install path; this task only enforces the native-variant persistence boundary and does not take Pi/team propagation ownership.
- The focused parser/cache/adapter/config/TUI/Pi matrix confirms the 15,000 ms command request, 5-minute `4:59`/`5:00` cache boundary, secret-safe fingerprint inputs, private compatible 24-hour LKG eligibility, stale/blocked write rejection, persisted-assignment preservation, exact/empty variants, built-in/custom/plugin/alias fixture handling, and Pi isolation. All discovery tests use injected command/filesystem/clock/environment seams with no network, live runner authority, or real-user-filesystem writes.

## Remaining Tasks

- None — all tasks are complete; ready for Verify/Review.

## Code Economy Self-Check

- Simpler existing path considered: Yes — existing adapter cache loading was retained; only neutral contracts and test seams were added.
- New dependency/abstraction added: No — interfaces and fakes use existing TypeScript and Bun facilities.
- Advisory budget exceeded: Yes — the Groups 1–2 runner boundary, cache, persistence safety, and regression tests require cross-module changes.
- Quality override used: Yes — focused tests and hermetic guards are necessary to enforce the requested no-network/no-live-runner/no-real-user-filesystem boundary.

## Final Closure Exception Apply

**Status**: Partial implementation complete; mandatory gates delegated to final closure verification.

**Authorized Scope Completed**
- Replaced coarse string redaction with a typed secret-safe semantic projection and JSONC handling.
- Added mounted `DeckApp` deferred-discovery transition tests and fixed the loading-route wiring defect exposed by RED.
- Converted the remaining literal `\\n` fixture comment into normal comments.

**TDD Evidence**
- RED: reproduced a same-stat semantic configuration fingerprint collision; mounted loading-to-ready coverage exposed missing loading routing.
- GREEN: semantic projection tests and mounted loading-to-ready test passed.
- REFACTOR: retained a minimal typed redaction/JSONC parser with no new dependency.

**Incident Note**
- The Apply agent's combined verification command exceeded its execution window before mandatory broader gates and registry updates completed.
- No additional Apply retry is authorized. The final closure Verify + Review cycle owns all remaining gates and source-level acceptance evidence.

## Separately Authorized Corrective Completion

- Backend fingerprint projection now uses closed field-aware semantics, redacts secret values to presence/type markers, supports JSON/JSONC/virtual config, and extracts direct plus embedded `{env:NAME}` references.
- Mounted `DeckApp` tests exercise latest-request-first reverse completion and the actual discovery Back action.
- Release-check dependency is injected locally; no process-wide module mock leaks into broader suites.
- Obsolete cache-authority comments were replaced with runner-resolved terminology.
- Corrective focused matrix: 151 passed.
- Typecheck: passed.
- Broader adapter/TUI: 607 passed.
- Package tests: 3,285 passed.
- Repo-wide: 3,284 passed with only the known Binary doctor baseline failure.
- Final Review: zero findings; archive ready.
