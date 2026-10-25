# Runners

Deck is runner-aware rather than runner-agnostic. The CLI registers operational adapters for Pi, OpenCode, Codex, and Claude (global plugin files); other detected binaries remain visible without being represented as Deck execution targets.

> **Audience:** People choosing or diagnosing a Deck runner.
> **Authority:** Runner boundary reference; adapter registries and preflight code define current behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runtime detection](../apps/cli/src/runtime-detection.ts), [adapter registry](../apps/cli/src/runner-adapters.ts), [Pi adapter](../packages/adapter-pi/src/runner-adapter.ts), [OpenCode adapter](../packages/adapter-opencode/src/runner-adapter.ts), [Codex adapter](../packages/adapter-codex/src/runner-adapter.ts), [Claude adapter](../packages/adapter-claude/src/runner-adapter.ts), and [capability registry](../packages/core/src/runner-capability-registry.ts).

## Support status

For a team whose members use different native CLIs, see [cross-runner sessions](cross-runner-sessions.md). Open its project/session workspace with `deck web` from any directory, or attach from a project with `deck cross developer`. That experimental daemon/client surface has its own driver matrix and approval policy; the native workflows below remain available independently.

| Runtime | Status | Deck behavior |
|---|---|---|
| Pi | **Supported** (Pi >= 1.0.0) | Detects the binary, enforces the minimum version, reviews tools and MCP, configures capabilities, materializes the Developer Team globally under the Pi agent directory, and launches `deck pi developer` with Pi's normal interactive TUI. |
| OpenCode | **Supported** | Detects the binary, reads runner configuration and package evidence, configures capabilities, and materializes the Developer Team through the TUI. |
| Claude | **Full team, instruction-level safety** | A Deck-owned global plugin carries the Developer Team files, pinned shared tools, and the official Supermemory plugin; the Deck CLI starts static-compatible sessions. Protected execution controls are carried by instructions rather than a runner hook, and Deck's memory runtime is not part of this route. |
| Codex | **Full team, instruction-level safety** | Deck can configure and launch the Developer Team for Codex through the TUI and the Deck CLI: native roles and skills, shared tools pinned to verified executables, an RTK `PreToolUse` hook, and the official Supermemory plugin hooks. Protected execution controls remain static-compatible: they are carried by instructions because Codex exposes no host lifecycle hook to enforce them. |

The status vocabulary is defined in the [support matrix](reference/support-matrix.md#status-vocabulary).

Detection is not parity. A detected binary does not imply that Deck can install packages, write runner configuration, launch a team, or verify runner-specific effects for that runtime. Codex has a Developer Team adapter with shared tool installs, owned hooks, and the official Supermemory plugin, but it still does not claim first-class protected execution controls.

## Pi

Deck supports **Pi 1.0.0 or newer** (`@earendil-works/pi-coding-agent`). Preflight and `deck doctor` parse `pi --version`; an older, unparseable or missing Pi blocks install and launch with an upgrade hint (`npm install -g @earendil-works/pi-coding-agent@latest`). The older `@mariozechner/*` distributions and Pi < 1.0.0 are not supported.

### Where Deck installs

Everything Deck installs is global and manifest-owned; the install writes no project files (`<project>/.pi` is never written, and no Deck package, agent, skill or profile goes into `<project>/.deck`). The only project-side artifact is Pi's own session store for `--continue` and `--resume`, `<project>/.deck/pi/sessions/developer-team`, created at launch.

| What | Location |
|---|---|
| Pi agent directory | `$PI_CODING_AGENT_DIR` when set (must be an absolute path), otherwise `~/.pi/agent` |
| Deck package (agents, skills, prompts, extensions) | `<agent dir>/deck/package`, registered once in `<agent dir>/settings.json` `packages` as `deck/package` |
| Extensions | `<agent dir>/deck/package/extensions/<name>/{index.js,impl.js}`: `developer-team-execution` (lead only); `deck-subagents` (lead delegation/UI and child shell containment); `deck-memory` and `deck-tool-policy` (lead and children) |
| Lead system prompt | `<agent dir>/deck/profiles/developer-team/system-prompt.md`, passed with `--system-prompt`; `SYSTEM.md` and `APPEND_SYSTEM.md` are never written |
| Deck MCP servers | `<agent dir>/mcp.json`, absolute commands, `"exposure": "direct"` (tool names look like `mcp__codebase_memory__search_graph`) |
| Ownership manifest | `<agent dir>/deck/manifest.json` (content hashes; Deck replaces or removes only what it recorded) |

Deck replaces or removes only files whose hashes match its manifest; a Deck file you edited blocks the plan with a clear message instead of being overwritten. Your own `settings.json` values and `mcp.json` servers are preserved.

### Deck-session activation guard

The Deck extensions do nothing unless a Deck launch sets `DECK_PI_SESSION=1` (and `DECK_PI_ROLE`, plus `DECK_PI_CHILD=1` in subagent children). A plain `pi` in the same agent directory still loads the package, so it lists the Deck skills and the extension names, but it evaluates none of the extension code and does not load the Deck system prompt, delegation tool, tool interception or memory. Deck therefore never changes how Pi behaves outside `deck pi developer`; Deck skills and agent definitions remain discoverable, which the design allows.

### What the Deck session adds

- **Background subagents.** The lead's `subagent` tool accepts single, parallel (up to 8 tasks), and sequential chain delegations immediately and returns exact task IDs. Four child slots are shared across the parent session, with at most 32 inspectable records. Lead remains conversational and must avoid edits overlapping active delegates. Children run `pi --mode json -p --session <exact private child file>` with the role's model/thinking/tool policies and memory handoff; children never get the delegation tool. Actual tool events and untrusted agent reports populate bounded progress/history. Progress stays in the panel/history and never creates chat turns. A Pi-only ephemeral task board supplies current results to Lead; hidden, coalesced wakes run only while idle or at the native settled boundary. Busy tool loops can integrate results without a redundant queued follow-up.
- **Subagent display and controls.** Fullscreen Pi shows a non-modal floating right panel that stays anchored while conversation history scrolls. Regular mode, narrow/short terminals, and large editors use compact status plus `/subagents details`. `/subagents toggle` minimizes/restores the panel; minimization stays sticky through updates. `/subagents list`, `/subagents inspect <task ID>`, `/subagents cancel <task ID>`, and `/subagents resume <task ID>` are also available as tool actions. The floating panel shows human role names, short titles, meaningful activity and HH:MM:SS clocks; IDs and command hints stay in details. Completion freezes only that task's clock. It distinguishes waiting for Lead, reviewing, integrated and blocked states. Tool cards are compact until expanded. Preview rows are cell-safe ASCII; details retain Unicode reports. No TUI settings/mode are changed.
- **Lead integration, not just completion.** Pi's `subagent` tool has `review` and `resolve` actions. Lead inspects untrusted evidence, validates/integrates authorized work, then resolves the exact current `outcomeId` as `integrated` or `blocked` with a concrete summary. Integrated resolution requires review. Admission is not integration; failed admission gets bounded retries and unresolved admitted work gets one reminder, not endless model turns. Pending delivery/storage failures remain visible. The board does not authorize new delegation, retry or effects, and respects user pauses. These controls/guidance belong only to the Pi adapter; core policy and other runners are unchanged.
- **Recovery without replay.** Session switches and normal shutdown cancel the Pi child and settle its owned POSIX process group, not every possible tool effect. A new parent never adopts another parent's jobs. Use native `/resume` to select an old parent: its records become inspectable, but children do not auto-start. When execution ownership is proven settled, explicit `/subagents resume <task ID>` reopens that child's exact history and directs it to inspect ambiguous effects before continuing, rather than blindly replaying mutations. Navigation/branch summarization must finish before acceptance or continuation reopens, including cancelled, vetoed, and failed navigation. Missing history, changed role policy, and duplicate continuation fail closed. A resumed execution gets a new attempt identity; obsolete reports/callbacks cannot mutate it or resolve its new outcome. Private child files live beside the parent session under `.deck-subagents/`; snapshots exclude environment credentials and model context.
- **Owned child shell and conservative recovery.** On Linux, the packaged child extension replaces only the delegated Bash backend through Pi's native `createBashToolDefinition`/`BashOperations` API. Commands use the delegated Pi process group (`detached: false`); native schemas, output/results, shell settings and role policy remain in place. Lead tools are unchanged. A nonce/PID-bound startup handshake over dedicated JSON IPC clears the pre-spawn uncertain lease. Parent cleanup terminates the owned group on child completion, cancellation, timeout, navigation and shutdown, then verifies settlement before allowing explicit same-history continuation. Shell-specific abort/timeout ends the entire delegated job rather than leaving uncertain tool descendants running. The child's Bash description states this explicitly; diagnostics record a failure kind, exit/signal and bounded timeout reason instead of substituting the last progress report. Read-only roles gain no shell; delegated PowerShell is explicitly blocked. Windows/non-Linux, custom shells other than the system `/bin/bash`, missing extensions/custom runtimes without startup proof, legacy uncertain leases and unproven live/orphan ownership remain fail-closed. No cleanup signals use persisted PIDs. Birth identity and the exclusive lease gate remain recovery fences; a crash in the gate can refuse recovery permanently. There is no parent-death supervisor or daemon: after an abrupt parent crash an orphan may finish naturally, but it is never automatically resumed. This is local process-group ownership, not a sandbox or rollback: deliberately daemonizing/re-grouping commands, subprocesses started by other extensions/MCP servers, remote work and already-written files are outside the shell containment guarantee. Inspect effects before continuing; do not delegate work that escapes job ownership.
- **Tool interception** (one `tool_call` handler in `deck-tool-policy`): role policy first, then RTK, then graph guidance. Read-only roles (Investigate and Quality) are blocked from mutating tools and have no shell; `bash` commands of the other roles are rewritten to the Deck-owned RTK binary when RTK is selected; and the first code-structure `grep`/`rg`/`find` search of a session runs normally and gains one concise note pointing at the Codebase Memory graph tools. Graph guidance never blocks a search, and non-code files and literal strings are untouched.
- **Adaptive memory** (`deck-memory`): see [Adaptive memory](adaptive-memory.md#pi-event-flow). The extension also registers the explicit tools `memory_search` and `memory_save` (see [Explicit memory tools](adaptive-memory.md#explicit-memory-tools-on-demand-search-and-save)); read-only roles get only `memory_search`. Native reload rereads private credentials through a matching process-local coordinate handoff without restoring token environment variables. Internal continuation turns reuse only the exact parent's last authorized advisory ephemerally when its prompt override is absent, without extra recall/capture or persistence.
- **Web Search**: the Tavily credential reaches only the launched Pi process environment, bound to that launch; it is never written to `mcp.json`, settings or agent files.

### Setup and launch

Pi-specific setup can include:

- tool review and the shared explicitly enabled Codebase Memory, RTK, Context7 and Web Search capabilities (Deck-owned pinned binaries where applicable);
- model/provider discovery from Pi settings, `pi --list-models`, and configured environment variables;
- per-agent model and thinking assignments;
- global Developer Team materialization (the review plan lists every path under the agent directory).

```sh
deck pi developer
deck pi developer --continue
deck pi developer --resume
deck pi developer --memory=supermemory
deck pi developer --memory=none
deck pi developer --cleanup-legacy
```

`deck pi developer` plans and applies the global install when needed and then starts Pi's normal interactive TUI as the Deck lead session; Deck sessions are stored through `--session-dir`, so `--continue` and `--resume` use Pi's own session handling.

### Migrating from earlier Pi installs

Earlier Deck versions wrote `.pi/agents`, `.pi/skills` and `.deck/pi/profiles` into projects, loose Deck agents and skills into `<agent dir>/agents` and `<agent dir>/skills`, and required the community `pi-subagents` and `pi-mcp-adapter` packages.

- **Mandatory, on install:** a `pi-mcp-adapter` or `pi-subagents` entry that Deck added is removed transactionally with a backup, because `pi-mcp-adapter` disables Pi's built-in MCP and `pi-subagents` would register a second `subagent` tool. An entry you added yourself is never removed: a `pi-mcp-adapter` entry produces a blocking MCP diagnostic, a `pi-subagents` entry a warning.
- **Detected on every plan:** the legacy project and loose global files above are listed with their state and a cleanup hint; nothing is deleted automatically.
- **Opt-in cleanup:** run `deck pi developer --cleanup-legacy` once from the project (an interactive run asks for confirmation first, and the launch continues afterwards). Files that still match the current Deck templates (ignoring your `model`, `thinking` and `tools` frontmatter lines), global `deck-*` agent/skill files in the Pi agent directory that are demonstrably Deck-authored by an older version (a `deck-*` name, the Deck contract marker and a matching frontmatter name), and package entries Deck added are removed; each removed item is backed up first under `$XDG_STATE_HOME/deck/backups/pi-legacy/` (default `~/.local/state/deck/backups/pi-legacy/`), and any failure restores everything. Other files that differ from the templates (no Deck marker, a mismatching name, or project-local copies) are kept and listed: delete them yourself if unwanted. `~/.agents/skills` belongs to the Codex install and is never touched.

`deck doctor` reports the Pi version and minimum, the resolved agent directory, package registration (cross-checked with `pi list`), manifest drift, extension files and their `source-sha256` header, the pinned RTK binary, the MCP entries (absolute command, direct exposure, blanked memory variables), the `pi-mcp-adapter` conflict, stale `pi-memory-*` token directories, and legacy artifacts.

### Known limits (Pi)

- Pi >= 1.0.0 only.
- Subagent children are started with `--append-system-prompt`, which **replaces** your `APPEND_SYSTEM.md` for those children (the lead keeps it).
- MCP servers started by Pi inherit Pi's environment, including non-memory secrets such as the Web Search key; the memory bearer token is withheld (file handoff plus blanked `DECK_RUNNER_MEMORY_*` entries).
- Investigate and Quality have no shell, so Quality cannot run test suites.
- Delegating to `deck-setup` through the Deck `subagent` tool fails closed (`modification-not-authorized`) until `developer-team-execution-convergence` wires its authorization provider.
- The graph guidance classification is a conservative heuristic; it may miss a code search or add its note to a borderline one.
- Legacy cleanup matches the current Deck templates only.

## OpenCode

OpenCode preflight reads the runner version, searches the supported configuration candidates, and checks for the OpenCode package manifest. Package evidence is resolved from configuration, `PATH`, and canonical targets without treating a declaration alone as proof that a tool is usable.

OpenCode-specific setup can include:

- package and MCP configuration review;
- explicitly enabled Codebase Memory, RTK and Context7 evidence;
- runner-native model discovery and model-specific reasoning variants;
- Developer Team installation through OpenCode's native surfaces;
- runner-exposed skill inventory discovery.

The interactive dashboard presents packages, adaptive memory, teams, and a review/install plan. A plan can be blocked when required setup evidence, such as Supermemory configuration, is incomplete.

## Codex

Codex preflight requires Codex 0.145.0 or newer, checks the launch routes (`exec`, `resume`, `resume --last`) from the installed help output, and verified the config, hooks, custom-agent, and `codex debug models` contracts against 0.159.x. Materialization is global, like the Claude plugin and the OpenCode config, and never touches a project: custom agents in `$CODEX_HOME/agents/deck-*.toml` (default `~/.codex`; one per canonical role, named by its role id, with the model and `model_reasoning_effort` assigned in the model screen), skills in `~/.agents/skills/`, marker-delimited blocks in `$CODEX_HOME/config.toml`, and Deck's own files (ownership manifest, hook scripts) under `$CODEX_HOME/deck/`. Model choices come from `codex debug models` for the signed-in account and are global. Running the Deck CLI in any project creates or changes no project files.

Before the first launch, sign in with `codex login`. Because the configuration is global, project trust is not required for Deck's agents, skills, MCP servers or hooks, and Deck never changes trust.

Ownership is strict: automatic reconciliation writes only files recorded in Deck's manifest (with their hashes) and its own marker blocks in `config.toml`. Your `hooks.json`, `AGENTS.md`, other agents and skills remain untouched; a file or skill that already uses a Deck name blocks the plan with a clear message instead of being overwritten. If you already registered the same executable as one of Deck's MCP servers (for example `codebase-memory-mcp`), Deck leaves yours in place and does not add a second server.

Review & Install records continuing configuration contributions with actual content hashes. Unproven or modified entries require review and are preserved until their individual deletion is confirmed.

Review & Install for Codex can include:

- **RTK**: a Deck-owned pinned binary (the same reviewed release Claude uses) under the Deck data root, plus a Deck-owned `PreToolUse` hook for `Bash` that asks `rtk hook codex` for a rewrite and returns it through `updatedInput`, with the executable word pinned to the owned binary. The hook needs a Node.js 18+ runtime.
- **Codebase Memory**: an existing shared executable is reused (the per-user daemon must match the client version); otherwise the pinned native release is installed into the Deck data root. The MCP entry always stores the resolved absolute path.
- **Supermemory**: only the official `supermemoryai/codex-supermemory` plugin, pinned to one npm release and limited to its two documented lifecycle hooks (`UserPromptSubmit` recall and `Stop` flush). The profile credential entered in the TUI is stored in Deck's protected profile store and injected into the Codex process Deck starts, and nowhere else (`SUPERMEMORY_CODEX_API_KEY`); it is never written to Codex configuration. Deck does not register the Supermemory MCP server or its own memory loopback beside the plugin, and a launch is blocked if another Supermemory plugin or MCP registration exists in your Codex configuration.

Deck adds and removes only its own marker-delimited hook blocks (`# deck-codex-hook:<id>:start` … `:end`) in the global `config.toml`, so your inline hooks and `hooks.json` entries keep working beside them. Codex requires review of non-managed hooks; the Deck CLI launch passes `--dangerously-bypass-hook-trust` when Deck-owned hooks are present, so they run without per-hook review for that process. When you start `codex` directly instead, open `/hooks` and trust Deck's entries. The launch continues to pass `--dangerously-bypass-approvals-and-sandbox`.

```sh
deck codex developer --dry-run
deck codex developer --yes
```

Add the `--install-only` flag to apply and verify without starting Codex, or `--memory=supermemory` to select the memory provider for one run. The `--local-only` flag is accepted for compatibility but has no effect, because nothing is written into projects. Run `deck doctor` afterwards to check managed content, MCP and shared binaries, route classification and recovery state.

> **High-risk launch policy:** Every non-install-only Codex Developer Team launch (interactive, exec, resume-by-ID and resume-latest) adds the fixed `--dangerously-bypass-approvals-and-sandbox` argv token before the Codex subcommand. Sandboxing and command approvals are disabled for that process, so Codex may modify or delete files and run commands without approval. The policy is shown in the launch preview and in `deck doctor`, applies only to Deck-spawned processes, and is never persisted in project or global Codex configuration.

#### Root Lead startup

Codex has no OpenCode-style root custom-agent selector or `--agent` flag (checked against Codex 0.146); `$CODEX_HOME/agents` entries are child-agent roles. For new sessions, Deck passes a bounded per-process `-c developer_instructions=...` override that tells the root session to act as Deck Lead and load the `deck-lead` skill. This is instruction-level, `static-compatible` guidance rather than native root-role selection, and it does not alter global configuration or plain `codex` launches.

`deck codex developer exec -- --your-prompt` joins the prompt arguments deterministically and passes them only through bounded stdin to `codex exec -`, never through argv or environment variables. Resume commands preserve existing Codex history and do not reinject the Lead bootstrap, model or reasoning overrides.

A normal launch prints only a few plain lines: what is starting, the adaptive-memory status, a one-line reminder that Codex runs with sandboxing and approvals disabled, a short summary when team files change (with the usual confirmation prompt), and anything that needs your action. Routine notes and the exact file list with ownership hashes appear with the `--verbose` flag or in a dry run; the same diagnostics remain available to `deck doctor`. For `exec` runs this status goes to stderr, so stdout carries only Codex's own output.

### Migrating a previous per-project install

Earlier versions wrote `.codex/`, `.agents/skills/` and a manifest into each project. Those project files override the global agents and skills that share a name, so they shadow the global install in that project. Deck detects them through the old manifest, reports them on every plan, and never deletes them by itself. Run the Codex developer command once from that project with the `--cleanup-legacy` flag (add `--yes` to skip the prompt) to remove only the files whose bytes still match what Deck recorded and Deck's marker blocks from the project `config.toml`; anything you changed is kept. If the files are tracked in Git, the removal shows up as ordinary deletions you can review and commit, or restore. You can also delete them yourself.

### Ownership and recovery

Deck owns only entries recorded in `$CODEX_HOME/deck/manifest.json` and its marker-delimited TOML blocks. Codex receives instructions through native roles and skills; ownership-verified legacy cleanup of a previous per-project install happens only through the explicit `--cleanup-legacy` flag, and until then it is only reported. Existing user MCP servers and malformed or ambiguous TOML block automatic apply. Each reviewed operation carries one transaction per root (Codex home and user skills); rollback consumes only that receipt, restores matching postimages and keeps conflicts for explicit recovery.

### Known limits (Codex)

- Deck does not set `sandbox_mode = "read-only"` on the Investigate and Quality agents: the launch runs with the sandbox bypass, and Deck could not verify that a per-agent sandbox setting is honored under it, so read-only behavior remains guidance in the agent instructions, not enforcement.
- Trusted-host, invocation-authorization, dossier, controlled-effect, registry and bound-verification controls are explicit Codex gaps.
- Deck's Codex hook assets fail open when no Deck loopback endpoint and token are present: Deck-supervised launches provide them, plain `codex` launches do not.
- Node and Bun cannot provide `openat`/`renameat2` pathname guarantees. Deck revalidates ancestors and targets immediately before each atomic rename, but a privileged concurrent actor can still race pathname resolution.
- Content-only sync never installs runtime packages, MCP servers, providers, shared binaries or optional capabilities.

## Claude

Deck delivers the Developer Team to Claude Code as a Deck-owned global plugin: the seven roles as plugin agents, skills, pinned shared tools (RTK through a plugin `PreToolUse` hook, explicitly enabled Codebase Memory, and optional Context7 and Web Search) and, when selected in Review & Install, the pinned official Supermemory plugin. Preflight looks for Claude Code 2.1.218 or newer; model choices come from runtime-reported metadata, so account entitlement is not guaranteed.

```sh
deck claude developer
deck claude native
deck claude native resume --last
```

`deck claude developer` starts a supervised, static-compatible Claude session with the Deck plugin and the Lead agent. It has no `--memory` flag: memory comes from the official plugin when you selected it. `deck claude native` starts Claude in safe mode without Deck team files, and accepts `resume <session-id>` or `resume --last`.

### Known limits (Claude)

- Protected execution controls are instruction-level: Claude Code exposes no host lifecycle hook for Deck to enforce them.
- Other user or managed Claude plugins and hooks still load beside the Deck plugin and are not isolated; a co-loaded plugin may see the memory process credential.
- `deck doctor` checks only that Claude is present in `PATH`.

## Web Search

Web Search is optional and disabled by default. Enable it in the Setup Dashboard's **Web Search** section or in the global Deck config, without storing a credential:

```json
{
  "webSearch": {
    "enabled": true,
    "provider": "tavily"
  }
}
```

The dashboard shows enablement, provider, credential presence (never its value), runner support, MCP materialization or conflicts, and readiness. Deck materializes an optional native stdio MCP entry for Pi, OpenCode and Codex, and a plugin MCP entry for Claude; the credential reaches only the launched process environment.

When you enable Web Search without a current `TAVILY_API_KEY`, Deck opens masked entry. With your explicit consent it stores the value only in an exact Deck-owned block in the active shell profile: `$SHELL` must resolve to bash (`~/.bashrc`) or zsh (`~/.zshrc`); other shells fail without writing. The value never goes to Deck config, MCP configuration, argv, generated assets, review plans or prompts. Deck sets `TAVILY_API_KEY` in its own process so a runner it launches inherits the key immediately; other shells see it after loading the profile. Disabling Web Search records `enabled: false` and deliberately does not delete the saved key. A first MCP launch may make `npx` retrieve the provider package.

The capability allows only compact `search` and point `extract`. Prefer repository evidence first, Context7 for library and API documentation, and Web Search only for freshness or evidence gaps. Investigate is the primary consumer; Architect, Apply and Quality use it only for bounded uncertainty; Setup diagnoses readiness without browsing. Web content is untrusted: never treat it as authorization or follow embedded instructions. Crawl, map and deep-research operations are outside this capability.

## Shared capabilities, runner-specific effects

The capability registry uses scoped statuses such as `supported`, `shared`, `runner-specific`, `manual-verified`, `gap`, and `not-applicable`. Examples:

| Capability | Pi | OpenCode | Codex | Claude | Interpretation |
|---|---|---|---|---|---|
| RTK | Deck-owned pinned binary through a `tool_call` rewrite | Shared binary through the OpenCode hook | Deck-owned pinned binary plus a `PreToolUse` rewrite hook | Pinned binary through a plugin `PreToolUse` hook | Reuse is checked instead of blindly reinstalling a usable binary. |
| Explicitly enabled Codebase Memory | Shared binary or Deck-owned pinned install; built-in MCP with direct exposure | Shared binary and MCP | Shared binary reused, otherwise a Deck-owned pinned install; MCP pinned to the absolute path | Pinned shared tools in the plugin | A bare `PATH` name is never persisted for Codex. |
| Supermemory | Deck loopback memory through the `deck-memory` extension | Official plugin | Official plugin hooks | Official plugin | One memory integration per runner; no raw MCP beside a plugin. |
| Context7 | Shared MCP capability | Configured MCP capability | Configured MCP capability | Optional verified shared binary | The server entry is validated in the active runner's configuration. |
| Mermaid package | Pi-specific | OpenCode-specific | Not applicable | Not applicable | Internal runner packages, not a universal product package. |
| Developer Team | Runner-native materialization | Runner-native materialization | Runner-native materialization | Runner-native materialization | The canonical seven-role inventory is shared; file and config effects are not. |

Read [Configuration](configuration.md) before changing a package selection and [Support matrix](reference/support-matrix.md) for the full status vocabulary.

## Skill discovery boundary

Discovery is scoped to the active runner. Generic project roots can be combined with the selected runner's declared sources, but exclusive roots belonging to another runner are not aggregated. Validation and direct discovery are read-only; refresh is a separate explicitly authorized operation.

This local discovery index is separate from Deck's bundled external-skill distribution catalog and from OpenSpec. See [Skills](skills.md) and [Developer Team](developer-team.md#project-workflows).

## Retired package review and search

This delivery targets clean new installations on all four runners. Existing installations receive operator-assisted cleanup; universal legacy migration is not certified. Required release CI exercises fresh adapter writes, repeat sync, ownership hashes, preparation and search/launch contracts, while retaining migration/recovery safety checks. The manually dispatched `Historical retirement diagnostic` workflow preserves historical coverage as optional evidence. Deterministic fixtures do not replace real-session tool/search/RTK acceptance.

Context Mode and Serena are retired Deck packages. Use `deck runner cleanup --plan --json` before applying migration; see [configuration and cleanup](configuration.md#review-legacy-package-cleanup). Legacy marker names are not deletion authority. Per-runner manifests record file hashes and individually selected shared entries, while Pi and Codex retain their existing ownership history.

Codebase Memory is disabled unless `capabilities.codebase-memory.enabled` or a runner exception is explicitly true. Old persisted package toggles are ignored and reported by Doctor. Existing independent native integrations remain under the runner's control.

After opting out, a historical Claude Codebase executable remains protected while an old plugin binding still refers to it. Publish and verify the replacement, release active/recovery references, and retire the old binding before replanning executable collection. Knowledge databases and neighboring user files are preserved.

Managed turn preparation reevaluates the member's effective runner, model/provider, configuration and tool exposure. Confirmed native search omits Deck fallback injection; unavailable native search uses the configured provider. Unknown detection uses that fallback with a possible-duplicate diagnostic. A missing fallback credential is an explicit preparation failure. Native/user tool permissions remain binding. RTK and official Supermemory keep their existing execution paths.

### Offline runner mutation guard recovery

`deck doctor` reports the exact `runner-mutation.json.gate` directory and sibling `runner-mutation.json` reservation for the selected state root. The default directory is `$XDG_STATE_HOME/deck/daemon/runner-mutation.json.gate`, or `~/.local/state/deck/daemon/runner-mutation.json.gate` when `XDG_STATE_HOME` is unset. A guard can belong to a paused daemon starter even when there is no reservation or reachable daemon. Its age, an absent reservation PID, a missing lock or a failed ping cannot establish that it is orphaned. Deck never expires or automatically removes this guard.

If an operation completed but reservation cleanup failed, keep its reported files, contribution manifests and backup references. This is a recovery-required partial failure, and retrying the original callback can repeat completed effects. If the callback also failed, the original error remains attached to the cleanup error. Review actual postimages and existing recovery receipts before deciding which work remains.

After coordination recovery, `deck rollback --backup <id> --force` can explicitly recover the referenced update when idle. `--force` permits selecting a backup protected by that same operation; it does not override content or path checks. Deck restores or removes a file only while its recorded applied bytes and filesystem identity still match. Later edits, missing or changed originals, symlinks, replaced paths and older backups without postimage evidence remain conflicts. Partial recovery keeps the operation and backup; completed file restores are recorded so retry does not replay them. Preserve conflicting files and receipts for individual manual reconciliation rather than deleting recovery evidence or forcing an overwrite. Runner replacement snapshots are taken after retirement; retirement's own backups and contribution receipts remain the recovery source for retired entries.

Use this manual procedure only during an independently established offline maintenance window:

1. Let active work finish. Prevent every source of new Deck activity against this state root: terminals, IDE integrations, service managers, scheduled jobs and other hosts sharing it. Independently inspect the process inventory and known launch sources to establish that no daemon, daemon starter or runner mutation process is running, paused, or able to resume. A reservation PID alone does not cover starters. If quiescence cannot be established, leave the guard intact.
2. Preserve a private copy of the daemon coordination evidence and the affected operation's backups, contribution manifests and pending transaction receipts. Record the exact guard path from doctor. Inspect the directory without changing it; an unexpected owner, symlink, nonempty directory or unexplained evidence requires investigation.
3. Only after that proof, manually remove **only the empty guard directory** at the reported path, using `rmdir` with the literal path quoted as one argument. Do not recursively delete it, and do not remove the sibling reservation, daemon locks, session history, backups or pending receipts. This is an operator action; doctor does not perform it.
4. Keep launch sources blocked while reviewing `deck doctor` and `deck runner cleanup --plan --json` again. The existing admission machinery can reclaim a reservation only when its owner is verifiably absent. A live, unknown or corrupt reservation remains blocked; do not erase it to force admission. Pending contribution recovery or offline session evidence may independently block mutation and must be resolved through the existing recovery path. Verify existing postimages and use the retained backup/receipt to recover unchanged transaction-owned files; preserve later user edits. Replan the remaining work before explicitly retrying, then restore normal launch sources when recovery is complete.
