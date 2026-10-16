# Progressive chat history and responsive composition

## Intent

Large chats make the web UI slow, including typing. The user requests recent-first history with older messages loaded progressively only as they scroll upward. Preserve complete durable history and existing chat semantics.

## Acceptance

- Opening/switching a session initially fetches and renders a bounded recent conversation page, positioned at the latest content; it does not drain the entire event history.
- Upward scrolling loads bounded older pages on demand. No uncontrolled page cascade, duplicate requests/messages, gaps, or out-of-order entries. Preserve the visible message/offset when prepending, including mobile and variable-height content.
- Current approvals, questions, task/session state, grants, progress and prompt queue remain correct even when their initiating events precede the visible page. Backfill must not resurrect resolved controls or overwrite newer state.
- Live updates and reconnects remain gap-free and deduplicated; session switches ignore/cancel stale page requests. While reading history, live arrivals do not force scroll. Jump to latest continues working.
- Typing must not re-render/reparse all historical Markdown or rescan an unbounded event list per keystroke. Measure with a representative synthetic long session before and after; report fetch/event/DOM counts and interaction timing, distinguishing synthetic evidence from real-session verification.
- Older history remains reachable beyond the former 500-message display cap. Bound transport and rendering work appropriately so repeated scrolling does not recreate the typing regression.
- Keep authenticated/project-scoped routes and privacy filtering intact. No native model requests, history deletion, runner changes, daemon restart or deployment is required for this task.

## Initial source evidence

Graph MCP is unavailable in this runner; no graph coverage/generation claims. Source fallback: apps/web/src/main.tsx connection effect drains /events?after=0 until hasMore=false, applies events one-by-one; messages memo selects conversationEvents(view.events).slice(-500). Draft state belongs to the same App; content signature is rebuilt on render. apps/web/src/state.ts reduceEvent copies and appends unbounded events and projected maps per event. packages/session-host/src/web-service.ts owns authenticated event HTTP/WebSocket routes; event-log.ts readAfter provides forward replay. Existing status-indicators-brief.md requires latest-on-open and preservation of manual upward reading.

## Route and boundaries

One implementation owner owns the complete host/UI slice, including focused tests and browser/performance evidence. Use performance-optimization, frontend-ui-engineering, applicable API/security/testing skills. Record design choices and implementation evidence in the return; Lead maintains this brief. Independent Quality reviews pagination/state/live-update boundaries and actual long-chat behavior before closure. Keep the accepted visual identity.

## Status

Implemented and independently approved on feat/web-ui, base ea840ab, /home/kevin15011/deck-web-ui. Pre-existing unrelated typecheck error: apps/cli/src/pi-client-proof.ts:187 (TS2322). Existing worktree was clean before this brief.

Observed session scale (metadata only, 2026-10-16): current session 20261015T220838-71cb69 had 50,789 persisted events and 51.3 MiB JSONL during intake, including 37,136 message.delta and 5,902 runner.unmapped events. Disk bytes are not asserted to equal HTTP transfer size. No message contents or credentials were copied into this artifact. This supports testing with tens of thousands of events, not only hundreds of final messages.

Implementation owner: apply-deep task-5e9e4da4-f268-45bb-b263-1b05a4dd035d.

## Implementation direction

The owner confirmed two independent costs: whole-ledger replay on session opening, and parent rerender/derived chat-workspace work during typing. The chosen direction is a bounded conversation-page API plus an authoritative current-state snapshot, with separate live reconciliation and historical backfill. A bounded rendered history window and isolated typing work prevent repeated backfill from rebuilding the original performance problem. Snapshot and history cursors must share a consistent boundary to avoid losing live events during initialization.

Initial implementation choices: 40-row history pages and a 120-row rendered window. Host history uses a sequence index so each page does not reparse the whole ledger. The first RED-to-GREEN host regression checks bounded pages, stable pagination during concurrent appends, current approval state and secret-answer filtering. These are implementation checkpoints, not final verification.

Synthetic baseline `/tmp/chat-baseline.json`: 6,000 conversation messages, 7 history requests, 6,003 delivered events, 2,712,382 response bytes, 5,593 ms load, 500 DOM messages/12,034 DOM nodes. Typing harness timings: median 80.3 ms, p95 154.0 ms, maximum 359.5 ms. These are local synthetic harness measurements, not field INP measurements. Compare the candidate using the same fixture and procedure.

## Candidate evidence checkpoint

The checked-in browser acceptance completed the 6,000-message traversal (149 backward pages), bounded rendering to 120 rows, and measured zero desktop/mobile anchor drift. It covers live arrivals, reconnects, stale session responses and streamed-row replacement. Typing caused no conversation-tree mutations. Final focused run reports 159 passing tests across 18 files; final typecheck reports only the previously recorded unrelated pi-client-proof.ts diagnostic. Evidence: `/tmp/chat-final-tests.log`, `/tmp/chat-final-browser.json`, `/tmp/chat-tsc.log`.

Initial candidate comparison `/tmp/chat-after.json`: 1 request, 45 delivered events (40 messages plus current state), 20,401 bytes, 1,264 ms load, 40 DOM messages/1,267 nodes, typing median16.4ms/p95 23.0ms. Final navigation acceptance reports typing median16.1ms/p95 24.6ms after history traversal. Measurements include browser automation overhead and are not field INP claims.

Independent Quality: task-e1e1a7d9-10a6-4014-8a4e-e18d545480cb; review pending. No deployment or daemon restart has occurred.

Compatibility follow-up during final implementation: subagent full transcripts also depended on the unbounded event array. The owner is extending bounded history access to task transcripts so older subagent conversations remain reachable. Review must cover this final delta and ensure existing historical activity/tool-detail access is not silently lost when compacting current state. First host access still scans the ledger to construct its index; bounded HTTP payloads and subsequent indexed pages do not eliminate that cold-index cost.

## Independent review finding

Quality requested changes for one P2: an empty task transcript can lose its first live reply after an upward scroll disables following. The history hook defers the row but has no existing history ID for a forward cursor, leaving no visible reply or recovery button. Reproducer: `/tmp/chat-quality-empty-transcript.ts`; targets `apps/web/src/chat-history.ts` live handling and `progressive-transcript.tsx`. Fix must preserve first-arrival visibility/recovery even without existing rows. Other independent evidence:33 targeted tests; browser input/IME,drafts,reconnects,controls,subagent paging;50,300-event indexed-read fixture. Review closure remains pending.


## Final result (2026-10-16)

Implemented and approved. Authenticated `/api/sessions/:id/history` serves 40 recent conversation rows plus compact authoritative current evidence. Exclusive before/after cursors use each row's first event separately from its completion sequence and the live watermark. Lead and task transcripts retain at most 120 rendered rows; evicted rows remain reachable. Historical pages cannot reduce current controls. Session generations fence stale responses; reconnect refreshes current controls and the visible bounded window. DraftStore/DraftBoundary isolate keystrokes from workspace and Markdown rendering. The host uses a lazy byte index and disposable conversation sequence-reference index; durable ledger data is preserved.

Independent Quality task-e1e1a7d9-10a6-4014-8a4e-e18d545480cb attempt 2: **PASS**, closing its sole P2. Original empty-transcript reproducer now shows1 row / 1 visible reply/no errors. A separate nonempty-history check preserves61 rows and zero scroll drift while deferring the live reply until New messages is requested. Source hashes were stable throughout closure. The implementation owner retained ownership through the delta; its ongoing verification was interrupted once to deliver the review finding after the bridge rejected feedback to a running task, then resumed in the same native context.

Final implementation evidence:164 focused tests across 18 files / 819 assertions passed before the tiny P2 delta;7 history tests / 41 assertions plus the new checked-in empty-transcript browser regression passed after it. The regression failed before the guard fix. Full browser acceptance reached all 6,000 messages, with no page cascade, bounded rendering, zero desktop/mobile anchor drift, variable-height reflow, stream completion, reconnect/offline completion, stale-session isolation, draft handling, task history, and retry coverage. No page errors. Typecheck still reports only the unchanged pi-client-proof.ts:187 TS2322.

Independent evidence additionally includes 33 targeted tests and a 50,300-event / 50.9 MB fixture covering index rotation, appends, UTF-8 and reopen. Cold index construction was approximately 585 ms; subsequent older paging read 40 events in approximately 1.1 ms. These are synthetic local measurements.

Completed browser comparison: initial transfer 2,712,382 bytes → 19,832 bytes;7 requests → 1;6,003 records → 44 (40 messages + 4 current-evidence events);500 mounted messages → 40;12,034 DOM nodes → 1,305. Opening harness time 5,593 ms → 1,282 ms. Typing median / approximate p95: 80 / 154 ms → 15 / 22 ms; after navigating history at 120 rows: 14 / 25 ms. Timings include Playwright overhead; opening includes a fixed 500 ms settle period. The later fixture adds a second session for switching checks. These numbers do not establish real-user INP or actual-session performance.

Reproducible commands:

```sh
bun test apps/web/src packages/session-host/src/__tests__/chat-history.test.ts packages/session-host/src/__tests__/web-service.test.ts packages/session-host/src/__tests__/event-log.test.ts
CHAT_PHASE=final CHAT_ACCEPTANCE=1 bun apps/web/acceptance/chat-history.ts
bun apps/web/acceptance/empty-transcript.ts
bunx tsc --noEmit
```

Browser commands build fresh assets and accept `DECK_TEST_CHROME` for the installed Chromium executable. Full implementation handoff: `/tmp/chat-history-review-handoff.md`; diagnostic logs and screenshots are referenced above. The checked-in acceptance scripts retain the reproducible cases independently of temporary logs.

Limits: first host access still synchronously scans the ledger; index metadata scales with durable history. Current evidence scales with tasks, outstanding controls/queue receipts and 200 recent activity events. No native inference, real-user session performance test, deployment, canary activation or daemon restart occurred. Existing unrelated typecheck failure remains explicitly open.
