# Adaptive memory

Adaptive memory is optional context that can persist useful learnings between sessions. It is never the official record of requirements, approved design, tasks, or change state.

> **Audience:** People deciding whether and how to configure adaptive memory.
> **Authority:** Provider and governance behavior; core contracts, provider adapters, and runner MCP configuration define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [memory contract](../packages/core/src/memory/adaptive-memory-contract.ts), [memory composition](../packages/core/src/memory/adaptive-memory.ts), [governance](../packages/core/src/memory/adaptive-memory-governance.ts), [Engram adapter](../packages/adapter-engram/src/index.ts), and [Supermemory adapter](../packages/adapter-supermemory/src/index.ts).

## Provider choices

Exactly one provider can be active. The default is `none`, which adds no memory injection and does not block normal work.

| Provider | Status | Integration and behavior |
|---|---|---|
| None | **Supported** | No adaptive-memory provider is selected. |
| Engram | **Experimental** | Uses existing MCP tool bindings for search, read, and write; common-contract operations remain bounded and its health is not validated by Deck. |
| Supermemory | **Supported** | MCP-based provider; full availability depends on authenticated runtime validation. |

Supermemory authentication and persistence depend on the runner. The TUI does not use one universal credential workflow.

## Supermemory setup and scoping

Supermemory uses the MCP endpoint `https://mcp.supermemory.ai/mcp` by default. Deck's normalized config stores only non-secret provider options such as the server name, search mode, and session limit.

| Runner | Authentication/setup | Project and credential storage |
|---|---|---|
| Pi | The TUI accepts a token ephemerally for setup, then writes the Supermemory server and credential to Pi's global MCP config. | User input is not stored in Deck config; the runner MCP config owns the credential. |
| OpenCode | Deck writes the remote endpoint and project scope to `~/.config/opencode/opencode.json`, then OpenCode performs native OAuth through `/connect` or `opencode mcp auth supermemory`. | `x-sm-project` is written to OpenCode's MCP config. OAuth credentials stay outside project configuration, and no `Authorization` header is persisted. |

Project scoping is explicit in the runner configuration:

- project scoping is supplied through the `x-sm-project` header in MCP configuration;
- memories are saved as normal content without manual tag prefixes.

Pi's user identity comes from the supplied token. OpenCode's user identity comes from its native OAuth session. Neither path uses manual user, team, organization, or container identifiers.

The active provider can be represented in Deck config without a credential:

```json
{
  "version": 1,
  "adaptiveMemory": {
    "activeProvider": "supermemory",
    "supermemory": {
      "mcpServerName": "supermemory",
      "searchMode": "memories",
      "maxMemoriesPerSession": 7
    }
  }
}
```

Do not copy a token into Deck config. Pi setup writes the token only to the Pi MCP configuration path and redacts it in summaries. OpenCode does not take a token as its authentication workflow: it writes endpoint/project scope, leaves OAuth enabled, and rejects a persisted `Authorization` header.

## What belongs in memory

Prefer high-signal, durable learnings:

- an explicit user correction or preference;
- an architectural decision and why it was chosen;
- a completed bug fix with its root cause;
- a non-obvious codebase discovery;
- a project convention or workflow pattern;
- a useful retrospective.

The default commit policy allows at most seven memories per session and requires high-signal candidates. Memory metadata records source, scope, type, confidence, creator, and optional promotion status.

Supported scopes are `personal`, `project`, `team`, and `org`. Team-scoped candidates require candidate status unless explicitly approved.

## What must stay out

Governance rejects active OpenSpec artifacts, raw chats or transcripts, secrets and credentials, sensitive or proprietary code, unapproved requirements, experimental deltas, and Engram migration payloads. Never use adaptive memory as a substitute for writing the required OpenSpec artifact or registry entry.

## Failure behavior

Memory is fail-open for work execution. If a provider is unavailable, unsupported, unhealthy, or incomplete, Deck returns bounded diagnostics and continues without injected memory where possible. A memory diagnostic must not turn an otherwise valid implementation path into a blocked product workflow.

Use `deck doctor` to inspect provider binaries and MCP visibility. See [Configuration](configuration.md) for persistence and [Troubleshooting](troubleshooting.md) for credential/configuration failures.
