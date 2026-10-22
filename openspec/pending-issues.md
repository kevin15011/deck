# Pending issues

Track observed problems and community reports here before implementation is scheduled. This register records evidence and proposed outcomes; it does not replace approved OpenSpec requirements. Link an implementation change when work starts, and retain resolved entries with verification evidence.

Statuses: **Reported**, **Investigated**, **In progress**, **Resolved**.

## Index

| ID | Issue | Status | Source |
| --- | --- | --- | --- |
| P-001 | Lead appears idle during Codex context compaction | Implemented and reviewed; activation pending | Local session report, 2026-10-21 |
| P-002 | Double Escape cancels Lead execution and recalls unread messages | Reported | Community feedback relayed by the user |
| P-003 | Stop an individual subagent from the subagent list | Reported | User request |
| P-004 | Lead delegation should not require permission prompts | Reported | User request |
| P-005 | Preserve session permission grants across daemon restarts and session reopening | Reported | User request |
| P-006 | Recurring turn failures with `codex-startup-failed` | Reported | User reports frequent occurrences |
| P-007 | Mobile Enter inserts a newline instead of sending the message | Reported | User request |
| P-008 | Slow sessions with accumulated context, repeated verification, and oversized RPC responses | Investigated; community correlation pending | Community analysis supplied as a screenshot |
| P-009 | First mobile image attachment attempt fails without delivering an image | Reported | User report in this conversation |
| P-010 | Review session modifications in a Git diff tab in the web UI | Reported | User request |
| P-011 | Evaluate context-window visibility for the Lead and each subagent | Reported | User request |
| P-012 | Explain provider/runner failures and offer appropriate recovery | Implemented and reviewed; activation pending | Live user report and explicit resilience request, 2026-10-22 |

## P-001 — Lead appears idle during Codex context compaction

- **Status:** Implemented and independently reviewed in `484fd39`; activation pending.
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

- **Status:** Reported; implementation pending.
- **Source:** Community feedback relayed by the user in this conversation.
- **Requested behavior:** Pressing Escape twice cancels the Lead's current execution. A sent message that the Lead has not yet read can be cancelled and its text returned to the input for editing or resubmission.
- **Impact:** Users can stop unwanted execution and recover premature or mistaken submissions without retyping them.
- **Evidence:** User request only; current behavior and runner support have not been investigated.

### Proposed outcome and verification

- [ ] Double Escape cancels the Lead's active execution and visibly confirms cancellation.
- [ ] Cancelling an unread sent message removes it from pending delivery and restores its full text to the input.
- [ ] A successfully recalled message is not subsequently delivered to the Lead.
- [ ] If the Lead has already consumed the message, the UI does not claim that recall succeeded.
- [ ] Restoring a message preserves any draft already in the input.
- [ ] Verify cancellation and recall when message delivery races with the user's action.

**Details to settle during implementation:** Double-Escape timing and behavior inside dialogs; whether the same shortcut recalls an unread message before interrupting an active turn; selection when multiple messages are pending; the authoritative boundary for "read"; preserving an existing draft; supported UI surfaces and the scope of cancellation for delegated work.

**Implementation change:** Not assigned. This entry records the requested behavior; no runtime changes have been made.

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

- **Status:** Reported; implementation pending.
- **Source:** User request in this conversation.
- **Requested behavior:** In the mobile message composer, pressing Enter inserts a newline instead of submitting the message. Sending remains an explicit action through the Send button.
- **Impact:** Users can compose multiline messages on mobile without accidentally sending unfinished text.
- **Evidence:** User request only; current keyboard handling has not been investigated.

### Proposed outcome and verification

- [ ] Enter inserts a newline at the cursor in the mobile composer without submitting or queuing a message.
- [ ] The Send button submits the complete message with its line breaks preserved.
- [ ] Verify repeated newlines and editing within existing multiline text.
- [ ] Verify behavior with iOS and Android virtual keyboards, including composition input.
- [ ] Confirm existing desktop keyboard behavior remains intact.

**Details to settle during implementation:** How the composer identifies mobile input, including tablets and attached physical keyboards; suitable virtual-keyboard action hints.

**Implementation change:** Not assigned. This entry records the requested behavior; no runtime changes have been made.

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

- **Status:** Reported; feasibility evaluation pending.
- **Source:** User request following the P-008 investigation.
- **Requested behavior:** Determine whether the UI can display the context window and its usage separately for the Lead and every subagent.
- **Impact:** Users can understand context pressure and interpret slowdowns or compaction without relying on a generic waiting indicator.
- **Existing evidence:** The P-008 investigation found native Codex usage counters and a reported context-window limit. It also identified differences between cumulative usage, last-request counters, and post-compaction events. Reliable current occupancy and equivalent data across runners have not been established.

### Feasibility and acceptance checks

- [ ] Identify the available context limit, current-usage measurement, units, and update semantics for each supported runner/model.
- [ ] Separate actual context occupancy from cumulative tokens, output tokens, and cached-input counters; do not present total session usage as window occupancy.
- [ ] Evaluate displaying used tokens, capacity, and percentage for the Lead and each subagent when compatible, reliable measurements are available.
- [ ] Explicitly distinguish measured, estimated, stale, and unavailable values; missing data must not appear as zero usage.
- [ ] Attribute values to the correct session, task, native thread, and attempt; prevent stale values from a previous model or context from appearing current.
- [ ] Verify updates across compaction, continuation, model changes, completion, and reconnection.
- [ ] Evaluate accessible desktop and mobile placement alongside Lead status and subagent entries.

**Related investigation:** [Session latency and context investigation](changes/session-context-latency-investigation/working-brief.md), especially the usage-counter limitations in finding 6. P-001 covers compaction progress itself.

**Implementation change:** Not assigned. Evaluate feasibility before promising a precise live context meter; no runtime changes have been made.

## P-012 — Generic turn failure hides native model-capacity error

- **Observed:** The user saw `Turn failed` followed by `The runner could not complete this turn. Try again.` in this session.
- **Confirmed cause of this turn failure:** Codex returned `codexErrorInfo: serverOverloaded` with `Selected model is at capacity. Please try a different model.` at `2026-10-22T13:46:21.195Z` (08:46:21 America/Bogota).
- **Evidence:** Session `20261022T003008-6f199c`, Lead, ledger sequence 18870 contains the native error and sequence 18871 contains the failed native turn with the same error. Host sequence 18876 contains only `turn.completed {status: failed}`. The web renderer in `apps/web/src/main.tsx` uses the reported generic fallback when `event.data.error` is absent. Source literal and bounded ledger fields were inspected directly; graph coverage is stale/untracked.
- **Boundary:** This identifies service capacity as the reported failure reason, not context exhaustion or the readiness-cache fix. It does not prove a reason for other failures such as P-006.
- **Desired correction:** Preserve a sanitized actionable native failure category/message through the adapter, host terminal result and web history. Avoid exposing raw payloads or credentials; preserve safe fallback for unknown errors. Verify model overload, missing error, and unrelated error types, and keep retry/model-change guidance explicit without automatic model changes or duplicate execution.
- **Scope update:** The user explicitly requested preparedness for provider instability and clear attribution. See [provider failure brief](changes/session-context-latency-investigation/provider-failure-brief.md) for cross-runner classification, actionable recovery, redaction, persistence and safe-retry constraints.
- **Status:** Cross-runner failure reporting implemented and independently approved; activation pending. Fixed explanations preserve confirmed versus inferred/unknown attribution and manual recovery without automatic replay. See the provider failure brief for test evidence and limitations, including uncorrelated OpenCode session-only errors.
