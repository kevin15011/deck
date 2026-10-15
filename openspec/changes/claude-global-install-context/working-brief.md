# Claude global installation independent of project context

## Intent and acceptance

The Claude TUI must install global Deck-owned plugin files from any working directory. Project identity and project-specific memory credential/override validation belong to session launch, not global installation. Preserve global artifact integrity, shared-profile configuration checks, and all launch protections. Report actionable, bounded reasons for actual review blockers without exposing caught exception content or secrets.

## Evidence and decisions

- The reported review computes 836 desired files but blocks with a generic conflict message.
- `packages/adapter-claude/src/runner-adapter.ts` currently requires verified project identity and successful project-specific credential resolution in `buildReviewPlan`.
- The TUI supplies project root and identity correctly. The local canonical identity resolver rejects the SSH `HostKeyAlias` directive. This demonstrates why a project check can incorrectly prevent a global install; SSH policy changes are outside this fix.
- Graph project `deck`, generation `2026-08-20T17:25:00Z`, is stale for this area. Coverage reports untracked/changed metadata; current source and hermetic tests are the evidence authority.
- Use a bounded adapter fix with regression tests and independent review of the installation/launch boundary. No generated files, user credentials, SSH settings, or stable binary are modified.

## Progress

- Removed project identity and project credential resolution from global review; removed canonical identity from the team installation plan. Launch identity, tag, credential and override validation remain unchanged.
- Actual blockers now use fixed, bounded messages instead of repeating the preview or exposing arbitrary exception text.
- TDD: both review and direct-plan regressions failed before their fixes. Pinned Bun 1.3.12 with repository preload: adapter suite 28 passed; expanded apply/launch regressions 2 passed. Configured shared preflight, install contract and TUI integration gates: 64 passed, 0 failed. `git diff --check` passed.
- Restored missing workspace dependencies with pinned Bun and `install --frozen-lockfile`; no lockfile change.
- Compiled and installed `/home/kevin15011/.local/bin/deck-canary`; version smoke passed (0.11.2, dev, linux-x64). Stable `deck` remains unchanged. Existing installer argument parsing rejects the npm-provided `bun.exe` basename, so the exported `installCanary([])` entry point was used with the pinned runtime.
- Independent boundary review passed with no blocking findings: launch identity/credential gates and private artifact checks remain enforced; diagnostics contain fixed literals only. No live Claude session or real plugin installation was performed for verification.
- Existing unrelated Pi client proof work is preserved.
