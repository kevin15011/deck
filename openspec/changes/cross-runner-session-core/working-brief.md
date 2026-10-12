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

## Spike results (2026-10-12, real calls, trivial prompts, scripts in ./spike)
All three runners can be driven programmatically with multi-turn context retention.
- Claude 2.1.296: `claude -p --model haiku --tools "" --session-id <uuid> --input-format stream-json --output-format stream-json --verbose` works over stdin; `--session-id` is honored; `--resume <id>` retained context. WITHOUT `--bare`, `-p` loads user hooks and ALL global MCP servers (14 here); `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` isolated them (mcp=[], tools=0). Deck must pass explicit MCP config per delegated child. `--bare` stays off the table (API key only).
- Codex 0.162.1: `codex exec --json -s read-only -C <dir>` emits JSONL (thread.started, item.completed, turn.completed); MUST close stdin (`< /dev/null`) or it blocks on "Reading additional input from stdin". `codex exec resume <thread_id>` retained context. `codex app-server` (JSON-RPC stdio: initialize, initialized, thread/start, turn/start) ran two turns in one process with context kept; notifications include turn/started, item/agentMessage/delta, item/completed, turn/completed, thread/tokenUsage/updated, account/rateLimits/updated, hook/*. Approvals not exercised (approvalPolicy "never" used). Codex warns about hooks defined in both ~/.codex/hooks.json and config.toml.
- Codex install: 0.130.0 darwin-arm64 binary was signed by OpenAI but its certificate was REVOKED (macOS killed/deleted it). Fixed by `npm install -g @openai/codex@0.162.1` (valid signature; binary path now vendor/aarch64-apple-darwin/bin/codex). Deck's codex adapter assumptions about layout/version must be re-checked against 0.162.1.
- OpenCode 1.18.31: `opencode serve --pure --port N` binds 127.0.0.1; /doc OpenAPI, POST /session, POST /session/:id/message (model {providerID, modelID}) is synchronous and returned the reply; context retained across messages; SSE /event gave session.status, message.part.delta, session.idle; /permission and /permission/{requestID}/reply exist (not exercised).
## Spike round 2 results (2026-10-12; scripts in ./spike)
A dependency-free Deck-owned MCP stdio server (spike/deck-mcp.mjs, tool deck_delegate) was reachable from all three runners. Approval relay and interrupt work in all three.
- MCP injection: Claude `--strict-mcp-config --mcp-config '<json>'` (tool name mcp__deck__deck_delegate); Codex `-c mcp_servers.deck.command=... -c mcp_servers.deck.args=[...] -c mcp_servers.deck.env={...}` (item type mcp_tool_call); OpenCode `OPENCODE_CONFIG_CONTENT` env with `mcp.deck` local server (tool name deck_deck_delegate, status "connected"; the server also auto-loaded the user's other MCPs: context7, context-mode, codebase-memory, serena, web-search).
- Approvals: Claude headless without allowedTools DENIES and reports `permission_denials` (tool_name, tool_input) in the result event; `--permission-prompt-tool mcp__deck__deck_approve` routes each prompt to a Deck MCP tool that returns {behavior, updatedInput} (this is the live relay path; the daemon can block on the user's decision there). Codex app-server (approvalPolicy on-request, sandbox read-only) sends server request `item/commandExecution/requestApproval`; replying {decision:"accept"} let the command run (accept path only; decline not exercised). OpenCode: with permission config "ask", `GET /permission` lists pending {id, sessionID, permission, patterns, tool}; `POST /permission/{id}/reply {reply:"once"}` released the tool call.
- Interrupt: Claude SIGINT on a stream-json process mid-turn gives result `error_during_execution`, is_error=true and a clean exit 0 (not SIGTERM, which exits 143); Codex app-server `turn/interrupt {threadId, turnId}` -> turn/completed status "interrupted"; OpenCode `POST /session/{id}/abort` -> 200 and session status returns to idle.
- Observation: a delegated child inherits the user's global MCP servers and hooks unless explicitly isolated (Claude strict flags, Codex --ignore-user-config, OpenCode --pure still loaded user MCPs through config). Deck must define the child's MCP set explicitly per runner.
- Still not verified: Supermemory/adaptive memory path inside delegated children; Codex decline path; Claude long-lived process across several turns; Deck Codex adapter compatibility with 0.162.1.

## Next
1. (done) Spike rounds 1 and 2.
2. Full SDD (proposal/spec/design/tasks) via Architect: event/command contract, delegation primitive + session ledger, runner-qualified assignments, daemon, embedded web client, lead-as-MCP.
3. Stage delivery: daemon + one runner + minimal client first.
