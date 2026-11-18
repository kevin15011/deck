# Sidebar and status parity inventory

Source: Investigate attempt33, result460712. Lead-reviewed bounded source/screenshot inventory, not runtime verification or completed implementation.

The screenshots confirm the visible sidebar difference: Deck1 shows compact project and session rows with status indicators, per-project create and menu controls, and unread markers. The supplied Deck2 screenshot shows a simpler tree without those indicators or controls. The third screenshot confirms the image-admission error reported previously.

This is a bounded source and screenshot inventory; it does **not** establish runtime parity or prove that every backend event needed for the indicators is available.

| Surface | Deck1 behavior and icon | Deck2 current source and accepted 82 |
|---|---|---|
| Project toolbar | Plus for **Add project** and refresh arrow for projects and sessions. | The inspected navigation has a Projects heading; these toolbar actions are absent. |
| Project row | Chevron expands or collapses; plus creates a session; three-dot menu offers rename and remove; six-dot grip supports pointer and keyboard reordering. Unavailable directories are identified. | Historical projects have expansion; the inspected navigation lacks the corresponding plus, menu and reorder controls. New-project rows use a fixed expanded chevron. |
| Session row | Readiness square distinguishes connected from disconnected; Lead status, unread dot, worker count, attention count, error and stale indicators can coexist. Three-dot menu offers rename and remove; grip enables reordering. | Rows show a name and text summary without the independent indicators or equivalent row menu and reorder controls. |
| Project status | Separate icons and counts for running Leads, starting Leads, active workers, sessions needing attention and errors; a clock indicates stale or unknown status. | No project aggregates appear in the inspected rows. |
| Lead or worker status | Open circular orbit for working; hourglass for question or approval; clock for starting; circle for completed or idle; warning triangle for error; square for stopped. A separate dot marks unread replies. | The reusable `StatusIndicator` contains these shapes in both baselines and is used in worker headings and the subagents tab, but is not connected to session navigation. |
| Conversation progress | Animated dot and labels cover sending, capacity waiting, runner preparation, reasoning, tool use, responding, compaction, approval, question and connection. | The inspected view projects waiting, compaction and reconnecting labels, leaving the other original phases unrepresented. |
| Navigation shell | Panel, folder, plus, refresh, chevron, menu, close, settings and layout SVGs; animated expansion and selection. | The navigation icon vocabulary exists, but the presence of an SVG does not make its original control or behavior reachable. |
| Worker detail | Status indicator, unread reply marker, active-worker count, stale state and context indicator. | These presentation elements exist in the inspected subagent view. Their complete state projection remains unverified. |

The original control and icon definitions are in [project-navigation.tsx](/home/kevin15011/deck/apps/web/src/project-navigation.tsx:23), [sortable.tsx](/home/kevin15011/deck/apps/web/src/sortable.tsx:58), [session-indicators.tsx](/home/kevin15011/deck/apps/web/src/session-indicators.tsx:13), [status-indicator.tsx](/home/kevin15011/deck/apps/web/src/status-indicator.tsx:61), and [lead-progress.tsx](/home/kevin15011/deck/apps/web/src/lead-progress.tsx:9). The comparison points are the [current Deck2 navigation](/home/kevin15011/deck-next/frontend/src/app.tsx:282) and [accepted-82 navigation](/home/kevin15011/deck-next/target/review-assignment82-84d7c8e3/frontend/src/app.tsx:279).

The independent implementation slices are:

1. **Indicator presentation:** restore the original session and project indicator vocabulary, including simultaneous indicators, labels and reduced-motion behavior. The isolated Fast work addresses this presentation slice.
2. **Navigation controls:** restore project creation and refresh, session creation, rename/remove menus, ordering and expansion behavior, including keyboard operation and original motion.
3. **State projection:** connect actual Lead and worker activity, pending questions and approvals, failures, freshness and reply read markers to the indicators. In particular, a completed reply must remain independently unread until the appropriate read marker advances.
4. **Conversation progress:** project the original phases from actual events and receipts, including disconnection and recovery.
5. **Clipboard:** align frontend and backend image admission and restore the clipboard file-list fallback, then verify delivery through submission. The screenshot’s error is consistent with the previously identified restrictions at both boundaries.

**Backend availability remains separate from presentation:** this inspection did not establish that Deck2 supplies every original activity aggregate, freshness timestamp, reply sequence or progress event. Missing data must be identified at integration time rather than represented as an idle or completed state.

The screenshots provide single captured states; no browser tour, animation verification or live event test was performed. Graph coverage was best-effort, with recorded non-code asset and unrelated partial-parse gaps; Deck2 was inspected directly outside the Deck1 graph. The filesystem is read-only, so no inventory artifact or product files were created or changed.

## Integration ownership

ApplyFast task2619 owns isolated indicator presentation only. ApplyDeep task181 owns authoritative state wiring and shared-source integration. Header patch under /home/kevin15011/deck/target/fast-header-presentation is accepted as supporting artifact. Clipboard handoff under /home/kevin15011/deck-next/target/fast-clipboard establishes a frontend/backend admission gap. Preserve original reply read markers and independent stale/attention/worker dimensions. Restore navigation controls with working backend operations, permissions, keyboard and GSAP/reduced-motion behavior; no decorative or inert substitutes. Current installed version has not been changed.

## Isolated indicator delivery reviewed

ApplyFast task2619 attempt1 result461821 supplied target/fast-sidebar-indicators/session-indicators.tsx (2308da40), status-indicator.tsx (2921c70b), indicators.css (0bccad53), fixture and4 focused tests. Lead recomputed module hashes, inspected composition, explicit input types, motion cleanup and fixture, and reran4 tests successfully. Browser12-row normal/reduced/hidden/offscreen and typecheck success remain producer evidence; no full app test. Accepted as supporting modules only.

Integration contract: SessionIndicators accepts explicit observed WorkspaceSession, unread and fresh; ProjectIndicators accepts optional ProjectStatus. Caller owns real timestamps, expiration refresh and exact reply read acknowledgement. Deep must adapt against current types and existing StatusIndicator (do not blindly replace shared module), wire authoritative data, and verify installed behavior. No zero-filling unknown aggregates as observed idle. Module delivery does not complete sidebar controls, data projection, progress phases or clipboard fix.
