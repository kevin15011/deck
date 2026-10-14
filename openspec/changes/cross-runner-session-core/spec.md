# Spec: Cross-Runner Session Core

> RFC 2119 keywords are normative. Scenarios use Given/When/Then. Requirement IDs (`XR-*`) are referenced by [tasks.md](tasks.md). Design rationale lives in [design.md](design.md).

## Glossary

| Term | Meaning |
|---|---|
| **Session** | One Deck-supervised unit of work bound to at most one OpenSpec change, owned by the daemon. |
| **Member** | A Developer Team role (`lead`, `investigate`, `architect`, `apply-fast`, `apply-deep`, `quality`, `setup`). |
| **Assignment** | Runner-qualified `{runnerId, modelId, thinking?}` for one member. |
| **Task** | One delegated unit of work for one member; the Lead conversation is task `lead`. |
| **Driver** | Adapter-owned `RunnerSessionDriver` that runs a task inside the native CLI. |
| **Client** | Terminal client, desktop web client, or TUI attached to the daemon. |
| **Cursor** | The per-session monotonically increasing event sequence number (`seq`). |

---

## XR-1 Contracts (`@deck/core`)

**XR-1.1** Core MUST define versioned `deck-session-event-v1` and `deck-session-command-v1` types with pure runtime validators; core MUST NOT import Node process, network, or filesystem APIs for them.

**XR-1.2** Every event MUST carry `v`, `sessionId`, `seq`, `ts`, `kind`, `source {memberId?, taskId?, runnerId?, nativeSessionId?}` and `data`. `seq` MUST start at 1 and increase by exactly 1 per persisted event.

**XR-1.3** An event MAY carry `raw {runnerId, protocol, payload, truncated}`. `raw.payload` MUST be redacted and bounded (default 64 KiB) before persistence.

**XR-1.4** Unknown runner-native messages MUST surface as `runner.unmapped` events with `raw`, never as a driver crash.

**XR-1.5** Commands MUST carry a client-generated `commandId`; the daemon MUST treat a repeated `commandId` within a session as idempotent and return the original outcome.

**XR-1.6** Core MUST define `RunnerQualifiedAssignment {runnerId, modelId, thinking?}` and `CrossTeamAssignments = Record<memberId, RunnerQualifiedAssignment>`. `DeveloperTeamModelAssignments` MUST remain unchanged for runner-native use.

#### Scenario: Unknown native message
- **Given** a driver receives a JSON message whose type it does not map
- **When** it processes the message
- **Then** it emits one `runner.unmapped` event containing the redacted raw payload and the task continues

#### Scenario: Duplicate command
- **Given** a client sent `prompt.send` with `commandId` C and it was accepted
- **When** the client resends the same command with `commandId` C after a reconnect
- **Then** the daemon returns the original acceptance and does not start a second turn

---

## XR-2 Configuration and migration

**XR-2.1** Deck config MUST accept an optional `crossRunner {enabled, members: CrossTeamAssignments, approvals?, web?}` section in the existing global `config.json`; absence MUST mean "not configured" with no behavior change.

**XR-2.2** A member value given as a bare string (legacy flat shape) MUST normalize to `{runnerId: <crossRunner.defaultRunner or "claude">, modelId}` and emit a deprecation diagnostic; writes MUST persist the qualified shape.

**XR-2.3** Per-runner native assignments read through `RunnerAdapter.readModelAssignments` MUST NOT be modified by cross configuration.

**XR-2.4** A member assignment whose runner has no registered session driver, or whose runner is not installed, MUST be reported as `blocked` with a reason code at session creation and in Doctor.

#### Scenario: Legacy flat member value
- **Given** `crossRunner.members.lead` is the string `"sonnet"`
- **When** config is read
- **Then** the normalized lead assignment is `{runnerId: "claude", modelId: "sonnet"}` and a `CROSS_ASSIGNMENT_LEGACY_SHAPE` warning is reported

---

## XR-3 Daemon lifecycle and persistence

**XR-3.1** At most one daemon MUST run per OS user. It MUST start on demand from a client command and MUST stop after a configurable idle period (default 30 min) with no live session and no attached client.

**XR-3.2** Session data MUST be stored under `$XDG_STATE_HOME/deck/sessions/<sessionId>/` (default `~/.local/state/deck/sessions/`) with directories `0700` and files `0600`. No session data MUST be written inside a project repository.

**XR-3.3** The event log MUST be append-only JSONL. The ledger MUST be a projection rebuildable from the event log; a snapshot MAY exist for fast load.

**XR-3.4** A client disconnect MUST NOT stop, pause, or cancel a session or task.

**XR-3.5** A client MUST be able to resume with `after=<seq>` and receive every persisted event with `seq > after` in order, then live events, without gaps or duplicates.

**XR-3.6** Each child CLI MUST run under a Deck process-group anchor that terminates its group when the daemon's IPC channel closes. Recovery MUST NOT signal any PID read from disk.

**XR-3.7** On daemon start, tasks persisted as running MUST become `interrupted` (reason `daemon-restart`) once their containment is proven settled; otherwise they MUST become `ownership-unsettled` and continuation MUST be refused until settled.

**XR-3.8** The daemon MUST NOT read, write, log, or transmit runner credential files or OAuth tokens.

#### Scenario: Reattach after browser disconnect
- **Given** a web client saw events up to `seq` 120 and its tab was closed
- **When** it reconnects with `after=120` while the session produced events 121–140
- **Then** it receives 121–140 in order followed by live events

#### Scenario: Daemon crash
- **Given** a task is running under an anchor and the daemon process is killed
- **When** the anchor detects IPC loss
- **Then** the child process group is terminated, and on the next daemon start the task is `interrupted` with reason `daemon-restart` and can be continued by owner-contract re-delegation

---

## XR-4 Runner session drivers

**XR-4.1** `RunnerAdapter` MUST gain an optional `getSessionDriver()`; adapters without it MUST be excluded from cross assignments.

**XR-4.2** Drivers MUST spawn through the host-provided supervised spawn and MUST NOT spawn processes directly.

**XR-4.3** Each driver MUST start the unmodified native CLI as the current user, with a Deck-computed **explicit** MCP set and with user-global MCP servers and hooks excluded, using the per-runner isolation mechanism verified for its tested version.

| Runner | Required mechanism (verified by contract test before enablement) |
|---|---|
| Claude | `-p --input-format stream-json --output-format stream-json --verbose`, `--strict-mcp-config --mcp-config <0600 file>`, hooks disabled, never `--bare`. |
| Codex | `codex app-server` over stdio; inherited MCP/plugin endpoints disabled, hooks disabled, explicit child MCP overrides, effective configuration and actual MCP set verified before prompt delivery. Keep native authentication storage untouched. |
| OpenCode | `opencode serve` on 127.0.0.1, Deck-owned config directory, config content supplied by Deck, user MCP servers absent from the probed tool list. |

**XR-4.4** The explicit MCP set MUST equal: the packages Deck configured for that runner, minus adaptive-memory providers, plus the Deck session MCP server.

**XR-4.5** Drivers MUST expose the native session identifier as soon as the native CLI reports or accepts it, and the daemon MUST persist it in the ledger before the first prompt is delivered when the runner allows caller-assigned IDs (Claude `--session-id`).

**XR-4.6** Each driver MUST declare a tested version range. Detection below the minimum MUST block; above the maximum tested MUST warn (`degraded`) and continue.

**XR-4.7** Secrets for the Deck session MCP MUST be passed by `0600` file path, never in argv or inline config strings.

#### Scenario: Global MCP isolation
- **Given** the user has 14 global MCP servers configured for Claude
- **When** the Claude driver starts a task
- **Then** the child's init event lists only the Deck-computed MCP servers

---

## XR-5 Approvals and interrupt

**XR-5.1** Approval requests from any runner MUST become `approval.requested {approvalId, taskId, tool, summary, input}` events and be answerable with `approval.respond {approvalId, decision}` where `decision ∈ {allow, allow-once, deny}` (`allow` is accepted as an alias of `allow-once`; events and drivers always carry the normalized `allow-once | deny`; drivers MAY add `allow-session`).

| Runner | Native path |
|---|---|
| Claude | `--permission-prompt-tool mcp__deck__deck_approve`; the MCP call blocks until decision. |
| Codex | Server request `item/*/requestApproval`, reply `{decision}`. |
| OpenCode | Permission `ask`, `GET /permission`/SSE, `POST /permission/{id}/reply`. |

**XR-5.2** An unanswered approval MUST resolve as `deny` after the approval timeout (default 15 min) with `by: "timeout"`.

**XR-5.3** Approval policy per runner MUST be one of `relay` or `runner-default`. Defaults: Claude `relay`, OpenCode `relay`, Codex `runner-default` (the approved always-on bypass).

**XR-5.4** `turn.interrupt` MUST map to Claude `SIGINT` to the CLI process (not the group), Codex `turn/interrupt`, OpenCode `POST /session/{id}/abort`, and MUST produce `turn.completed {status: "interrupted"}`. If no terminal native event arrives within 10 s, the daemon MUST terminate the task's process group (TERM, then KILL after grace) and report `interrupted-forced`.

#### Scenario: Approval from the desktop web client
- **Given** a Claude child calls `Bash` under relay policy
- **When** the user clicks Allow in the web client
- **Then** `deck_approve` returns `{behavior: "allow", updatedInput}` and `approval.resolved {decision: "allow-once", by: <deviceId>}` is logged

---

## XR-6 Delegation, ledger, and owner contract

**XR-6.1** The Lead MUST be proxied: the daemon drives the Lead's turns in its assigned runner and exposes the Deck session MCP server with delegation tools to it.

**XR-6.2** Delegation tools MUST be: `deck_delegate {agent, task, continueTaskId?}` returning `{taskId}` immediately; `deck_task_wait {taskIds, timeoutSec ≤ 50}`; `deck_task_result {taskId}`; `deck_task_cancel {taskId}`.

**XR-6.3** Only the Lead MUST receive delegation tools by default; other members MUST receive memory tools and, when applicable, the approval tool.

**XR-6.4** When a delegated task reaches a terminal state while the Lead is idle, the daemon MUST start a Lead turn with a bounded completion notice unless that attempt's terminal result has already been returned through the Lead's `deck_task_wait` or `deck_task_result` call. Delivery acknowledgement MUST be scoped to the task attempt, preserve notices for unseen results and later attempts, and handle completion/wait/wake ordering. Observer reads and aborted waits MUST NOT consume Lead notices. A partial wait response MUST acknowledge only the terminal results it returns.

**XR-6.5** `continueTaskId` MUST resume the same agent on the ledger-recorded runner, model, and native session. A changed assignment MUST apply only to new tasks. Continuation of a running task MUST be refused.

**XR-6.6** If native resume fails, the daemon MUST start a new native session seeded with a bounded Deck summary of the prior task and record `continuity: "reseeded"`.

**XR-6.7** Native delegation tools in the Lead's runner (Claude `Task`/agents, OpenCode `task`, Codex multi-agent) MUST be disabled where the runner supports it; otherwise the session MUST report `native-delegation-not-disabled`.

**XR-6.8** A session MUST NOT exceed `maxConcurrentTasks` concurrent delegated tasks (default 4); excess delegations MUST queue. The Lead has a separate coordinator slot and does not consume a delegated-task slot.

#### Scenario: Owner-contract continuation across runners
- **Given** task T for `architect` ran on Codex with native thread N and completed
- **When** the Lead (on Claude) calls `deck_delegate {agent: "architect", task: "...", continueTaskId: T}`
- **Then** the Codex driver resumes thread N and the ledger appends attempt 2 to T

---

## XR-7 Shared services

**XR-7.1** A session MUST bind to at most one OpenSpec change; binding (at creation or later via `session.bindChange`) MUST be immutable once set.

**XR-7.2** When adaptive memory is enabled, the daemon MUST be the only Supermemory writer for the session; children MUST receive Deck memory tools (`deck_memory_recall`, `deck_memory_propose`) instead of native memory plugins or MCPs.

**XR-7.3** Memory writes MUST reuse the existing Supermemory runtime host and project isolation; proposals MUST be deduplicated per session.

**XR-7.4** Web search MUST use the single configured provider; the child MCP set MUST include it when enabled for that runner.

---

## XR-8 Clients and local web security

**XR-8.1** The daemon MUST expose a local control endpoint as a Unix domain socket (`0600`, parent `0700`) for CLI, TUI, and the session MCP bridge.

**XR-8.2** The web listener MUST bind only `127.0.0.1` and MUST refuse any configured non-loopback bind address. It MUST work without Tailscale or any other network tool installed.

**XR-8.3** Session web requests MUST present a valid device credential (HttpOnly, SameSite=Strict cookie; `Secure` whenever served over HTTPS). Direct local browser access MUST obtain that cookie automatically without a code or pairing confirmation, using a same-origin JSON bootstrap guarded by an exact loopback peer, Host and Origin and the absence of forwarding headers. Remote/forwarded access MUST NOT use local bootstrap and retains one-time pairing (single use, TTL ≤ 5 min, rate-limited). Device credentials MUST be stored hashed and be revocable. This local access behavior supersedes manual local pairing at the user's request on 2026-10-13.

**XR-8.4** The daemon MUST reject requests whose `Host` is not an allowed origin host (default: `127.0.0.1:<port>` and `localhost:<port>`) to defeat DNS rebinding.

**XR-8.5** State-changing web requests and WebSocket upgrades MUST pass an exact Origin check against the allowed origins; responses MUST set a strict CSP with no third-party origins.

**XR-8.6** By default the daemon MUST reject requests carrying forwarding headers (`Forwarded`, `X-Forwarded-*`) or a Tailscale Funnel marker. They MAY be accepted only when the user explicitly configures `web.trustedProxy` and the external origin in `web.allowedOrigins`; Funnel traffic additionally requires `web.allowFunnel: true`. Exposed access MUST use the same device-credential authentication as local access.

**XR-8.7** The web listener MUST expose only the client API subset (sessions, events, commands, approvals, read-only session-scoped OpenSpec Markdown artifacts); it MUST NOT expose the session MCP bridge, daemon admin operations or arbitrary repository files.

**XR-8.8** Deck MUST NOT run any network-exposure command (including `tailscale serve` or `tailscale funnel`) without an explicit user command and confirmation.

**XR-8.9** The web client MUST distinguish public Lead conversation from tools, operational notices and delegated task messages using canonical event/task identity. It MUST render safe Markdown in conversation and artifact views without executing raw HTML or unsafe links or fetching external images automatically. Desktop MUST provide collapsible session navigation and side-by-side Chat/workspace panes with Activity, Subagents and OpenSpec tabs. Narrow viewports MUST provide usable single-pane navigation and preserve drafts. Background activity MUST NOT force reading position, focus or tab changes. Pending approvals and actionable failures MUST remain discoverable across views.

**XR-8.10** Authenticated OpenSpec reads MUST derive the project root and optional immutable change binding from the session. Bound sessions MUST expose only that change; unbound sessions MAY select active changes for viewing without modifying the session. Only nested Markdown artifacts under active `openspec/changes/<changeId>` directories are supported. Reads MUST reject unsafe paths and symbolic-link escapes, bound file size/enumeration/depth, and avoid absolute-path disclosure. The viewer MUST support refresh, visible updates and missing/error states. This is a read-only artifact surface, not a file editor or lifecycle command.

#### Scenario: Separate conversation and work evidence
- **Given** the Lead replies while tools and a child task emit events
- **When** the user reads Chat
- **Then** only user and public Lead messages appear as conversation, with tools in Activity and delegated text in Subagents
- **And** replay preserves the same distinction and pending approvals remain actionable from other views

#### Scenario: OpenSpec artifact updates
- **Given** a session is bound to an active change with a Markdown artifact
- **When** the user opens OpenSpec and the artifact changes on disk
- **Then** the viewer displays safely rendered updated content while preserving the selected document
- **And** attempts to read other changes, arbitrary files or symlink escapes are rejected

#### Scenario: First local browser visit
- **Given** the web listener runs on `127.0.0.1`
- **When** its same-origin browser opens the local page without a valid device cookie
- **Then** the client automatically obtains a local device cookie and loads sessions without asking for a code
- **And** session APIs still reject unauthenticated requests, and foreign-origin, missing-origin or forwarded requests cannot bootstrap local access

#### Scenario: DNS rebinding
- **Given** a malicious page resolves `evil.example` to `127.0.0.1`
- **When** it sends a request with `Host: evil.example:<port>`
- **Then** the daemon rejects it with 421/403 before authentication

#### Scenario: Forwarded request without explicit trust
- **Given** the user has not configured `web.trustedProxy`
- **When** a request arrives carrying `X-Forwarded-For`
- **Then** it is rejected and a diagnostic is logged

---

## XR-9 Terminal and TUI

**XR-9.1** `deck cross developer [--change <id>]` MUST create or attach a session for the current project and attach a line-oriented terminal client (prompts, `/interrupt`, approval y/n, `/tasks`, `/detach`).

**XR-9.2** `deck session list|attach|stop|pair|devices|web` MUST exist. `deck cross developer` SHOULD offer to open the desktop web client at its local URL without requiring a code. Explicit pairing remains available for forwarded access.

**XR-9.3** The TUI Start installation MUST list a **cross** entry. Selecting it MUST show members; selecting a member MUST show the runner list first (only installed runners with a session driver), then that runner's models (reusing the runner's model inventory/discovery), then its thinking levels.

**XR-9.4** The cross flow MUST write only `crossRunner` config and MUST NOT run install actions; it MUST show which referenced runners still need their own installation.

**XR-9.5** An optional `deck cross expose` helper MAY print, and only after explicit confirmation run, a user-chosen reverse-proxy command (e.g. `tailscale serve`) and write the matching `web.trustedProxy`/`web.allowedOrigins`. It MUST NOT change the authentication model, MUST NOT enable Funnel by default, and its absence MUST NOT affect any other requirement.

**XR-9.6** The public CLI MUST expose `deck daemon start|status|stop|restart`, each accepting `--json`. `start` MUST be idempotent for an already running daemon. `status` and `stop` MUST NOT start a daemon; stopping an absent daemon MUST succeed without creating one. `restart` MUST gracefully stop an existing daemon, wait for its ownership to settle, start the invoking Deck executable, and verify readiness; if absent, it MUST start one. Stop and restart MUST refuse while work or approvals are pending, preserve stored sessions and history, and report bounded failures with nonzero exit status. No force option or OS service installation is part of this command contract. Explicit lifecycle commands MUST work without manual PID handling.

---

## XR-10 Distribution

**XR-10.1** Daemon code, web assets, and schemas MUST be compiled into the `deck` binary; the runtime MUST NOT resolve any repository path.

**XR-10.2** All four targets (linux-x64, linux-arm64, darwin-x64, darwin-arm64) MUST build; the host-target binary MUST pass a smoke run executed from a temporary directory with a temporary `HOME`/XDG layout.

**XR-10.3** `deck session self-test` MUST verify embedded asset integrity (manifest digest) without network access.

---

## XR-11 Observability and drift control

**XR-11.1** The daemon MUST write a structured, redacted, size-rotated log under `$XDG_STATE_HOME/deck/logs/`.

**XR-11.2** `deck session status --json` and Doctor MUST report daemon health, driver probe results (version, range status, isolation status), web listener state, and exposure configuration (trusted proxy/allowed origins).

**XR-11.3** Each driver MUST have recorded-fixture contract tests that run in `bun test` without network; an opt-in live contract script MUST re-record and compare event shapes.

**XR-11.4** Selected Codebase Memory services MUST use an explicitly reviewed executable/version contract, a Deck-owned private runtime namespace, and protocol-level readiness before native turn admission. Artifact verification MUST NOT substitute for live health checks. Concurrent preparations MUST share bounded startup/recovery without sharing caller cancellation. Recovery MUST preserve the canonical graph cache and MUST NOT signal or delete a foreign daemon endpoint. Repeated failures MUST enter bounded backoff and remain visible; selected tools MUST NOT be silently omitted.

**XR-11.5** Active native consumers MUST retain their managed MCP runtime until native drain succeeds. Unproven drain MUST persist `ownership-unsettled` and block continuation and pruning. Claude initialization MUST fail the turn when an expected MCP server is absent or not explicitly connected, even if preflight succeeded.

---

## XR-12 Personal-use policy

**XR-12.1** Claude configuration and session start MUST NOT display a subscription notice or require a separate local acknowledgement. Existing acknowledgement fields MAY remain readable for backward compatibility but MUST NOT gate readiness, trigger prompts or be populated as fabricated consent. This supersedes the previous notice/acknowledgement requirement at the user's request on 2026-10-13. Native CLI authentication remains the native CLI's responsibility.

**XR-12.2** Deck MUST NOT offer configuration for additional users, shared daemons, or remote runner credentials.
