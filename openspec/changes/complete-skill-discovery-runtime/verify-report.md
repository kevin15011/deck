# Verify Report: Complete Skill Discovery Runtime

## Verdict

**PASS**

## Verified behavior

- Ordinary nested skill metadata is accepted while hostile YAML, malformed input, traversal, oversized data, aliases, tags, duplicate keys, and merge keys remain rejected.
- Task search is bounded, registry-first when the canonical registry is ready, and fail-open through one coherent direct-discovery snapshot otherwise.
- Selection remains observation-bound; preparation immediately revalidates native exposure and rejects stale, ambiguous, mismatched, denied, missing, malformed, and unsupported candidates without body injection.
- OpenCode native inventory uses strict successful SDK-envelope evidence, never reads skill content during discovery, and refreshes on later searches.
- Parent and child session generations, preparation rendezvous, native call correlation, and retention bounds remain isolated.
- Pi and Codex are not represented as verified native-loading implementations.

## Evidence

- Focused OpenCode skill tests: 23 passed.
- Full OpenCode reachability: 87 passed.
- Affected OpenCode adapter tests: 115 passed.
- Core discovery/runtime/registry and SDD lifecycle tests: 58 passed.
- Generator tests: 3 passed.
- Release-gate full suite under pinned Bun 1.3.12 and a physical temporary root: 4,959 passed, 2 skipped, 0 failed. Both exact SDD Runtime package-export oracles passed after limiting the new public surface to the host factory.
- Release descriptor/helper tests: 64 passed. Deterministic memory benchmark: 13/13. Compiled runtime verification and host dry-run build: passed.
- Typecheck and `git diff --check`: passed.
- OpenSpec validation: 0 errors, 0 warnings.
- Canonical Bun 1.3.12 generation: 3/3 assets matched independent builds; one output per entry; zero diagnostics.
- Isolated OpenCode 1.18.31 installed acceptance: Lead project skill and delegated-child user skill each reached selected, loadable, native body loaded, and observed `loaded`; installed bytes matched the generated plugin; no external provider traffic or model-visible local path was observed.

## Residual risk

The `_client.get` compatibility fallback is version-sensitive, and immediate revalidation cannot eliminate the final filesystem check-to-native-load replacement window.
