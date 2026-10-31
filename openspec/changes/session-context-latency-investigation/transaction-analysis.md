# History limits and necessary operations

## Conclusion

The user's UI hypothesis is supported by an existing implementation record: chat history pagination was introduced to fix slow opening and typing in long sessions. Preserve that protection. It is separate from the native Codex RPC frame limit and from the model's context window.

Reduce redundant reads and excessive transport before changing caps. Retain runner-owned conversation context, durable delivery evidence, and bounded UI rendering. No production behavior was changed in this follow-up.

## Distinct boundaries

| Boundary | Current behavior | Purpose and consequence |
| --- | --- | --- |
| Native model conversation | Runner resumes its native session; Deck sends new instructions and orchestration material | Context assembly and compaction belong to the runner. UI pagination does not trim this context. |
| Codex to Deck RPC | 1,048,576 UTF-8 bytes per JSON line before parsing | Receive protection. Oversized history/tool responses can fail the active turn before the browser receives anything. |
| Deck control protocol | Separate 1 MiB framing constant in `protocol.ts` | A distinct daemon transport. Do not conflate it with Codex framing or propose a global cap change. |
| Browser history | At most 40 messages per page; 120 retained conversation rows | Bound history transfer/rendering while older messages remain available. The initial response additionally carries current-state events. |
| Browser current evidence | 200 recent activity events, plus task/control/queue/progress state | Not a total cap of 200 events or a byte cap. State grows with tasks and outstanding controls; message size still matters. |
| Browser live stream | Replay up to 1,000 events; default outgoing buffer budget 1 MiB | A slow client is asked to resync. This is backpressure protection, not the model token window. |

Sources: [Codex RPC](../../../packages/adapter-codex/src/session-driver/rpc.ts), [control protocol](../../../packages/session-host/src/protocol.ts), [shared history contract](../../../packages/core/src/session/chat-history.ts), [web service](../../../packages/session-host/src/web-service.ts), [browser history hook](../../../apps/web/src/chat-history.ts).

The [prior progressive-history record](../cross-runner-session-core/chat-history-performance-brief.md), dated October 16, explicitly records the typing/opening problem and the 40/120 design. Its synthetic browser comparison reported initial transfer falling from 2,712,382 to 19,832 bytes and approximate typing p95 from 154 to 22 ms. Those are historical implementation measurements, not a new reproduction, a guarantee for arbitrary sessions, or field INP results.

## Current cost observations

### Index construction is different from page retrieval

[ChatHistory](../../../packages/session-host/src/chat-history.ts) constructs a disposable sequence-reference index by replaying `log.readAfter(0)` synchronously. [EventLog](../../../packages/session-host/src/event-log.ts) has a separate lazy byte-location index: its first `readEvent` scans all segment bytes. Each subsequent random event read opens, reads, validates and closes the relevant file. Paging binary-searches row cursors and materializes just selected messages and required referenced records.

`WebService.history` caches up to eight history objects by EventLog identity and advances each through append subscriptions. Eviction removes the oldest inserted entry, not a recency-updated LRU entry. Switching back after eviction can rebuild the history index. Repeated `history.apply` through subscription and WebSocket send is guarded by sequence and does not independently rebuild the index.

Measured October 22 using [measure-history.ts](measure-history.ts) on a disposable copy of a separate local session. The source session was read only. [Aggregate results](history-measurement.json):

| Metric | Observation |
| --- | ---: |
| Persisted events / segments | 96,090 / 9 |
| Copied log size | 143,689,486 bytes |
| EventLog opening | 238.783 ms |
| Cold ChatHistory construction | 977.755 ms |
| Random event reads during construction | 2,614 |
| First latest-page retrieval | 3.352 ms / 46 event reads |
| Warm latest-page median / approximate p95, 20 samples | 0.793 / 1.010 ms |
| Initial page | 40 messages + 355 current events |
| Serialized initial page | 810,744 bytes |
| Hypothetical initial page without event `raw` fields | 445,522 bytes |

The roughly one-second construction runs synchronously on the daemon's execution thread. It is a candidate source of stalls during first access, not evidence that every page or model turn incurs this delay. The filesystem cache was warm after copying; this is application-cold indexing, not cold-disk performance. No browser, mobile CPU, networking, or end-to-end runner latency was measured. Bun was 1.4.0, not the release-pinned 1.3.12.

### Bounded row counts do not guarantee small payloads

Initial current evidence is not limited to the visible message page. This local initial page is about 792 KiB despite its 40-row conversation limit. Size depends on task state, activity and message contents.

WebSocket `send` serializes the full event and, for a chat row, an additional message projection. `messageAt` preserves the event envelope, including `raw`, for ordinary streamed/completed messages. Thus some frame contents are duplicated. The browser parses each frame, applies `CurrentEvents`, obtains its sorted current values, updates view state and, if applicable, merges a history row. This work occurs per accepted event; the code does not establish a one-render-per-frame claim because React scheduling is separate.

The byte-only experiment removed `raw` from event envelopes in a copy of the initial-page value: 365,222 fewer serialized bytes, about 45%. Across all persisted event envelopes, corresponding sizes were 143,593,396 versus 63,613,804 bytes; **the browser does not fetch that entire log on initial load**. These are hypothetical serialization differences, not measured network savings, billing changes or permission to remove fields. Audit consumers, tool-detail behavior, debug access and compatibility before introducing a lean browser projection. Keep canonical durable evidence intact.

### Periodic requests have different purposes

In [main.tsx](../../../apps/web/src/main.tsx):

- Status refresh runs every three seconds for loaded sessions in expanded projects, in batches of 100 IDs. It skips hidden documents and overlapping refreshes.
- Catalog/history refresh runs every ten seconds through `load()`, fetching projects and histories for expanded projects. The catalog request lacks the status loop's visibility and in-flight guards; request versions prevent stale application, but do not cancel work already started. Individual project-history loaders do have a `loadingProjects` overlap guard, so do not treat all history requests as unguarded.
- The live stream carries the selected session. It cannot by itself prove that project catalogs or other sessions are unchanged, so deleting periodic refreshes indiscriminately would risk stale navigation state.

Investigate visibility/in-flight guards, unchanged-result avoidance, and whether a shared invalidation mechanism can replace overlapping refresh work. Measure requests and service cost before adding new push infrastructure. On reconnect, the history hook intentionally refreshes current state and, when needed, its bounded visible range; those requests protect continuity rather than being intrinsically redundant.

### Native history reads are reconciliation, not inference

The [Codex driver](../../../packages/adapter-codex/src/session-driver/driver.ts) uses `thread/read(includeTurns: true)` to check exact delivery evidence. [SessionManager](../../../packages/session-host/src/session-manager.ts) can launch up to 16 historical reconciliation operations; matching native-thread entries may each request the same full history. Successful native receipt handling does not require this fallback.

Share one in-flight read among compatible checks for the same native thread and observation boundary if semantics permit. Such transient reuse is a local read optimization, not a Deck-authored conversation buffer for the model. Do not cache absence indefinitely: a later native append can change an unknown result. Coalescing alone does not make a single oversized response safe. Verify the installed runner protocol's narrower read capabilities before choosing a bounded retrieval design; do not assume pagination or exact-turn querying exists.

An uncertain receipt must remain uncertain unless exact evidence resolves it. Neither a timeout nor an omitted history row authorizes automatic resend. Keep native failures observable without letting optional reconciliation unnecessarily disrupt active work; the exact isolation mechanism still needs design.

### Persistence is not interchangeable with optional polling

`EventLog` already batches routine fsync through a 50 ms window and supports `appendMany`. Certain delivery intent/receipt paths explicitly flush to establish durable evidence. Removing those barriers for fewer writes can create lost acknowledgements or duplicate actions after restart. Optimize optional reads and UI transport first; any durability change requires a separate crash/replay correctness argument and focused tests. This investigation did not profile fsync latency or establish persistence as the incident cause.

## Recommended next slices and acceptance

Subsequent user clarification establishes latency across runners, including Claude. The [cross-runner follow-up](cross-runner-analysis.md) supersedes the ordering below: first locate shared preparation/startup and user-visible delay, then prioritize each adapter's confirmed issues. The transport and persistence constraints below still apply.

1. **Protect active runner work.** Characterize concurrent unknown-receipt cases; coalesce compatible history reads and design safe oversized-response handling using supported native capabilities. Preserve exact correlation and no duplicate sends. Measure native RPC count/bytes and failures before/after. No Deck-side replay, custom compaction, context clearing, or extra inference calls.
2. **Reduce browser transfer and avoid unnecessary refreshes.** Audit a lean browser-only projection, preserve required public data and cursor continuity, and test hidden-tab/slow-request refresh behavior. Keep 40/120 paging and backpressure. Validate initial bytes, requests/minute, reconnects, current controls, history navigation and typing under event bursts.
3. **Address cold indexing if representative latency justifies it.** Measure daemon event-loop delay on first access and cache eviction across large sessions. Compare incremental/chunked construction, cache policy or a validated disposable persisted index only after that measurement. Any asynchronous construction must preserve the snapshot/live boundary without lost events; avoid introducing a new long-lived subsystem without evidence.
4. **Expose useful native progress.** Surface compaction and trustworthy context telemetry without repeatedly reading full transcripts. Use safe operation/phase/duration/byte metadata for diagnostics, with low overhead and no conversation payload logging. Distinguish cumulative usage from current context occupancy.

Use equivalent workloads and record actual daemon build, runner version, task/attempt, runtime and cache conditions. Compare p50/p95 for operation latency, initial bytes, event-loop delay and UI interactions; do not derive quota savings from byte counts. Reuse existing history/browser acceptance fixtures instead of regenerating scripts. Run only checks affected by each implementation delta.

## Verification and limits

Source reads verified the selected paths. Graph project `deck`, generation `2026-08-20T17:25:00Z`, reports these newer host/core/web files as not tracked, so direct-source fallback was used. No negative/exhaustive graph claims are made.

The measurement script completed successfully against a private temporary copy and cleaned it up. Its output contains only aggregate metadata. This is a research addition: no production fix, browser performance guarantee, original-community root cause, runner protocol capability validation, or new billing claim. Prior driver tests remain prior evidence; they were not rerun for documentation and an independent history measurement.

Installed CLI validation (`deck openspec validate --change session-context-latency-investigation --json`) passed with zero errors and warnings. Local artifact link and whitespace checks passed. No runtime test suite was needed for this documentation-only follow-up and its completed measurement probe.
