# Runner support matrix

> **Audience:** Users and maintainers configuring Deck runners.
> **Authority:** support summary; runner adapters, core capability registry, and active OpenSpec requirements remain authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [`@deck/adapter-codex`](../packages/adapter-codex/src), [capability registry](../packages/core/src/runner-capability-registry.ts), and [Developer Team execution](developer-team-execution.md).

Use this page to decide what Deck can configure and what still requires runner-native setup.

## Codex quick path

1. Install Codex CLI `0.145.0` or newer.
2. Run `deck codex developer --dry-run` and review every path.
3. Run `deck codex developer --yes` to apply the approved plan.
4. Run `deck doctor` to check trust activation, managed content, MCP/shared binaries, route classification, and recovery state. If the verified setup reports pending Supermemory authorization, run `codex mcp login supermemory` yourself when ready.

Deck writes project-local content and does **not** enable trust.

> **High-risk launch policy:** Every non-install-only Codex Developer Team interactive, exec, resume-by-ID, and resume-latest launch adds the fixed `--dangerously-bypass-approvals-and-sandbox` argv token before the Codex subcommand. Sandboxing and command approvals are disabled for that launched process, so Codex may modify or delete files and run commands without approval. This policy is visible in the launch preview and Doctor; install-only dry-run previews disclose it as the policy for any future non-install-only launch. It applies only to Deck-spawned processes and is never persisted in project or global Codex configuration.

### Root Lead startup

Codex CLI 0.146 does not provide an OpenCode-style root custom-agent selector or a `--agent` flag; `.codex/agents` entries are child-agent roles. For new sessions launched by Deck's Codex developer command, Deck passes a bounded per-process `-c developer_instructions=...` override that instructs the root session to act as Deck Lead, load `.agents/skills/deck-lead/SKILL.md`, and avoid asking the user to repeat role selection. This is instruction-level, `static-compatible` guidance—not native root-role selection—and it does not alter global configuration or plain `codex` launches.

`deck codex developer exec -- --your-prompt` joins prompt arguments deterministically and passes that content only through bounded stdin to `codex exec -`; it is not placed in argv or environment variables. Resume commands preserve existing Codex history and do not reinject Deck Lead bootstrap, model, or reasoning overrides.

## Capability matrix

| Capability | Codex | Readiness rule |
|---|---|---|
| Roles and agent-bound skills | Supported | Managed bytes and modes verify. |
| 29 standalone bundles/support files | Supported | Complete ownership manifest verifies. |
| `deck-onboard`, `deck-archive` | Supported | Native skill metadata verifies. |
| Six package instruction bundles | Supported | Canonical metadata/order/tool policy are preserved; Codex translation removes OpenCode/Claude-specific hook, installer, and tool names. Only `code-economy` defaults on, independently of runtime readiness. |
| Interactive / exec / resume | Static-compatible beta | The public adapter exposes no trusted host lifecycle or first-class promotion API. |
| Context7 | Supported | Semantic streamable HTTP MCP config. Credentials remain external. |
| context-mode | Shared | Usable binary plus semantic MCP config. |
| codebase-memory | Shared | Usable binary plus semantic MCP config plus project index readiness. |
| Serena | Shared | Usable binary plus semantic project-aware MCP config. |
| RTK | Shared | Usable binary; MCP is not required. |
| No memory provider | Supported | No provider MCP entry. |
| Supermemory | Supported | Credential-free semantic remote MCP config. After Deck successfully applies and verifies it, the user runs Codex-native OAuth when ready. |
| Engram | Gap | No verified Codex provider contract. |
| `pi-mermaid` | Pi internal | Not applicable to Codex. |
| `opencode-mermaid-renderer`, `deck-model-variants` | OpenCode internal | Not applicable to Codex. |
| `pi-hud` | Pi user-facing optional | Not applicable to Codex. |

## Ownership and recovery

Deck owns only entries recorded in `.codex/deck-manifest.json`, the exact Deck marker span in `AGENTS.md`, reviewed TOML keys/tables, and exact local-only Git exclude entries. Existing user MCP servers and malformed or ambiguous TOML block automatic apply. Each reviewed operation carries its own native and optional local-only transaction IDs; rollback consumes only that receipt, restores matching postimages, and retains conflicts for explicit recovery.

## Known limits

- Node/Bun cannot provide `openat`/`renameat2` pathname guarantees. Deck revalidates ancestors and targets immediately before atomic rename, but a privileged concurrent actor can still race pathname resolution.
- Trust remains a Codex/user decision.
- The shipped registry does not install Codex hook assets because it cannot guarantee the external authenticated host process; all four production routes therefore remain static-compatible.
- Trusted-host, invocation-authorization, dossier, controlled-effect, registry, and bound-verification controls are explicit Codex gaps.
- Content-only sync never installs runtime packages, MCP servers, providers, shared binaries, or optional capabilities.
