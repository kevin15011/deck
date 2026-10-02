# Installation activity indicator

## Intent and acceptance

Runner installation screens must visibly signal ongoing work even when no new action result arrives. Add a lightweight cycling console icon and processing text in the shared Ink install-progress screen. Preserve real result counts and diagnostics; do not imply percentage progress or guarantee subprocess health. Stop the timer when the screen finishes/unmounts and retain activity while cancellation waits for the active command.

## Scope and routing

Apply Fast owns the complete component/test slice. Lead owns OpenSpec. Use React/Ink with no new dependency; all runners using the shared dashboard receive the indicator. Current source was inspected directly after stale graph discovery and coverage (generation 2026-08-20, screen metadata changed, tests excluded). Previous runner-label cleanup remains a separate pending change.

Direct lifecycle inspection at app.tsx1700-1767 found that unexpected installation rejection only logged an error and left install-progress mounted. Scope includes a bounded catch-path repair to publish terminal failure and transition to the completion screen, so the new activity signal cannot remain active after that failure. Cancellation remains active until the command actually stops; no retries are introduced.

## Verification

Deterministic live-Ink tests demonstrated RED then GREEN for frames changing without action-result updates, continued activity during cancellation, and timer cleanup on unmount/success/failed completion. All 43 focused progress/dashboard/install rendering tests passed. Rebuilt and installed the current-worktree canary. The unexpected application rejection handler was directly reviewed, but its actual adapter-rejection route has no dedicated fault-injection test; failed-screen cleanup is tested. Initial typechecking found test-stream casts needed an explicit unknown conversion; final TypeScript verification passed. No commit made.
