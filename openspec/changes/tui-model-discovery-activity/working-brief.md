# Model discovery activity feedback

## Intent

Extend the installation activity feedback to model configuration while Deck queries runner providers/models. A cycling ASCII indicator must remain visible even when discovery produces no intermediate updates and stop when loading transitions to ready/error or the screen unmounts.

## Scope

Shared React/Ink activity indicator reused by installation and OpenCode, Codex, Claude loading branches. Preserve discovery status semantics, retries, existing explanatory text and manual configuration flows. Do not invent asynchronous loading for synchronous Pi screens. Apply Fast owns the component/test slice; Lead owns this record. Parent graph generation2026-08-20 is stale; direct source reads after coverage define this scope.

## Verification

Nine new live-Ink lifecycle cases demonstrated RED before implementation; GREEN passed all 12 lifecycle tests including the three existing installation timer cases. Another 56 focused model/render/navigation tests passed (68 total). Tests cover frame changes without intermediate discovery updates and cleanup on ready/blocked/unmount; Retry/Back remain available. Final TypeScript and git diff --check passed. Rebuilt and installed canary from the active worktree. No commit requested for this iteration.
