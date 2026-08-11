# Archive Report: Consolidate Global Deck Configuration

## Final Status

Archived after user acceptance on 2026-08-11.

## Outcome

Deck now uses `$XDG_CONFIG_HOME/deck/config.json` (default `~/.config/deck/config.json`) as the only active preference source. Project roots remain execution and materialization targets and no longer select or receive Deck preference files.

TUI, Web Search, direct launch, Pi/OpenCode/Codex adapters, Doctor, upgrade, sync, and standalone composition receive the same caller-resolved global configuration. Missing configuration fails closed; adapters cannot activate project-local legacy preferences.

## Safety

- Canonical reads validate containment, ancestry, ownership, symlinks, and regular-file state.
- Writes use private same-directory temporary files, mode `0600`, serialized owner/nonce locks, CAS patches, operation receipts, and bounded rollback.
- Migration candidates are explicit migration-only APIs with redacted conflict metadata.
- Provider credentials remain outside Deck config.

## Migration and Cleanup

An early test contaminated the real canonical XDG config with synthetic runner `atlas`. With explicit user authorization, Deck created a private `0600` backup and atomically replaced canonical config from the authorized current-project source. The repaired canonical config keeps Supermemory and Web Search enabled and includes Pi, OpenCode, and Codex without `atlas`.

After verification, the user explicitly authorized deletion of both obsolete legacy configs and directories. The project `.deck/config.json` is removed from tracking and ignored against recreation. The private backup remains the rollback preimage.

## Verification

- Full repository suite: 4,502 passed, 0 failed.
- TypeScript `--noEmit`: passed.
- `git diff --check`: passed.
- Production-use and secret/value-diagnostic audits: passed.
- Compiled binary used one global config from two unrelated projects outside the repository and without `node_modules`.
- Independent Quality review approved after adversarial config injection, path, lock, concurrency, rollback, Doctor, migration, and cleanup probes.

## Artifacts

- `proposal.md`
- `spec.md`
- `design.md`
- `tasks.md`
- `preconditions.md`
- `apply-progress.md`
- `verify-report.md`
- `review-report.md`
- `archive-report.md`
- `state.yaml`
- `events.yaml`
