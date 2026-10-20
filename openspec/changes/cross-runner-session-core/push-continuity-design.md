# Push continuity increment — implementation design (revision 2)

Status: revised design for the authorized push workstream, 2026-10-19. Read-only; no source, OpenSpec, Git, daemon, subscription or live push actions.
Authority: `openspec/changes/cross-runner-session-core/push-continuity-brief.md` (incl. accepted mandatory-summary clarification and design review checkpoint), `conversational-continuity-contract.md` CC-2..CC-7, `web-push-brief.md` (transport security, Safari visible-push contract). Source (HEAD 2ceacd8 + dirty tree) outranks audit/investigator evidence.
Route: one vertical owner. No new Lead tools, MCP contracts, event kinds, core event schema or configuration/preview settings.

Revision 2 deltas vs revision 1: (a) mandatory bounded content summaries replace generic-only payloads; (b) six-hour session-wide coverage removed — coalescing only within one proven occurrence; questions/approvals never swallowed; (c) final-presentation evidence redefined structurally (role alone insufficient), with source-field limits and no semantic-proof claim; (d) interrupted attempts never alert — stop vs crash provenance is not durable; (e) stable failure seqs confirmed/added via replay projection with snapshot rebuild.

## 1. Verified current behavior (source)

- Producer `pushAttention(event)` `packages/session-host/src/web-push.ts:170`: pure per-event mapping (question/approval requested; Lead `turn.completed` completed→finished, failed→failure; `prompt.queue` paused with reason ∉ {interrupted, interrupted-forced, session-released, session-stopped}→failure; preparation failed; `session.released` with `reasonCode`). `accept` (`:493`) per-session monotonic seq filter, jobs 30 s expiry/2 s view ack, queue 256; `pump` (`:556`) gates and drops stale/failed jobs permanently. TTL 60 s. Payload `{sessionId, kind, seq}`.
- Currentness `SessionManager.isPushAttentionCurrent` (`session-manager.ts:363`): `finished` requires the whole session idle → reviewed results cannot alert while other work runs.
- Decisions and `task.integration` have no producer. Integration records live on the child attempt: `{seq, leadTaskId, leadAttempt, promptId?, commandId, state, note, evidenceSeqs}` (`ledger.ts:186-198`).
- Listeners run per event after `ledger.apply` (`session-manager.ts:802-808`); `finishTurn` appends `turn.completed`, optional `task.result{summary: turn.lastText}`, `task.state`, optional `prompt.queue` as one batch and deletes `live.turns` afterwards (`:1695-1710`) → evaluation must be deferred past the batch.
- **`message.completed` available fields** (drivers + host): `data.text`, `data.messageId` (Claude/Codex/OpenCode mappers), `data.role` (host defaults to `"assistant"`, `session-manager.ts:1667`; steering inputs are `role:"user", steering:true`), `source.{taskId, memberId, runnerId, nativeSessionId}`. **No driver emits a commentary/final phase or stop reason**: Claude mapper emits each `text` block (`adapter-claude/.../mapper.ts:189`), Codex each completed `agentMessage` (`adapter-codex/.../mapper.ts:54`), OpenCode each `text` part (`adapter-opencode/.../mapper.ts:76`, `driver.ts:229`). `data.internal` is set only on question/approval rows (`chat-history.ts:58-64`), never on assistant messages. Therefore "role assistant" (or `internal` absent) cannot distinguish commentary from the final answer.
- **Stop provenance** (verified): explicit session stop sets `turn.kind="stop"` → attempt `interrupted`, reason `session-stopped` (`:1688`, `:852`, `:1859`). Daemon shutdown (`close()` `:449-472`) sets `closing`; `finishTurn` then forces reason `daemon-stopped` (`:1682`) regardless of cause. Daemon stop causes (`daemon.ts:185-208`, `StopReason = string`) include idle, restart (refused while busy, `:166-170`), control stop and signals; the cause is only logged, never written to the session log. Restart recovery marks unfinished attempts `interrupted`/`daemon-restart` (`recovery.ts:100`), which also follows an explicit stop whose service close exceeded the 7.5 s timeout (`daemon.ts:196-200`). Startup then pauses with `reason: attempt.state` = `"interrupted"` (`session-manager.ts:235`). **Neither `daemon-stopped` nor `daemon-restart` proves a crash or excludes user intent.**
- **Stable seqs** (verified): `attempt.endedSeq` is set in replay when entering a terminal state `["completed","failed","cancelled","interrupted"]` (`ledger.ts:28,442`) → stable and replay-derived for `failed`. `ownership-unsettled` is not terminal → no stored seq. `session.releaseFailure` is a string with no seq (`ledger.ts:298`). Snapshots are rejected and fully rebuilt from the log when `v !== LEDGER_SNAPSHOT_VERSION` (`ledger.ts:512`, `loadLedger :526-545`). The dirty tree already changed the version (4→11, uncommitted).
- Genuine user admission: `UserPrompt.firstAdmissionSeq` ("first genuine admission", `ledger.ts:60-61`); daemon wakes go through `materializeLead` (`session-manager.ts:1273`).
- Restart recovery cancels pending questions/approvals (`recovery.ts:111-120`).
- Presence (`push-notifications.tsx:63-142`) reports `seenSeq` each heartbeat; non-null `sessionId` only while conversation visible and focused. Lease 45 s, in memory.
- Service worker (`apps/web/src/service-worker.js`): validates `{sessionId, kind, seq}` against fixed `bodies`, always displays, tag `deck:<sid>:<kind>:<seq>`.
- Existing redaction `redactText` (`packages/core/src/session/redaction.ts:10`): strips ANSI/control/bidi, URL userinfo, sensitive query params, Bearer/Basic, `key=value` secrets.

## 2. Design summary

Level-triggered evaluation of the current attention set, plus a small durable per-device delivery record:
1. Events are triggers only; after a 20 ms per-session debounce WebPush calls a read-only SessionManager derivation returning current `AttentionItem[]`.
2. Per device, enqueue items that are due, current, after the device floor, unviewed on that device, not yet recorded for `(key, revision)`, within age.
3. At send: re-derive (replaces `isCurrent`), coalesce only within one occurrence, build the bounded summary payload.
4. Restart, web-service start and subscription renewal run the same evaluation; no history replay.

## 3. Attention items

`AttentionItem = { sessionId, kind, key, revision, seq, ts, occurrence, summary?, count?, othersActive? }`. `seq` = durable event seq that created the occurrence (stable across restart; used for viewing and topic). `occurrence` = coalescing group id (§4.3).

No items when the session is not loaded, broken/stopping/removed/ended, daemon draining/closing, or released without `releaseFailure`.

| kind | key / revision | seq | occurrence | Due | Current while |
|---|---|---|---|---|---|
| `approval` | `approval:<approvalId>` / 1 | `approval.requested` | own key | immediately | pending in ledger |
| `question` | `question:<questionId>` / 1 | `question.requested` | own key | immediately | pending in ledger |
| `decision` | `decision:<decisionId>` / `questionRevision` | `questionSeq` | `lead:<origin.taskId>:<origin.attempt>` | origin Lead attempt not in `live.turns` | `state==="pending"` and same `questionRevision` (deferred = user intent → not current) |
| `result` | `result:<leadTaskId>:<attempt>` / 1 | Lead `turn.completed` seq | `lead:<taskId>:<attempt>` | at Lead completion | §3.1 holds; newest result per session; no prompt with `firstAdmissionSeq > seq` |
| `finished` | `finished:<leadTaskId>:<attempt>` / 1 | Lead `turn.completed` seq | `lead:<taskId>:<attempt>` | at Lead completion | existing global-idle gate unchanged (`session-manager.ts:371-376`) |
| `failure` | `blocked:<epochKey>` / 1 | epoch seq (§3.2) | own key | immediately | same block still in effect |

### 3.1 Final presentation evidence (structural; not semantic proof)

**Final segment** of Lead attempt L (completed): read the bounded window from `max(L.startedSeq, I)` to L's `turn.completed` seq (`log.readAfter`, events with `source.taskId === L.taskId`). A *barrier* is any of: `tool.started`, `tool.completed`, `question.requested|resolved`, `approval.requested|resolved`, host `task.integration`/`task.delivery`/`task.retrieval`/`decision.*` from L, and `message.completed` with `role !== "assistant"` (e.g. steering input). `hook.*`, `reasoning.delta`, `message.delta`, `usage`, `diagnostic` are ignored (not content, not barriers). The final segment = all `message.completed`, `role==="assistant"`, non-empty `text` events **after the last barrier**, in seq order, joined with blank lines.

Commentary exclusion: runner commentary/progress text is emitted before a subsequent tool call and therefore precedes a barrier; it is excluded. Limitation (documented): because no runner phase field exists, assistant text emitted after the last tool call but before another trailing assistant message is included as part of the final answer. Reasoning, tool input/output and raw payloads are never read.

**`result` requires:** (1) L ended `turn.completed{status:"completed"}`; (2) at least one integration with `state==="integrated"`, `leadTaskId===L.taskId`, `leadAttempt===L.attempt` (max seq `I`); `blocked`/`discarded` never qualify; (3) a non-empty final segment strictly after `I` (guaranteed when the integration call is itself the last barrier or earlier).

What this establishes: the Lead recorded a review claim (CC-2: a Lead claim, not independent proof) and afterwards ended the turn with user-visible final content. Temporal ordering does **not** prove the content describes the integrated result; copy therefore asserts only "Result reviewed" (the recorded claim) and shows the Lead's own final content as the summary. No Lead tool is added: the residual uncertainty is semantic, which a new tool would also only claim. Integration without a final segment → no `result` (falls back to `finished` only if idle).

`finished` and `result` use the same final segment for their summary; `decision` uses the structured `decision.question` field (Lead-authored, already user-facing in the Decisions panel).

### 3.2 Actionable blocked continuation (provenance-safe)

Actionable only when provenance excludes user intent from durable fields:

| Block | Condition | epochKey / seq |
|---|---|---|
| Lead failure | Lead latest attempt `failed`, `lastResumeSeq < endedSeq` | `lead-failed:<taskId>:<attempt>` / `endedSeq` (verified stable) |
| Ownership unsettled (Lead, or child with pending wake `live.notices.size>0`) | latest attempt `ownership-unsettled` | `unsettled:<taskId>:<attempt>` / new `attempt.unsettledSeq` |
| Release failure | `session.releaseFailure` set | `release:<releaseEpoch>` / new `session.releaseFailureSeq` |
| Preparation failure | `live.preparation.state.status==="failed"` (memory only) | `prep:<diagnostic seq>`, live-only, never recovered |

**Never alert:** any `interrupted` attempt (`session-stopped`, `session-released`, `interrupted-forced`, no reason, `daemon-stopped`, `daemon-restart`), `cancelled`, queue paused by `turn.interrupt`, Close/release without `reasonCode`, stop, remove. Rationale: §1 shows daemon-stopped/daemon-restart can follow an explicit user/operator stop and the cause is not durable. This matches current effective behavior (shutdown-time alerts are dropped by draining; restart has no replay). Alerting genuine crashes would need a durable clean-shutdown marker — out of scope, recorded in §9.

A child terminal outcome during an actionable block is a trigger only (same epoch key → no duplicate). Ordinary child completion and turn release produce nothing.

Ledger projection additions (replay-derived from existing events, no event change): `attempt.unsettledSeq` = seq of the `task.state` that enters `ownership-unsettled` (cleared on leaving it); `session.releaseFailureSeq` = seq of the `session.released` that sets `releaseFailure` (cleared with it). Bump `LEDGER_SNAPSHOT_VERSION` to the next value above the integrated tree's value at merge time (dirty tree is at 11) so old snapshots rebuild from the log and the fields are complete; no historical alert results because of the device floor (§5).

## 4. Delivery

### 4.1 Triggers
`question.requested|resolved`, `approval.requested|resolved`, `decision.opened|revised|state`, `task.state` (any member), Lead `turn.completed`, `prompt.queue`, `prompt.dispatched`, `session.released`, `session.recovered`, `diagnostic` `session.preparation`. Debounced `evaluate(sessionId)` at +20 ms. The per-session `seen` filter is removed.

### 4.2 Per-device eligibility
Subscription present and device active; `item.ts >= device.since`; `device.viewed[sessionId] < item.seq`; no delivery entry for `(sessionId, key)` with `revision >= item.revision`; age ≤ 24 h (decision/failure/question/approval) or ≤ 30 min (result/finished). **No cross-occurrence coverage**: an earlier unseen notification never suppresses a later independent item.

### 4.3 Coalescing (only proven same occurrence)
- Same key: a newer revision replaces a queued older revision (the older is not current anyway).
- Same Lead-completion occurrence `lead:<taskId>:<attempt>`: decisions opened by that attempt, its `result` and its `finished` are derived from the same durable completion → one push; priority decision > result > finished; `count` = number of decisions; the rest recorded `covered` only after a 2xx.
- Same block epoch: one key by construction.
- Questions and approvals are their own occurrences: each distinct request is sent (subject only to viewing/currentness); never covered or merged.
- Decisions from different Lead attempts, results of different attempts, and failures are never merged with each other.

### 4.4 Viewing (per device; never resolution)
Existing presence/`seenSeq`/2 s acknowledgement unchanged. New: when presence has non-null `sessionId` and `seenSeq` exceeds the stored value, persist `device.viewed[sessionId] = seenSeq`. Opening, receiving or clicking a push never mutates decisions, integrations, questions or approvals.

### 4.5 Expiry and retries
| | question/approval/decision/failure | result/finished |
|---|---|---|
| in-memory job deadline | 10 min | 2 min |
| provider TTL | 600 s | 120 s |
| transport error, deadline abort, 429, 5xx | ≤ 3 attempts, backoff 5 s / 30 s, identical payload/topic | same |
| 404/410 | remove subscription + attention entry | same |
| other 4xx | record `failed`, no retry | same |

Exhausted → `failed`, not re-sent after restart. Concurrency 4, queue 256, earliest-deadline timer unchanged.

### 4.6 Summary derivation (mandatory by default, deterministic, no model call)

Inputs: `result`/`finished` → final segment text (§3.1); `decision` → `question` of the highest-`questionSeq` pending decision in the occurrence. Question, approval, failure → no summary (not Lead response content; approvals carry tool content; failures carry raw errors) — static copy.

Algorithm `summarize(text): string | undefined` (pure, in `push-attention.ts`):
1. `redactText(text, 8192)` (existing core redaction). Image paths are already redacted at ingestion (`redactImagePaths`).
2. Markdown → plain blocks, line-based: drop fenced (```/~~~) and indented code blocks entirely; drop HTML tags, table rows/separators and horizontal rules; heading lines are block separators and are not emitted; strip blockquote and list markers (each list item is its own block); `![alt](u)`→alt, `[t](u)`→t, bare/auto URLs → hostname; inline code keeps its content without backticks; remove emphasis/strike markers; any whitespace-free token > 40 code points → `…` (hashes, tokens, long paths); collapse whitespace.
3. Blocks = paragraphs/list items in order. Lead-in rule: a block ending in `:`/`：` that is followed by list items is dropped in favor of those items.
4. Sentence extraction with `Intl.Segmenter(undefined, {granularity:"sentence"})` (UAX #29, locale-neutral, no translation). Take the first sentence of each block in order and join with ` · ` while the total stays ≤ 160 graphemes (`Intl.Segmenter` grapheme). This yields the key point of several blocks instead of one truncated introduction. If the first sentence alone exceeds the budget, cut at the last word boundary (`granularity:"word"`) ≤ 159 graphemes and append `…`.
5. Final caps: ≤ 160 graphemes and ≤ 480 UTF-8 bytes (trim by graphemes); empty → `undefined` (static fallback).

Language is whatever the Lead wrote; only static labels are English. Summaries are computed at send time from the durable log, never persisted in the attention store, never logged or included in delivery status. Transport remains Web Push aes128gcm via `web-push` with the existing provider allowlist/DNS pinning/no redirects; the provider cannot read payloads. The user explicitly accepted lock-screen content with no preview setting.

Accuracy guard: `othersActive = true` when any non-Lead latest attempt is `created|queued|running`, or queued user prompts exist; then the result title states that other work continues. `finished` occurs only when idle (existing gate). Summaries never add host claims of completion.

### 4.7 Payload, copy and legacy workers

Wire payload (≤ ~1 KB; within the 4 KB Web Push limit):
`{ sessionId, kind: legacyKind, seq, attention, summary?, count?, othersActive? }` with `legacyKind`: decision→`question`, result→`finished`, others identical. A pre-upgrade service worker ignores extra fields and displays its existing generic `bodies[kind]` → Safari visible-push contract preserved.

New service worker:
- Validate `attention` ∈ known kinds (else use `kind`); `summary` must be a string ≤ 480 bytes; re-strip control/bidi characters and collapse whitespace; invalid → ignored.
- Title (static English): decision "Decision needed" (`count>1`: "`${count}` decisions need you"); result "Result reviewed" (`othersActive`: "Result reviewed · other work continues"); finished "Lead replied"; question/approval/failure "Deck".
- Body: valid `summary`, else static fallback: decision "A decision is waiting for you."; result "A reviewed result is ready."; finished "The Lead is ready for you."; question "A question needs your response."; approval "An approval needs your response."; failure "Work needs your attention."
- Tag: `deck:<sid>:decision:<decisionId-hash>` for decisions (a revision silently replaces a still-shown older revision, `renotify:false`; a dismissed one alerts normally) — requires a `tagId` field = sha256(key) base64url 16 chars in the payload; all other kinds `deck:<sid>:<attention>:<seq>` (unique per occurrence, preserving the prior review decision). Topic = sha256([sessionId, key, revision]) truncated to 32 (stable across retries/restart).
- Never render HTML/Markdown; `showNotification` body is plain text.

## 5. Durable state and migration

New private `webDir/push-attention.json` (`writePrivateFile`/`assertPrivateFile`; `push.json` v1 untouched):
```
{ v: 1, devices: { "<JSON[deviceId,origin]>": {
  since: <ms>,
  viewed:    { <sessionId>: <seq> },   // LRU ≤ 64
  delivered: { <sessionId>: { <key>: { revision, seq, outcome: "sent"|"suppressed"|"covered"|"failed", at } } } // ≤ 512/device, prune > 7 d
} } }
```
IDs/seqs/codes/times only — no summaries. Strict validation, `Map`/null-prototype reconstruction. Absent file → create with `since=now` per existing subscription (no historical alerts); invalid → rewrite fresh with `since=now`, never crash. New (device, origin) subscribe → `since=now`; renew preserves. Unsubscribe/revoke/404/410/inactive delete the device entry, including the dormant revoke path (`web-service.ts:151-152`). Synchronous writes on outcomes and viewed increases; write failure keeps in-memory state and increments a redacted diagnostic counter.

Ledger: `unsettledSeq`, `releaseFailureSeq` + snapshot version bump (§3.2).

## 6. Crash windows (no exactly-once claim)

| Window | Outcome |
|---|---|
| Event durable, crash before evaluation | Recovered if still current, in age and after floor; questions/approvals are cancelled by recovery → none |
| Enqueued, crash before send | No entry → sent once after restart |
| Provider 2xx, crash before entry write | Re-sent with identical topic/tag; usually collapsed; **visible duplicate possible, documented** |
| Viewed, crash before viewed write | One avoidable alert possible |
| Resolved while in flight | Accepted messages cannot be recalled; SW must display (existing limitation) |
| Store unwritable | Best effort for the process; bounded by age/floor after restart |

Status counters gain `covered` and `retried`; 2xx remains "accepted by provider".

## 7. Exact implementation targets

| File | Change |
|---|---|
| `packages/session-host/src/push-attention.ts` (new) | Pure `deriveAttention(input)` (§3 incl. final-segment barrier scan, provenance-safe blocks) and `summarize(text)` (§4.6). Input: ledger, live flags, live turn ids, notices count, preparation status, bounded log-window reader |
| `packages/session-host/src/session-manager.ts` | `pushAttentionItems(sessionId)`, `pushAttentionSessions()`; remove `isPushAttentionCurrent` (finished gate moves verbatim) |
| `packages/session-host/src/service.ts`, `daemon.ts:131` | Swap optional interface methods; draining → [] |
| `packages/session-host/src/web-push.ts` | Triggers/debounce, evaluate, attention store, eligibility, occurrence coalescing, retry/TTL, payload (`attention`, `summary`, `count`, `othersActive`, `tagId`), topic by key/revision, counters, evaluate on startup/renew. Remove `seen`. Transport/SSRF/subscription validation unchanged |
| `packages/session-host/src/web-service.ts:112-116,150-152` | Wiring; dormant revoke cleans attention store |
| `packages/session-host/src/ledger.ts` | `unsettledSeq`, `releaseFailureSeq`, snapshot version bump (coordinate with Apply attempt13, which also edits this file) |
| `apps/web/src/service-worker.js` | Titles/bodies/summary validation/tags per §4.7 |
| `apps/web/src/push-notifications.tsx` | Only if counters are enumerated: `covered`/`retried` labels |
| `docs/cross-runner-sessions.md` | Kinds, summaries (lock-screen content, no setting), per-device viewing, recovery bounds, duplicate limitation, no crash alerts |

Unchanged: Lead tools, MCP, core events/schema, decision/integration authority, brokers, presence protocol, opt-out/revocation, transport.

## 8. Smallest test matrix (fake transport/clock; no real pushes)

`push-attention.test.ts` (new):
1. Final segment: commentary before a tool call excluded; multiple trailing text blocks of one messageId joined; steering user message is a barrier; reasoning/tool output never included; hooks ignored.
2. Result: integrated + final segment after integration + completed while a child runs → item with `othersActive`; negatives: final text only before integration, `blocked`/`discarded`, integration by another Lead attempt, Lead failed, no trailing text. Retired after `firstAdmissionSeq > seq`.
3. Decision: not due while origin attempt runs; due after; revision → new revision; deferred/answered/cancelled/superseded → none.
4. Blocks: Lead failed → `endedSeq` key; unsettled → `unsettledSeq`; release failure → `releaseFailureSeq`; session-stopped, daemon-stopped, daemon-restart (startup pause `"interrupted"`), forced, cancel, release without reason → none; child completion during block → same key. Projection fields identical after snapshot load vs full rebuild; old-version snapshot rebuilds.
5. `summarize`: fenced code/table/HTML/links/long tokens removed; lead-in `:` uses list items; multi-block `·` packing ≤ 160 graphemes; CJK and Spanish text preserved (no translation); emoji/combining grapheme-safe cut; secrets via `redactText`; byte cap 480; empty → undefined.
6. Finished: existing idle-gate assertions ported.

`web-push.test.ts` (extend):
7. One Lead completion with decision + result + finished → one push `attention:"decision"`, `count`, decision summary; others `covered`.
8. Unseen approval alert, then an independent decision/result/failure → each still sent (no coverage). Two simultaneous approvals → two pushes.
9. Re-evaluation repeats → no duplicate for same (key, revision); decision revision → one push with same decision tagId, new topic.
10. Per-device viewing: A suppressed, B sent; A's durable `viewed` suppresses after restart.
11. Retry: 503→201 one `sent`, `retried`, identical payload; 400 → `failed`; 410 → removal + entry deleted.
12. Recovery/migration: `sent` entry → none; missing entry in age → one; `ts < since` → none; absent store → none; invalid store → none + fresh file; beyond age → none.
13. Crash window: 2xx with persistence suppressed → restart re-sends once, identical topic/tag.
14. Revoke/unsubscribe/dormant revoke; draining → no items. Payload contains only allowed fields; summary absent for question/approval/failure.

`service-worker.test.ts`: summary body + static titles; invalid/oversized summary → fallback; legacy payload (no `attention`) → existing copy; decision tag stable across revisions; plain-text only.
`web-push-daemon.test.ts`: production composition — result alert while a delegated task runs (summary present), and recovery after restart.

Gate: independent security/protocol review (payload content, summary sanitization, store, retry) before canary install.

## 9. Material choices / residual uncertainty

1. Presentation evidence is structural (review claim + trailing final content), not semantic proof; accepted as the host's limit without new Lead authority.
2. Genuine crashes do not alert (provenance not durable). A durable clean-shutdown marker would enable it; not proposed.
3. Recovery horizon 24 h / 30 min — tunable constants.
4. Duplicate posture: resend on uncertainty with stable topic/tag (collapsible) rather than at-most-once.
5. Question text summaries excluded (child questions, possible tool context); revisit only if the user wants question content on the lock screen.


## Lead implementation constraints (override conflicting recommendations above)

- A shared Lead attempt is not proof that a decision and an independently reviewed result are equivalent attention. Do not permanently cover one with another solely because they share an attempt. Either present both explicitly in a bounded combined notification with tracked constituent identities, or send separate occurrences. A summary of only one decision cannot cover independent decisions. Prefer simple distinct delivery over lossy grouping.
- Native assistant phase is absent today. Final-segment extraction is a heuristic, not guaranteed exclusion of all commentary; tests and docs must state this limitation. Do not label arbitrary trailing text as semantic proof of the reviewed result.
- Retrying preserves occurrence identity but must revalidate current relevance and device authorization before each send. Changed revisions supersede old queued work.
- Questions/approvals/failures may retain safe fallback copy where no eligible Lead response exists; no optional-preview configuration. The accepted default summaries apply to eligible Lead replies/results and decision questions.
- Preserve intentional-stop behavior; do not infer crash provenance. Crash-specific notifications remain outside this increment, while recovery of existing relevant attention is required.
- One implementation owner for push. Preserve concurrent runner work in ledger/session-manager; use narrow edits, check actual snapshot version, and retain prior migrations. Do not hand-edit generated outputs.

## Accepted representation correction after Quality attempt 13

The prior 512 total-receipt bound is superseded. It was an internal design choice, not a user-requested quota. Use a 512-entry memory cache backed by an exact private durable outcome index, with storage proportional to recoverable outcomes and compaction by expiry or proven durable retirement. Temporary absence, deferral or draining is not retirement. Preserve every independently eligible occurrence; no broad suppression floors, probabilistic membership or fixed-count eviction. Disk/I/O errors must remain explicit, not silently become delivered receipts. No new user configuration is required.

Delivery accounting is attached to occurrence plus opt-in authorization epoch across queued/active/retry states. Renewal changes destination generation, never retries/backoff or known acceptance. Old endpoint errors cannot revoke replacement subscriptions; revocation invalidates the authorization epoch. Markdown summary parsing must remove complete table blocks, including optional outer pipes and containers, before normalized-prose redaction and existing caps.

This is an in-scope implementation correction accepted by Lead under the user's existing authorization. Evidence: Apply Fast attempt 3, result 50236/ended 50237; /tmp/deck-push-continuity-design-correction.md. No activation approval is implied; focused regressions and independent re-review remain mandatory.
