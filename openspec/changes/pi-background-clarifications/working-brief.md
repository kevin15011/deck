# In-flight clarifications and durable response visibility in Pi

## User intent
The user wants Lead to send clarifications to already-running subagents, without an interactive task inspector. Context accounting, session diagnostics and expanded task review interfaces are explicitly deferred/rejected for now.

The user clarifies that the earlier answer did NOT disappear: it simply moved out of view through normal chat scrolling. Treat that as established product evidence; no missing-transcript/root-cause investigation is needed. The problem is discoverability of earlier answers while background results continue. They ask whether answers should be repeated until the user replies, or what alternative would be better. Repeated delivery is a suggestion to evaluate, not an approved delivery policy.

## Investigation scope
1. Trace safe, Pi-native in-flight steering with delivery/attempt/session ownership evidence. Clarifications must not restart children, duplicate work, expand granted authority or mutate exact child history invisibly. Distinguish queued clarification from child consumption, and respect tool execution boundaries.
2. Superseded by user clarification: do not investigate disappearance, corruption or overwrite of the prior response, and do not inspect the private transcript for that purpose. Evaluate only discoverability after ordinary scrolling, if useful for the recommendation.
3. Superseded by the user's selected solution: no new learned shortcuts, pending-read workflow or read receipts. Lead must complete tools, checks, OpenSpec updates and task resolution BEFORE its substantive user-facing answer; that answer is the last action of the current turn. This does not wait for running children: later results are separate continuations following the same order. Do not replay earlier answers or investigate ordinary scrolling as data loss.

## Constraints
Pi-only orchestration. Core skill ownership remains a separate completed change. Existing mandatory authority, session/attempt fencing, cancellation ownership and exact-history requirements remain binding. No personal installation/configuration, external provider/network calls, commits or destructive Git operations. The user authorized the narrow Pi response-order instruction change. In-flight child clarification remains a separate desired capability and is not implemented by this ordering delta. Lead is the sole OpenSpec writer.

## Status
The obsolete mixed-scope investigation was cancelled and its outcome resolved as blocked, with no implementation to integrate. The user subsequently rejected shortcut-based read acknowledgement and selected answer-last ordering instead.

Implemented directly in the Pi-generated launch profile (`packages/adapter-pi/src/pi-team-profile.ts`) and native continuation task board (`packages/adapter-pi/src/pi-extensions/subagents/task-board.ts`). Required tools, checks, OpenSpec/working-brief writes and task resolution precede the answer; after answering, Lead yields immediately. Essential progress notices are brief and are not the substantive answer. Asking a consequential question ends that turn. Later background outcomes remain separate continuations; ordering must not turn background delegation into waiting.

Added disk-materialization assertions and a focused task-board regression test. Canonical Pi bundles regenerated. Pinned Bun checks for profile, task-board, extension, native scheduling and asset freshness: 49 passed, 0 failed, 251 assertions across 5 files. Native tests use scripted providers and do not establish real-model compliance; this is durable instruction-level guidance, not a host-enforced response scheduler. No Core/other-runner policy changes, personal installation, new shortcuts, unread UI or answer replay. In-flight clarification remains desired and pending, not silently completed by this delta.

## Current authorization — implement in-flight clarifications now
The user explicitly prioritizes this feature and requests fast delivery. Implement only Lead-to-running-child clarifications through the existing subagent tool, with the smallest safe native Pi path. No further recap work, inspector, unread UI, new shortcuts or unrelated improvements.

Acceptance: an exact running task can receive a bounded text clarification in its existing child execution/history; no restart or replacement child. Expose an explicit tool action (for example clarify with taskId and message). Report delivery honestly (accepted/queued is not proof that the model acted on it). Preserve session/attempt ownership and reject stale, foreign, terminal or cancelling targets. Clarification supplements the authorized assignment without granting new permissions; it must not interrupt an already executing shell operation or silently expand scope. Use supported native Pi steering/follow-up behavior at an appropriate safe boundary. Cancellation/exit must clean up any transport without hanging the child or leaking into a later attempt. Bound messages and guard malformed transport inputs. No live providers, personal installation/configuration changes or Git commits/discard.

One implementation owner ships the minimal vertical slice and focused native/offline proof. Lead reviews the actual control/ownership boundary and reruns only affected checks; do not launch another general investigation or broad review pipeline. Canonical generated Pi bundles must be regenerated through the existing script. The old cancelled investigation remains settled; this is a new authorized implementation, not a retry of its obsolete transcript investigation.

Status: implementing in-flight clarifications; response-order work is already complete and unrelated to this acceptance.

## Final in-flight clarification result
Completed in the repository. The earlier statements that in-flight clarification was pending describe the prior response-order/recap scope and are superseded by this result.

The existing Pi `subagent` tool now accepts `{ action: "clarify", taskId, message }`. It delivers bounded Lead guidance through the existing parent/child JSON IPC channel to native steering in the same running child/session history. It does not restart the child or abort an active shell operation. Parent/task/file/attempt/nonce identity and live execution checks reject stale, foreign, terminal, cancelling and malformed targets. IPC is unreferenced and cleaned up on shutdown/exit/cancel so it cannot keep print-mode children alive.

Limits: 4,000 characters per clarification and eight sends per attempt. A receipt confirms native API acceptance only, not queue persistence, model consumption or compliance. An acknowledgement timeout reports unknown delivery and does not trigger automatic retries. Clarifications supplement existing authorization rather than grant permissions or expand scope.

Lead inspected `clarification.ts` and the runner, jobs, extension and child-shell control paths. Lead reran the clarification unit/transport/native tests, child-shell, transport, extension and canonical generated-asset checks on pinned Bun 1.3.12: **37 passed, 0 failed, 192 assertions across 7 files** (17.13 seconds). Log: `/tmp/deck-clarifications-verified-RoYVmS.log`. Root TypeScript and `git diff --check` passed. Two offline native tests prove same-history delivery after active Bash completes. The implementer separately reported 66 distinct focused tests across 11 files. No full-suite rerun or additional review delegation was required for this repair.

Changed implementation: `packages/adapter-pi/src/pi-extensions/subagents/{clarification,runner,jobs,extension,child-shell}.ts`, three focused clarification test files and canonically regenerated Pi extension bundles. Completed cumulative recaps and local Neon Grid theme were preserved. No Core/other-runner changes, personal installation/configuration, live providers or commits. Normal build and installation remain required to expose the new tool action to installed Pi sessions.
