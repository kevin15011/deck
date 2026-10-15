# Keep degraded runners available in session model discovery

## Intent and acceptance

New-session runner selection must follow the existing host compatibility policy: blocked probes reject execution; degraded probes permit operation with diagnostics. Newer-than-tested runner versions must not be mislabeled unavailable when native model discovery succeeds. Preserve blocked probes, model readiness checks, and secret-safe failure handling. Do not change tested-version claims.

## Evidence and decision

Local read-only probes reproduce Claude 2.1.301 and OpenCode 1.19.1 as degraded with version-untested reasons. `apps/cli/src/session-model-catalog.ts` rejects every non-ready probe. `packages/session-host/src/session-manager.ts` allows degraded probes at creation, preparation, assignment validation and execution, recording diagnostics. `openspec/changes/cross-runner-session-core/design.md` and the support matrix document continued operation for newer versions. Align the catalog with that existing policy.

Graph `deck`, generation `2026-08-20T17:25:00Z`, lacks current coverage for the relevant files; evidence uses targeted current source. This is a discovery-policy bug fix, not a runner release certification.

## Progress

- Implemented catalog gating change: reject only blocked probes, retaining model-discovery readiness and sanitized failures. Regression RED reproduced both degraded runners being hidden; focused GREEN passed 5 tests.
- Pinned Bun 1.3.12, repository preload, configured 30-second test timeout: catalog plus session manager suites passed 129 tests, 572 assertions. Initial invocation with Bun's default 5-second timeout timed out on the large completion batch test; the configured-timeout run passed. `git diff --check` passed.
- Read-only production discovery found Claude (9 models) and OpenCode (84 models) available with installed 2.1.301 and 1.19.1 respectively. No provider prompt or session task was sent.
- Built and installed updated `deck-canary`. Checked idle daemon state, then used the supported graceful `deck-canary daemon restart --json`; restart succeeded and retained state. Queried `runners.models` from the restarted daemon for the registered project: both runners available with the same model counts. Stable binary unchanged; the running daemon now uses the patched canary.
- Preserve previous Claude global-install fix and unrelated Pi proof work.
