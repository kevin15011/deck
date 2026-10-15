# Spec: Cross-Runner Session Core

> RFC 2119 keywords are normative. Scenarios use Given/When/Then. Requirement IDs (`XR-*`) are referenced by [tasks.md](tasks.md). Design rationale lives in [design.md](design.md).

## Glossary

| Term | Meaning |
|---|---|
| **Session** | One Deck-supervised unit of work bound to at most one OpenSpec change, owned by the daemon. |
| **Member** | A Developer Team role (`lead`, `investigate`, `architect`, `apply-fast`, `apply-deep`, `quality`, `setup`). |
| **Assignment** | Runner-qualified `{runnerId, modelId, thinking?}` for one member. |
| **Task** | One unit of work for one member; the initial Lead task is `lead`, and subsequent Lead generations use distinct task IDs such as `lead-gN` while retaining member `lead`. |
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

**XR-4.3** Each driver MUST start the unmodified native CLI as the current user, with a Deck-computed **explicit** MCP set and unrelated user-global MCP servers, plugins and hooks excluded, using the per-runner isolation mechanism verified for its tested version. The configured official native memory integration MAY be selectively admitted only through verified canonical project preparation (XR-7.2–7.3).

| Runner | Required mechanism (verified by contract test before enablement) |
|---|---|
| Claude | `-p --input-format stream-json --output-format stream-json --verbose`, `--strict-mcp-config --mcp-config <0600 file>`, only reviewed memory hooks admitted when enabled, never `--bare`. |
| Codex | `codex app-server` over stdio; unrelated inherited MCP/plugin endpoints and hooks disabled, explicit child MCP and reviewed memory hook configuration, effective configuration and actual MCP set verified before prompt delivery. Keep native authentication storage untouched. |
| OpenCode | `opencode serve` on 127.0.0.1, Deck-owned config directory, config content supplied by Deck, user MCP servers absent from the probed tool list. |

**XR-4.4** The explicit MCP set MUST equal the packages Deck configured for that runner, minus competing or unverified adaptive-memory registrations, plus the Deck session MCP server and any MCP required by its verified official native memory integration. Admission MUST NOT activate unrelated inherited plugins, hooks or delegation.

**XR-4.5** Drivers MUST expose the native session identifier as soon as the native CLI reports or accepts it, and the daemon MUST persist it in the ledger before the first prompt is delivered when the runner allows caller-assigned IDs (Claude `--session-id`).

**XR-4.6** Each driver MUST declare a tested version range. Detection below the minimum MUST block; above the maximum tested MUST warn (`degraded`) and continue.

**XR-4.7** Secrets for the Deck session MCP MUST be passed by `0600` file path, never in argv or inline config strings.

**XR-4.8** Claude cross turns MUST receive the trusted project's root `AGENTS.md`, when present, as explicit project instruction context with source provenance. Selection MUST use the task's actual runner assignment, including resumed and delegated tasks. The reader MUST enforce a bounded regular UTF-8 file, reject symlinks and unsupported files, and fail visibly instead of silently truncating or omitting an invalid present file. Codex and OpenCode MUST retain their native instruction loading without this extra injection. This MUST NOT enable unrelated settings, plugins or hooks.

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

**XR-5.3** Approval policy per runner MUST be one of `relay` or `runner-default`. Claude, OpenCode and Codex MUST default to `runner-default`, mapping to native execution without permission prompts. Explicit `relay` configuration MUST remain an opt-in and MUST NOT be silently migrated on upgrade. Native delegation restrictions and session tool authorization MUST remain enforced independently of permission prompting.

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

**XR-6.8** A session MUST NOT exceed `maxConcurrentTasks` concurrent delegated tasks (default 4); excess delegations MUST queue. The Lead has a separate coordinator slot and does not consume a delegated-task slot. Both remain subject to the separate global pools defined by XR-13.8.

#### Scenario: Owner-contract continuation across runners
- **Given** task T for `architect` ran on Codex with native thread N and completed
- **When** the Lead (on Claude) calls `deck_delegate {agent: "architect", task: "...", continueTaskId: T}`
- **Then** the Codex driver resumes thread N and the ledger appends attempt 2 to T

---

## XR-7 Shared services

**XR-7.1** A session MUST bind to at most one OpenSpec change; binding (at creation or later via `session.bindChange`) MUST be immutable once set.

**XR-7.2** When adaptive memory is enabled, Claude, Codex and OpenCode executions MUST use their configured official native memory integration, prepared with the same canonical identity as normal Deck developer launches. Each execution MUST have only one memory integration: native-owned executions MUST NOT also receive or be authorized to call daemon memory tools (`deck_memory_recall`, `deck_memory_propose`). Pi's existing Deck integration remains unchanged. An unsupported or unavailable native integration MUST be reported explicitly; there MUST NOT be a silent daemon fallback.

**XR-7.3** Native memory preparation MUST reuse existing canonical project scope and protected credential/profile resolution. Missing or contradictory scope MUST prevent memory activation; default namespaces are forbidden. Credentials MUST remain in private files or spawn environment and MUST NOT appear in public descriptors, events or argv. Lead context MUST identify the actual provider, integration and readiness. Runtime support and automatic capture limitations MUST be stated from evidence rather than inferred from plugin installation. Legacy daemon-owned memory operations retain their deduplication and project-isolation guarantees.

Native integration readiness MUST distinguish plugin activation from confirmed automatic capture. Where a native lifecycle does not expose or await background capture completion, Deck MUST report that limitation and MUST NOT fabricate a successful write or add an arbitrary delay as proof. Native explicit tools MAY remain available with that capability limitation.

#### Scenario: Native memory parity without duplicate writers
- **Given** a configured official memory integration and a valid canonical project identity
- **When** a cross Lead or delegated execution is prepared
- **Then** it receives the same project scope as a normal developer launch, only the selected native integration is admitted, and daemon memory tools are neither advertised nor authorized

#### Scenario: Native memory cannot safely activate
- **Given** an absent or conflicting scope, plugin registration or required native capability
- **When** cross prepares the execution
- **Then** it reports the concrete failure without activating a default project namespace or silently substituting daemon memory

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

**XR-8.11** Activity MUST show detailed Lead execution evidence rather than generic session lifecycle notifications. Tool entries MUST preserve observed names, inputs, results and failure states, correlate only using native call identity within execution boundaries, and remain truthful when history is incomplete. Runner-exposed reasoning MUST preserve text identity and delta/snapshot semantics; availability MUST NOT be fabricated. Skills MAY be labeled as invoked only when explicit native tool evidence establishes invocation. Child/internal events and opaque raw payloads MUST NOT appear in this view. Normalized activity details MUST be bounded and sanitized before persistence.

**XR-8.12** The web client MUST provide visible feedback immediately when a prompt is submitted and while the Lead is active, without requiring the Activity tab. Feedback MUST distinguish pending submission, explicit runner/tool preparation, available reasoning/tool/output evidence, approval waiting and reconnection; it MUST NOT fabricate an internal activity phase. Failed submission and terminal events MUST clear obsolete progress. Session switching and replay MUST NOT mix progress across sessions or treat child activity as Lead progress. Preparation diagnostics MUST record actual boundaries and bounded non-sensitive timings without changing execution sequencing or claiming unmeasured performance improvements.

**XR-8.13** Activity MUST include all native hook lifecycle events exposed for the Lead, with observed identity, lifecycle name, outcome and duration where available. Provider attribution MUST require trusted evidence; generic hook completion MUST NOT be presented as successful memory recall or storage. Missing completion MUST remain unknown. Hook display MUST preserve execution scope, replay deduplication, bounded/redacted content and accessibility, without exposing raw commands, credentials or plugin paths. Observability MUST NOT enable extra hooks. Explicit memory tool calls MUST retain a single existing tool entry rather than duplicate synthetic memory entries.

#### Scenario: A native hook runs
- **Given** a runner reports a hook start and completion for the current Lead execution
- **When** Activity receives or replays those events
- **Then** one correlated hook entry shows the actual lifecycle and outcome, with a provider label only when trustworthy attribution exists

#### Scenario: Native memory has no observable receipt
- **Given** a plugin is configured but the native protocol exposes no corresponding hook or operation event
- **When** the Lead executes
- **Then** Activity does not invent a recall, capture or hook success based on configuration alone

#### Scenario: Lead preparation before first output
- **Given** a submitted prompt is accepted while its runner is still preparing
- **When** no reasoning, tool or response event has arrived yet
- **Then** the UI displays immediate submission/waiting or explicitly reported preparation feedback
- **And** later native events update that feedback without inventing thoughts or file changes
- **And** failure, completion, session switching and reconnect replay preserve truthful per-session status

#### Scenario: Detailed Lead activity
- **Given** the Lead uses tools while its runner exposes reasoning text and a child emits separate activity
- **When** the client receives live events or replays them
- **Then** Activity shows the Lead's correlated tool inputs/results and available reasoning without duplicating cumulative snapshots
- **And** child activity, session lifecycle noise and unreported skill or thought claims are absent
- **And** incomplete or interrupted tool history is not presented as a successful execution

#### Scenario: Activity following and viewport containment
- **Given** Activity receives live or replayed events in the desktop or mobile workspace
- **When** the reader is following the latest content
- **Then** the Activity pane MUST follow incoming entries and growing reported content
- **And** scrolling up or opening details for reading MUST preserve the reader's position, with an explicit action to return to the latest content
- **And** switching sessions or tabs MUST preserve each session's reading/following state
- **And** the application MUST remain within the viewport, with scrolling inside content panes rather than an empty document region beneath the workspace

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

---

## XR-13 Project and session workspace (authorized 2026-10-15)

**XR-13.1** `deck web` MUST start or reuse the existing per-user daemon, enable its loopback web listener and expose/open its URL independently of the caller's working directory. It MUST NOT create a project session implicitly or mutate runner installations. Existing `deck cross developer` and daemon/session commands MUST remain compatible.

**XR-13.2** The daemon MUST persist a project registry with stable identifiers, canonical directories, display names and timestamps in private user state. Registration MUST deduplicate canonical directories and MUST be serialized by the owning daemon. Existing session roots MUST be imported idempotently without changing session identifiers, histories, native owners or canonical memory identity. Missing directories MUST remain visible as unavailable, not be silently substituted.

**XR-13.3** Directory completion MUST use the existing authenticated web boundary, remain confined to the daemon user's canonical home, and return bounded direct-child directory suggestions only. It MUST reject traversal and symlink escapes, avoid recursive scanning and file-content reads, and preserve Host/Origin/device defenses. Directory validation MUST be repeated at relevant registration/creation boundaries. Legacy CLI-created project history outside the completion boundary MUST NOT be deleted.

**XR-13.4** The web client MUST offer project selection, explicit new-session creation and paginated per-project session history. Two explicitly created sessions in the same project MUST have distinct histories/native owners. Session drafts and navigation MUST remain scoped to the selected session. The interface MUST make other active sessions sharing the working directory discoverable; independent histories MUST NOT imply filesystem isolation.

**XR-13.5** Session preparation MUST validate current project/assignment/instruction/tool prerequisites without a model prompt or fabricated native-ready claim. Preparation state MUST be queryable and invalidated by relevant assignment/configuration/recovery changes. Concurrent preparation/cancellation/close MUST settle owned resources and prevent a stale success from enabling execution. The web composer MUST retain drafts and be gated by transport connectivity and required preparation. Actual turn admission MUST revalidate prerequisites rather than trust a stale browser-ready flag.

**XR-13.6** Web Close session MUST release only the selected session's owned resources and return it to unprepared readiness while preserving its ID, history, drafts, attachments and compatible native identifiers. Release intent MUST be durable before cancellation and gate admission, recovery and stale callbacks until explicit preparation. Preparation MUST reopen legacy ended sessions in place after ownership settles, without silently retrying interrupted work. Ordinary Close/Prepare MUST NOT create a successor. Existing explicit terminal `session.stop` and linked `session.continue` APIs remain compatible; browser detachment remains separate. Unsettled ownership MUST prevent false release success and replacement execution.

**XR-13.7** Assignment overrides MUST be scoped to the selected session, persisted before admission and visible in the UI. Historical events and recorded delegated task owners MUST remain immutable. A Lead change MUST be serialized against prompts/delegation/wake delivery and rejected while relevant work or approvals remain pending. The new Lead generation MUST retain prior Deck conversation and record the transition. Native session identifiers MUST NOT cross runners; native context may be reused for a model change only with a tested adapter capability. Otherwise a new native context MUST receive an explicit bounded handoff.

**XR-13.8** The daemon MUST provide configurable global admission limits for Lead turns and delegated executions in addition to per-session delegated limits. Lead and delegated capacity MUST be separate and positive, so Leads waiting for children cannot exhaust all child capacity. Waiting sessions MUST receive fair round-robin admission with FIFO within each session. Queued cancellation MUST remove only its own ticket, and capacity MUST NOT be released before owned native handles have drained. Queue state MUST be visible without being misrepresented as model reasoning. Limits apply to native task handles, not every shared MCP/helper process.

**XR-13.9** New commands, persisted records and event kinds MUST have strict validation, bounded payloads, generated schemas where applicable, idempotent command behavior and recovery tests. Runtime model options MUST originate from existing configured runner discovery and retain actual runner/model provenance; catalog availability MUST NOT imply authenticated or model-ready execution.

**XR-13.10** Sidebar session indicators MUST represent the current Lead's actual state independently of delegated work, and subagent indicators MUST represent the corresponding task. Ongoing work MAY use subtle SVG animation, disabled under reduced-motion preferences. States MUST have accessible text and distinguishable shapes rather than color alone. Background session status queries MUST remain authenticated, bounded and scoped to the requested project.

**XR-13.11** Unread Lead responses MUST derive from public nonempty completed assistant messages, not arbitrary event cursors or task completion. The host MUST recover the reply projection across restarts and Lead generations. Browser-local read markers MUST advance only when the relevant rendered response is visible in a visible, focused page; selecting a session alone MUST NOT acknowledge it. Subagent response indicators MUST follow equivalent visibility semantics. Read state MUST NOT mutate runner or backend session history.

**XR-13.12** Entering or switching a chat MUST show the latest messages after history renders. Subsequent incoming events MUST preserve a user's manual upward reading position, with an explicit way to return to the latest messages. Hidden mobile chat panes MUST defer visibility-based acknowledgement until shown.

**XR-13.13** Each project row MUST expose accessible rename and remove actions independently of disclosure and session creation. Rename MUST persist a validated display name without changing project identity or directory. Removal MUST persistently hide the project from the workspace catalog without deleting files/history or stopping sessions. Automatic legacy import MUST NOT restore hidden projects; a new explicit registration of the same canonical directory MUST restore the original identity and history. Project mutations MUST retain authentication, bounded validation and durable idempotency. Removing an inactive project MUST preserve the current conversation; removing the active project MUST clear stale displayed selection without discarding saved drafts/history.

Restoring an already persisted hidden legacy project outside home MAY bypass only the new-registration home check when canonical resolution exactly matches its recorded identity/path. This MUST NOT admit new outside-home projects, widen directory browsing or restore a root replaced by a different canonical target.

#### Scenario: Project-independent launch and multiple sessions
- **Given** the user launches the web from an unrelated directory
- **When** they add a project and explicitly create two sessions
- **Then** both sessions have independent history, survive restart, and can be selected without changing their recorded native owners
- **And** registration and selection do not send a model prompt

**XR-13.14** Each session row MUST expose independent accessible Rename session and Remove session actions. Rename MUST durably validate a nonempty title of at most 160 characters without changing identity/history. Remove MUST durably fence new work, release selected owned resources, then hide the session from catalogs after ownership settles, without deleting project files or saved history. Removed-session mutations MUST be refused; existing authenticated history/attachment read authorization remains unchanged. Lifecycle command identity MUST survive receipt eviction so stale retries cannot reapply release/stop or metadata mutations after newer lifecycle changes. Selection, drafts, themes and compact row geometry MUST remain intact.

**XR-13.15** Each session row MUST show a small connection dot left of its name: green only for authoritative prepared readiness and gray otherwise. Accessible status text MUST supplement color. Recovery/release MUST invalidate ready state. This indicator MUST remain independent of active-work and unread-response indicators, and MUST NOT imply a permanently running or prewarmed model.

#### Scenario: Prepare, close and prepare again
- **Given** a recovered session with a saved draft
- **When** preparation succeeds, work runs, and the user closes that session
- **Then** the draft and history remain, owned resources drain, readiness becomes unprepared, and another session continues unaffected
- **And** preparing again enables the same session ID and compatible native continuity, with the connection dot changing from gray to green

#### Scenario: Change the Lead's runner
- **Given** an idle session with prior Claude messages and recorded child tasks
- **When** the user chooses a Codex Lead for that session
- **Then** the revision survives restart, old messages retain their original provenance, and the next Codex turn receives transferred context with a new native identifier
- **And** prior child continuations retain their original assignments and the global team defaults are unchanged

#### Scenario: Global budgets with waiting Leads
- **Given** multiple sessions with Leads waiting for delegated task results
- **When** both execution pools are under load
- **Then** delegated capacity remains independently available, queued sessions receive fair admission, and cancelled tickets never launch later

## XR-14 Queued user messages (authorized 2026-10-15)

**XR-14.1** Sessions MUST accept bounded user messages while the Lead works, persist accepted messages before acknowledgement and feed them in FIFO order into the existing single-Lead scheduler. Queue identity MUST use the originating command identifier and remain deduplicated across retries, restart and command-receipt eviction. Limits MUST be enforced server-side: 32 pending items, 1 MiB aggregate pending UTF-8 text and the existing 262,144-character per-message bound.

**XR-14.2** Queued acceptance MUST be distinguishable from native admission. A pending item MUST NOT be attributed to an unrelated active task attempt or obscure the current Lead's progress. The web MUST show pending message previews/order and a cancel action, clear drafts only on durable acceptance, and preserve session-local drafts on failure/navigation.

**XR-14.3** Cancellation MUST succeed only before native admission, including while waiting for global capacity; cancellation/admission MUST have exactly one winner. Interrupting or cancelling the current Lead MUST durably pause the remaining queue before aborting work. A single explicit resume command MUST continue remaining work only after native ownership settles. Sending while paused MUST NOT silently resume it. Failures after acceptance MUST remain visible and pause subsequent messages without silently retrying the failed item.

**XR-14.4** Explicit terminal session stop MUST cancel pending messages while preserving their history. Web Close session MUST instead retain and pause pending messages until successful preparation and explicit Resume queue; an empty release-induced pause MUST clear on successful preparation. Assignment changes MUST reject while pending, active or uncertain work exists. Graceful daemon shutdown MUST retain never-dispatched messages. Recovery MAY drain never-dispatched items automatically only for enabled, provably settled sessions without a durable pause or release/removal intent. Already dispatched or uncertain native attempts MUST NOT be automatically replayed.

**XR-14.5** User FIFO work MUST precede new internal wake reservations. Internal wakes already reserved before user acceptance MAY finish without preemption; reservation does not move the native-admission fence for user delivery or cancellation. Already admitted turns MUST finish normally. Pending child notices MUST retain provenance and existing delivery accounting, MUST NOT be rewritten as user text and MUST NOT be delivered again after inclusion in a user turn. Bounded notice payloads MUST preserve notices not included for later delivery. Paused or ownership-blocked inbox entries alone MUST NOT be treated as native running work for daemon restart guards.

## XR-15 Image attachments (authorized 2026-10-15)

**XR-15.1** The web composer MUST accept user-pasted image bytes, multiple images with optional text, and image-only messages. It MUST show removable draft thumbnails above the input and retain drafts on upload/send failure. Ordinary text paste MUST remain intact. Browser-local clipboard capture and HTTP byte transfer MUST avoid dependence on daemon operating-system clipboard utilities or client filesystem paths.

**XR-15.2** Attachments MUST use authenticated session-scoped upload/read operations and opaque server-owned identifiers. Supported formats MUST be PNG, JPEG and WebP, validated independently of filenames and claimed MIME. Limits MUST be eight images per message, 5 MiB per file, 20 MiB per message, 16,384 pixels per axis and 40 megapixels. The existing JSON command size limit MUST remain enforced. Reads MUST reject traversal, unsupported identifiers, cross-session references and unsafe private-file substitutions.

**XR-15.3** Accepted messages MUST durably bind exact ordered attachment identities, preserve FIFO/cancellation/recovery semantics, and include those identities in command deduplication. Files referenced by accepted messages MUST remain available for queued execution and history after restart. Unreferenced staging MUST be bounded and expire without deleting accepted references. Public events and UI metadata MUST exclude local paths and image payload bytes. A failed send MUST NOT clear draft attachments or attachments newly added during submission.

**XR-15.4** Supported cross drivers MUST deliver images using their verified native structured input, including first and resumed turns. Subsequent turns MUST NOT inherit a previous turn's attachments. Missing/oversized storage or native rejection MUST surface a failure rather than silently sending only text. Binary/base64 payloads MUST NOT be retained in diagnostic events. Native protocol verification MUST be distinguished from actual model vision support.

**XR-15.5** Queued and delivered messages MUST present compact image references and an accessible preview modal with zoom, keyboard dismissal and focus restoration. Previews MUST remain usable after replay/reload. Session navigation and asynchronous upload completion MUST NOT mix drafts, and temporary browser URLs MUST be released when no longer needed. Existing themes, responsive layout and active Lead feedback MUST be preserved.
