# Claude Code 2.1.296 stream-json fixtures

Recorded 2026-10-12 against the real `claude` 2.1.296 binary on the development host
(`-p --model haiku --tools "" --input-format stream-json --output-format stream-json --verbose`,
`--strict-mcp-config --mcp-config <file>`, temp cwd) and then sanitized: the user's slash commands,
skills, plugins, agents, memory paths, socket path, hook outputs, thinking signatures and rate-limit
numbers were removed or normalized; long text was truncated. Event shapes are unchanged.

| File | Source | Notes |
|---|---|---|
| `turn-success.jsonl` | recorded | first turn with `--session-id`, hooks disabled via `--settings '{"disableAllHooks":true}'` |
| `turn-resume.jsonl` | recorded | second turn with `--resume` on the same session id |
| `turn-interrupted.jsonl` | recorded | SIGINT 4 s into a long answer: `result/error_during_execution`, exit 0 |
| `hooks-control.jsonl` | recorded | control run WITHOUT `disableAllHooks`: `hook_started`/`hook_response` events appear |
| `safe-mode-init.jsonl` | recorded | `--safe-mode` + `--mcp-config`: init lists `mcp_servers: []` (explicit MCP is dropped) |
| `tool-flow.synthetic.jsonl` | synthetic | tool_use / tool_result / `permission_denials` shapes per the documented stream-json format; the live check ran with `--tools ""` so no tool call could be recorded |
| `unknown-events.synthetic.jsonl` | synthetic | unmapped types/blocks and an `error_max_turns` result |
