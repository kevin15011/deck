# Cross-runner sessions

> **Audience:** People running a personal Developer Team across native CLIs.
> **Authority:** Operational guide; the [session specification](../openspec/changes/cross-runner-session-core/spec.md), configuration schema and source define behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [CLI composition](../apps/cli/src/session-service.ts), [session host](../packages/session-host/src/session-manager.ts), and [acceptance record](../openspec/changes/cross-runner-session-core/apply-progress.md).

Cross sessions assign a runner and model to each team member. A Claude Lead can delegate to Codex or OpenCode through Deck's task tools. Install and sign in to each native CLI beforehand. Cross configuration changes Deck preferences; it does not install runners or change their native model assignments. Pi remains available through its native Deck workflow and is not a cross-session driver.

## Start and reconnect

In the TUI, choose **Start installation → Cross runner**, then select each member's runner, model and thinking level. Review and save the configuration. This writes only `crossRunner` in Deck's global config; the review performs no installations. Alternatively, configure `crossRunner.members` directly, including a `lead` assignment. Each entry has `runnerId`, `modelId`, and optional `thinking`. Missing member assignments cannot receive delegated tasks. Run `deck session status --json` to inspect driver readiness.

From the project directory, run `deck cross developer`, optionally with `--change <id>`. The command creates or attaches to a session and starts the daemon on demand. Use `/tasks` to inspect tasks, `/interrupt` to interrupt the Lead and `/detach` to leave the client. Detaching or closing the browser does not cancel work. `deck session list`, `attach <id>`, `stop <id>` and `prune` manage session history and lifetime.

Continuation keeps a task's original runner, model and native session. Configuration changes affect new tasks. A confirmed missing native session triggers one bounded reseed from Deck's recorded task history; an authentication or transport error does not silently replace context. After a daemon crash, unresolved process ownership blocks continuation until it is proven settled. Inspect potentially completed effects before continuing interrupted work.

An OpenSpec change binding is optional but immutable once assigned. Runtime events and task state stay under `$XDG_STATE_HOME/deck/sessions` (normally `~/.local/state/deck/sessions`), separate from the project's OpenSpec documents.

The default limit is four concurrent delegated tasks plus the Lead's separate coordinator slot. Excess delegated tasks queue; changing `maxConcurrentTasks` does not change the coordinator slot.

## Manage the daemon

The daemon is a detached local process that owns cross sessions and the browser listener. Closing the terminal with Ctrl+C, using `/detach`, or closing a browser tab leaves it running. Deck starts it on demand; it is not a launchd/systemd service. It shuts down automatically after about 30 minutes with no work, pending approvals or connected clients. A connected browser tab keeps it alive.

Use the executable whose build you want to run: replace `deck` with `deck-canary` for the installed canary.

| Command | Behavior |
|---|---|
| `deck daemon start` | Start the daemon if absent; keep the existing one if already running. |
| `deck daemon status` | Show daemon state without starting it. |
| `deck daemon stop` | Gracefully stop an idle daemon; succeed without starting anything if already stopped. |
| `deck daemon restart` | Stop an idle daemon, wait for shutdown, and start the invoking Deck executable; start it if absent. |

All four commands accept `--json`. Stop and restart refuse while tasks or approvals are pending; finish or explicitly cancel that work first. There is no force option. Errors and timeouts return a nonzero exit status rather than claiming a successful shutdown. Neither operation deletes session history or changes a session's recorded runner/model. Clients disconnect during a restart; reopen the cross client or reload the browser afterward.

After installing a new canary build, run `deck-canary daemon restart`. Updating the executable alone does not replace a running process, and automatic version checks do not distinguish different builds with the same version number. `deck` and `deck-canary` address the same daemon when they use the same HOME/XDG state directory.

`deck session stop <id>` ends one session; `deck daemon stop` stops the process that serves all sessions. A resumed session keeps its original Lead assignment. To use a newly configured runner/model, create a new session rather than expecting restart to migrate native context.

## Local browser and approvals

Open the daemon's local URL to enter the desktop client directly. No code or pairing confirmation is needed on this machine. A same-origin loopback request automatically obtains an HttpOnly, SameSite=Strict device cookie; the daemon stores only its hash. Forwarded access still requires a single-use pairing link or code, valid for five minutes.

For forwarded access, use `deck session pair` to obtain a link/code. Use `deck session devices` to list devices, and `deck session devices revoke <id>` to revoke one. `deck session web status|enable|disable` controls the listener. `deck cross developer` offers to open the browser interactively; it opens only after confirmation.

The browser separates the Lead conversation from its workspace. Chat renders user and Lead messages as Markdown. **Activity** shows tools and operational events; **Subagents** shows delegated tasks, their recorded runner/model and results; **OpenSpec** renders the project's change documents. Collapse the session sidebar to gain reading space. On narrow screens, switch between full-width views using the navigation controls.

Use the sun/moon button in the header to switch between light and dark themes. Dark is the default. Your selection is saved in this browser for the same access address and restored when you reload or reopen the page. It is independent of the session and does not change other devices' preferences. Clearing site data resets it to dark; if browser storage is blocked, switching still works for the open page.

The message field starts as one line and grows automatically to four lines. Longer text scrolls inside the field. Enter sends the message; Shift+Enter adds a line. Deleting text or sending the message shrinks the field again.

OpenSpec is read-only. A bound session shows its own change; an unbound session can browse active changes without changing its binding. Select a Markdown artifact to read it, use Refresh for an immediate update, or keep the view open for automatic updates. Archived changes, symlinks, non-Markdown files and documents larger than 1 MiB are unavailable. This does not grant access to arbitrary repository files. Raw HTML and automatic remote images are disabled in Markdown views.

Reconnection replays events from its last cursor. Reading older messages pauses automatic following; use Jump to latest to resume. Pending approvals remain visible across views and survive disconnect; another paired client may answer them. The first valid response wins. Unanswered requests time out as denied.

Claude and OpenCode use approval relay by default. Codex defaults to its approved unrestricted execution policy (`runner-default`); select `crossRunner.approvals.codex: "relay"` to request sandboxed approval relay. This default is powerful: start sessions only in projects where you authorize the assigned tasks. Process containment manages lifecycle, not filesystem rollback or a security sandbox.

## Memory and tools

Each child gets the explicit MCP package set selected for its runner plus Deck's session bridge. Native memory integrations are excluded. When adaptive memory is enabled, Deck's daemon composes the existing project-scoped Supermemory runtime; members recall through `deck_memory_recall` and submit proposals through `deck_memory_propose`. One serialized writer deduplicates successful proposals per session. Memory is advisory and does not override OpenSpec.

Web Search uses the configured provider and its existing credential environment variable. Credentials are passed in process environment, not command arguments or event payloads. A missing credential fails the configured tool setup instead of silently enabling another provider.

Codebase Memory is checked through its actual MCP protocol before the native runner starts. For the reviewed native build, Deck keeps a private runtime connected across turns while preserving the existing graph cache. A slow first initialization is separate from model inference; later turns check the retained connection. An unhealthy runtime gets one bounded recovery attempt, then a short retry backoff. Deck does not kill another client's daemon or quietly drop the selected tool. Unsupported builds and failed readiness appear as a failed turn in the conversation. Claude text arrives progressively once its native turn begins.

## Personal-use and security boundary

Deck starts the unmodified native CLIs as the signed-in OS user. Native CLIs retain responsibility for their own authentication; Deck does not read or copy their credential files or substitute API keys for native subscriptions. User-global MCPs, hooks and native delegation are excluded through the tested per-runner mechanisms. See the [driver matrix](reference/support-matrix.md#cross-runner-session-drivers) for their exact scope.

Claude setup and launch use the existing native login without a separate subscription notice or acknowledgement step. Legacy acknowledgement settings remain readable but do not gate sessions.

The listener binds only `127.0.0.1`. Host and Origin checks, strict content security policy and device authentication protect the browser surface; it exposes no session bridge, daemon administration or file browser. Forwarding headers are rejected unless explicit proxy/origin configuration permits them; device authentication still applies. No exposure command runs automatically.

This feature is for one user on one machine. It provides no shared daemon, remote runner credentials, OS service, mobile/PWA installation, push notifications or automatic network exposure. Tailscale is not required. Automatic local access trusts processes and browsers that can reach this machine's loopback interface, including other local OS accounts. It is not an OS-user authentication boundary. Foreign web origins and forwarded requests cannot use the local bootstrap; remote access still requires a device credential.

## Verification and downgrade

`deck session self-test` checks embedded assets and contract schemas without network access. Live driver checks are opt-in; normal tests use fake runners and provider transports. The [acceptance record](../openspec/changes/cross-runner-session-core/apply-progress.md) distinguishes native checks, compiled runtime checks and build-only platforms.

Older Deck versions reject the unknown `crossRunner` config key. Before downgrading, stop active sessions and remove that key from Deck's global config. Preserve session data if you intend to return to a compatible version.
