# Exploration: Canonical Deck-Managed Session Runtime

## Existing production architecture

- OpenCode and Codex production commands already use `apps/cli/src/runner-launch-command.ts::runRunnerLaunch`.
- That generic path already owns inspection, plan/consent, install/verification, Deck session resolution, one `SupermemoryRuntimeHost`, authenticated loopback, ephemeral environment injection, spawn/signal handling, capture, and bridge cleanup.
- Pi still routes through `runPiLaunch` and a separate spawn/close path in `main.tsx`; this is the principal lifecycle divergence.
- `runOpenCodeLaunch` is legacy/test-only and has no production caller.
- The TUI currently configures, installs, reviews, and diagnoses; it does not launch runners.
- The runtime host already rejects runner-supplied scope, authenticates and validates events, persists native session mappings, suppresses replay after success, and drains in-flight work before shutdown.

## Gaps

1. Managed execution exists but is not formalized as the canonical product topology.
2. Runtime host construction currently occurs before dry-run/install-only exit and must move behind executable-launch readiness.
3. Concurrent duplicate events require in-flight coalescing in addition to replay-after-success.
4. Pi duplicates runtime/process lifecycle ownership.
5. Static readiness, managed readiness, active runtime, and intentional standalone degradation are not represented consistently in Setup, Doctor, capability declarations, TUI, guidance, and docs.
6. The everyday TUI path lacks a direct handoff to the already configured managed launcher.

## Smallest safe route

Formalize the existing generic launch as a minimal CLI-local Session Runtime lease, prove OpenCode end-to-end, add truthful readiness/presentation, and then translate Pi onto the same lifecycle. Do not create another host, launcher, daemon, or runner-autobootstrap mechanism.
