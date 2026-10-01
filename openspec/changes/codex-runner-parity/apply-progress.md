# Apply progress: Codex runner parity

| Phase | Result |
|---|---|
| 0 Contract verification | Done against codex-cli 0.159.3 (strict-config doctor, app-server `hooks/list`, `codex debug models`, `exec` hook execution with and without `--dangerously-bypass-hook-trust`). Drift fixed: agent `name`, duplicate `[features]` header. |
| 1 Shared installs | Done: `packages/adapter-codex/src/tools.ts`, `@deck/core/owned-tools`, TUI action kinds `install-codex-rtk|codebase|tool|supermemory`, review-plan automatic installs, catalog update. |
| 2 Hooks | Done: marker-owned hook blocks (`codex-config.ts`), RTK bridge script, hook-trust bypass at launch. Context Mode hooks intentionally skipped. |
| 3 Supermemory | Done: `supermemory-artifact.ts` (npm tarball pinned by sha256), `apps/cli/src/codex-supermemory-launch.ts`, `runner-launch-command.ts` Codex branch, profile-backed TUI flow. |
| 4 Models/capabilities | Verified: discovery returns the account catalog; assignments round-trip through `.codex/agents/*.toml`. |
| 5 Docs | `docs/runners.md`, `docs/reference/support-matrix.md` and related pages updated. |

Verification commands and counts are recorded in the hand-off report.
