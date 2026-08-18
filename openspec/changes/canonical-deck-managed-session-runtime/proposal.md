# Proposal: Canonical Deck-Managed Session Runtime

## Intent

Make Deck-supervised runner execution the canonical Full Deck experience while preserving direct runner launch as an intentional static-compatible mode. Reuse the existing generic supervised launcher and Adaptive Memory runtime instead of bootstrapping Deck from runner plugins or creating another runtime.

## Outcome

One Deck-owned Session Runtime resolves project and session identity, prepares enabled dynamic capabilities, launches and observes the configured runner, and performs bounded cleanup. OpenCode is the first complete proof. Pi converges on the same lifecycle and Codex retains its existing generic route. Static installation remains useful when a runner is launched directly, but Deck reports that automatic Adaptive Memory requires a Deck-managed session.

## In scope

- Formalize the existing generic `runRunnerLaunch` path as the single managed-session lifecycle owner.
- A minimal runner-neutral lifecycle lease that composes the existing `SupermemoryRuntimeHost` and authenticated loopback.
- OpenCode automatic recall/capture, explicit recall, project isolation, exactly-once event handling, observability, and cleanup evidence.
- Pi lifecycle convergence and Codex regression coverage without copying memory policy into adapters.
- Explicit managed-versus-standalone capability/readiness states in CLI, TUI, Setup, Doctor, installed guidance, and documentation.
- A one-action everyday launch path from the existing CLI and a minimal TUI launch handoff to that same path.
- Quick Fix policy skip and standalone-binary/installer constraints.

## Out of scope

- Persistent daemons, OS services, global sockets, or runner discovery services.
- Runner plugin/hook autobootstrap of Deck Runtime.
- A second runtime, launcher, loopback protocol, provider, or memory backend.
- Raw model-selectable Supermemory MCP, Mem0, Engram, retrieval tuning, entity context, Profile Buckets, or remote container migration.
- Broad Developer Team, Web Search, TUI, or adapter refactors unrelated to managed-session ownership.
- Release or publication.

## Rollback

Revert the lifecycle consolidation and presentation changes while retaining the pre-existing generic OpenCode/Codex `runRunnerLaunch` route and all project-isolation protections. If Pi convergence has a runner-native incompatibility, restore its prior compatibility command temporarily and diagnose it as non-canonical; never restore raw Supermemory MCP, standalone Full Deck claims, or runner autobootstrap. No remote memory migration is performed.

## Live acceptance canary delta

Repository developers MAY compile the current checkout for the current host and install a separate global command named `deck-canary`. The helper MUST leave stable `deck` untouched, MUST NOT create release artifacts, and MUST activate only a staged-smoke-verified immutable payload through an atomic relative alias. This helper exists solely to run the deferred cross-project live acceptance before publication.

Live acceptance also established that common SSH `Host` aliases must participate in canonical project identity without weakening authority. Deck therefore verifies exact aliases only against trusted structural OS-account SSH configuration and continues to fail closed for environment-selected homes, executable Git shims, unsupported SSH semantics, unsafe protocols, or ambiguous mappings.
