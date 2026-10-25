# Pending issues

Track observed problems and community reports here before implementation is scheduled. This register records evidence and proposed outcomes; it does not replace approved OpenSpec requirements. Link an implementation change when work starts, and retain resolved entries with verification evidence.

Statuses: **Reported**, **Investigated**, **In progress**, **Resolved**.

## Index

| ID | Issue | Status | Source |
| --- | --- | --- | --- |
| P-001 | Lead appears idle during Codex context compaction | Implemented, reviewed, and active in canary fc3ea86 | Local session report, 2026-10-21 |
| P-002 | Double Escape cancels Lead execution and recalls unread messages | Implemented; live verification pending | Community feedback relayed by the user |
| P-003 | Stop an individual subagent from the subagent list | Reported | User request |
| P-004 | Lead delegation should not require permission prompts | Reported | User request |
| P-005 | Preserve session permission grants across daemon restarts and session reopening | Reported | User request |
| P-006 | Recurring turn failures with `codex-startup-failed` | Reported | User reports frequent occurrences |
| P-007 | Mobile Enter inserts a newline instead of sending the message | Implemented; real-device verification pending | User request |
| P-008 | Slow sessions with accumulated context, repeated verification, and oversized RPC responses | Investigated; community correlation pending | Community analysis supplied as a screenshot |
| P-009 | First mobile image attachment attempt fails without delivering an image | Reported | User report in this conversation |
| P-010 | Review session modifications in a Git diff tab in the web UI | Reported | User request |
| P-011 | Evaluate context-window visibility for the Lead and each subagent | Reported | User request |
| P-012 | Explain provider/runner failures and offer appropriate recovery | Implemented, reviewed, and active in canary fc3ea86 | Live user report and explicit resilience request, 2026-10-22 |
| P-013 | Separate logical task ownership from native context reuse | Fresh-all delivery reviewed and active in canary c1e88ea; live cost measurement pending | Explicit user policy decision, 2026-10-22 |
| P-014 | Deliver corrections to active delegated members | Registered separately; deferred | Explicit user request, 2026-10-22 |
| P-015 | Verified Codex native continuation | Deferred; outside the first continuity delivery | Accepted measurement limitation, 2026-10-22 |
| P-016 | Answer approval requests from push notifications | Implemented; opt-in, normal risk, once-only responses | User request, 2026-10-23 |
| P-017 | Revoked session grant still applies within the running Lead turn | Reported; not investigated | Live observation, 2026-10-23 |
| P-018 | Quota usage dialog for Claude and Codex | Approved; queued after floating composer | User request, 2026-10-24 |

## P-015 — Verified Codex native continuation

The user explicitly accepts fresh Codex continuations for the first delivery and excludes internal Codex database/history parsing from this change. Codex's next-resume counted context includes output, subsequent items and native reasoning accounting absent from Deck's reliable last-request INPUT evidence; observing the compaction trigger alone does not establish a safe input-equivalent cap. See [native-bound evidence](changes/delegated-task-continuity-policy/compaction-bounds.md). Future support requires a reliable measured contract and a separate scope decision, not guessed margins or internal-history coupling added here.

OpenCode remains fresh, and Claude remains fresh because its effective compaction/accounting evidence is also unverified. If interrupted fresh continuations have high measured first-edit acquisition cost, prioritize P-014 member steering rather than native Codex resume. No native parser implementation is authorized by this backlog entry.

## P-013 — Separate logical task ownership from native context reuse

Preserve task identity and ledger accounting while defaulting continuations to bounded reseeded native sessions. Evaluate at launch against prior attempt end and reliable last-request input including cache. Recent small unintegrated completed/operator-interrupted attempts can resume; failures remain fresh. Overrides cannot bypass effective native compaction caps; assigned review roles always fresh. Lead explicitly closes findings; handoff includes open findings only. Add structured inputs, task-attributed edits and mixed-diff disclosure. Compare compaction, steps, tokens, duration, rework, override rates, first-edit cost and review-completion cost without a new reviewer tool.

Official proposal: [Continuity policy](changes/delegated-task-continuity-policy/proposal.md). [Acceptance criteria](changes/delegated-task-continuity-policy/acceptance.md) and [design](changes/delegated-task-continuity-policy/design.md) include the approved final amendments. [Implementation](changes/delegated-task-continuity-policy/apply-progress.md) and independent review are complete for the accepted fresh-all first delivery; [delivery](changes/delegated-task-continuity-policy/delivery.md) is in progress. Native Codex support is deferred as P-015; no internal native-history parser is included. [Baseline evidence](changes/delegated-task-continuity-policy/evidence.md) includes tool counts. Related to P-008; this does not declare the overall latency issue resolved.

## P-014 — Deliver corrections to active delegated members

Track pending, delivered and incorporated feedback to a running member without treating delivery as proof of incorporation. Register and investigate independently of native-session continuity.

Official deferred proposal: [Member steering](changes/delegated-member-steering/proposal.md). No implementation or design is included in P-013.

Priority signal: the first continuity delivery separately measures operator-interrupted continuation frequency and first-edit steps/tokens. High observed cost should advance this steering work; it must not be used to justify native Codex resume or introduce steering incidentally into P-013.

## P-001 — Lead appears idle during Codex context compaction

- **Status:** Implemented and independently reviewed in `484fd39`; active in canary `fc3ea86` (daemon digest verified).
- **Environment:** Deck 0.13.0, Codex 0.162.1, web session UI.
- **Reported behavior:** The UI stayed on `Waiting for Lead…`. A response appeared shortly after the user enabled YOLO, suggesting an approval blockage.
- **Impact:** Users cannot distinguish context maintenance from a stalled runner and may change permission settings unnecessarily.
- **Finding:** Codex spent approximately 123 seconds compacting context. Compaction finished before YOLO was enabled. No approval request was recorded during that interval; the timing does not support YOLO as the cause of recovery.

### Evidence

Session `20261021T141551-27e992`, Lead task `lead-g1`, attempt 18. Times below are on **2026-10-21, America/Bogota (UTC−05:00)**.

| Time | Event sequence | Observation |
| --- | --- | --- |
| 19:29:06.221 | 87517 | Native `item/started`, item type `contextCompaction` |
| 19:31:09.166 | 87519 | Native `item/completed`, same compaction item |
| 19:31:14.148 | 87537 | Session approval mode changed to `yolo` |
| 19:31:15.861 | 87539 | First assistant message delta |
| 19:31:23.349 | 87607 | Later MCP approval request, after the response had started |
| 19:31:23.350 | 87608 | That approval resolved automatically through an existing session grant |

Both compaction events were stored as `runner.unmapped`. The inspected [Lead progress projection](../apps/web/src/lead-progress.tsx) does not handle them, leaving the generic waiting label visible.

Local evidence: `~/.local/state/deck/sessions/20261021T141551-27e992/events/000008.jsonl`, lines 12900 and 12902 for compaction; 12920 and 12922 for YOLO and first response. These logs are machine-local, not repository fixtures. The diagnosis is based on this observed session and source inspection, not a controlled reproduction.

### Proposed outcome and verification

- [ ] Surface context compaction as an explicit progress state, such as `Compacting context…`.
- [ ] Clear that state when compaction ends and preserve subsequent response/tool progress.
- [ ] Keep approval waits distinguishable from compaction.
- [ ] Cover the observed event sequence and session/turn boundaries with focused regression tests.
- [ ] Verify visibility in both desktop and mobile progress indicators.

**Implementation change:** [Compaction progress slice](changes/session-context-latency-investigation/compaction-progress-brief.md), commit `484fd39`. Confirmed Codex compaction reaches bounded snapshot/live progress with identity and turn fencing. Independent review approved. Shared accessible desktop/mobile markup is tested; no live-browser or Claude compaction claim. Not yet active in the daemon.

## P-002 — Double Escape cancels Lead execution and recalls unread messages

- **Status:** Implemented; focused helpers, browser fixture, and backend delivery-race checks verified. Live runner/device verification remains open.
- **Source:** Community feedback relayed by the user in this conversation.
- **Requested behavior:** Pressing Escape twice cancels the Lead's current execution. A sent message that the Lead has not yet read can be cancelled and its text and image attachments returned to the input for editing or resubmission.
- **Impact:** Users can stop unwanted execution and recover premature or mistaken submissions without retyping them.
- **Evidence:** The [delivery-boundary design and verification](changes/lead-prompt-delivery-boundary/design.md#candidate-verification) records host race/restart/snapshot tests, per-driver claims, image recall, Chromium composition, full package results and pre-existing failure attribution. Root TypeScript passes. Live runner/device verification remains open.

### Outcome and verification

- [x] Double Escape cancels the Lead's active execution and visibly confirms cancellation through the existing Interrupt command path (browser fixture).
- [x] Cancelling an unread sent message removes it from pending delivery and restores its full text to the input.
- [x] A successfully recalled message is not subsequently delivered to the Lead (backend preflight/FIFO tests).
- [x] If the Lead has already consumed the message, the UI does not claim that recall succeeded.
- [x] Recalling queued or active-pending input restores its image attachments after server confirmation.
- [x] Restoring a message preserves any draft already in the input, including edits during the request.
- [x] Verify cancellation and recall when message delivery races with the user's action (backend tests plus stale/consumed/unconfirmed browser responses).

**Settled behavior:** Two distinct Escape presses within 1,000 ms act from the composer or visible chat surface. Recall takes priority over interruption and selects the newest item in the selected session's authoritative prompt inbox queue, then an active dispatched prompt whose handoff is pending; local sending indicators and consumed history are excluded. The first press shows an overlay hint without changing layout. Handled Escape, open dismissal layers/dialogs/menus, IME composition, and key repeat cannot complete the pair. An idle session does nothing. Interruption targets only the Lead through the existing button path and never restores its consumed prompt; no subagent cancellation is added.

**Stop/Edit follow-up:** Stop always interrupts the Lead first and never selects a later queued message. If its active pending prompt is confirmed requeued undelivered, a matching cancellation receipt restores its text/images; unresolved settlement leaves the paused queue available for Edit. Every queued item has a 44px mobile Edit action using the same confirmation and merge rules. Confirmed IDs are protected against duplicate restoration from stale queue views. See the [approved follow-up implementation](changes/lead-prompt-delivery-boundary/design.md#approved-follow-up-2026-10-23-user-si).

**Recall authority and draft merge:** The server confirms `prompt.cancel` with a matching `{promptId, state: "cancelled"}` receipt after persisting cancellation. The synchronous native-input claim (or a steering fence) makes the prompt ineligible for cancellation; `prompt-already-started` reports delivery already started, which is a conservative boundary rather than proof of human-like reading. The UI restores only on the matching cancellation receipt; refusal or uncertainty leaves the draft untouched and shows a notice. Recalled full text is prepended to the latest draft with one blank line between them. The draft store is updated after acknowledgement; focus and caret move to the end only if the same session/navigation and text are still current. Confirmed prompt IDs are excluded from subsequent recall even if the inbox projection lags. Managed image attachments are restored after the same cancellation receipt, before existing image drafts and deduplicated by attachment ID; existing drafts are preserved. No reupload is needed.

**Implementation change:** `apps/web/src/composer-keyboard.ts`, `apps/web/src/composer-keyboard.test.ts`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, and `apps/web/composer-keyboard-acceptance.ts`. Reuses existing `prompt-queue.tsx`, `dismiss-layer.ts`, draft store, and backend cancellation with the approved [Lead prompt delivery boundary](changes/lead-prompt-delivery-boundary/design.md): synchronous per-driver claims, pending recall, paused undelivered requeue with images, and explicit unconfirmed delivery recovery. Not activated by restarting the daemon; live runner verification remains open.

## P-003 — Stop an individual subagent from the subagent list

- **Status:** Reported; implementation pending.
- **Source:** User request in this conversation.
- **Requested behavior:** Add a button to each subagent entry that lets the user stop that subagent's process or execution directly from the list.
- **Impact:** Users can stop unwanted or stalled subagent work without asking the Lead to cancel it.
- **Evidence:** User request only; existing cancellation controls and runner behavior have not been investigated.

### Proposed outcome and verification

- [ ] Each active subagent has an identifiable, keyboard-accessible Stop button in the list.
- [ ] The button cancels the selected subagent's execution without stopping unrelated subagents or the Lead.
- [ ] Show cancellation in progress, then the confirmed terminal state; report failures without falsely showing the execution as stopped.
- [ ] Prevent duplicate cancellation requests while one is pending and disable or hide Stop for finished executions.
- [ ] Preserve the subagent's history and any work already produced.
- [ ] Verify behavior when the subagent finishes concurrently with a cancellation request.

**Details to settle during implementation:** Supported UI surfaces, behavior for queued tasks, and cancellation scope for any child processes or nested delegated work.

**Implementation change:** Not assigned. This entry records the requested behavior; no runtime changes have been made.

## P-004 — Lead delegation should not require permission prompts

- **Status:** Reported; implementation pending.
- **Source:** User request in this conversation.
- **Requested behavior:** The Lead can delegate work to a configured subagent without asking the user to approve the delegation tool call, including in Ask first mode.
- **Impact:** Routine task coordination proceeds without an extra permission prompt or requiring YOLO mode.
- **Evidence:** User request only; the specific delegation approval path has not been investigated. The earlier incident in P-001 establishes context compaction as the cause of that wait, not a delegation permission blockage.

### Proposed outcome and verification

- [ ] Creating or continuing a delegated task does not prompt for permission merely to invoke delegation.
- [ ] This behavior works in Ask first mode without requiring a prior session grant or enabling YOLO.
- [ ] Actions performed by the subagent retain the applicable permission policy; delegation does not grant blanket approval for its tools or operations.
- [ ] Existing task ownership, scope, and explicit decision dependencies remain enforced.
- [ ] Verify supported runners with both a fresh delegation and a continuation.

**Details to settle during implementation:** Identify the approval layer responsible for the prompt and the smallest delegation-specific policy change; verify that runner-native and Deck approval handling agree.

**Implementation change:** Not assigned. This entry records the requested behavior; no runtime changes have been made.

## P-005 — Preserve session permission grants across daemon restarts and session reopening

- **Status:** Reported; implementation pending.
- **Source:** User request in this conversation; interpreted as permission persistence per session.
- **Requested behavior:** Permissions granted for a session remain effective when the daemon restarts or the user closes and later resumes that same session.
- **Impact:** Users do not have to repeatedly approve operations already authorized for the session.
- **Evidence:** User request only; current persistence and recovery behavior have not been investigated.

### Proposed outcome and verification

- [ ] Persist session-scoped grants and restore them when the same session resumes after a daemon restart.
- [ ] Closing and reopening the session UI preserves those grants.
- [ ] An operation matching a restored grant proceeds without a redundant permission prompt in Ask first mode.
- [ ] Preserve each grant's original scope; one-time approvals do not become reusable session grants, and grants do not transfer to other sessions.
- [ ] Revoked grants remain revoked after restart or reopening.
- [ ] Verify persistence through daemon recovery and session close/resume flows for supported runners.

**Details to settle during implementation:** Distinguish closing a client or releasing a resumable session from permanently ending or deleting it; check how runner-native permission identities map to persisted grants after a runner restarts.

**Implementation change:** Not assigned. This entry records the requested behavior; no runtime changes have been made.

## P-006 — Recurring turn failures with `codex-startup-failed`

- **Status:** Reported; investigation pending.
- **Source:** User report in this conversation.
- **Observed behavior:** Turns frequently fail with the displayed error below. Exact frequency and affected session/attempt IDs have not yet been collected.
- **Impact:** Repeated failures interrupt work and make session continuation unreliable.
- **User hypothesis:** The failure may be related to conversation context. This has not been verified.
- **Evidence:** The reported error text only; no failing attempt has yet been traced for this entry.

```text
Turn failed
codex-startup-failed
```

### Investigation and verification

- [ ] Identify affected session and attempt IDs, timestamps, and Deck/Codex versions from retained logs.
- [ ] Trace the underlying error behind `codex-startup-failed`, including runner startup/resume, exit status, stderr, and any timeout or initialization failure.
- [ ] Compare failing and successful attempts, including new versus resumed sessions and any context compaction events or context-size evidence.
- [ ] Confirm or rule out the context hypothesis for the observed failures; distinguish separate causes if the same error label covers multiple failures.
- [ ] Reproduce the confirmed failure where possible and add a focused regression test with the correction.
- [ ] Verify that the UI exposes an actionable cause and that recovery preserves session history without duplicating execution.

**Related issue:** P-001 concerns a successful context compaction with misleading progress text. It is not evidence that context compaction causes this startup failure.

**Implementation change:** Not assigned. This entry records the recurring error and investigation scope; no diagnosis or runtime fix has been made.

## P-007 — Mobile Enter inserts a newline instead of sending the message

- **Status:** Implemented; automated keyboard/browser checks pass. Real iOS and Android virtual-keyboard verification remains open.
- **Source:** User request in this conversation.
- **Requested behavior:** In the mobile message composer, pressing Enter inserts a newline instead of submitting the message. Sending remains an explicit action through the Send button.
- **Impact:** Users can compose multiline messages on mobile without accidentally sending unfinished text.
- **Evidence:** Enter-policy helper tests and the composed Chromium fixture pass, including coarse-pointer input at desktop width, keyboard input at narrow width, cursor editing, repeated newlines, composition guards, and the four-line auto-grow cap. Root TypeScript checking passes. The web suite reports 263 pass and the 13 known failures in `session-codebase-availability.test.tsx`.

### Outcome and verification

- [x] Enter inserts a newline at the cursor in the mobile composer without submitting or queuing a message (emulated coarse-pointer browser input).
- [x] The Send button submits the complete message with its line breaks preserved.
- [x] Verify repeated newlines and editing within existing multiline text.
- [ ] Verify behavior with iOS and Android virtual keyboards, including composition input.
- [x] Confirm existing desktop keyboard behavior remains intact.

**Settled behavior:** The live media query `(pointer: coarse), (hover: none)` selects newline behavior independently of viewport width. Tablets and attached physical keyboards follow the device's reported primary pointer/hover capabilities; attaching a keyboard alone does not force Enter-to-send on a touch device. The query updates when those capabilities change. `enterKeyHint` is `enter` for touch input and `send` otherwise. Desktop keeps Enter-to-send and Shift+Enter-to-newline; IME composition does not submit. Existing auto-grow remains capped at four lines with internal scrolling. Real virtual-keyboard behavior is not established by desktop emulation.

**Implementation change:** `apps/web/src/composer-keyboard.ts`, `apps/web/src/composer-keyboard.test.ts`, `apps/web/src/main.tsx`, and `apps/web/composer-keyboard-acceptance.ts`; reuses the existing message-input auto-grow implementation. No daemon restart or production activation was performed.

## P-008 — Slow sessions with accumulated context, repeated verification, and oversized RPC responses

- **Status:** Initial source investigation completed; community incident correlation and implementation pending. Highest-priority investigation per user direction on 2026-10-22.
- **Source:** Screenshot of Deck's analysis on a community user's machine, supplied by the user in this conversation.
- **Scope clarification:** The user reports latency across runners, including Claude. The Codex error in the screenshot is one specific failure, not the explanation for general slowness. Prioritize shared orchestration/preparation costs and comparable per-runner measurements; see [cross-runner analysis](changes/session-context-latency-investigation/cross-runner-analysis.md).
- **Observed behavior:** The community user experienced a slow session. The supplied analysis attributes delays to the five factors below.
- **Evidence boundary:** These are claims from the supplied analysis, not independently verified runtime findings. Versions, attempt IDs, timings, and original logs from that machine are not yet available.

### Findings reported in the screenshot

1. **Accumulated context:** The same subagent chained nine attempts from W7 to W7.2. The analysis reports 245–271 thousand context tokens against a 258-thousand-token window and repeated reading of that context on each attempt.
2. **Maximum reasoning for mechanical work:** File-fingerprint comparisons and repeated browser checks used the highest reasoning level, which the analysis considers excessive for those tasks.
3. **Repeated test creation:** Subagents regenerated Playwright scripts manually on each attempt instead of reusing a saved script.
4. **Oversized responses:** Two attempts failed with `codex-rpc-frame-too-large`; the analysis attributes this to a response exceeding Codex's accepted size and estimates approximately 19 minutes lost.
5. **Duplicate verification:** Both the Lead and subagent checked the same fingerprints across eight code files, 33 merchant-data files, and 57 evidence files.

Screenshot reference: local session `20261022T003008-6f199c`, attachment `714c6cd6-e434-447a-8647-f4093958d816.image`. The attachment is machine-local; the relevant contents are preserved above.

### Investigation and verification

- [ ] Obtain a bounded timeline of affected attempts, context/token usage, compaction, reasoning settings, tool durations, and failure events.
- [ ] Establish what the reported token counts measure, including why the reported upper bound exceeds the stated context window; distinguish cumulative usage, actual context, and cached input.
- [ ] Identify the failing RPC frame's producer, direction, payload size, and enforced limit before choosing a fix for `codex-rpc-frame-too-large`.
- [ ] Assess reasoning levels against task complexity and measure their effect on elapsed time.
- [ ] Identify reusable Playwright scripts and redundant checks; retain independent verification where it covers a distinct risk.
- [ ] Audit unnecessary Deck orchestration input and repeated reads while preserving runner-owned native context, task ownership and delivery evidence; do not introduce Deck transcript replay or custom compaction.
- [ ] Reproduce confirmed failure paths, add focused regression coverage, and compare time, retries, and token usage before and after any correction.

**Related issues:** P-001 covers compaction visibility; P-006 covers `codex-startup-failed`. No shared root cause with either issue has been established.

**Investigation:** [Session latency and context investigation](changes/session-context-latency-investigation/working-brief.md), with a runnable synthetic reproduction and results. Main already excludes history on resume; full-history steering reconciliation and oversized tool output still reproduce fatal framing failures. Native task continuation retains context and thinking level. A startup timeout also reproduces P-006's generic error. Local compaction measurements are independent supporting evidence, not proof of the community incident's cause.

**Implementation change:** [Preparation measurement candidate](changes/session-context-latency-investigation/preparation-progress.md) adds bounded per-stage diagnostics and compares isolated fresh/warm preparation for Claude and Codex. Tests pass; [canary activation](changes/session-context-latency-investigation/canary-activation.md) is verified with the candidate executable digest. The current session is the user-selected live test. Root-cause correlation and runtime performance fixes remain pending.

## P-009 — First mobile image attachment attempt fails without delivering an image

- **Status:** Reported; investigation pending.
- **Source:** User report while supplying the screenshot for P-008.
- **Observed behavior:** The first mobile attachment attempt appeared to start but did not load an image. The assistant did not receive an image in the earlier messages; the later retry delivered the screenshot successfully.
- **Expected behavior:** A selected image uploads and reaches the conversation reliably, with a visible failure and retry path if upload or delivery fails.
- **Evidence boundary:** The user reported the failed attempt, and the later attachment is available in this conversation. The failure stage, device/browser, file properties, and network response have not been established; absence from the assistant's input alone does not localize the fault.

### Investigation and verification

- [ ] Trace file selection, upload, attachment persistence, message association, and delivery to the runner for the failed attempt and successful retry.
- [ ] Check mobile browser behavior and file size/type, along with interrupted requests, connectivity, and session state, without assuming a cause.
- [ ] Show attachment progress, successful attachment, or an actionable error; prevent silent loss during message submission.
- [ ] Preserve the draft on failure and allow retry without duplicate messages or attachments.
- [ ] Verify first-attempt uploads and failure/retry flows on iOS and Android, confirming that the runner receives the image.

**Implementation change:** Not assigned. This entry records the incident and investigation scope; no runtime changes have been made.

## P-010 — Review session modifications in a Git diff tab in the web UI

- **Status:** Reported; implementation pending.
- **Source:** User request in this conversation.
- **Requested behavior:** Add a **Git diff** tab to the web session UI, positioned between **OpenSpec** and **Subagents**.
- **User goal:** Let people inspect and validate the modifications made during a session directly in the web UI.
- **Evidence:** Product request only; existing diff capabilities and session change tracking have not been investigated.

### Proposed outcome and verification

- [ ] Display the tabs in the requested order: OpenSpec, Git diff, Subagents.
- [ ] List changed files and let users inspect added and removed lines with enough surrounding context to review the changes.
- [ ] Make the comparison baseline and scope explicit so users understand which modifications they are reviewing.
- [ ] Account for pre-existing work and concurrent sessions in the same repository; do not label all working-tree changes as changes made by the current session without evidence.
- [ ] Include newly created, modified, deleted, and renamed files, with clear handling for binary or unavailable diffs.
- [ ] Allow users to obtain an updated view as session work progresses and show loading, empty, and error states clearly.
- [ ] Keep review usable on desktop and mobile, including large diffs.
- [ ] Verify that viewing diffs leaves repository files, the index, and history unchanged.

**Details to settle during implementation:** How to establish and persist the session comparison baseline; treatment of staged, unstaged, untracked, and committed changes; refresh behavior and large-diff limits. Change attribution must be supported by evidence rather than inferred from the session's project directory.

**Implementation change:** Not assigned. This entry records the requested behavior; no runtime changes have been made.

## P-011 — Evaluate context-window visibility for the Lead and each subagent

- **Status:** Compact percentage/used/max and stable overlays independently approved; combined canary activation pending. Earlier counter-only build 13ef94f is active.
- **Source:** User request following the P-008 investigation.
- **Requested behavior:** Determine whether the UI can display the context window and its usage separately for the Lead and every subagent.
- **Impact:** Users can understand context pressure and interpret slowdowns or compaction without relying on a generic waiting indicator.
- **Existing evidence:** The P-008 investigation found native Codex usage counters and a reported context-window limit. It also identified differences between cumulative usage, last-request counters, and post-compaction events. Runner-native estimate formulas and per-response fields were subsequently verified; documented missing-data and compaction freshness limits remain.

### Feasibility and acceptance checks

- [x] Identify the available context limit, current-usage measurement, units, and update semantics for each supported runner/model.
- [x] Separate actual context occupancy from cumulative tokens, output tokens, and cached-input counters; do not present total session usage as window occupancy.
- [x] Evaluate displaying used tokens, capacity, and percentage for the Lead and each subagent when compatible, reliable measurements are available.
- [x] Explicitly distinguish measured, estimated, stale, and unavailable values; missing data must not appear as zero usage.
- [x] Attribute values to the correct session, task, native thread, and attempt; prevent stale values from a previous model or context from appearing current.
- [x] Verify updates across compaction, continuation, model changes, completion, and reconnection.
- [x] Evaluate accessible desktop and mobile placement alongside Lead status and subagent entries.

**Related investigation:** [Session latency and context investigation](changes/session-context-latency-investigation/working-brief.md), especially the usage-counter limitations in finding 6. P-001 covers compaction progress itself.

**Implementation change:** [Context visibility brief](changes/session-context-latency-investigation/context-window-brief.md). Approved combined candidate shows native context estimates with used/max/percentage, truthful partial-data fallbacks, and nonshifting shared MCP/context overlays. Historical aggregate values never gain percentages. Hydrated mobile/desktop and lifecycle regressions passed; combined canary activation pending.

## P-012 — Generic turn failure hides native model-capacity error

- **Observed:** The user saw `Turn failed` followed by `The runner could not complete this turn. Try again.` in this session.
- **Confirmed cause of this turn failure:** Codex returned `codexErrorInfo: serverOverloaded` with `Selected model is at capacity. Please try a different model.` at `2026-10-22T13:46:21.195Z` (08:46:21 America/Bogota).
- **Evidence:** Session `20261022T003008-6f199c`, Lead, ledger sequence 18870 contains the native error and sequence 18871 contains the failed native turn with the same error. Host sequence 18876 contains only `turn.completed {status: failed}`. The web renderer in `apps/web/src/main.tsx` uses the reported generic fallback when `event.data.error` is absent. Source literal and bounded ledger fields were inspected directly; graph coverage is stale/untracked.
- **Boundary:** This identifies service capacity as the reported failure reason, not context exhaustion or the readiness-cache fix. It does not prove a reason for other failures such as P-006.
- **Desired correction:** Preserve a sanitized actionable native failure category/message through the adapter, host terminal result and web history. Avoid exposing raw payloads or credentials; preserve safe fallback for unknown errors. Verify model overload, missing error, and unrelated error types, and keep retry/model-change guidance explicit without automatic model changes or duplicate execution.
- **Scope update:** The user explicitly requested preparedness for provider instability and clear attribution. See [provider failure brief](changes/session-context-latency-investigation/provider-failure-brief.md) for cross-runner classification, actionable recovery, redaction, persistence and safe-retry constraints.
- **Status:** Cross-runner failure reporting implemented and independently approved; active in canary `fc3ea86` (daemon digest verified). Fixed explanations preserve confirmed versus inferred/unknown attribution and manual recovery without automatic replay. See the provider failure brief for test evidence and limitations, including uncorrelated OpenCode session-only errors.

## P-016 — Answer approval requests from push notifications

- **Status:** Implemented (2026-10-23) with the approved conditions: supported Chromium browsers, explicit normal risk, Allow once + Deny, default-off opt-in, and server enforcement. Feasibility report: investigation task d477b118 (session 20261023T162741-02bee6).
- **Live verification (2026-10-24, canary, user device):** a high-risk Bash approval push arrived without action buttons (tap opens Deck), as designed; a normal-risk `Read` of a file outside the project root (`/etc/hostname`) produced an approval push that showed the Allow once / Deny buttons. Note: in-project Read/Glob/Grep are auto-allowed by Claude, so normal-risk approvals are rare in practice (risk classification: `packages/session-host/src/bridge-service.ts:113-116`).
- **Verdict:** Feasible as a Chromium-only enhancement (Chrome/Edge desktop, Chrome Android). Firefox, Safari macOS and iOS/iPadOS PWAs do not render notification action buttons; there a tap keeps opening the app.
- **Feasibility baseline (before implementation):** the worker could authenticate `POST /api/commands` with the existing HttpOnly SameSite=Strict device cookie; approval pushes lacked approval identity/tool/risk, and in-app high-risk allow-once responses remained valid. Late responses returned `already-resolved`/`unknown-approval`.
- **Recommended slice:** add redacted tool name, `approvalId` and risk (unknown→high) to approval pushes; offer "Allow once" + "Deny" only for normal risk when `Notification.maxActions >= 2`; never session/always grants; high risk opens the app; on any failure close-and-open-app with a short "Couldn't apply — open Deck" notification, no silent retries; opt-in setting.
- **Risks:** lock-screen exposure on Android unverified; long-lived device cookie means an unlocked stolen phone could approve normal-risk requests.
- **Implementation:** `push-attention.ts` reads metadata from the exact pending request event; both push paths use `approvalPushFields` to transmit only a bounded approval identifier, a redacted tool identifier (80 ASCII characters maximum; unsafe names become `Tool`), and normal/high risk. Summary, input, command and path fields are never copied into approval pushes. Missing risk now defaults to high in the broker and push metadata.
- **Server enforcement:** the core command contract validates optional `origin: 'notification'`; SessionManager forwards it to ApprovalBroker. The broker checks the authoritative pending request before resolving: only normal-risk `allow` with scope once (or omitted once default), or `deny`, with no grant fields. High/unknown risk returns `approval-notification-risk`; broader scopes/grants return `approval-notification-scope`. Rejections leave the request pending. Existing authenticated HTTP boundaries and first-response-wins behavior remain in force; normal `approval.resolved` events remove the web approval card.
- **Browser opt-in:** the Notifications dialog adds “Answer approvals from notifications”. Cache Storage holds one boolean in `deck-notification-preferences`, at `/__deck_notification_preferences__`, shared directly by the page and worker. It survives worker restarts, is scoped to this browser/origin, and contains no authenticated responses or credentials. Reads fail closed; failed writes restore the checkbox and report an error. The worker rechecks this value both before display and before executing an action, so disabling it revokes older displayed actions too.
- **Worker behavior:** only opt-in, normal-risk approvals with a valid identity and `Notification.maxActions >= 2` display “Allow <tool> once?” with Allow once/Deny. An action makes one same-origin, credentialed, redirect-rejecting `POST /api/commands`, marked with notification origin and once scope; network/HTTP/JSON/semantic failures (including stale approvals) produce “Couldn’t apply — open Deck” without retries. That fallback and ordinary body taps open/focus the session. Successful actions close only that approval's notices and recompute the badge; grouped replies and separate approval/decision tags remain intact.
- **Evidence:** 191 focused tests passed across command validation, broker, attention projection, push transport/daemon, manager approval/grant behavior and web approval/push/worker tests. Three existing storage-capacity stress tests exceeded Bun's default five-second timeout and passed individually with `--timeout 60000`. Root `bunx tsc --noEmit -p .` passed. Full web suite: 288 passed, the same 13 known `session-codebase-availability` failures. `apps/web/push-acceptance.ts` passed all 16 checks with real Chromium registration/notifications and authenticated worker HTTP resolution/card removal, opt-in persistence/storage rollback, grouped notifications/badges, and 320/390/1440 dialog checks. Provider delivery was simulated via CDP, OS badge effects were faked, and the action click was dispatched in the real worker. Some headless runs lost a displayed notification after `showNotification` resolved; a complete final run passed without weakening notification assertions.
- **Platform limits:** feature availability follows [Notification.maxActions](https://developer.mozilla.org/en-US/docs/Web/API/Notification/maxActions_static); browsers without two actions retain body-tap routing into Deck. Safari/Firefox action fallbacks and physical Android/iOS lock-screen behavior have not been exercised on devices. iOS/iPadOS push still requires a Home Screen app and notification permission ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)); badges remain optional and device-local. Live provider delivery is unverified. No running daemon restart or commit was performed.

## P-017 — Revoked session grant still applies within the running Lead turn

- **Status:** Reported; not investigated.
- **Observed (session 20261023T162741-02bee6, 2026-10-24 UTC):** the user revoked the Bash session grant (command accepted 00:31:33); the Lead turn that started at 00:31:47 ran `date` at ~00:31:52 with no `approval.requested` event. The next Lead turn's Bash call (00:32:40) correctly requested approval.
- **Hypothesis:** grants are snapshotted per turn (or the native runner keeps its own allowance) so revocation only takes effect on the next turn. Expected: revocation applies immediately to subsequent tool calls, including within a running turn.
- **Related:** P-016 live testing — high-risk Bash approval push arrived without action buttons as designed; normal-risk buttons could not be exercised live because no normal-risk tool currently requests approval.

## P-018 — Quota usage dialog for Claude and Codex

- **Status:** Implemented (2026-10-24), verified from current source; no daemon restart or commit. Feasibility: investigation task edccb3af (session 20261023T162741-02bee6).
- **Baseline at approval:** both runners already emit `rate-limit` events into the ledger; no web consumer exists. Codex (`account/rateLimits/updated`, mapper `packages/adapter-codex/src/session-driver/mapper.ts:54`) reports windows `{usedPercent 0-100, windowDurationMins, resetsAt epoch s}`, `planType`, credits; Codex also has a pull RPC `account/rateLimits/read` usable without a turn (unverified at approval; live result recorded below). Claude (`rate_limit_event`, mapper `packages/adapter-claude/src/session-driver/mapper.ts:131,295-305`) carries `unifiedWindows.five_hour` / `seven_day` `{utilization 0-1, resetsAt}` plus overage status, but the mapper then dropped `unifiedWindows` (raw kept in ledger). Claude has no pull path.
- **Approved design:** Deck menu item "Quota usage" opening a dialog; one block per runner (Claude, Codex) showing **5-hour** and **7-day** window bars (used %, reset time), plus plan (Codex), overage status (Claude) and "updated X ago". Map Codex windows by `windowDurationMins` (300 → 5h, 10080 → 7d); if a runner does not report a window, hide that bar (user decision 2026-10-24). Colors: **Codex blue, Claude red** (accessible on all themes). Codex "Refresh" button via the pull RPC from the daemon. Claude "Refresh" button (user request 2026-10-24): the daemon runs a one-shot, isolated Claude Code process (not a Deck session: temporary empty cwd, no tools, no MCP servers, no hooks/plugins/memory, Haiku model, minimal prompt, single turn, stream-json) solely to capture the `rate_limit_event`, then discards the output; user-initiated only (no automatic polling), with a short cooldown (e.g. 60 s) and a note that it consumes a tiny amount of Claude quota; if no event arrives, keep the previous snapshot and say so. Otherwise Claude shows the last known snapshot. Latest snapshot only (no history); do not show which session reported it. Seed snapshots at daemon start from the last ledger `rate-limit` events. Privacy: never expose credits balance, accountId or raw payloads to the web client. Parse defensively (version drift); API-key accounts show "no subscription quota data".
- **Coordination:** `packages/adapter-claude/src/session-driver/mapper.ts` has uncommitted edits from the concurrent session — edit surgically.

- **Implementation:** `packages/core/src/session/quota.ts` defines the browser-safe contract. The daemon owns `QuotaStore`, seeds the latest per-runner snapshot by streaming session event ledgers, observes live appends, and exposes authenticated `GET /api/quota` and same-origin `POST /api/quota/{claude|codex}/refresh`. All browser quota surfaces, including generic HTTP/WebSocket event replay, exclude native credits, account IDs and raw payloads. Cooldown and in-flight exclusion are enforced per runner across browser clients; failure/no-event keeps the previous snapshot with a clear message. Refresh work respects runner maintenance admission and daemon shutdown.
- **UI:** `apps/web/src/quota.tsx`, `install-deck.tsx`, `main.tsx` and `style.css` provide the desktop/menu and mobile/drawer dialog, shared dismissal, focus return, accessible percentage bars, local reset times, age, Codex plan and Claude overage status. Only reported windows appear. Red/blue tokens have separate light/dark values with at least 3:1 fill/track contrast in all 18 themes. No runner polling; the one-second UI timer updates age/cooldown text only.
- **Refresh implementation and live verification:** `packages/adapter-claude/src/quota.ts` runs one Haiku print turn in a disposable empty directory with safe mode, no tools/MCP/customizations/hooks/memory/session persistence, a minimal system prompt, one-turn/budget/time/output bounds, and stripped Deck/customization environment. The authorized single live call completed in about 3.9 seconds and emitted `rate_limit_event`; observed safe shape: `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization:number,resetsAt:epoch_seconds}` plus status/overage status. Valid quota events remain usable even if an exhausted turn exits with an error. `packages/adapter-codex/src/quota.ts` initializes a disposable local app-server and calls `account/rateLimits/read` without creating a thread/turn; the authorized live read completed in about 1.2 seconds and returned a recognized seven-day window and plan, with no reported 300-minute window, so its five-hour bar is hidden. Native balances/account identifiers/output were not included in browser data or evidence.
- **Verification:** 106 focused mapper/subprocess/store/daemon/HTTP tests passed; an additional historical-Claude snapshot test and expanded quota WebSocket privacy check passed. Focused web quota/menu tests: 8 passed. Full web suite: 291 passed, the same 13 known `session-codebase-availability.test.tsx` failures; concurrent turn-failure tests passed and those files were preserved. Root `bunx tsc --noEmit -p .` passed. Chromium acceptance at 390/1440 verified menu access, fit, targets, hidden bars, cooldown, no-event snapshot retention, no automatic refresh/retry, Escape/outside pointerdown, focus return and unchanged conversation geometry; all-theme progress contrast checked. Evidence screenshots: `/home/kevin15011/snap/chromium/common/deck-quota/{390,1440}.png`. Logs: `/tmp/deck-quota-focused-tests.log`, `/tmp/deck-quota-web-tests.log`.
- **Limitations:** Native runner installation/authentication is required on the daemon host. API-key/no-window accounts show “No subscription quota data”; native version drift may omit windows/reset times rather than invent data. Claude Refresh consumes a tiny amount of quota and can fail or emit no quota event; its last snapshot remains visible. Latest snapshots are held in memory and reseeded from ledgers on startup, without a new history store. Chromium desktop/mobile emulation verified; Safari/iOS/Firefox and physical devices were not exercised. The running daemon was not restarted; activation follows the next build/start.
