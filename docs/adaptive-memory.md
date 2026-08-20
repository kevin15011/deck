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
| Codex `exec` under Deck supervision | Yes, through Deck loopback and bounded exec prompt | Yes, from bounded prompt/hook events | Hook-exposed final events only; mixed stdout/stderr are never captured |
| Codex `resume <id>` / `resume --last` under Deck supervision | Yes, where Codex hook events expose the session boundary | Hook-exposed events only | Hook-exposed final events only |
| Pi interactive under Deck supervision | Yes, through Deck loopback | Hook-exposed input events only | Unsupported unless Pi exposes a final assistant event |
| OpenCode interactive under Deck supervision | Yes, through Deck loopback | Hook-exposed chat events only | Hook-exposed assistant chat events only |

`stderr`, logs, tool output, test output, diffs, stack traces, source, OpenSpec files, web content, and provider responses are never conversation capture inputs.

Native context injection uses each runner's supported model-visible field. Codex hook output uses `hookSpecificOutput.additionalContext` with the matching hook event name. OpenCode injection uses `experimental.chat.system.transform` to add bounded advisory text to the model-visible system context for each normal request in the active logical user turn. OpenCode keeps `experimental.chat.messages.transform` as a no-op. Because OpenCode compaction also reaches `experimental.chat.system.transform`, Deck suppresses system injection while the latest native assistant request marker is the compaction summary; compaction retries do not consume or delete the active turn snapshot, and a later normal request marker or trusted user turn restores injection. Pi returns bounded advisory text through its extension return contract. Runner hooks receive only Deck's ephemeral loopback endpoint/token; they never receive `containerTag` or provider credentials.

Deck stores a small owner-local project/session map so a new Deck-supervised top-level session can be reused by `resume-latest`. Explicit resume-by-id remains deterministic from the native runner session id. Specialist/delegation session propagation is available where a runner exposes a trusted host/delegation bridge; direct routes without Deck's loopback endpoint/token are diagnosed as unsupported rather than treated as parity.

## Supermemory setup and scoping

Supermemory uses the MCP endpoint `https://mcp.supermemory.ai/mcp` by default for optional MCP operations. Deck's normalized config stores only non-secret options such as the server name and search mode.

Deck's automatic runtime uses a minimal abortable HTTP transport to Supermemory for health/profile/search/capture. Search requests are fixed to hybrid mode with rerank and query rewrite disabled. The HTTP transport is separate from optional runner MCP/OAuth configuration.

| Runner | Authentication/setup | Project and credential storage |
|---|---|---|
| Pi | The TUI validates the token and stores the runtime bearer credential in Deck's owner-only secret store. Optional MCP config is written without persisting that token. | User input is not stored in Deck config or runner MCP config. |
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

Do not copy a token into Deck config. Deck runtime setup stores the API token only in the Deck secret store after read-only validation and redacts it in summaries. Optional OpenCode/Codex MCP OAuth is configured separately: Deck writes endpoint/project scope, leaves OAuth enabled, and rejects a persisted `Authorization` header. MCP OAuth does not supply the runtime bearer credential.

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
