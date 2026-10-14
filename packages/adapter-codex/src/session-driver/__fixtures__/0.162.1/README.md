# Codex 0.162.1 MCP approval fixture

`mcp-memory-approval.json` was captured on 2026-10-12 from a native app-server
session using a synthetic local MCP server and a bounded memory-tool prompt.
Thread, turn and server IDs were replaced with deterministic test identifiers.
It contains no credentials or provider memory data.

Codex routes MCP tool permission through `mcpServer/elicitation/request` with
`mode: "form"` and `_meta.codex_approval_kind: "mcp_tool_call"`. Rejecting this
request as unsupported produces an `mcpToolCall` failure with the message
`user rejected MCP tool call`; listing a connected server alone does not prove
that its tools can execute. Accept/decline replies use the generated
`McpServerElicitationRequestResponse` shape, without a persistent grant.
