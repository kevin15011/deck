# Session and subagent status indicators

## Outcome and scope

The user requests animated SVG status indicators for subagents and sidebar sessions, including ongoing work and replies not yet read. The session indicator represents the Lead. The additional reported defect is that opening or switching chats lands at the beginning; it must display the latest messages after history renders.

Continue the existing UI owner's implementation. Lead owns this brief and activation. Preserve project accordions, directory completion, current theme, row density, workspace lifecycle and existing edits. No provider inference or new animation dependency is needed.

## Visual and interaction agreement

- Reuse the accepted minimal sidebar identity: small consistent stroke SVGs, approximately 14–16px, existing dark/light tokens and unchanged compact row dimensions.
- Animate actual ongoing work subtly; unread responses, waiting, failures and idle/completed states use distinguishable static shapes and accessible text. Do not rely solely on color or keep unread markers pulsing indefinitely.
- Respect reduced motion. Use the existing frontend stack; `frontend-ui-engineering` covers integration, `fixing-accessibility` covers labels and reading semantics, and `fixing-motion-performance` covers inexpensive motion and cleanup. These complement the existing visual agreement rather than replacing it.
- Derive status from actual runtime events/state. Verify cross-session data availability before selecting an update mechanism. Never infer a response merely from task completion or generic updated timestamps.
- Persist read markers in the browser, scoped to session and response identity. A selection alone is not proof of reading: the relevant content must be rendered and visible in a visible/focused page. Define exact subagent response visibility from the actual existing view before implementation.
- Initial history hydration and switching sessions land at the latest messages. Once loaded, manually scrolling upward preserves the reading position on subsequent events; Jump to latest remains available.

## Verified trace and implementation decision

The selected session already receives task states, approvals and completed assistant messages through WebSocket/replay. The sidebar polls session summaries, whose `running` and state aggregate child work and preparation; `lastSeq` includes arbitrary events. These cannot honestly identify Lead activity or an unread reply. Existing scroll feedback is transient and there are no persisted read markers. Initial chat restoration uses saved scroll positions, including zero, explaining the reported navigation behavior.

Extend the host summary with a small `leadActivity` projection containing current Lead task/state, pending approvals and the latest public nonempty Lead assistant completion sequence across generations. Generic task completion, tools, reasoning, user/system messages and internal bridge/helper output do not create a reply marker. Reuse durable replay/projection rather than scanning full event logs per poll. Refresh all known loaded session rows through a bounded authenticated status query so later history pages do not remain stale. Host owns this additive contract; UI owns consumers. Exact API details and evidence will be recorded on completion.

Browser read markers store the maximum observed reply sequence per session; absent means zero. Acknowledgement requires the latest actual response to intersect the visible chat viewport while the page is visible and focused. Subagent results follow the equivalent task/attempt-scoped visibility rule. Unread can coexist with running work, so neither should hide the other. Markers do not modify backend session state or synchronize across devices.

The bounded API is `GET /api/sessions/status?projectId=P&sessionId=A&sessionId=B`, mapped to `sessions.status { projectId, sessionIds }`, with at most 100 unique valid session IDs and project filtering. Responses update known loaded rows without replacing history pages or pagination cursors. The host persists the last Lead reply sequence in its ledger projection; snapshot versioning triggers one-time legacy replay. Ordinary polls reuse loaded session projections.

## Verification and progress

Separate existing UI and host owners completed implementation; independent Quality approved the additive boundary and UI interaction delta. Focused state-transition and actual browser checks cover background reply/unread, reading acknowledgement, reload, work/error/waiting states, delayed history, preserved upward reading, desktop/mobile layout and reduced motion.

Host implementation is frozen and independently approved: snapshot v2 persists reply cursors and timestamps; v1 snapshots rebuild once from the ledger. The bounded query validates before loading and repeated polling avoids event-log scans. Root passed 419 host/CLI tests (1,362 assertions). UI review repaired source-sparse Lead-generation attribution, preparation projection parity, accessible row descriptions, exact current-attempt subagent result identity and Jump to latest availability in read-only/unprepared chats.

Strict mobile acceptance exposed a real viewport change after history hydration: the connection/progress row reduced the viewport by 15px, leaving the latest content misaligned. Layout and resize handling now maintains the bottom only while following; manual upward reading remains paused. Separately, pending native Home scrolling and headless focus emulation were fixture defects: tests now settle real wheel gestures and verify actual `document.hasFocus()` before testing blur. Empty pre-replay history no longer satisfies the latest-message assertion.

Final interaction evidence: 8 focused browser groups and 17 normal workspace groups passed. Root inspected desktop dark, sidebar unread and mobile 320px latest-message captures; 390px and light captures are also available. UI/assets/documentation passed 65 tests (1,015 assertions), TypeScript and four-target compilation passed. Independent Quality passed 14 targeted tests (71 assertions) and approved. Evidence: `/tmp/deck-status-{browser,workspace,host-cli,ui-docs-final,tsc-final,build-all-final,installed-web}.log`. Interactive checks use actual SessionManager/WebService with temporary projects and fake native inference; they do not claim direct automation of the user's current browser. Final namespaced state classes remove generic alert padding from the error SVG; a focused Chromium check confirms error/approval indicators remain 16×16 (`/tmp/deck-status-error-check.log`). Four targets were rebuilt after that cosmetic correction; the final installed executable passed 31 isolated compiled smoke checks. Scoped OpenSpec validation and diff checks passed.

## Activation

Complete and active. Canary payload `7ed4116cfe6f80ca4f70b1d0861bfba1d45a59f034e44cfb9e2a73070d30a08a` replaced the idle daemon through the guarded restart command, PID46567→57799 at 2026-10-15T15:12:52.309Z. Web remains http://127.0.0.1:7421; reload for new assets. Final status shows no running work or pending approvals. No real provider inference, user configuration change, commit or publication.
