# Preconditions: First-Class Codex CLI Runner Support

## Required before Apply

| Precondition | Status | Recommended resolution |
|---|---|---|
| Project artifact policy | Approved 2026-08-05 | Commit-eligible by default; explicit `--local-only` best-effort excludes exact new/untracked/fully owned files through the effective worktree-aware exclude path, while tracked/shared edits remain visible and `.gitignore` is never edited implicitly. |
| Initial Engram scope | Approved 2026-08-05 | Ship none + Supermemory; expose Engram as a deferred gap. |
| Trusted execution policy | Approved 2026-08-05 | First-class status requires a trusted Codex runner-host bridge; otherwise permit only an explicitly labeled `static-compatible` beta. |
| Direct-command mutation consent | Approved 2026-08-05 | Preview and interactive confirmation by default; require `--yes` for non-interactive mutation. |
| Codex compatibility contract | Completed 2026-08-05 | Captured released Codex 0.145.0 and 0.146.1 evidence; launch modes are feature-gated from inspected binary help. Released hooks are the Phase 4 trusted-bridge candidate; current routes remain `static-compatible`. |
| Source-preserving TOML strategy | Completed 2026-08-05 | Pinned `toml-eslint-parser@1.0.3` (MIT, Bun ESM, source ranges) passed malformed-input, semantic-reparse, comments/arrays/dotted-key, and unchanged-byte fixtures. |
| Baseline health | Recorded healthy | Compare against `openspec/baseline-health.yaml`; rerun affected and broad gates during Apply/Verify. |
| Test isolation | Required | No network, real installs, user-home writes, or trust mutation in automated tests. |

## Apply gate

The user approved all four recommended product defaults on 2026-08-05. Phase 0 compatibility and TOML gates passed. Released Codex hooks remain the trusted-host bridge candidate for Phase 4; until each route is bound and verified, every Codex launch mode remains explicitly `static-compatible`.
