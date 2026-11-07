# Deck Agent Guide

> **Audience:** AI agents working in this repository.
> **Authority:** explanatory navigation and safety map; OpenSpec and source remain authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [contributor guidance](CONTRIBUTING.md), [OpenSpec configuration](openspec/config.yaml), [registry schema](openspec/registry-schema.md), and [Git safety source](packages/core/src/teams/developer/git-safety.ts).

## Architecture and invariants

- `@deck/core` owns canonical capabilities, shared contracts, developer-team content, and provider-neutral policy.
- `@deck/sdd-runtime` owns OpenSpec lifecycle coordination and artifact-state operations.
- `@deck/session-host` owns the local cross-runner daemon, task lifecycle, event ledger, approvals and client transports. It imports no runner adapters; `apps/cli` injects native session drivers and shared services.
- Runner adapters—`packages/adapter-pi`, `packages/adapter-opencode`, and `packages/adapter-codex`—translate those contracts for Pi, OpenCode, and Codex; provider adapters isolate external provider integrations.
- `apps/cli` composes configuration, adapters, review/install flows, and the CLI/TUI. Canonical capabilities are selected centrally; adapters contribute only their runner-native materialization and evidence.
- Active/promoted OpenSpec artifacts define requirements and lifecycle; source and tests define runtime behavior. Do not hand-edit generated outputs such as `packages/core/src/skills/external/content.generated.ts` or `apps/cli/src/runtime/build-info.generated.ts`; preserve historical OpenSpec records, and follow [git-safety.ts](packages/core/src/teams/developer/git-safety.ts) before any discard operation.

## Development path (Deck repository conventions)

### Web UI motion

Every Web UI change involving movement, appearance, disappearance, expansion,
collapse, view changes or tab/selection transitions MUST use GSAP for its animation.
This includes panel content and active indicators in tabs and view selectors.
Use the Apple-inspired motion conventions: immediate feedback, restrained easing,
interruptible transitions from the current visual state, and no decorative bounce.
Respect `prefers-reduced-motion` with immediate state changes or a minimal fade;
never delay input, focus, navigation or access to controls for an animation.
Clean up owned tweens, listeners and observers on unmount, and avoid simultaneous
CSS and GSAP animation of the same properties. Verify transitions in the browser,
including rapid reversals, keyboard interaction and reduced motion.

For a canary development path, run `bun run canary:install`, then launch `deck-canary <runner> developer`. Focused verification starts with the tests affected by the change. Use [CONTRIBUTING.md](CONTRIBUTING.md) for commands, [architecture](docs/architecture.md) for boundaries, [runners](docs/runners.md) and the [support matrix](docs/reference/support-matrix.md) for runner status, and [OpenSpec configuration](openspec/config.yaml) for SDD context.

For this repository, run focused test files while editing, then `bun run test` and `bunx tsc --noEmit` before committing. The fast suite has a hard 240-second wall-time budget, including preparation, process execution and output drain; exceeding it fails the run and terminates active process groups. Files taking over 2 seconds emit a diagnostic warning only, without retries or timing failures. Runner or installation changes additionally require a short live canary check by the Lead. Reuse unchanged evidence and rerun only invalidated checks. Quarantine is tracked in `tests/quarantine.yaml`, expires within 14 days, and requires user approval for protected tests. These are Deck-repo conventions, not defaults for user projects.
