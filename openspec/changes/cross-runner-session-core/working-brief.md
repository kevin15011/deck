# Cross-runner session core (Working Brief)

## Intent
Each developer-team member (lead included) may use a model from a different runner (Claude Code, Codex, OpenCode), each executing in its own native runner CLI, while Deck supervises ONE session: shared OpenSpec change, Supermemory adaptive memory, Tavily, and owner-contract re-delegation to the same agent with its prior context.

## Decisions (user-confirmed, 2026-10-12)
- Architecture: Deck-owned headless session daemon (core) + thin clients. First client: web/PWA, remote use via Tailscale Serve. Pi is NOT the host (may remain a runner target / later client).
- The lead is also proxied: the whole session is proxied, so the delegation primitive must be exposed to the lead (likely a Deck-owned MCP server, following the serena/memory internal-command pattern).
- Usage is personal (one user, own subscriptions). Deck ships as a compiled per-user binary WITHOUT the repo: daemon, web assets and schemas must be embedded in the binary; no repo paths at runtime.
- TUI: new "cross" runner in Start installation; it only configures per-member {runner, model, thinking}; packages/MCP/skills stay configured per runner. Member model picker: runner list first, then that runner's models.

## Evidence (retrieved 2026-10-12; mostly official docs via summarizer, verify before quoting)
- Claude: `claude -p --input-format/--output-format stream-json`, `--resume`, `--append-system-prompt`, `--bare` (API key only, skips subscription), Agent SDK `canUseTool`. Local CLI 2.1.296 exposes these flags.
- Codex: `codex app-server` (JSON-RPC stdio; thread/resume, turn/start overrides, server-to-client approvals; experimental) and `codex exec --json` / `exec resume`. Local Codex install is BROKEN (native vendor binary missing, ENOENT) - repair before spike.
- OpenCode 1.18.31: `opencode serve` HTTP+SSE+OpenAPI, permissions endpoint, native ACP.
- Pi 1.0.2: `--mode rpc|json`, no approval gate.
- Anthropic ToS: unmodified `claude` binary signed in by the end user is permitted; routing others through subscription credentials or reusing OAuth tokens is not; Agent SDK in products expects API keys. Not confirmed: whether an orchestrator spawning `claude -p` counts as ordinary individual use.
- Code: RunnerId is string; RunnerAdapter has no runtime delegation method; assignments are flat Record<agentId, modelId>; TUI model flow is single-runtime (app.tsx modelConfigRuntime); Claude exec/memory blocked in claude-launch-plan.ts (claude-exec-unverified); Pi subagent supervisor (uncommitted) is Pi-hardcoded; memory ownership is per-runner; runner unions hardcoded in runtime-detection.ts, cli-args.ts.

## Risks
Approval flows diverge per CLI; event normalization loses detail (keep raw payload); daemon exposure on tailnet (127.0.0.1 bind, allowlist, no Funnel, per-device token); mobile reconnect needs cursor-based resume; upstream protocol drift (pin versions + contract tests); ToS ambiguity for Claude.

## Next
1. Spike (no production changes): verify Claude stream-json + --resume with stdin, Codex app-server/exec resume (after repairing install), OpenCode serve session API. Record schemas.
2. Full SDD (proposal/spec/design/tasks) via Architect: event/command contract, delegation primitive + session ledger, runner-qualified assignments, daemon, embedded web client, lead-as-MCP.
3. Stage delivery: daemon + one runner + minimal client first.
