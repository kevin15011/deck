# Apply Progress: Canonical Deck-Managed Session Runtime

## Status

Functional candidate and first Quality repair complete; independent re-review pending.

## Implemented

- Formalized the existing generic runner launcher with one CLI-owned managed-session lifecycle lease and explicit lifecycle states.
- Deferred Adaptive Memory runtime/bridge/session persistence until after installation and semantic verification; dry-run and install-only remain free of dynamic runtime effects.
- Preserved OpenCode's generic managed path for automatic recall/capture, explicit recall/remember, canonical scope, ephemeral bridge injection, and cleanup.
- Added bounded in-flight event coalescing while retaining replay-after-success and retry-after-failure behavior.
- Routed the production Pi command through `runRunnerLaunch` using runner-native hints, removing the separate production host/spawn/close owner.
- Preserved Codex on the existing generic lifecycle.
- Added neutral managed/standalone topology and computed capability-readiness states.
- Updated launch preview, Doctor, TUI guidance, installed Developer Team instructions, and docs to describe Deck-managed as canonical and runner standalone as static-compatible without autobootstrap.
- Kept the TUI outside process/runtime ownership; it presents the exact configured managed CLI command after review/install.

## First candidate evidence

- 51 focused runner/runtime-host tests passed.
- 117 Pi convergence and CLI grammar tests passed.
- 62 Doctor/TUI tests passed.
- 56 OpenCode/Codex adapter regression tests passed.
- 14 Supermemory launch hermeticity tests passed.
- 4,683 repository tests passed; typecheck, compiled standalone verification, and diff check passed.

## Quality repair delta

The first independent review returned NO-GO for four concrete gaps. The same implementation owner repaired them without restarting the candidate:

- Legacy `runPiLaunch` and `runOpenCodeLaunch` are now static compatibility plan/install helpers only; they cannot create a memory host, bridge, session persistence, recall/capture effect, spawn owner, or cleanup owner.
- Lifecycle observability now records metadata-only identity resolution, runtime start, recall/capture channels, and runtime cleanup; cleanup diagnostics are finalized before a successful launch result is returned.
- Managed/static readiness is computed through stable reason codes and consumed by launch preview, Doctor, and TUI review/setup guidance instead of being an unused type or unconditional Doctor claim.
- Added enabled-runtime cleanup-once tests for normal, signal, and spawn-failure paths, plus legacy-owner, standalone-no-autobootstrap, readiness, Doctor, TUI, and CLI coverage.

## Repair verification

- 100 focused runtime/legacy tests passed.
- 74 Doctor/TUI tests passed.
- 89 runner reachability tests passed.
- 29 compatibility tests passed.
- 4,688 repository tests passed with zero failures.
- Typecheck, compiled standalone verification including empty `PATH`, OpenSpec validation, and diff check passed.

## Quick Fix evidence

The focused Quick Fix proof asserts zero profile/search/provider-recall/MCP effects. The test process took 471 ms in Bun and 505 ms wall-clock; this includes process/test startup and is not a production-session benchmark. Base supervision remains available without profile/search ceremony.

## Safety

- Tests used injected provider transports/state/process effects and temporary project/config roots.
- No live Supermemory operation, release, publication, daemon, raw project-selectable MCP, or runner autobootstrap was introduced.
- Provider credentials and raw project scope remain Deck-owned; only the existing ephemeral bridge endpoint/token overlay reaches the child.
- Exactly-once claims remain bounded to one process plus provider-supported idempotency.

## Remaining gate

Independent Quality re-review must confirm the repaired lifecycle ownership, observability, readiness integration, protected tests, and live-acceptance readiness.

## Final repair result

Successive independent reviews exposed and drove closure of stale final runtime readiness, authoritative credential checks, cleanup result ordering/causes, genuine installed OpenCode hook coverage, unobservable MCP metric modeling, CI stability, and TUI async credential-evidence races. The final TUI evidence action is immutable and bound to runner, operation, `planRevision`, and `planGeneratedForRevision`; stale or cancelled work cannot apply it.

Final Quality confirmed no blockers. The exact final candidate then passed 4,719 tests with zero failures under `CI=true`, typecheck, compiled standalone verification, OpenSpec validation, and diff checking.

## Live canary helper delta

Added `bun run canary:install` for cross-project acceptance testing. It installs a fixed `deck-canary` relative alias to an immutable digest-named payload, uses private lock metadata and staged/activated empty-PATH smokes, leaves stable `deck` untouched, and never creates release artifacts or rewrites tracked generated sources. Independent Quality returned GO after focused concurrency, interruption, ownership, destination, payload, release-compatibility, and real temporary compile/install checks.

Live Docker acceptance exposed that the documented default `~/.local/bin` was user-owned but mode `0775`, which the initial destination policy rejected. The repair now permits group write only for the default canary directory when UID and primary GID match the process and world write is absent; it emits a warning. World-writable, foreign-group, custom group-writable, non-owned, symlink, and non-directory destinations remain fail-closed.

The first cross-project launch then exposed an origin using `git@github-work:comodin-software/esprit-mobileapp.git`. Deck now recognizes common exact SSH aliases only after structural verification against trusted OS-account SSH configuration. The repair removed environment and executable authority from Git discovery, hardened passwd/SSH descriptor reads and parser semantics, constrained Git layouts/protocols, preserved project isolation, and changed interactive consent to print one preview plus one concise question.

Final live-environment reconciliation allowed valid spaces in unrelated `/etc/passwd` GECOS fields while retaining strict UID/GID/home validation. The actual read-only resolver now returns exactly `sm_project_v1_comodin_software_esprit_mobileapp` for the reproduced project.
