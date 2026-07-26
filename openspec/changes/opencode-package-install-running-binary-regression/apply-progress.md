# Apply Progress — `opencode-package-install-running-binary-regression`

## T1 RED Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/model-discovery-context.test.ts`
- Exit status: `1`
- Result: `0 pass`, `1 fail`, `1 error`; `Ran 1 test across 1 file.`
- Failure anchor: `SyntaxError: Export named 'enumerateOpenCodeConfigCandidates' not found in module '/home/kevinlb/deck/packages/adapter-opencode/src/model-discovery-context.ts'.`
- Scope at RED: only the T1 test assertions were added; no T1 production edit had been made.

## T1 GREEN Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/model-discovery-context.test.ts`
- Exit status: `0`
- Result: `10 pass`, `0 fail`, `31 expect() calls`; `Ran 10 tests across 1 file.`
- Verification: `git diff --check` exited `0` with no output.
- Implementation evidence: `model-discovery-context.ts` now exports the pure candidate enumerator and JSONC parser; collection consumes the enumerator without a second config scanner/parser.

## T2 RED Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts`
- Exit status: `1`
- Result: `0 pass`, `3 fail`, `1 error`, `2 expect() calls`; `Ran 3 tests across 2 files.`
- Failure anchors: `SyntaxError: Export named 'resolveOpenCodeInstalledEvidence' not found in module '/home/kevinlb/deck/packages/adapter-opencode/src/required-tools.ts'.`; declaration inventory expected `false` but received `true`; usable-evidence inventory expected `true` but received `false`.
- Scope at RED: only T2 assertions and the new inventory test were added; no T2 production edit had been made.

## T2 GREEN Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts`
- Exit status: `0`
- Result: `10 pass`, `0 fail`; `Ran 10 tests across 2 files.`
- Affected verification: `bun test packages/adapter-opencode/src/model-discovery-context.test.ts packages/adapter-opencode/src/runner-capabilities.test.ts` exited `0` with `35 pass`, `0 fail`; `Ran 35 tests across 2 files.`
- Verification: `git diff --check` exited `0` with no output.
- Implementation evidence: strict evidence states/sources/reasons are resolved from shared local config and injected executable checks; inventory readiness consumes only usable evidence for command-backed capabilities and leaves internal plugin compatibility intact.

## T3 RED Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/install-tools.test.ts`
- Exit status: `1`
- Result: `8 pass`, `6 fail`, `24 expect() calls`; `Ran 14 tests across 1 file.`
- Failure anchors: new outcome assertions received `undefined`; concurrent single-flight expected `1` effect but received `2`; cancellation expected `skipped` but received `undefined`.
- Scope at RED: only T3 test assertions were added/isolated; no T3 production edit had been made.

## T3 Supplemental RED Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/install-tools.test.ts`
- Exit status: `1`
- Result: `18 pass`, `1 fail`; `Ran 19 tests across 1 file.`
- Failure anchor: per-package isolation expected `["failed", "executed"]` but received a failed result for the unrelated second package because the injected evidence fixture returned the first tool's ID.
- Scope at supplemental RED: the extended duplicate/isolation/bounds/download/cancellation assertions were added; no production edit followed this supplemental RED yet.

## T3 GREEN Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/install-tools.test.ts`
- Exit status: `0`
- Result: `19 pass`, `0 fail`; `Ran 19 tests across 1 file.`
- Affected verification: `bun test packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts` exited `0` with `10 pass`, `0 fail`; `Ran 10 tests across 2 files.`
- Verification: `git diff --check` exited `0` with no output.
- Implementation evidence: package outcomes are discriminated and single-flight/rechecked; raw captures are non-enumerable and bounded; sanitizer and inert v0.9.0 text coverage preserve truthful installer failure without process/network operations in tests.

## T4 RED Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/runner-adapter.test.ts`
- Exit status: `1`
- Result: `8 pass`, `3 fail`, `50 expect() calls`; `Ran 11 tests across 1 file.`
- Failure anchors: project-scope review captured `[]` instead of `[`/tmp/t4-project`]`; direct already-present action returned `Tool codebase-memory is already installed or not available.` and no safe outcome projection; injected failure mapped to `skipped` instead of `failed`.
- Scope at RED: only T4 assertions were added; no T4 production edit had been made.

## T4 GREEN Evidence (immutable)

- Command: `bun test packages/adapter-opencode/src/runner-adapter.test.ts`
- Exit status: `0`
- Result: `11 pass`, `0 fail`; `Ran 11 tests across 1 file.`
- Affected backend verification: `bun test packages/adapter-opencode/src/model-discovery-context.test.ts packages/adapter-opencode/src/required-tools.test.ts packages/adapter-opencode/src/capability-inventory.test.ts packages/adapter-opencode/src/install-tools.test.ts packages/adapter-opencode/src/runner-adapter.test.ts` exited `0` with `50 pass`, `0 fail`; `Ran 50 tests across 5 files.`
- Verification: `git diff --check` exited `0` with no output.
- Implementation evidence: direct adapter review/installer paths carry `RunnerActionContext.projectRoot`, preserve the Core status union, map package outcomes exactly, and project only bounded structured diagnostics without raw streams.

## Final Backend Apply Checks (immutable)

- `bunx tsc --noEmit`: exit `0`, zero TypeScript diagnostics.
- Final affected backend test set (T1–T4): `50 pass`, `0 fail`; `Ran 50 tests across 5 files.`
- Final `git diff --check`: exit `0`, no output.
- Serena diagnostics: no severity-1 diagnostics reported for the five modified production source files.
- Additional scheduled affected checks: `bun test packages/adapter-opencode/src/runner-capabilities.test.ts packages/adapter-opencode/src/context-mode-integration.test.ts` exited `0` with `30 pass`, `0 fail`; `Ran 30 tests across 2 files.`
- Post-sanitizer finalization: the five-file T1–T4 backend set remained `50 pass`, `0 fail`; `bunx tsc --noEmit` exited `0` with `0` TypeScript errors; `git diff --check` exited `0`.

## Changed-Path and Prohibition Audit (immutable)

- Batch target status is limited to the ten authorized source/test targets, the newly created `capability-inventory.test.ts`, and this evidence file. No TUI target was changed by this batch.
- The worktree contained unrelated pre-existing changes outside this allowlist; they were preserved and not discarded.
- No `HOME`/`PATH` assignment occurs in the batch tests. No process enumeration, signaling, binary staging/replacement, retry loop, lock/dependency/generated/registry edit, or `runner-capability-standardization` path was added.
- The only `pgrep` text is the inert v0.9.0 diagnostic fixture and the generic sanitizer keyword list; neither is invoked. The only installer network string is the existing production `curl` seam, and all automated tests inject download/shell effects.
- Official Spec/Design/Tasks/state/events digests remained equal to the supplied immutable bases.

## T5 RED Evidence (immutable)

- Command: `bun test apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`
- Exit status: `1`
- Result: `7 pass`, `4 fail`, `18 expect() calls`; `Ran 11 tests across 1 file.`
- Failure anchors: already-present remained a generic executed result without `packageOutcome`; missing/unknown/duplicate package IDs were accepted as executed or generic failure instead of integrity failures; hostile diagnostic fixture reached action results without the required bounded string projection.
- Scope at RED: T5 contract assertions and rich-result test fixtures were added/updated only; no T5 production edit had been made.

## T5 GREEN Evidence (immutable)

- Focused command: `bun test apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts` exited `0` with `11 pass`, `0 fail`, `35 expect() calls`; `Ran 11 tests across 1 file.`
- Affected action-runner verification: `bun test apps/cli/src/tui/runner-dashboard/action-runner.test.ts` exited `0` with `12 pass`, `0 fail`, `58 expect() calls`; `Ran 12 tests across 1 file.`
- Typecheck: `bunx tsc --noEmit` exited `0` with zero TypeScript diagnostics.
- Verification: `git diff --check` exited `0` with no output; Serena reported no diagnostics for `app.tsx` or `action-runner.ts`.
- Implementation evidence: OpenCode results are projected by exact `toolId`, safe package outcomes map to the unchanged local status union, integrity-invalid results fail closed, only matching unsatisfied capability dependents are gated, and raw captures are excluded from callbacks/state while bounded safe diagnostics remain available.

## T6 RED Evidence (immutable)

- Command: `bun test apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`
- Exit status: `1`
- Result: `16 pass`, `4 fail`, `60 expect() calls`; `Ran 20 tests across 1 file.`
- Failure anchors: progress/completion views omitted action IDs and inline causes; the six-result progress fixture preserved final-five slicing but did not identify results. The direct hostile-cause fixture also confirmed that renderer projection was not yet sanitizing the display boundary.
- Scope at RED: T6 render assertions and fixture helper support were added only; no T6 production edit had been made.

## T6 GREEN Evidence (immutable)

- Focused command: `bun test apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` exited `0` with `20 pass`, `0 fail`, `72 expect() calls`; `Ran 20 tests across 1 file.`
- Affected render verification: `bun test apps/cli/src/tui/runner-dashboard/render.test.tsx` exited `0` with `7 pass`, `0 fail`, `26 expect() calls`; `Ran 7 tests across 1 file.`
- Typecheck: `bunx tsc --noEmit` exited `0` with zero TypeScript diagnostics.
- Verification: `git diff --check` exited `0` with no output.
- Implementation evidence: existing progress/completion views retain final-five/failed-result composition, render action identity with symbols and stable text, show one bounded indented cause, explicitly preserve already-present installer-not-run wording, and do not add screen state, panel, modal, key binding, or diagnostic dump.

## Final Frontend Apply Checks (immutable)

- `bun test apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts`: exit `0`; `11 pass`, `0 fail`, `35 expect() calls`; `Ran 11 tests across 1 file.`
- `bun test apps/cli/src/tui/runner-dashboard/action-runner.test.ts`: exit `0`; `12 pass`, `0 fail`, `58 expect() calls`; `Ran 12 tests across 1 file.`
- `bun test apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`: exit `0`; `20 pass`, `0 fail`, `72 expect() calls`; `Ran 20 tests across 1 file.`
- `bun test apps/cli/src/tui/runner-dashboard/render.test.tsx`: exit `0`; `7 pass`, `0 fail`, `26 expect() calls`; `Ran 7 tests across 1 file.`
- `bunx tsc --noEmit`: exit `0`, zero TypeScript diagnostics.
- `git diff --check`: exit `0`, no output.
- Changed-path/prohibition audit: no generated/dependency/lock/registry YAML target, `runner-capability-standardization` path, process-operation token, network/live-home fixture, binary staging/replacement, retry, or implicit-upgrade addition in the frontend batch. Existing unrelated worktree changes and pre-existing OpenSpec `state.yaml`/`events.yaml` were preserved and not edited.
- Serena provenance: `serena_initial_instructions` was loaded before inspection; Serena symbolic retrieval/replacement/insertion was used for the T5/T6 production symbols and test additions; no severity-1 diagnostics were reported for the five frontend source/test targets.
- Code-economy note: the required layered defense-in-depth sanitizer and deterministic render/contract fixtures add the design-estimated validation surface; no dependency or unrelated abstraction was introduced.
