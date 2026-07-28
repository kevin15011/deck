# Apply Progress: Stabilize the Repository BROAD Baseline

## Status and recovery provenance

- **Phase:** Apply only; recovery continuation after an interrupted `deck-developer-apply-general` invocation.
- **Status:** Implementation and Apply-local validation completed. The baseline ledger transition described below is the sole remaining repository edit after this artifact is written and is required to be the final Apply edit.
- **Authorization:** Exact user response `Procede`; authorization decision digest `sha256:c87fe27ec02870e18cb7cfcea3055632ce1c681ce22c5537f3c8fc17e0008b07`.
- **Recovery handling:** Preserved and inspected the seven partial implementation edits. No reset, restore, checkout, stash, reverse patch, destructive Git command, branch operation, registry write, or blind overwrite was used.
- **Role / model / runner:** `deck-developer-apply-general` / `openai/gpt-5.6-sol` / `opencode`.
- **Skill discovery:** The supplied V1 context was `indeterminate` with reason `session-context-indeterminate`. Bounded active-runner discovery was used; `.atl/skill-registry.md` was not validated, refreshed, generated, or modified.
- **Adaptive context:** Advisory Supermemory context was loaded. OpenSpec artifacts and repository evidence remained authoritative.

## Authoritative dependencies

- Proposal: `sha256:45afcae01535dd69a029a8a4d87ab79be905612efaa5212a1427516aeb6e50d1`.
- Spec: `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c` — 34 requirements, 50 scenarios, 9 capabilities.
- Design: `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167` — Medium risk; EII not applicable.
- Tasks: `sha256:0a8c5bbe8f5a6f95fd564457f38537fad5aaaf122ae4196427b360b13f6f7c9f` — 15 tasks in seven groups.
- Preconditions: `sha256:17e4d739c39b487722391e3f7999a2fdd28edac571f857f8ce6a55a334c70b48` — none.
- Registry base supplied for deferred coordination: state `sha256:febf4e53e6a7602b365394ec7639f84c0e2e28eac2086c1ae7babc226b31b88a`; events `sha256:9abca8776191ed2f82ba5dfac3f0e14746d3161e6a88a6ed71a6055f99570c9d`; `tasks/completed`.
- Git HEAD: `552172640f3b4172e6a395a8314b3aac0b4d2e20`.

## RED evidence and limitation

The interrupted invocation did not leave trustworthy per-assertion RED command output. No RED result was fabricated and repository files were not reverted merely to recreate it. This Apply binds pre-change RED to the existing official parent BROAD evidence: exact command `bun test --timeout 30000`, exit `1`, `3997 pass`, `7 fail`, `4004 tests across 222 files`, output digest `sha256:32acba62d480348bdb2083d2762f79f3fbe1894979316e6cfc002260d203bc5a`. That evidence identifies the five repair classes covered by this change. Recovery-local failing runs were treated only as reconciliation evidence, not as pre-fix RED.

## Implemented behavior and changed targets

1. `docs/architecture.md` — changed only the two approved links to the archived specification and design destinations.
2. `packages/adapter-pi/src/install-tools.ts` — retained the function-form fourth argument, added the typed object form in the same fourth position, resolved production defaults once, threaded the full private dependency set, and made explicit post-install `unusable` results fail closed.
3. `packages/adapter-pi/src/install-tools.test.ts` — replaced host-dependent outcomes with deterministic `ready`, `missing`, `unusable`, uv, pipx, timeout, and compatibility fixtures.
4. `apps/cli/src/tui/app.opencode-discovery.test.tsx` — replaced the fixed success sleep with fresh post-action output boundaries, one absolute 5-second deadline, capped 2 KiB diagnostics, stale-output rejection, state-specific predicates, and bounded async cleanup.
5. `apps/cli/src/__tests__/binary-smoke.test.tsx` — added the 20-second command deadline, 250 ms TERM grace, 4-second cleanup deadline, direct Bun entry-point execution, POSIX process groups, Windows `taskkill.exe /PID ... /T /F`, root/descendant cleanup confirmation, stream EOF confirmation, local sandboxes, and zero-exit real CLI smokes. Code `124` is accepted only by the dedicated cleanup oracle and never by a real smoke.
6. `apps/cli/src/doctor-command/doctor-diagnostics.ts` — added the optional/defaulted dependency object with exactly `runDeckChecks` and `fetchReleaseDescriptor`; normal `memoryBinaryAvailable` and `readOpenCodeMcpSection` paths remain unchanged and uninjected.
7. `apps/cli/src/__tests__/doctor-diagnostics.test.ts` — removed `/tmp/engram` and PATH mutation and supplied typed deterministic fixtures for the two approved boundaries.
8. `openspec/baseline-health.yaml` — the exact evidence-backed transition below is reserved as the final Apply edit.
9. `openspec/changes/stabilize-repository-broad-baseline/apply-progress.md` — this recovery and evidence record.

No generated file, dependency manifest, lockfile, shared utility, production TUI file, registry YAML, or ninth implementation target was changed.

## Apply-local evidence

All commands ran from `/home/kevinlb/deck`. Results are Apply-local evidence and do not replace independent Verify or Review.

| Classification | Command | Result |
|---|---|---|
| Focused architecture | `bun test --timeout 30000 tests/documentation-governance.test.ts` | exit `0`; 10 pass, 0 fail, 1 file; 253 ms runner time (268 ms wall). |
| Focused Pi | `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts` | exit `0`; 30 pass, 0 fail, 2 files; 757 ms runner time (775 ms wall). |
| Focused TUI | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | exit `0`; 10 pass, 0 fail, 2 files; 8.77 s runner time (8.831 s wall). |
| Focused Binary | `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx` | exit `0`; 8 pass, 0 fail, 1 file; 13.39 s runner time (13.422 s wall). |
| Focused Doctor | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | exit `0`; 24 pass, 0 fail, 2 files; 3.78 s runner time (3.802 s wall) after the final typed fixture correction. |
| Grouped Pi | `bun test --timeout 30000 packages/adapter-pi/src` | exit `0`; 476 pass, 0 fail, 24 files; 5.93 s runner time (5.978 s wall). |
| Grouped affected | `bun test --timeout 30000 tests/documentation-governance.test.ts apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts apps/cli/src/__tests__/binary-smoke.test.tsx apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | exit `0`; 52 pass, 0 fail, 6 files; 12.21 s runner time (12.250 s wall). |
| Typecheck | `bunx tsc --noEmit` | exit `0`; 0 errors; 56.411 s wall. |
| OpenSpec | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | exit `0`; `ok: true`; 1 valid change; 0 errors; 0 warnings; 1.713 s wall. |
| Full Apply-local BROAD | `bun test --timeout 30000` | exit `0`; 4014 pass, 0 fail, 222 files; 80.83 s runner time (80.925 s wall). Full output retained at `/tmp/opencode/stabilize-repository-broad-baseline-full-suite.log` for this invocation. |

The first context-capture attempts for typecheck and full BROAD exceeded the MCP transport wait while their child processes continued. Apply waited for those processes to exit, confirmed no test/typecheck process remained, and then ran fresh successful commands for authoritative evidence. No overlapping retry was started.

## Functional exercises

- The Binary focused suite exercised the real CLI entry point for `version`, `doctor`, no-argument non-TTY fallback, and `upgrade --yes` with a valid local descriptor whose `items` array is empty. Every real command returned code `0`, `timedOut: false`, `cleanupConfirmed: true`, and command-specific output.
- The dedicated subprocess lifecycle oracles exercised nonzero root exit, complete stdout/stderr EOF, timeout classification `124`, emitted descendant PID capture, process-tree termination, and absence before return.
- The TUI suite exercised actual `DeckApp` navigation, reload, ready, empty, stale, blocked, Back, out-of-order completion, stale-output rejection, and cleanup-failure behavior.
- The Pi and Doctor focused suites exercised the public module functions through deterministic injected boundaries while preserving zero-argument/default production behavior and existing integration suites.

## Hygiene, identity, and exclusions

- No `test.only`, `describe.only`, `skip`, or `todo` weakening was introduced in the authorized targets.
- No fixed 50 ms success sleep remains in the TUI target; every render wait and cleanup is bounded.
- No `deck-binary-smoke-*` temp root remained after validation, and no full-suite, typecheck, or candidate Apply process remained running.
- Before the full suite, the protected parent candidate recomputed exactly to HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`, 17 files, subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`, and binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9` (`61827` bytes).
- Protected excluded WIP checkpoint hashes were state `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771` and events `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339`; final return evidence must match them.
- `runner-capability-standardization`, the parent candidate, excluded WIP, generated outputs, global runner configuration, registry `state.yaml`, and registry `events.yaml` were not edited by this Apply.

## Ledger transition transaction

The fresh full-suite gate is green, so the sole remaining and final Apply edit is authorized to update only `openspec/baseline-health.yaml` with:

- `updated` and evidence timestamps from this Apply on `2026-07-28`;
- source `stabilize-repository-broad-baseline Apply`;
- exact repository command and sole source command `bun test --timeout 30000`;
- expected status `pass`, `passed: 4014`, and `failed: 0`;
- removal of the active Binary timeout fingerprint and known-failure-only policy;
- retained comparison schema with any new failure blocking;
- refreshed typecheck evidence for the successful `bunx tsc --noEmit` run.

After that ledger update, no further Apply edit is permitted. Independent targeted Verify, affected-area Verify, Review, and final mandatory BROAD remain pending and must be fresh.

## Validation classification, deviations, and economy

- **Target validation:** Yes, conditional Apply-local validation. Every focused and grouped target command, typecheck, rooted OpenSpec validation, hygiene check, and the required full suite passed.
- **Product validation:** No. The functional module/CLI/TUI exercises passed, but this role did not perform independent Verify, independent Review, release validation, deployment, or production validation.
- **Deviation:** Per-class pre-fix RED logs from the interrupted process were unavailable. Official parent BROAD failure evidence was used and the limitation is explicit. Recovery-local failures were not mislabeled as RED.
- **Code economy:** The change spans the approved cross-cutting eight-target repair and necessarily exceeds the normal small-change advisory. It adds no dependency, shared utility, production TUI change, public fifth parameter, or speculative abstraction; test-local lifecycle/synchronization code is required by the approved process and cleanup contracts.
- **Rollback behavior:** No destructive rollback is authorized. Any later disproving evidence requires a separately authorized forward repair or forward ledger reconciliation limited to the approved scope.

## Blockers and next action

- **Apply blockers:** None after the final ledger edit described above.
- **Next action:** Central coordinator validates the immutable Apply result and helper-built RegistryIntentV1 against the supplied registry base, then schedules fresh independent targeted Verify. The coordinator alone may write registry state/events.

## Bounded Apply Repair — Four-Member Doctor Seam

### Authorization and supersession

- **Classification / mode / role:** Run SDD repair / Interactive / `deck-developer-apply-general`.
- **Authorization:** The user explicitly authorized this exact bounded repair with `Procede` after the coordinator restated the four-member seam, fresh RED requirement, four-path repair boundary, full-suite gate, ledger-last implementation rule, and fresh QA restart.
- **Repair decision:** `sha256:d1150ba789480627397392a35d20c516196065ee26623db02021aa2e13f7d674`.
- **Repaired Tasks:** `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739` supersedes the prior two-member Doctor task interpretation and binds the approved four-member Design seam.
- **Failed targeted Verify:** `sha256:7eea8dbd4bd33498eda9010e7e470138c06e89e66f9533126f33e4ee0c93aa3f`. This repair addresses `F-VFY-TGT-001`, `F-VFY-TGT-002`, and `F-VFY-TGT-003`; their closure remains subject to fresh independent targeted Verify.
- **Pre-repair Apply artifact:** `sha256:1c35b87fe6986d1a4c50425552b77a50d4ca8e06e87ece653c993091e6577074`.
- **Registry base:** state `sha256:b3db89b6d12b59d42fa41f134e4bc62355c3b619e076b905dc00a4350531b486`; events `sha256:7a71a3524c791c49566d32084f445fef52dd083dea74e38e51f299a590173caf`; no specialist registry write occurred.

### Exact repair changes

1. `apps/cli/src/__tests__/doctor-diagnostics.test.ts`
   - Extended the local dependency factory to provide deterministic defaults for exactly `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, and `readOpenCodeMcpSection`.
   - Added fixture-driven assertions for Engram, Supermemory, and OpenCode MCP results and exact helper calls.
   - Added one exact four-key seam assertion and retained the real Doctor integration suites separately.
2. `apps/cli/src/doctor-command/doctor-diagnostics.ts`
   - Expanded the optional, typed, defaulted internal object to exactly the approved four members.
   - Resolved all four members once with nullish production fallbacks.
   - Passed the resolved binary probe and OpenCode MCP reader explicitly into their private consumers.
   - Preserved zero-argument production behavior, normal PATH lookup, normal OpenCode config parsing, output, error mapping, and result variants.
3. `openspec/baseline-health.yaml`
   - Refreshed only the evidence source/timestamps/notes after the fresh full suite passed; retained exact command, 4014 pass, 0 fail, no active fingerprint, and blocking-new-failure policy.
   - This was the final implementation edit. This phase-owned evidence append followed it without changing implementation semantics.
4. `openspec/changes/stabilize-repository-broad-baseline/apply-progress.md`
   - Appended this bounded repair record while preserving the earlier Apply history.

No fifth dependency, service locator, global mutation, extra production seam, or non-allowlisted repair was added.

### Deterministic RED → GREEN evidence

The Doctor test target was edited before production source. The exact focused command was then executed against the current two-member implementation.

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | exit `1`; 20 pass, 4 fail across 2 files; 2.407 s wall | Log `sha256:17ba7ffd5686281ec2622f47b52560973efbbbbdf04f4ce2d39b265a2a3e8b00` (2,840 bytes). Four intended assertion failures showed the injected memory/OpenCode helpers had zero calls and the exact four-member result contract was unmet. No syntax, type, setup, timeout, or unrelated harness failure occurred. |
| GREEN | same exact command after the source repair | exit `0`; 24 pass, 0 fail across 2 files; 1.908 s wall | Log `sha256:224fa89162165fa201e6aabac3fb54dcee14f392a5950123405d36e01c984772` (102 bytes). |

RED mapping:

- `F-VFY-TGT-001`: the exact key assertion required all four approved members and failed against the two-member candidate.
- `F-VFY-TGT-002`: Engram, Supermemory, and OpenCode fixture-call assertions failed because production still reached the real PATH/home helpers instead of the supplied fixtures.
- `F-VFY-TGT-003`: the retained RED log supplies fresh deterministic per-class Doctor evidence rather than relying on the earlier broad parent failure.

GREEN proves the unit scenarios consume only fixture-controlled Doctor boundaries: `runDeckChecks` once, `fetchReleaseDescriptor` once, `memoryBinaryAvailable` in exact command order `engram`, `supermemory`, `serena`, and `readOpenCodeMcpSection` once. No Doctor unit scenario mutates PATH, writes `/tmp`, reads the user's home, starts a real subprocess, or performs release/network lookup.

### Apply-repair-local validation

All commands ran serially from `/home/kevinlb/deck`. Logs are temporary Apply evidence under `/tmp/opencode`; they are not repository artifacts or independent QA.

| Classification | Command | Result / log digest |
|---|---|---|
| Focused documentation | `bun test --timeout 30000 tests/documentation-governance.test.ts` | exit `0`; 10 pass, 0 fail; 254 ms; `sha256:90b9e526e03beee155a739b5a3f442a257ad5f30f4f9d8892448693607139aba`. |
| Focused Pi | `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts` | exit `0`; 30 pass, 0 fail across 2 files; 472 ms; `sha256:815d8737b79f3f4a0168e4b46e6c6fcba4a84980718dbae0b3ab4260ce023f8b`. |
| Focused TUI | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | exit `0`; 10 pass, 0 fail across 2 files; 2.649 s; `sha256:960db2a028c9e3b3bdf9881badb5059dc523a30101466671c6abea3f18ce4e26`. |
| Focused Binary | `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx` | exit `0`; 8 pass, 0 fail; 4.404 s; `sha256:77fdecce45fae9d57b4e923e479ef5512ea6b5bcbf764db227ff72226f2987e0`. |
| Focused Doctor GREEN | Doctor command above | exit `0`; 24 pass, 0 fail across 2 files; 1.908 s; `sha256:224fa89162165fa201e6aabac3fb54dcee14f392a5950123405d36e01c984772`. |
| Grouped Pi | `bun test --timeout 30000 packages/adapter-pi/src` | exit `0`; 476 pass, 0 fail across 24 files; 4.592 s; `sha256:84e57444073714d6e5799f5224ffcae8657d3db1cdc0294b7b3461b85035330e`. |
| Grouped affected | exact six-file command from Design/Tasks | exit `0`; 52 pass, 0 fail across 6 files; 8.541 s; `sha256:3b08a2f0655801aac0dad7bafa2450da20ecbb00dc3fdcc8c1a4c5eb06091059`. |
| Typecheck | `bunx tsc --noEmit` | exit `0`; 0 errors; 34.301 s; empty-output digest `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |
| Rooted OpenSpec | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | exit `0`; `ok: true`; 1 valid change; 0 errors; 0 warnings; 829 ms; `sha256:dfe781b7df6905056b54fec5998a93bed5e0a40405f0c66ceee75e343878f1f4`. |
| Fresh full Apply-local suite | `bun test --timeout 30000` | exit `0`; 4014 pass, 0 fail across 222 files; 55.831 s wall; `sha256:fac26eb46d3ea72f5126203aa8afe0b9f38eaf1396a24d87884763ec4fe6337d`. No timeout/124 was accepted. |

### Functional and hygiene evidence

- The focused Doctor unit interface exercised all four injected boundaries with deterministic results.
- The retained real `doctor-checks.test.ts` integration coverage passed.
- The Binary focused suite exercised the actual CLI Doctor path with sandbox-local inputs and completed with zero exit, stream/process cleanup, and no network/install/global write.
- Serena diagnostics reported no TypeScript diagnostics in either repaired Doctor file before GREEN.
- No test `.skip`, `.only`, or `.todo` was introduced; no fixed success sleep, timeout waiver, pass-with-warning, fifth seam member, or accepted code 124 was introduced.
- No `deck-binary-smoke-*` temporary root or test/typecheck process remained before the full suite.

### Candidate and exclusion binding

- **Post-repair eight-target candidate:** HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`; subject `sha256:08dcb704f108a5a8a64c6fb1ffbe0c8b74fa1bc9378345b238b7179c6e9cb106`; binary diff `sha256:89dc8fc38bd316171905598f234d818d9c42248cca3ea3e3279ce3729d827400` (`77,879` bytes).
- The five non-Doctor, non-ledger implementation targets remained byte-identical to the pre-repair candidate. The ledger remained byte-identical until the green full-suite gate, then received only the authorized evidence refresh.
- Parent `streamline-orchestrator-ownership-and-acceptance` remained subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`, diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, `61,827` bytes.
- Excluded WIP remained state `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771` and events `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339`.
- Registry remained state `sha256:b3db89b6d12b59d42fa41f134e4bc62355c3b619e076b905dc00a4350531b486` and events `sha256:7a71a3524c791c49566d32084f445fef52dd083dea74e38e51f299a590173caf`.
- Spec, Design, repaired Tasks, Preconditions, failed Verify, Proposal, exploration, generated output, manifests, lockfiles, shared utilities, production TUI, `runner-capability-standardization`, and every other protected target were read-only.

### Classification, deviations, economy, and handoff

- **Target validation required:** Yes. Conditional Apply-local target validation completed successfully through fresh RED/GREEN, focused/grouped checks, typecheck, rooted OpenSpec validation, hygiene, functional exercise, and full suite.
- **Product validation required in this Apply repair:** No. This role did not perform production, release, deployment, independent Verify, Review, or final QA. The CLI/Doctor functional exercise is local evidence only.
- **Deviation:** None from the repaired Tasks. The required deterministic Doctor RED was obtained before source modification and retained by digest.
- **Code economy:** Two behavior-bearing Doctor files received the minimum approved seam expansion; the ledger received evidence-only refresh; no dependency, shared abstraction, service locator, or fifth member was added.
- **Rollback:** No destructive rollback is authorized. Any disproving evidence requires a separately authorized forward repair and fresh evidence; registry history, parent bytes, and excluded WIP must remain preserved.
- **Freshness:** This repair invalidates the prior targeted Verify. Final QA must restart with fresh independent targeted Verify, then affected-area Verify, independent Review, and final mandatory BROAD.

## Bounded Apply Review Repair — Five Blocking Findings

### Authorization and bindings

- **Classification / mode / phase:** Run SDD repair / Interactive / Apply repair only.
- **Authorization:** The user explicitly authorized this exact five-finding repair with `Procede` after the coordinator listed every blocker, the exact five-path boundary, the full-suite/ledger rule, and the required QA restart.
- **Decision digest:** `sha256:47904911cc9c7f79f59634bca49cb401f0d09ce831e2cd05f025c9d094152f71`.
- **Failed Review:** `sha256:62fe4a432875a3b0fcadd078cb86a09d76a54fd538e7da72c6aea6a3f1e27b77`.
- **FailureManifestV1:** `sha256:1930e313f4fe6e90f3be54bc1da322a9180f91a5c827ade233501451b9913e6f`.
- **Derived batch:** `batch:v1:db4ce8e870c3cb0d3ae3fec9ef34e371`, digest `sha256:db4ce8e870c3cb0d3ae3fec9ef34e371a275b7e4f3dae04af3e25459b081c43a`.
- **Verify dependency:** `sha256:940e2b045c6c33b57c30c46a6a8f2afc04c680d77bbdcafea33a16c839f0994d`; its targeted and affected judgments are stale after this repair.
- **Registry base:** state `sha256:5affc71ebaa4280c153ef3793474f5799f045a68ec36c158688f2ddf832d6735`; events `sha256:9ace5a960c6049a9375758d7fb6b6577401db5b3283efa27a2ccaeb0c72f7056`; no registry write occurred.

### Exact changed paths and finding closure

1. `packages/adapter-pi/src/install-tools.ts`
   - **F-REV-PI-001:** Renamed the fixed internal member to exact Design spelling `sharedBinaryUsabilityTimeoutMs` across type, default, resolution, and both probe consumers.
   - Preserved the same fourth-position object/function overloads, default `5_000` ms behavior, direct helper signatures, and no fifth argument.
2. `packages/adapter-pi/src/install-tools.test.ts`
   - **F-REV-PI-001:** Changed the deterministic timeout fixture to the exact Design member name.
   - **F-REV-PI-002:** Replaced the host-probing shared-binary no-console path with the approved object seam and an exact fixture-call assertion; added a deterministic unit-source guard requiring shared-binary paths to declare the probe fixture.
3. `apps/cli/src/__tests__/binary-smoke.test.tsx`
   - **F-REV-BIN-001:** Added portable controlled Windows lifecycle dependencies and success/nonzero long-lived-descendant oracles. Windows cleanup now invokes fail-closed taskkill handling for root and each emitted descendant and confirms every PID absent.
   - **F-REV-BIN-002:** Made every sandbox shim accept only the exact `--version` invocation and reject unexpected commands/arguments with exit `64`; added the unexpected-install oracle and a controlled outside-sandbox sentinel snapshot around upgrade.
   - **F-REV-BIN-003:** Replaced additive cleanup races with one absolute deadline shared by process-tree termination, root exit, and both EOF pumps. Stream readers expose snapshots for early descendant discovery and are cancelled and settled on deadline failure.
   - Preserved direct argv launch, 20-second command deadline, 250 ms TERM grace, 4-second default cleanup budget, POSIX groups, Windows absolute taskkill behavior, code-124 failure-only classification, and local fixtures.
4. `openspec/baseline-health.yaml`
   - Refreshed source, timestamps, notes, and the unambiguous full-suite count to 4,019 pass / 0 fail only after the fresh full suite exited zero.
   - This was the final implementation edit. The evidence append below changes no implementation semantics.
5. `openspec/changes/stabilize-repository-broad-baseline/apply-progress.md`
   - Appended this Review-repair evidence while preserving all prior Apply history.

The non-blocking `A-REV-001` TUI `flush()` advisory remained explicitly out of scope and untouched.

### Test-first RED → GREEN

#### Pi findings

- **RED command:** `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts`.
- **RED result:** exit `1`; 29 pass, 2 intended fail across 2 files; 465 ms; log `sha256:e1ac01c4183388ae4a7d0fc577b9aca4eeb1d6bc0d37a86a1aae75cd91f5817f` (2,241 bytes).
- **Intended failures:** the new exact Design property supplied `1_234` but the old implementation retained the default timeout, and the named no-console shared-binary test lacked a deterministic probe fixture. No syntax, type, setup, host-state, or unrelated failure occurred.
- **GREEN result:** same command, exit `0`; 31 pass, 0 fail across 2 files; 369 ms; log `sha256:abb7eaa84e641e274f0b6795a3649d9acb3cd15f2c189db3f0360361f07b8e9c`.

#### Binary findings

- **RED command:** `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx`.
- **RED result:** exit `1`; 8 pass, 4 intended fail; 4.502 s; log `sha256:79aca3ba1ea74ac6d07a277f9738e628abb9d8343884fbbbd4ddddde7756bd5d` (2,723 bytes).
- **Intended failures:** permissive shim returned zero for an install-like command; controlled Windows success/nonzero simulations observed no taskkill descendant proof; injected stalled EOF pump was neither governed by one observed cleanup deadline nor cancelled. No syntax, type, setup, platform skip, timeout waiver, or unrelated failure occurred.
- **Final GREEN result:** same command, exit `0`; 12 pass, 0 fail; 4.405 s; log `sha256:2e5660f9198423e059c193ff8a8cf0a2274f46d9d8da3c9b682802fb64e9efe8`.

### Apply-local validation and functional evidence

| Classification | Command | Result / log digest |
|---|---|---|
| Focused documentation | `bun test --timeout 30000 tests/documentation-governance.test.ts` | exit `0`; 10 pass, 0 fail; 251 ms; `sha256:a6fb4e124f716a3bda297140987ff6baf0fc72c7b4728b9de062077f2dd7adad`. |
| Focused Pi | exact Pi GREEN command above | exit `0`; 31 pass, 0 fail; 369 ms; `sha256:abb7eaa84e641e274f0b6795a3649d9acb3cd15f2c189db3f0360361f07b8e9c`. |
| Focused TUI | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | exit `0`; 10 pass, 0 fail; 4.442 s; `sha256:191c88c19cbfd63452a052bcaae7e0ef61cc28abf7354c6fa57e8f276fb31089`. |
| Focused Binary | exact Binary final GREEN command above | exit `0`; 12 pass, 0 fail; 4.405 s; `sha256:2e5660f9198423e059c193ff8a8cf0a2274f46d9d8da3c9b682802fb64e9efe8`. |
| Focused Doctor | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | exit `0`; 24 pass, 0 fail; 3.093 s; `sha256:8de05c5be69470ea397b75e28c510743be590fdd63b620edcc4feb271a0c5e5e`. |
| Grouped Pi | `bun test --timeout 30000 packages/adapter-pi/src` | exit `0`; 477 pass, 0 fail across 24 files; 3.406 s; `sha256:a8b8d406b7c67ab4237909351beee107ca6a0490ddf361e92c41a3c68f335d7c`. |
| Grouped affected | exact six-file command from Design/Tasks | exit `0`; 56 pass, 0 fail across 6 files; 8.638 s; `sha256:41b03b9252b8c5352b6b08ab148a2e0852a0cb383aefcc2965115abdb8009cf2`. |
| Typecheck | `bunx tsc --noEmit` | exit `0`; 0 errors; 25.909 s; empty log `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |
| Rooted OpenSpec | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | exit `0`; 1 valid change, 0 errors, 0 warnings; 657 ms; `sha256:df455500c68de870207adc3fd2fc81fcffedf1d59ac38a72bb35026e11605952`. |
| Fresh full Apply-local suite | `bun test --timeout 30000` | exit `0`; 4,019 pass, 0 fail across 222 files; 49.482 s; `sha256:f6d567aa54d36312271a0e542e7154d3e0ca104c0b69ef93cabb39e250d6ca99`. |

Functional exercises included deterministic Pi ready/probe/timeout behavior; real sandboxed CLI version, Doctor, no-argument TUI, and empty-descriptor upgrade; strict unexpected shim rejection; POSIX timeout/nonzero lifecycle; controlled Windows normal/nonzero descendant cleanup; controlled outside-sandbox sentinel preservation; and stalled-EOF cancellation under one deadline. No network, real install, shell interpolation of runtime arguments, global/user write, accepted 124, or platform skip occurred.

### Candidate, scope, and exclusions

- **Post-Review-repair eight-target candidate:** HEAD `552172640f3b4172e6a395a8314b3aac0b4d2e20`; subject `sha256:f89e50de15bcef6c6c59ddc586a0c580c8dd6c37613dbfdba79b640bd00328df`; binary diff `sha256:35662a58309b03e2dc0c4a80d9752e32477ccf1f35cf5503bf52e78d2e34348f` (`90,319` bytes).
- The five implementation targets outside the Pi pair and Binary target remained byte-identical until the authorized post-suite ledger refresh; Doctor source/test, TUI test, and architecture documentation remained byte-identical throughout. The ledger changed only in truthful evidence fields after the green gate.
- Protected parent remained subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`, diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`, `61,827` bytes.
- Excluded WIP remained state `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771` and events `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339`.
- Registry remained state `sha256:5affc71ebaa4280c153ef3793474f5799f045a68ec36c158688f2ddf832d6735` and events `sha256:9ace5a960c6049a9375758d7fb6b6577401db5b3283efa27a2ccaeb0c72f7056`.
- Spec, Design, Tasks, Preconditions, Verify, Review, state/events, Doctor, TUI, architecture, generated output, manifests, lockfiles, dependencies, shared utilities, parent, excluded WIP, and `runner-capability-standardization` remained protected as delegated.
- Static hygiene found no old Pi member spelling, skip/only/todo weakening, fixed success sleep, additional cleanup deadline, uncancellable pump, dangling process, or `deck-binary-smoke-*` temp root.

### Classification and next action

- **Target validation required:** Yes. Conditional Apply-local target validation passed with per-finding RED/GREEN, all focused/grouped checks, typecheck, rooted OpenSpec validation, functional exercises, hygiene, and fresh full suite.
- **Product validation required during Apply:** No. No deployment, release, production, independent Verify, independent Review, or final QA was performed.
- **Deviations:** None. The unused TUI `flush()` advisory was intentionally not edited.
- **Code economy:** The Pi repair is a direct fixed-name correction plus one deterministic fixture. Binary complexity is test-local and required for cross-platform fail-closed lifecycle, strict shim security, containment, and one-budget cancellation; no dependency or shared utility was added.
- **Rollback:** Forward-only under separate authorization; no destructive Git operation is permitted.
- **Freshness:** This repair invalidates prior targeted, affected-area, and Review judgments. QA must restart targeted → affected-area → fresh Review → mandatory BROAD.

## Final bounded repair for `F-REV-BIN-002` — 2026-07-28

### Scope and root cause

- Modified only `apps/cli/src/__tests__/binary-smoke.test.tsx`, this append-only progress artifact, and the evidence-gated ledger refresh described below.
- Root cause: the prior outside-sandbox sentinel was disconnected from the child command, so its unchanged snapshot could not detect an addressed write escape.
- Replaced that inert proof with a causal, bounded inventory derived from the actual child launch boundary: repository-root `cwd`, the runtime executable named by argv, all configured writable environment roots, and optional test-owned addressed boundaries used by the negative oracle.
- The inventory verifies every writable `HOME`/`USERPROFILE`, XDG, and temp root remains inside the disposable sandbox; hashes the repository's tracked and non-ignored untracked file set without taking Git locks; and hashes the invoked runtime executable. It reports the exact changed boundary.

### Test-first RED → GREEN

- **RED command:** `bun test --timeout 30000 apps/cli/src/__tests__/binary-smoke.test.tsx`.
- **RED result:** exit `1`; 12 pass, 1 intended fail; 6.864 s wall; log `sha256:69047537bd4be24213751cffc0705af6247161e27802b2668af55a376d7d9aee`.
- **Intended failure:** a controlled child received a test-owned outside path and wrote `escaped.txt`; the old unrelated sentinel remained unchanged while the addressed boundary comparison failed. No syntax, setup, network, install, host-user write, timeout, or unrelated failure occurred.
- **GREEN result:** same command, exit `0`; 13 pass, 0 fail; 8.020 s wall; log `sha256:21d53b229c773ef518d9c7b3eb87357f7a35cf6ee7a70e42285420c02104c8b0`.
- The negative oracle now proves the causal inventory rejects the controlled escape with diagnostic `Outside-sandbox write detected in: addressed-test-boundary`. The real empty-descriptor upgrade proves its repository/runtime outside inventory is unchanged.

### Apply-local validation

| Classification | Command | Result |
|---|---|---|
| Focused documentation | `bun test --timeout 30000 tests/documentation-governance.test.ts` | exit `0`; 10 pass, 0 fail. |
| Focused Pi | `bun test --timeout 30000 packages/adapter-pi/src/install-tools.test.ts packages/core/src/shared-binary-usability.test.ts` | exit `0`; 31 pass, 0 fail. |
| Focused TUI | `bun test --timeout 30000 apps/cli/src/tui/app.opencode-discovery.test.tsx apps/cli/src/tui/opencode-discovery.test.ts` | exit `0`; 10 pass, 0 fail. |
| Focused Binary | exact Binary GREEN command above | exit `0`; 13 pass, 0 fail. |
| Focused Doctor | `bun test --timeout 30000 apps/cli/src/__tests__/doctor-diagnostics.test.ts apps/cli/src/__tests__/doctor-checks.test.ts` | exit `0`; 24 pass, 0 fail. |
| Grouped Pi | `bun test --timeout 30000 packages/adapter-pi/src` | exit `0`; 477 pass, 0 fail across 24 files. |
| Grouped affected | exact six-file command from Design/Tasks | exit `0`; 57 pass, 0 fail across 6 files. |
| Typecheck | `bunx tsc --noEmit` | exit `0`; 0 errors. |
| Rooted OpenSpec | `bun apps/cli/src/main.tsx openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | exit `0`; 1 valid change, 0 errors, 0 warnings. |
| Fresh full Apply-local suite | `bun test --timeout 30000` | exit `0`; 4,020 pass, 0 fail across 222 files; 49.777 s wall; log `sha256:16ea10bc41bd10b8a177bc91f5167d2726b801f8b734e1290154591b655bf63a`. |

### Protection and handoff

- No `skip`/`only`/`todo`, accepted `124`, shell interpolation, network, install, platform skip, generated-output edit, dependency edit, global/user write, or destructive Git operation was introduced.
- Registry remained state `sha256:bfeb41a9cdf306930b11f22e33bf672caffb27cc38be7a06250c0fe445d4db72` and events `sha256:a652d513aefdbb42bc076aded45d6ae45e10175cbebe304c9c33105c2ae9ce65`.
- Excluded WIP remained state `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771` and events `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339`.
- Parent identity remains protected at subject `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf` and binary diff `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9` (`61,827` bytes).
- The ledger refresh is the final Apply edit. This repair invalidates prior QA; the coordinator must restart targeted Verify → affected-area Verify → independent Review → mandatory BROAD.
