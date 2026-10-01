# Working Brief: Fix TUI Exit and Rollback Menu Alignment

## Intent

Ensure the Deck TUI renders the same backup-aware home menu that it uses for cursor handling and action dispatch, so selecting the visible `Exit` row exits instead of opening rollback confirmation. Remove the duplicated version prefix from rollback confirmation copy.

## Acceptance

- When a restorable backup exists, the home screen visibly includes `Roll back Deck` before `Exit`.
- The cursor index displayed on `Exit` resolves to the `exit` action.
- Rollback confirmation renders a single `v` prefix for the target version.
- Existing rollback behavior and release-check rendering remain unchanged.

## Targets

- `apps/cli/src/tui/app.tsx`
- `apps/cli/src/tui/screens/home-screen.tsx`
- `apps/cli/src/tui/screens/rollback-screen.tsx`
- Focused TUI regression tests

## Evidence

- RED: focused tests reproduced both defects with 2 failures: the rendered home menu omitted the available rollback row while action dispatch included it, and confirmation rendered `vv1.1.0`.
- GREEN: `bun test apps/cli/src/tui/screens/home-screen.test.tsx apps/cli/src/tui/screens/rollback-screen.test.tsx apps/cli/src/tui/__tests__/tui-integration.test.tsx` passed with 41 tests and 0 failures.
- TypeScript: `bunx tsc --noEmit` passed.

## Status

Implemented and focused verification passed.
