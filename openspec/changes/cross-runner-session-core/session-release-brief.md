# Session release, actions and connection state

Status: complete, independently approved and activated (2026-10-15). Lead owns this artifact.

## Intent and correction

The user clarified that Close session must release resources and return the existing conversation to Prepare session. The previous terminal-close/successor interpretation was incorrect. This decision supersedes that part of D-34 and XR-13.6; earlier activation records remain historical. The user also requested per-session three-dot Rename/Remove actions and a green/gray connection dot to the left of the session name.

## Contract and acceptance

- Web Close uses `session.release {}`. Its durable intent gates admission before cancellation, pauses pending messages and drains only the selected session's preparation, Lead, children and owned tools/memory. ACK reports `preparation.status: releasing`; readiness becomes `unprepared` only after resources settle. Shared daemon and other sessions remain available.
- Prepare operates on the same session ID, history, title, attachments and compatible native identifiers. Existing terminal sessions can explicitly reopen in place after ownership settles. Ordinary Close/Prepare never creates a successor. Explicit legacy `session.stop` and `session.continue` remain compatible APIs, separate from these web actions.
- Pending messages survive release, remain paused and require explicit Resume queue after preparation. An empty release-paused queue clears its pause on successful Prepare. Interrupted dispatched turns are never silently retried. Release intent survives restart and fences stale preparation callbacks and wake/delegation admission.
- Lifecycle command identity survives bounded receipt eviction. A stale Release/Stop retry cannot close a newer prepared epoch; stale Rename/Remove retries cannot reapply old mutations.
- `session.rename {title}` accepts a trimmed, nonempty title up to 160 characters and returns `{title}`. It persists without changing session identity or history, including released or ended sessions.
- `session.remove {}` persists removal intent, returns `{state: removing, preparation}`, gates new work and uses the same release path. The row remains visible with `removing: true` until ownership settles, then a durable tombstone hides it from catalogs. Unsettled ownership cannot be reported as successful removal. No project files or saved history are purged. Existing authenticated known-ID history/attachment reads retain their authorization policy; removed-session mutations are refused. No restoration framework is introduced.
- Session rows retain compact sizing and existing activity/unread SVG indicators. An independent small connection dot sits left of the name: green for authoritative ready state, gray otherwise, with accessible status text. Restart/release invalidate readiness; selected or idle alone never means connected. Preparation validates prerequisites, not a continuously running/prewarmed model.
- The independent accessible three-dot menu offers Rename session and Remove session without selecting the row. Rename preserves selection/drafts. Removing an inactive session preserves the active conversation; removing the selected session clears stale selection safely. Catalog refreshes and delayed responses cannot resurrect removed rows or overwrite newer titles.

## Trace, risks and scope

The existing web calls `session.stop`; host persists stopping/ended and `session.continue` creates a successor. Preparation currently rejects ended sessions. Changes span shared command/event validation, ledger replay, host lifecycle/admission, production daemon composition, web readiness/catalog/menu rendering and regression fixtures. Main risks are release/prepare races, crash prefixes, unresolved native ownership, receipt eviction, queue/image retention and stale web catalogs.

Host owner: deck_apply_deep_cross_workspace_host. UI owner: deck_apply_deep_lead_activity_ui. Independent reviewer: deck_quality_cross_workspace. Lead owns this brief, current requirements/docs and compiled acceptance. Preserve all concurrent candidate changes. No provider inference, project file deletion, successor-history merging, OS services or unrelated redesign.

## Verification and result

Implementation now includes same-ID release/reopen, title and removal events, durable lifecycle receipts, paused FIFO, preparation fencing, catalog tombstones and readiness indicators. Review found and repaired async assignment completion after removal, pruning during resource cleanup, failed cleanup retry, terminal-release-before-tombstone crash recovery, retained-resource restart guards and external-client catalog omission. Failed cleanup exposes Retry close/Retry removal while ordinary admission remains fenced.

Final evidence: root affected host/core/CLI/schema gate 570 tests/3,386 assertions (`/tmp/deck-session-release-integrated-final.log`); final host owner aggregate 201/900 and independent Quality 40/170 overlap root/owner coverage and are not additive. Final web/assets/docs 80/1,079 (`/tmp/deck-session-release-web-final.log`), TypeScript, canonical schema generation and all four target compilations pass. Actual-browser lifecycle six, queue six and workspace seventeen groups pass (`/tmp/deck-web-release-{browser,queue,workspace}.log`). Desktop dark/mobile 320 dark and 390 light captures, including open menus and closing state, were inspected. The old installed binary demonstrated the missing release contract (`/tmp/deck-session-release-compiled-red.log`).

Installed compiled smoke passes 67 checks (`/tmp/deck-session-release-installed-smoke.log`), including actual supervised fake Claude continuation with the original native identifier, retained conversation/image previews, legacy same-ID reopen, stale release/stop retries, rename/remove persistence and isolation across daemon restarts. Verification uses isolated temporary state and fake native protocols, with no real provider inference or live-user-session mutation.

Canary payload `44337a894af17fa639c9aac021056a2ecbeeef4f4655c7124ff8171155bdd531` is active after guarded idle restart PID17681→23702 at 2026-10-15T18:34:45.425Z. Status confirms web http://127.0.0.1:7421 and no running work or pending approvals. Reload the browser for new assets. No user configuration change, commit or publication. Removal is catalog-only, not disk erasure; existing successor conversations are neither merged nor deleted.
