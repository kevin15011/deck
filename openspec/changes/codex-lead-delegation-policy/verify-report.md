# Verification

- RED: the new launch-mode regression failed before the implementation.
- GREEN: `bun test packages/adapter-codex/src/launch.test.ts packages/adapter-codex/src/runner-adapter.test.ts apps/cli/src/runner-launch-command.test.ts` passed: 90 tests, 1,102 assertions.
- `bunx --no-install tsc --noEmit` and `git diff --check` passed.
- `bun run canary:install` compiled and installed the current working tree at `/home/kevin15011/.local/bin/deck-canary`. `deck-canary version` reports 0.8.0 / df3f0c1 / linux-x64 / dev; the source-base commit does not certify a clean tree. The installed payload contains the exact native configuration override.
- Prior isolated native context probes on Codex 0.159.3 and 0.160.0 confirmed removal of the delegation-mode fragment and preservation of the exact Deck Lead bootstrap at high effort.
- Rooted OpenSpec validation passed.
- Actual model-driven Developer Team delegation remains a user acceptance test. No provider turn or macOS acceptance is claimed. No Core, skills or global Codex configuration was changed; no commit or push was made.
