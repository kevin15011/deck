# Working Brief: Prevent Serena Dashboard Auto-Launch

## Intent

Prevent Deck-managed Serena MCP startup from opening a browser window whenever OpenCode, Pi, or Codex starts, while preserving Serena's MCP and dashboard capabilities.

## Acceptance

- Canonical Serena MCP arguments include `--open-web-dashboard false`.
- OpenCode, Pi, and Codex materialization paths use the canonical arguments.
- Existing Serena bootstrap, authorization, executable validation, and project-from-CWD behavior remain unchanged.
- Regression tests prove generated runner configurations suppress automatic browser opening.
- Previous Deck-generated OpenCode and Pi commands are upgraded idempotently when Serena configuration is explicitly reapplied, without changing unrelated MCP entries.
- The release is published as `v0.4.2`.

## Decisions

- Keep the Serena web dashboard enabled; disable only automatic browser opening.
- Define the behavior once in `SERENA_MCP_ARGS` and reuse it instead of duplicating runner-specific argument lists.
- Treat removal of the obsolete raw Supermemory MCP entry from the user's current OpenCode configuration as an explicit user-authorized local repair, not as part of this release's Serena behavior change.

## Non-Goals

No Serena package upgrade, dashboard removal, Supermemory runtime change, automatic deletion of arbitrary user-owned MCP entries, or broader runner lifecycle redesign.

## Evidence

- The installed Serena CLI documents `--open-web-dashboard false` as the supported way to prevent browser launch.
- The live OpenCode MCP configuration previously launched Serena without that flag and reproduced the unwanted browser opening.
- Focused Serena regression tests, TypeScript checking, and `git diff --check` passed on the implementation candidate.
- Exact previous-version OpenCode and Pi configuration fixtures prove canonical migration, preservation of unrelated entries, and idempotency.
- The complete Bun 1.3.12 suite passed with 4,887 tests, 2 skipped, and 0 failures; TypeScript validation passed.
- Release descriptor and preparation tests passed with 64 tests and 0 failures.
- DeckMemoryBench passed all 13 scenarios with no failures, and the compiled runtime smoke passed for every release target.
- The signed `darwin-arm64` dry-run build produced `deck_v0.4.2_darwin-arm64.tar.gz` with SHA-256 `5405da7fdfa91cd8b11376af0ce84341a7daf29899b04bfda68927f52bf39d72`.
- The obsolete raw Supermemory MCP entry was removed from the current OpenCode configuration; `opencode mcp list` no longer reports it, and Deck-managed project recall still succeeds.

## Status

Implemented, independently reviewed with a GO result, and release-verified. Publication is in progress.
