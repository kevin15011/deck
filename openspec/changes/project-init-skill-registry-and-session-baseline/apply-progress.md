# Apply Progress — T01 Canonical Authority Fragments

## Immutable Apply-local result

- **Change:** `project-init-skill-registry-and-session-baseline`
- **Authorized task:** T01 — Add canonical authority fragments
- **Status/action:** `passed`; T01 is implemented and ready for fresh independent Verify. No claim is made for T02–T13 or full-change readiness; T11–T13 remain gated.
- **Role/instance provenance:** `deck-developer-apply-general` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T00:06:32.334Z`.
- **Evidence class:** Apply-local and non-independent. This evidence does not satisfy TARGETED Verify, AFFECTED_AREA Verify, independent Review, or mandatory BROAD.
- **Adaptive context:** advisory Supermemory context was loaded; official OpenSpec artifacts remained authoritative.

## Dependency references

- Proposal: `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`
- Spec: `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`
- Design: `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`
- Tasks: `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`

All four supplied digests were recomputed from the official files and matched exactly before implementation.

## Skill discovery and candidate readiness

- Skill Discovery Context V1: registry `.atl/skill-registry.md`; status `indeterminate`; reason `validate_command_returned_unexpected_interactive_menu`; active runner `opencode`; authority reminder `v1`.
- Bounded direct discovery used only active-runner-exposed skills. Loaded the role skill plus `using-agent-skills`, `test-driven-development`, `api-and-interface-design`, `git-workflow-and-versioning`, and, after a TypeScript CLI invocation error, `debugging-and-error-recovery`.
- Candidate readiness: `ready-for-independent-verify` for T01 only. No required capability was unavailable. The registry was not generated, repaired, reformatted, or modified.

## Changed paths and digests

- `packages/core/src/teams/developer/readiness-authority.ts` (new): `sha256:d8c84c89939b9647f6290c59ff6cd7577833f98c5ccecdbba0cf6a3fd8a265b4` (2,576 bytes before this report).
- `packages/core/src/teams/developer/readiness-authority.test.ts` (new): `sha256:9115b91bbb84f7f748230413693755ab9d5cb43570ee91dd617612c8fca0b884` (4,807 bytes before this report).
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md` (new; this Apply artifact).

No other path was edited. Pre-existing WIP in `openspec/changes/opencode-package-install-running-binary-regression/state.yaml` and `events.yaml` remained untouched. No Git state operation was performed.

## TDD and verification evidence

### RED — expected failure

- Command: `bun test packages/core/src/teams/developer/readiness-authority.test.ts`
- Result: exit `1`; `Cannot find module './readiness-authority'`; `0 pass`, `1 fail`, `1 error`.
- Meaning: the authorized test imported the required stable symbols before implementation, proving the canonical module/exports and bytes were absent.

### GREEN — focused authority proof

- Command: `bun test packages/core/src/teams/developer/readiness-authority.test.ts`
- Result: exit `0`; `2 pass`, `0 fail`, `18 expect() calls`.
- Proven behavior: exact text equality; exact UTF-8 bytes; required heading and paragraph break; punctuation through byte equality; absence of template interpolation markers; stable SHA-256 values; one-byte mutation rejection; and exactly-once composition with duplicate rejection.

### Bounded Core typecheck and diagnostics

- Initial command: bounded `bun x tsc --noEmit ... <two T01 files>`.
- Initial result: exit `1`, TypeScript `TS5112` because TypeScript 7 requires `--ignoreConfig` when root files are supplied while `tsconfig.json` exists. This was a command-invocation deviation, not a source diagnostic.
- Corrected command: `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun packages/core/src/teams/developer/readiness-authority.ts packages/core/src/teams/developer/readiness-authority.test.ts`
- Corrected result: exit `0`, no diagnostics.
- Serena diagnostics: both authorized TypeScript files returned no diagnostics.

### Functional exercise through actual import/use

- Command: `bun -e <actual import of both readiness-authority exports; heading/hash/composition use>`
- Result: exit `0`.
- Observed values: deck heading `## Deck Preparation Authority Boundary`; deck fragment `sha256:1ad0630420b0955f70bf1f601aa06ba48b9d7602f72d4a300f6da426df987766`; finding heading `## Finding Disposition and Baseline Authority Boundary`; finding fragment `sha256:8d0c47f538f821d5f803c93b423cdd79a18cdbee9342e6655e99190b1cf0375e`; composition occurrence counts `[1,1]`.

## Task and EII coverage

- **EII-PISB-001 (`byte-verbatim`):** implemented as stable export `DECK_PREPARATION_AUTHORITY_BOUNDARY_V1`; exact fenced Design bytes reproduced; fragment hash `sha256:1ad0630420b0955f70bf1f601aa06ba48b9d7602f72d4a300f6da426df987766`.
- **EII-PISB-002 (`byte-verbatim`):** implemented as stable export `FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1`; exact fenced Design bytes reproduced; fragment hash `sha256:8d0c47f538f821d5f803c93b423cdd79a18cdbee9342e6655e99190b1cf0375e`.
- T01 mappings covered by these canonical byte sources and assertions: REQ-003, REQ-012, REQ-017, REQ-018, REQ-019, REQ-020, REQ-022, REQ-025, and REQ-028.
- No policy runtime, generalized helper, dependency, generated output, downstream composition, or T02–T13 behavior was added.

## Target/product validation classification

- **Classification:** target/product validation is not genuinely required for T01.
- **Reason:** T01 creates pure static TypeScript exports with no installed-runner, CLI/TUI, browser, service, database, network, or platform effect. Focused tests, bounded typecheck/diagnostics, and an actual runtime import/use exercise are proportionate functional proof. Final independent QA remains pending.

## Deviations, manifests, intents, and blockers

- Serena edit tools could not create either new target because no existing symbol/file anchor existed. Exact fallback report: `Serena edit tools unavailable; fallback used: apply_patch`.
- The first bounded typecheck invocation omitted TypeScript 7's required `--ignoreConfig`; the corrected bounded invocation passed. No source change was required.
- Implementation deviation from T01 or Design EIIs: none.
- `FailureManifestV1`: not produced; there are no open findings, and no coordinator-issued `ApplyBatchContractV1` was supplied from which a valid manifest could be built.
- Ordered `RegistryIntentV1` values: `[]`. A valid batch-bound intent was not invented; centralized registry YAML remained untouched for coordinator reconciliation.
- Blockers: none for T01. Full-change progression still depends on T02–T13, with T11–T13 explicitly gated.

---

# Apply Progress — T02 Session Preparation Authorization Runtime

## Immutable Apply-local result

- **Change:** `project-init-skill-registry-and-session-baseline`
- **Authorized task:** T02 — Implement trusted once-per-session preparation authorization runtime.
- **Status/action:** `passed`; T02 is implemented and ready for fresh independent Verify. No claim is made for T03–T13 or full-change readiness; T11–T13 and predecessor-overlapping targets remain gated.
- **Role/instance provenance:** `deck-developer-apply-backend` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T00:20:52.165Z`.
- **Evidence class:** Apply-local and non-independent. This evidence does not satisfy TARGETED Verify, AFFECTED_AREA Verify, independent Review, or mandatory BROAD.
- **Adaptive context:** advisory Supermemory context was loaded; official OpenSpec artifacts and repository evidence remained authoritative.

## Dependency references

- T01 dependency export source: `packages/core/src/teams/developer/readiness-authority.ts`, `sha256:d8c84c89939b9647f6290c59ff6cd7577833f98c5ccecdbba0cf6a3fd8a265b4`; required `DECK_PREPARATION_AUTHORITY_BOUNDARY_V1` export was present before T02 editing.
- Proposal: `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`.
- Spec: `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`.
- Design: `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`.
- Tasks: `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`.
- All four official artifact digests were recomputed and matched the authoritative values.

## Skill discovery and candidate readiness

- Skill Discovery Context V1: registry `.atl/skill-registry.md`; status `indeterminate`; reason `validate_command_returned_unexpected_interactive_menu`; active runner `opencode`; authority reminder `v1`.
- Bounded direct discovery used only generic project sources and active-runner-exposed skills. Loaded `deck-developer-apply-backend`, `using-agent-skills`, `api-and-interface-design`, `security-and-hardening`, and `test-driven-development`.
- Candidate readiness: `ready-for-independent-verify` for T02 only. No required capability was unavailable. The Skill Registry, `.gitignore`, generated output, installed runner, user-home state, Git state, and centralized registry YAML were not modified.

## Changed paths and digests

- `packages/sdd-runtime/src/execution/session-preparation.ts` (new): `sha256:c3c2bb6f3b23000edde384ddbadab807822baf59e96748e313ffd3624ab0d61a` (32,591 bytes before this report).
- `packages/sdd-runtime/src/execution/session-preparation.test.ts` (new): `sha256:94eb32241befe314c3b2829e962d5618900a65907b455b7d98ce6c6e6705224a` (14,447 bytes before this report).
- `packages/sdd-runtime/src/index.ts`: `sha256:3060157a285b87719bb8cd171c5f1dbfb8d8d7c205e5d884714154555fdcf099` (9,938 bytes before this report).
- `packages/sdd-runtime/src/index.test.ts`: `sha256:74b478d7fea1ee26850366c64e3bce0c9ca3cf279b76d6615313381bef63ae1d` (692 bytes before this report).
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md` (append only; this T02 evidence).
- No other path was edited by this T02 Apply instance. T01 source/test files remained unchanged. No Git operation was performed.

## Strict TDD and focused verification evidence

### RED — expected failure

- Command: `bun test packages/sdd-runtime/src/execution/session-preparation.test.ts`.
- Result: exit `1`; `Cannot find module './session-preparation'`; `0 pass`, `1 fail`, `1 error`.
- Meaning: the authorized tests imported the required T02 runtime contract before implementation, proving the module and behavior were absent.

### GREEN — focused T02 proof

- Command: `bun test packages/sdd-runtime/src/execution/session-preparation.test.ts packages/sdd-runtime/src/index.test.ts`.
- Result: exit `0`; `10 pass`, `0 fail`, two files.
- Covered: all five Skill Registry statuses; five OpenSpec classifications; no-need and combined one-delegation decisions; duplicate request behavior; root/runner mismatch; malformed OpenSpec blocking; cleanup; monotonic terminal handoff; valid one-use consume; replay; missing provider/envelope; malformed/tampered/expired/future/restarted/revoked proof; every session/invocation/agent/runner/root/delegation/need/operation-set/blocked-target-set/component/action/target mismatch; blocked target; deterministic aggregation; legacy compatibility outcomes; bounded-data rejection; and additive index exports.

### Focused typecheck and diagnostics

- Command: `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun packages/sdd-runtime/src/execution/session-preparation.ts packages/sdd-runtime/src/execution/session-preparation.test.ts packages/sdd-runtime/src/index.ts packages/sdd-runtime/src/index.test.ts`.
- Result: exit `0`; no diagnostics.
- Serena diagnostics: all four authorized TypeScript targets returned no diagnostics after fixes.

### Functional runtime exercise

- Command: `bun -e <actual import from packages/sdd-runtime/src/index.ts; issue and consume exact authority; replay same envelope; consume fresh envelope with mismatched target>`.
- Result: exit `0`; observed `{"valid":true,"replay":"AUTHZ_REPLAYED","mismatch":"AUTHZ_TARGET_MISMATCH"}`.
- This is Apply-local functional evidence across the actual public package export, not independent product acceptance.

### No-effect and reachability proof

- Static import/effect inspection of `session-preparation.ts` found only `node:crypto` and `../contracts/canonical` imports.
- Forbidden effect references found: `[]` for filesystem APIs, child processes, network fetch, package/installer execution, process environment/configuration, file mutation, and command execution.
- The module exposes bounded symbolic contracts only. It performs no filesystem, Skill Registry writer, capability initializer, installer, CLI, TUI, user-home, Git, baseline-ledger, `state.yaml`, or `events.yaml` effect.

## Task, requirement, and EII coverage

- **EII-PISB-001 runtime semantics:** exact delegation remains separate from trusted process-local HMAC-SHA-256 authority; caller/request parsing rejects extra prompt-derived authority fields; claims bind session, invocation, `deck-init`, runner, root digest, delegation digest, need set, closed operation set, blocked targets, component/action/target; invalid authority fails closed before reservation/effect; authority is one-use, restart-local, revocable, and bounded to five minutes with thirty-second future skew.
- **Design §§1–5 and Session state:** once-per-session state is root/runner/invocation-bound and monotonic; unsafe malformed/unreadable OpenSpec blocks; ready state avoids delegation; combined needs yield one delegation decision; cleanup removes only ephemeral state; handoff/telemetry parsing is bounded and deterministic; `legacyOutcome` fails closed for partial/blocked results.
- **Mapped requirements/scenarios:** T02 runtime coverage implemented for REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-007, REQ-012, REQ-016, REQ-026, and REQ-027 within the module-only boundary. T03–T05 adapter/subagent effects remain out of scope.
- **Compatibility:** existing exports remain additive; no dependency was added; no CLI/TUI/service/public project-init API was introduced.

## Target/product validation classification

- **Classification:** target/runtime functional validation was genuinely required and completed conditionally for T02.
- **Reason:** T02 is a security-sensitive process-local runtime contract. Focused tests, strict bounded typecheck, Serena diagnostics, negative effect reachability, and an actual exported-runtime valid/replay/mismatch exercise provide proportionate Apply-local proof. Installed-runner/product validation is not applicable until T03/T04 hooks exist; fresh independent TARGETED/AFFECTED_AREA/Review/BROAD remain pending.

## Deviations, manifests, intents, and blockers

- Serena could not create the two new files or anchor export-only `index.ts`; exact fallback report: `Serena edit tools unavailable. Using fallback: apply_patch.` Serena symbolic replacement was used for the existing `index.test.ts` callback, and Serena diagnostics were used for every TypeScript target.
- During GREEN, focused tests and diagnostics identified and corrected test identity setup, restart-fixture key reuse, narrow TypeScript literal/cast diagnostics, exact delegation-digest binding, and blocked-target fixture binding. Every finding was fixed and the focused checks were rerun successfully.
- Implementation deviation from T02, mapped requirements, or Design EII semantics: none.
- `FailureManifestV1`: not produced; no open finding remains, and no coordinator-issued `ApplyBatchContractV1` was supplied from which a valid manifest could be built.
- Ordered `RegistryIntentV1` values: `[]`. No valid batch-bound registry intent was invented; centralized registry YAML remains coordinator-owned.
- Blockers: none for T02. T03–T13 remain unimplemented by this batch; T11–T13 and predecessor-overlapping paths remain explicitly gated.

# Apply Progress — T03/T04 Runner Preparation Authority Hooks

## Immutable Apply-local result

- **Change:** `project-init-skill-registry-and-session-baseline`.
- **Authorized sequential immutable batch:** T03 — bind trusted preparation authority in the OpenCode runner hook; then T04 — bind trusted preparation authority in the Pi runner hook.
- **Status/action:** `passed`; T03 and T04 are implemented and ready for fresh independent Verify. This is not full-change readiness: T05–T13 remain outside this batch, and T11–T13 plus predecessor-overlapping paths remain gated.
- **Role/instance provenance:** `deck-developer-apply-backend` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T00:38:51.790Z`.
- **Evidence class:** Apply-local and non-independent. This evidence does not satisfy TARGETED Verify, AFFECTED_AREA Verify, independent Review, or mandatory BROAD.
- **Adaptive context:** advisory Supermemory context was loaded; official OpenSpec artifacts, source, and tests remained authoritative.

## Dependency references and freshness

- T02 runtime source: `packages/sdd-runtime/src/execution/session-preparation.ts`, `sha256:c3c2bb6f3b23000edde384ddbadab807822baf59e96748e313ffd3624ab0d61a`, 32,591 bytes.
- T02 runtime test: `packages/sdd-runtime/src/execution/session-preparation.test.ts`, `sha256:94eb32241befe314c3b2829e962d5618900a65907b455b7d98ce6c6e6705224a`, 14,447 bytes.
- T02 package export: `packages/sdd-runtime/src/index.ts`, `sha256:3060157a285b87719bb8cd171c5f1dbfb8d8d7c205e5d884714154555fdcf099`, 9,938 bytes; required preparation service, consume, digest, state, parser, and type exports were present before editing.
- T02 export test: `packages/sdd-runtime/src/index.test.ts`, `sha256:74b478d7fea1ee26850366c64e3bce0c9ca3cf279b76d6615313381bef63ae1d`, 692 bytes.
- T01 authority source remained `sha256:d8c84c89939b9647f6290c59ff6cd7577833f98c5ccecdbba0cf6a3fd8a265b4` with `DECK_PREPARATION_AUTHORITY_BOUNDARY_V1` present.
- Proposal: `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`.
- Spec: `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`.
- Design: `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`.
- Tasks: `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`.
- T02 and all four official artifact digests were recomputed before editing and remained unchanged after T03/T04.

## Skill discovery and candidate readiness

- Skill Discovery Context V1: registry `.atl/skill-registry.md`; status `indeterminate`; reason `validate_command_returned_unexpected_interactive_menu`; active runner `opencode`; authority reminder `v1`.
- Bounded direct discovery used only generic project sources and active-runner-exposed skills. Loaded `deck-developer-apply-backend`, `using-agent-skills`, `api-and-interface-design`, `security-and-hardening`, `test-driven-development`, and `git-workflow-and-versioning`; no Git operation followed.
- Candidate readiness: `ready-for-independent-verify` for the completed T03/T04 batch. Both runner lanes pass. Prompt activation and full-change readiness remain outside this batch.

## Exact changed paths and final digests

- `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts`: `sha256:4f836c55e56a54d49292fb59479cf2493b8fab0e9374ce5bdbdd84f4d0b1b914`, 10,979 bytes.
- `packages/adapter-opencode/src/developer-team-execution-reachability.test.ts`: `sha256:245de540c1cb5e8d8c24b36963e0df2b9713ccfe24e1e3361bc3ed952b2cfdd1`, 53,378 bytes.
- `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts`: `sha256:7f8e6593247584d6a910d38e90eb619b35c85874e629eb7dedc067f364d711e8`, 11,068 bytes.
- `packages/adapter-pi/src/developer-team-execution-reachability.test.ts`: `sha256:e8708b4d79ba42c6cf9df3b28e0ac38ced1c3bb0a9f1b099a393bd41db100c35`, 46,492 bytes.
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md` (append only; this evidence).
- No generated derivative, installed runner, user-home path, registry YAML, Git state, `.gitignore`, `.atl/skill-registry.md`, baseline ledger, centralized state/events file, gated predecessor path, or `runner-capability-standardization` path was edited. No Git operation was performed.

## T03 OpenCode evidence

### RED — genuine pre-implementation reachability failure

- Command: `bun test --test-name-pattern T03 ./packages/adapter-opencode/src/developer-team-execution-reachability.test.ts`.
- Result: exit `1`; `0 pass`, `3 fail`. Valid host authority was not reserved/supplied, replay and runner mismatch were not rejected by a preparation branch, and session deletion did not clear provider state.

### GREEN and focused proof

- Initial T03 GREEN: the same named command returned exit `0`; `3 pass`, `0 fail`, 8 assertions.
- Final focused adapter command: `bun test ./packages/adapter-opencode/src/developer-team-execution-reachability.test.ts`.
- Final result: exit `0`; `40 pass`, `0 fail`, 122 assertions.
- Branch proof: caller `deckPreparation` and existing `deckExecution` controls are stripped before role detection; only exact `deck-init` native delegation can call the captured process-local provider; provider/service/resolver capabilities are immutable snapshots; service absence, envelope absence, malformed proof, replay, and runner mismatch fail closed before native delegation; successful validation/reservation adds only the bounded authority reference; unrelated agents make zero preparation-provider calls; `session.deleted` clears receipt and preparation state.

### Functional OpenCode exercise

- Command: `bun -e <actual imports from @deck/sdd-runtime public exports and the canonical OpenCode hook; valid, poison, replay, and mismatch invocations>`.
- Result: exit `0`; `{"valid":true,"poison":0,"replay":"modification-not-authorized:AUTHZ_REPLAYED","mismatch":"modification-not-authorized:AUTHZ_RUNNER_MISMATCH"}`.
- This exercised the actual canonical hook and T02 HMAC service. The valid branch reached the simulated native-delegation boundary only after reservation; injected installer/network/Git functions remained at zero calls.

## T04 Pi evidence

### RED — genuine pre-implementation reachability failure

- Command: `bun test --test-name-pattern T04 ./packages/adapter-pi/src/developer-team-execution-reachability.test.ts`.
- Result: exit `1`; `0 pass`, `3 fail`. Valid host authority was not reserved/supplied, replay and runner mismatch were not rejected by a preparation branch, and `session_shutdown` did not clear provider state.

### GREEN and focused proof

- Initial T04 GREEN: the same named command returned exit `0`; `3 pass`, `0 fail`, 9 assertions.
- Final focused adapter command: `bun test ./packages/adapter-pi/src/developer-team-execution-reachability.test.ts`.
- Final result: exit `0`; `37 pass`, `0 fail`, 117 assertions.
- Branch proof: Pi preserves runner isolation while matching OpenCode rejection semantics; it strips caller controls, binds the current `sessionManager.getSessionId()`, tool-call invocation, `deck-init`, and runner `pi`, reserves before returning control to native delegation, blocks every tested invalid path, makes zero preparation-provider calls for unrelated agents, and clears receipt/preparation state on the Pi-native `session_shutdown` lifecycle event.

### Functional Pi exercise

- Command: `bun -e <actual imports from @deck/sdd-runtime public exports and the canonical Pi extension; valid, poison, replay, and mismatch invocations>`.
- Result: exit `0`; `{"valid":true,"poison":0,"replay":"modification-not-authorized:AUTHZ_REPLAYED","mismatch":"modification-not-authorized:AUTHZ_RUNNER_MISMATCH"}`.
- This exercised actual Pi handler registration and the T02 HMAC service without reading an OpenCode-exclusive root or causing installation/global effects.

## Typecheck, diagnostics, and no-effect reachability

- Command: `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun --allowJs --checkJs false <the four authorized TypeScript targets>`.
- Result: exit `0`; no diagnostics.
- Serena diagnostics: all four authorized TypeScript targets returned no errors or warnings after the final fixes.
- Static source reachability scan: canonical hook imports are limited to `node:crypto`, `@deck/sdd-runtime`, and the runner-local developer-team bridge; forbidden preparation references for child process, fetch/network, package installation/manager, user-home, and destructive Git functions were `[]` in both hook sources.
- Existing focused suites use isolated temporary materialization fixtures only; no installed runner or user/global configuration was touched.

## Task, requirement, and EII coverage

- **T03 / OpenCode:** completed the captured host-provider, `deck-init`-only, strip-before-detect, validate-and-reserve-before-native-delegation, fail-closed rejection, one-call, cleanup, no-static-fallback, and poison-unreachability requirements.
- **T04 / Pi:** completed the Pi-native equivalent with current session binding, native lifecycle cleanup, stable rejection parity, and runner-exclusive isolation.
- **EII-PISB-001 (`byte-verbatim` semantics):** the canonical fragment source remained unchanged. Exact delegation remains separate from trusted process-local modifying authority; prompt/caller data cannot mint, widen, replay, or substitute authority; missing, malformed, invalid, replayed, restarted, revoked, or mismatched authority is delegated to the T02 fail-closed validator before native delegation; no routine approval or static modifying fallback was introduced; installer/global/Git/central-registry effects remain unreachable from the preparation branches.
- **Mapped scenarios:** REQ-002 automatic exact `deck-init` delegation boundary without a new phase; REQ-003 valid/missing/invalid/replayed/operation or identity mismatch authority separation; REQ-012 installation unreachable; REQ-027 bounded host reference/no phase artifact; REQ-028 canonical source editing with no generated derivative edits.
- **Compatibility:** existing Apply-agent execution behavior, `deckExecution` stripping, static-compatible shadow behavior, and runner-local bridge behavior remain covered by the full focused suites. No dependency or public CLI/TUI/project-init service was added.
- Code-economy note: four exact task targets plus the required append-only report were necessary because the authorized batch intentionally contains two isolated runner implementations and their independent TDD evidence. No cross-runner abstraction or dependency was introduced.

## Target/product validation classification

- **Classification:** target/runtime functional validation was genuinely required and completed conditionally for T03/T04.
- **Reason:** these security-sensitive hooks are the real host trust boundaries. Independent per-runner RED/GREEN cycles, complete focused suites, bounded strict typecheck, Serena diagnostics, source reachability scans, and actual canonical-hook valid/poison/replay/mismatch exercises provide proportionate Apply-local proof.
- Installed-runner/product, TARGETED Verify, AFFECTED_AREA Verify, independent Review, and mandatory BROAD validation remain intentionally unclaimed and deferred to fresh independent QA.

## Deviations, findings, manifests, intents, and blockers

- Serena symbolic retrieval/editing was used first for both canonical factories, host-provider types, helpers, and tests. Exact line-level `apply_patch` was used only where whole-symbol replacement was not proportionate; Serena remained available, so no unavailability fallback applies.
- During GREEN, the first full focused run exposed accidental omission of legacy `deckExecution` stripping in both replaced factories; the omission was restored and both full suites passed. A later invalid-proof test initially produced the correctly fail-closed `AUTHZ_MALFORMED` because the fixture appended illegal base64url bytes; the fixture was corrected to same-length proof tampering, producing `AUTHZ_PROOF_INVALID`, and all checks were rerun successfully.
- Implementation deviation from T03, T04, mapped requirements, Design §2, or EII-PISB-001 semantics: none.
- `FailureManifestV1`: not produced; no open finding remains, and no coordinator-issued `ApplyBatchContractV1` was supplied from which a valid manifest could be built.
- Ordered `RegistryIntentV1` values: `[]`. No valid batch-bound registry intent was invented; centralized registry YAML remains coordinator-owned.
- Blockers: none for T03/T04. T05–T13 remain outside this immutable batch; T11–T13 and predecessor-overlapping paths remain explicitly gated.

# Apply Progress — T05 Deterministic Existing `deck-init` Coordinator

## Immutable Apply-local result

- **Change:** `project-init-skill-registry-and-session-baseline`.
- **Authorized task:** T05 — Encode the deterministic existing `deck-init` coordinator, after completed T01/T02 and with T03/T04 hooks available for functional exercise.
- **Status/action:** `passed_with_deferred_affected_area_fixture`; the exact T05 targets are implemented and pass focused tests, bounded typecheck, diagnostics, and functional composition. Fresh independent Verify remains required. T06–T13 remain outside this batch; T11–T13 and overlapping paths remain gated.
- **Role/instance provenance:** `deck-developer-apply-general` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T00:51:08.556Z`.
- **Evidence class:** Apply-local and non-independent. This does not satisfy TARGETED Verify, AFFECTED_AREA Verify, independent Review, product acceptance, or mandatory BROAD.
- **Adaptive context:** advisory Supermemory context was loaded. Official OpenSpec artifacts, source, and tests remained authoritative.

## Dependency references and freshness

- Proposal: `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`.
- Spec: `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`.
- Design: `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`.
- Tasks: `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`.
- T01 authority source remained `sha256:d8c84c89939b9647f6290c59ff6cd7577833f98c5ccecdbba0cf6a3fd8a265b4`, 2,576 bytes.
- T02 preparation runtime remained `sha256:c3c2bb6f3b23000edde384ddbadab807822baf59e96748e313ffd3624ab0d61a`, 32,591 bytes.
- T03 OpenCode hook remained `sha256:4f836c55e56a54d49292fb59479cf2493b8fab0e9374ce5bdbdd84f4d0b1b914`, 10,979 bytes.
- T04 Pi hook remained `sha256:7f8e6593247584d6a910d38e90eb619b35c85874e629eb7dedc067f364d711e8`, 11,068 bytes.
- All four official artifact digests and T01–T04 dependency digests were recomputed before final reporting and matched prior Apply evidence.

## Skill discovery and candidate readiness

- Skill Discovery Context V1: registry `.atl/skill-registry.md`; status `indeterminate`; reason `validate_command_returned_unexpected_interactive_menu`; active runner `opencode`; authority reminder `v1`.
- Bounded direct discovery used generic project sources and active-runner-exposed skills only. Loaded `deck-developer-apply-general`, `using-agent-skills`, `test-driven-development`, and `git-workflow-and-versioning`; no Git operation followed.
- Candidate readiness: `ready-for-independent-targeted-verify` for T05 exact targets. One known generated-static-content byte fixture in gated `prompt-profile.test.ts` is deferred to the T11 canonical composition batch; it does not indicate a T05 semantic or type failure.
- The Skill Registry, `.gitignore`, generated outputs, installed runner, user-home state, registry YAML, baseline ledger, Git state, `runner-capability-standardization`, and gated targets were not modified.

## Exact changed targets and final pre-report digests

- `packages/core/src/skills/bootstrap/deck-init-content.ts`: `sha256:064cc0abaa40d4dbd9fa059b27b9fde9a9498e468bcddfe838911680ce35e953`, 10,430 bytes.
- `packages/core/src/skills/bootstrap/index.test.ts`: `sha256:30f5de2acbe70cabb6963719de814c5b51c97c8c6c6cf12776f132278eb5143f`, 9,454 bytes.
- `packages/core/src/teams/developer/bootstrap-compact-content.ts`: `sha256:97ac59a85be292e325e167db2ac9fbacc6a56e4ca560cbb3dfbba8c46239b858`, 7,202 bytes.
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md`: append only with this T05 evidence.
- No other path was edited by this T05 Apply instance. T01–T04 source was preserved. No generated derivative was hand-edited.

## Strict TDD evidence

### RED — genuine pre-source behavior failure

- The first test invocation found an extra closing token introduced by the test edit; it was corrected in the authorized test before any source update and is not counted as RED evidence.
- Genuine RED command: `bun test packages/core/src/skills/bootstrap/index.test.ts`.
- Genuine RED result: exit `1`; assertions failed because authority fragment occurrence was `0` instead of `1`, the first ordered component `Root and authority precondition` was absent, and legacy registry/coordinator semantics did not match the required lifecycle. Source updates began only after this behavioral RED.

### GREEN — exact T05 target proof

- Command: `bun test packages/core/src/skills/bootstrap/index.test.ts`.
- Final result: exit `0`; `11 pass`, `0 fail`, `150 expect() calls`.
- Coverage: delegate-only frontmatter; exact fragment SHA/count on legacy and both compact surfaces; seven-component ordering; no global return; one effect plus postcondition; all registry statuses/lifecycle selection; sole writer/CAS/prior-valid behavior; codebase-memory/Serena/analogous capability constraints; readiness aggregation; owned-ignore safety; bounded handoff/telemetry; no SDD phase; negative prohibited surfaces; and ready/changed/partial/blocked composition snapshots.

### Typecheck and diagnostics

- Command: `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun packages/core/src/skills/bootstrap/deck-init-content.ts packages/core/src/skills/bootstrap/index.test.ts packages/core/src/teams/developer/bootstrap-compact-content.ts`.
- Result: exit `0`; no diagnostics.
- Serena diagnostics: all three authorized TypeScript targets returned no errors or warnings after final edits.

### Affected-area observation and bounded fix

- Combined command: `bun test packages/core/src/skills/bootstrap/index.test.ts packages/core/src/teams/developer/content-registry.test.ts packages/core/src/teams/developer/prompt-profile.test.ts`.
- Initial result after GREEN: one compact-marker finding plus the expected generated-static-content byte fixture. The compact marker was fixed in the authorized compact source by naming `openspec/config.yaml` and retested.
- Retest result: `112 pass`, `1 fail`, `1429 expect() calls`. The sole remaining failure is `uses compact by default while preserving explicit legacy content`: expected `481194` bytes, received `483172`. Its constants live in gated `packages/core/src/teams/developer/prompt-profile.test.ts`, a T11 target outside this batch. No unauthorized fixture edit was made.

## Functional composition and host-hook exercise

- Corrected functional command: `bun -e <actual imports from @deck/sdd-runtime T02 exports, T05 legacy/compact canonical sources, and the T01 authority export>`; the first attempt incorrectly imported non-public `sha256Digest`, exited `1`, changed no source, and was corrected by using bounded fixture digests.
- Corrected result: exit `0` with `readyFastPath={status:not_needed, shouldDelegate:false}`; `requiredSilentPreparation={status:delegated, shouldDelegate:true, needs:[openspec,skill_registry], routinePause:false}`; unavailable Serena aggregated to `partial`, `continueToTriage:true`, `tui_capability_setup`, and `installCalls:0`; missing authority returned `AUTHZ_MISSING`, `blocked:true`, `effects:0`; authority counts were `[1,1,1]`; `noSddPhase:true`; `inventedService:false`.
- OpenCode host-hook command: `bun test --test-name-pattern T03 packages/adapter-opencode/src/developer-team-execution-reachability.test.ts`.
- Host-hook result: exit `0`; `5 pass`, `0 fail`, `12 expect() calls`, exercising the actual T03 preparation trust boundary available to the active runner.
- Stable component order snapshot: root/authority → OpenSpec → Skill Registry → codebase index → Serena project state → analogous configured capabilities → owned ignore contributions. Verified no-op rerun semantics are encoded and tested through all-unchanged aggregation and no global early return.

## Task and EII coverage

- **EII-PISB-001 (`byte-verbatim`):** canonical `DECK_PREPARATION_AUTHORITY_BOUNDARY_V1` is imported rather than copied and occurs exactly once in each T05 legacy/compact surface. Fragment hash remains `sha256:1ad0630420b0955f70bf1f601aa06ba48b9d7602f72d4a300f6da426df987766`.
- **EII-PISB-011 (`semantic-constrained`):** legacy `deck-init` now remains delegate-only and host-authorized, independently processes all seven components, reuses existing OpenSpec/index/registry/capability surfaces, preserves active-runner scope and prior bytes, defines truthful statuses/bounded handoff/telemetry/idempotency/postconditions, and applies the five-proof narrow ignore policy without a second writer.
- **EII-PISB-012 (`semantic-constrained`):** compact agent executes components directly under host authority, retains Git safety, has no early return, returns bounded internal status/result, and composes EII-PISB-001 once.
- **EII-PISB-013 (`semantic-constrained`):** compact skill preserves the deterministic seven-component algorithm, existing tool reuse, aggregation/no-pause semantics, active-runner-only discovery, safe bounded return, and exact authority composition.
- Mapped T05 scenarios covered: REQ-003–REQ-006, registry failure isolation in REQ-008, REQ-009–REQ-016, predecessor/generated protection in REQ-023/REQ-028, and bounded no-phase handoff in REQ-027. No T06–T13 implementation was added.

## Target/product validation classification

- **Classification:** target/runtime composition validation was genuinely required and completed conditionally for T05. Exact target tests, bounded typecheck, Serena diagnostics, actual T02/T05 composition, and the active-runner T03 host-hook exercise passed.
- Installed-runner/user-home product validation was prohibited and not performed. Generated materialization and the static profile-byte refresh belong to later canonical composition/acceptance work, including gated T11. TARGETED/AFFECTED_AREA Verify, independent Review, product acceptance, and mandatory BROAD remain unclaimed.

## Deviations, manifests, intents, and blockers

- Serena symbolic retrieval/editing was used first for the authorized test callback, legacy content constant, both compact constants, imports, and final diagnostics. Exact line-level `apply_patch` fallback was used only to remove one test-edit delimiter and add the two compact `openspec/config.yaml` markers; Serena remained available, so no unavailability fallback applies.
- Implementation deviation from T05 or EII-PISB-011 through EII-PISB-013: none.
- `FailureManifestV1`: not produced; no coordinator-issued `ApplyBatchContractV1` was supplied from which a valid manifest could be built. The deferred T11 byte fixture is recorded above and was not relabeled as target success.
- Ordered `RegistryIntentV1` values: `[]`. No valid batch-bound registry intent was invented; centralized registry YAML remains coordinator-owned.
- T05 exact-target blockers: none. Full affected-area acceptance is blocked on the authorized T11 canonical composition/profile fixture update and fresh independent validation. T06–T13 remain outside this batch; T11–T13 and overlapping paths remain explicitly gated.

# Apply Progress — T06 Baseline Evidence Contracts and Finding Evaluator

## Immutable Apply-local result

- **Change:** `project-init-skill-registry-and-session-baseline`.
- **Authorized task:** T06 — Add baseline evidence contracts and authoritative finding evaluator, after completed T01. Preparation T02–T05 remained unchanged.
- **Status/action:** `passed`; T06 exact targets are implemented and ready for fresh independent Verify. T07–T13 remain outside this batch; T11–T13 and all nine predecessor-overlapping paths remain gated.
- **Role/instance provenance:** `deck-developer-apply-backend` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T01:07:55.189Z`.
- **Evidence class:** Apply-local and non-independent. This does not satisfy independent TARGETED, AFFECTED_AREA, Review, or mandatory BROAD evidence.
- **Adaptive context:** advisory Supermemory context was loaded; official OpenSpec artifacts, source, and tests remained authoritative.

## Dependency references and preservation

- Proposal: `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`.
- Spec: `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`.
- Design: `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`.
- Tasks: `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`.
- T01 authority source remained `sha256:d8c84c89939b9647f6290c59ff6cd7577833f98c5ccecdbba0cf6a3fd8a265b4`.
- Representative T02–T05 sources remained byte-identical to prior Apply evidence: session preparation `sha256:c3c2bb6f3b23000edde384ddbadab807822baf59e96748e313ffd3624ab0d61a`; OpenCode hook `sha256:4f836c55e56a54d49292fb59479cf2493b8fab0e9374ce5bdbdd84f4d0b1b914`; Pi hook `sha256:7f8e6593247584d6a910d38e90eb619b35c85874e629eb7dedc067f364d711e8`; legacy deck-init content `sha256:064cc0abaa40d4dbd9fa059b27b9fde9a9498e468bcddfe838911680ce35e953`; bootstrap test `sha256:30f5de2acbe70cabb6963719de814c5b51c97c8c6c6cf12776f132278eb5143f`; compact deck-init content `sha256:97ac59a85be292e325e167db2ac9fbacc6a56e4ca560cbb3dfbba8c46239b858`.

## Skill discovery and candidate readiness

- Skill Discovery Context V1: registry `.atl/skill-registry.md`; status `indeterminate`; reason `validate_command_returned_unexpected_interactive_menu`; active runner `opencode`; authority reminder `v1`.
- Bounded direct discovery used generic project sources and active-runner-exposed skills only. Loaded `deck-developer-apply-backend`, `using-agent-skills`, `api-and-interface-design`, `security-and-hardening`, and `test-driven-development`.
- Candidate readiness: `ready-for-independent-targeted-verify` for T06 exact targets. No required capability was unavailable. Registry, baseline ledger, `.gitignore`, generated outputs, installed runners, user-home state, Git state, centralized registry YAML, gated paths, and `runner-capability-standardization` remained untouched.

## Exact changed targets and pre-report digests

- `packages/sdd-runtime/src/contracts/baseline-evidence.ts` (new): `sha256:849a339a70619fe3d8b6860b96f739a292b5e83abcba371e8fd9eacccadc5957`, 33,421 bytes.
- `packages/sdd-runtime/src/contracts/baseline-evidence.test.ts` (new): `sha256:6d3a9db96a37b2239a0be0526e9a27d180732df7749d729f019153eef55523f8`, 7,527 bytes.
- `packages/sdd-runtime/src/orchestrator/finding-disposition-service.ts` (new): `sha256:5ab7827b299dc222a3088dd617f97510a6c2add625e3813ae60c888a8d1cc2ac`, 17,064 bytes.
- `packages/sdd-runtime/src/orchestrator/finding-disposition-service.test.ts` (new): `sha256:cba4ab45e69cf1634e1739030349f87a9feb096dad9e6c0b06dd73ca173e619d`, 11,921 bytes.
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md`: append only with this T06 evidence.
- No other path was edited by this Apply instance. Quality override used: the four exact task files exceed the advisory line budget because strict boundary validation, immutable evidence shapes, protected/invalidation logic, and closed decision-table tests are non-negotiable.

## Strict TDD, checks, and functional evidence

### RED — genuine pre-implementation failure

- Command: `bun test ./packages/sdd-runtime/src/contracts/baseline-evidence.test.ts ./packages/sdd-runtime/src/orchestrator/finding-disposition-service.test.ts` from the repository root.
- Result: exit `1`; both imports failed with `Cannot find module './baseline-evidence'` and `Cannot find module './finding-disposition-service'`; `0 pass`, `2 fail`.
- A prior sandbox invocation omitted the repository working directory and matched no tests; it changed no source and is not claimed as RED. The candidate-bound missing-module run above is the genuine RED.

### GREEN and compatibility

- Exact-target command: the same two-file test command.
- Result: exit `0`; `12 pass`, `0 fail`, `30 expect() calls`.
- Compatibility command: the two T06 suites plus existing `failure-manifest.test.ts` and `finding-disposition.test.ts`.
- Result: exit `0`; `32 pass`, `0 fail`, `78 expect() calls`.
- Bounded typecheck: `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun <four exact T06 TypeScript targets>`; exit `0`, no diagnostics.
- Serena diagnostics: all four exact TypeScript targets returned no diagnostics.

### Actual evaluator exercise

- Command: focused actual-service execution using `bun test --test-name-pattern 'passed_with_warnings|insufficient deterministic|protected pre-existing|flaky five-run|platform cohorts|self-admission' ./packages/sdd-runtime/src/orchestrator/finding-disposition-service.test.ts`.
- Result: exit `0`; `6 pass`, `0 fail`, `13 expect() calls`.
- Covered outcomes: fully proven unrelated finding retained raw and returned quality `passed_with_warnings` with stage `passed`; insufficient deterministic evidence blocked; protected pre-existing security finding blocked; flaky exact-five/at-least-three threshold and fourteen-day expiry blocked invalid cases; linux/x64 evidence did not satisfy a darwin/arm64 candidate; same-candidate/same-producer ledger admission was rejected.

## Contract, requirement, and EII coverage

- Added additive `BaselineEvidenceEnvelopeV1`, `QualityDispositionEnvelopeV1`, immutable baseline/candidate subjects, observations, environment/cohort, causal isolation, non-regression, durable ledger authority, freshness bindings, normalized fingerprint builder, strict builders/parsers, and `evaluateFindingDispositionBaselineV1`.
- Deterministic findings require exact consecutive 2/2 baseline and candidate reproduction; a valid durable ledger can replace only the baseline half. Flaky findings require exactly five retained outcomes per subject, at least three matches on each, candidate count no greater than baseline, and expiry no later than fourteen days. Cohorts are isolated by OS, architecture, runtime name, and runtime major.
- Candidate severity, occurrence count, reachability, duration, and resource usage cannot worsen. Causal location/dependency/configuration/oracle overlap blocks. Security, authorization, Git safety, data loss, migration, public-interface, cross-package architecture, generated-output, registry-recovery, freshness, and required-artifact floors take precedence.
- Every evidence envelope and output is canonical, deeply immutable, deterministically ordered, and SHA-256 bound. Current policy/normalizer/command/test/oracle/dependency/configuration/lockfile/protected-policy/candidate/environment/producer/artifact bindings invalidate reuse on change. Missing, stale, partial, contradictory, malformed, or unknown evidence blocks.
- Existing `FailureManifestV1` raw findings are retained in the evaluation result. Existing `FindingDispositionEnvelopeV1` remains parseable and bound. No new `StageStatus` value was introduced; stage remains `passed|failed`, while the quality phase disposition may be `passed_with_warnings`.
- EII-PISB-002 runtime semantics are enforced: no bare fingerprint, age, prose, focused-green result, skipped check, or self-issued ledger claim authorizes warning progression. The evaluator has no baseline-ledger writer, filesystem, Git, network, installer, or generated-output effect path; static forbidden-effect references were empty.
- Mapped requirements covered: REQ-017 mandatory complete execution; REQ-018 protected/new/worsened/related/stale/conflicting blockers; REQ-019 identity/reproduction/pre-existence/unrelatedness/non-regression/durable record/environment equivalence; REQ-020 stage/phase status mapping; REQ-021 raw/durable warning evidence and no repair implication; REQ-022 self-admission refusal; REQ-025 independent stage identities and freshness.

## Target/product validation classification

- **Classification:** target/runtime functional validation was genuinely required and completed conditionally for T06.
- **Reason:** T06 is a security-sensitive pure runtime decision boundary. Strict RED/GREEN tests, compatibility suites, bounded typecheck, Serena diagnostics, no-effect reachability, deterministic digest assertions, and the six-scenario actual evaluator exercise provide proportionate Apply-local evidence.
- T07 control-plane integration, installed/materialized runner behavior, independent TARGETED/AFFECTED_AREA/Review, and mandatory BROAD remain outside this batch and unclaimed.

## Deviations, manifests, intents, and blockers

- All four implementation targets were new files, so no Serena symbol anchor existed for creation. Exact fallback report: `Serena edit tools unavailable. Using fallback: apply_patch.` Serena diagnostics were used after creation.
- During GREEN, focused tests exposed a missing protected-risk policy fixture binding and a candidate-subject fixture mismatch; bounded typecheck exposed narrow fixture and return-type diagnostics. Each was fixed inside the exact targets and all focused/compatibility/type checks were rerun successfully.
- Implementation deviation from T06, mapped requirements, Design baseline-disposition §§1–3, or EII-PISB-002 semantics: none.
- `FailureManifestV1`: not produced; no open finding remains, and no coordinator-issued `ApplyBatchContractV1` was supplied from which a valid manifest could be built.
- Ordered `RegistryIntentV1` values: `[]`. No valid batch-bound registry intent was invented; centralized registry YAML remains coordinator-owned.
- T06 blockers: none. T07–T13 remain outside this immutable batch; T11–T13, the nine overlapping paths, final independent QA, materialization, and full-change readiness remain explicitly gated/deferred.

# Apply Progress — T07 Quality Disposition Execution Control

## Immutable Apply-local result

- **Change:** `project-init-skill-registry-and-session-baseline`.
- **Authorized task:** T07 — Bind quality disposition into the execution control plane, after completed T06.
- **Status/action:** `passed`; the exact T07 targets are implemented and ready for fresh independent TARGETED verification. T08–T13 remain outside this batch; T11–T13 and all predecessor-overlapping paths remain gated.
- **Role/instance provenance:** `deck-developer-apply-backend` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T01:22:04.428Z`.
- **Evidence class:** Apply-local and non-independent. This result does not satisfy independent TARGETED, AFFECTED_AREA, Review, or mandatory BROAD evidence.
- **Adaptive context:** advisory Supermemory context was loaded; official OpenSpec artifacts, source, tests, and the completed T06 evaluator remained authoritative.

## Dependency references and preservation

- Proposal: `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`.
- Spec: `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`.
- Design: `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`.
- Tasks: `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`.
- T06 evaluator dependencies were verified before editing and remained byte-identical: `packages/sdd-runtime/src/contracts/baseline-evidence.ts` `sha256:849a339a70619fe3d8b6860b96f739a292b5e83abcba371e8fd9eacccadc5957`; `packages/sdd-runtime/src/orchestrator/finding-disposition-service.ts` `sha256:5ab7827b299dc222a3088dd617f97510a6c2add625e3813ae60c888a8d1cc2ac`.
- T06 Apply evidence records status `passed`, no blockers, and readiness for T07. T01–T06 source/contracts were preserved; no predecessor, generated, registry, baseline-ledger, user-home, installed-runner, Git, `.gitignore`, `.atl/skill-registry.md`, or `runner-capability-standardization` path was written.

## Skill discovery and exact targets

- Skill Discovery Context V1: registry `.atl/skill-registry.md`; status `indeterminate`; reason `validate_command_returned_unexpected_interactive_menu`; active runner `opencode`; authority reminder `v1`.
- Bounded direct discovery used generic project sources and active-runner-exposed skills only. Loaded `deck-developer-apply-backend`, `using-agent-skills`, `api-and-interface-design`, `security-and-hardening`, `test-driven-development`, and `git-workflow-and-versioning`.
- `packages/sdd-runtime/src/execution/execution-control-plane.ts`: `sha256:91d1e656efedc63cc67452486a1781d6b08212f34b6aeb8f2457ad68f310f9c3`, 54,404 bytes.
- `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts`: `sha256:744b2817f5f254c49c3daee2b27349c58498120a215361fdaee204c8b608aedb`, 25,236 bytes.
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md`: append only; pre-T07-report digest `sha256:9413cb67de005f56969cf49ce113ca5a9c2d574afe24786978479d517c853663`.
- No other path was edited by this Apply instance.

## Strict TDD and checks

### RED — genuine pre-source failure

- Before any execution-control-plane source edit, the focused scheduler command was `bun test ./packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts`.
- Two preliminary test-only runs exposed invalid new fixtures (`causal active finding`, then incomplete protected-risk artifact binding). They changed no source, were corrected in the test target, and are not claimed as RED.
- The corrected candidate-bound RED exited `1`: `13 pass`, `3 fail`, `42 expect() calls`. The warning BROAD progression and fresh Review cases expected `accepted`, while the protected blocker case expected `role-result-failed`; the unmodified control plane rejected the additive `qualityDisposition` result shape, proving the missing T07 behavior.

### GREEN, compatibility, typecheck, and diagnostics

- Minimal GREEN added optional sidecar parsing/binding, warning phase projection, blocker refusal, and intent consistency without adding a `StageStatus` or dependency.
- Final focused scheduler run: exit `0`; `16 pass`, `0 fail`, `53 expect() calls`.
- Compatibility command covered scheduler, execution-control-plane, staged-verification, both authoritative T06 suites, failure-manifest, and low-level finding-disposition suites: exit `0`; `64 pass`, `0 fail`, `172 expect() calls` across 7 files.
- Bounded typecheck: `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun packages/sdd-runtime/src/execution/execution-control-plane.ts packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts`; exit `0`, no diagnostics.
- Final Serena diagnostics for both exact TypeScript targets were empty.

## Functional control-plane exercise and status/routing matrix

- The focused scheduler suite executes the actual T06 evaluator and then passes its immutable quality envelope through scheduler/control-plane consumption.
- A fully proven unrelated warning with retained raw `failed` evidence schedules and completes mandatory BROAD, keeps stage status `passed`, emits phase/intent `passed_with_warnings`, preserves the dossier manifest, and returns `accepted`; it does not enter blocker/repair routing or create a pause.
- A completed quality-warning candidate schedules fresh independent Review under `review-2`, binds Review producer role/identity and current verification digest, and remains `passed_with_warnings`.
- Missing sidecars, raw nonzero evidence without a sidecar, stale verification binding, result/status conflict, cross-batch manifest binding, producer identity mismatch, and a `passed` intent that conflicts with warning disposition all fail closed as `invalid-evidence`.
- A protected credential/security finding is classified `failed` by the T06 evaluator regardless of pre-existing evidence and is refused by the control plane as `role-result-failed`; it cannot use warning routing.
- Existing all-green results remain sidecar-free and compatible. Existing stage vocabulary remains `pending | running | passed | failed | skipped | deferred`; no new `StageStatus` exists.
- Existing scheduler lane floors, required TARGETED/AFFECTED_AREA/BROAD ordering, fresh Review scheduling, dependency bindings, terminal governance, shadow intent stripping, and registry coordinator ownership remain unchanged.

## Task, requirement, and EII coverage

- **T07 / Design §4:** `ExecutionRoleResultEnvelopeV1` accepts an additive optional `qualityDisposition`; consumption binds it to the role/provenance identity and timestamp, batch/digest, current dossier verification digest, current `FailureManifestV1`, and the authoritative evaluator decision digest.
- **REQ-017:** mandatory scheduler ordering and mandatory BROAD remain active under warning disposition; no check is skipped, shortened, filtered, deferred, or relabelled.
- **REQ-018 / REQ-019:** only the parsed T06 evaluator envelope can authorize warning progression; protected, missing, stale, conflicting, cross-batch, or insufficient bindings fail closed.
- **REQ-020:** warning quality maps to stage `passed` plus phase/intent `passed_with_warnings`; a blocking quality disposition remains failed. No `StageStatus` was added.
- **REQ-021:** raw nonzero evidence and the bound manifest remain durable; warning acceptance does not trigger repair or a routine pause; Review requires a distinct fresh identity and its own producer binding.
- **REQ-022:** the control plane has no ledger writer or self-admission path and accepts only the already-authoritative T06 decision.
- **REQ-025:** sidecars bind the current candidate batch, current dossier verification digest, exact role identity, and exact production timestamp; prior-run/cross-batch/stale evidence is rejected.
- **EII-PISB-002 (`byte-verbatim` runtime semantics):** the canonical fragment was not copied or changed. The implementation preserves mandatory execution, independent identity, freshness, protected-risk precedence, raw findings, centralized registry ownership, and blocker refusal; no prose, fingerprint, age, pressure, focused green, inherited Review judgment, or self-issued ledger claim can authorize warnings.
- Implementation deviation from T07, mapped requirements, Design §4, or EII-PISB-002 semantics: none.

## Target/product validation classification, fallbacks, manifests, intents, and blockers

- **Target-validation classification:** target/runtime functional validation was genuinely required and completed conditionally for the exact T07 scheduler/control-plane targets. The evaluator-to-scheduler warning progression and blocker refusal were exercised with stale, conflicting, cross-batch, protected, and identity-mismatched evidence. Installed/materialized runners and final product validation remain out of scope.
- **Readiness:** `ready-for-independent-targeted-verify` for T07 exact targets. Fresh independent TARGETED → AFFECTED_AREA → Review → mandatory BROAD remains required and unclaimed.
- Serena symbolic tools were used first for source/test imports, interface/type replacements, and helper/test insertion. Exact localized fallback report: `Serena symbol replacement unsuitable for localized line edits. Using fallback: apply_patch.`
- `FailureManifestV1`: not produced; no open Apply finding remains, and no coordinator-issued `ApplyBatchContractV1` was supplied from which a valid manifest could be built.
- Ordered `RegistryIntentV1` values: `[]`. No batch-bound registry intent was invented; centralized registry YAML remains coordinator-owned.
- T07 blockers: none. T08–T13, T11–T13 predecessor-overlap gates, installed/materialized parity, final independent QA, and full-change readiness remain explicitly deferred.

# Apply Progress — T08–T10 Evidence-Bound Verify, Review, and Archive Content

## Immutable Apply-local result

- **Change:** `project-init-skill-registry-and-session-baseline`.
- **Authorized tasks:** T08, T09, and T10 only, after T07 Apply PASS and corrected exact delegation.
- **Status/action:** `passed`; all twelve canonical legacy/compact Verify, Review, and Archive surfaces implement the routed quality-disposition semantics and are ready for fresh independent verification. T11–T13 and every predecessor-overlap path remain gated and unchanged.
- **Role/instance provenance:** `deck-developer-apply-general` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T01:36:23.879Z`.
- **Evidence class:** Apply-local and non-independent. This evidence does not satisfy final independent verification, Review, or mandatory BROAD stages.
- **Adaptive context:** advisory Supermemory context was loaded; official OpenSpec artifacts, T01/T06/T07 dependencies, source, and tests remained authoritative.
- **Code-economy note:** Quality override used for six canonical source/test targets because four-surface EII parity, exact byte-fragment composition, role-specific prohibitions, and contract tests are mandatory; no dependency or abstraction was added.

## Dependency references and preservation

- Proposal: `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`.
- Spec: `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`.
- Design: `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`.
- Tasks: `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`.
- T01 authority source remained `sha256:d8c84c89939b9647f6290c59ff6cd7577833f98c5ccecdbba0cf6a3fd8a265b4`; exact `FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1` value is `sha256:8d0c47f538f821d5f803c93b423cdd79a18cdbee9342e6655e99190b1cf0375e`, 1,247 bytes.
- T06 dependencies remained byte-identical: `baseline-evidence.ts` `sha256:849a339a70619fe3d8b6860b96f739a292b5e83abcba371e8fd9eacccadc5957`; `finding-disposition-service.ts` `sha256:5ab7827b299dc222a3088dd617f97510a6c2add625e3813ae60c888a8d1cc2ac`.
- T07 control-plane dependency remained byte-identical: `execution-control-plane.ts` `sha256:91d1e656efedc63cc67452486a1781d6b08212f34b6aeb8f2457ad68f310f9c3`.
- Pre-append `apply-progress.md`: `sha256:7e26be9544eb31bef53fdee413fe33fd97d3b00b23999dc60860bb5b2e27b317`.

## Exact changed targets

- `packages/core/src/teams/developer/verify-content.ts`: `sha256:0a186e2a947aa74e63be06f27f861e844633df355aa54acde7c36456d12cecb9`, 21,466 bytes.
- `packages/core/src/teams/developer/verify-content.test.ts`: `sha256:117d8d94446663be93e9d96f8d8433695a13e35bcd6cbb3f034beb2548087ed4`, 9,284 bytes.
- `packages/core/src/teams/developer/review-content.ts`: `sha256:8fd5ad6e6dbf20fd872972159969c09b93a697a2c80bf1deb8f7c671d84d250b`, 22,474 bytes.
- `packages/core/src/teams/developer/review-content.test.ts`: `sha256:9c54b03f13a66e083685bc33c2267dfaa82be251813bf083147adbf696913ebc`, 13,783 bytes.
- `packages/core/src/teams/developer/archive-content.ts`: `sha256:a4c268a9061821bc4db4999ee8b6cd475cd15297852893adf2b13a77a39d6d23`, 16,603 bytes.
- `packages/core/src/teams/developer/archive-content.test.ts`: `sha256:b036fa19e4ff255a94fdaa07824c17d5c630caec6cc5c9a5b6f6056208a85298`, 7,423 bytes.
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md`: append only; final digest recorded in the immutable specialist return.
- No other path was edited. No generated output, registry YAML, baseline ledger, user-home, installed-runner, Git, `.gitignore`, `.atl/skill-registry.md`, predecessor-overlap, T11–T13, or `runner-capability-standardization` path was written.

## Strict TDD and checks

### RED — genuine pre-source failures

- After adding exact T08–T10 contract tests and before any source edit, the focused three-file test command exited `1`, proving that the twelve surfaces did not compose EII-PISB-002 or preserve the required warning contracts.
- After initial GREEN exposed contradictory legacy repair/intent prose, new negative tests were added first. The two-file semantic RED exited `1`: `86 pass`, `2 fail`, `198 expect() calls`; the stale phrases still routed `PASS WITH WARNINGS` to Apply fixes and emitted legacy Review intent statuses.

### GREEN, typecheck, diagnostics, and interface exercise

- Minimal source updates composed the canonical fragment once per surface and added role-specific clauses without evaluator duplication or a dependency.
- Final focused command: `bun test ./packages/core/src/teams/developer/verify-content.test.ts ./packages/core/src/teams/developer/review-content.test.ts ./packages/core/src/teams/developer/archive-content.test.ts`; exit `0`, `116 pass`, `0 fail`, `282 expect() calls` across 3 files.
- Bounded Core typecheck over all six exact TypeScript targets used `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun ...`; exit `0`, no output.
- Final Serena diagnostics for all six exact TypeScript targets were empty.
- Actual prompt/install interface exercise ran OpenCode prompt generation, OpenCode Developer Team install, and Pi Developer Team install tests; exit `0`, `200 pass`, `0 fail`, `1561 expect() calls` across 3 files.
- Direct role-content composition imported all twelve canonical exports. Verify, Review, and Archive each exposed four surfaces; exact authority counts were `1,1,1,1` per role and every role-specific runtime contract assertion passed.

## Task, requirement, and EII coverage

- **T08 / EII-PISB-014–017:** all Verify surfaces execute scheduled checks, retain raw nonzero evidence, build `FailureManifestV1`, consume one evaluator-bound `qualityDisposition`, distinguish warnings/blockers, fail closed on invalid evidence, and return immutable bindings. The legacy skill states deterministic `2/2`, flaky exactly-five/at-least-three, fourteen-day, per-cohort, environment-equivalence, causality, no-worsening, protected-risk, durable-ledger, and self-admission prohibitions. Mandatory completion maps stage `passed` plus phase/intent `passed_with_warnings`; blockers map `failed`; validated warnings cause no active-session repair or routine pause.
- **T09 / EII-PISB-018–021:** all Review surfaces require a fresh identity and independent causal-isolation, protected-risk, metric-non-regression, Verify/evaluator binding, and warning-durability judgment. Matching fingerprints and Verify verdicts never compel approval. Four-way scope classification remains `related regression | unrelated baseline defect | required Spec/Design replan | optional new scope`; RegistryIntent status is `passed | passed_with_warnings | failed`; stale or contradictory evidence blocks.
- **T10 / EII-PISB-022–025:** all Archive surfaces require current Verify, fresh independent Review, completed mandatory BROAD, and evaluator-bound quality evidence before move/intent. Only `passed` or `passed_with_warnings` with no blocker may Archive; canonical intent remains `archived`. Warning/evidence/baseline/ledger digests, failed attempts, rollback, residual risk, follow-ups, identity, provenance, and append-only history are preserved; ledger write/repair, warning deletion, global-green claims, stale evidence, blockers, and cleanup failure are prohibited.
- **EII-PISB-002 (`byte-verbatim`):** exact value `sha256:8d0c47f538f821d5f803c93b423cdd79a18cdbee9342e6655e99190b1cf0375e` appears exactly once in each of the twelve applicable legacy/compact surfaces. No prose-only baseline, bare fingerprint, age, pressure, focused-green evidence, inherited Review verdict, skipped mandatory check, self-issued ledger, or blocker downgrade can authorize progression.
- **REQ-017–REQ-022 / REQ-025:** mandatory execution, protected precedence, complete warning proof, stage/phase semantics, durable lifecycle evidence, separate ledger authority, and fresh candidate/identity bindings are explicitly preserved. **REQ-023:** Archive preserves predecessor and failed-attempt history without reinterpretation or erasure.
- Implementation deviation from T08–T10, mapped requirements, Design §4, or EII-PISB-002/EII-PISB-014–025: none.

## Readiness, validation classification, fallbacks, manifests, intents, and blockers

- **Target/product-validation classification:** conditional target validation was genuinely required and completed for the twelve canonical role-content surfaces and their OpenCode/Pi prompt-generation/install reachability. Installed/materialized files and final product validation remain out of scope.
- **Readiness:** `ready-for-independent-targeted-verify` for T08–T10 exact targets. Fresh independent final-stage verification, Review, and mandatory BROAD remain required and unclaimed.
- Skill Discovery Context V1 remained `indeterminate` with reason `validate_command_returned_unexpected_interactive_menu`; bounded direct discovery used only generic project sources and active runner `opencode` exposure.
- Serena symbolic retrieval and diagnostics were used first. Localized import/template edits were not suitable for whole-symbol replacement. Exact required fallback report: `Serena edit tools unavailable; fallback used: apply_patch`.
- `FailureManifestV1`: not produced; no open Apply finding remains, and no coordinator-issued candidate contract was supplied from which to construct a valid manifest.
- Ordered `RegistryIntentV1` values: `[]`. Centralized registry ownership remains unchanged and no intent was invented.
- T08–T10 blockers: none. T11–T13, all predecessor-overlap paths, materialized/generated parity, final independent QA, and full-change readiness remain explicitly gated/deferred.

---

# Apply Candidate Validation — Completed Partial Batch T01–T10

- **Status/action:** `passed`; Apply-local candidate validation completed without a genuine T01–T10 target defect. The partial candidate is ready for fresh independent TARGETED verification; this record is not TARGETED, AFFECTED_AREA, Review, or BROAD evidence.
- **Role/instance provenance:** `deck-developer-apply-general` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T01:46:13Z`.
- **Subject digest:** `sha256:67088254bd107404bf13e3845c9ab967e4eb3a6ef28c26a3cc0488494e4f83af` over canonical JSON for the path-sorted 25-file T01–T10 subject manifest `{path,sha256,bytes}`.
- **Dependency digest:** `sha256:6e6694385e840757922aeec0548f96d1af98a90abda5373e842448a0a16d321a` over the equivalent path-sorted Proposal/Spec/Design/Tasks manifest. Individual official digests remained Proposal `a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`, Spec `9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`, Design `4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`, and Tasks `52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`. All 25 current target digests matched their completion records; mismatches `[]`. Pre-append report digest was `sha256:60f903743a6086f85494591f7b6d00e305679e3af99d597f9a4aea6a6e862b26` (70,349 bytes).
- **Ordered local proof:** authority `2/2`; session preparation/public exports `10/10`; OpenCode/Pi hooks `77/77`; deck-init readiness `11/11`; baseline/evaluator compatibility `32/32`; control plane `16/16`; Verify/Review/Archive canonical content `116/116`. The bounded strict TypeScript check covered exactly 25 canonical files and exited `0` with zero diagnostics; Serena returned empty diagnostics for the first five queried source targets, while the remaining eight source queries timed out and were not repeated because the complete bounded compiler check had already passed.
- **Functional evidence:** OpenCode prompt generation, OpenCode install, and Pi install interfaces passed `200/200`. Runtime and hook suites exercised valid authority plus fail-closed missing/malformed/replay, runner/identity/operation/target mismatch, cleanup, and reservation-before-delegation behavior. Evaluator/control-plane suites confirmed stale/conflicting/cross-batch/identity mismatch rejection, protected-risk blocking, mandatory BROAD continuation under a valid warning, retained raw failure evidence, stage `passed` plus phase/intent `passed_with_warnings`, no warning repair/pause, and ledger self-admission refusal. Direct role-content composition found EII-PISB-002 exactly once on each surface: Verify `[1,1,1,1]`, Review `[1,1,1,1]`, Archive `[1,1,1,1]`. Prompt/install tests and target reconciliation confirmed canonical-source generation discipline; no generated or materialized output was edited.
- **Known gated limitation:** the repository contains `packages/core/src/teams/developer/prompt-profile.test.ts` (the delegated description called it `developer-team-profiles.test.ts`). Its T11-gated static legacy-byte fixture remains intentionally incomplete: focused run exit `1`, `9 pass`, `1 fail`, expected `481194`, received `498969`, in `uses compact by default while preserving explicit legacy content`. This is the exact partial-candidate integration impact; it is not authority to edit, conceal, or classify the T01–T10 targets as defective.
- **Readiness and target validation:** `ready-for-independent-targeted-verify` for the completed T01–T10 partial batch only. T11–T13, predecessor-overlap integration, materialized parity, independent Review, and BROAD remain gated/unclaimed. No genuine manual target/product validation is required: there is no end-user UI, and automation exercised every specified exported runtime, runner-hook, prompt-generation/install, and role-composition interface available within this partial scope.
- **FailureManifestV1:** none; no genuine candidate defect was found.
- **Ordered RegistryIntentV1:** `[]`.
- **Blockers:** none within T01–T10; full-change progression remains blocked by the authorized T11–T13 gates and the known T11-owned fixture reconciliation.

---

# Coordinated Apply Repair — Boundary B T02 Package-Root Export Oracles

## Immutable Apply-local result

- **Status/action:** `passed`; coordinated repair boundary B updated only the two authorized literal exact-surface oracles for the seven already-authoritative T02 package-root exports. This is non-independent Apply-local evidence and is ready for combined candidate validation; it is not TARGETED, AFFECTED_AREA, Review, or BROAD evidence.
- **Role/instance provenance:** `deck-developer-apply-backend` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T04:21:30.456Z`.
- **Batch binding:** batch ID `batch:v1:fae7fb3cf1c1746e974dd178567c3e08`; batch digest `sha256:fae7fb3cf1c1746e974dd178567c3e081c19e35aba46f8da8d77409ca2bc4b60`; decision digest `sha256:2b3b08024f49a64c9ae0d0891633b1601df68422d28381ed6840382cd688fb53`; failed BROAD dependency `finding:v1:62f456be182bc35d848673777126cb15`.
- **Adaptive context:** advisory Supermemory context was loaded. Official successor Proposal/Spec/Design/Tasks, T02 source/tests, current repository exports, and the explicit coordinated batch remained authoritative.

## Official anchors, subject, and dependencies

- Proposal `sha256:a22066d9a6c32c087eef2b152327797dea5c9c2a899d1173679d87f34f133861`; Spec `sha256:9513dacae9deff5a0b94356bedc238eff4838a256d78a39779446cfaf9f4bbec`; Design `sha256:4396901c8a920b6331436ea7a3d764df07918a4999b067fee9c2793616ee77e9`; Tasks `sha256:52e187b392b429503e5774a4400aa956a2606a0c958c95e5dc6ffe46df03dd48`.
- T02 anchors remained: `packages/sdd-runtime/src/index.ts` `sha256:3060157a285b87719bb8cd171c5f1dbfb8d8d7c205e5d884714154555fdcf099`; `index.test.ts` `sha256:74b478d7fea1ee26850366c64e3bce0c9ca3cf279b76d6615313381bef63ae1d`; `execution/session-preparation.ts` `sha256:c3c2bb6f3b23000edde384ddbadab807822baf59e96748e313ffd3624ab0d61a`; `execution/session-preparation.test.ts` `sha256:94eb32241befe314c3b2829e962d5618900a65907b455b7d98ce6c6e6705224a`.
- **Repair subject digest:** `sha256:ca027e49c59152dc18d9bdfa8e40c0c88226fc1bd2350072d4c9730a397bfed2` over canonical JSON for the path-sorted two-file final manifest `{path,sha256,bytes}`.
- **Dependency digest:** `sha256:1121053951a4c17edd0dbfedcaddf7056644f52d7f4715cce4f7fd0f9900618f` over canonical JSON for the path-sorted eight-file manifest containing Proposal/Spec/Design/Tasks and the four T02 anchors above.
- Pre-append progress digest was `sha256:50fc3f48035a71dacaa3a46db715d3544f881a698ecd1f1f402804a4d2ed71a3` (74,556 bytes).

## Exact changed paths and final pre-report digests

- `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts`: `sha256:69f6147f7a61f5065df4aff28134158fe79f77e0ccf2b5f4021ebf8194d9a1e4`, 10,734 bytes.
- `packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts`: `sha256:0c7b9985f3cfa4b7c11ee114d35ac1a276e4bcbf5746e577217c44e99e9f6dc7`, 58,676 bytes.
- `openspec/changes/project-init-skill-registry-and-session-baseline/apply-progress.md`: append only with this repair evidence.
- Both literal base lists now contain 102 codepoint-sorted names; with `parseExecutionDossierHistoryV1` and the eight registry exports, each exact oracle permits exactly 111 package-root keys. Each of the seven T02 names occurs exactly once and in canonical sorted order. Exact equality, extra-export rejection, canonical-helper exclusions, and all surrounding strict assertions remain intact.

## Strict TDD and verification evidence

### RED — reproduced predecessor failure before edits

- Command: `bun test packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts`.
- Result: exit `1`; `77 pass`, `2 fail`, `447 expect() calls`, 79 tests across two files. The only failures were B-B7 and C-EXPORT-01 exact sorted equality, each reporting received `+7` for the seven authoritative T02 exports.

### GREEN — minimal test-only repair

- Same two-file command: exit `0`; `79 pass`, `0 fail`, `447 expect() calls`.
- T02 compatibility command `bun test packages/sdd-runtime/src/index.test.ts packages/sdd-runtime/src/execution/session-preparation.test.ts`: exit `0`; `10 pass`, `0 fail`, `64 expect() calls`.
- Relevant strict TypeScript command used `bun x tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types bun` over the two repaired oracles plus the four T02 anchors; exit `0`, no compiler diagnostics.
- Serena diagnostics were empty for five of the six checked files. `batch-c-authoritative-matrix.test.ts` retained two pre-existing TypeScript deprecation hints for `runProductionExecutionDecisionPipelineV1`; no error or warning was introduced and the strict compiler check passed.

### Actual package-root functional probe

- Corrected command executed from `packages/sdd-runtime` and self-imported `@deck/sdd-runtime`; exit `0` with `rootExportCount:111`, `runtimeFunctionCount:99`, `sevenExported:true`, and `sevenCallable:true`.
- All seven exports were invoked through the package root: request parsing returned `session-preparation-request-v1`; once-per-session state returned `not_needed`; delegation digest returned `sha256:7ecb691d619938a77d4fcb60e3a07821827b9c288c1627400ea6b19ddc47545c`; one-use authorization was accepted; handoff aggregation/parsing returned `completed`.
- The first probe from repository root could not resolve the private workspace package name. A second exploratory package-root self-reference check succeeded. The first full package-root probe then used a non-canonical plain-string session hash and correctly failed closed with `invalid-evidence: authorization.delegationDigest`; correcting the probe to the canonical JSON-bound digest produced the successful evidence above. No repository file changed during these command corrections.

## Compatibility, preservation, and validation classification

- **Interface compatibility judgment:** compatible and additive. The seven T02 APIs remain package-root exports with unchanged names, values, call behavior, and source bytes. No export was removed, hidden, renamed, deep-imported, redesigned, or newly admitted beyond the already-authoritative seven.
- API/source preservation was byte-proven against pre-edit values: `index.ts`, `index.test.ts`, `session-preparation.ts`, and `session-preparation.test.ts` retained the four hashes listed above. No predecessor source, generated asset, registry YAML, T11–T13 target, unrelated WIP, or `runner-capability-standardization` path was written.
- **Target validation:** automated package-root self-import and functional invocation were genuinely required and completed. No manual target/product validation was required or performed; there is no UI or manual product surface in this test-only repair.
- Earlier T02–T04 Apply evidence remains historical, but any T02–T04 readiness, combined-candidate identity, or downstream stage evidence computed against the pre-repair oracle bytes is invalidated and must not be reused. The repaired subject is ready for fresh combined candidate validation with the other coordinated repair boundaries.

## Skill discovery, manifests, intents, and blockers

- Skill Discovery Context V1 remained registry `.atl/skill-registry.md`, status `indeterminate`, reason `validate_command_returned_unexpected_interactive_menu`, active runner `opencode`, authority reminder `v1`. Bounded direct discovery used only generic project sources and runner-exposed `deck-developer-apply-backend`, `using-agent-skills`, `api-and-interface-design`, `security-and-hardening`, and `test-driven-development`; the registry was not read as authority or modified.
- Serena symbolic retrieval and whole-callback replacement were used for both exact test oracles; no editing fallback was required.
- `FailureManifestV1`: not produced. The predecessor BROAD finding remains the bound validation dependency, but this Apply-local repair has no open implementation finding and cannot independently close or reclassify it.
- Ordered `RegistryIntentV1` values: `[]`; the coordinated batch is incomplete and centralized registry ownership is unchanged.
- **Blockers:** none for boundary B implementation. Completion remains blocked on the other coordinated repair boundaries and fresh combined candidate validation, followed by separately authorized independent QA/Review/BROAD. No independent QA, BROAD, Git operation, registry write, or manual validation was performed.

# Coordinated Apply Repair — Boundaries A and C Release Ordering and Canonical Generated Assets

- **Status/action:** `passed`; Boundaries A and C are implemented under the explicitly authorized coordinated batch and join the preserved Boundary B repair. This is non-independent Apply-local evidence, ready for fresh combined candidate validation only.
- **Role/instance provenance:** `deck-developer-apply-general` / `openai/gpt-5.6-sol` / active runner `opencode` / produced `2026-07-29T04:32:03.270Z`. Skill discovery was `indeterminate` for `.atl/skill-registry.md`, reason `validate_command_returned_unexpected_interactive_menu`; bounded direct discovery was used without modifying the registry or `.gitignore`. Advisory Supermemory was loaded; official context remained authoritative.
- **Bindings:** batch `batch:v1:fae7fb3cf1c1746e974dd178567c3e08` / `sha256:fae7fb3cf1c1746e974dd178567c3e081c19e35aba46f8da8d77409ca2bc4b60`; decision `sha256:2b3b08024f49a64c9ae0d0891633b1601df68422d28381ed6840382cd688fb53`; failed BROAD `finding:v1:62f456be182bc35d848673777126cb15`; Boundary B subject `sha256:ca027e49c59152dc18d9bdfa8e40c0c88226fc1bd2350072d4c9730a397bfed2`; Boundary B dependency `sha256:1121053951a4c17edd0dbfedcaddf7056644f52d7f4715cce4f7fd0f9900618f`.
- **Pre-generation/freeze:** HEAD `aee3038df0a784b07ba9dd44aca026dca78bc857`; Bun `1.3.12`; root version `0.2.4`; `linux-x64`; stable; initial record `2026-07-29T04:25:09.909Z`; status digest `sha256:beff2ed301acbcb664ab79f0a9901ef06fc652a6eaa39792889055e96c2d6ce8`. Sources were OpenCode `sha256:4f836c55e56a54d49292fb59479cf2493b8fab0e9374ce5bdbdd84f4d0b1b914` and Pi `sha256:7f8e6593247584d6a910d38e90eb619b35c85874e629eb7dedc067f364d711e8`; generators were build info `sha256:4acb5a9e9b6fe3e4105d250f0ee816d721e2ef82673b2b427501c817342329b4` and runners `sha256:ca5bb82857a2d44a09a4e2045791f7656612fd87471a060cd4a7ee1f4760b790`; old targets were build info `sha256:3f5f42ec462e3971c90310f519977bd0c8e9d506f8e7022bea99712a697811fa`, OpenCode `sha256:b8f7601bded7271568f70a498858a813161b1b8ae8b645afef12c6682dd2b47a`, and Pi `sha256:5af2085a3196ff58572035ee2e8d2113ab2c034189d83f9d227cc73b1eb8123a`. HEAD was frozen after GREEN at `2026-07-29T04:26:42.954Z`.
- **RED/GREEN:** test-first RED was `20 pass`, `3 fail`, specifically proving stale help/checksum ordering plus the stale implicit descriptor baseline. Minimal `main()` reordering and explicit branch tests produced pre-generation GREEN `23 pass`, `0 fail`; refactor remained green. Serena replaced `main()` symbolically; nested Vitest callbacks required the exact-file patch fallback because no editable nested symbol was exposed.
- **Canonical generation:** build info ran exactly once via `bun run scripts/generate-build-info.ts --version 0.2.4 --commit aee3038df0a784b07ba9dd44aca026dca78bc857 --target linux-x64 --channel stable`, recorded `2026-07-29T04:27:06.525Z`, date `2026-07-29`, final `sha256:dd18c1ee4ecd5081c7c5820952e0a28187e0e9e2fbc03ed691ee6f62c95c6946`; it was not rerun. `bun run scripts/generate-runner-execution-assets.ts` ran twice and both runs yielded OpenCode `sha256:d9d45fd649db9eb0e6419a07ac87e60870f01fa92a0ab9d2d0fefc1052a50e42` and Pi `sha256:f3053d804c32d005f4d819cc8f1cd062470275da12870b21e1d070cb53c5efc2`, proving byte identity. Direct generated-output edit count: zero.
- **Generated discipline/functional evidence:** each `source-sha256` marker equals its canonical TypeScript hash; neither bundle has unresolved `@deck/`, home/checkout paths, or `process.cwd()`. Temporary OpenCode/Pi materializations equaled generated bytes (276474/276523 bytes). Stale help and checksum exited `0` without staleness validation; stale descriptor exited `1` and wrote no output; current descriptor exited `0` after a passed staleness check. The explicit warning override remains covered.
- **Checks:** release `23/23`; OpenCode/Pi reachability/materialization `77/77`; generated host/source-marker `2/2`; strict `bunx tsc --noEmit` exit `0`, no diagnostics. Git-safety tests were not applicable because Git-safety behavior was untouched. Serena’s Node/Vitest-global diagnostics were environment-misconfigured, so strict TypeScript is the authoritative clean result.
- **Subject/dependency:** five-target canonical manifest `sha256:bb1798fc74acd0aa5b36b56a0d07432954eea331ca934f7dbf871505f0b411b2`; dependency object `sha256:d075be1eb343f9486470d42cb9baedb22a1a37f83cd44746ed46f11fc76bc241`. Final target hashes are build info `sha256:dd18c1ee4ecd5081c7c5820952e0a28187e0e9e2fbc03ed691ee6f62c95c6946`, OpenCode `sha256:d9d45fd649db9eb0e6419a07ac87e60870f01fa92a0ab9d2d0fefc1052a50e42`, Pi `sha256:f3053d804c32d005f4d819cc8f1cd062470275da12870b21e1d070cb53c5efc2`, release test `sha256:91efad35f0ab15905d8b71e83e0ceb093af5de07121e0242ead25bd761ede424`, and release source `sha256:85d7bfeebf8969f922434949c05c0838b5965e53cc396acbc2dd1080f920f5ab`. Pre-append progress digest was `sha256:c4f681cb55c98000c4040a4f3f9652afe092bff8cd9306bde5dcf9a5beddcc22` (83044 bytes).
- **Scope/invalidation/readiness:** NUL-delimited status comparison found no unexpected new path and no missing pre-existing path; Boundary B’s two test edits and append remain intact. No generator/test touched another path. Prior predecessor TARGETED/AFFECTED_AREA/Review/BROAD evidence and pre-repair successor T02–T04 readiness/combined identities are invalid for this coordinated A/B/C candidate and must not be reused. The candidate is ready for fresh combined validation; batch completion still awaits the separately routed independent stages.
- **Target validation:** automated target validation was required and completed; manual/UI/product validation was not applicable. `FailureManifestV1`: not produced. Ordered `RegistryIntentV1`: `[]`. **Blockers:** no Apply implementation blocker; combined independent validation remains outstanding.

# Coordinated A/B/C Apply Candidate Validation Completion

- **Status/action:** `passed` / `apply.completed` candidate ready for fresh independent QA in the required order. This evidence is Apply-local and non-independent; it is not TARGETED, AFFECTED_AREA, Review, or BROAD evidence.
- **Provenance and binding:** `deck-developer-apply-general` / `openai/gpt-5.6-sol` / runner `opencode` / `2026-07-29T04:47:00Z`; batch `batch:v1:fae7fb3cf1c1746e974dd178567c3e08` / `sha256:fae7fb3cf1c1746e974dd178567c3e081c19e35aba46f8da8d77409ca2bc4b60`; decision `sha256:2b3b08024f49a64c9ae0d0891633b1601df68422d28381ed6840382cd688fb53`; failed finding dependency `finding:v1:62f456be182bc35d848673777126cb15`. Skill discovery remained `indeterminate` with reason `validate_command_returned_unexpected_interactive_menu`; bounded direct discovery was used. Advisory Supermemory was loaded; official OpenSpec, registry, source, tests, and specialist evidence remained authoritative.
- **Cross-change subjects and dependencies:** Boundary B remains `sha256:ca027e49c59152dc18d9bdfa8e40c0c88226fc1bd2350072d4c9730a397bfed2` with dependency `sha256:1121053951a4c17edd0dbfedcaddf7056644f52d7f4715cce4f7fd0f9900618f`; Boundaries A/C remain `sha256:bb1798fc74acd0aa5b36b56a0d07432954eea331ca934f7dbf871505f0b411b2` with dependency `sha256:d075be1eb343f9486470d42cb9baedb22a1a37f83cd44746ed46f11fc76bc241`. The path-sorted seven repair-target `{path,sha256,bytes}` manifest has cross-change subject `sha256:98e49d652b1f78ab4adf96ac1fff0ff3cdedac56eccf4da3ca800877be61bbc6`; the bound cross-change dependency object is `sha256:4a2c91e1ae89947cc97604ce37657ca86458de3d9cfb3668daa5fba711c8d9b3`.
- **Preservation:** HEAD remained `aee3038df0a784b07ba9dd44aca026dca78bc857`. The predecessor 17-path subject remained `sha256:4ffb265c7b2f38ceff34ae3564646326409cebdb9756b083dbe97addcf3bcf43`; its exact binary diff remained `sha256:f6eefc085d567a51e63369760a21bb60b124143213ec45b7c4f1d25465316c75` (`3176` bytes). Registry bases remained predecessor state/events `sha256:8cd6d4ad02ef0f5866f799982572f0fc61464b46516236d5c87d6201d24574b6` / `sha256:8aa20291f9013e3579c8046a1f155e924f32c23b8fefe906abc33e7fa7d1914d` and successor state/events `sha256:16c824a62dddf2ca8b5dfa47bef15388997b6a171c4440f57d3c30184ec3ad2b` / `sha256:8ce5cb1c8b8f23f39bc6fa1530414823ca748c84973a44472e9033b67124ab65`. Pre/post validation NUL-porcelain digest was identical at `sha256:08fc57e47f389e9deec11530a13acae11760aa485b7e033ab78407dd8f6d7443` before this authorized append. Excluded canonical sources, T09/T11–T13, unrelated WIP, `.atl/skill-registry.md`, `.gitignore`, `runner-capability-standardization`, and all non-allowlisted paths were unchanged.
- **Focused and functional proof:** release `23/23`; strict package-root export oracles `79/79`; T02 index/session preparation `10/10`; OpenCode/Pi reachability and temporary materialization `77/77`; generated marker/host reachability `2/2`; strict profile/commit composition `268/268`; Git safety `29/29`. Actual CLI exercises proved stale help and checksum exit `0` without staleness failure, stale descriptor exits `1` and writes no output, and current `0.2.4`/stable descriptor succeeds against frozen HEAD. A package-directory self-import exposed exactly `111` root exports and invoked all seven T02 APIs successfully, including one-use authorization and completed handoff.
- **Generator evidence:** current build-info records version `0.2.4` and frozen HEAD `aee3038df0a784b07ba9dd44aca026dca78bc857`, so the build-info generator was correctly not rerun. OpenCode/Pi canonical source hashes remain `sha256:4f836c55e56a54d49292fb59479cf2493b8fab0e9374ce5bdbdd84f4d0b1b914` and `sha256:7f8e6593247584d6a910d38e90eb619b35c85874e629eb7dedc067f364d711e8`; generated markers match exactly. Existing specialist double-generation evidence remains applicable because every canonical/generated byte reconciled exactly; no additional generation was needed and no generated file was hand-edited.
- **Full candidate and hygiene:** exact `bun test --timeout 30000` exited `0` with `4075 pass`, `0 fail`, `4075` tests across `226` files; output digest `sha256:b5d21675091134be9b4273753d84eb2028064cddbb7b08e598438730e9322350`. The six original repository-suite failures are closed. `bunx tsc --noEmit`, `git diff --check`, both rooted OpenSpec validations, non-mutating build help/planning, and package dependency planning all exited `0`; both OpenSpec results were `ok: true` with zero errors and warnings. No command known to write build/package output outside the allowlist was run.
- **Limitations, invalidation, and target classification:** no actual build/package output was produced; only non-mutating planning was exercised because build commands write outside the allowlist. Manual/UI/product validation is not applicable. Automated target validation was required and passed through CLI, package-root, runner materialization, and generated-marker exercises. All pre-A/B/C TARGETED, AFFECTED_AREA, Review, and BROAD evidence remains stale and must not be reused; fresh independent stages remain required. `FailureManifestV1` is empty; there are no Apply blockers.
