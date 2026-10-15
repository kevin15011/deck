# Project and session workspace evolution

Status: all four phases implemented, verified, independently approved and activated in canary on 2026-10-15. Evidence is recorded in verify-report.md and review-report.md.

## Intent

The user wants cross to become a project-independent web application: launch the service/client from any directory, register persistent projects through user-directory completion, and manage multiple named sessions and their history inside each project. The user also requested Activity follow behavior, removal of document overflow, an explicit reconnect/prepare interaction, a session close action, and clear model/runner transition semantics.

## Immediate corrections

- Activity should follow incoming events while the reader is near the latest content, preserve the position while reading older events, and allow returning to the latest content explicitly.
- The application must fit the viewport. Scrolling belongs to content panes; an empty document region below the workspace is a defect.
- Preserve the accepted dark/light themes, compact header, responsive workspace and Markdown rendering. No aesthetic replacement is requested.

## Verified baseline before workspace implementation

| Concern | Current behavior | Evidence |
|---|---|---|
| Repeated CLI launch | `deck cross developer` selects the newest matching live same-project session. There is no public new-session flag; the underlying create command can create separate sessions. | `apps/cli/src/session-commands.ts:165` |
| Session catalog | `deck session list` and `deck session attach <id>` exist. Each session has metadata, ledger, snapshots and tasks under its own state directory. | `packages/session-host/src/paths.ts:40`, `session-manager.ts:912` |
| Closing | `deck session stop <id>` cancels work and permanently ends that Deck session while retaining history. Ended sessions reject prompts; no reopen operation exists. Browser/terminal detachment leaves work running. | `packages/session-host/src/session-manager.ts:853`, `apps/cli/src/session-terminal-client.ts:182` |
| Native continuation | Subsequent prompts use the recorded native identifier through Claude resume, Codex thread resume or the existing OpenCode session. Missing native history triggers one explicitly recorded reseed with bounded task context (last eight messages, 8,192 characters total), not complete native-history recovery. | `packages/session-host/src/session-manager.ts:569`, `:733` |
| Connection versus startup | WebSocket reconnect and event replay occur before sending. Runner probing, tool preparation, native startup and native-session resume occur on each actual prompt; process handles close after the turn. | `apps/web/src/main.tsx:77`, `packages/session-host/src/session-manager.ts:639`, `:706` |
| Assignment changes | Existing Lead and continued delegated tasks retain recorded assignment. New delegated tasks read current global member configuration. Global edits therefore do not change an existing Lead. | `packages/session-host/src/session-manager.ts:301`, `:523`, `:564` |
| Global service | `deck daemon start` and `deck session web enable` work independently of launching a project session; the latter ensures daemon startup. There is no dedicated `deck web` browser-opening entry point. | `apps/cli/src/cli-args.ts:228`, `session-commands.ts:128` |
| Parallelism | The configured concurrency limit applies to delegated tasks per session, excluding its Lead. Default capacity is four delegated tasks plus a Lead per session, with no daemon-wide cap. Same-project sessions share the working directory. | `packages/session-host/src/session-manager.ts:321` |

## Proposed product model

One local Deck service owns registered projects and their sessions. Launching the web neither depends on the shell directory nor creates a conversation implicitly. Keep `deck cross developer` as a compatible project shortcut.

- **Project:** stable registry ID, canonical directory, display name and timestamps.
- **Deck session:** independent conversation, events, tasks, assignment revisions and optional OpenSpec binding.
- **Native session:** runner-owned execution context for a task or Lead generation. It is not interchangeable across runners.

Preserve the current themes and Chat/Activity/Subagents/OpenSpec workspace. Extend the sidebar with project navigation and each project's session history. Show other active sessions that share a directory. Automatic worktrees are a separate product decision; they are not implied by independent histories.

## Implementation phases

### 1. Reliable scrolling — implemented and activated

Completed 2026-10-15: 51 browser groups, 33 UI/asset tests, TypeScript and 16 installed executable checks passed. Independent review approved; canary and idle daemon were updated. The final workspace increment also passed all 51 browser regressions.

Correct Activity follow behavior and viewport overflow without changing session lifecycle. Require actual desktop/mobile browser checks and preserve reader position.

### 2. Global project and session navigation — implemented and activated

Add the cwd-independent entry point `deck web`, backed by the existing daemon. Persist projects in private user state under a single writer. Deduplicate canonical directories; use stable path-derived IDs as API identities to import legacy history without rewriting it (D-32). Import existing session roots idempotently so current history remains accessible.

Extend the existing authenticated command/query boundary with project registration/listing, directory suggestions, paginated per-project sessions and explicit new-session creation. Directory completion lists bounded direct-child directories inside the daemon user's real home, with canonical containment and symlink checks; it does not recursively scan, read files or execute project code. Preserve existing Host, Origin and device checks. Revalidate directories at registration and session creation; moved/missing roots remain visible as unavailable instead of silently changing identity.

Before exposing broad parallel session creation, define a configurable daemon-wide execution budget in addition to existing per-session limits. Queueing must identify its cause and avoid starving one session behind another. Session history isolation does not imply filesystem or resource isolation.

Acceptance: launch from an unrelated directory, register a project, create two independent sessions, restart/reload, and find and resume both. Verify directory boundaries, migration idempotence, global admission and unchanged canonical project memory identity.

### 3. Explicit preparation and closing — implemented and activated

Show **Reconnect** when browser transport is disconnected. For a recovered session, **Prepare session** may validate directory, runner compatibility, configuration, instructions, memory and MCP prerequisites without a dummy model prompt. Preserve the draft and enable the composer after preparation succeeds. Keep transport connectivity, infrastructure preparation and native execution distinct; preparation must not claim that the model is already running or that subsequent native startup has disappeared.

Add **Close session** with existing final stop semantics and retained read-only history; use **Stop and close** while work is active. Closing one session must not stop the daemon or other sessions. A later **Continue** action on an ended session creates a linked successor with explicit transferred context rather than rewriting terminal history. Ordinary browser closure remains detachment.

Acceptance: reconnect/replay without losing drafts, preparation failures before submission, no provider call during preparation, finalization limited to the selected session, and retained history. True native prewarming remains a separate adapter lifecycle feature requiring runner-specific evidence.

### 4. Session-scoped model and runner changes — implemented and activated

Add session assignment overrides and a model picker that shows the actual runner/model. Preserve past event provenance and all recorded task owners; global configuration supplies defaults rather than implicitly rewriting a session's history. New task resolution must be explicit and compatible with the existing delegate configuration behavior.

Apply a Lead change only while there are no running tasks, pending approvals or undelivered completions; serialize assignment revision with prompt admission. Persist the new revision and Lead generation before accepting the next prompt. Same-runner native continuation is permitted only where the adapter has a tested model-switch contract. Cross-runner changes always use a new native context with a bounded, explicit handoff; unsupported same-runner changes use this same path. Keep the Deck timeline and show the transition in Activity. Never describe reconstructed context as resuming the same native session.

Acceptance: busy changes rejected, idle transitions persisted, native IDs never passed across runners, old delegated continuations retain their original owners, and restart preserves overrides and history.

## Verification boundary

The scroll corrections require desktop/mobile browser evidence, history-follow and reader-position regressions, generated asset verification and TypeScript. New project/session APIs, persistent registries, preparation states and assignment transitions require a separate coherent implementation phase with lifecycle, path/authentication and migration tests before claiming availability.
