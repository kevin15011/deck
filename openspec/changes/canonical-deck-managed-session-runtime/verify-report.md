# Verify Report: Canonical Deck-Managed Session Runtime

## Verdict

**PASS**

## Functional evidence

- OpenCode production launch uses one generic managed lifecycle and the actual installed plugin artifact in integration tests.
- Automatic Recall completes or fails open before simulated task processing; Automatic Capture, explicit recall/remember, and cleanup use the same immutable Deck-owned project/session authority.
- Project A/B isolation, prompt/container-tag inertness, nested scope rejection, bearer authentication, in-flight duplicate coalescing, replay-after-success, and retry-after-failure pass.
- Legacy Pi/OpenCode compatibility helpers cannot create a runtime host, bridge, session persistence, recall/capture effect, spawn owner, or cleanup owner.
- Pi production routing uses the generic lifecycle and preserves supported native hints; Codex interactive/exec/resume coverage passes.
- Dry-run, install-only, Doctor, Setup/TUI review, and runner standalone create no managed runtime effects.
- Quick Fix coverage records policy skip with zero profile/search/provider-recall/MCP exposure.
- Final runtime readiness is computed after health, bridge, capture, observability, and cleanup outcomes; contradictory ready/failure evidence is removed.
- TUI credential evidence is read from the effective secret store, propagated immutably, and guarded by runner/operation/plan-generation identity.
- External MCP remains explicitly unobservable and cannot be represented as a runtime invocation metric.

## Final commands

- `CI=true bun test --timeout 30000` — **4,719 passed, 0 failed**, 19,822 assertions across 303 files.
- `bunx tsc --noEmit` — passed.
- `bun run verify:supermemory-compiled` — passed all executable and compile-only targets; extracted CLI/runtime/Doctor/Codex checks passed outside the workspace with empty `PATH` where required.
- `deck openspec validate --change canonical-deck-managed-session-runtime` — 1 change, 0 errors, 0 warnings.
- `git diff --check` — passed.

## Hermeticity and safety

Automated provider behavior used injected transports, temporary state/config roots, and authenticated local loopback only. No live Supermemory effect, external provider call, release, publication, commit, push, daemon, raw project-selectable MCP, runner autobootstrap, or real user-home mutation occurred.

## Quick Fix overhead

The focused policy-skip test process previously measured 471 ms in Bun / 505 ms wall time, including test-process startup. This is not a production benchmark. The material assertion is zero profile/search/provider-recall/MCP effects while the base managed lifecycle remains available.

## Canary helper verification

- Canary suite including real temporary compile/install: 17 passed, 0 failed.
- Independent adversarial probes: 12 passed across lock, interruption, alias race, payload validation, destination ownership, cleanup containment, diagnostics, and PATH behavior.
- Total focused canary/runtime/docs/release tests: 106 passed, 0 failed.
- All 1,836 tracked files retained identical content and mtime during the real canary compile/install smoke.
- Release verification preserved `deck` as the only archive executable; stable `deck` remained byte-for-byte unchanged.
- The live Docker permission regression was reproduced hermetically with default `~/.local/bin` mode `0775` and matching UID/GID. Compile/install and version smoke passed; 0777, foreign-group 0775, arbitrary custom group-writable, non-owned, symlink, and non-directory cases remained rejected.
- The exact `github-work` live fixture resolved only `sm_project_v1_comodin_software_esprit_mobileapp`. Hostile HOME/PATH/GIT shims, malformed passwd, unsafe Git layouts/commondir, descriptor races, SSH syntax/directives, aliases, suffixes, ambiguous mappings, and unsupported URL protocols failed closed. Final focused trust tests passed 21/21 with 190 assertions; hostile-environment full CI passed 4,748 tests with zero failures and one skip.
- The actual `/home/dev/esprit-mobileapp` resolver check passed after valid passwd GECOS-space handling; the final passwd/SSH trust suite passed 21 tests with 209 assertions and no alias leakage.

## Live Adaptive Memory acceptance evidence

- Exact canary capture for the Spanish Orion/Nebula Session A changed from `no_high_signal_category` to capture attempted/succeeded after the multilingual policy repair.
- In a fresh canonical Git scope, a terminated Session A followed by a separate Session B returned both Orion and Nebula Boundary with runtime ready, no provider failure, no Context Mode, and no local inspection tools.
- Same-project focused explicit recall found Orion/Nebula. Broad retrieval in the previously polluted Esprit scope favored older semantically similar canary decisions; project isolation remained intact.
- OpenCode system-transform delivery is one-shot, session-isolated, bounded to one advisory, and guarded against late stale completions. Ordinary non-delegation tools emit no role-start recall.
- Empty explicit recall returns one safe actionable diagnostic. All inherited `DECK_RUNNER_MEMORY_*` and `DECK_CODEX_BRIDGE_*` values are removed before fresh current-plan overlays.
- Final focused verification: `154 passed, 0 failed`; `bunx tsc --noEmit`, compiled runtime verification, generated-asset parity, OpenSpec validation, and `git diff --check` passed. Final independent Quality returned GO with no blockers.
- Existing approximate-injection token metrics represent context rendered/prepared for injection. Exact-run delivery claims use separate model-visible evidence.
