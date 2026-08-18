# Design: Canonical Deck-Managed Session Runtime

## Current composition

- `runRunnerLaunch` already provides the production supervised process path for OpenCode and Codex: inspect, plan, consent, install, verify, session resolution, existing memory host, authenticated bridge, sanitized spawn, signal forwarding, capture, and cleanup.
- Pi still uses `runPiLaunch` and a separate spawn/close path in `main.tsx`.
- `runOpenCodeLaunch` is a stale test-only helper and is not production-routed.
- The TUI configures, installs, and diagnoses but does not currently launch a runner.
- The existing runtime already owns canonical project scope, credentials, event validation, replay-after-success, session mapping, and bridge drain.

## Decisions

### D1. Formalize the existing launcher

`runRunnerLaunch` remains the production composition root. Add only a small CLI-local Session Runtime lease/state boundary around the lifecycle it already owns. The lease composes `SupermemoryRuntimeHost`; it is not a provider-specific replacement or new service.

### D2. Delay dynamic effects until execution

Runtime host creation, explicit runtime effects, bridge startup, and session persistence occur only after inspect/install/verify and only for an executable managed launch. Dry-run, setup, Doctor, TUI review, and install-only remain effect-free.

### D3. Separate topology from capability state

`deck-managed` means Deck owns the process lifecycle; it does not imply every optional capability is enabled. `runner-standalone` means Deck does not own runtime enforcement. Each capability independently reports ready, disabled, degraded, or blocked.

### D4. Keep one runtime authority

Adapters translate lifecycle/context to runner-native hooks but never choose scope or start Deck. A bridge event may trigger recall/capture only in the already active runtime. Generic fallback capture is used only where no native bridge owns that event.

### D5. Add concurrent event coalescing

The existing successful-event replay cache is supplemented by a bounded in-flight map. Concurrent duplicate IDs await the same promise; only success enters replay history, and failure removes the in-flight entry so retry remains possible.

### D6. TUI handoff, not TUI supervision

A minimal TUI action may select the configured runner and return a managed-launch intent. Ink exits first; `main.tsx` invokes `runRunnerLaunch`. This preserves one process/signal/runtime owner and avoids a TUI redesign.

### D7. OpenCode first, then Pi

OpenCode proves the complete current generic path. Pi command parsing and runner-native plan details are translated into the generic input and its separate runtime/spawn ownership is removed. Codex receives regression checks only unless a concrete incompatibility appears.

## Managed lifecycle

```mermaid
sequenceDiagram
    participant U as User/TUI handoff
    participant D as Deck runRunnerLaunch
    participant A as Runner adapter
    participant L as Session Runtime lease
    participant M as Existing Memory Runtime
    participant R as Runner process/hooks
    D->>A: inspect, plan, install, verify
    alt dry-run, install-only, or blocked
        D-->>U: result; no runtime and no spawn
    else executable managed launch
        D->>D: resolve canonical project and session identity
        D->>L: create one planned lease
        L->>M: start existing host and authenticated loopback
        M-->>L: ephemeral runner-safe bridge overlay
        D->>R: spawn with sanitized environment
        R->>M: authenticated session/task events without scope
        M->>M: policy, bounded recall/capture, event coalescing
        M-->>R: inert advisory context and metadata status
        R-->>D: exit/signal/error
        D->>L: close once in finally
        L->>M: bounded drain and cleanup
        D-->>U: runner outcome and redacted diagnostics
    end
```

## Minimal neutral model

```ts
type SessionTopology = "deck-managed" | "runner-standalone";
type CapabilityState = "ready" | "disabled" | "degraded" | "blocked";
type SessionLifecycleState = "planned" | "starting" | "active" | "closing" | "closed";

interface SessionRuntimeLease {
  readonly topology: "deck-managed";
  readonly state: SessionLifecycleState;
  readonly sessionFingerprint: string;
  start(): Promise<Readonly<{ envOverlay: RunnerEnvironmentOverlay }>>;
  close(reason: SessionCloseReason): Promise<SessionRuntimeCloseResult>;
}
```

The exact type may stay private to the CLI until another dynamic capability needs the seam. Core owns neutral topology/readiness concepts; runner-specific declarations and lifecycle translation stay in adapters.

## Security and observability

- Canonical project identity comes only from the verified explicit working project and never from prompt semantics.
- Provider credentials and raw scope remain in Deck. Child environment contains only sensitive ephemeral bridge values already supported by the allowlist/redaction boundary.
- Observability records lifecycle/result enums, runner, durations, counts, approximate injected size, and one-way fingerprints only.
- Automatic Recall and explicit recall are separate channels. Tests can prove `Automatic Recall: yes` and `Explicit Recall: no` without logging content.

## Risks

- Pi flags/TTY/profile behavior may regress during convergence; characterize and preserve them before changing ownership.
- Moving host creation later can alter preview diagnostics; retain preflight/readiness diagnostics without starting effects.
- Signal/spawn failures can bypass cleanup; use one idempotent `finally` boundary and focused effect-injection tests.
- “Exactly once” can be overstated; guarantee in-process coalescing/replay and document provider idempotency limits.

## Installer constraints

The compiled Deck binary remains the only required harness. No daemon, external JavaScript runtime, provider CLI, manual secret export, persisted bridge token, or runner autobootstrap is introduced.

## Live canary activation

The repository command `bun run canary:install` reuses the canonical host compile primitive without regenerating tracked sources. It stages and smokes the candidate with empty `PATH`, creates or validates an immutable SHA-256-named payload, and atomically points a fixed relative `deck-canary` symlink at that payload. A private owner-token lock serializes helper invocations; dead owned locks recover, while live or indeterminate locks fail closed. Stable `deck`, release archives, profiles, PATH, configuration, secrets, and daemons are outside the effect boundary.

## Structural SSH alias identity

Deck discovers Git roots and origin configuration structurally from real `.git`, `gitdir:`, and supported linked-worktree `commondir` layouts; it runs no Git executable. On Linux, the effective account home is resolved from descriptor-validated `/etc/passwd`, not environment. The direct SSH config is opened with `O_NOFOLLOW`, validated via `fstat`, read from the same descriptor, and parsed with a bounded exact-block allowlist. Aliases authorize only SCP/`ssh://` remotes and only canonical GitHub hostnames. Other platforms or unsupported Git/SSH semantics fail closed for aliases while literal canonical remotes remain supported.
