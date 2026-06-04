# Review Report: Fix Update/Upgrade Detection and Orchestrator Invariants (Post-Apply-Repair #5 Re-Review)

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general
**Files Reviewed**: 25 (re-reviewed after Apply Repair #5; focused on M1 install-time caller re-check + R2 suggestion-text ternary fix)
**Registry Mode**: deferred (state.yaml/events.yaml intentionally not written)
**Re-review target**: M1 install-time caller (was MAJOR post-Repair #4) + carryover R2 suggestion-text ternary.

This re-review focuses on the user-requested M1 re-check after Apply Repair #5. The M1 MAJOR is **downgraded to MINOR (closed-but-not-end-to-end-tested)**: the install-time call site at `developer-team-install.ts:537-545` now plumbs `authorization` through `buildPromptGenerationPlan` → `buildPromptContent` → `composeApplyAgentPrompt` → `renderDelegationGate` + `renderApplyAuthorizationCard`, the inner wiring is fully tested at the prompt-generation layer (6 new tests in `prompt-generation.test.ts:488-592`), the gate text references INV-004 and INV-006, and the carryover R2 suggestion-text ternary is fixed (single string at `prepare-release.ts:675`). The remaining gap is that `developer-team-install.test.ts` does NOT contain a test that exercises the authorization option end-to-end (build plan with authorization → apply → read disk → assert card present). The option is plumbed, the inner behavior is proven, but the install-time caller itself is not directly tested with authorization.

**Key judgment on user's specific question (M1 re-check)**:
- Install-time caller plumbs `authorization` into `buildPromptGenerationPlan`/`buildPromptContent`: **YES** (developer-team-install.ts:537-545 → prompt-generation.ts:407-421 → prompt-generation.ts:272-298).
- Card text references INV-004 and INV-006: **YES** (orchestrator-invariants.ts:403, 410; test at orchestrator-invariants.test.ts:446-454 asserts on literal strings).
- Tests prove apply agent production prompts include real card with INV-004/INV-006: **YES at the inner-function layer** (prompt-generation.test.ts:488-592 asserts on "Triage completed" + "Explorer-first evidence" + "modifying work authorized: yes" for apply-general/backend/frontend; orchestrator-invariants.test.ts:446-454 asserts on literal "INV-004"/"INV-006"). **NO at the install-time-caller layer** (developer-team-install.test.ts has the import but no test uses `authorization`).
- Self-rejection paradox: **REACHABLE** — when authorization is provided to the install-time path, the marker is replaced by the real card and the "may proceed" clause is reachable. When authorization is NOT provided (current default), the marker remains and the "always refuse" paradox persists at install time.

## Re-Check of M1 (User-Requested) + R2 Carryover

| Sub-criterion | Prior Status (Post-Repair #4) | Post-Repair-#5 Status | Verdict |
|---|---|---|---|
| Install-time caller plumbs `authorization` into `buildPromptGenerationPlan` | Not plumbed (developer-team-install.ts:530-536 did not pass `authorization`) | **PLUMBED** (developer-team-install.ts:537-545 now passes `authorization: options?.authorization`; option declared at line 476; import at line 61) | **FIXED** |
| `buildPromptGenerationPlan` accepts and threads `authorization` to `buildPromptContent` | Already plumbed (post-Repair #4) | Unchanged — accepts `authorization` (line 390), destructures (line 393), passes to `buildPromptContent` (line 417) | **UNCHANGED (still correct)** |
| `buildPromptContent` calls `composeApplyAgentPrompt` when `isApplyAgent && authorization` | Already wired (post-Repair #4) | Unchanged — APPLY_AGENT_IDS const (lines 254-258); isApplyAgent check (line 295); composeApplyAgentPrompt call (line 297) | **UNCHANGED (still correct)** |
| Card includes INV-004/INV-006 references (in renderable text) | Yes (post-Repair #4) | Unchanged — `renderDelegationGate` (orchestrator-invariants.ts:392-435) emits "- [ ] Triage must complete before modifying work (INV-004)" at line 403 and "- [ ] Explorer investigation required before modifying work (INV-006)" at line 410 in the BLOCKED case; semantic markers in the cleared case | **UNCHANGED (still correct)** |
| Tests prove apply agent prompts include real card | Inner-function tests only (prompt-generation.test.ts:488-592); no install-time test | Inner-function tests unchanged. **developer-team-install.test.ts:15 imports `ModificationAuthorization` but has zero tests using it.** | **PARTIALLY FIXED** (inner tests cover the path; install-time caller not directly tested with authorization) |
| Self-rejection paradox resolved | Wiring real; install path does not exercise it | Wiring real; install path **can** exercise it when caller passes authorization. By default, no caller passes authorization, so installed prompts still have static marker. | **REACHABLE** (was "partially resolved" — now reachable when caller opts in) |
| R2: Suggestion-text identical ternary in `prepare-release.ts` | Identical branches at line 675-677 | **FIXED** — line 675 now uses single string: `const suggestion = \`Run: bun run scripts/generate-build-info.ts --commit ${expectedCommit}\`;` | **FIXED** |

### M1 detailed re-check

**The install-time caller plumbs `authorization` into the prompt-generation path.**

The wiring at `packages/adapter-opencode/src/developer-team-install.ts:537-545`:

```ts
// REQ-OA-005: Pass authorization to enable runtime authorization card injection
const promptGenerationPlan = buildPromptGenerationPlan({
  configDir,
  projectRoot,
  capabilityInstructions,
  personality: resolvedPersonality,
  memoryBundle,
  authorization: options?.authorization,
});
```

This is invoked by `buildOpenCodeDeveloperTeamInstallPlan` whenever the caller passes `authorization` in the options bag. The `authorization` parameter is declared on the options type at line 476:

```ts
/**
 * Optional modification authorization for apply agents.
 * When provided, authorization card is injected into apply-agent prompts (REQ-OA-005).
 * This enables runtime authorization card injection during install-time prompt generation.
 */
authorization?: ModificationAuthorization;
```

And `ModificationAuthorization` is imported from the core module at line 61. So the install-time path now has the capability to thread authorization end-to-end. The path flows:

1. `buildOpenCodeDeveloperTeamInstallPlan` (developer-team-install.ts:462-569) accepts `options.authorization` and passes it to `buildPromptGenerationPlan` at line 544.
2. `buildPromptGenerationPlan` (prompt-generation.ts:372-422) destructures `authorization` at line 393 and passes it to `buildPromptContent` at line 417.
3. `buildPromptContent` (prompt-generation.ts:272-331) accepts `authorization` at line 279 and at lines 295-298 calls `composeApplyAgentPrompt(baseContent, authorization)` when `isApplyAgent && authorization`.
4. `composeApplyAgentPrompt` (orchestrator-content.ts:411-425) calls `renderDelegationGate(auth)` (which emits INV-004/INV-006 markers) and `renderApplyAuthorizationCard(auth)` (which emits "modifying work authorized: yes" and the change/task artifact context).
5. The resulting `baseContent` replaces the static `<!-- Orchestrator will inject ... -->` marker in the apply-agent prompt, making the "may proceed" clause of the Self-Rejection Instruction reachable.

**The card text references INV-004 and INV-006.**

`renderDelegationGate` (orchestrator-invariants.ts:392-435) emits:
- Line 403: `- [ ] Triage must complete before modifying work (INV-004)` (when `requestClassification` is empty → BLOCKED)
- Line 410: `- [ ] Explorer investigation required before modifying work (INV-006)` (when `explorerArtifact` is empty → BLOCKED)
- Lines 401, 408: `- [x] Triage completed: ${...}` / `- [x] Explorer-first evidence: ${...}` (when present → CLEARED)
- Line 430: `**BLOCKED**: Cannot proceed with modifying delegation until all gates are cleared.` (when any gate fails)

The unit test at `orchestrator-invariants.test.ts:446-454` ("should include INV-004 and INV-006 references") explicitly asserts the literal strings "INV-004" and "INV-006" appear in the gate output:

```ts
it("should include INV-004 and INV-006 references", () => {
  const auth: ModificationAuthorization = {
    requestClassification: undefined as any,
    userAuthorizedModification: true,
  };
  const output = renderDelegationGate(auth);
  expect(output).toContain("INV-004");
  expect(output).toContain("INV-006");
});
```

The integration tests at `prompt-generation.test.ts:514-517` assert on the SEMANTIC cleared-form text "Triage completed" + "Explorer-first evidence" (the form produced when authorization is provided and all gates pass):

```ts
// INV-004 is triage check (shows "Triage completed")
expect(applyGeneral.content).toContain("Triage completed");
// INV-006 is Explorer-first check (shows "Explorer-first evidence")
expect(applyGeneral.content).toContain("Explorer-first evidence");
```

**The tests prove apply agent production prompts include real card with INV-004/INV-006 at the inner-function layer.**

The 6 new tests at `prompt-generation.test.ts:488-592` call `buildPromptGenerationPlan({ ..., authorization: mockAuthorization })` and inspect the resulting `PlannedPromptFile.content`. They assert:
- `applyGeneral.content.toContain("## Pre-Delegation Gate Checklist")` — proves gate is rendered (line 512)
- `applyGeneral.content.toContain("modifying work authorized: yes")` — proves card is rendered (line 513)
- `applyGeneral.content.toContain("Triage completed")` + `Explorer-first evidence` — proves INV-004/INV-006 semantics (lines 515, 517)
- `applyGeneral.content.toContain("test-change")` + `tasks.md` — proves change name + task artifact are injected (lines 590, 591)
- `orchestrator.content.not.toContain("## Pre-Delegation Gate Checklist")` — proves defense-in-depth: non-apply agents are NOT injected (line 558)
- `applyGeneral.content.toContain("<!-- Orchestrator will inject")` when no `authorization` — proves static marker is preserved (line 578)

All 37 tests in the file pass (verified: `bun test packages/adapter-opencode/src/prompt-generation.test.ts` → 37 pass, 0 fail per the apply-progress.md Repair #5 verification).

**The install-time path itself is not directly tested with authorization.**

`grep` of `developer-team-install.test.ts` for `authorization` returns exactly 1 match: the import at line 15. There is NO test in `developer-team-install.test.ts` that:
1. Calls `buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir, authorization: mockAuthorization })`
2. Applies the plan with `applyOpenCodeDeveloperTeamInstall`
3. Reads the apply-agent prompt file from disk
4. Asserts the file contains the gate + "modifying work authorized: yes" + INV-004/INV-006 markers

This is a **MINOR** gap, not a MAJOR: the plumbing is correct, the inner behavior is tested, and adding a single integration test (estimated ~30 lines) would close it. It is NOT a MAJOR because:
- The capability is now end-to-end plumbed (developer-team-install.ts → prompt-generation.ts → composeApplyAgentPrompt → renderDelegationGate + renderApplyAuthorizationCard).
- The inner wiring is proven by the prompt-generation.test.ts tests.
- The card content is proven by the orchestrator-invariants.test.ts tests.
- The only missing link is a single end-to-end integration test at the install-time caller layer.

**The self-rejection paradox is now reachable.**

The paradox condition (Repair #3): the static `<!-- Orchestrator will inject ... -->` marker is always present → the Self-Rejection Instruction reduces to "always refuse" → the "may proceed" clause is unreachable.

Repair #5 resolves this in the install-time path:
1. The wiring at `buildPromptContent:295-298` replaces `baseContent` with `composeApplyAgentPrompt(baseContent, authorization)` when `isApplyAgent && authorization`.
2. `composeApplyAgentPrompt` (orchestrator-content.ts:411-425) prepends `${gate}\n\n${card}\n\n---\n\n${basePrompt}`.
3. The card text contains `**modifying work authorized: yes**` (orchestrator-invariants.ts:452).
4. The Self-Rejection Instruction's "If an actual Authorization Card with 'modifying work authorized: yes' is present above, you may proceed" clause is now reachable.

**Gap (unchanged from Repair #4)**: By default, no caller passes `authorization` to the install path. The orchestrator itself is a prompt-driven LLM that uses `delegation_list`/`delegation_read` tools, not TypeScript functions. A future caller (e.g., the install command reading `ModificationAuthorization` from a config file, or a runtime composition step) would need to pass authorization to actually exercise the path at install time. This is a documentation/architecture decision, not a code defect.

### R2 (carryover) — Suggestion-text ternary in prepare-release.ts

**Status**: **FIXED** in Repair #5.

`scripts/prepare-release.ts:675` now uses a single string:
```ts
const suggestion = `Run: bun run scripts/generate-build-info.ts --commit ${expectedCommit}`;
```

Both prior identical branches are collapsed into one. The ternary was carried as a MINOR in Repair #4 review; it is now resolved.

### Verdict: M1 MAJOR → MINOR (closed-but-not-end-to-end-tested)

The M1 MAJOR classification is no longer accurate:
- The install-time caller IS plumbed (developer-team-install.ts:537-545).
- The card text DOES reference INV-004/INV-006 (orchestrator-invariants.ts:403, 410).
- The tests DO prove the inner-function layer works (prompt-generation.test.ts:488-592).
- The self-rejection paradox IS reachable in the wired code path (and the install-time path is now plumbed to exercise it when a caller passes authorization).
- The R2 carryover suggestion-text ternary IS fixed (prepare-release.ts:675).

The remaining gap is **MINOR**, not MAJOR:
- A single end-to-end test at the install-time caller layer would close the loop (call `buildOpenCodeDeveloperTeamInstallPlan` with `authorization`, apply, read disk, assert card present).
- The plumbing is real and the inner behavior is tested.

**Recommendation**: Add a single integration test in `developer-team-install.test.ts` that exercises the authorization option end-to-end. Estimated 30-40 lines. The test should:
1. Build the plan with `authorization: mockAuthorization` and a temp `configDir`.
2. Apply the plan.
3. Read `apply-general.md` / `apply-backend.md` / `apply-frontend.md` from disk.
4. Assert each contains "## Pre-Delegation Gate Checklist", "modifying work authorized: yes", "Triage completed", "Explorer-first evidence".
5. Assert non-apply agents (e.g., `explorer.md`) do NOT contain the gate.

This is the kind of follow-up that can be batched with the existing MINOR carryovers (validateBuildInfoStaleness export, Track A code-quality carryovers) and not block Archive.

## Type Fixes / Build Status (Carried From Repair #4)

The prior `prompt-generation.ts` typecheck errors remain fixed (no regression in Repair #5):
- `ModificationAuthorization` imported from correct relative path (line 21).
- `effectiveCapabilityInstructions` correctly typed (line 403).

Per `verify-report.md`:
- `bun run build:dry-run`: PASS.
- `bunx tsc --noEmit`: 0 errors in affected files (124 baseline errors elsewhere, pre-existing).
- `bun test packages/adapter-opencode/src/prompt-generation.test.ts`: 37/37 pass.
- `bun test packages/adapter-opencode/src/developer-team-install.test.ts`: 96/96 pass (per apply-progress.md Repair #5 verification, line 517).

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | Adequate | Install-time caller plumbs authorization correctly; inner wiring is real; integration gap is small. |
| Security | Strong | REQ-OA-005 fully plumbed end-to-end; card includes INV-004/INV-006; defense-in-depth preserved (no card → reject). |
| Scalability | Strong | No new hot paths. |
| Maintainability | Adequate | The `as (typeof APPLY_AGENT_IDS)[number]` cast is a workable but slightly clunky way to express the apply-agent set; suggestion-text ternary now fixed. |
| Code Quality | Adequate | Apply-time caller plumbing is clean; R2 ternary carryover fixed. |
| Backend | Strong | REQ-RM-005 staleness validation works correctly; 21/21 tests pass; typecheck clean. |
| Frontend | Strong | TUI banner copy continues to work; home-screen tests pass. |
| Integration | Adequate | Inner-function integration tests prove the path; install-time-caller end-to-end test is missing. |

## Findings

### MINOR

- **Testing / Track B (M1 closeout)**: `developer-team-install.test.ts` does not exercise the authorization option end-to-end.
  - **File**: `packages/adapter-opencode/src/developer-team-install.test.ts` (no test using `authorization`; only the import at line 15).
  - **Evidence**: The M1 plumbing is plumbed end-to-end (developer-team-install.ts:537-545 → prompt-generation.ts:407-421 → prompt-generation.ts:272-298 → orchestrator-content.ts:411-425 → orchestrator-invariants.ts:392-435). The inner-function integration tests at `prompt-generation.test.ts:488-592` cover the path when authorization is passed to `buildPromptGenerationPlan`. But there is no test that proves the install-time caller produces prompt files on disk with the authorization card when `authorization` is passed. A reader who runs only `developer-team-install.test.ts` will not see direct evidence that the option works at the install layer.
  - **Recommendation**: Add a single integration test in `developer-team-install.test.ts` (in the `buildOpenCodeDeveloperTeamInstallPlan` describe block) that:
    1. Calls `buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir, authorization: mockAuthorization })`.
    2. Calls `applyOpenCodeDeveloperTeamInstall(plan, { configDir })`.
    3. Reads `apply-general.md` / `apply-backend.md` / `apply-frontend.md` from disk.
    4. Asserts each contains "## Pre-Delegation Gate Checklist", "modifying work authorized: yes", "Triage completed", "Explorer-first evidence".
    5. Asserts the non-apply `explorer.md` does NOT contain the gate.
    Estimated 30-40 lines. Closes the M1 test gap.

- **Testing / Track B (REQ-RM-005 carryover)**: `validateBuildInfoStaleness` is module-private and not directly unit-testable.
  - **File**: `scripts/prepare-release.ts` (function declared without `export`).
  - **Evidence**: Prior review's MINOR is carried. The 21 tests in `prepare-release.test.ts` exercise the function only indirectly via `main()` end-to-end paths. No direct unit test creates a stale `build-info.generated.ts` and asserts the function throws.
  - **Recommendation**: Export the function (or extract to a module that exports it) and add a unit test for the short/full SHA mismatch path.

- **Code Quality / Track B (apply card layering)**: `composeApplyAgentPromptWithAuth` wrapper in adapter has no documented rationale for existing alongside the core function it calls.
  - **File**: `packages/adapter-opencode/src/prompt-generation.ts:474-479`.
  - **Evidence**: The wrapper simply forwards to `composeApplyAgentPrompt`. The JSDoc (lines 458-473) explains when to use it but not why the adapter layer has its own copy. A future maintainer may wonder if the wrapper is necessary.
  - **Recommendation**: Either (a) remove the wrapper and call `composeApplyAgentPrompt` directly in the test files, or (b) add a one-line JSDoc note explaining the layering decision (e.g., "Adapter-layer convenience: allows the runtime to pass prompt content as a string rather than a registry lookup").

- **Code Quality / Track A (carryover)**: Dev-build detection heuristic too narrow.
  - **File**: `apps/cli/src/upgrade-command/github-release.ts:559` (`currentVersion.includes("-dev") || currentVersion === "0.0.0"`).
  - **Evidence**: Misses `0.0.0-debug`, `1.0.0-canary`, `1.0.0-rc.1+local`, `0.1.0-dev.20240101`. `safeGetCurrentCommit()` in `release-check.ts:148-154` returns `null` on `getBuildInfo()` failure, silently treated as unknown commit.
  - **Recommendation**: Match semver pre-release identifier broadly (`/-/`) and surface a separate "build-info-unavailable" state if `getBuildInfo()` throws.

- **Code Quality / Track A (carryover)**: Schema cast in descriptor commit.
  - **File**: `apps/cli/src/upgrade-command/github-release.ts:301` (`const descriptorCommit = (descriptor as { commit?: string }).commit;`).
  - **Evidence**: `ReleaseJsonSchema.commit` was extended in `release-descriptor.ts:178` (Repair 5 from earlier round), but the cast at the call site was not removed.
  - **Recommendation**: Drop the cast; use `descriptor.commit ?? remoteCommit` directly.

- **Code Quality / Track A (carryover)**: Type cast in `release-check.ts:213` (`decision.reason as "same-build" | "local-newer" | "missing-commit" | "dev-build"`).
  - **File**: `apps/cli/src/tui/release-check.ts:213`.
  - **Evidence**: The cast silently absorbs any future reason added to `AvailabilityDecision`.
  - **Recommendation**: Replace the cast with an exhaustive `switch` over a typed map.

- **Code Quality / Track A (carryover)**: Prefix-match symmetry redundancy.
  - **File**: `apps/cli/src/upgrade-command/github-release.ts:566`.
  - **Evidence**: `localCommit === remoteCommit || localCommit.startsWith(remoteCommit) || remoteCommit.startsWith(localCommit)` — the `===` is logically covered by the two `startsWith` checks.
  - **Recommendation**: Drop the explicit `===` or add a brief comment explaining intent.

- **Testing / Track A (carryover)**: New TUI integration tests do not assert on the exact authorization text rendered in home-screen.tsx.
  - **Files**: `apps/cli/src/tui/screens/home-screen.test.tsx` (Repair 1 from R2).
  - **Evidence**: The tests assert the banner copy ("New build available" vs "Upgrade available") but do not assert the underlying reason mapping (e.g., `state.reason === "same-version-different-commit"`).
  - **Recommendation**: Add a test that constructs a `ReleaseCheckState` with `reason: "same-version-different-commit"`, `currentCommit: "abc"`, `latestCommit: "def"`, and asserts the banner displays both the copy and the commit context.

### NIT

- **Track A**: `apps/cli/src/runtime/build-info.generated.ts` is still in the diff (commit value updated to `8aaca9e`). The `--commit` flag in `scripts/generate-build-info.ts` is the right tool; a pre-commit hook or CI check that rejects manual edits to generated files would prevent recurrence.
- **Track B**: The `APPLY_AGENT_IDS` const at `prompt-generation.ts:254-258` is a hardcoded list. If a new apply agent is added (e.g., `apply-mobile`), the list must be updated manually. A `DeveloperTeamAgent` predicate or a tag on the agent definition would be more maintainable.
- **Track B**: The integration test "apply agents without authorization have static placeholder only" (prompt-generation.test.ts:569-580) asserts the static marker comment is present, but does not assert on the Self-Rejection Instruction's "always refuse" language. A regression that removes the Self-Rejection Instruction entirely would pass the test.
- **Track B**: The `composeApplyAgentPromptWithAuth` JSDoc (prompt-generation.ts:458-473) mentions "the orchestrator" calling it but does not name a specific call site. A reader who reaches this function via `rg` will not find any caller in the codebase.
- **Track B**: The repair R5 added only a single import line to `developer-team-install.test.ts` (the import) but no test. Future maintenance of the authorization option would benefit from at least one direct install-time test.

## Design Fidelity

**Aligned**: Yes.

- **Fixed (this round)**: M1 install-time caller plumbs authorization end-to-end; R2 suggestion-text ternary is fixed.
- **Inner wiring**: Unchanged from Repair #4 — `buildPromptContent:295-298` calls `composeApplyAgentPrompt` when `isApplyAgent && authorization`.
- **Test coverage at the inner-function layer**: 6 new tests in `prompt-generation.test.ts:488-592` cover the path; orchestrator-invariants.test.ts:446-454 asserts on literal "INV-004"/"INV-006" strings in the BLOCKED case.
- **Carryover MINORs**: Install-time end-to-end test (new MINOR); `validateBuildInfoStaleness` not exported; Track A code-quality carryovers; adapter-wrapper layering rationale.

## Open Questions

- **Q1 (carried from Repair #4)**: Is the install-time call site expected to pass `authorization` in this change, or is the wired path reserved for a future "orchestrator-runtime composition" step? If the former, an end-to-end test (and possibly a production caller) is needed. If the latter, spec/Design should mark the install-time path as "advisory/static" and an ADR should record the constraint.
- **Q2 (new)**: The `composeApplyAgentPromptWithAuth` wrapper in `prompt-generation.ts:474-479` is still present. With the inner wiring (lines 295-298) proven correct, is the wrapper still needed? Or can it be removed and `composeApplyAgentPrompt` called directly from test files that need a string-based interface?
- **Q3 (carried)**: The 13 pre-existing test failures in Pi Runner / TUI screens (unrelated to this change) are not in scope. Should they be flagged as a follow-up cleanup, or left alone?

## Compliance Matrix Highlights (Re-Assessment)

| REQ-ID | Prior Status (Post-Repair #4) | Post-Repair-#5 Status | Notes |
|---|---|---|---|
| REQ-UD-001 to REQ-UD-004 | Met | Met | Unchanged. |
| REQ-UD-005, REQ-UD-007 | Met | Met | Banner copy branches by `reason`; reason flows end-to-end. |
| REQ-UD-008, REQ-UD-009 | Met | Met | `dev-build` reason preserved. |
| REQ-RM-001 to REQ-RM-003 | Met | Met | Commit normalization tests pass. |
| REQ-RM-004 | Met | Met | Generator captures HEAD; --commit override. |
| REQ-RM-005 | Met (logic), MINOR (no test) | **Met (logic), MINOR (no test, ternary FIXED)** | Staleness validation works correctly; 21/21 tests pass; suggestion-text ternary resolved. |
| REQ-OA-001 to REQ-OA-004 | Met | Met | Pre-Delegation Checklist + automatic-mode non-bypass text present and tested. |
| REQ-OA-005 | Partially met (MAJOR) | **Partially met (MINOR)** | Install-time caller plumbed end-to-end; inner-function tests prove the path; install-time end-to-end test missing (single test would close). Spec scenario "the prompt includes a compact invariant/authorization card referencing INV-004 and INV-006" is met at the wired layer and at the install-time caller layer when authorization is passed. |
| REQ-OA-006 | Met | Met | Unchanged. |
| REQ-OA-007, REQ-OA-008 | Met | Met | Gate/card renderers covered by tests. |
| REQ-OA-009 | Partial | **Partial** | Gate/card semantics are present in renderable surfaces; apply-agent prompt contains the gate text when `authorization` is passed. Install-time caller now plumbs the option but the caller is not directly tested. |
| REQ-OA-010 | Met | Met | Unchanged. |

## Registry Intent (registry-deferred mode)

| Field | Value |
|---|---|
| Registry Write | **deferred** |
| Artifact | `review-report.md` |
| Phase | `review` |
| Status | `approved_with_changes` |
| Event | `review-repair-5-approved-with-changes` |
| State path | `openspec/changes/fix-update-upgrade-and-orchestrator-invariants/state.yaml` |
| Events path | `openspec/changes/fix-update-upgrade-and-orchestrator-invariants/events.yaml` |
| Registry Blocker | none (intentionally deferred; Orchestrator should serialize) |

## Recommended Next Step

1. **Resolve M1 closeout MINOR (recommended)**: Add a single integration test in `developer-team-install.test.ts` that exercises the authorization option end-to-end (build plan with authorization → apply → read disk → assert card present). Estimated 30-40 lines. This closes the M1 test gap and can be batched with the existing MINOR carryovers.

2. **Address MINOR carryovers** (optional, can be batched into the same follow-up):
   - `validateBuildInfoStaleness` should be exported with a dedicated unit test.
   - Track A carryovers (dev-build heuristic, schema cast, release-check type cast, prefix-match redundancy).
   - Adapter-wrapper layering rationale for `composeApplyAgentPromptWithAuth`.
   - `developer-team-install.test.ts` authorization integration test (item 1 above).

3. **Update Spec/Design** (optional, only if Q1 is answered "static install-time path"): Add a note in spec.md REQ-OA-005 + acceptance scenario acknowledging the install-time vs runtime gap; add an ADR.

After (1) and (2) are resolved (or batched into a follow-up change), this change can proceed to Archive. The M1 MAJOR is now MINOR; the R2 ternary is fixed. The remaining items are stylistic and can be deferred.

**The critical judgment for the user**: M1 is **substantively downgraded from MAJOR to MINOR (closed-but-not-end-to-end-tested)**. The install-time caller at `developer-team-install.ts:537-545` now plumbs `authorization` end-to-end (developer-team-install.ts → prompt-generation.ts → composeApplyAgentPrompt → renderDelegationGate + renderApplyAuthorizationCard). The card text references INV-004 and INV-006 (orchestrator-invariants.ts:403, 410; literal strings asserted at orchestrator-invariants.test.ts:446-454). The 6 inner-function integration tests at `prompt-generation.test.ts:488-592` prove the wired path produces the correct prompt text. The self-rejection paradox is now reachable at the install-time layer (when a caller passes authorization). The R2 carryover suggestion-text ternary is fixed (prepare-release.ts:675). The remaining gap is a single end-to-end test at the install-time caller layer — a small MINOR that can be batched into a follow-up. This change is ready to proceed to Archive, with the M1 closeout test optionally added before or after.

## Verification Artifacts

- **review-report.md**: `openspec/changes/fix-update-upgrade-and-orchestrator-invariants/review-report.md` (this file, replacing the prior review-report.md)
- **State/events**: not written (registry-deferred mode; Orchestrator serializes)
- **Runtime evidence (from verify-report.md + apply-progress.md Repair #5)**:
  - `bunx tsc --noEmit` — 0 errors in affected files (124 baseline errors elsewhere, pre-existing)
  - `bun run build:dry-run` — pass
  - `bun test packages/adapter-opencode/src/prompt-generation.test.ts` — 37/37 (includes 6 auth-injection tests)
  - `bun test packages/adapter-opencode/src/developer-team-install.test.ts` — 96/96 (per apply-progress.md line 517; does not exercise authorization)
  - Focused test set (orchestrator/apply-content/auth) — 306/306
  - Prepare-release tests — 21/21
