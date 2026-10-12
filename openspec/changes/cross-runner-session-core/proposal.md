# Proposal: Cross-Runner Session Core

> **Status:** proposed (Full SDD). **Inputs:** [working-brief.md](working-brief.md) (user-confirmed decisions and two spike rounds, scripts in [spike/](spike/)).
> **Companion artifacts:** [spec.md](spec.md) · [design.md](design.md) · [tasks.md](tasks.md)

## Intent

Let every Developer Team member (Lead included) run on a model from a different runner (Claude Code, Codex, OpenCode), each executing inside its own unmodified native CLI, while Deck supervises **one** session: one OpenSpec change, one Deck-mediated adaptive memory, one web-search configuration, and owner-contract re-delegation to the same agent with its prior native context.

## Outcome

A Deck-owned headless **session daemon** owns the session; **thin clients** attach to it. The first remote client is an embedded web/PWA reached over Tailscale Serve. The Lead is proxied like every other member and delegates through a Deck-owned MCP tool (`deck_delegate`) exposed to whichever runner hosts it. A new **cross** entry in the TUI Start installation configures only per-member `{runner, model, thinking}`.

## Why now

- Two real spike rounds proved all three runners can be driven headlessly with multi-turn context, explicit MCP injection, approval relay, and interrupt ([working-brief.md](working-brief.md#spike-round-2-results-2026-10-12-scripts-in-spike)).
- Current seams cannot express this: `DeveloperTeamModelAssignments` is a flat `Record<agentId, modelId>`, `RunnerAdapter` has no runtime delegation method, the TUI model flow is single-runtime, and Claude exec is blocked (`claude-exec-unverified`).

## In scope

| Area | Summary |
|---|---|
| Contracts | Normalized session event/command schema in `@deck/core` with raw-payload escape hatch and cursor resume; runner-qualified member assignment type with backward-compatible config migration. |
| Daemon | Per-user headless daemon: session/ledger store in the user state dir, append-only event log, child supervision (process-group anchor), crash recovery, orphan cleanup. |
| Drivers | Optional `RunnerSessionDriver` per adapter: Claude stream-json, Codex app-server JSON-RPC, OpenCode serve HTTP+SSE; explicit per-child MCP/hook isolation; approval relay; interrupt. |
| Delegation | Deck session MCP server (`deck internal session-mcp`) exposing `deck_delegate`, `deck_task_wait`, `deck_task_result`, memory tools, and the Claude permission-prompt tool; owner-contract continuation via ledger `taskId -> {runnerId, nativeSessionId}`. |
| Shared services | Deck is the single adaptive-memory writer for the session; web search configured once; one OpenSpec change per session. |
| Clients | Minimal terminal client (`deck cross developer`, `deck session ...`), embedded web/PWA over Tailscale Serve, TUI "cross" configuration. |
| Distribution | Daemon, web assets and schemas embedded in the compiled binary for all four targets; no repository paths at runtime. |
| Docs | Architecture, runners, support matrix, ToS risk and non-goals. |

## Out of scope (hard non-goals)

- **Multi-user use.** No shared daemons, no second identity in the allowlist by default, no team accounts.
- **Credential relay.** Deck never reads, extracts, copies, proxies, or reuses OAuth/session tokens of any runner. Each native CLI authenticates itself as the signed-in user.
- **`claude --bare`** or any API-key substitution for a subscription; no Agent SDK embedding of Claude.
- **Modified runner binaries**, wrapped auth endpoints, or impersonated clients.
- **Tailscale Funnel** or any public exposure; non-loopback binds.
- Pi as a session host or driver in this change (Pi remains a normal runner; a Pi driver can follow later).
- Git worktree isolation per child, web push notifications, OS service installation (launchd/systemd), Windows targets.
- Changing per-runner package/MCP/skill installation; `cross` never installs anything.

## Relationship to existing changes

- [canonical-deck-managed-session-runtime](../canonical-deck-managed-session-runtime/proposal.md) excluded "persistent daemons". This change **deliberately supersedes that boundary only for cross-runner sessions**. Single-runner managed launches (`runRunnerLaunch`) keep their current lifecycle unchanged.
- [fix-global-setup-and-pi-skill-discovery](../fix-global-setup-and-pi-skill-discovery/) has uncommitted Pi work. This change **ports** the Pi supervisor/lease lessons into a runner-neutral host; it never edits `packages/adapter-pi`.
- The approved always-on Codex bypass ([add-first-class-codex-runner-support](../add-first-class-codex-runner-support/)) stays the Codex default in cross sessions unless the user decides otherwise (open question 2 in [design.md](design.md#open-questions)).

## Risks (top)

| Risk | Mitigation |
|---|---|
| **Anthropic ToS ambiguity**: whether an orchestrator spawning `claude -p` under a personal subscription counts as ordinary individual use is not confirmed. | Unmodified binary, signed in by the user, on the user's machine, for the user only; no token handling; one-time explicit acknowledgement before the Claude driver is enabled; documented in docs and Doctor. The Claude driver can be disabled without affecting others. |
| Upstream protocol drift (Codex app-server is experimental). | Tested-version ranges per driver, recorded-fixture contract tests, opt-in live contract script, degrade-not-crash on unknown events. |
| Daemon exposure on the tailnet. | 127.0.0.1 bind, separate local control socket, device tokens, identity allowlist, Funnel refusal, Origin/CSRF checks. |
| Children inherit user global MCPs/hooks. | Explicit per-child MCP set per runner, verified by contract tests and probe. |
| Orphaned child processes. | Process-group anchor that self-terminates on daemon IPC loss; recovery never signals persisted PIDs. |

## Rollback plan

Each stage is additive and independently revertible:

1. **S0** adds optional types and an optional `crossRunner` config key. Revert removes them; pre-change binaries ignore or drop the key on next write (verified by a task); per-runner assignments are untouched.
2. **S1–S3** add new commands, a new package and optional adapter methods. Reverting removes `deck session`/`deck cross`; existing launches never call the daemon. Session data lives only in `$XDG_STATE_HOME/deck/sessions/` and can be deleted.
3. **S4** web listener is off unless `deck session web enable` is run; rollback = disable + revoke devices.
4. **S5** TUI entry is a separate screen path; reverting hides it without touching runner install flows.
A kill switch `crossRunner.enabled: false` disables daemon session creation without uninstalling.

## Success criteria

- A session whose Lead runs on runner A delegates to members on runners B and C, survives a client disconnect, resumes from a cursor, relays an approval, and continues a prior task on the same native session.
- The four compiled binaries contain the daemon, web assets and schemas; the host binary passes a smoke run from outside the repository.
- No runner credential is ever read or stored by Deck (asserted by tests).
