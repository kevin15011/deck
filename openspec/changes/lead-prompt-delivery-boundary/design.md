# Design: Lead prompt delivery boundary

> **Status:** Approved first slice implemented; verification recorded below. Live runner activation remains pending (no daemon restart).
> **Origin:** User requirement: "No messages left in limbo — appearing in the chat while the Lead has not actually read them." Follow-up to P-002 (`openspec/pending-issues.md`) and related to P-006 (`codex-startup-failed`) and P-012 (failure recovery).
> **Evidence base:** working tree on `fix/session-pending-issues` at the time of analysis. `packages/session-host` has uncommitted edits from another session, so line numbers are approximate anchors.

## 1. Problem trace (current behavior)

Lead user prompt lifecycle today (`packages/session-host/src/session-manager.ts`, `ledger.ts`):

1. `prompt.send` → `prompt.queued` (state `queued`). The prompt is in the authoritative inbox and **recallable** (`cancelPrompt`, ~L1572).
2. `pumpPrompts` (~L1557) → `materializeLead` (~L1599) creates the attempt and queues a `Turn`. The prompt **stays `queued`** and remains recallable while preparation runs `checking-runner` (driver probe) and `preparing-tools` (child MCP resolution). Cancelling here already aborts the turn correctly.
3. At `starting-runner`, `launchTurn` calls `admitLeadInput` (~L1040). It durably appends and flushes **`prompt.dispatched` + `message.completed{role:"user"}`** (+ `decision.reply`, + `task.delivery` for delegated-completion notices). From now on:
   - the ledger marks the prompt `dispatched` → `prompt.cancel` returns `prompt-already-started`;
   - the web chat renders the user bubble (`apps/web/src/state.ts` pushes every `message.completed` with `role:"user"`), and the inbox moves it to `active`;
   - `chooseEscapeAction` (`apps/web/src/composer-keyboard.ts`) can only interrupt.
4. Then `task.state running launched:true` is flushed and `driver.startTask(input, io)` runs. **The prompt text reaches the native runner only somewhere inside, or after, `startTask`.** That point is runner specific (§2).
5. On failure or interrupt, `finishTurn` writes `prompt.state` = `failed`/`interrupted`. The ledger then **deletes the prompt text** and pauses the queue. The user bubble stays in chat as if the Lead had read it.

**Limbo window:** from step 3 until the runner has actually received the input. For Codex, this window covers the entire app-server startup: spawn, `initialize`, `config/read`, `thread/start|resume`, and `verifyRuntimeMcp`, which polls for up to 30 s. That is exactly where `codex-startup-failed` and MCP timeouts happen (P-006). The comment on `admitLeadInput` ("No asynchronous boundary may separate this durable fence from startTask") holds for the *attempt-binding fence*. However, `startTask` is not the delivery point for two of the three drivers.

Related artifacts recorded at admission that have the same limbo problem:
- `decision.reply` (a decision is shown as "replied" even though the Lead never received the reply).
- `task.delivery` / `lead.notices-delivered` for delegated-completion notices (L1075). A pre-delivery failure can mark notices delivered even though the Lead never saw them. **Verify this in the slice:** notices may be re-offered by other paths.
- `continuityBlock` / `firstAdmissionSeq` (ledger L258-260).

## 2. Per-runner handoff point and acknowledgement

`turn.started` is **not** a uniform "model has the prompt" signal. The host comment at ~L1799 already concedes this.

| Runner | Where text is handed over | Native acknowledgement available | What `turn.started` means | Where "delivered" can be wrong |
|---|---|---|---|---|
| **Codex** (`adapter-codex/src/session-driver/driver.ts`) | `startTask` returns immediately. `CodexTask.start()` runs `initialize()` (spawn, `initialize` RPC, `config/read`, optional second process for hook attestation, `thread/start`/`thread/resume`, `verifyRuntimeMcp`). Only then does `send()` → `rpc.call("turn/start", {input:[{type:"text",text}]})` (~L471). | **Yes.** The `turn/start` JSON-RPC response with `turn.id` (`state.confirmedId`) is an explicit receipt. The `turn/started` notification with a matching id is equivalent. | Mapped from the native `turn/started` notification. **Reliable** (post-receipt). | (a) `turn/start` written, then `codex-rpc-timeout` (30 s) or process exit before the response → **unknown**. (b) JSON-RPC `error` response → explicit refusal, but `send()` currently collapses timeout and refusal into `codex-turn-start-failed`, so they cannot be told apart yet. (c) Any failure inside `initialize()` (all `STARTUP_ERROR_CODES`, `codex-startup-failed`) happens **before** `turn/start` → **definitely not delivered**. |
| **Claude** (`adapter-claude/src/session-driver/driver.ts`) | `runTurn`: `io.spawn` → `child.writeStdin(userMessage)` immediately (~L167), **before** `system/init`. Non-guarded turns then close stdin. | **No direct receipt.** Indirect evidence: guarded (steering 2.1.296) echo of the user message with `uuid === executionId` (`originalObserved`); transcript root verification (`historyVerified`); the first `assistant`/`stream_event` for the session; a `result` with `user_message_uuids` containing `executionId`. | Mapped from `system/init` (`mapper.ts` ~L193). **Not proof of receipt.** It reports process/MCP initialization, and the bytes may still sit in the pipe. | Write succeeds into the pipe buffer but the process dies before init or before processing (MCP failure, auth failure, crash) → **unknown**. Pre-init exit is *likely* undelivered but unverified, because a resumed session could already have persisted the message. Spawn failure (before write) → **definitely not delivered**. |
| **OpenCode** (`adapter-opencode/src/session-driver/driver.ts`) | `startTask` awaits `initialize()` (server spawn, `/config`, `/mcp`, tool ids, `/agent`, session create/resume, `/event` SSE, pending permissions/questions). Then `send()` emits `turn.started` and **then** POSTs `/session/:id/message` (~L350-351). The POST stays open for the whole turn. | **Partial.** An SSE `message.updated` with `role:"user"` and matching `sessionID` (OpenCode persists the user message first), or `session.status` busy. The mapper currently ignores user-role updates. POST success is only known at turn end. | Emitted **before** the POST: a request boundary, not receipt. **Misleading.** | `initialize()` failure → **definitely not delivered**. POST network error, abort, or server death before a user `message.updated` → **unknown**. A 4xx validation response → refusal. |
| **Pi** | **No cross-runner session driver.** `adapter-pi` exposes no `getSessionDriver`, so Pi cannot be a session Lead. | n/a | n/a | Any future driver must adopt the contract in §3 or be treated as "unknown after handoff". |

### Existing races found (should be verified with tests)

- **Codex lost interrupt (suspected bug).** If `interrupt()` runs after `threadId` is set but before `send()` creates `this.turn` (the `verifyRuntimeMcp` window, up to 30 s), it takes the `!state` branch and returns without closing or marking anything. The host calls `handle.interrupt()` only once. `start()` then calls `send()` and **delivers `turn/start` after the user interrupted.**
- **Claude pre-spawn interrupt.** `interrupt()` before `state.child` exists sets `interruptRequested`. After spawn, `deliverInterrupt` runs and then **`writeStdin(userMessage)` runs anyway**, so the prompt is handed over after the interrupt.

The gate in §3 closes both races.

## 3. Prompt delivery state model

Add a per-prompt **handoff** dimension to `dispatched` prompts. The name `handoff` avoids a clash with the existing `UserPrompt.delivery: "current-turn"` steering field.

```
queued ──admit──▶ dispatched/handoff=pending ──claim──▶ dispatched/handoff=sending ──ack──▶ dispatched/handoff=delivered ──turn end──▶ completed | failed | interrupted
   ▲                        │                                    │
   │ requeue (undelivered)  │ recall (cancel before claim)       │ failure/exit/timeout without ack
   └────────────────────────┤                                    ▼
                            ▼                              handoff=unknown (terminal: failed|interrupted)
                       cancelled (text returned to the composer)
```

- **pending:** admitted to an attempt, transcript bubble exists, **no byte has left Deck**. Recallable.
- **sending:** Deck has claimed the handoff and is about to write or has written (stdin write, `turn/start`, POST). **Possibly delivered. Never recallable.**
- **delivered:** native evidence the runner accepted the input (§2 table).
- **unknown:** the attempt ended after `sending` without an ack. Treat it as possibly delivered: no recall, no automatic resend.
- **refused:** an explicit native rejection of the input (Codex JSON-RPC error on `turn/start`, OpenCode 4xx). Treat it like an undelivered prompt (requeue). Implement only where the adapter can positively distinguish refusal from timeout.
- **requeued:** an undelivered prompt (pending, or refused) whose attempt ended. It returns to the **head of the queue**, the queue is **paused** with a reason, and its text is retained.

### Authoritative read boundary (conservative)

The boundary is **`claim`**, not `ack`. Recall and requeue are allowed only while the handoff is `pending`. Once `claim` returns true, the prompt is at least "possibly delivered" until an ack upgrades it to `delivered`. Uncertainty never permits recall.

**Claim mechanism (the key to race-freedom):** add a synchronous `DriverHostIo.claimInput(): boolean`:
- The host checks, in the same synchronous JS turn, that the attempt is current, the turn is not aborted (`turn.kind`/`controller.signal`), the session is not closing, and the prompt is still `dispatched/pending`.
- If those checks pass, it appends **and flushes** `prompt.handoff {promptId, taskId, attempt, state:"sending"}` and returns `true`.
- Otherwise it returns `false`.
- Drivers call it **immediately before** the native write, with no `await` between claim and write:
  - Codex: before `rpc.call("turn/start")` in `send()`. `CodexRpc.call` writes synchronously.
  - Claude: before `child.writeStdin(userMessage)`.
  - OpenCode: before the `/message` POST (the POST is async, which is fine because a successful claim already counts as possibly delivered).
- If `claimInput()` returns `false`, the driver must **not** write. It resolves `done` with `interrupted` (or `failed` with `input-claim-refused`) and closes.
- Because cancel and claim both run on the daemon's single JS thread, exactly one wins. If flushing fails, the driver throws without writing.
- Turns without a user prompt (synthetic or notice wakes) and delegated turns get a trivial `true`, which keeps current behavior.

**Ack mechanism:** a driver event `{kind:"diagnostic", data:{code:"input.delivered", evidence}}`, or a dedicated driver signal mapped by the host. The host also treats the **first correlated model-output event** of the attempt (`message.delta`, `reasoning.delta`, `tool.started`, assistant `message.completed`, `usage`) as a generic runner-agnostic ack. Per-runner precise acks are listed in §2. The host appends `prompt.handoff{state:"delivered", evidence}` once per attempt; the operation is idempotent.

## 4. Behavior per case

| Case | Behavior |
|---|---|
| **Double-Esc during `queued`** (incl. checking-runner / preparing-tools) | Unchanged (P-002): cancel and recall. |
| **Double-Esc during `pending`** | `prompt.cancel` now also accepts `dispatched` + `handoff=pending`. It appends `prompt.state cancelled` (reason `recalled-before-delivery`) plus the receipt, then sets `turn.kind="cancel"`, aborts the controller and calls `handle.interrupt()`. The driver's later `claimInput()` returns false, so nothing is written. The web restores the text with the existing `recallAndRestore` merge (draft preserved; managed image attachments are restored together with the text). Chat hides the bubble (§5). The queue is **not** paused for a recall, because the user chose to edit; the existing `cancelPrompt` behavior pumps the next prompt. |
| **Double-Esc during `sending`/`delivered`** | Recall refused (`prompt-already-started`). Double-Esc falls through to **interrupt**, as today. |
| **Interrupt button during `pending`** | The user intends to stop, not to edit. The turn is aborted, and on finish the undelivered prompt is **requeued at the head, queue paused (`interrupted`)**. The bubble disappears from the transcript and the item reappears in the paused queue, where it can be recalled (double-Esc), cancelled, or resent (Resume). Nothing is lost and nothing appears read. |
| **Startup failure before claim** (e.g. Codex `initialize` / MCP timeout → `codex-startup-failed`, OpenCode `initialize` failure, Claude spawn failure, probe/MCP resolver failure) | **Requeue at head, queue paused with the failure reason; no automatic retry.** Reasons: (1) these failures are often persistent (P-006) and auto-retry would loop and burn startup cost; (2) P-012's settled posture is explicit manual retry after diagnosis; (3) keeping the text in the **server-side queue** rather than pushing it into a client composer survives reloads, other devices and absent users, and the existing P-002 recall code already works on queued items. The P-012 failure card explains the cause; **Resume** retries the same prompt and **double-Esc** recalls it for editing. |
| **Failure after claim, without ack** (Codex `turn/start` timeout, Claude exit after write, OpenCode POST network error) | The attempt ends `failed`/`interrupted` and `handoff=unknown`. The bubble shows a **"Delivery unconfirmed"** marker. No recall and no auto-resend, because a resend could duplicate a message the runner may have persisted. Offer **"Send again"**, which copies the text into the composer as a new prompt (copy, not recall). The text is available from the retained `message.completed`. |
| **Failure after ack** | Existing P-012 behavior; the bubble is normal (read). |
| **Interrupt after delivery** | Normal interrupt; no recall; bubble normal. |
| **Daemon restart / crash** | On load (the `queueMicrotask` scan ~L258 and `recovery.ts`), for each gated `dispatched` prompt whose attempt is terminal or recovered: no `prompt.handoff` → **requeue at head, paused (`daemon-restart`)**, because Deck provably wrote nothing; `sending` without `delivered` → `unknown`; `delivered` → existing behavior. A crash between flushing the claim and the actual write is classified `unknown` (conservative, acceptable). |
| **Reseed retry** (`native-session-not-found` relaunch) | Unchanged flow. Each attempt claims again. The original attempt's claim and its "session not found" outcome remain `unknown`/refused; the automatic reseed proceeds as today. |

## 5. Ledger, event and web changes

### Events and ledger (`packages/core/src/session/events.ts`, `ledger.ts`, `session-manager.ts`)

- **New event kinds:** `prompt.handoff` `{promptId, taskId, attempt, state:"sending"|"delivered"|"unknown"|"refused", evidence?, reason?}` and `prompt.requeued` `{promptId, taskId, attempt, reason}`. Add them to `SESSION_EVENT_KINDS`. Regenerate `schema.generated.ts` with the generator; do not hand-edit it.
- **`prompt.dispatched` gains `handoff:"gated"`.** Only gated dispatches can be classified undelivered or requeued. **Legacy ledgers** (no flag) keep today's semantics: dispatched counts as possibly delivered, is never recallable, and is never requeued. Replay of old events is unchanged.
- **`UserPrompt`** gains optional `handoff?: {state, seq, evidence?}` and `requeuedSeq?`.
  - The `prompt.requeued` reducer sets `state:"queued"`, **retains `text`**, clears `taskId/attempt/dispatchedSeq/handoff`, and moves the prompt to the queue head. Position ordering needs a `queueOrder` or requeue seq, because `prompts()` currently sorts by `seq`.
  - The reducer also sets `promptQueue.paused` with the reason.
  - Clearing `dispatchedSeq` makes the next dispatch emit a fresh `message.completed`.
- **`prompt.state` terminal** keeps deleting text (privacy posture), except that undelivered prompts never reach it: `finishTurn` emits `prompt.requeued` instead of `prompt.state failed|interrupted` when `handoff` is still pending or refused.
- **`cancelPrompt`** accepts `dispatched && handoff pending`.
- **`continuityBlock` / `firstAdmissionSeq`, `decision.reply`, and notice `task.delivery`** should bind to **delivery** (claim or ack), not admission. Approved decision: defer decision replies, notice delivery accounting and continuity authority until delivery acknowledgement, including the first correlated model output. Requeue needs no compensating consumption events because admission consumes none of them. These are durable contracts in P-013 and decisions.
- **Inbox projection (`promptInbox`, ~L1446):** `active` gains `handoff` and, while it is `pending`, `text` and `attachments`, so the client can recall it without relying on chat history.
- **Snapshots:** additive optional fields. Bump `LEDGER_SNAPSHOT_VERSION` only if replay of existing kinds changes; it does not.
- **Driver contract (`packages/core/src/session/driver.ts`):** add `claimInput(): boolean` to `DriverHostIo`, plus an optional ack signal. The three production drivers advertise `supportsInputClaim: true`. Drivers without that capability keep legacy admission semantics; they are never classified as safely recallable after admission. The optional host callback preserves older driver fixtures and hosts.
- **Adapter fixes:** Codex `send()` distinguishes JSON-RPC error responses (refused) from timeouts and exits (unknown). Codex `interrupt()` in the post-thread/pre-send window must set a flag that `send()` honors (the claim makes this automatic). Claude must not write after `interruptRequested`. OpenCode should emit `turn.started` from native evidence (a user `message.updated`) or rename the pre-POST event, so preparation does not flip to `turn-started` early.

### Web (`apps/web`)

- **`chooseEscapeAction(queued, active, leadTaskId)`:** priority goes to the newest queued item, then to `active` when `handoff==="pending"` (kind `recall`, using the active text), then to interrupt. `recallAndRestore` also restores managed image references after the matching cancellation receipt; it already restores only on a matching `{promptId, state:"cancelled"}` receipt, treats `prompt-already-started` as `already-started`, and preserves the draft.
- **Chat rendering (`state.ts` messages, `packages/core/src/session/chat-history.ts` retention):** user bubbles are joined to prompt handoff state by `promptId`.
  - `pending` / `sending`: muted bubble with "Sending to <runner>…", reusing the steering `sending` style and labels from `steering.tsx`.
  - `delivered`: normal bubble, no marker.
  - `unknown`: "Delivery unconfirmed" with a **Send again** action.
  - `requeued` / `cancelled` before delivery: **the bubble is hidden from the transcript.** The text lives in the paused queue or the composer.
  - Legacy (non-gated) prompts render as today.
- `chat-history.ts` must retain the latest `prompt.handoff` / `prompt.requeued` per promptId, the same way it retains `queued:`/`failed:` keys, so paging does not lose markers.
- `prompt-queue.tsx` labels requeued items: "Not delivered: <reason>. Resume to send, or press Esc twice to edit".

## 6. Risks and race windows

1. **Cancel vs claim:** resolved by the synchronous single-thread claim; it must stay free of `await` between check, flush and native write in each driver. Covered by adapter tests.
2. **Claim flushed, crash before write:** classified `unknown`, a false "maybe delivered". This is conservative by design.
3. **Old web clients** seeing new event kinds: verify that `reduceInbox` and `state.ts` ignore unknown kinds. They should, because projections switch on kind.
4. **Decision replies, notices and continuity** recorded at admission (§5): this is the main semantic risk. If deferred, a requeued prompt leaves a decision looking replied and notices marked delivered.
5. **Queue ordering on requeue:** `prompts()` sorts by creation `seq`. Requeue-to-head needs explicit ordering, or else FIFO creation order must be documented to already place it first. It does, because older prompts precede newer ones, but `position` must be recomputed.
6. **Requeue loops:** none, because the queue is paused on every requeue and only an explicit Resume re-dispatches.
7. **The generic output ack** could be triggered by native output belonging to a *previous* turn on a resumed process. Correlate output with the current attempt and native turn id (Codex `turnId`, Claude `executionId`/session id, OpenCode `sessionID` plus post-claim ordering).
8. **Claude pre-init exit** stays `unknown` until a fixture proves that Claude persists nothing before init. Only then could it be downgraded to undelivered.
9. **Concurrent edits** in `packages/session-host` (another session) will conflict with `ledger.ts`/`session-manager.ts` changes. Sequence this work after that branch lands.

## 7. Test plan

- **session-host (fake driver with a controllable `claimInput` point):**
  - cancel during pending → receipt `cancelled`, the driver's claim returns false, no write, no `prompt.state failed`, next prompt pumps;
  - cancel after claim → `prompt-already-started`;
  - startup failure before claim → `prompt.requeued` at head, queue paused, text retained, a resumed dispatch re-emits `message.completed`;
  - failure after claim without ack → `handoff unknown`, no requeue;
  - interrupt during pending → requeue plus pause;
  - ack via generic output and via a driver signal, idempotent;
  - flush failure inside claim → no write.
- **Ledger replay:** a legacy ledger (no `gated`) replays identically; gated sequences round-trip through snapshot plus tail; requeue ordering and `position`.
- **Restart recovery:** dispatched without handoff → requeued (`daemon-restart`); `sending` → `unknown`; `delivered` → unchanged.
- **Adapters:**
  - Codex: claim precedes `turn/start`; refused claim → no `turn/start` frame; interrupt during `verifyRuntimeMcp` → no `turn/start` (regression for the lost-interrupt race); RPC error → `refused`; timeout → `unknown`.
  - Claude: claim precedes `writeStdin`; pre-spawn interrupt → no write; the echo or first assistant event acks.
  - OpenCode: claim precedes the POST; a user `message.updated` acks; `initialize` failure → no claim.
- **Web:** `chooseEscapeAction` priority (queued > active-pending > interrupt); `recallAndRestore` with active-pending; bubble states (pending/sending/delivered/unknown/hidden) in `state.ts`; `chat-history` retention under paging; extend `composer-keyboard-acceptance.ts` with a "recall during starting-runner" scenario.
- **Live canary:** reproduce a Codex MCP timeout (P-006). The message must end up back in the paused queue, not as a read bubble. Double-Esc during a slow Codex startup must restore the text and must not produce a Lead turn.

## 8. Recommended minimal safe first slice

1. **Host claim gate:** `DriverHostIo.claimInput()` with the durable `prompt.handoff sending` and `prompt.dispatched handoff:"gated"`, wired into the three drivers immediately before the native write. This also fixes the Codex lost-interrupt and Claude pre-spawn-write races.
2. **Requeue undelivered prompts** at failure, interrupt or restart (`prompt.requeued`, head, paused, text retained), plus `cancelPrompt` accepting `dispatched/pending`.
3. **Generic output ack** (`prompt.handoff delivered`) plus the Codex `turn/start` receipt; `unknown` on post-claim failure.
4. **Web:** `chooseEscapeAction` on active-pending; hide requeued or recalled bubbles; "Sending…" until delivered; "Delivery unconfirmed" marker (Send again may follow).
5. **Make the decision-reply / notice-delivery / `continuityBlock` binding decision explicitly** (minimum: compensate on requeue).

Deferred: precise Claude echo and OpenCode user-`message.updated` acknowledgements, the Codex refused-vs-timeout split, and the OpenCode `turn.started` relabel. The approved first slice includes the **Send again** action; it copies text and images into the draft and never resends automatically.

**Direct-route note:** slice items 1-2 are backend-contract changes touching protected session state (ledger, recovery, driver contract). They warrant a short proposal and acceptance criteria before Apply, but not a multi-vertical Full SDD.


## 9. Approved implementation decisions and image ownership

- **Race boundary:** claim is synchronous and flushed before Claude stdin, Codex `turn/start`, or OpenCode POST. Cancellation and claim cannot both win. Driver startup interruption cannot write a later prompt. Unsupported/legacy drivers retain their prior conservative semantics.
- **Acknowledgement:** the first current-attempt model output (including tool start or usage) or Codex `turn/start` reply commits delivery once. Decision replies, delegated outcome accounting, the continuity marker and bounded recovery conversation are deferred until that acknowledgement. Decision question freshness is checked again when the receipt commits.
- **Before claim:** failure, interrupt or daemon restart returns input to the paused queue head with exact text and managed image references. Explicit Resume is required; a fresh dispatch creates a fresh user bubble. Newly queued gated input also retains attachments through forced shutdown/preflight recovery. Existing legacy records never gain a fabricated safe-delivery boundary.
- **After claim:** a failure without receipt becomes unknown; no recall or automatic retry is allowed. Send again explicitly copies the text and managed images into the composer. A successful native response is delivery evidence, not proof of a human-like reading process.
- **Recall with images:** queued and active pending prompts expose public managed attachment metadata. After the server persists the matching cancellation receipt, full recalled text precedes the current draft with a blank line; recalled attachments precede existing image drafts, deduplicated by attachment ID. Existing images and text remain intact. Managed image URLs and IDs are reused without reuploading or reading local user paths. No server-side queued-image loss was found: existing queue storage already retained them; the missing part was composer restoration.
- **History:** delivery, cancellation and requeue evidence survives the current-events projection independently of conversation paging. Recalled/requeued bubbles are hidden; older bubbles remain hidden after redispatch of the same prompt. Legacy bubbles keep their existing appearance.

### Observed lost-message incident

The session `20261023T162741-02bee6` ledger records genuine web prompt `2c06c080-93a7-4b7b-9119-25ce3278c02e`, text `Si, apruebo lo que recomiendas`, queued at seq **15202**, dispatched to Claude Lead attempt **22** at **15217**, and shown as a user bubble at **15218**. The user interrupt paused the queue at **15221**; the attempt ended interrupted at **15223–15224**, and `prompt.state interrupted` at **15225** discarded the prompt's queue text. No `turn.started` or model output was recorded for that attempt. Resume at **15239** had no pending text to retry. The later `.` was a distinct prompt (`175ef193-ae38-48a2-b6d5-e595cd889cdc`, seq **15246**) and ran in attempt **23**.

This was the admission-before-receipt interruption path, not steering, recall, or a queue cancellation on daemon restart. The historical ledger cannot prove whether stdin bytes were written before interruption; it provides no delivery receipt. Under the new contract, an interruption before claim requeues this input; an interruption after claim without output leaves a visible unconfirmed bubble with explicit Send again. Neither path silently discards it or represents confirmed delivery.

### Baseline attribution before session-host edits

The default pre-edit suite produced **887 passed, 10 failed, no runner error** (897 tests), rather than the historical 885/11/+1 report. The two native-continuation assertions in `cross-runner.e2e.test.ts` reproduce in a temporary source copy with only the Resume-queue fix removed; they concern the independently settled fresh-context policy. Seven other failures are 5-second timeouts in the trust/push persistence stores, which do not import the changed queue lifecycle. The image aggregate-boundary timeout passed in the copy without the Resume fix (3.8 seconds). The trust test and three push-store tests also passed with extended timeouts (10.8–23.9 seconds). No failure caused by that fix was found. The historical extra failure/error did not reproduce in this baseline; it is not claimed fixed.

Verification uses fake effects and an isolated browser server. No live daemon restart, historical prompt replay, commit, or discard operation is part of this change.


### Candidate verification

- Host/ledger/recovery focused baseline: **349 passed**. Additional gate/image/fsync tests: **7 passed**; deferred decision/notice/continuity scenario: **1 passed**. Later shutdown FIFO: **1 passed**, snapshot-tail/web projection delta: **83 passed**, and full history tests: **10 passed**.
- All three driver suites: **300 passed** with a 20-second per-test allowance. One OpenCode delayed-question test timed out in an earlier default run and passed immediately in isolation and in this complete rerun.
- Full session-host package with `--timeout 120000`: **908 passed, 2 failed**, 910 tests. Both failures are the pre-existing native-continuation assertions reproduced without the Resume-queue fix. All baseline persistence timeouts pass with the larger allowance. The later FIFO/snapshot/history additions were checked separately after this suite began.
- Root `bunx tsc --noEmit -p .`: passed, including the final production-code delta. Generated session schema and core event checks: **23 passed**.
- Final full web suite: **272 passed, 13 known failures** in `session-codebase-availability.test.tsx` (285 tests). No additional failing web case was introduced.
- Chromium synthetic-server acceptance passes desktop interrupt, queue recall, server refusal/uncertainty, dismissal/IME, touch newlines, and active pending recall with managed images, merged draft, focus/caret and no reupload. The unconfirmed **Send again** action also copies text/images without sending or recalling automatically. The daemon is never contacted by this fixture.

Remaining limits: live Codex MCP-timeout/canary activation and real Safari/Android checks are not performed. Exact Claude echo/OpenCode user-message acknowledgements and native refusal classification remain deferred; current delivery uses attempt-scoped model output plus Codex's explicit start receipt. A crash after claim and before write intentionally remains unconfirmed, and requires explicit user action to resend.

## Approved follow-up (2026-10-23, user: "Si")

- Stop/Interrupt button: keeps interrupting the Lead; when the active prompt was not yet claimed (requeued as undelivered), restore its text and images to the composer (preserving draft, same merge rule as recall) instead of leaving it at the paused queue head.
- Queued prompts get an "Edit" action (desktop and mobile) that cancels the queued prompt via the authoritative path and restores text and images to the composer only after server confirmation.
- Stop is intentionally NOT the full double-Escape: it never recalls a queued prompt while leaving the Lead running.
- Status: implemented in the web candidate. Stop sends the existing Lead interrupt command first, then polls the authoritative inbox for at most five seconds for that same active pending prompt to reappear as undelivered in the paused queue. Only a subsequent matching `prompt.cancel` receipt restores the server's full text and managed images. Claimed/consumed prompts, unrelated queued input, failed interruption and uncertain cancellation never restore text. If settlement is still unconfirmed, the paused queue remains available for explicit Edit.
- Edit uses the same confirmed cancellation and restoration helper as double Escape. Text is prepended before the latest draft with a blank line; image references precede and deduplicate against current images. Session/navigation fencing preserves drafts without stealing focus from another session. A confirmed ID cannot be restored twice from a stale queue view.
- Verification: focused unit tests cover interrupt-before-recall ordering, delayed server requeue, pending versus claimed input, interruption failure and exact cancellation receipts. Chromium fixtures at 390/320/1440 verify Stop with a later queued message, text/image restoration without reupload or automatic send, Edit during concurrent draft entry, focus, touch targets and duplicate-click protection. No server behavior changed; existing host claim/cancellation guarantees are reused. Live runner and real iOS/Android verification remain open.
