# Adaptive memory

Adaptive memory is optional context that can persist useful learnings between sessions. It is never the official record of requirements, approved design, tasks, or change state.

> **Audience:** People deciding whether and how to configure adaptive memory.
> **Authority:** Provider and governance behavior; core contracts, provider adapters, and runner MCP configuration define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [memory contract](../packages/core/src/memory/adaptive-memory-contract.ts), [memory composition](../packages/core/src/memory/adaptive-memory.ts), [governance](../packages/core/src/memory/adaptive-memory-governance.ts), [Supermemory adapter](../packages/adapter-supermemory/src/index.ts), and [Supermemory adapter](../packages/adapter-supermemory/src/index.ts).

## Enablement

Adaptive Memory is either **Disabled** or **Enabled**. The default is disabled, which adds no memory injection and does not block normal work. When enabled, Supermemory is the only durable backend.

Automatic recall and capture run only inside a **Deck-managed** launch, such as Deck's OpenCode, Pi, or Codex developer launch commands. A runner started directly is **runner-standalone/static-compatible**: installed agents, skills, prompts, and optional MCP surfaces can still be useful, but automatic Adaptive Memory is not provided and runner hooks must not autobootstrap Deck Runtime.

Within one managed Deck process, duplicate runner event IDs are coalesced while an effect is in flight and replay-suppressed only after success. Failed event IDs remain retryable. Deck does not claim distributed exactly-once effects beyond any idempotency guarantee provided by Supermemory.

| Setting | Status | Integration and behavior |
|---|---|---|
| Disabled | **Supported** | No remote adaptive-memory effects run. |
| Enabled | **Supported where hooks exist** | Deck uses its Supermemory runtime for eligible automatic recall/capture and optional MCP for explicit recall/list/graph/document operations. |

Interactive/direct runner paths that do not expose trusted input/output hooks are reported unsupported for automatic recall/capture. Deck does not fake a conversation from process output.

Current automatic-capture route truth:

| Route | Automatic recall | Prompt capture | Final assistant capture |
|---|---:|---:|---:|
| Codex (all routes) with Supermemory selected | Official plugin `UserPromptSubmit` hook, not Deck loopback | Official plugin `Stop` flush | Owned by the plugin; Deck does not capture Codex output |
| Codex without Supermemory | Deck loopback hooks fail open when no memory provider is active | None | None |
| Pi interactive under Deck supervision | Yes, through Deck loopback (`deck-memory` extension) | Yes, from `before_agent_start` | Yes, the assistant text of each completed turn, flushed on `agent_end` |
| OpenCode interactive under Deck supervision | Yes, through Deck loopback | Hook-exposed chat events only | Hook-exposed assistant chat events only |

`stderr`, logs, tool output, test output, diffs, stack traces, source, OpenSpec files, web content, and provider responses are never conversation capture inputs.

Native context injection uses each runner's supported model-visible field. Codex memory injection with Supermemory selected is performed by the official plugin's hooks. OpenCode injection uses `experimental.chat.system.transform` to add bounded advisory text to the model-visible system context for each normal request in the active logical user turn. OpenCode keeps `experimental.chat.messages.transform` as a no-op. Because OpenCode compaction also reaches `experimental.chat.system.transform`, Deck suppresses system injection while the latest native assistant request marker is the compaction summary; compaction retries do not consume or delete the active turn snapshot, and a later normal request marker or trusted user turn restores injection. Pi's `deck-memory` extension appends bounded advisory text to the system prompt of the current turn only (an ephemeral `before_agent_start` return, never a persisted message, so it cannot accumulate across turns or sessions). Runner hooks receive only Deck's ephemeral loopback endpoint/token; they never receive `containerTag` or provider credentials.

Deck stores a small owner-local project/session map so a new Deck-supervised top-level session can be reused by `resume-latest`. Explicit resume-by-id remains deterministic from the native runner session id. Specialist/delegation session propagation is available where a runner exposes a trusted host/delegation bridge; direct routes without Deck's loopback endpoint/token are diagnosed as unsupported rather than treated as parity.

## Explicit memory tools (on-demand search and save)

Automatic recall/capture is not the only channel: every runner also offers the model an explicit, on-demand way to search and save project memory. Pi and Codex gained theirs without ever exposing the Supermemory API key to the runner process.

| Runner | Explicit search | Explicit save | Mechanism |
|---|---|---|---|
| Claude | Supermemory MCP `search_memory` (and related tools) | Supermemory MCP `add_memory` | Official plugin MCP tools. |
| OpenCode | `supermemory` tool | `supermemory` tool | Official plugin tool. |
| Pi | `memory_search` | `memory_save` | Tools registered by the `deck-memory` extension; they call the Deck loopback host. |
| Codex | `memory_search` | `memory_save` | Deck-owned stdio MCP server `deck-memory` (the hidden `memory-mcp` internal subcommand of the Deck binary), registered in `$CODEX_HOME/config.toml` as a marker-owned entry; it calls the Deck loopback host. |

The Pi and Codex tools use two additive operations on the same authenticated loopback (`deck-runner-memory-loopback-v1`, existing events unchanged):

- `search` (`query`, optional `limit` 1 to 5): the query follows the managed-recall rules (at most 1,024 bytes, no control characters, no credential-shaped text). The host searches the canonical project tag with the role's result and token limits and returns the bounded, escaped advisory envelope plus `resultCount`.
- `save` (`content`, optional `kind` of `decision`, `discovery`, `preference`, `convention` or `note`): at most 16 KiB. The host applies the same eligibility and secret redaction as every capture (a rejected save returns the reason, never the secret) and writes through the canonical tag.

The host enforces the policy; the runner-side tools only mirror it. Read-only roles (investigate, quality) may search but are refused `save` (`role-not-permitted`); apply-fast has no search (its recall policy is `skip`); the lead and every write-capable role may save. Runner-supplied scope fields (`containerTag`, `scope`, ...) are rejected on every event. In Pi the read-only `--tools` allowlists include `memory_search` and never `memory_save`, and the tools are absent when memory is disabled or the loopback handoff is missing.

Codex specifics: when the reviewed install registered the `deck-memory` entry, the Codex developer launch also hosts the loopback (the official plugin still owns automatic recall/capture and keeps writing to the same canonical tag through `SUPERMEMORY_REPO_TAG`). Codex forwards only the names `DECK_RUNNER_MEMORY_ENDPOINT` and `DECK_RUNNER_MEMORY_TOKEN_FILE` to that server; the bearer token is in a `0600` file in a `0700` directory (`runtime/codex-memory-*`, deleted when Codex exits), never in `config.toml`, argv or the environment. Other MCP servers receive neither variable. Codex does not tell an MCP server which agent is calling, so every call is authorized as the lead and the Codex instructions tell read-only roles not to call `memory_save`; this is an instruction-level limit, not a host guarantee.

## Pi event flow

Pi memory runs only in a Deck-managed `deck pi developer` session (the Deck-session activation guard keeps the extension inert in a plain `pi`). Deck starts its loopback host, writes the per-session bearer token to a `0600` file in a `0700` directory under the Deck state home (`runtime/pi-memory-*`, swept after 24 hours and deleted when the host closes), and launches Pi with `DECK_RUNNER_MEMORY_ENDPOINT` and `DECK_RUNNER_MEMORY_TOKEN_FILE`. When memory is disabled Deck sets `DECK_PI_MEMORY=disabled` and the extension stays silent.

| Pi event | `deck-memory` action |
|---|---|
| Extension load | Reads the token file into memory and removes `DECK_RUNNER_MEMORY_TOKEN*` from the Pi process environment before Pi starts MCP servers. |
| First `before_agent_start` | `session_start` recall, then an ephemeral system-prompt append and an `injection_ack` for the exact injected text. |
| Later `before_agent_start` | `recall` for the new user prompt and the same ephemeral injection; the user prompt is recorded for capture. |
| `turn_end` | Buffers the assistant text of the turn. |
| `agent_end` | Captures the user prompt and the buffered assistant text (stable event ids, 64 KiB cap, one retry). Capture is still subject to the host's high-signal eligibility rules. |
| `session_before_compact` | Bounded drain of pending captures; never cancels compaction. The next turn recalls again. |
| `session_shutdown` | Flushes, drains, and sends `shutdown_flush` (a `reload` drains only because the session continues). |

Subagent children can also call `memory_search` (read-only roles) or both tools (write roles) as described under [Explicit memory tools](#explicit-memory-tools-on-demand-search-and-save). Subagent children recall once at role start with the same ephemeral injection, never capture, and send `shutdown_flush` for their role session. MCP servers started by Pi never see the token: it is not in the environment, and Deck's `mcp.json` entries blank `DECK_RUNNER_MEMORY_*`. The non-secret endpoint remains visible to Pi's own process.

## Supermemory setup and scoping

Supermemory uses the MCP endpoint `https://mcp.supermemory.ai/mcp` by default for optional MCP operations. Deck's normalized config stores only non-secret options such as the server name and search mode.

Deck's automatic runtime uses a minimal abortable HTTP transport to Supermemory for health/profile/search/capture. Search requests are fixed to hybrid mode with rerank and query rewrite disabled. The HTTP transport is separate from optional runner MCP/OAuth configuration.

| Runner | Authentication/setup | Project and credential storage |
|---|---|---|
| Pi | The TUI validates the token and stores the runtime credential in Deck's owner-only secret store. Pi receives only the loopback endpoint and a path to a `0600` token file; no Supermemory credential or MCP entry is written into Pi configuration. | User input is not stored in Deck config or Pi configuration. |
| OpenCode/Codex | Deck runtime requires a Supermemory API token that is read-only validated and stored in Deck's owner-only secret store. Separately, Deck writes the remote endpoint and project scope to runner MCP config; the runner may perform native OAuth through `/connect`, `opencode mcp auth supermemory`, or `codex mcp login supermemory`. | `x-sm-project` is written to runner MCP config. OAuth credentials stay outside project configuration, do not replace the Deck runtime bearer credential, and no `Authorization` header is persisted. |

Project scoping is explicit at runtime and, where supported, in MCP configuration:

- automatic runtime calls pass Deck's canonical `containerTag` and stable `customId`;
- MCP project operations must pass the canonical `containerTag` when the tool schema accepts it;
- `x-sm-project` is diagnostic/transport metadata only and never supplies an omitted tool argument.

User identity comes from the Supermemory credential or native OAuth account. Neither path uses manual user, team, organization, or container identifiers.

Canonical project identity comes from the verified Git top-level and its actual `origin` remote, discovered structurally from `.git` directories or `gitdir:` files without executing `git` or using ambient `PATH`/`GIT_*` configuration. HTTPS and SSH remotes are accepted for literal `github.com` and `ssh.github.com`; an SSH host alias is accepted only for SCP-style or `ssh://` remotes when the OS account home can be resolved from a trusted structural account database and that home's `.ssh/config` has an exact `Host` block whose `HostName` maps to one of those canonical hosts. On Linux, Deck resolves that home from a no-follow, descriptor-validated `/etc/passwd`; platforms without an equivalent structural account record fail closed for SSH aliases. Deck opens the direct SSH config file once with no-follow descriptor validation and does not run `ssh`, expand `Include`, evaluate `Match`, execute commands, use ambient `HOME`, or follow unsafe config files. Missing, wildcard, negated, included, ambiguous, unsafe, or unsupported alias configuration fails closed.

Enablement can be represented in Deck config without a credential:

```json
{
  "version": 1,
  "adaptiveMemory": {
    "enabled": true,
    "supermemory": {
      "mcpServerName": "supermemory",
      "searchMode": "hybrid"
    }
  }
}
```

Do not copy a token into Deck config. Deck runtime setup stores the API token only in the Deck secret store after read-only validation and redacts it in summaries. For OpenCode, Claude, and Codex the TUI stores the credential as a protected shared profile and Deck injects it into the launched runner process only (`SUPERMEMORY_CODEX_API_KEY` for Codex); it is never written to runner configuration, and Deck registers neither a raw Supermemory MCP entry nor its own runtime beside the official plugin.

## What belongs in memory

Prefer high-signal, durable learnings:

- an explicit user correction or preference;
- an architectural decision and why it was chosen;
- a completed bug fix with its root cause;
- a non-obvious codebase discovery;
- a project convention or workflow pattern;
- a useful retrospective.

Automatic capture accepts only classified, eligible conversation events such as a trusted user prompt or a trusted final assistant outcome. It never ingests process logs, tool output, tests, diffs, stacks, source, OpenSpec artifacts, web content, or provider responses.

Supported scopes are `personal`, `project`, `team`, and `org`. Team-scoped candidates require candidate status unless explicitly approved.

## What must stay out

Governance rejects active OpenSpec artifacts, raw chats or transcripts, secrets and credentials, sensitive or proprietary code, unapproved requirements, experimental deltas, and Supermemory migration payloads. Never use adaptive memory as a substitute for writing the required OpenSpec artifact or registry entry.

## Failure behavior

Memory is fail-open for work execution. If a provider is unavailable, unsupported, unhealthy, or incomplete, Deck returns bounded diagnostics and continues without injected memory where possible. A memory diagnostic must not turn an otherwise valid implementation path into a blocked product workflow.

## Migration

Deck supports local config/install migration only: legacy provider strings are compatibility input, `supermemory` maps to enabled, and removed legacy providers map to disabled with a diagnostic. Remote Supermemory memory copying/deletion is not available in Deck; migration dry-runs may classify supplied inventory, but they do not copy or delete remote memories.

Use `deck doctor` to inspect enablement, secret-store readiness, canonical scope, read-only API health/profile/search connectivity, supported route matrix, content-free observability sink path/readiness, legacy credential leakage, and optional MCP visibility. Doctor never writes memory and never creates, rotates, or writes the observability sink. External MCP usage is reported as `unobservable-external-mcp`: Deck cannot measure those calls, and runtime metrics cover only Deck-supervised automatic or explicit operations. See [Configuration](configuration.md) for persistence and [Troubleshooting](troubleshooting.md) for credential/configuration failures.
