# Environment selection copy

## Outcome

Show neutral runner names in the first environment selection screen: Pi, OpenCode, Claude Code, and Codex. Remove the hardcoded Pi recommendation, repeated Development suffixes, and Claude implementation note from selectable labels. Keep actual support boundaries in the relevant setup/dashboard diagnostics rather than the option name.

## Scope

Adapter UI environmentLabels and the existing Claude selection render assertion. Selection IDs, availability, ordering, capabilities, and installation behavior remain the existing implementation. These adapter labels may also appear in package configuration context. Parent inspected the current TUI consumer directly; the stale graph generation 2026-08-20 does not establish current completeness. Lead owns this artifact; Apply Fast owns the copy/test changes.

## Verification

Apply Fast's existing Claude synthetic production-flow test passed (1 test, 9 assertions), including the revised selection label and subsequent setup flow. git diff --check passed. Rebuilt and installed the current worktree's canary. Prior sandbox command simplification was committed separately as f47cf9b. The UI copy changes remain uncommitted for the ongoing TUI iteration.
