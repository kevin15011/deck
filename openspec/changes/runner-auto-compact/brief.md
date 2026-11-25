# Runner automatic compaction at 500K tokens

## Intent
Reduce subscription token consumption by compacting long runner conversations earlier.

## Acceptance
- Claude Code and Codex each have a host-wide "Auto-compact at 500K tokens" toggle in Settings > runner rows; both default to enabled.
- The window is fixed by Deck at 500,000 tokens and is not user-configurable.
- Enabled Claude: the Agent SDK bridge receives flag setting `autoCompactWindow: 500000`.
- Enabled Codex: `codex app-server` launches with `-c model_auto_compact_token_limit=500000`.
- Disabled: the runner keeps its native compaction policy.
- Changes apply to the next runner process; Claude and Codex process-reuse keys include the intent so retained processes rotate.

## Decisions
- Persistence: `meta` key `runner_auto_compact_v1` (`{"claude":bool,"codex":bool}`), absent = both enabled; cached in process atomics loaded at daemon start (`main.rs`) and updated by `POST /api/runners/auto-compact/{runner}`.
- API: `GET /api/runners/auto-compact` -> `{api, window, claude, codex}`.

## Evidence (candidate: deck2 branch working tree after 28cdd03c)
- Claude SDK `getContextUsage` probe (no API calls), claude-opus-5-5: default window 1,000,000 / threshold 967,000; with `autoCompactWindow: 500000` window 500,000 / threshold 467,000.
- Codex 0.170 `config/read` probe: override reported as `model_auto_compact_token_limit: 500000`.
- `cargo test --locked -p deck2`: all passed (2m10s, includes new `runner_compaction::tests`).
- `bun run typecheck` passed; `bun test frontend/src/auto-compact.test.ts` passed.

## Risks
- Codex model catalog windows are 272K-500K (95% effective), so a 500K limit does not trigger earlier than Codex's native policy for current models; it takes effect only for models with larger windows.
- Claude models with windows <= 500K are unaffected.

## Status
Implemented and verified; not published to `dist/deck2`.
