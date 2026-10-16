# Codex resume history frame limit (2026-10-16)

## Intent and evidence

Restore native continuation of long Codex subagent conversations. A daemon recovery can expose the failure by requiring thread/resume, but restart is neither necessary nor sufficient: a small native task continued successfully after recovery.

Investigation task-236fd6b7-fbdc-4b6f-8efb-4e5228f2300c reproduced the failure with an isolated copy of the affected rollout and Codex app-server 0.162.1. The full resume response measured 1,050,693 bytes, exceeding the adapter's 1,048,576-byte NDJSON frame bound. An earlier copied history measured 1,006,444 bytes and passed. Setting excludeTurns:true reduced the full-history response to 4,532 bytes and passed the real CodexRpc parser. Original historical raw responses were not retained; the historical cause is inferred from this reproduction and matching diagnostics.

## Decision and acceptance

- Request excludeTurns:true only on thread/resume. The driver consumes thread.id and does not need historical turns to continue.
- Keep the 1 MiB frame bound; increasing it would only postpone failure as history grows.
- Preserve safe internal frame errors in diagnostics and failed outcomes. Never persist raw native errors, frames, stderr, or conversation content.
- Preserve new-thread behavior, missing-native-session classification, cancellation, and process draining.
- Verify with deterministic regression tests before and after the change and the relevant Codex adapter suite.

## Scope and status

Implementation owner: apply-fast task-a6774c1b-5cdd-4cb8-8042-88cc31e5b8c0, attempt 4. Implemented in packages/adapter-codex/src/session-driver/{driver.ts,driver.test.ts,rpc.ts,rpc.test.ts}. Source inspection is authoritative; graph tooling was unavailable.

## Verification result

Completed. Resume now excludes turns, and typed internal framing errors survive both diagnostic and outcome paths. An exact internal startup-code allowlist replaces arbitrary codex-prefixed message persistence. Tests cover new-thread omission, large-history continuation, oversized frames during startup and running, split frames, safe malformed-JSON handling, unknown errors, and process draining.

- Owner's RED run: 83 passed, 8 failed before implementation.
- `bun test packages/adapter-codex/src/session-driver`: 109 passed, 0 failed.
- Lead's `bun test packages/adapter-codex`: 309 passed, 0 failed, 9,130 assertions across 27 files (484.03 seconds). Log: /tmp/codex-resume-adapter-tests.log.
- `git diff --check`: passed.

No live native resume was repeated after implementation; the native protocol evidence above plus deterministic driver/RPC regressions support the fix. No installation, daemon restart, commit, or publication occurred. The running daemon must be updated to this code before the fix takes effect there.
