# Cross-runner sessions

> **Audience:** People running a personal Developer Team across native CLIs.
> **Authority:** Operational guide; the [session specification](../openspec/changes/cross-runner-session-core/spec.md), configuration schema and source define behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [CLI composition](../apps/cli/src/session-service.ts), [session host](../packages/session-host/src/session-manager.ts), and [acceptance record](../openspec/changes/cross-runner-session-core/apply-progress.md).

Cross sessions assign a runner and model to each team member. A Claude Lead can delegate to Codex or OpenCode through Deck's task tools. Install and sign in to each native CLI beforehand. Cross configuration changes Deck preferences; it does not install runners or change their native model assignments. Pi remains available through its native Deck workflow and is not a cross-session driver.

## Start and reconnect

In the TUI, choose **Start installation → Cross runner**, then select each member's runner, model and thinking level. Review and save the configuration. This writes only `crossRunner` in Deck's global config; the review performs no installations. Alternatively, configure `crossRunner.members` directly, including a `lead` assignment. Each entry has `runnerId`, `modelId`, and optional `thinking`. Missing member assignments cannot receive delegated tasks. Run `deck session status --json` to inspect driver readiness.

Run `deck web` from any directory to start the daemon and open its local workspace. Use `deck web --no-open` to print the address or `deck web --json` for a machine-readable result without opening a browser. This command does not register the current directory, create a session, install runners or silently enable disabled cross-runner execution.

From the project directory, run `deck cross developer`, optionally with `--change <id>`. The command creates or attaches to a session and starts the daemon on demand. Use `/tasks` to inspect tasks, `/interrupt` to interrupt the Lead and `/detach` to leave the client. Detaching or closing the browser does not cancel work. `deck session list`, `attach <id>`, `stop <id>` and `prune` manage session history and lifetime.

Continuation keeps a task's original runner, model and native session. New delegated tasks resolve the session's member override first, then current global configuration, then its creation-time configuration. Continuing an existing delegated task preserves its recorded assignment. A confirmed missing native session triggers one bounded reseed from Deck's recorded task history; an authentication or transport error does not silently replace context. After a daemon crash, unresolved process ownership blocks continuation until it is proven settled. Inspect potentially completed effects before continuing interrupted work.

An OpenSpec change binding is optional but immutable once assigned. Runtime events and task state stay under `$XDG_STATE_HOME/deck/sessions` (normally `~/.local/state/deck/sessions`), separate from the project's OpenSpec documents.

Each session defaults to four concurrent delegated tasks plus its Lead's separate coordinator slot. Across the daemon, `crossRunner.executionBudget` defaults to `{ "lead": 2, "delegated": 4 }`. Eligible sessions take turns within each pool, and queued work remains cancellable. Separate pools let delegated tasks run while Leads await their results. These limits count native task executions, not every MCP/helper process; a slot remains occupied until native cleanup settles. Changing `maxConcurrentTasks` only changes the per-session delegate limit.

## Projects, sessions and model changes

The web sidebar groups persistent sessions by project. Add a project using folder suggestions under your home directory, then create independent sessions with their own title and history. Suggestions list direct child folders only. Existing CLI sessions remain visible, including roots outside home; a missing project stays listed as unavailable. Multiple sessions in one project share the same files. Deck does not create separate worktrees automatically.

Use the three-dot menu beside a project to **Rename** it or **Remove project** from the sidebar. Removal persists across reloads and daemon restarts; it does not delete files or history, or stop running sessions. Adding the same directory again restores the original project and its sessions. Renaming changes only the display name.

Opening a session first reconnects its event stream. Prepare the session before writing: Deck checks the project, runner and configured tools, instructions and memory without sending a model prompt. Preparation can be cancelled or retried; drafts survive connection changes. A daemon restart or Lead assignment change requires preparation again. Successful preparation does not keep a model process warm: actual turns still start or resume the runner and revalidate resources.

**Close session** stops that session's work and releases its owned resources. Its history remains visible, and **Prepare session** reconnects the same session with its history, images and compatible native context. Previously closed sessions can also be prepared in place. The shared daemon and other sessions remain available. Closing the browser only detaches the client.

Each session has a three-dot menu for **Rename session** and **Remove session**. Removal releases its resources and hides it from the list without deleting project files or saved history. A small dot to the left of the name is green when the session is prepared and gray when disconnected; it does not mean a model is permanently running.

Session model controls use the configured runners' actual catalogs. Assignments apply only to the selected session. Changing the Lead requires an idle session and creates a new native context, even when only the model changes within one runner. The Deck conversation remains visible; the new Lead receives a bounded context handoff. Old messages keep their original runner/model attribution. Switching back never reuses an earlier generation's native session. Concurrent edits are rejected when the assignment revision has changed so one browser cannot silently overwrite another.

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

`deck session stop <id>` ends one session; `deck daemon stop` stops the process that serves all sessions. Restart preserves each session's recorded Lead assignment. Use the session's model controls to change it; restarting does not migrate native context.

## Local browser and approvals

Open the daemon's local URL to enter the desktop client directly. No code or pairing confirmation is needed on this machine. A same-origin loopback request automatically obtains an HttpOnly, SameSite=Strict device cookie; the daemon stores only its hash. Forwarded access still requires a single-use pairing link or code, valid for five minutes.

For forwarded access, use `deck session pair` to obtain a link/code. Use `deck session devices` to list devices, and `deck session devices revoke <id>` to revoke one. `deck session web status|enable|disable` controls the listener. `deck cross developer` offers to open the browser interactively; it opens only after confirmation.

The browser separates the Lead conversation from its workspace. Chat renders user and Lead messages as Markdown. **Activity** shows the Lead's tool calls with inputs, available results and status, plus runner-reported reasoning when available. Routine session and connection notices are omitted. Explicit native skill calls are identified; reading a skill document remains a file read. Reasoning availability depends on the runner/model and is not guaranteed. **Subagents** shows delegated tasks, their recorded runner/model and results; **OpenSpec** renders the project's change documents. Collapse the session sidebar to gain reading space. On narrow screens, switch between full-width views using the navigation controls.

A status beside the composer appears immediately when sending, then follows reported Lead preparation, waiting, reasoning, tool use, response and approval states. It also remains visible across mobile workspace tabs. Reconnection is shown explicitly, and terminal events clear progress. Preparation timings are retained as bounded diagnostic events for troubleshooting; their final turn-start boundary is runner-specific and does not measure universal model readiness.

Session rows show the Lead's status; subagent rows show their own task status. Small SVG indicators animate during work and remain still when reduced motion is requested. A separate unread marker can remain visible while work continues. Reading markers are saved in the current browser and advance when the corresponding response is visible in the active page, rather than merely when a session is selected. They do not synchronize across devices.

Opening or switching a chat shows its latest messages after history loads. Scrolling upward afterward preserves your reading position as new messages arrive; use **Jump to latest** to resume following.

Activity follows new entries while you are near the bottom. Scroll up or open details to read without being pulled to new events; **Jump to latest activity** resumes following. Reading position is preserved when switching sessions or workspace tabs. The workspace stays within the window, with scrolling contained in its panels.

Use the sun/moon button in the header to switch between light and dark themes. Dark is the default. Your selection is saved in this browser for the same access address and restored when you reload or reopen the page. It is independent of the session and does not change other devices' preferences. Clearing site data resets it to dark; if browser storage is blocked, switching still works for the open page.

The message field starts as one line and grows automatically to four lines. Longer text scrolls inside the field. Enter sends the message; Shift+Enter adds a line. Deleting text or sending the message shrinks the field again.

Paste images into the composer or use its image picker. Thumbnails appear above the input and can be removed before sending. A message can contain only images or images with text. Supported formats are PNG, JPEG and static WebP, up to eight images, 5 MiB per image and 20 MiB per message (maximum 16,384 pixels per axis and 40 megapixels). Click an image reference in a queued or delivered message to open the zoomable preview. Upload/send errors preserve the draft; drafts remain local to the open browser session, while accepted attachments persist with session history.

Images are uploaded as bytes and stored privately by the daemon. A Windows browser connected to Deck in WSL uses the Windows browser's clipboard; the runner receives an attachment stored inside WSL. Linux and macOS use the same browser upload flow, without clipboard shell utilities or client path conversion. Clipboard image availability depends on the browser and source application; use the picker when paste supplies no image file. Claude, Codex and OpenCode receive native structured image inputs; the selected model must support images. Temporary unsubmitted uploads expire after 24 hours when staging cleanup runs; accepted history attachments are retained.

You can send another message while the Lead works. Accepted messages appear in a session-specific queue and run in order after the current turn; sending does not interrupt that turn. Remove a pending message before it starts. The queue survives page reloads and holds up to 32 pending messages, with a combined UTF-8 size limit of 1 MiB. The draft clears only after the daemon confirms it saved the message.

Interrupting the Lead or a failed turn pauses the remaining queue. **Resume queue** continues those pending messages after native work has stopped; it does not silently retry the failed message. **Close session** preserves pending messages in a paused queue; prepare the same session and resume the queue explicitly to send them. The explicit terminal stop API cancels pending messages. Changing assignments requires an empty queue. After a daemon restart, never-started messages may continue only when ownership is safely settled and the session was not released or paused; an uncertain already-started turn is not automatically replayed.

OpenSpec is read-only. A bound session shows its own change; an unbound session can browse active changes without changing its binding. Select a Markdown artifact to read it, use Refresh for an immediate update, or keep the view open for automatic updates. Archived changes, symlinks, non-Markdown files and documents larger than 1 MiB are unavailable. This does not grant access to arbitrary repository files. Raw HTML and automatic remote images are disabled in Markdown views.

Reconnection replays events from its last cursor. Reading older messages pauses automatic following; use Jump to latest to resume. Pending approvals remain visible across views and survive disconnect; another paired client may answer them. The first valid response wins. Unanswered requests time out as denied.

Claude, Codex and OpenCode default to native execution without permission prompts (`runner-default`). Claude uses `--dangerously-skip-permissions`, Codex uses unrestricted execution with approval policy `never`, and OpenCode allows tool execution while native delegation remains disabled. Set `crossRunner.approvals.<runner>: "relay"` to opt into approval relay; existing explicit `relay` settings remain unchanged when upgrading. Configuration changes apply to the next turn. Start sessions only in projects where you authorize the assigned tasks. Process containment manages lifecycle, not filesystem rollback or a security sandbox.

Claude cross turns also receive the project's root `AGENTS.md` explicitly, including resumed turns and delegated Claude tasks. The file must be regular UTF-8, at most 64 KiB, and not a symlink; invalid present files produce a visible preparation failure. Codex and OpenCode retain native project instruction loading. This does not enable unrelated runner settings or hooks.

## Memory and tools

Each child gets the explicit MCP package set selected for its runner plus Deck's session bridge. When adaptive memory is enabled, Claude, Codex and OpenCode use their configured official Supermemory integration with the same canonical project identity prepared for normal Deck developer launches. Each execution has one memory integration: these native runners do not also receive `deck_memory_recall` or `deck_memory_propose`. Missing scope, unavailable plugins or conflicting configuration fail preparation explicitly; Deck does not fall back to a default namespace or silently switch to daemon memory. Pi's existing Deck integration is unchanged. Memory remains advisory and does not override OpenSpec.

Activity shows native hook execution when the runner exposes it, including hooks unrelated to Supermemory. Hook entries show the observed lifecycle and outcome, available duration and trusted provider attribution. A completed hook means the hook completed; it does not establish that a provider recalled or saved memory. Explicit memory tools remain ordinary tool entries. Claude and Codex expose hook lifecycle events; OpenCode's internal plugin hooks do not currently expose equivalent verified events, so their execution is not fabricated in Activity. Hook output, commands and filesystem paths are not displayed.

Native plugin readiness does not certify automatic storage. Claude's asynchronous Stop capture has no verified completion barrier in the managed per-turn lifecycle. OpenCode's native event dispatcher does not await its plugin's background capture, and its disposal endpoint is not a capture-completion barrier. The Lead receives this limitation explicitly; use native explicit memory tools when available for an operation with a reported result. Codex exposes its Stop hook lifecycle, but hook completion alone still does not certify provider persistence. No live provider write is implied by the configuration and offline contract checks.

Web Search uses the configured provider and its existing credential environment variable. Credentials are passed in process environment, not command arguments or event payloads. A missing credential fails the configured tool setup instead of silently enabling another provider.

Codebase Memory is checked through its actual MCP protocol before the native runner starts. For the reviewed native build, Deck keeps a private runtime connected across turns while preserving the existing graph cache. A slow first initialization is separate from model inference; later turns check the retained connection. An unhealthy runtime gets one bounded recovery attempt, then a short retry backoff. Deck does not kill another client's daemon or quietly drop the selected tool. Unsupported builds and failed readiness appear as a failed turn in the conversation. Claude text arrives progressively once its native turn begins.

## Personal-use and security boundary

Deck starts the unmodified native CLIs as the signed-in OS user. Native CLIs retain responsibility for their own authentication; Deck does not read or copy their credential files or substitute API keys for native subscriptions. Unrelated user-global MCPs, plugins, hooks and native delegation remain excluded; only the reviewed configured memory integration is selectively admitted. Displaying hook activity does not enable additional hooks. See the [driver matrix](reference/support-matrix.md#cross-runner-session-drivers) for their exact scope.

Claude setup and launch use the existing native login without a separate subscription notice or acknowledgement step. Legacy acknowledgement settings remain readable but do not gate sessions.

The listener binds only `127.0.0.1`. Host and Origin checks, strict content security policy and device authentication protect the browser surface; it exposes no session bridge, daemon administration or general file browser. Project folder completion is authenticated, bounded and confined to canonical home directories; OpenSpec reads have their own restricted scope. Forwarding headers are rejected unless explicit proxy/origin configuration permits them; device authentication still applies. No exposure command runs automatically.

This feature is for one user on one machine. It provides no shared daemon, remote runner credentials, OS service, mobile/PWA installation, push notifications or automatic network exposure. Tailscale is not required. Automatic local access trusts processes and browsers that can reach this machine's loopback interface, including other local OS accounts. It is not an OS-user authentication boundary. Foreign web origins and forwarded requests cannot use the local bootstrap; remote access still requires a device credential.

## Verification and downgrade

`deck session self-test` checks embedded assets and contract schemas without network access. Live driver checks are opt-in; normal tests use fake runners and provider transports. The [acceptance record](../openspec/changes/cross-runner-session-core/apply-progress.md) distinguishes native checks, compiled runtime checks and build-only platforms.

Older Deck versions may reject newer configuration fields or session events. Preserve configuration and session state before a downgrade; do not erase history or rewrite recorded owners to make an older binary accept it. A compatible binary is required to resume sessions that use workspace assignment generations.
