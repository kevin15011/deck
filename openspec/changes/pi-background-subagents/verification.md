# Verification

## Current Lead-only candidate — 2026-10-04
**PASS: 1,141 tests, 0 failures, 5,055 assertions across 88 files (209.57s).** This supersedes earlier readiness claims and the incident's failing combined run. Lead implemented and verified this recovery without delegating to subagents.

Runtime: pinned Bun 1.3.12 (700fc117), Node v24.19.0, native Pi 1.0.0. Generated all Pi extension bundles through the repository generator. Root `tsc --noEmit` and `git diff --check` pass. Git diff confirms no changes to core, adapter-opencode or adapter-codex.

Final command:
```bash
/tmp/bunx-1000-bun@1.3.12/node_modules/.bin/bun test packages/adapter-pi \
  apps/cli/src/pi-memory-token-handoff.test.ts apps/cli/src/supermemory-runtime-host.test.ts \
  apps/cli/src/pi-launch-command.test.ts apps/cli/src/supermemory-runtime-host.explicit-tools.test.ts \
  apps/cli/src/pi-launch-command.supermemory.test.ts apps/cli/src/pi-memory-launch.test.ts \
  apps/cli/src/pi-launch-command.direct-supermemory.test.ts apps/cli/src/runner-launch-command.test.ts \
  apps/cli/src/tui/__tests__/pi-background-install.test.tsx scripts/generate-pi-extension-assets.test.ts
```
Ephemeral execution logs: `/tmp/deck-lead-final.log`, `/tmp/deck-lead-typecheck.log`.

### New behavior evidence
- `completion.test.ts`: terminal UI/storage exception isolation, no report text in wakes, burst coalescing, exact-session restore, three bounded admission attempts, one follow-through reminder, review-before-integration, blocked resolution reopening, obsolete-attempt callback/outcome fencing, and rejection rollback without ghost jobs.
- `scheduling.native.test.ts`: actual Pi/faux-provider review -> validation tool -> outcome resolution -> one synthesis, without user nudges. Includes idle notification failure, an acknowledgement-only reply, two simultaneous children during a text response and during Lead tool work. The busy-tool duplicate synthesis was reproduced RED (two finals), then fixed using native agent_settled and natural-context admission.
- `interactive.native.test.ts` plus the PTY fixture: real interactive Pi in fullscreen and regular modes, isolated HOME/config and offline scripted provider. Only one user message is submitted before automatic integration/synthesis. Page scrolling and unsent editor text survive completion; the text submits unchanged afterward; minimization works and regular mode gets no floating overlay.
- `panel.native.test.ts`: native viewport anchor, focus, resize/editor fallback, whole bounded blocks, meaningful stages, short titles, integration/delivery states, frozen completed clock and independent live clock updates without forced rendering.
- `transport.test.ts`, shell/native/policy tests: JSON IPC proof under allocation pressure, spoof rejection, native Linux Bash completion/cancellation/timeout/failure settlement, structured reason/signal, exact-history continuation and no read-only/PowerShell escape.
- Memory native/unit contracts: reload preserves tools with scrubbed credentials; custom continuation retains exact-parent advisory ephemerally, without duplicate injection/provider recall/raw-child capture or session persistence. The integration regression after moving to settled-boundary scheduling was reproduced and repaired.
- Full adapter plus CLI/host/TUI checks cover normal Review & Install delivery, Node loading and source-digest freshness. No personal installation was performed.

### Current limits
The host guarantees tracking, bounded scheduling and visible pending/blocker state, not arbitrary model judgment or validation quality. No live-provider/network-resilience trial or human visual acceptance across terminal emulators. Shell ownership proof remains Linux/system Bash only; unsupported/uncertain execution fails closed. No daemon, arbitrary persisted-PID cleanup, remote-effect rollback or automatic replay. No release, commit, or personal installation/configuration change. The installed live session remains on its installed revision until the usual build/install/restart flow.

---
# Historical initial verification (not current readiness)
## Status
Passed with documented platform and visual-evidence limits. Repository candidate only; not installed or released.
## Final Lead-run checks
1. `bun test packages/adapter-pi/src apps/cli/src/tui/__tests__/pi-background-install.test.tsx apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts scripts/generate-pi-extension-assets.test.ts`
   - 1,019 passed, 0 failed; 4,055 assertions across 77 files; 108.26 seconds.
   - Ephemeral full log: /tmp/deck-pi-background-final.log.
2. `bun x --no-install tsc --noEmit`: passed after final implementation.
3. `git diff --check`: passed.
## Behavior evidence
- Background acceptance returns before unfinished children; four shared slots and bounded records.
- Native Pi follow-up scheduling exercises idle and active Lead notification without interrupting conversation.
- Exact parent/session history and explicit continuation, no new-session adoption/auto-resume, duplicate exclusion, role changes and missing/symlinked history refusal.
- Native navigation regression exercises pending-summary exclusion and cancelled-navigation recovery.
- Linux abrupt-death/exclusive ownership fence and redirected shell descendant cleanup.
- Materialized Pi package invokes supported native child-only Bash tool operations; normal completion, cancellation, timeout, role restrictions and same-history eligibility are tested using faux providers and temporary config.
- Native fullscreen renderer exercises conversation scroll, non-capturing input, resize/editor fallback and sticky minimization; regular mode has no overlay.
- Existing Review & Install Run install action materializes the updated extension in a temporary installation; generated assets are fresh and load under Node.
## TDD and independent review
Owner supplied RED/GREEN regressions for lifecycle/redaction/panel fixes, delayed navigation, and native child shell composition (four initial failures to four passes). Final independent Quality review returned GO for repaired process, lease, activation/materialization and navigation boundaries. Quality reviewed current source/tests without rerunning shell commands; final test execution above is Lead evidence.
## Native UI support decision
Initial native renderer probe showed regular terminal-owned scrollback cannot support an anchored overlay. User explicitly approved fullscreen anchored panel with compact regular fallback. No setting is changed automatically.
## Limits
No live-provider/network resilience exercise, macOS/Windows shell containment proof, real personal installation, or full InteractiveMode/PTY/human visual acceptance. Tests demonstrate native renderer and runtime contracts, not all terminal emulators. Supported recovery is conservative and documented; uncertain ownership and unsupported shells/platforms are refused. Complete repository-wide tests outside the affected adapter/TUI boundary were not run.

## Post-install panel delta — 2026-10-04
The user explicitly reauthorized delegation after reinstall/restart. Apply Fast implemented the compact colored role/time/state row and the subsequent active-only card refinement. Lead reviewed both current outcomes and resolved them as integrated after inspecting source and rerunning checks. Only running/cancelling jobs have individual cards; all other jobs appear in aggregate execution and Lead-disposition counts. No generic `+N more` remains. Four-slot display retains editor-safe fallback and native ANSI handling. Bundles were generated through the canonical script.

Lead's combined focused run: 65 passed, 0 failed, 436 assertions across panel native, real offline PTY, extension, asset freshness, canonical role content and Pi profile tests. Root TypeScript and whitespace checks passed. Prior lifecycle evidence above is baseline, not a new full lifecycle run. No personal installation or live-provider exercise was performed. The separately authorized Core skill-ownership policy is recorded in `../role-owned-skill-context/working-brief.md`; earlier no-Core-change statements apply to the historical recovery scope, not that new policy delta.

### Single-line colored counters follow-up
The user requested a single initial-based summary after reinstalling/restarting. The resulting panel uses C (completed) and I (integrated) in native success color, F (failed) in error color and B (blocked) in warning color. Nonzero actionable states retain distinct short indicators. Active cards are unchanged. When all indicators cannot fit safely, the overlay yields to the complete status fallback rather than silently dropping attention states. Counts still represent separate execution and integration dimensions.

Lead inspected the implementation and reran pinned Bun tests for `panel.native.test.ts`, `interactive.native.test.ts` and `scripts/generate-pi-extension-assets.test.ts`: 25 passed, 0 failed, 198 assertions across 3 files. `git diff --check` passed. Canonically regenerated bundles are included. This follow-up changes no lifecycle or Core behavior. No personal installation performed. The later discussion of possible Pi inspectors, context diagnostics and task controls is advisory ideation only; those features are not authorized or implemented by this delta.
