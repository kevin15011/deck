# Apply progress

## Recovery after interruption

The original apply task was interrupted without a final report. On the user's request to resume, Lead inspected its state, requested cancellation, and took ownership of the existing candidate rather than restarting implementation. Elapsed task age is not evidence of continuous computation. No success claim relies on the interrupted delegate's activity log.

Preserved unrelated changes: .serena/project.yml, openspec/changes/release-v0-10-0/working-brief.md, and untracked .bun-cache/.

## Recovered candidate

Deck adds only three opt-in proof files under apps/cli/src: pi-client-proof.ts, pi-client-proof.test.ts, pi-client-proof.native.test.ts. No existing production source file was changed by this slice. The source-level driver reuses runRunnerLaunch and adapts the final launch transport to Pi RPC; this is not an installed Deck CLI command or stable public API.

The separate deck-ui/proof client uses an owned stdio channel. No browser listener or application authentication exists. Native persisted deck-subagents-v1 entries provide task identities; this is an internal proof dependency, not a stable web event API.

## Lead verification on recovery

- `bun test apps/cli/src/pi-client-proof.test.ts`: 5 passed, 0 failed, about 0.8 s. Mutation consent, framing, command allowlist, writer failure and drain deadline.
- From deck-ui, `bun test proof/client.native.test.ts`: 1 passed, 0 failed, about 10.7 s. Actual Deck source driver, native Pi lead, native Deck-managed child, structured task evidence and integration.
- `bun test apps/cli/src/pi-client-proof.native.test.ts`: 4 passed, 0 failed, about 32 s. Integrated outcome, child failure, controller EOF and malformed input; native execution-lease settlement checked.
- Fixtures use a deterministic local faux model provider and temporary roots, not a real model/MCP service. Provider reasoning/quality and enabled memory-provider behavior are not verified by these fixtures.
- Client TypeScript check was stopped at a 15-second bound (exit 124); it is incomplete, not passed or diagnosed as a type failure. No blind retry was performed.
- Host Bun reports 1.4.0 while Deck pins 1.3.12. No installation/update was performed. Linux was exercised; macOS and pinned-runtime verification remain outstanding.

## Remaining work

The bounded independent review is integrated. Lead reproduced and repaired hidden preparation previews/blocked reasons with a red-to-green regression. Both separate-client tests pass. A narrower client-only strict typecheck also passed; the broad harness-inclusive check remains incomplete. See verify-report.md and review-report.md. Functional feasibility is demonstrated; full GUI, project library, compatibility certification and deployment remain out of scope.
